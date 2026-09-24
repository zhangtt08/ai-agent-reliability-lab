import {
  ComparisonSchema,
  EvaluatorSetSchema,
  FailureSchema,
  HumanReviewSchema,
  JudgeRubricSchema,
  OptimizationSuggestionSchema,
  PromptCandidateSchema,
  RegressionSchema,
  ReleaseDecisionSchema,
  ReleaseGateSchema,
  ids,
  nowIso,
  type Comparison,
  type EvaluatorConfigInput,
  type EvaluatorSet,
  type EvidenceReferenceInput,
  type Failure,
  type FailureCategory,
  type GateRuleInput,
  type GateRuleResult,
  type HumanReview,
  type HumanVerdict,
  type JudgeRubric,
  type OptimizationSuggestion,
  type PromptCandidate,
  type Regression,
  type ReleaseDecision,
  type ReleaseGate,
  type RubricCriterionInput,
  type SuggestionCategory,
} from '@arl/shared';
import type { SqlDriver } from '../driver';
import { and, countRows, insertInto, placeholders, selectAll, selectOne, updateById } from '../repo-utils';

export interface CreateFailureInput {
  caseRunId: string;
  runId: string;
  category: FailureCategory;
  customCategory?: string | null;
  confidence?: number;
  source?: Failure['source'];
  explanation?: string;
  evidence?: EvidenceReferenceInput[];
}

export interface CreateEvaluatorSetInput {
  name: string;
  description?: string;
  judgeMode?: EvaluatorSet['judgeMode'];
  passThreshold?: number;
  members?: EvaluatorConfigInput[];
  isBuiltin?: boolean;
}

export interface CreateGateInput {
  name: string;
  agentId: string;
  description?: string;
  rules?: GateRuleInput[];
  requireCriticalPass?: boolean;
  requireNoRegression?: boolean;
  enabled?: boolean;
}

export interface CreateRubricInput {
  name: string;
  description?: string;
  criteria?: RubricCriterionInput[];
  passThreshold?: number;
  isBuiltin?: boolean;
}

export interface CreateSuggestionInput {
  runId: string;
  agentId: string;
  agentVersionId: string;
  category: SuggestionCategory;
  title: string;
  detail?: string;
  evidence?: EvidenceReferenceInput[];
  affectedCases?: string[];
  impact?: OptimizationSuggestion['impact'];
  confidence?: number;
  generator?: OptimizationSuggestion['generator'];
  status?: OptimizationSuggestion['status'];
}

export interface CreatePromptCandidateInput {
  agentId: string;
  basePromptVersionId: string;
  systemPrompt: string;
  taskPromptTemplate: string;
  rationale?: string;
  evidence?: EvidenceReferenceInput[];
  status?: PromptCandidate['status'];
  adoptedPromptVersionId?: string | null;
}

export function createFailureRepository(driver: SqlDriver) {
  const T = 'failures';
  const repo = {
    create(failure: CreateFailureInput): Failure {
      const record: Failure = FailureSchema.parse({ ...failure, id: ids.failure(), createdAt: nowIso() });
      insertInto(driver, T, record);
      return record;
    },

    createMany(items: CreateFailureInput[]): Failure[] {
      return driver.transaction(() => items.map((i) => repo.create(i)));
    },

    listByRun(runId: string, filters: { category?: FailureCategory; limit?: number; offset?: number } = {}): Failure[] {
      return selectAll<Failure>(driver, T, {
        where: and('run_id = ?', filters.category ? 'category = ?' : undefined),
        params: filters.category ? [runId, filters.category] : [runId],
        orderBy: 'created_at DESC',
        limit: filters.limit,
        offset: filters.offset,
      });
    },

    listByCaseRun(caseRunId: string): Failure[] {
      return selectAll<Failure>(driver, T, { where: 'case_run_id = ?', params: [caseRunId] });
    },

    /** 失败画像：按分类计数 */
    distribution(runId: string): { category: string; count: number; avgConfidence: number }[] {
      return driver
        .all<{ category: string; n: number; avg_conf: number }>(
          `SELECT category, COUNT(*) AS n, AVG(confidence) AS avg_conf FROM ${T} WHERE run_id = ? GROUP BY category ORDER BY n DESC`,
          [runId],
        )
        .map((r) => ({ category: r.category, count: Number(r.n), avgConfidence: Number(r.avg_conf) }));
    },

    /** 跨 run 的反复出现失败：同 category 在多个 run 出现 */
    recurring(agentId: string, limit = 5): { category: string; runs: number; cases: number }[] {
      return driver
        .all<{ category: string; runs: number; cases: number }>(
          `SELECT f.category AS category, COUNT(DISTINCT f.run_id) AS runs, COUNT(*) AS cases
           FROM ${T} f JOIN evaluation_runs r ON r.id = f.run_id
           WHERE r.agent_id = ?
           GROUP BY f.category HAVING runs > 1 ORDER BY runs DESC, cases DESC LIMIT ${Math.max(1, Math.trunc(limit))}`,
          [agentId],
        )
        .map((r) => ({ category: r.category, runs: Number(r.runs), cases: Number(r.cases) }));
    },

    countByRun(runId: string): number {
      return countRows(driver, T, { where: 'run_id = ?', params: [runId] });
    },
  };
  return repo;
}

const HUMAN_TO_STATUS: Record<HumanVerdict, string> = {
  pass: 'passed',
  fail: 'failed',
  partial: 'partial',
};

export function createHumanReviewRepository(driver: SqlDriver) {
  const T = 'human_reviews';
  const repo = {
    /** 人工结论只增不改 —— 保留全部历史复核记录 */
    create(input: {
      caseRunId: string;
      runId: string;
      verdict: HumanVerdict;
      comment?: string;
      reviewer?: string;
      failureCategory?: FailureCategory | null;
      machineVerdict: HumanReview['machineVerdict'];
      machineSnapshot: Record<string, unknown>[];
    }): HumanReview {
      const record: HumanReview = HumanReviewSchema.parse({
        id: ids.humanReview(),
        caseRunId: input.caseRunId,
        runId: input.runId,
        reviewer: input.reviewer ?? 'local-reviewer',
        verdict: input.verdict,
        comment: input.comment ?? '',
        failureCategory: input.failureCategory ?? null,
        machineVerdict: input.machineVerdict,
        machineSnapshot: input.machineSnapshot,
        // 人工三态（pass/fail/partial）与 case 状态（passed/failed/partial）语义映射后再比较
        overridesMachine: HUMAN_TO_STATUS[input.verdict] !== input.machineVerdict,
        createdAt: nowIso(),
      });
      insertInto(driver, T, record);
      return record;
    },

    listByCaseRun(caseRunId: string): HumanReview[] {
      return selectAll<HumanReview>(driver, T, {
        where: 'case_run_id = ?',
        params: [caseRunId],
        orderBy: 'created_at DESC',
      });
    },

    latest(caseRunId: string): HumanReview | undefined {
      return selectAll<HumanReview>(driver, T, {
        where: 'case_run_id = ?',
        params: [caseRunId],
        orderBy: 'created_at DESC',
        limit: 1,
      })[0];
    },

    listByRun(runId: string): HumanReview[] {
      return selectAll<HumanReview>(driver, T, { where: 'run_id = ?', params: [runId], orderBy: 'created_at DESC' });
    },

    /** 人工待审队列：机器判 fail/partial 且尚无人工结论的 case */
    pendingQueue(limit = 50): { caseRunId: string; runId: string; agentId: string; machineVerdict: string }[] {
      return driver
        .all<{ case_run_id: string; run_id: string; agent_id: string; machine_verdict: string }>(
          `SELECT cr.id AS case_run_id, cr.run_id AS run_id, r.agent_id AS agent_id, cr.machine_verdict AS machine_verdict
           FROM case_runs cr
           JOIN evaluation_runs r ON r.id = cr.run_id
           WHERE cr.machine_verdict IN ('failed','partial','error','timeout')
             AND NOT EXISTS (SELECT 1 FROM ${T} hr WHERE hr.case_run_id = cr.id)
           ORDER BY CASE cr.machine_verdict WHEN 'failed' THEN 0 WHEN 'error' THEN 1 WHEN 'timeout' THEN 2 ELSE 3 END,
                    cr.created_at DESC
           LIMIT ${Math.max(1, Math.trunc(limit))}`,
        )
        .map((r) => ({
          caseRunId: r.case_run_id,
          runId: r.run_id,
          agentId: r.agent_id,
          machineVerdict: r.machine_verdict,
        }));
    },

    /** 人工 vs 机器一致性矩阵（用于展示「人机分歧」） */
    agreementStats(): { machineVerdict: string; humanVerdict: string; count: number }[] {
      return driver
        .all<{ machine_verdict: string; verdict: string; n: number }>(
          `SELECT machine_verdict, verdict, COUNT(*) AS n FROM ${T} GROUP BY machine_verdict, verdict`,
        )
        .map((r) => ({ machineVerdict: r.machine_verdict, humanVerdict: r.verdict, count: Number(r.n) }));
    },
  };
  return repo;
}

export function createRegressionRepository(driver: SqlDriver) {
  const T = 'regressions';
  const C = 'comparisons';
  const repo = {
    createMany(runId: string, baselineRunId: string, items: Omit<Regression, 'id'>[]): Regression[] {
      return driver.transaction(() =>
        items.map((item) => {
          const record: Regression = RegressionSchema.parse({ ...item, id: ids.regression() });
          const row: Record<string, unknown> = {
            id: record.id,
            runId,
            baselineRunId,
            kind: record.kind,
            severity: record.severity,
            caseRunId: record.caseRunId,
            testCaseId: record.testCaseId,
            testCaseName: record.testCaseName,
            metricKey: record.metricKey,
            baselineValue: record.baselineValue,
            currentValue: record.currentValue,
            description: record.description,
            evidence: record.evidence,
            createdAt: nowIso(),
          };
          insertInto(driver, T, row);
          return record;
        }),
      );
    },

    listByRun(runId: string): Regression[] {
      return selectAll<Regression>(driver, T, {
        where: 'run_id = ?',
        params: [runId],
        orderBy: "CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END",
      });
    },

    countByRun(runId: string): number {
      return countRows(driver, T, { where: 'run_id = ?', params: [runId] });
    },

    saveComparison(comparison: Omit<Comparison, 'id' | 'createdAt'>): Comparison {
      const existing = repo.findComparison(comparison.baseRunId, comparison.targetRunId);
      const record: Comparison = ComparisonSchema.parse({
        ...comparison,
        id: existing?.id ?? ids.comparison(),
        createdAt: nowIso(),
      });
      if (existing) {
        driver.run(`DELETE FROM ${C} WHERE id = ?`, [existing.id]);
      }
      insertInto(driver, C, record);
      return record;
    },

    findComparison(baseRunId: string, targetRunId: string): Comparison | undefined {
      return selectOne<Comparison>(driver, C, {
        where: and('base_run_id = ?', 'target_run_id = ?'),
        params: [baseRunId, targetRunId],
      });
    },

    /** 某个 run 作为 target 的历史比较（趋势用） */
    listByTarget(targetRunId: string): Comparison[] {
      return selectAll<Comparison>(driver, C, { where: 'target_run_id = ?', params: [targetRunId] });
    },

    caseRegressionsForRunIds(runIds: string[]): { testCaseId: string; runId: string }[] {
      if (runIds.length === 0) return [];
      return driver
        .all<{ test_case_id: string; run_id: string }>(
          `SELECT test_case_id, run_id FROM ${T} WHERE kind = 'case' AND test_case_id IN (
             SELECT test_case_id FROM ${T} WHERE run_id IN (${placeholders(runIds.length)})
           )`,
          runIds,
        )
        .map((r) => ({ testCaseId: r.test_case_id, runId: r.run_id }));
    },
  };
  return repo;
}

export function createGateRepository(driver: SqlDriver) {
  const G = 'release_gates';
  const D = 'release_decisions';
  const repo = {
    createGate(input: CreateGateInput): ReleaseGate {
      const record: ReleaseGate = ReleaseGateSchema.parse({ ...input, id: ids.gate(), createdAt: nowIso() });
      insertInto(driver, G, record);
      return record;
    },

    getGate(id: string): ReleaseGate | undefined {
      return selectOne<ReleaseGate>(driver, G, { where: 'id = ?', params: [id] });
    },

    listGates(agentId?: string): ReleaseGate[] {
      return selectAll<ReleaseGate>(driver, G, {
        where: agentId ? 'agent_id = ?' : undefined,
        params: agentId ? [agentId] : [],
        orderBy: 'created_at DESC',
      });
    },

    updateGate(id: string, patch: Partial<ReleaseGate>): number {
      return updateById(driver, G, id, patch);
    },

    /** 决策只增不改：重新评估 = 产生新决策 */
    createDecision(input: Omit<ReleaseDecision, 'id' | 'decidedAt' | 'ruleResults'> & { ruleResults?: GateRuleResult[] }): ReleaseDecision {
      const record: ReleaseDecision = ReleaseDecisionSchema.parse({
        ...input,
        id: ids.decision(),
        decidedAt: nowIso(),
      });
      insertInto(driver, D, record);
      return record;
    },

    listDecisions(filters: { agentId?: string; runId?: string; limit?: number } = {}): ReleaseDecision[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filters.agentId) {
        clauses.push('agent_id = ?');
        params.push(filters.agentId);
      }
      if (filters.runId) {
        clauses.push('run_id = ?');
        params.push(filters.runId);
      }
      return selectAll<ReleaseDecision>(driver, D, {
        where: clauses.length ? clauses.join(' AND ') : undefined,
        params,
        orderBy: 'decided_at DESC',
        limit: filters.limit ?? 50,
      });
    },

    latestDecisionForRun(runId: string): ReleaseDecision | undefined {
      return selectAll<ReleaseDecision>(driver, D, {
        where: 'run_id = ?',
        params: [runId],
        orderBy: 'decided_at DESC',
        limit: 1,
      })[0];
    },

    latestDecisionForAgent(agentId: string): ReleaseDecision | undefined {
      return selectAll<ReleaseDecision>(driver, D, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'decided_at DESC',
        limit: 1,
      })[0];
    },
  };
  return repo;
}

export function createSuggestionRepository(driver: SqlDriver) {
  const S = 'optimization_suggestions';
  const PC = 'prompt_candidates';
  const repo = {
    createMany(items: CreateSuggestionInput[]): OptimizationSuggestion[] {
      return driver.transaction(() =>
        items.map((item) => {
          const record: OptimizationSuggestion = OptimizationSuggestionSchema.parse({
            ...item,
            id: ids.suggestion(),
            createdAt: nowIso(),
          });
          insertInto(driver, S, record);
          return record;
        }),
      );
    },

    listByRun(runId: string, filters: { category?: SuggestionCategory } = {}): OptimizationSuggestion[] {
      return selectAll<OptimizationSuggestion>(driver, S, {
        where: and('run_id = ?', filters.category ? 'category = ?' : undefined),
        params: filters.category ? [runId, filters.category] : [runId],
        orderBy: "CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
      });
    },

    listAll(limit = 100): OptimizationSuggestion[] {
      return selectAll<OptimizationSuggestion>(driver, S, { orderBy: 'created_at DESC', limit });
    },

    updateStatus(id: string, status: OptimizationSuggestion['status']): number {
      return updateById(driver, S, id, { status });
    },

    // Prompt 候选：绝不自动覆盖生产 Prompt，采用时才产生新的 PromptVersion
    createPromptCandidate(input: CreatePromptCandidateInput): PromptCandidate {
      const record: PromptCandidate = PromptCandidateSchema.parse({
        ...input,
        id: ids.promptCandidate(),
        createdAt: nowIso(),
      });
      insertInto(driver, PC, record);
      return record;
    },

    getPromptCandidate(id: string): PromptCandidate | undefined {
      return selectOne<PromptCandidate>(driver, PC, { where: 'id = ?', params: [id] });
    },

    listPromptCandidates(agentId: string): PromptCandidate[] {
      return selectAll<PromptCandidate>(driver, PC, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'created_at DESC',
      });
    },

    adoptPromptCandidate(id: string, promptVersionId: string): number {
      return updateById(driver, PC, id, { status: 'accepted', adoptedPromptVersionId: promptVersionId });
    },
  };
  return repo;
}

export function createEvaluatorSetRepository(driver: SqlDriver) {
  const T = 'evaluator_sets';
  const R = 'judge_rubrics';
  const repo = {
    create(input: CreateEvaluatorSetInput): EvaluatorSet {
      const record: EvaluatorSet = EvaluatorSetSchema.parse({ ...input, id: ids.evaluatorSet(), createdAt: nowIso() });
      insertInto(driver, T, record);
      return record;
    },

    get(id: string): EvaluatorSet | undefined {
      return selectOne<EvaluatorSet>(driver, T, { where: 'id = ?', params: [id] });
    },

    findByName(name: string): EvaluatorSet | undefined {
      return selectOne<EvaluatorSet>(driver, T, { where: 'name = ?', params: [name] });
    },

    list(): EvaluatorSet[] {
      return selectAll<EvaluatorSet>(driver, T, { orderBy: 'created_at ASC' });
    },

    createRubric(input: CreateRubricInput): JudgeRubric {
      const record: JudgeRubric = JudgeRubricSchema.parse({ ...input, id: ids.rubric(), createdAt: nowIso() });
      insertInto(driver, R, record);
      return record;
    },

    getRubric(id: string): JudgeRubric | undefined {
      return selectOne<JudgeRubric>(driver, R, { where: 'id = ?', params: [id] });
    },

    listRubrics(): JudgeRubric[] {
      return selectAll<JudgeRubric>(driver, R, { orderBy: 'created_at ASC' });
    },

    findRubricByName(name: string): JudgeRubric | undefined {
      return selectOne<JudgeRubric>(driver, R, { where: 'name = ?', params: [name] });
    },
  };
  return repo;
}
