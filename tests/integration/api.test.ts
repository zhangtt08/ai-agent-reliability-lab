import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../apps/server/src/api/routes';

/**
 * API E2E-lite：不经过浏览器，直接对 HTTP 层走一遍主流程。
 * 浏览器级 E2E 见 e2e/run-e2e.mjs。
 */

describe('API 主流程', () => {
  let baseUrl: string;
  let close: () => void;
  let store: ReturnType<typeof createApp>['store'];

  beforeAll(async () => {
    const { app, store: s } = createApp({ memory: true });
    store = s;
    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}/api`;
        close = () => server.close();
        resolve();
      });
    });
  }, 60_000);

  afterAll(() => {
    close();
    store.close();
  });

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    const json = (await res.json()) as { ok: boolean; data: T; error?: string };
    if (!json.ok) throw new Error(`${path}: ${json.error}`);
    return json.data;
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as { ok: boolean; data: T; error?: string };
    if (!json.ok) throw new Error(`${path}: ${json.error}`);
    return json.data;
  }

  it('overview 返回种子数据统计', async () => {
    const overview = await get<{ totalAgents: number; totalDatasets: number }>('/overview');
    expect(overview.totalAgents).toBeGreaterThan(0);
    expect(overview.totalDatasets).toBe(3);
  });

  it('完整链路：启动评测 → 轮询任务 → run 详情 → case 详情（含 trace）', async () => {
    const agents = await get<{ name: string; versions: { id: number | string; version: number }[]; latestVersion: { id: string; version: number } | null }[]>('/agents');
    const stable = agents.find((a) => a.name === 'Support Agent')!;
    const v1 = stable.versions.find((v) => v.version === 1)! as unknown as { id: string };

    const sets = await get<{ id: string; name: string }[]>('/evaluator-sets');
    const full = sets.find((s) => s.name.startsWith('Full'))!;
    const datasets = await get<{ id: string; name: string; latestVersion: { id: string } | null }[]>('/datasets');
    const toolCalling = datasets.find((d) => d.name === 'Tool Calling')!;

    const started = await post<{ jobId: string }>('/runs', {
      agentVersionId: v1.id,
      datasetVersionId: toolCalling.latestVersion!.id,
      evaluatorSetId: full.id,
      runConfig: { mode: 'full', concurrency: 3, timeoutMs: 20000, seed: 42, promptPrivacy: 'store_full', smokeLimit: 5 },
    });
    expect(started.jobId).toBeTruthy();

    let job: { status: string; done: number; total: number };
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      job = await get<{ status: string; done: number; total: number }>(`/jobs/${started.jobId}`);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    }
    expect(job!.status).toBe('completed');
    expect(job!.done).toBe(job!.total);

    const runs = await get<{ id: string; status: string }[]>('/runs?limit=1');
    const detail = await get<{
      run: { status: string; caseCount: number };
      caseRuns: { id: string; status: string; traceId: string | null }[];
      metrics: { metricKey: string; value: number }[];
      gate: { result: string } | null;
    }>(`/runs/${runs[0]!.id}`);
    expect(detail.run.status).toBe('completed');
    expect(detail.caseRuns).toHaveLength(5);
    expect(detail.metrics.find((m) => m.metricKey === 'task_success_rate')).toBeDefined();
    expect(detail.gate?.result).toBe('PASS');

    const caseDetail = await get<{
      caseRun: { id: string; finalOutput: string };
      results: unknown[];
      trace: { steps: unknown[]; toolCalls: unknown[] } | null;
    }>(`/case-runs/${detail.caseRuns[0]!.id}`);
    expect(caseDetail.results.length).toBeGreaterThan(0);
    expect(caseDetail.trace?.steps.length ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it('人工复核走 HTTP 层也保持机器结果不覆盖', async () => {
    const runs = await get<{ id: string }[]>('/runs?limit=1');
    const detail = await get<{ caseRuns: { id: string; machineVerdict: string }[] }>(`/runs/${runs[0]!.id}`);
    const anyCase = detail.caseRuns[0]!;
    const review = await post<{ verdict: string; machineVerdict: string; overridesMachine: boolean }>(`/case-runs/${anyCase.id}/review`, {
      verdict: 'fail',
      comment: 'api review',
    });
    expect(review.verdict).toBe('fail');
    expect(review.machineVerdict).toBe(anyCase.machineVerdict);
  });

  it('搜索与对比接口可用', async () => {
    const hits = await get<{ kind: string }[]>(`/search?q=${encodeURIComponent('重复扣款')}`);
    expect(hits.length).toBeGreaterThan(0);
    const runs = await get<{ id: string }[]>('/runs?limit=1');
    const comparison = await get<{ metricDiffs: unknown[] }>(`/compare?base=${runs[0]!.id}&target=${runs[0]!.id}`);
    expect(comparison.metricDiffs.length).toBeGreaterThan(0);
  });

  it('错误处理：不存在的资源返回结构化错误而非 500 白屏', async () => {
    const res = await fetch(`${baseUrl}/runs/nonexistent`);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('不存在');
  });
});
