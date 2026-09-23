import { extractJson } from '@arl/shared';
import { JUDGE_PAYLOAD_END, JUDGE_PAYLOAD_START, type JudgePayload } from './types';
import type { MockTurnDecision, MockTurnContext } from './mock-types';
import { fixturePolicies, heuristicPolicy } from './fixture-policies';

function normalize(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function containsAll(haystack: string, needles: string[]): { hit: number; missed: string[] } {
  const hay = normalize(haystack);
  const missed = needles.filter((n) => !hay.includes(normalize(n)));
  return { hit: needles.length - missed.length, missed };
}

/**
 * 确定性 LLM Judge「假模型」。
 * 它读 prompt 里嵌入的 [ARL_JUDGE_PAYLOAD] JSON，按 rubric 权重打分。
 * 这不是假装有 LLM —— 它是**可复现的 Judge 替身**，用于验证 Judge 链路、Schema 校验与降级逻辑；
 * 真实 provider 接入后，同一段 prompt 会交给真实模型。
 */
function mockJudgePolicy(ctx: MockTurnContext): MockTurnDecision {
  const joined = ctx.messages.map((m) => m.content).join('\n');
  const startIdx = joined.indexOf(JUDGE_PAYLOAD_START);
  const endIdx = joined.indexOf(JUDGE_PAYLOAD_END);
  if (startIdx < 0 || endIdx <= startIdx) {
    return {
      kind: 'final',
      text: JSON.stringify({
        score: 0,
        pass: false,
        reason: 'judge payload 缺失，无法评测（这是平台侧问题，不是被测 agent 的问题）',
        evidence: [],
        confidence: 0.1,
        criteriaScores: [],
      }),
      latencyMs: 60,
      reasoning: '缺少 judge payload',
    };
  }

  const payload = extractJson<JudgePayload>(joined.slice(startIdx + JUDGE_PAYLOAD_START.length, endIdx));
  if (!payload.ok) {
    return {
      kind: 'final',
      text: JSON.stringify({
        score: 0,
        pass: false,
        reason: 'judge payload 解析失败',
        evidence: [payload.error],
        confidence: 0.1,
        criteriaScores: [],
      }),
      latencyMs: 60,
    };
  }

  const p = payload.value;
  const output = p.output ?? '';
  const contextText = [p.expectedText ?? '', ...(p.context ?? [])].join('\n');

  const required = containsAll(output, p.mustContain ?? []);
  const forbidden = (p.mustNotContain ?? []).filter((n) => normalize(output).includes(normalize(n)));
  const overlapTerms = Array.from(new Set(`${p.expectedText ?? ''} ${(p.context ?? []).join(' ')}`.match(/[\u4e00-\u9fff]{2,}|[A-Za-z]{4,}/g) ?? []));
  const overlapHit = overlapTerms.filter((t) => normalize(output).includes(normalize(t))).length;
  const overlapRatio = overlapTerms.length > 0 ? overlapHit / overlapTerms.length : 0;
  const requiredRatio = (p.mustContain ?? []).length > 0 ? required.hit / (p.mustContain ?? []).length : 1;
  const lengthOk = normalize(output).length >= Math.min(20, normalize(p.expectedText ?? '').length || 20) ? 1 : 0.5;

  const raw: Record<string, number> = {
    correctness: Math.min(1, requiredRatio * 0.7 + overlapRatio * 0.3),
    groundedness: overlapRatio > 0 ? Math.min(1, overlapRatio + 0.2) : 0.2,
    completeness: Math.min(1, requiredRatio * 0.6 + lengthOk * 0.4),
    policy_compliance: forbidden.length === 0 ? 1 : 0.2,
  };

  const rubric = p.rubric ?? [];
  const totalWeight = rubric.reduce((sum, c) => sum + (c.weight || 1), 0) || 1;
  const weighted = rubric.reduce((sum, c) => sum + (raw[c.key] ?? 0.5) * (c.weight || 1), 0) / totalWeight;
  const score = Number(weighted.toFixed(4));
  const threshold = p.passThreshold ?? 0.7;

  const criteriaScores = rubric.map((c) => ({
    key: c.key,
    score: Number((raw[c.key] ?? 0.5).toFixed(2)),
    comment:
      c.key === 'correctness'
        ? `必需关键词命中 ${required.hit}/${(p.mustContain ?? []).length}${required.missed.length ? `，缺失：${required.missed.join('、')}` : ''}`
        : c.key === 'groundedness'
          ? `与期望/上下文词面重合率 ${(overlapRatio * 100).toFixed(0)}%`
          : c.key === 'policy_compliance'
            ? forbidden.length === 0
              ? '未出现禁止内容'
              : `出现禁止内容：${forbidden.join('、')}`
            : '按启发式估计',
  }));

  const verdict = {
    score,
    pass: score >= threshold,
    reason:
      score >= threshold
        ? `综合得分 ${score} ≥ 阈值 ${threshold}：关键信息基本覆盖。`
        : `综合得分 ${score} < 阈值 ${threshold}：${required.missed.length > 0 ? `缺少关键信息（${required.missed.join('、')}）` : '语言与期望的匹配度不足'}${
            forbidden.length > 0 ? `，且出现禁止内容（${forbidden.join('、')}）` : ''
          }。`,
    evidence: [
      `必需关键词命中 ${required.hit}/${(p.mustContain ?? []).length}`,
      `上下文词面重合率 ${(overlapRatio * 100).toFixed(0)}%`,
      ...(forbidden.length > 0 ? [`禁止内容命中：${forbidden.join('、')}`] : []),
    ],
    confidence: 0.72,
    criteriaScores,
  };

  void contextText;
  return { kind: 'final', text: JSON.stringify(verdict, null, 2), latencyMs: 90, reasoning: '确定性 rubric 打分' };
}

export const MOCK_JUDGE_FIXTURE_ID = 'arl-judge';

/** 所有内置 mock 行为（含 fixture agent 与 judge 替身） */
export const builtinPolicies = {
  ...fixturePolicies,
  [MOCK_JUDGE_FIXTURE_ID]: mockJudgePolicy,
  default: heuristicPolicy,
} as const;

export { heuristicPolicy };