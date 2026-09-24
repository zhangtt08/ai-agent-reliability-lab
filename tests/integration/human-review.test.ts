import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockModelProvider } from '@arl/providers';
import { openStore, type Store } from '@arl/persistence';
import { executeEvaluationRun } from '../../apps/server/src/services/run-pipeline';
import { seedDemoData, type SeedSummary } from '../../apps/server/src/services/seed';
import { RUN_CONFIG } from './helpers';

/**
 * Human Review Test（规格 §89）：
 * 机器 FAIL + 人工 Override PASS → 两者历史都存在，原始机器结果不被覆盖。
 */

describe('Human Review：人工结论与机器结论并存', () => {
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

  it('人工 override 后：机器结果保留、人工结果新增、case 状态更新、复核历史可追溯', async () => {
    // 用 wrong-tool agent 制造一个机器失败
    const dataset = seed.datasets.find((d) => d.name === 'Customer Support')!;
    const set = store.evaluatorSets.findByName('Full（发布门禁评测）')!;
    const agent = seed.agents.find((a) => a.fixtureId === 'wrong-tool-agent')!;
    const run = await executeEvaluationRun(store, {
      agentVersionId: agent.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
    });

    const failedCaseRun = run.caseRuns.find((c) => c.status !== 'passed')!;
    const machineVerdict = failedCaseRun.machineVerdict;
    expect(machineVerdict).not.toBe('passed');

    // 人工复核：推翻为 pass
    const review = store.reviews.create({
      caseRunId: failedCaseRun.id,
      runId: run.run.id,
      verdict: 'pass',
      comment: '业务确认：该场景下查余额是合理路径，期望配置过严',
      machineVerdict,
      machineSnapshot: store.evalResults.listByCaseRun(failedCaseRun.id).map((r) => ({ ...r })),
    });

    expect(review.overridesMachine).toBe(true);
    expect(review.machineVerdict).toBe(machineVerdict);
    expect(review.machineSnapshot.length).toBeGreaterThan(0);

    // 原始机器证据不被破坏：机器评测结果仍在
    const machineResults = store.evalResults.listByCaseRun(failedCaseRun.id);
    expect(machineResults.some((r) => r.status === 'fail')).toBe(true);
    // 失败归因仍在
    expect(store.failures.listByCaseRun(failedCaseRun.id).length).toBeGreaterThan(0);

    // case 状态被人工更新，但 machineVerdict 字段保留机器原始结论
    store.runs.updateCaseRun(failedCaseRun.id, { status: 'passed' });
    const updated = store.runs.getCaseRun(failedCaseRun.id)!;
    expect(updated.status).toBe('passed');
    expect(updated.machineVerdict).toBe(machineVerdict);

    // 复核历史可追溯（包括机器判定快照）
    const reviews = store.reviews.listByCaseRun(failedCaseRun.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.machineSnapshot.length).toBe(machineResults.length);

    // 一致性统计能看到「机器 failed / 人工 pass」这一分歧
    const agreement = store.reviews.agreementStats();
    expect(agreement.some((a) => a.machineVerdict === machineVerdict && a.humanVerdict === 'pass')).toBe(true);
  }, 180_000);
});
