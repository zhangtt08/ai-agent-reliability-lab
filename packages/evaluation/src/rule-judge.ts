import type { CaseRunStatus, EvaluationResult } from '@arl/shared';
import type { EvaluationDraft } from './types';

export type JudgeMode = 'all' | 'any' | 'weighted';

export interface RuleJudgeOutcome {
  verdict: CaseRunStatus;
  score: number;
  reason: string;
  countedResults: EvaluationDraft[];
  skippedCount: number;
  blockingFailures: number;
  /** 没有一条 applicable 的检查项（数据集配置问题，需要被看见） */
  noApplicableChecks: boolean;
}

/**
 * Rule Judge —— 把多个 Evaluator 的结论合成一个用例裁决。
 *
 * 规则：
 *  - `skipped` 不参与判定，但会被计数并展示（避免「少跑检查 = 通过率高」这种假象）。
 *  - 任何 `blocking` 的检查失败 → 直接 failed，不参与加权平均。
 *  - all：全通过才 passed；有 partial 则 partial。
 *  - any：任一通过即 passed。
 *  - weighted：加权总分与 passThreshold 比较；落在 [阈值-0.15, 阈值) 判 partial。
 */
export function judgeCase(results: EvaluationDraft[], mode: JudgeMode, passThreshold: number): RuleJudgeOutcome {
  const counted = results.filter((r) => r.status !== 'skipped');
  const skippedCount = results.length - counted.length;

  if (counted.length === 0) {
    return {
      verdict: 'passed',
      score: 1,
      reason: `本用例没有任何适用的检查项（共 ${results.length} 个 evaluator 全部 skipped）—— 请检查数据集是否缺少 expectedOutcome`,
      countedResults: [],
      skippedCount,
      blockingFailures: 0,
      noApplicableChecks: true,
    };
  }

  const blockingFailures = counted.filter((r) => r.blocking && r.status === 'fail');
  if (blockingFailures.length > 0) {
    return {
      verdict: 'failed',
      score: weightedScore(counted),
      reason: `阻断性检查失败 ${blockingFailures.length} 项：${blockingFailures.map((r) => r.name || r.evaluatorKey).join('、')}`,
      countedResults: counted,
      skippedCount,
      blockingFailures: blockingFailures.length,
      noApplicableChecks: false,
    };
  }

  const passes = counted.filter((r) => r.status === 'pass').length;
  const fails = counted.filter((r) => r.status === 'fail').length;
  const partials = counted.filter((r) => r.status === 'partial').length;
  const errors = counted.filter((r) => r.status === 'error').length;
  const score = weightedScore(counted);

  if (errors > 0) {
    const erroring = counted.filter((r) => r.status === 'error');
    return {
      verdict: 'partial',
      score,
      reason: `${erroring.length} 个 evaluator 执行出错（${erroring.map((r) => r.evaluatorKey).join('、')}），结论不可信`,
      countedResults: counted,
      skippedCount,
      blockingFailures: 0,
      noApplicableChecks: false,
    };
  }

  switch (mode) {
    case 'all': {
      if (fails > 0) {
        return {
          verdict: 'failed',
          score,
          reason: `${fails}/${counted.length} 项检查失败：${counted.filter((r) => r.status === 'fail').map((r) => r.name || r.evaluatorKey).join('、')}`,
          countedResults: counted,
          skippedCount,
          blockingFailures: 0,
          noApplicableChecks: false,
        };
      }
      if (partials > 0) {
        return {
          verdict: 'partial',
          score,
          reason: `${partials} 项检查部分通过（加权得分 ${score.toFixed(2)}）`,
          countedResults: counted,
          skippedCount,
          blockingFailures: 0,
          noApplicableChecks: false,
        };
      }
      return {
        verdict: 'passed',
        score: 1,
        reason: `${passes}/${counted.length} 项检查全部通过`,
        countedResults: counted,
        skippedCount,
        blockingFailures: 0,
        noApplicableChecks: false,
      };
    }
    case 'any': {
      if (passes > 0) {
        return {
          verdict: 'passed',
          score,
          reason: `${passes}/${counted.length} 项检查通过（any 模式）`,
          countedResults: counted,
          skippedCount,
          blockingFailures: 0,
          noApplicableChecks: false,
        };
      }
      return {
        verdict: partials > 0 ? 'partial' : 'failed',
        score,
        reason: partials > 0 ? `${partials} 项部分通过，无完全通过项` : '没有任何检查项通过',
        countedResults: counted,
        skippedCount,
        blockingFailures: 0,
        noApplicableChecks: false,
      };
    }
    case 'weighted': {
      // partial 带 = [阈值-0.15, 阈值)。用绝对带宽而非相对带宽：
      // 阈值 0.95 时 0.75 分应判 failed（差距明显），而不是因为「离阈值不算太远」被判 partial。
      const partialFloor = Math.max(0, passThreshold - 0.15);
      const verdict: CaseRunStatus = score >= passThreshold ? 'passed' : score >= partialFloor ? 'partial' : 'failed';
      return {
        verdict,
        score,
        reason: `加权得分 ${score.toFixed(3)}（阈值 ${passThreshold}，partial 下限 ${partialFloor.toFixed(2)}）→ ${verdict}`,
        countedResults: counted,
        skippedCount,
        blockingFailures: 0,
        noApplicableChecks: false,
      };
    }
    default: {
      const exhaustive: never = mode;
      throw new Error(`未知 judgeMode: ${String(exhaustive)}`);
    }
  }
}

function weightedScore(results: EvaluationDraft[]): number {
  const totalWeight = results.reduce((sum, r) => sum + (r.weight || 1), 0) || 1;
  const score = results.reduce((sum, r) => sum + (r.score ?? 0) * (r.weight || 1), 0) / totalWeight;
  return Math.round(score * 10000) / 10000;
}

/** 人工结论优先于机器结论，但**不覆盖**机器结论（两者并存，可对比） */
export function mergeHumanVerdict(machine: CaseRunStatus, human: CaseRunStatus | null): CaseRunStatus {
  return human ?? machine;
}

export function summarizeResults(results: EvaluationResult[]): { passed: number; failed: number; partial: number; error: number; skipped: number } {
  return {
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    partial: results.filter((r) => r.status === 'partial').length,
    error: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}
