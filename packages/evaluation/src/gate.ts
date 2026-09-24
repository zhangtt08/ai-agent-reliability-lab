import {
  type CaseRun,
  type EvaluationResult,
  type Failure,
  type GateRuleResult,
  type Regression,
  type ReleaseDecision,
  type ReleaseGate,
} from '@arl/shared';
import { computeMetrics } from './metrics';

export interface GateEvaluationInput {
  gate: ReleaseGate;
  runId: string;
  agentId: string;
  agentVersionId: string;
  caseRuns: CaseRun[];
  results: EvaluationResult[];
  failures: Failure[];
  regressions: Regression[];
  toolCallStats?: { total: number; errors: number };
}

export type GateDecision = Omit<ReleaseDecision, 'id' | 'decidedAt'>;

function compare(op: string, actual: number, expected: number): boolean {
  switch (op) {
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '==':
      return actual === expected;
    default:
      return false;
  }
}

/**
 * Release Gate —— 发布门禁。
 *
 * 关键设计：
 *  - 判定结果分四种：PASS / FAIL / BLOCKED / UNKNOWN，**必须解释为什么**。
 *  - 指标缺失（例如无成本数据）→ UNKNOWN，而不是默默当成通过。
 *  - BLOCKED 表示「有阻断项无法判定」，与「明确不达标」区分开。
 */
export function evaluateReleaseGate(input: GateEvaluationInput): GateDecision {
  const { gate, caseRuns, results, failures, regressions } = input;
  const ruleResults: GateRuleResult[] = [];

  for (const rule of gate.rules) {
    const scoped = computeMetrics(
      { caseRuns, results, failures, toolCallStats: input.toolCallStats },
      rule.scope,
      rule.scopeValue,
    );
    const metric = scoped.find((m) => m.metricKey === rule.metricKey);
    const scopeLabel =
      rule.scope === 'overall' ? '全部用例' : rule.scope === 'critical' ? 'critical 用例' : `${rule.scope}=${rule.scopeValue}`;

    if (!metric) {
      ruleResults.push({
        ruleId: rule.id,
        description: rule.description || `${rule.metricKey} ${rule.op} ${rule.value}（${scopeLabel}）`,
        metricKey: rule.metricKey,
        scope: rule.scope,
        scopeValue: rule.scopeValue,
        op: rule.op,
        expected: rule.value,
        actual: null,
        result: 'UNKNOWN',
        blocking: rule.blocking,
        explanation: `指标 ${rule.metricKey} 在当前 run 上不存在（可能没有相关样本，或该指标需要成本/检索数据）`,
        evidence: [{ type: 'metric', description: rule.metricKey }],
      });
      continue;
    }

    const ok = compare(rule.op, metric.value, rule.value);
    ruleResults.push({
      ruleId: rule.id,
      description: rule.description || `${metric.name} ${rule.op} ${rule.value}（${scopeLabel}）`,
      metricKey: rule.metricKey,
      scope: rule.scope,
      scopeValue: rule.scopeValue,
      op: rule.op,
      expected: rule.value,
      actual: metric.value,
      result: ok ? 'PASS' : 'FAIL',
      blocking: rule.blocking,
      explanation: `${metric.name} 实际 ${metric.value}（${scopeLabel}，样本 ${metric.sampleSize}），要求 ${rule.op} ${rule.value} → ${ok ? '满足' : '不满足'}`,
      evidence: [{ type: 'metric', description: metric.definition }],
    });
  }

  if (gate.requireCriticalPass) {
    const criticalRuns = caseRuns.filter((c) => c.priority === 'critical');
    if (criticalRuns.length === 0) {
      ruleResults.push({
        ruleId: 'implicit-critical',
        description: 'critical 用例必须全部通过',
        metricKey: 'critical_pass_rate',
        scope: 'critical',
        scopeValue: '',
        op: '==',
        expected: 1,
        actual: null,
        result: 'UNKNOWN',
        blocking: true,
        explanation: '该 agent 在本次数据集上没有 critical 用例，无法验证关键路径',
        evidence: [],
      });
    } else {
      const failedCritical = criticalRuns.filter((c) => c.status !== 'passed');
      ruleResults.push({
        ruleId: 'implicit-critical',
        description: 'critical 用例必须全部通过',
        metricKey: 'critical_pass_rate',
        scope: 'critical',
        scopeValue: '',
        op: '==',
        expected: 1,
        actual: failedCritical.length === 0 ? 1 : (criticalRuns.length - failedCritical.length) / criticalRuns.length,
        result: failedCritical.length === 0 ? 'PASS' : 'FAIL',
        blocking: true,
        explanation:
          failedCritical.length === 0
            ? `${criticalRuns.length} 个 critical 用例全部通过`
            : `${failedCritical.length}/${criticalRuns.length} 个 critical 用例未通过：${failedCritical.map((c) => c.testCaseName).join('、')}`,
        evidence: failedCritical.map((c) => ({ type: 'case' as const, description: c.testCaseName })),
      });
    }
  }

  if (gate.requireNoRegression) {
    ruleResults.push({
      ruleId: 'implicit-regression',
      description: '不允许相对 baseline 出现回归',
      metricKey: 'regression_count',
      scope: 'overall',
      scopeValue: '',
      op: '==',
      expected: 0,
      actual: regressions.length,
      result: regressions.length === 0 ? 'PASS' : 'FAIL',
      blocking: true,
      explanation: regressions.length === 0 ? '未检测到回归' : `检测到 ${regressions.length} 条回归（其中 critical ${regressions.filter((r) => r.severity === 'critical').length} 条）`,
      evidence: regressions.slice(0, 10).map((r) => ({ type: 'rule' as const, ruleId: r.id, description: r.description })),
    });
  }

  const blockingFails = ruleResults.filter((r) => r.blocking && r.result === 'FAIL');
  const blockingUnknowns = ruleResults.filter((r) => r.blocking && r.result === 'UNKNOWN');
  const nonBlockingFails = ruleResults.filter((r) => !r.blocking && r.result === 'FAIL');

  let result: GateDecision['result'];
  let explanation: string;

  if (blockingFails.length > 0) {
    result = 'FAIL';
    explanation = `门禁不通过：${blockingFails.length} 项阻断规则不满足 —— ${blockingFails
      .map((r) => `${r.description}（实际 ${r.actual}）`)
      .join('；')}`;
  } else if (blockingUnknowns.length > 0) {
    result = 'BLOCKED';
    explanation = `无法判定：${blockingUnknowns.length} 项阻断规则缺少数据 —— ${blockingUnknowns
      .map((r) => `${r.description}：${r.explanation}`)
      .join('；')}`;
  } else {
    result = 'PASS';
    explanation = `门禁通过：${ruleResults.filter((r) => r.result === 'PASS').length} 项规则满足${
      nonBlockingFails.length > 0 ? `；另有 ${nonBlockingFails.length} 项非阻断建议未满足（${nonBlockingFails.map((r) => r.description).join('、')}）` : ''
    }`;
  }

  if (result === 'PASS' && regressions.length > 0) {
    explanation += `；注意：仍存在 ${regressions.length} 条回归（门禁未强制要求零回归）`;
  }

  return {
    gateId: gate.id,
    gateName: gate.name,
    runId: input.runId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    result,
    ruleResults,
    explanation,
    blockingFailures: blockingFails.length,
    regressionCount: regressions.length,
  };
}

/** 默认门禁：覆盖通过率 / critical / 幻觉 / 工具正确性 / 延迟 */
export function defaultGateRules(): ReleaseGate['rules'] {
  return [
    { id: 'rule-pass-rate', metricKey: 'task_success_rate', op: '>=', value: 0.9, scope: 'overall', scopeValue: '', blocking: true, description: '任务通过率 ≥ 90%' },
    { id: 'rule-hallucination', metricKey: 'hallucination_rate', op: '<=', value: 0.02, scope: 'overall', scopeValue: '', blocking: true, description: '幻觉率 ≤ 2%' },
    { id: 'rule-tool-accuracy', metricKey: 'tool_accuracy', op: '>=', value: 0.95, scope: 'overall', scopeValue: '', blocking: false, description: '工具使用正确率 ≥ 95%' },
    { id: 'rule-p95', metricKey: 'p95_latency_ms', op: '<=', value: 8000, scope: 'overall', scopeValue: '', blocking: false, description: 'P95 延迟 ≤ 8000ms' },
  ];
}
