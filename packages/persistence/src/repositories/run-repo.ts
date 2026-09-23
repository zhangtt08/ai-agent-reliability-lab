import {
  CaseRunSchema,
  EvaluationResultSchema,
  EvaluationRunSchema,
  MetricResultSchema,
  ModelCallSchema,
  RetrievalEventSchema,
  ToolCallSchema,
  TraceSchema,
  TraceStepSchema,
  ids,
  nowIso,
  type CaseRun,
  type CaseRunStatus,
  type EvaluationResult,
  type EvaluationRun,
  type FailureCategory,
  type MetricResult,
  type ModelCall,
  type Priority,
  type ReproducibilitySnapshotInput,
  type RetrievalEvent,
  type RunConfigInput,
  type RunStatus,
  type RunUsageInput,
  type ToolCall,
  type Trace,
  type TraceStep,
} from '@arl/shared';
import type { SqlDriver } from '../driver';
import { fromRow } from '../row-mapper';
import { and, countRows, insertInto, placeholders, selectAll, selectOne, updateById } from '../repo-utils';

export interface CreateRunInput {
  agentId: string;
  agentVersionId: string;
  datasetId: string;
  datasetVersionId: string;
  evaluatorSetId: string;
  runConfig: RunConfigInput;
  status?: RunStatus;
  mode?: 'full' | 'smoke';
  caseCount?: number;
  passed?: number;
  failed?: number;
  partial?: number;
  errored?: number;
  usage?: RunUsageInput;
  durationMs?: number;
  baselineRunId?: string | null;
  isBaseline?: boolean;
  reproducibility?: ReproducibilitySnapshotInput | null;
  error?: string | null;
  triggeredBy?: string;
  startedAt?: string;
}

export interface CaseRunFilters {
  status?: CaseRunStatus;
  failureCategory?: FailureCategory;
  priority?: Priority;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function createRunRepository(driver: SqlDriver) {
  const RUN = 'evaluation_runs';
  const CR = 'case_runs';

  const repo = {
    create(input: CreateRunInput): EvaluationRun {
      const run: EvaluationRun = EvaluationRunSchema.parse({
        ...input,
        id: ids.run(),
        startedAt: input.startedAt ?? nowIso(),
        completedAt: null,
      });
      insertInto(driver, RUN, run);
      return run;
    },

    update(id: string, patch: Partial<EvaluationRun>): number {
      return updateById(driver, RUN, id, patch);
    },

    markRunning(id: string): number {
      return updateById(driver, RUN, id, { status: 'running' as RunStatus });
    },

    saveMetrics(id: string, counts: { caseCount: number; passed: number; failed: number; partial: number; errored: number }): number {
      return updateById(driver, RUN, id, counts);
    },

    complete(
      id: string,
      patch: {
        status: RunStatus;
        counts: { caseCount: number; passed: number; failed: number; partial: number; errored: number };
        usage: EvaluationRun['usage'];
        durationMs: number;
        error?: string | null;
      },
    ): number {
      return updateById(driver, RUN, id, {
        ...patch.counts,
        status: patch.status,
        usage: patch.usage,
        durationMs: patch.durationMs,
        completedAt: nowIso(),
        error: patch.error ?? null,
      });
    },

    get(id: string): EvaluationRun | undefined {
      return selectOne<EvaluationRun>(driver, RUN, { where: 'id = ?', params: [id] });
    },

    list(
      filters: {
        agentId?: string;
        agentVersionId?: string;
        datasetId?: string;
        datasetVersionId?: string;
        status?: RunStatus;
        isBaseline?: boolean;
        limit?: number;
        offset?: number;
      } = {},
    ): EvaluationRun[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filters.agentId) {
        clauses.push('agent_id = ?');
        params.push(filters.agentId);
      }
      if (filters.agentVersionId) {
        clauses.push('agent_version_id = ?');
        params.push(filters.agentVersionId);
      }
      if (filters.datasetId) {
        clauses.push('dataset_id = ?');
        params.push(filters.datasetId);
      }
      if (filters.datasetVersionId) {
        clauses.push('dataset_version_id = ?');
        params.push(filters.datasetVersionId);
      }
      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }
      if (filters.isBaseline !== undefined) {
        clauses.push('is_baseline = ?');
        params.push(filters.isBaseline ? 1 : 0);
      }
      return selectAll<EvaluationRun>(driver, RUN, {
        where: clauses.length ? clauses.join(' AND ') : undefined,
        params,
        orderBy: 'started_at DESC',
        limit: filters.limit,
        offset: filters.offset,
      });
    },

    count(filters: { agentId?: string } = {}): number {
      return countRows(driver, RUN, filters.agentId ? { where: 'agent_id = ?', params: [filters.agentId] } : {});
    },

    latestForVersion(
      agentVersionId: string,
      options: { datasetVersionId?: string; status?: RunStatus } = {},
    ): EvaluationRun | undefined {
      const clauses = ['agent_version_id = ?'];
      const params: (string | number)[] = [agentVersionId];
      if (options.datasetVersionId) {
        clauses.push('dataset_version_id = ?');
        params.push(options.datasetVersionId);
      }
      if (options.status) {
        clauses.push('status = ?');
        params.push(options.status);
      }
      return selectAll<EvaluationRun>(driver, RUN, {
        where: clauses.join(' AND '),
        params,
        orderBy: 'started_at DESC',
        limit: 1,
      })[0];
    },

    /** baseline 是「比较基准」：同一 dataset 版本上显式标记的那次 run */
    setBaseline(runId: string, value: boolean): void {
      driver.transaction(() => {
        const run = repo.get(runId);
        if (!run) throw new Error(`run ${runId} not found`);
        if (value) {
          const existing = selectAll<EvaluationRun>(driver, RUN, {
            where: and('dataset_version_id = ?', 'is_baseline = 1'),
            params: [run.datasetVersionId],
          });
          for (const e of existing) updateById(driver, RUN, e.id, { isBaseline: false });
        }
        updateById(driver, RUN, runId, { isBaseline: value });
      });
    },

    findBaselineFor(datasetVersionId: string): EvaluationRun | undefined {
      return selectAll<EvaluationRun>(driver, RUN, {
        where: and('dataset_version_id = ?', 'is_baseline = 1'),
        params: [datasetVersionId],
        orderBy: 'started_at DESC',
        limit: 1,
      })[0];
    },

    // ── CaseRun ────────────────────────────────────────────────────
    createCaseRuns(runs: Omit<CaseRun, 'id' | 'createdAt'>[]): CaseRun[] {
      return driver.transaction(() =>
        runs.map((r) => {
          const record: CaseRun = CaseRunSchema.parse({ ...r, id: ids.caseRun(), createdAt: nowIso() });
          insertInto(driver, CR, record);
          return record;
        }),
      );
    },

    updateCaseRun(id: string, patch: Partial<CaseRun>): number {
      return updateById(driver, CR, id, patch);
    },

    getCaseRun(id: string): CaseRun | undefined {
      return selectOne<CaseRun>(driver, CR, { where: 'id = ?', params: [id] });
    },

    listCaseRuns(runId: string, filters: CaseRunFilters = {}): CaseRun[] {
      const clauses = ['run_id = ?'];
      const params: (string | number)[] = [runId];
      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }
      if (filters.failureCategory) {
        clauses.push('failure_category = ?');
        params.push(filters.failureCategory);
      }
      if (filters.priority) {
        clauses.push('priority = ?');
        params.push(filters.priority);
      }
      if (filters.tag) {
        clauses.push('tags_json LIKE ?');
        params.push(`%"${filters.tag}"%`);
      }
      if (filters.q) {
        clauses.push('(test_case_name LIKE ? OR final_output LIKE ?)');
        params.push(`%${filters.q}%`, `%${filters.q}%`);
      }
      return selectAll<CaseRun>(driver, CR, {
        where: clauses.join(' AND '),
        params,
        orderBy: "CASE status WHEN 'failed' THEN 0 WHEN 'error' THEN 1 WHEN 'timeout' THEN 2 WHEN 'partial' THEN 3 ELSE 4 END, test_case_name",
        limit: filters.limit,
        offset: filters.offset,
      });
    },

    countCaseRuns(runId: string, filters: { status?: CaseRunStatus; failureCategory?: FailureCategory } = {}): number {
      const clauses = ['run_id = ?'];
      const params: (string | number)[] = [runId];
      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }
      if (filters.failureCategory) {
        clauses.push('failure_category = ?');
        params.push(filters.failureCategory);
      }
      return countRows(driver, CR, { where: clauses.join(' AND '), params });
    },

    /** 一次查询拿到状态计数，避免 N 次 count */
    statusCounts(runId: string): Record<string, number> {
      const rows = driver.all<{ status: string; n: number }>(
        `SELECT status, COUNT(*) AS n FROM ${CR} WHERE run_id = ? GROUP BY status`,
        [runId],
      );
      const out: Record<string, number> = {};
      for (const r of rows) out[r.status] = Number(r.n);
      return out;
    },

    verdictsByTestCase(runId: string): Map<string, { caseRunId: string; status: CaseRunStatus; failureCategory: string | null }> {
      const rows = driver.all<{ id: string; test_case_id: string; status: CaseRunStatus; failure_category: string | null }>(
        `SELECT id, test_case_id, status, failure_category FROM ${CR} WHERE run_id = ?`,
        [runId],
      );
      return new Map(
        rows.map((r) => [r.test_case_id, { caseRunId: r.id, status: r.status, failureCategory: r.failure_category }]),
      );
    },

    failureDistribution(runId: string): { category: string; count: number }[] {
      return driver
        .all<{ category: string; n: number }>(
          `SELECT COALESCE(failure_category,'none') AS category, COUNT(*) AS n
           FROM ${CR} WHERE run_id = ? AND failure_category IS NOT NULL
           GROUP BY failure_category ORDER BY n DESC`,
          [runId],
        )
        .map((r) => ({ category: r.category, count: Number(r.n) }));
    },

    /** 「最容易出错的 Tool」—— 需要跨 trace 聚合，用 SQL 一次算完 */
    toolErrorStats(runId: string): { toolName: string; total: number; errors: number }[] {
      return driver
        .all<{ tool_name: string; total: number; errors: number }>(
          `SELECT tc.tool_name AS tool_name,
                  COUNT(*) AS total,
                  SUM(CASE WHEN tc.status <> 'ok' THEN 1 ELSE 0 END) AS errors
           FROM tool_calls tc
           JOIN traces t ON t.id = tc.trace_id
           JOIN case_runs cr ON cr.id = t.case_run_id
           WHERE cr.run_id = ?
           GROUP BY tc.tool_name
           ORDER BY errors DESC, total DESC`,
          [runId],
        )
        .map((r) => ({ toolName: r.tool_name, total: Number(r.total), errors: Number(r.errors) }));
    },

    toolCallDistribution(runId: string): { toolName: string; calls: number; cases: number }[] {
      return driver
        .all<{ tool_name: string; calls: number; cases: number }>(
          `SELECT tc.tool_name AS tool_name, COUNT(*) AS calls, COUNT(DISTINCT cr.id) AS cases
           FROM tool_calls tc
           JOIN traces t ON t.id = tc.trace_id
           JOIN case_runs cr ON cr.id = t.case_run_id
           WHERE cr.run_id = ?
           GROUP BY tc.tool_name ORDER BY calls DESC`,
          [runId],
        )
        .map((r) => ({ toolName: r.tool_name, calls: Number(r.calls), cases: Number(r.cases) }));
    },

    caseRunsByIds(idsList: string[]): CaseRun[] {
      if (idsList.length === 0) return [];
      return selectAll<CaseRun>(driver, CR, {
        where: `id IN (${placeholders(idsList.length)})`,
        params: idsList,
      });
    },

    caseRunsForTestCase(testCaseId: string, limit = 20): CaseRun[] {
      return selectAll<CaseRun>(driver, CR, {
        where: 'test_case_id = ?',
        params: [testCaseId],
        orderBy: 'created_at DESC',
        limit,
      });
    },
  };

  return repo;
}

export function createTraceRepository(driver: SqlDriver) {
  const TR = 'traces';
  const ST = 'trace_steps';
  const MC = 'model_calls';
  const TC = 'tool_calls';
  const RV = 'retrieval_events';

  const repo = {
    createTrace(trace: Omit<Trace, 'id' | 'createdAt'> & { createdAt?: string }): Trace {
      const record: Trace = TraceSchema.parse({ ...trace, id: ids.trace(), createdAt: trace.createdAt ?? nowIso() });
      insertInto(driver, TR, record);
      return record;
    },

    createSteps(steps: Omit<TraceStep, 'id'>[]): TraceStep[] {
      return driver.transaction(() =>
        steps.map((s) => {
          const record: TraceStep = TraceStepSchema.parse({ ...s, id: ids.traceStep() });
          insertInto(driver, ST, record);
          return record;
        }),
      );
    },

    createModelCalls(calls: Omit<ModelCall, 'id'>[]): ModelCall[] {
      return driver.transaction(() =>
        calls.map((c) => {
          const record: ModelCall = ModelCallSchema.parse({ ...c, id: ids.modelCall() });
          insertInto(driver, MC, record);
          return record;
        }),
      );
    },

    createToolCalls(calls: Omit<ToolCall, 'id'>[]): ToolCall[] {
      return driver.transaction(() =>
        calls.map((c) => {
          const record: ToolCall = ToolCallSchema.parse({ ...c, id: ids.toolCall() });
          insertInto(driver, TC, record);
          return record;
        }),
      );
    },

    createRetrievals(events: Omit<RetrievalEvent, 'id'>[]): RetrievalEvent[] {
      return driver.transaction(() =>
        events.map((e) => {
          const record: RetrievalEvent = RetrievalEventSchema.parse({ ...e, id: ids.retrieval() });
          insertInto(driver, RV, record);
          return record;
        }),
      );
    },

    getTrace(id: string): Trace | undefined {
      return selectOne<Trace>(driver, TR, { where: 'id = ?', params: [id] });
    },

    getTraceByCaseRun(caseRunId: string): Trace | undefined {
      return selectOne<Trace>(driver, TR, { where: 'case_run_id = ?', params: [caseRunId] });
    },

    listSteps(traceId: string, filters: { type?: string; status?: string } = {}): TraceStep[] {
      const clauses = ['trace_id = ?'];
      const params: (string | number)[] = [traceId];
      if (filters.type) {
        clauses.push('type = ?');
        params.push(filters.type);
      }
      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }
      return selectAll<TraceStep>(driver, ST, {
        where: clauses.join(' AND '),
        params,
        orderBy: 'seq ASC',
      });
    },

    listModelCalls(traceId: string): ModelCall[] {
      return selectAll<ModelCall>(driver, MC, { where: 'trace_id = ?', params: [traceId] });
    },

    listToolCalls(traceId: string): ToolCall[] {
      return selectAll<ToolCall>(driver, TC, { where: 'trace_id = ?', params: [traceId], orderBy: 'seq ASC' });
    },

    listRetrievals(traceId: string): RetrievalEvent[] {
      return selectAll<RetrievalEvent>(driver, RV, { where: 'trace_id = ?', params: [traceId] });
    },

    /** Trace Viewer 一次拿全：steps 为时间主轴，其余按 id 关联 */
    getBundle(traceId: string): {
      trace: Trace | undefined;
      steps: TraceStep[];
      modelCalls: ModelCall[];
      toolCalls: ToolCall[];
      retrievals: RetrievalEvent[];
    } {
      return {
        trace: repo.getTrace(traceId),
        steps: repo.listSteps(traceId),
        modelCalls: repo.listModelCalls(traceId),
        toolCalls: repo.listToolCalls(traceId),
        retrievals: repo.listRetrievals(traceId),
      };
    },

    countToolCalls(traceId: string): number {
      return countRows(driver, TC, { where: 'trace_id = ?', params: [traceId] });
    },

    /** 用于 Loop 分析：某 run 内被重复调用的 tool */
    repeatedToolCalls(runId: string): { toolName: string; caseRunId: string; repeats: number }[] {
      return driver
        .all<{ tool_name: string; case_run_id: string; n: number }>(
          `SELECT tc.tool_name AS tool_name, cr.id AS case_run_id, COUNT(*) AS n
           FROM tool_calls tc
           JOIN traces t ON t.id = tc.trace_id
           JOIN case_runs cr ON cr.id = t.case_run_id
           WHERE cr.run_id = ?
           GROUP BY tc.tool_name, cr.id
           HAVING n > 1
           ORDER BY n DESC`,
          [runId],
        )
        .map((r) => ({ toolName: r.tool_name, caseRunId: r.case_run_id, repeats: Number(r.n) }));
    },
  };

  return repo;
}

export function createEvaluationResultRepository(driver: SqlDriver) {
  const ER = 'evaluation_results';
  const MR = 'metric_results';

  const repo = {
    createMany(results: Omit<EvaluationResult, 'id'>[]): EvaluationResult[] {
      return driver.transaction(() =>
        results.map((r) => {
          const record: EvaluationResult = EvaluationResultSchema.parse({ ...r, id: ids.evaluationResult() });
          insertInto(driver, ER, record);
          return record;
        }),
      );
    },

    listByCaseRun(caseRunId: string): EvaluationResult[] {
      return selectAll<EvaluationResult>(driver, ER, {
        where: 'case_run_id = ?',
        params: [caseRunId],
        orderBy: 'status DESC',
      });
    },

    listByCaseRuns(caseRunIds: string[]): EvaluationResult[] {
      if (caseRunIds.length === 0) return [];
      return selectAll<EvaluationResult>(driver, ER, {
        where: `case_run_id IN (${placeholders(caseRunIds.length)})`,
        params: caseRunIds,
      });
    },

    listByRun(runId: string): EvaluationResult[] {
      const rows = driver.all<Record<string, unknown>>(
        `SELECT er.* FROM ${ER} er JOIN case_runs cr ON cr.id = er.case_run_id WHERE cr.run_id = ?`,
        [runId],
      );
      return rows.map((row) => fromRow<EvaluationResult>(ER, row));
    },

    /** 按 evaluator 聚合通过率 —— 「哪个检查项最常失败」 */
    aggregateByEvaluator(runId: string): { evaluatorKey: string; total: number; passed: number; failed: number; errored: number }[] {
      return driver
        .all<{ evaluator_key: string; total: number; passed: number; failed: number; errored: number }>(
          `SELECT er.evaluator_key AS evaluator_key,
                  COUNT(*) AS total,
                  SUM(CASE WHEN er.status = 'pass' THEN 1 ELSE 0 END) AS passed,
                  SUM(CASE WHEN er.status = 'fail' THEN 1 ELSE 0 END) AS failed,
                  SUM(CASE WHEN er.status = 'error' THEN 1 ELSE 0 END) AS errored
           FROM ${ER} er
           JOIN case_runs cr ON cr.id = er.case_run_id
           WHERE cr.run_id = ?
           GROUP BY er.evaluator_key
           ORDER BY failed DESC, total DESC`,
          [runId],
        )
        .map((r) => ({
          evaluatorKey: r.evaluator_key,
          total: Number(r.total),
          passed: Number(r.passed),
          failed: Number(r.failed),
          errored: Number(r.errored),
        }));
    },

    /** 指标是派生数据（可重算），但一个 run 只保留一份 —— 用事务替换 */
    saveMetrics(runId: string, metrics: MetricResult[]): void {
      driver.transaction(() => {
        driver.run(`DELETE FROM ${MR} WHERE run_id = ?`, [runId]);
        for (const m of metrics) {
          const record = MetricResultSchema.parse(m);
          insertInto(driver, MR, { ...record, id: ids.metric() });
        }
      });
    },

    listMetrics(runId: string): MetricResult[] {
      return selectAll<MetricResult>(driver, MR, { where: 'run_id = ?', params: [runId], orderBy: 'metric_key' });
    },

    getMetric(runId: string, metricKey: string): MetricResult | undefined {
      return selectOne<MetricResult>(driver, MR, {
        where: and('run_id = ?', 'metric_key = ?'),
        params: [runId, metricKey],
      });
    },
  };

  return repo;
}
