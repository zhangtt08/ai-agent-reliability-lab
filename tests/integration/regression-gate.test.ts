import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockModelProvider } from '@arl/providers';
import { openStore, type Store } from '@arl/persistence';
import { executeEvaluationRun } from '../../apps/server/src/services/run-pipeline';
import { seedDemoData, type SeedSummary } from '../../apps/server/src/services/seed';
import { RUN_CONFIG } from './helpers';

/**
 * Regression Fixture（规格 §87）+ Release Gate Fixture（§88）+ Baseline（§49）
 */

describe('Regression + Release Gate fixture', () => {
  let store: Store;
  let seed: SeedSummary;
  const provider = createMockModelProvider({ latencyScale: 0.05, baseLatencyMs: 1 });

  beforeAll(() => {
    store = openStore({ memory: true });
    seed = seedDemoData(store);
  });

  afterAll(() => {
    store.close();
  });

  it('V1 5/5 PASS（baseline）→ V2 4/5 → 平台必须检出用例级回归', async () => {
    const dataset = seed.datasets.find((d) => d.name === 'Customer Support')!;
    const set = store.evaluatorSets.findByName('Full（发布门禁评测）')!;

    const v1 = seed.agents.find((a) => a.fixtureId === 'stable-agent')!;
    const v1Run = await executeEvaluationRun(store, {
      agentVersionId: v1.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
    });
    expect(v1Run.caseRuns.every((c) => c.status === 'passed')).toBe(true);
    store.runs.setBaseline(v1Run.run.id, true);

    const v2 = seed.agents.find((a) => a.fixtureId === 'regression-v2-agent')!;
    const v2Run = await executeEvaluationRun(store, {
      agentVersionId: v2.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
      baselineRunId: v1Run.run.id,
    });

    expect(v2Run.caseRuns.filter((c) => c.status === 'passed')).toHaveLength(4);
    expect(v2Run.caseRuns.filter((c) => c.status !== 'passed')).toHaveLength(1);

    const regressions = store.regressions.listByRun(v2Run.run.id);
    const caseRegressions = regressions.filter((r) => r.kind === 'case');
    expect(caseRegressions).toHaveLength(1);
    expect(caseRegressions[0]!.description).toContain('重复扣款咨询');
    expect(caseRegressions[0]!.evidence.length).toBeGreaterThan(0);

    // baseline 机制：V1 被标记且全局唯一
    const baseline = store.runs.findBaselineFor(dataset.versionId);
    expect(baseline?.id).toBe(v1Run.run.id);
  }, 180_000);

  it('Release Gate fixture：阈值 95% + 零回归 vs 实际 80% → 必须 FAIL 且给出解释', async () => {
    const dataset = seed.datasets.find((d) => d.name === 'Customer Support')!;
    const set = store.evaluatorSets.findByName('Full（发布门禁评测）')!;

    const v1 = seed.agents.find((a) => a.fixtureId === 'stable-agent')!;
    const v1Run = await executeEvaluationRun(store, {
      agentVersionId: v1.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
    });
    store.runs.setBaseline(v1Run.run.id, true);

    const v2 = seed.agents.find((a) => a.fixtureId === 'regression-v2-agent')!;
    const v2Run = await executeEvaluationRun(store, {
      agentVersionId: v2.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
      baselineRunId: v1Run.run.id,
    });

    const strictGate = store.gates.listGates(v1.id).find((g) => g.name.startsWith('Strict'))!;
    const decision = store.gates.listDecisions({ agentId: v1.id, limit: 20 }).find((d) => d.runId === v2Run.run.id && d.gateId === strictGate.id);
    // executeEvaluationRun 默认用第一个启用的 gate；显式再评一次严格门禁
    const { analyzeRun } = await import('../../apps/server/src/services/run-pipeline');
    const outcome = analyzeRun(store, v2Run.run.id, { gateId: strictGate.id, baselineRunId: v1Run.run.id, generateSuggestions: false });
    expect(decision ?? outcome.gateDecision).toBeDefined();

    const final = outcome.gateDecision!;
    expect(final.result).toBe('FAIL');
    expect(final.explanation).toContain('95%');
    expect(final.ruleResults.some((r) => r.metricKey === 'task_success_rate' && r.result === 'FAIL')).toBe(true);
    expect(final.ruleResults.some((r) => r.metricKey === 'regression_count' && r.result === 'FAIL')).toBe(true);
  }, 180_000);

  it('Core Gate 对合格版本判 PASS（门禁不是摆设，也不会冤枉好版本）', async () => {
    const dataset = seed.datasets.find((d) => d.name === 'Knowledge QA')!;
    const set = store.evaluatorSets.findByName('Full（发布门禁评测）')!;
    const v1 = seed.agents.find((a) => a.fixtureId === 'stable-agent')!;
    const run = await executeEvaluationRun(store, {
      agentVersionId: v1.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
    });
    expect(run.gateDecision?.result).toBe('PASS');
    expect(run.gateDecision?.blockingFailures).toBe(0);
  }, 180_000);
});
