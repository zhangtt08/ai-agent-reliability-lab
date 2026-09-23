import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestStore, type Store } from '@arl/persistence';

/**
 * 「历史不可覆盖」不是文档里的承诺，而是数据库层的硬约束。
 * 这些用例直接打触发器，验证它真的会拒绝。
 */
describe('持久层不变量：历史不可覆盖 / 版本冻结', () => {
  let store: Store;

  beforeEach(() => {
    store = createTestStore();
  });

  afterEach(() => {
    store.close();
  });

  function seedVersion() {
    const agent = store.agents.create({ name: 'A' });
    const prompt = store.prompts.create({
      agentId: agent.id,
      systemPrompt: 'sys',
      taskPromptTemplate: '{{q}}',
    });
    const version = store.agentVersions.create({
      agentId: agent.id,
      promptVersionId: prompt.id,
      modelConfig: { provider: 'mock', model: 'm', temperature: 0, maxTokens: 128, pricing: null },
      runtimeConfig: { maxSteps: 4, maxToolCalls: 3, timeoutMs: 5000 },
    });
    return { agent, prompt, version };
  }

  it('agent_versions 的运行配置不可被 UPDATE 篡改', () => {
    const { version } = seedVersion();
    expect(() =>
      store.driver.run('UPDATE agent_versions SET model_config_json = ? WHERE id = ?', ['{"model":"hacked"}', version.id]),
    ).toThrow(/immutable/);
  });

  it('agent_versions 允许改 status / label / notes（元数据可变）', () => {
    const { version } = seedVersion();
    expect(() => store.agentVersions.setStatus(version.id, 'validated', { label: 'rc1', notes: 'ok' })).not.toThrow();
    const reloaded = store.agentVersions.get(version.id)!;
    expect(reloaded.status).toBe('validated');
    expect(reloaded.label).toBe('rc1');
  });

  it('新版本号自增且旧版本保留', () => {
    const { agent, prompt, version } = seedVersion();
    const second = store.agentVersions.create({
      agentId: agent.id,
      promptVersionId: prompt.id,
      modelConfig: { provider: 'mock', model: 'm2', temperature: 0, maxTokens: 128, pricing: null },
      runtimeConfig: { maxSteps: 4, maxToolCalls: 3, timeoutMs: 5000 },
    });
    expect(second.version).toBe(version.version + 1);
    expect(store.agentVersions.listByAgent(agent.id)).toHaveLength(2);
    expect(store.agentVersions.get(version.id)!.modelConfig.model).toBe('m');
  });

  it('prompt_versions 正文不可改，只能新建版本', () => {
    const { prompt } = seedVersion();
    expect(() =>
      store.driver.run('UPDATE prompt_versions SET system_prompt = ? WHERE id = ?', ['changed', prompt.id]),
    ).toThrow(/immutable/);
  });

  it('published/golden 版本中的 test case 不可增 / 改 / 删', () => {
    const ds = store.datasets.create({ name: 'D' });
    const dv = store.datasets.createVersion(ds.id, { status: 'draft' });
    const tc = store.datasets.createCase(dv.id, { name: 'c1', input: 'i', expectedOutcome: {} });
    store.datasets.freezeVersion(dv.id, { status: 'published' });

    expect(() => store.datasets.createCase(dv.id, { name: 'c2', input: 'i', expectedOutcome: {} })).toThrow(/frozen/);
    expect(() => store.datasets.updateCase(tc.id, { name: 'renamed' })).toThrow(/frozen/);
    expect(() => store.datasets.deleteCase(tc.id)).toThrow(/frozen/);
  });

  it('frozen 版本可以通过 fork 演进，新版本可编辑', () => {
    const ds = store.datasets.create({ name: 'D', isGolden: true });
    const dv = store.datasets.createVersion(ds.id, { status: 'draft' });
    store.datasets.createCase(dv.id, { name: 'c1', input: 'i1', expectedOutcome: { mustContain: ['a'] } });
    store.datasets.freezeVersion(dv.id, { status: 'golden' });

    const forked = store.datasets.forkVersion(dv.id);
    expect(forked.status).toBe('draft');
    expect(forked.version).toBe(2);
    const cases = store.datasets.listCases(forked.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe('c1');
    expect(cases[0]!.expectedOutcome.mustContain).toEqual(['a']);

    expect(() => store.datasets.updateCase(cases[0]!.id, { name: 'c1-edited' })).not.toThrow();
  });

  it('freeze 会记录内容指纹与 case 数（可复现性依据）', () => {
    const ds = store.datasets.create({ name: 'D' });
    const dv = store.datasets.createVersion(ds.id);
    store.datasets.createCase(dv.id, { name: 'c1', input: 'i', expectedOutcome: {} });
    store.datasets.createCase(dv.id, { name: 'c2', input: 'i', expectedOutcome: {} });
    const frozen = store.datasets.freezeVersion(dv.id);
    expect(frozen.caseCount).toBe(2);
    expect(frozen.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('evaluation_runs 身份字段不可改（否则历史不可复现）', () => {
    const { agent, version } = seedVersion();
    const ds = store.datasets.create({ name: 'D' });
    const dv = store.datasets.createVersion(ds.id);
    const set = store.evaluatorSets.create({ name: 'S', members: [] });
    const run = store.runs.create({
      agentId: agent.id,
      agentVersionId: version.id,
      datasetId: ds.id,
      datasetVersionId: dv.id,
      evaluatorSetId: set.id,
      status: 'queued',
      mode: 'full',
      runConfig: { concurrency: 1, timeoutMs: 1000, retries: 0, mode: 'full', seed: 1, promptPrivacy: 'store_full', smokeLimit: 5 },
      caseCount: 0,
      passed: 0,
      failed: 0,
      partial: 0,
      errored: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null, costSource: 'unknown' },
      durationMs: 0,
      baselineRunId: null,
      isBaseline: false,
      reproducibility: null,
      error: null,
      triggeredBy: 'test',
    });
    expect(() => store.driver.run('UPDATE evaluation_runs SET dataset_version_id = ? WHERE id = ?', ['other', run.id])).toThrow(
      /immutable/,
    );
    // 计数与状态是可变的
    expect(() => store.runs.complete(run.id, {
      status: 'completed',
      counts: { caseCount: 1, passed: 1, failed: 0, partial: 0, errored: 0 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: null, costSource: 'unknown' },
      durationMs: 12,
    })).not.toThrow();
  });

  it('trace 证据层只允许 INSERT', () => {
    const { agent, version } = seedVersion();
    const ds = store.datasets.create({ name: 'D' });
    const dv = store.datasets.createVersion(ds.id);
    const tc = store.datasets.createCase(dv.id, { name: 'c', input: 'i', expectedOutcome: {} });
    const set = store.evaluatorSets.create({ name: 'S', members: [] });
    const run = store.runs.create({
      agentId: agent.id, agentVersionId: version.id, datasetId: ds.id, datasetVersionId: dv.id, evaluatorSetId: set.id,
      status: 'running', mode: 'full',
      runConfig: { concurrency: 1, timeoutMs: 1000, retries: 0, mode: 'full', seed: 1, promptPrivacy: 'store_full', smokeLimit: 5 },
      caseCount: 1, passed: 0, failed: 0, partial: 0, errored: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null, costSource: 'unknown' },
      durationMs: 0, baselineRunId: null, isBaseline: false, reproducibility: null, error: null, triggeredBy: 'test',
    });
    const [caseRun] = store.runs.createCaseRuns([{
      runId: run.id, testCaseId: tc.id, testCaseName: 'c', priority: 'normal', tags: [],
      status: 'passed', machineVerdict: 'passed', finalOutput: 'ok', outputJson: null, traceId: null,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: null, costSource: 'unknown' },
      latencyMs: 10, modelLatencyMs: 5, toolLatencyMs: 0, retrievalLatencyMs: 0, attempt: 1,
      failureCategory: null, error: null,
    }]);
    const trace = store.traces.createTrace({
      caseRunId: caseRun!.id, status: 'ok', stepCount: 0, totalDurationMs: 1, redactionPolicy: 'store_full',
    });
    const steps = store.traces.createSteps([{
      traceId: trace.id, seq: 0, type: 'output', name: 'final', status: 'ok',
      startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      durationMs: 1, summary: 'done', payload: {}, modelCallId: null, toolCallId: null, retrievalId: null,
    }]);
    expect(steps).toHaveLength(1);
    expect(() => store.driver.run('UPDATE trace_steps SET summary = ? WHERE id = ?', ['tampered', steps[0]!.id])).toThrow(
      /append-only/,
    );
    expect(() => store.driver.run('UPDATE traces SET status = ? WHERE id = ?', ['error', trace.id])).toThrow(/append-only/);
  });
});
