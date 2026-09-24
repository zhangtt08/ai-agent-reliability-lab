import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockModelProvider } from '@arl/providers';
import { openStore, type Store } from '@arl/persistence';
import { executeEvaluationRun } from '../../apps/server/src/services/run-pipeline';
import { seedDemoData, type SeedSummary } from '../../apps/server/src/services/seed';
import { RUN_CONFIG } from './helpers';

/**
 * Evaluation Integrity Tests（规格 §86）：
 * 用**真实 runtime + 真实 evaluator + 真实流水线**跑 fixture agents，
 * 证明平台能发现它声称能发现的问题。除模型（Mock Provider）外不 mock 任何组件。
 */

describe('Evaluation Integrity：平台必须真的能发现 Agent 错误', () => {
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

  async function run(fixtureId: string, datasetName: string) {
    const agent = seed.agents.find((a) => a.fixtureId === fixtureId)!;
    const dataset = seed.datasets.find((d) => d.name === datasetName)!;
    const set = store.evaluatorSets.findByName('Full（发布门禁评测）')!;
    return executeEvaluationRun(store, {
      agentVersionId: agent.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: set.id,
      provider,
      runConfig: RUN_CONFIG,
      triggeredBy: 'integrity-test',
    });
  }

  it('Fixture Valid Agent（stable）→ 全部 PASS，且门禁 PASS', async () => {
    const result = await run('stable-agent', 'Customer Support');
    expect(result.caseRuns).toHaveLength(5);
    expect(result.caseRuns.every((c) => c.status === 'passed')).toBe(true);
    expect(result.gateDecision?.result).toBe('PASS');
    // 证据链完整：每个 case 都有 trace 与评测结果
    for (const caseRun of result.caseRuns) {
      expect(caseRun.traceId).toBeTruthy();
      const results = store.evalResults.listByCaseRun(caseRun.id);
      expect(results.filter((r) => r.status !== 'skipped').length).toBeGreaterThan(0);
      const trace = store.traces.getBundle(caseRun.traceId!);
      expect(trace.steps.length).toBeGreaterThan(0);
      expect(trace.modelCalls.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('Fixture Wrong Tool Agent → ToolCalledEvaluator 判 FAIL，归因为 tool_selection_failure', async () => {
    const result = await run('wrong-tool-agent', 'Customer Support');
    const failed = result.caseRuns.filter((c) => c.status !== 'passed');
    expect(failed.length).toBeGreaterThan(0);
    for (const caseRun of failed) {
      const results = store.evalResults.listByCaseRun(caseRun.id);
      expect(results.some((r) => r.evaluatorKey === 'tool.called' && r.status === 'fail')).toBe(true);
    }
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories.has('tool_selection_failure')).toBe(true);
  }, 120_000);

  it('Fixture Wrong Args Agent → 参数校验失败被判 FAIL（invalid_arguments）', async () => {
    const result = await run('wrong-args-agent', 'Tool Calling');
    const invalid = result.caseRuns.filter((c) => c.status !== 'passed');
    expect(invalid.length).toBeGreaterThan(0);
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories.has('tool_argument_failure')).toBe(true);
    // trace 里必须留下参数校验失败的原始证据
    const invalidCalls = result.caseRuns.flatMap((c) => (c.traceId ? store.traces.listToolCalls(c.traceId) : [])).filter((c) => c.status === 'invalid_arguments');
    expect(invalidCalls.length).toBeGreaterThan(0);
    expect(invalidCalls[0]!.validationError).toContain('orderId');
  }, 120_000);

  it('Fixture Bad Format Agent → Schema/JSON 校验判 FAIL，归因为 format_failure', async () => {
    const result = await run('bad-format-agent', 'Customer Support');
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories.has('format_failure')).toBe(true);
    const results = result.results;
    expect(results.some((r) => r.evaluatorKey === 'format.json_parse' && r.status === 'fail')).toBe(true);
  }, 120_000);

  it('Fixture RAG Failure Agent → 检索命中判 FAIL，归因为 retrieval_failure', async () => {
    const result = await run('rag-failure-agent', 'Knowledge QA');
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories.has('retrieval_failure')).toBe(true);
  }, 120_000);

  it('Fixture Loop Agent → LoopDetector 判 FAIL，归因为 loop，且 run 没有挂死', async () => {
    const result = await run('loop-agent', 'Customer Support');
    expect(result.caseRuns.length).toBe(5);
    for (const caseRun of result.caseRuns) {
      expect(caseRun.status).toBe('failed');
      expect(caseRun.failureCategory).toBe('loop');
    }
    // loop guard 生效：工具调用次数被限制在阈值附近，而不是无限增长
    const toolCalls = result.caseRuns.flatMap((c) => (c.traceId ? store.traces.listToolCalls(c.traceId) : []));
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls.every((c) => c.status === 'ok')).toBe(true);
  }, 120_000);

  it('Fixture Hallucination Agent → Groundedness 判 FAIL，归因为 hallucination', async () => {
    const result = await run('hallucination-agent', 'Customer Support');
    const categories = new Set(result.failures.map((f) => f.category));
    expect(categories.has('hallucination')).toBe(true);
    const groundedFailures = result.results.filter((r) => r.evaluatorKey === 'rag.groundedness' && r.status !== 'pass' && r.status !== 'skipped');
    expect(groundedFailures.length).toBeGreaterThan(0);
    // 幻觉证据必须指向具体断言
    expect(groundedFailures.some((r) => JSON.stringify(r.evidence).includes('100') || JSON.stringify(r.evidence).includes('小时'))).toBe(true);
  }, 120_000);

  it('Fixture Flaky Provider → 重试吸收限流，不把基础设施故障当 Agent 失败', async () => {
    const result = await run('flaky-provider-agent', 'Customer Support');
    expect(result.caseRuns.every((c) => c.status === 'passed')).toBe(true);
    const retrySteps = result.caseRuns.flatMap((c) => (c.traceId ? store.traces.listSteps(c.traceId, { type: 'decision' }) : []));
    expect(retrySteps.some((s) => s.name === 'provider_retry')).toBe(true);
  }, 120_000);
});
