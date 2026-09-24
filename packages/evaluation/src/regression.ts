import { round, type CaseRun, type CaseRunStatus, type MetricResult, type Regression, type Severity } from '@arl/shared';

/**
 * Regression = 之前通过，现在失败。
 * 除用例级回归外，还支持指标回归 / 延迟回归 / 成本回归。
 */

export interface RunSnapshot {
  runId: string;
  label: string;
  caseRuns: CaseRun[];
  metrics: MetricResult[];
}

export interface RegressionThresholds {
  /** 通过率下降超过该比例即视为指标回归 */
  passRateDrop: number;
  /** P95 延迟恶化倍数 */
  latencyFactor: number;
  /** P95 延迟额外容忍（毫秒） */
  latencyAbsoluteMs: number;
  /** 平均成本增长倍数 */
  costFactor: number;
}

export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholds = {
  passRateDrop: 0.02,
  latencyFactor: 1.5,
  latencyAbsoluteMs: 500,
  costFactor: 1.5,
};

function metricValue(snapshot: RunSnapshot, key: string): number | null {
  const metric = snapshot.metrics.find((m) => m.metricKey === key);
  return metric ? metric.value : null;
}

export interface CaseTransition {
  testCaseId: string;
  testCaseName: string;
  priority: CaseRun['priority'];
  tags: string[];
  baseStatus: CaseRunStatus;
  targetStatus: CaseRunStatus;
  baseCaseRunId: string;
  targetCaseRunId: string;
  failureCategory: string | null;
}

export interface RunComparison {
  base: { runId: string; label: string };
  target: { runId: string; label: string };
  metricDiffs: {
    metricKey: string;
    name: string;
    base: number | null;
    target: number | null;
    delta: number | null;
    direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
    improved: boolean | null;
  }[];
  fixedCases: CaseTransition[];
  regressedCases: CaseTransition[];
  bothPassed: CaseTransition[];
  bothFailed: CaseTransition[];
  changedFailures: { testCaseId: string; testCaseName: string; from: string | null; to: string | null }[];
  regressions: Regression[];
}

const PASSING: CaseRunStatus[] = ['passed'];
const FAILING: CaseRunStatus[] = ['failed', 'partial', 'error', 'timeout', 'cancelled'];

export function compareRuns(
  base: RunSnapshot,
  target: RunSnapshot,
  thresholds: RegressionThresholds = DEFAULT_REGRESSION_THRESHOLDS,
): RunComparison {
  const baseByCase = new Map(base.caseRuns.map((c) => [c.testCaseId, c]));
  const targetByCase = new Map(target.caseRuns.map((c) => [c.testCaseId, c]));

  const fixedCases: CaseTransition[] = [];
  const regressedCases: CaseTransition[] = [];
  const bothPassed: CaseTransition[] = [];
  const bothFailed: CaseTransition[] = [];
  const changedFailures: RunComparison['changedFailures'] = [];

  for (const [testCaseId, targetRun] of targetByCase) {
    const baseRun = baseByCase.get(testCaseId);
    if (!baseRun) continue;
    const transition: CaseTransition = {
      testCaseId,
      testCaseName: targetRun.testCaseName || baseRun.testCaseName,
      priority: targetRun.priority,
      tags: targetRun.tags,
      baseStatus: baseRun.status,
      targetStatus: targetRun.status,
      baseCaseRunId: baseRun.id,
      targetCaseRunId: targetRun.id,
      failureCategory: targetRun.failureCategory,
    };

    const basePass = PASSING.includes(baseRun.status);
    const targetPass = PASSING.includes(targetRun.status);

    if (basePass && targetPass) bothPassed.push(transition);
    else if (!basePass && !targetPass) bothFailed.push(transition);
    else if (!basePass && targetPass) fixedCases.push(transition);
    else regressedCases.push(transition);

    if (!basePass && !targetPass && baseRun.failureCategory !== targetRun.failureCategory) {
      changedFailures.push({
        testCaseId,
        testCaseName: transition.testCaseName,
        from: baseRun.failureCategory,
        to: targetRun.failureCategory,
      });
    }
  }

  const regressionItems: Regression[] = regressedCases.map((c) => ({
    id: `reg_${c.testCaseId}`,
    kind: 'case' as const,
    severity: (c.priority === 'critical' ? 'critical' : 'major') as Severity,
    caseRunId: c.targetCaseRunId,
    testCaseId: c.testCaseId,
    testCaseName: c.testCaseName,
    metricKey: null,
    baselineValue: null,
    currentValue: null,
    description: `用例回归：${c.testCaseName}（${c.baseStatus} → ${c.targetStatus}${c.failureCategory ? `，${c.failureCategory}` : ''}）`,
    evidence: [
      { type: 'case' as const, description: `baseline caseRun ${c.baseCaseRunId}` },
      { type: 'case' as const, description: `current caseRun ${c.targetCaseRunId}` },
    ],
  }));

  // 指标回归
  const passRateBase = metricValue(base, 'task_success_rate');
  const passRateTarget = metricValue(target, 'task_success_rate');
  if (passRateBase !== null && passRateTarget !== null && passRateBase - passRateTarget > thresholds.passRateDrop) {
    regressionItems.push({
      id: 'reg_metric_pass_rate',
      kind: 'metric',
      severity: passRateBase - passRateTarget >= 0.05 ? 'critical' : 'major',
      caseRunId: null,
      testCaseId: null,
      testCaseName: '',
      metricKey: 'task_success_rate',
      baselineValue: passRateBase,
      currentValue: passRateTarget,
      description: `通过率下降：${(passRateBase * 100).toFixed(1)}% → ${(passRateTarget * 100).toFixed(1)}%（-${((passRateBase - passRateTarget) * 100).toFixed(1)} 个百分点）`,
      evidence: [{ type: 'metric', description: 'task_success_rate' }],
    });
  }

  // 延迟回归
  const latencyBase = metricValue(base, 'p95_latency_ms');
  const latencyTarget = metricValue(target, 'p95_latency_ms');
  if (
    latencyBase !== null &&
    latencyTarget !== null &&
    latencyTarget > latencyBase * thresholds.latencyFactor &&
    latencyTarget - latencyBase > thresholds.latencyAbsoluteMs
  ) {
    regressionItems.push({
      id: 'reg_metric_latency',
      kind: 'latency',
      severity: latencyTarget > latencyBase * 2.5 ? 'major' : 'minor',
      caseRunId: null,
      testCaseId: null,
      testCaseName: '',
      metricKey: 'p95_latency_ms',
      baselineValue: latencyBase,
      currentValue: latencyTarget,
      description: `P95 延迟恶化：${round(latencyBase, 1)}ms → ${round(latencyTarget, 1)}ms（${(latencyTarget / Math.max(1, latencyBase)).toFixed(2)}×）`,
      evidence: [{ type: 'metric', description: 'p95_latency_ms' }],
    });
  }

  // 成本回归（只在两边的成本都已知时判定，未知不猜）
  const costBase = metricValue(base, 'avg_cost_usd');
  const costTarget = metricValue(target, 'avg_cost_usd');
  if (costBase !== null && costTarget !== null && costBase > 0 && costTarget > costBase * thresholds.costFactor) {
    regressionItems.push({
      id: 'reg_metric_cost',
      kind: 'cost',
      severity: costTarget > costBase * 2 ? 'major' : 'minor',
      caseRunId: null,
      testCaseId: null,
      testCaseName: '',
      metricKey: 'avg_cost_usd',
      baselineValue: costBase,
      currentValue: costTarget,
      description: `平均成本上升：$${costBase} → $${costTarget}（${(costTarget / costBase).toFixed(2)}×）`,
      evidence: [{ type: 'metric', description: 'avg_cost_usd' }],
    });
  }

  const metricKeys = new Set([...base.metrics.map((m) => m.metricKey), ...target.metrics.map((m) => m.metricKey)]);
  const metricDiffs = [...metricKeys].sort().map((key) => {
    const b = base.metrics.find((m) => m.metricKey === key);
    const t = target.metrics.find((m) => m.metricKey === key);
    const baseValue = b?.value ?? null;
    const targetValue = t?.value ?? null;
    const direction = (t?.direction ?? b?.direction ?? 'higher_is_better') as 'higher_is_better' | 'lower_is_better' | 'neutral';
    const delta = baseValue !== null && targetValue !== null ? round(targetValue - baseValue, 4) : null;
    const improved =
      delta === null || direction === 'neutral' ? null : direction === 'higher_is_better' ? delta > 0 : delta < 0;
    return {
      metricKey: key,
      name: t?.name ?? b?.name ?? key,
      base: baseValue,
      target: targetValue,
      delta,
      direction,
      improved,
    };
  });

  return {
    base: { runId: base.runId, label: base.label },
    target: { runId: target.runId, label: target.label },
    metricDiffs,
    fixedCases,
    regressedCases,
    bothPassed,
    bothFailed,
    changedFailures,
    regressions: regressionItems,
  };
}

export function regressionSummary(regressions: Regression[]): {
  total: number;
  critical: number;
  major: number;
  byKind: Record<string, number>;
} {
  return {
    total: regressions.length,
    critical: regressions.filter((r) => r.severity === 'critical').length,
    major: regressions.filter((r) => r.severity === 'major').length,
    byKind: regressions.reduce<Record<string, number>>((acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

export { FAILING };
