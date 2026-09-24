import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { openStore, type Store } from '@arl/persistence';
import {
  exportDatasetCsv,
  exportDatasetJson,
  parseDatasetCsv,
  parseDatasetJson,
} from '@arl/shared';
import { compareRuns, describeEvaluators, builtinRubrics } from '@arl/evaluation';
import { createProviderRegistry } from '@arl/providers';
import { executeEvaluationRun, analyzeRun } from '../services/run-pipeline';
import { seedIfEmpty } from '../services/seed';

export interface CreateAppOptions {
  dbPath?: string;
  memory?: boolean;
  /** 测试注入 */
  store?: Store;
}

export function createApp(options: CreateAppOptions = {}) {
  const store = options.store ?? openStore(options.memory ? { memory: true } : { path: options.dbPath });
  const seeded = seedIfEmpty(store);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const api = express.Router();

  const ok = (res: Response, data: unknown) => res.json({ ok: true, data });
  const fail = (res: Response, status: number, message: string, detail?: unknown) =>
    res.status(status).json({ ok: false, error: message, detail: detail === undefined ? null : detail });

  const wrap = (handler: (req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (err) {
        next(err);
      }
    };

  // ── Overview / Dashboard ─────────────────────────────────────
  api.get('/overview', wrap((_req, res) => {
    const trend = store.stats.passRateTrend(8);
    ok(res, {
      totalAgents: store.stats.totalAgents(),
      totalAgentVersions: store.stats.totalAgentVersions(),
      totalDatasets: store.stats.totalDatasets(),
      totalCases: store.stats.totalCases(),
      totalRuns: store.stats.totalRuns(),
      totalCaseRuns: store.stats.totalCaseRuns(),
      totalFailures: store.stats.totalFailures(),
      totalRegressions: store.stats.totalRegressions(),
      pendingReviews: store.stats.pendingReviews(),
      gateFailures: store.stats.gateFailures(),
      costLatency: store.stats.costAndLatencyAverages(),
      passRateTrend: trend.reverse(),
      topFailureCategories: store.stats.topFailureCategories(6),
      recentRuns: store.runs.list({ limit: 8 }).map((r) => ({ ...r })),
      recentFailingRuns: store.runs.list({ limit: 30 }).filter((r) => r.failed > 0).slice(0, 5),
    });
  }));

  // ── Agents ───────────────────────────────────────────────────
  api.get('/agents', wrap((_req, res) => {
    const agents = store.agents.list();
    const enriched = agents.map((agent) => {
      const versions = store.agentVersions.listByAgent(agent.id);
      const latest = versions[0];
      const latestRun = latest ? store.runs.latestForVersion(latest.id, { status: 'completed' }) : undefined;
      const metrics = latestRun ? store.evalResults.listMetrics(latestRun.id) : [];
      const passRate = metrics.find((m) => m.metricKey === 'task_success_rate')?.value ?? null;
      const decision = store.gates.latestDecisionForAgent(agent.id);
      const regressionCount = latestRun ? store.regressions.countByRun(latestRun.id) : 0;
      return {
        ...agent,
        versionCount: versions.length,
        // 提供全部版本：回归演示需要能同时选 V1 与 V2 跑同一数据集
        versions: versions.map((v) => ({ id: v.id, version: v.version, label: v.label, status: v.status, fixtureId: v.fixtureId, notes: v.notes })),
        latestVersion: latest ? { id: latest.id, version: latest.version, label: latest.label, status: latest.status, fixtureId: latest.fixtureId } : null,
        latestPassRate: passRate,
        latestRunId: latestRun?.id ?? null,
        latestRunAt: latestRun?.startedAt ?? null,
        releaseResult: decision?.result ?? null,
        regressionCount,
      };
    });
    ok(res, enriched);
  }));

  api.post('/agents', wrap((req, res) => {
    const { name, description, tags } = req.body ?? {};
    if (!name || typeof name !== 'string') return fail(res, 400, 'name 必填');
    const agent = store.agents.create({ name, description: description ?? '', tags: Array.isArray(tags) ? tags : [] });
    store.search.index('agent', agent.id, agent.name, agent.description, agent.tags);
    ok(res, agent);
  }));

  api.get('/agents/:id', wrap((req, res) => {
    const agent = store.agents.get(req.params.id!);
    if (!agent) return fail(res, 404, 'agent 不存在');
    const versions = store.agentVersions.listByAgent(agent.id).map((v) => {
      const prompt = store.prompts.get(v.promptVersionId);
      const runs = store.runs.list({ agentVersionId: v.id, limit: 5 });
      const latestRun = runs[0];
      const metrics = latestRun ? store.evalResults.listMetrics(latestRun.id) : [];
      return {
        ...v,
        prompt: prompt ? { id: prompt.id, version: prompt.version, label: prompt.label, hash: prompt.hash, systemPrompt: prompt.systemPrompt, taskPromptTemplate: prompt.taskPromptTemplate } : null,
        toolCount: v.tools.length,
        runs: runs.map((r) => ({ id: r.id, status: r.status, passed: r.passed, caseCount: r.caseCount, startedAt: r.startedAt, datasetVersionId: r.datasetVersionId })),
        metrics: metrics.map((m) => ({ key: m.metricKey, name: m.name, value: m.value, unit: m.unit, direction: m.direction, definition: m.definition })),
      };
    });
    const runs = store.runs.list({ agentId: agent.id, limit: 10 });
    const gates = store.gates.listGates(agent.id);
    const decisions = store.gates.listDecisions({ agentId: agent.id, limit: 10 });
    const promptVersions = store.prompts.listByAgent(agent.id);
    ok(res, { agent, versions, runs, gates, decisions, promptVersions });
  }));

  api.post('/agents/:id/versions', wrap((req, res) => {
    const agent = store.agents.get(req.params.id!);
    if (!agent) return fail(res, 404, 'agent 不存在');
    const { promptVersionId, modelConfig, runtimeConfig, tools, knowledge, label, notes, runtimeKind, fixtureId, status } = req.body ?? {};
    const version = store.agentVersions.create({
      agentId: agent.id,
      promptVersionId: promptVersionId ?? store.prompts.latest(agent.id)!.id,
      modelConfig: modelConfig ?? { provider: 'mock', model: 'mock-reliable-1', temperature: 0 },
      runtimeConfig: runtimeConfig ?? { maxSteps: 6, maxToolCalls: 3, timeoutMs: 8000 },
      tools: Array.isArray(tools) ? tools : [],
      knowledge: knowledge ?? null,
      label,
      notes,
      ...(runtimeKind ? { runtimeKind } : {}),
      ...(fixtureId ? { fixtureId } : {}),
      ...(status ? { status } : {}),
    });
    ok(res, version);
  }));

  api.patch('/agent-versions/:id/status', wrap((req, res) => {
    const { status, label, notes } = req.body ?? {};
    const updated = store.agentVersions.setStatus(req.params.id!, status, { label, notes });
    if (!updated) return fail(res, 404, 'version 不存在或未变更');
    ok(res, store.agentVersions.get(req.params.id!));
  }));

  api.post('/agents/:id/prompts', wrap((req, res) => {
    const { systemPrompt, taskPromptTemplate, label, notes } = req.body ?? {};
    if (!systemPrompt) return fail(res, 400, 'systemPrompt 必填');
    const prompt = store.prompts.create({
      agentId: req.params.id!,
      systemPrompt,
      taskPromptTemplate: taskPromptTemplate ?? '{{input}}',
      label,
      notes,
      createdBy: 'ui',
    });
    ok(res, prompt);
  }));

  api.get('/prompt-diff', wrap((req, res) => {
    const { a, b } = req.query as { a?: string; b?: string };
    if (!a || !b) return fail(res, 400, '需要 a 与 b 两个 prompt version id');
    const pa = store.prompts.get(a);
    const pb = store.prompts.get(b);
    if (!pa || !pb) return fail(res, 404, 'prompt version 不存在');
    ok(res, {
      a: { id: pa.id, version: pa.version, hash: pa.hash, systemPrompt: pa.systemPrompt, taskPromptTemplate: pa.taskPromptTemplate },
      b: { id: pb.id, version: pb.version, hash: pb.hash, systemPrompt: pb.systemPrompt, taskPromptTemplate: pb.taskPromptTemplate },
      hashChanged: pa.hash !== pb.hash,
    });
  }));

  // ── Datasets ─────────────────────────────────────────────────
  api.get('/datasets', wrap((_req, res) => {
    const datasets = store.datasets.list().map((d) => {
      const versions = store.datasets.listVersions(d.id);
      const latest = versions[0];
      return {
        ...d,
        versionCount: versions.length,
        latestVersion: latest ? { id: latest.id, version: latest.version, status: latest.status, caseCount: latest.caseCount, isGolden: latest.isGolden } : null,
      };
    });
    ok(res, datasets);
  }));

  api.post('/datasets', wrap((req, res) => {
    const { name, description, tags, isGolden } = req.body ?? {};
    if (!name) return fail(res, 400, 'name 必填');
    const dataset = store.datasets.create({ name, description: description ?? '', tags: tags ?? [], isGolden: Boolean(isGolden) });
    const version = store.datasets.createVersion(dataset.id, { status: 'draft', notes: '初始版本' });
    store.search.index('dataset', dataset.id, dataset.name, dataset.description, dataset.tags);
    ok(res, { ...dataset, version });
  }));

  api.get('/datasets/:id', wrap((req, res) => {
    const dataset = store.datasets.get(req.params.id!);
    if (!dataset) return fail(res, 404, 'dataset 不存在');
    const versions = store.datasets.listVersions(dataset.id);
    const versionId = (req.query.versionId as string) || versions[0]?.id;
    const cases = versionId ? store.datasets.listCases(versionId, { limit: 10_000 }) : [];
    ok(res, { dataset, versions, activeVersionId: versionId ?? null, cases });
  }));

  api.post('/datasets/:id/versions', wrap((req, res) => {
    const { forkFrom, notes } = req.body ?? {};
    const dataset = store.datasets.get(req.params.id!);
    if (!dataset) return fail(res, 404, 'dataset 不存在');
    if (forkFrom) {
      const forked = store.datasets.forkVersion(forkFrom, { notes: notes ?? `fork 自 ${forkFrom}` });
      return ok(res, forked);
    }
    ok(res, store.datasets.createVersion(dataset.id, { notes: notes ?? '' }));
  }));

  api.post('/dataset-versions/:id/freeze', wrap((req, res) => {
    const { status } = req.body ?? {};
    const version = store.datasets.freezeVersion(req.params.id!, { status: status === 'golden' ? 'golden' : 'published' });
    ok(res, version);
  }));

  api.post('/dataset-versions/:id/cases', wrap((req, res) => {
    const { name, input, context, tags, priority, expectedOutcome, notes, metadata } = req.body ?? {};
    if (!name || !input) return fail(res, 400, 'name 与 input 必填');
    try {
      const testCase = store.datasets.createCase(req.params.id!, {
        name, input, context, tags, priority, expectedOutcome: expectedOutcome ?? {}, notes, metadata,
      });
      store.search.index('test_case', testCase.id, testCase.name, testCase.input, testCase.tags);
      ok(res, testCase);
    } catch (err) {
      fail(res, 409, err instanceof Error ? err.message : String(err));
    }
  }));

  api.patch('/test-cases/:id', wrap((req, res) => {
    const patch = req.body ?? {};
    try {
      const changes = store.datasets.updateCase(req.params.id!, patch);
      if (!changes) return ok(res, store.datasets.getCase(req.params.id!));
      ok(res, store.datasets.getCase(req.params.id!));
    } catch (err) {
      fail(res, 409, err instanceof Error ? err.message : String(err));
    }
  }));

  api.delete('/test-cases/:id', wrap((req, res) => {
    try {
      const changes = store.datasets.deleteCase(req.params.id!);
      ok(res, { deleted: changes });
    } catch (err) {
      fail(res, 409, err instanceof Error ? err.message : String(err));
    }
  }));

  api.post('/datasets/:id/import', wrap((req, res) => {
    const { format, content } = req.body ?? {};
    if (!content) return fail(res, 400, 'content 必填');
    const parsed = format === 'csv' ? parseDatasetCsv(content) : parseDatasetJson(content);
    const version = store.datasets.latestDraft(req.params.id!);
    if (!version) return fail(res, 409, '没有可写的 draft 版本，请先 fork 新版本');
    let imported = 0;
    const skipped: string[] = [];
    for (const c of parsed.cases) {
      try {
        store.datasets.createCase(version.id, c);
        imported += 1;
      } catch (err) {
        skipped.push(`${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    ok(res, { imported, versionId: version.id, totalRows: parsed.totalRows, errors: parsed.errors, skipped });
  }));

  api.get('/datasets/:id/export', wrap((req, res) => {
    const versionId = req.query.versionId as string;
    const format = (req.query.format as string) || 'json';
    const version = versionId ? store.datasets.getVersion(versionId) : store.datasets.latestVersion(req.params.id!);
    if (!version) return fail(res, 404, 'dataset version 不存在');
    const cases = store.datasets.listCases(version.id, { limit: 100_000 });
    const content = format === 'csv' ? exportDatasetCsv(cases) : exportDatasetJson(cases);
    ok(res, {
      filename: `${version.datasetId}-v${version.version}.${format}`,
      mime: format === 'csv' ? 'text/csv' : 'application/json',
      content,
    });
  }));

  // ── Evaluators / Rubrics / Providers ─────────────────────────
  api.get('/evaluators', wrap((_req, res) => ok(res, describeEvaluators())));
  api.get('/rubrics', wrap((_req, res) => ok(res, store.evaluatorSets.listRubrics().length > 0 ? store.evaluatorSets.listRubrics() : builtinRubrics())));
  api.get('/evaluator-sets', wrap((_req, res) => ok(res, store.evaluatorSets.list())));

  api.get('/providers', wrap((_req, res) => {
    const registry = createProviderRegistry();
    ok(res, registry.list());
  }));

  // ── Runs ─────────────────────────────────────────────────────
  api.post('/runs', wrap((req, res) => {
    const { agentVersionId, datasetVersionId, evaluatorSetId, runConfig, baselineRunId, gateId } = req.body ?? {};
    if (!agentVersionId || !datasetVersionId || !evaluatorSetId) {
      return fail(res, 400, 'agentVersionId / datasetVersionId / evaluatorSetId 必填');
    }
    // 后台执行：executeEvaluationRun 的同步段会先创建 run + job 记录，随后逐 case 推进
    void executeEvaluationRun(store, {
      agentVersionId,
      datasetVersionId,
      evaluatorSetId,
      runConfig,
      baselineRunId: baselineRunId ?? null,
      gateId: gateId ?? null,
      triggeredBy: 'api',
    }).catch((err) => {
      console.error('[run] failed:', err instanceof Error ? err.message : String(err));
    });

    const job = store.jobs.list({ limit: 1 }).find((j) => j.type === 'evaluation_run' && j.status === 'running') ?? store.jobs.list({ limit: 1 })[0] ?? null;
    ok(res, { jobId: job?.id ?? null, runId: job?.runId ?? null, message: '评测已启动，通过 /api/jobs/:id 轮询进度' });
  }));

  api.get('/jobs/:id', wrap((req, res) => {
    const job = store.jobs.get(req.params.id!);
    if (!job) return fail(res, 404, 'job 不存在');
    ok(res, job);
  }));

  api.post('/jobs/:id/cancel', wrap((req, res) => {
    const changes = store.jobs.cancel(req.params.id!);
    ok(res, { cancelled: changes > 0 });
  }));

  api.get('/runs', wrap((req, res) => {
    const { agentId, status, limit } = req.query as { agentId?: string; status?: string; limit?: string };
    const runs = store.runs.list({
      agentId,
      ...(status ? { status: status as never } : {}),
      limit: limit ? Number(limit) : 30,
    }).map((run) => {
      const agent = store.agents.get(run.agentId);
      const version = store.agentVersions.get(run.agentVersionId);
      const dataset = store.datasets.get(run.datasetId);
      const datasetVersion = store.datasets.getVersion(run.datasetVersionId);
      const decision = store.gates.latestDecisionForRun(run.id);
      const metrics = store.evalResults.listMetrics(run.id);
      return {
        ...run,
        agentName: agent?.name ?? run.agentId,
        versionLabel: version ? `v${version.version}` : run.agentVersionId,
        datasetName: dataset?.name ?? run.datasetId,
        datasetVersion: datasetVersion?.version ?? 0,
        gateResult: decision?.result ?? null,
        passRate: metrics.find((m) => m.metricKey === 'task_success_rate')?.value ?? null,
        avgLatency: metrics.find((m) => m.metricKey === 'avg_latency_ms')?.value ?? null,
      };
    });
    ok(res, runs);
  }));

  api.get('/runs/:id', wrap((req, res) => {
    const run = store.runs.get(req.params.id!);
    if (!run) return fail(res, 404, 'run 不存在');
    const caseRuns = store.runs.listCaseRuns(run.id, { limit: 1000 });
    const metrics = store.evalResults.listMetrics(run.id);
    const decision = store.gates.latestDecisionForRun(run.id);
    const suggestions = store.suggestions.listByRun(run.id);
    const failures = store.failures.listByRun(run.id, { limit: 500 });
    const agent = store.agents.get(run.agentId);
    const version = store.agentVersions.get(run.agentVersionId);
    const dataset = store.datasets.get(run.datasetId);
    const datasetVersion = store.datasets.getVersion(run.datasetVersionId);
    const job = store.jobs.list({ limit: 50 }).find((j) => j.runId === run.id) ?? null;
    ok(res, {
      run,
      agent: agent ? { id: agent.id, name: agent.name } : null,
      version: version ? { id: version.id, version: version.version, label: version.label, fixtureId: version.fixtureId } : null,
      dataset: dataset ? { id: dataset.id, name: dataset.name } : null,
      datasetVersion: datasetVersion ? { id: datasetVersion.id, version: datasetVersion.version } : null,
      metrics,
      caseRuns,
      failures,
      gate: decision,
      suggestions,
      job,
    });
  }));

  api.post('/runs/:id/baseline', wrap((req, res) => {
    store.runs.setBaseline(req.params.id!, true);
    ok(res, { ok: true });
  }));

  api.post('/runs/:id/analyze', wrap((req, res) => {
    const { baselineRunId, gateId } = req.body ?? {};
    const outcome = analyzeRun(store, req.params.id!, { baselineRunId: baselineRunId ?? null, gateId: gateId ?? null });
    ok(res, { regressions: outcome.regressions.length, gate: outcome.gateDecision, suggestionCount: outcome.suggestionCount });
  }));

  api.get('/runs/:id/export', wrap((req, res) => {
    const run = store.runs.get(req.params.id!);
    if (!run) return fail(res, 404, 'run 不存在');
    const caseRuns = store.runs.listCaseRuns(run.id, { limit: 10_000 });
    const metrics = store.evalResults.listMetrics(run.id);
    const results = store.evalResults.listByRun(run.id);
    const failures = store.failures.listByRun(run.id, { limit: 10_000 });
    const decision = store.gates.latestDecisionForRun(run.id);
    const content = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        run,
        reproducibility: run.reproducibility,
        metrics,
        caseRuns,
        evaluationResults: results,
        failures,
        releaseDecision: decision,
      },
      null,
      2,
    );
    ok(res, { filename: `run-${run.id}.json`, mime: 'application/json', content });
  }));

  // ── Case detail / Trace / Review ─────────────────────────────
  api.get('/case-runs/:id', wrap((req, res) => {
    const caseRun = store.runs.getCaseRun(req.params.id!);
    if (!caseRun) return fail(res, 404, 'case run 不存在');
    const results = store.evalResults.listByCaseRun(caseRun.id);
    const failures = store.failures.listByCaseRun(caseRun.id);
    const reviews = store.reviews.listByCaseRun(caseRun.id);
    const testCase = store.datasets.getCase(caseRun.testCaseId);
    const trace = caseRun.traceId ? store.traces.getBundle(caseRun.traceId) : null;
    ok(res, { caseRun, results, failures, reviews, testCase, trace });
  }));

  api.post('/case-runs/:id/review', wrap((req, res) => {
    const caseRun = store.runs.getCaseRun(req.params.id!);
    if (!caseRun) return fail(res, 404, 'case run 不存在');
    const { verdict, comment, reviewer, failureCategory } = req.body ?? {};
    if (!['pass', 'fail', 'partial'].includes(verdict)) return fail(res, 400, 'verdict 必须是 pass / fail / partial');
    const machineResults = store.evalResults.listByCaseRun(caseRun.id).map((r) => ({ ...r }));
    const review = store.reviews.create({
      caseRunId: caseRun.id,
      runId: caseRun.runId,
      verdict,
      comment: comment ?? '',
      reviewer: reviewer || 'local-reviewer',
      failureCategory: failureCategory ?? null,
      machineVerdict: caseRun.machineVerdict,
      machineSnapshot: machineResults,
    });
    const humanToStatus = { pass: 'passed', fail: 'failed', partial: 'partial' } as const;
    store.runs.updateCaseRun(caseRun.id, { status: humanToStatus[verdict as keyof typeof humanToStatus] });
    ok(res, review);
  }));

  api.get('/reviews/pending', wrap((req, res) => {
    const limit = Number((req.query.limit as string) ?? 50);
    const pending = store.reviews.pendingQueue(limit).map((item) => {
      const caseRun = store.runs.getCaseRun(item.caseRunId);
      return { ...item, caseRun, results: caseRun ? store.evalResults.listByCaseRun(caseRun.id) : [] };
    });
    ok(res, { pending, agreement: store.reviews.agreementStats() });
  }));

  // ── Compare ──────────────────────────────────────────────────
  api.get('/compare', wrap((req, res) => {
    const { base, target } = req.query as { base?: string; target?: string };
    if (!base || !target) return fail(res, 400, '需要 base 与 target 两个 run id');
    const baseRun = store.runs.get(base);
    const targetRun = store.runs.get(target);
    if (!baseRun || !targetRun) return fail(res, 404, 'run 不存在');
    const baseCaseRuns = store.runs.listCaseRuns(base, { limit: 1000 });
    const targetCaseRuns = store.runs.listCaseRuns(target, { limit: 1000 });
    const comparison = compareRuns(
      { runId: base, label: `${base}`, caseRuns: baseCaseRuns, metrics: store.evalResults.listMetrics(base) },
      { runId: target, label: `${target}`, caseRuns: targetCaseRuns, metrics: store.evalResults.listMetrics(target) },
    );
    const label = (runId: string, runs: typeof baseRun[]) => {
      const run = store.runs.get(runId)!;
      const version = store.agentVersions.get(run.agentVersionId);
      const agent = store.agents.get(run.agentId);
      const datasetVersion = store.datasets.getVersion(run.datasetVersionId);
      return {
        runId,
        agentName: agent?.name ?? '',
        version: version?.version ?? 0,
        startedAt: run.startedAt,
        datasetVersion: datasetVersion?.version ?? 0,
      };
    };
    ok(res, {
      base: label(base, [baseRun]),
      target: label(target, [targetRun]),
      metricDiffs: comparison.metricDiffs,
      fixedCases: comparison.fixedCases,
      regressedCases: comparison.regressedCases,
      bothPassed: comparison.bothPassed.length,
      bothFailed: comparison.bothFailed.length,
      changedFailures: comparison.changedFailures,
      regressions: comparison.regressions,
    });
  }));

  api.get('/runs/:id/comparison', wrap((req, res) => {
    const comparisons = store.regressions.listByTarget(req.params.id!);
    ok(res, comparisons);
  }));

  // ── Failures / Suggestions / Gates ───────────────────────────
  api.get('/failures', wrap((req, res) => {
    const { category, agentId, runId, limit } = req.query as Record<string, string | undefined>;
    const runs = store.runs.list({ agentId, limit: 50 });
    const targetRuns = runId ? runs.filter((r) => r.id === runId) : runs;
    const rows: Record<string, unknown>[] = [];
    for (const run of targetRuns) {
      const failures = store.failures.listByRun(run.id, { ...(category ? { category: category as never } : {}), limit: 200 });
      for (const failure of failures) {
        const caseRun = store.runs.getCaseRun(failure.caseRunId);
        const version = store.agentVersions.get(run.agentVersionId);
        rows.push({
          ...failure,
          runId: run.id,
          agentName: store.agents.get(run.agentId)?.name ?? '',
          version: version?.version ?? 0,
          testCaseName: caseRun?.testCaseName ?? '',
          priority: caseRun?.priority ?? 'normal',
          tags: caseRun?.tags ?? [],
        });
      }
    }
    ok(res, rows.slice(0, limit ? Number(limit) : 200));
  }));

  api.get('/suggestions', wrap((req, res) => {
    const { runId } = req.query as { runId?: string };
    ok(res, runId ? store.suggestions.listByRun(runId) : store.suggestions.listAll(100));
  }));

  api.post('/suggestions/:id/status', wrap((req, res) => {
    const { status } = req.body ?? {};
    store.suggestions.updateStatus(req.params.id!, status);
    ok(res, { ok: true });
  }));

  api.get('/prompt-candidates', wrap((req, res) => {
    const { agentId } = req.query as { agentId?: string };
    ok(res, agentId ? store.suggestions.listPromptCandidates(agentId) : []);
  }));

  api.post('/prompt-candidates/:id/adopt', wrap((req, res) => {
    const candidate = store.suggestions.getPromptCandidate(req.params.id!);
    if (!candidate) return fail(res, 404, 'candidate 不存在');
    const prompt = store.prompts.create({
      agentId: candidate.agentId,
      systemPrompt: candidate.systemPrompt,
      taskPromptTemplate: candidate.taskPromptTemplate,
      label: `候选采纳（${candidate.id.slice(-6)}）`,
      notes: `由 Prompt Candidate ${candidate.id} 显式采纳生成`,
      createdBy: 'ui-adopt',
    });
    store.suggestions.adoptPromptCandidate(candidate.id, prompt.id);
    ok(res, { promptVersion: prompt });
  }));

  api.get('/gates', wrap((req, res) => {
    const { agentId } = req.query as { agentId?: string };
    const gates = store.gates.listGates(agentId);
    ok(res, gates.map((g) => {
      const decisions = store.gates.listDecisions({ agentId: g.agentId, limit: 20 }).filter((d) => d.gateId === g.id).slice(0, 5);
      return { ...g, recentDecisions: decisions };
    }));
  }));

  api.post('/gates/:id/evaluate', wrap((req, res) => {
    const { runId } = req.body ?? {};
    if (!runId) return fail(res, 400, 'runId 必填');
    const outcome = analyzeRun(store, runId, { gateId: req.params.id!, generateSuggestions: false });
    ok(res, outcome.gateDecision);
  }));

  api.get('/release-decisions', wrap((req, res) => {
    const { agentId, limit } = req.query as { agentId?: string; limit?: string };
    const decisions = store.gates.listDecisions({ agentId, limit: limit ? Number(limit) : 20 }).map((d) => {
      const agent = store.agents.get(d.agentId);
      const version = store.agentVersions.get(d.agentVersionId);
      const run = store.runs.get(d.runId);
      return { ...d, agentName: agent?.name ?? '', version: version?.version ?? 0, runStatus: run?.status ?? '' };
    });
    ok(res, decisions);
  }));

  // ── Search / Stats ───────────────────────────────────────────
  api.get('/search', wrap((req, res) => {
    const q = (req.query.q as string) ?? '';
    const kinds = (req.query.kinds as string | undefined)?.split(',').filter(Boolean);
    ok(res, store.search.search(q, { kinds, limit: 30 }));
  }));

  api.post('/seed', wrap((_req, res) => {
    const summary = seedIfEmpty(store);
    ok(res, summary ?? { message: '已有数据，跳过种子' });
  }));

  app.use('/api', api);

  // 统一错误处理：不能白屏，也不能吞异常
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api:error]', message);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: message });
    }
  });

  return { app, store, seeded };
}
