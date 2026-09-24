import { round, type CaseRun, type EvaluationResult, type Failure, type MetricDefinition, type MetricResult, type Priority, type Regression } from '@arl/shared';
import type { EvaluationDraft } from './types';

/**
 * Metrics Engine。
 * 设计原则：**每个指标都必须写清楚怎么算**，并且不产出任何「神秘的 AI Score」。
 * 指标定义版本化（key@version），避免定义变化后历史数据不可比较。
 */

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'task_success_rate',
    name: '任务通过率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'verdict=passed 的 case 数 ÷ 参与评测的 case 数（分母不含 skipped/disabled）。',
  },
  {
    key: 'fail_rate',
    name: '失败率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'verdict=failed 的 case 数 ÷ 参与评测的 case 数。',
  },
  {
    key: 'partial_rate',
    name: '部分完成率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'verdict=partial 的 case 数 ÷ 参与评测的 case 数。',
  },
  {
    key: 'error_rate',
    name: '执行错误率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'verdict ∈ {error, timeout, cancelled} 的 case 数 ÷ 参与评测的 case 数。',
  },
  {
    key: 'critical_pass_rate',
    name: 'Critical 用例通过率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'priority=critical 且 verdict=passed 的 case 数 ÷ priority=critical 的 case 数。',
  },
  {
    key: 'tool_accuracy',
    name: '工具使用正确率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'category=tool 的 evaluator 结果中 status=pass 的条数 ÷ 该类结果总数（不含 skipped）。',
  },
  {
    key: 'format_compliance',
    name: '格式合规率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'category=format 的 evaluator 结果中 status=pass 的条数 ÷ 该类结果总数。',
  },
  {
    key: 'groundedness',
    name: '有据可依得分',
    version: 'v1',
    unit: 'score',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'evaluator_key=rag.groundedness 的 score 平均值（无检索上下文的用例不计入）。',
  },
  {
    key: 'hallucination_rate',
    name: '幻觉率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'failure.category=hallucination 的 case 数 ÷ 参与评测的 case 数。',
  },
  {
    key: 'loop_rate',
    name: '循环率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'failure.category=loop 的 case 数 ÷ 参与评测的 case 数。',
  },
  {
    key: 'retrieval_hit_rate',
    name: '检索命中率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'evaluator_key=rag.hit 结果为 pass 的条数 ÷ 该 evaluator 的非 skipped 结果总数。',
  },
  {
    key: 'tool_call_error_rate',
    name: '工具调用异常率',
    version: 'v1',
    unit: 'ratio',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'status ≠ ok 的 tool_call 数 ÷ 总 tool_call 数。',
  },
  {
    key: 'avg_latency_ms',
    name: '平均延迟',
    version: 'v1',
    unit: 'ms',
    direction: 'lower_is_better',
    scope: 'run',
    definition: '全部 case 的端到端耗时算术平均（毫秒）。',
  },
  {
    key: 'p50_latency_ms',
    name: 'P50 延迟',
    version: 'v1',
    unit: 'ms',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'case 耗时的中位数（最近秩方法）。',
  },
  {
    key: 'p95_latency_ms',
    name: 'P95 延迟',
    version: 'v1',
    unit: 'ms',
    direction: 'lower_is_better',
    scope: 'run',
    definition: 'case 耗时的 95 分位（ceil(0.95×n) 位，最近秩）。',
  },
  {
    key: 'avg_cost_usd',
    name: '平均成本',
    version: 'v1',
    unit: 'usd',
    direction: 'lower_is_better',
    scope: 'run',
    definition: '有成本数据（costSource ≠ unknown）的 case 的成本平均值；无任何成本数据时该 run 不产出此指标。',
  },
  {
    key: 'cost_known_ratio',
    name: '成本可知比例',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: 'usage.costUsd ≠ null 的 case 数 ÷ 全部 case 数。用于暴露「成本其实是未知的」。',
  },
  {
    key: 'checked_case_ratio',
    name: '有效检查覆盖率',
    version: 'v1',
    unit: 'ratio',
    direction: 'higher_is_better',
    scope: 'run',
    definition: '至少有一条非 skipped 检查的 case 数 ÷ 全部 case 数。防止「没有检查项 = 高通过率」。',
  },
];

export interface MetricsInput {
  caseRuns: CaseRun[];
  results: EvaluationResult[];
  failures: Failure[];
  regressions?: Regression[];
  /** 工具调用总数与异常数（来自 trace 聚合） */
  toolCallStats?: { total: number; errors: number };
}

export function metricDefinition(key: string): MetricDefinition | undefined {
  return METRIC_DEFINITIONS.find((m) => m.key === key);
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx]!;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator, 4);
}

function filterFor(caseRuns: CaseRun[], scope: 'overall' | 'critical' | 'tag' | 'category', scopeValue: string, failures: Failure[]): CaseRun[] {
  switch (scope) {
    case 'overall':
      return caseRuns;
    case 'critical':
      return caseRuns.filter((c) => c.priority === ('critical' as Priority));
    case 'tag':
      return caseRuns.filter((c) => c.tags.includes(scopeValue));
    case 'category': {
      const ids = new Set(failures.filter((f) => f.category === scopeValue).map((f) => f.caseRunId));
      return caseRuns.filter((c) => ids.has(c.id));
    }
    default:
      return caseRuns;
  }
}

/** 计算指标（支持作用域，供 Release Gate 做「critical 子集」判定） */
export function computeMetrics(
  input: MetricsInput,
  scope: 'overall' | 'critical' | 'tag' | 'category' = 'overall',
  scopeValue = '',
): MetricResult[] {
  const caseRuns = filterFor(input.caseRuns, scope, scopeValue, input.failures);
  const caseIds = new Set(caseRuns.map((c) => c.id));
  const results = input.results.filter((r) => caseIds.has(r.caseRunId));
  const failures = input.failures.filter((f) => caseIds.has(f.caseRunId));

  const total = caseRuns.length;
  const passed = caseRuns.filter((c) => c.status === 'passed').length;
  const failed = caseRuns.filter((c) => c.status === 'failed').length;
  const partial = caseRuns.filter((c) => c.status === 'partial').length;
  const errored = caseRuns.filter((c) => c.status === 'error' || c.status === 'timeout' || c.status === 'cancelled').length;
  const critical = caseRuns.filter((c) => c.priority === 'critical');
  const criticalPassed = critical.filter((c) => c.status === 'passed').length;

  const categoryPass = (category: string) => {
    const subset = results.filter((r) => r.category === category && r.status !== 'skipped');
    return ratio(subset.filter((r) => r.status === 'pass').length, subset.length);
  };

  const groundedness = results.filter((r) => r.evaluatorKey === 'rag.groundedness' && r.status !== 'skipped');
  const groundednessScore = groundedness.length === 0 ? null : round(groundedness.reduce((s, r) => s + r.score, 0) / groundedness.length, 4);

  const retrievalHits = results.filter((r) => r.evaluatorKey === 'rag.hit' && r.status !== 'skipped');
  const latencies = caseRuns.map((c) => c.latencyMs).sort((a, b) => a - b);
  const costed = caseRuns.filter((c) => c.usage.costUsd !== null);
  const avgCost = costed.length === 0 ? null : round(costed.reduce((s, c) => s + (c.usage.costUsd ?? 0), 0) / costed.length, 6);

  const checkedCases = new Set(results.filter((r) => r.status !== 'skipped').map((r) => r.caseRunId));

  const defs = new Map(METRIC_DEFINITIONS.map((d) => [d.key, d]));
  const make = (key: string, value: number | null, breakdown: Record<string, unknown> = {}, sampleSize = total): MetricResult | null => {
    const def = defs.get(key);
    if (!def || value === null) return null;
    return {
      runId: '',
      metricKey: def.key,
      metricVersion: def.version,
      name: def.name,
      value,
      unit: def.unit,
      direction: def.direction,
      definition: def.definition,
      sampleSize,
      breakdown,
    };
  };

  const toolStats = input.toolCallStats;
  const metrics: (MetricResult | null)[] = [
    make('task_success_rate', ratio(passed, total), { passed, total }),
    make('fail_rate', ratio(failed, total), { failed, total }),
    make('partial_rate', ratio(partial, total), { partial, total }),
    make('error_rate', ratio(errored, total), { errored, total }),
    make('critical_pass_rate', critical.length === 0 ? null : ratio(criticalPassed, critical.length), {
      criticalPassed,
      criticalTotal: critical.length,
    }),
    make('tool_accuracy', categoryPass('tool'), { samples: results.filter((r) => r.category === 'tool').length }),
    make('format_compliance', categoryPass('format'), { samples: results.filter((r) => r.category === 'format').length }),
    make('groundedness', groundednessScore, { samples: groundedness.length }),
    make('hallucination_rate', ratio(failures.filter((f) => f.category === 'hallucination').length, total), {
      count: failures.filter((f) => f.category === 'hallucination').length,
    }),
    make('loop_rate', ratio(failures.filter((f) => f.category === 'loop').length, total), {
      count: failures.filter((f) => f.category === 'loop').length,
    }),
    make('retrieval_hit_rate', retrievalHits.length === 0 ? null : ratio(retrievalHits.filter((r) => r.status === 'pass').length, retrievalHits.length), {
      samples: retrievalHits.length,
    }),
    make('tool_call_error_rate', toolStats && toolStats.total > 0 ? ratio(toolStats.errors, toolStats.total) : null, toolStats ?? {}),
    make('avg_latency_ms', total === 0 ? null : round(latencies.reduce((s, v) => s + v, 0) / total, 1), {}),
    make('p50_latency_ms', percentile(latencies, 0.5)),
    make('p95_latency_ms', percentile(latencies, 0.95)),
    make('avg_cost_usd', avgCost, { costedCases: costed.length }),
    make('cost_known_ratio', ratio(costed.length, total), { costed: costed.length, total }),
    make('checked_case_ratio', ratio(checkedCases.size, total), { checked: checkedCases.size, total }),
  ];

  return metrics.filter((m): m is MetricResult => m !== null);
}

export function metricMap(metrics: MetricResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) out[`${m.metricKey}@${m.metricVersion}`] = m.value;
  return out;
}

/** 失败分布（用于 Dashboard 与 Failure Analytics） */
export function failureDistribution(failures: Failure[]): { category: string; count: number; share: number }[] {
  const total = failures.length || 1;
  const acc = new Map<string, number>();
  for (const f of failures) acc.set(f.category, (acc.get(f.category) ?? 0) + 1);
  return [...acc.entries()]
    .map(([category, count]) => ({ category, count, share: round(count / total, 4) }))
    .sort((a, b) => b.count - a.count);
}

/** 每个 evaluator 的通过率（「哪个检查项最常失败」） */
export function evaluatorPassRates(results: EvaluationResult[]): { evaluatorKey: string; total: number; passed: number; rate: number }[] {
  const acc = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    if (r.status === 'skipped') continue;
    const entry = acc.get(r.evaluatorKey) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (r.status === 'pass') entry.passed += 1;
    acc.set(r.evaluatorKey, entry);
  }
  return [...acc.entries()]
    .map(([evaluatorKey, v]) => ({ evaluatorKey, total: v.total, passed: v.passed, rate: ratio(v.passed, v.total) }))
    .sort((a, b) => a.rate - b.rate);
}
