import {
  RunConfigSchema,
  contentHash,
  ids,
  nowIso,
  stableStringify,
  type CaseRun,
  type CaseRunStatus,
  type EvaluationResult,
  type EvaluationRun,
  type EvaluatorConfig,
  type Failure,
  type MetricResult,
  type Regression,
  type ReleaseDecision,
  type RunConfigInput,
  type TestCase,
} from '@arl/shared';
import type { Store } from '@arl/persistence';
import {
  MOCK_JUDGE_FIXTURE_ID,
  createMockModelProvider,
  createProviderRegistry,
  resolveProvider,
  type ModelProvider,
} from '@arl/providers';
import {
  addUsage,
  createFixtureToolExecutor,
  createRuntimeRegistry,
  defaultKnowledgeDocuments,
  resolveRuntime,
  runWithHardTimeout,
  type ToolExecutor,
} from '@arl/runtime';
import {
  BUILTIN_EVALUATORS,
  classifyFailure,
  compareRuns,
  computeMetrics,
  defaultRubric,
  evaluateReleaseGate,
  evaluatorByKey,
  generateSuggestions,
  judgeCase,
  llmJudgeEvaluator,
  buildPromptCandidate,
  type EvaluationContext,
  type EvaluationDraft,
  type Evaluator,
} from '@arl/evaluation';

const PLATFORM_VERSION = '0.1.0';

export interface ExecuteRunOptions {
  agentVersionId: string;
  datasetVersionId: string;
  evaluatorSetId: string;
  runConfig?: RunConfigInput;
  provider?: ModelProvider;
  baselineRunId?: string | null;
  triggeredBy?: string;
  /** 取消信号：返回 true 时停止后续 case */
  shouldCancel?: () => boolean;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface ExecuteRunResult {
  run: EvaluationRun;
  caseRuns: CaseRun[];
  results: EvaluationResult[];
  failures: Failure[];
  metrics: MetricResult[];
  regressions: Regression[];
  gateDecision: ReleaseDecision | null;
  suggestionCount: number;
}

/** 有限并发池：避免一次性打爆 provider（规格明确禁止「一口气并发 500 个 case」） */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (shouldStop?.()) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
}

function evaluatorFor(config: EvaluatorConfig): Evaluator | undefined {
  if (config.evaluatorKey === llmJudgeEvaluator.key) return llmJudgeEvaluator;
  return evaluatorByKey(config.evaluatorKey);
}

export interface AnalysisOutcome {
  metrics: MetricResult[];
  failures: Failure[];
  regressions: Regression[];
  gateDecision: ReleaseDecision | null;
  suggestionCount: number;
}

/**
 * 评测运行主流程。
 *
 * 顺序：装载 → 建 run → 逐 case 执行（runtime → trace → evaluator → judge → failure）→ 聚合指标 → 回归 → 门禁 → 建议
 * 每完成一个 case 立刻落库，因此中途中断也能看到已完成的部分（不丢证据）。
 */
export async function executeEvaluationRun(store: Store, options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const version = store.agentVersions.get(options.agentVersionId);
  if (!version) throw new Error(`agent version ${options.agentVersionId} 不存在`);
  const prompt = store.prompts.get(version.promptVersionId);
  if (!prompt) throw new Error(`prompt version ${version.promptVersionId} 不存在`);
  const agent = store.agents.get(version.agentId);
  if (!agent) throw new Error(`agent ${version.agentId} 不存在`);
  const datasetVersion = store.datasets.getVersion(options.datasetVersionId);
  if (!datasetVersion) throw new Error(`dataset version ${options.datasetVersionId} 不存在`);
  const dataset = store.datasets.get(datasetVersion.datasetId);
  if (!dataset) throw new Error(`dataset ${datasetVersion.datasetId} 不存在`);

  const evaluatorSet = store.evaluatorSets.get(options.evaluatorSetId);
  if (!evaluatorSet) throw new Error(`evaluator set ${options.evaluatorSetId} 不存在`);

  const runConfig = RunConfigSchema.parse(options.runConfig ?? {});
  const allCases = store.datasets.listCases(datasetVersion.id, { enabled: true, limit: 100_000 });
  const priorityRank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const orderedCases = [...allCases].sort((a, b) => priorityRank[a.priority]! - priorityRank[b.priority]!);
  const cases = runConfig.mode === 'smoke' ? orderedCases.slice(0, runConfig.smokeLimit) : orderedCases;

  const registry = createProviderRegistry();
  const providerId = version.modelConfig.provider;
  let provider: ModelProvider;
  if (options.provider) {
    provider = options.provider;
  } else if (providerId === 'mock') {
    provider = registry.defaultProvider();
  } else {
    provider = resolveProvider(registry, providerId);
  }

  const startedAt = nowIso();
  const run = store.runs.create({
    agentId: agent.id,
    agentVersionId: version.id,
    datasetId: dataset.id,
    datasetVersionId: datasetVersion.id,
    evaluatorSetId: evaluatorSet.id,
    status: 'queued',
    mode: runConfig.mode,
    runConfig,
    caseCount: cases.length,
    triggeredBy: options.triggeredBy ?? 'local',
    baselineRunId: options.baselineRunId ?? null,
    reproducibility: {
      agentVersionId: version.id,
      agentVersion: version.version,
      promptVersionId: prompt.id,
      promptHash: prompt.hash,
      datasetVersionId: datasetVersion.id,
      datasetVersion: datasetVersion.version,
      datasetContentHash: datasetVersion.contentHash,
      evaluatorSetId: evaluatorSet.id,
      evaluatorKeys: evaluatorSet.members.map((m) => m.evaluatorKey),
      evaluatorVersions: Object.fromEntries(
        evaluatorSet.members.map((m) => [m.evaluatorKey, evaluatorFor(m)?.version ?? 'unknown']),
      ),
      modelConfig: version.modelConfig,
      runtimeConfig: version.runtimeConfig,
      runConfig,
      seed: runConfig.seed,
      platformVersion: PLATFORM_VERSION,
      startedAt,
    },
  });

  const job = store.jobs.create({
    type: 'evaluation_run',
    runId: run.id,
    total: cases.length,
    message: `评测启动：${agent.name} v${version.version} × ${dataset.name} v${datasetVersion.version}`,
    payload: { runId: run.id, mode: runConfig.mode },
  });
  store.jobs.markRunning(job.id, cases.length, 'running');
  store.runs.markRunning(run.id);

  const runtimeRegistry = createRuntimeRegistry();
  const runtime = resolveRuntime(version, runtimeRegistry);
  const runSignature = `${run.id}:${contentHash(stableStringify({ a: version.id, d: datasetVersion.id, s: runConfig.seed }))}`;
  const knowledge = version.knowledge?.enabled ? version.knowledge.documents : defaultKnowledgeDocuments();
  const executor: ToolExecutor = createFixtureToolExecutor({ knowledge, latencyScale: 0.35, runSignature });

  const caseRuns: CaseRun[] = [];
  const allResults: EvaluationResult[] = [];
  const allFailures: Failure[] = [];
  const toolCallStats = { total: 0, errors: 0 };
  let usage: EvaluationRun['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null, costSource: 'unknown' };
  let done = 0;
  let cancelled = false;

  await runPool(
    cases,
    runConfig.concurrency,
    async (testCase) => {
      if (options.shouldCancel?.() || store.jobs.isCancelled(job.id)) {
        cancelled = true;
        return;
      }

      const result = await runWithHardTimeout(
        runtime,
        { version, prompt, testCase: { id: testCase.id, name: testCase.name, input: testCase.input, context: testCase.context, metadata: testCase.metadata, tags: testCase.tags }, provider, executor, runSignature, timeoutMs: runConfig.timeoutMs },
        runConfig.timeoutMs,
      );

      // 1) 先落 caseRun（trace 有外键约束，必须后建再回填）
      const [caseRun] = store.runs.createCaseRuns([
        {
          runId: run.id,
          testCaseId: testCase.id,
          testCaseName: testCase.name,
          priority: testCase.priority,
          tags: testCase.tags,
          status: 'passed',
          machineVerdict: 'passed',
          finalOutput: result.finalOutput,
          outputJson: result.outputJson,
          traceId: null,
          usage: result.usage,
          latencyMs: result.durationMs,
          modelLatencyMs: result.modelLatencyMs,
          toolLatencyMs: result.toolLatencyMs,
          retrievalLatencyMs: result.retrievalLatencyMs,
          attempt: 1,
          failureCategory: null,
          error: result.error,
        },
      ]);
      // Trace 证据一次性落库（单事务；steps 与 model/tool/retrieval 互引用，靠延迟外键在 commit 时统一校验）
      const trace = store.traces.createBundle({
        trace: {
          // 必须沿用 collector 生成的 traceId：steps / modelCalls / toolCalls / retrievals 都引用它
          id: result.bundle.trace.id,
          caseRunId: caseRun!.id,
          status: result.bundle.trace.status,
          stepCount: result.bundle.trace.stepCount,
          totalDurationMs: result.bundle.trace.totalDurationMs,
          redactionPolicy: result.bundle.trace.redactionPolicy,
          createdAt: result.bundle.trace.createdAt,
        },
        steps: result.bundle.steps,
        modelCalls: result.bundle.modelCalls,
        toolCalls: result.bundle.toolCalls,
        retrievals: result.bundle.retrievals,
      });
      store.runs.updateCaseRun(caseRun!.id, { traceId: trace.id });

      toolCallStats.total += result.bundle.toolCalls.length;
      toolCallStats.errors += result.bundle.toolCalls.filter((c) => c.status !== 'ok').length;
      usage = addUsage(usage, result.usage);

      // 2) 逐 evaluator 判定
      const drafts: EvaluationDraft[] = [];
      for (const member of evaluatorSet.members) {
        if (!member.enabled) continue;
        const evaluator = evaluatorFor(member);
        if (!evaluator) {
          drafts.push({
            evaluatorKey: member.evaluatorKey,
            evaluatorVersion: 'unknown',
            name: member.evaluatorKey,
            category: 'process',
            status: 'error',
            score: 0,
            severity: member.severity,
            weight: member.weight,
            blocking: member.blocking,
            message: `未注册的 evaluator：${member.evaluatorKey}`,
            details: {},
            evidence: [],
            durationMs: 0,
          });
          continue;
        }
        const ctx: EvaluationContext = {
          testCase,
          caseRun: caseRun!,
          bundle: result.bundle,
          steps: result.bundle.steps,
          toolCalls: result.bundle.toolCalls,
          retrievals: result.bundle.retrievals,
          modelCalls: result.bundle.modelCalls,
          provider,
          rubric: defaultRubric(),
          expectedDocIds: Array.isArray(testCase.metadata['expectedDocIds']) ? (testCase.metadata['expectedDocIds'] as string[]) : [],
          config: member.config ?? {},
          severity: member.severity,
          weight: member.weight,
          blocking: member.blocking,
        };
        if (!evaluator.appliesTo(ctx)) {
          drafts.push({
            evaluatorKey: evaluator.key,
            evaluatorVersion: evaluator.version,
            name: evaluator.name,
            category: evaluator.category,
            status: 'skipped',
            score: 0,
            severity: member.severity,
            weight: member.weight,
            blocking: member.blocking,
            message: '该检查项对当前用例不适用（用例未声明对应期望）',
            details: {},
            evidence: [],
            durationMs: 0,
          });
          continue;
        }
        const startedEvaluatorAt = Date.now();
        try {
          const draft = await evaluator.evaluate(ctx);
          drafts.push({ ...draft, durationMs: draft.durationMs || Date.now() - startedEvaluatorAt });
        } catch (err) {
          drafts.push({
            evaluatorKey: evaluator.key,
            evaluatorVersion: evaluator.version,
            name: evaluator.name,
            category: evaluator.category,
            status: 'error',
            score: 0,
            severity: member.severity,
            weight: member.weight,
            blocking: member.blocking,
            message: `evaluator 执行异常：${err instanceof Error ? err.message : String(err)}`,
            details: {},
            evidence: [],
            durationMs: Date.now() - startedEvaluatorAt,
          });
        }
      }

      const judge = judgeCase(drafts, evaluatorSet.judgeMode, evaluatorSet.passThreshold);
      const persistedResults = store.evalResults.createMany(drafts.map((d) => ({ ...d, caseRunId: caseRun!.id })));
      allResults.push(...persistedResults);

      store.runs.updateCaseRun(caseRun!.id, {
        status: judge.verdict,
        machineVerdict: judge.verdict,
      });

      // 3) 失败归因
      if (judge.verdict !== 'passed') {
        const classification = classifyFailure({
          caseRun: { ...caseRun!, status: judge.verdict },
          testCase,
          results: persistedResults.map((r) => ({ evaluatorKey: r.evaluatorKey, status: r.status, message: r.message, evidence: r.evidence, details: r.details })),
          toolCalls: result.bundle.toolCalls,
          retrievals: result.bundle.retrievals,
          steps: result.bundle.steps,
          loopGuarded: result.bundle.steps.some((s) => s.type === 'decision' && s.name === 'loop_guard_tripped'),
        });
        if (classification) {
          const failure = store.failures.create({
            caseRunId: caseRun!.id,
            runId: run.id,
            category: classification.category,
            confidence: classification.confidence,
            source: classification.source,
            explanation: classification.explanation,
            evidence: classification.evidence,
          });
          allFailures.push(failure);
          store.runs.updateCaseRun(caseRun!.id, { failureCategory: classification.category });
        }
      }

      const finalCaseRun = store.runs.getCaseRun(caseRun!.id)!;
      caseRuns.push(finalCaseRun);
      store.search.index('case', finalCaseRun.id, testCase.name, `${testCase.input} ${finalCaseRun.finalOutput.slice(0, 500)}`, testCase.tags);

      done += 1;
      store.jobs.progress(job.id, done, cases.length, `已完成 ${done}/${cases.length}：${testCase.name}`);
      options.onProgress?.(done, cases.length, testCase.name);
    },
    () => options.shouldCancel?.() || store.jobs.isCancelled(job.id) || cancelled,
  );

  // 4) 聚合
  const counts = store.runs.statusCounts(run.id);
  const summary = {
    caseCount: caseRuns.length,
    passed: counts['passed'] ?? 0,
    failed: counts['failed'] ?? 0,
    partial: counts['partial'] ?? 0,
    errored: (counts['error'] ?? 0) + (counts['timeout'] ?? 0) + (counts['cancelled'] ?? 0),
  };

  const persistMetricRows = store.runs.listCaseRuns(run.id, { limit: 100_000 });
  const persistResults = store.evalResults.listByRun(run.id);
  const metrics = computeMetrics({
    caseRuns: persistMetricRows,
    results: persistResults,
    failures: allFailures,
    toolCallStats,
  }).map((m) => ({ ...m, runId: run.id }));
  store.evalResults.saveMetrics(run.id, metrics);

  const durationMs = persistMetricRows.reduce((sum, c) => sum + c.latencyMs, 0);
  store.runs.complete(run.id, {
    status: cancelled ? 'cancelled' : 'completed',
    counts: summary,
    usage,
    durationMs,
    error: null,
  });

  // 5) 回归 / 门禁 / 建议
  const analysis = analyzeRun(store, run.id, { metrics, failures: allFailures });

  store.jobs.finish(job.id, { status: cancelled ? 'cancelled' : 'completed', runId: run.id });
  store.search.index('run', run.id, `${agent.name} v${version.version} · ${dataset.name}`, `通过率 ${(metrics.find((m) => m.metricKey === 'task_success_rate')?.value ?? 0) * 100}%`, [agent.name]);

  return {
    run: store.runs.get(run.id)!,
    caseRuns: persistMetricRows,
    results: persistResults,
    failures: allFailures,
    metrics,
    regressions: analysis.regressions,
    gateDecision: analysis.gateDecision,
    suggestionCount: analysis.suggestionCount,
  };
}

export interface AnalyzeRunOptions {
  metrics?: MetricResult[];
  failures?: Failure[];
  baselineRunId?: string | null;
  gateId?: string | null;
  generateSuggestions?: boolean;
}

/**
 * 分析链：回归检测 → 门禁 → 优化建议。
 * 可以在 run 结束后自动跑，也可以对历史 run 重跑（同样的输入 → 同样的结论）。
 */
export function analyzeRun(store: Store, runId: string, options: AnalyzeRunOptions = {}): AnalysisOutcome {
  const run = store.runs.get(runId);
  if (!run) throw new Error(`run ${runId} 不存在`);

  const caseRuns = store.runs.listCaseRuns(runId, { limit: 100_000 });
  const results = store.evalResults.listByRun(runId);
  const failures = options.failures ?? store.failures.listByRun(runId, { limit: 100_000 });
  const metrics = options.metrics ?? store.evalResults.listMetrics(runId);

  // ── 回归检测 ────────────────────────────────────────────────
  const baselineId = options.baselineRunId ?? run.baselineRunId ?? store.runs.findBaselineFor(run.datasetVersionId)?.id ?? null;
  let regressions: Regression[] = [];
  if (baselineId && baselineId !== runId) {
    const baselineRun = store.runs.get(baselineId);
    if (baselineRun) {
      const baselineCaseRuns = store.runs.listCaseRuns(baselineRun.id, { limit: 100_000 });
      const baselineMetrics = store.evalResults.listMetrics(baselineRun.id);
      const comparison = compareRuns(
        { runId: baselineRun.id, label: `${baselineRun.agentVersionId}`, caseRuns: baselineCaseRuns, metrics: baselineMetrics },
        { runId: run.id, label: run.agentVersionId, caseRuns, metrics },
      );
      regressions = store.regressions.createMany(run.id, baselineRun.id, comparison.regressions);
      store.regressions.saveComparison({
        baseRunId: baselineRun.id,
        targetRunId: run.id,
        baseLabel: comparison.base.label,
        targetLabel: comparison.target.label,
        metricDiffs: comparison.metricDiffs,
        fixedCases: comparison.fixedCases.map((c) => ({ ...c })),
        regressedCases: comparison.regressedCases.map((c) => ({ ...c })),
        bothPassed: comparison.bothPassed.length,
        bothFailed: comparison.bothFailed.length,
        regressions: comparison.regressions,
      });
    }
  }

  // ── 门禁 ────────────────────────────────────────────────────
  let gateDecision: ReleaseDecision | null = null;
  const gates = store.gates.listGates(run.agentId).filter((g) => g.enabled);
  const gate = options.gateId ? gates.find((g) => g.id === options.gateId) ?? null : gates[0] ?? null;
  if (gate) {
    const toolCallStats = { total: 0, errors: 0 };
    gateDecision = store.gates.createDecision(
      evaluateReleaseGate({
        gate,
        runId: run.id,
        agentId: run.agentId,
        agentVersionId: run.agentVersionId,
        caseRuns,
        results,
        failures,
        regressions,
        toolCallStats,
      }),
    );
  }

  // ── 优化建议 ────────────────────────────────────────────────
  let suggestionCount = 0;
  if (options.generateSuggestions !== false) {
    const prompt = store.prompts.get(store.agentVersions.get(run.agentVersionId)?.promptVersionId ?? '');
    const testCases = new Map<string, TestCase>(store.datasets.listCases(run.datasetVersionId, { limit: 100_000 }).map((c) => [c.id, c]));
    const toolCallsByCase = new Map<string, ReturnType<Store['traces']['listToolCalls']>>();
    const retrievalsByCase = new Map<string, ReturnType<Store['traces']['listRetrievals']>>();
    for (const caseRun of caseRuns) {
      if (!caseRun.traceId) continue;
      toolCallsByCase.set(caseRun.id, store.traces.listToolCalls(caseRun.traceId));
      retrievalsByCase.set(caseRun.id, store.traces.listRetrievals(caseRun.traceId));
    }
    if (prompt) {
      const drafts = generateSuggestions({
        runId: run.id,
        agentId: run.agentId,
        agentVersionId: run.agentVersionId,
        prompt,
        caseRuns,
        results,
        failures,
        testCases,
        toolCallsByCase,
        retrievalsByCase,
      });
      const created = store.suggestions.createMany(drafts);
      suggestionCount = created.length;

      const candidate = buildPromptCandidate(prompt, run.agentId, drafts);
      if (candidate) {
        store.suggestions.createPromptCandidate(candidate);
        store.search.index('prompt_candidate', run.agentId, `Prompt 候选 @ ${run.id}`, candidate.rationale, ['prompt']);
      }
      for (const s of created) {
        store.search.index('suggestion', s.id, s.title, `${s.detail} ${s.category}`, [s.category]);
      }
    }
  }

  return { metrics, failures, regressions, gateDecision, suggestionCount };
}

export { BUILTIN_EVALUATORS, MOCK_JUDGE_FIXTURE_ID, createMockModelProvider, ids };
