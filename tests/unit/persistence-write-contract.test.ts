import { describe, expect, it } from 'vitest';
import {
  AgentSchema,
  AgentVersionSchema,
  AnalysisJobSchema,
  ArtifactSchema,
  CaseRunSchema,
  ComparisonSchema,
  DatasetSchema,
  DatasetVersionSchema,
  EvaluationResultSchema,
  EvaluationRunSchema,
  EvaluatorSetSchema,
  FailureSchema,
  HumanReviewSchema,
  JudgeRubricSchema,
  MetricResultSchema,
  ModelCallSchema,
  OptimizationSuggestionSchema,
  PromptCandidateSchema,
  PromptVersionSchema,
  RegressionSchema,
  ReleaseDecisionSchema,
  ReleaseGateSchema,
  RetrievalEventSchema,
  TestCaseSchema,
  ToolCallSchema,
  TraceSchema,
  TraceStepSchema,
  type ZodObjectLike,
} from './schema-registry';
import { createTestStore, fromRow, planInsert } from '@arl/persistence';

/**
 * 通用写入契约：对每张表，用其 Zod 领域模型的字段集合生成 INSERT 计划，
 * 校验「计划里的每一列都真实存在于表中」，并校验反向映射能还原出同样的字段名。
 *
 * 这一类 bug（如 `humanVerdict` 没有对应列、`outputJson` 被拼成 `output_json_json`）
 * 会在运行时才炸 SQL，靠人工 review 很容易漏 —— 所以交给测试兜住。
 */
const REGISTRY: { table: string; schema: ZodObjectLike }[] = [
  { table: 'agents', schema: AgentSchema },
  { table: 'prompt_versions', schema: PromptVersionSchema },
  { table: 'agent_versions', schema: AgentVersionSchema },
  { table: 'datasets', schema: DatasetSchema },
  { table: 'dataset_versions', schema: DatasetVersionSchema },
  { table: 'test_cases', schema: TestCaseSchema },
  { table: 'evaluator_sets', schema: EvaluatorSetSchema },
  { table: 'judge_rubrics', schema: JudgeRubricSchema },
  { table: 'release_gates', schema: ReleaseGateSchema },
  { table: 'evaluation_runs', schema: EvaluationRunSchema },
  { table: 'case_runs', schema: CaseRunSchema },
  { table: 'traces', schema: TraceSchema },
  { table: 'trace_steps', schema: TraceStepSchema },
  { table: 'model_calls', schema: ModelCallSchema },
  { table: 'tool_calls', schema: ToolCallSchema },
  { table: 'retrieval_events', schema: RetrievalEventSchema },
  { table: 'evaluation_results', schema: EvaluationResultSchema },
  { table: 'metric_results', schema: MetricResultSchema },
  { table: 'failures', schema: FailureSchema },
  { table: 'human_reviews', schema: HumanReviewSchema },
  { table: 'regressions', schema: RegressionSchema },
  { table: 'comparisons', schema: ComparisonSchema },
  { table: 'release_decisions', schema: ReleaseDecisionSchema },
  { table: 'optimization_suggestions', schema: OptimizationSuggestionSchema },
  { table: 'prompt_candidates', schema: PromptCandidateSchema },
  { table: 'analysis_jobs', schema: AnalysisJobSchema },
  { table: 'artifacts', schema: ArtifactSchema },
];

/** 由仓储层补写的列（模型里没有，属于表结构的一部分） */
const REPO_MANAGED_COLUMNS: Record<string, string[]> = {
  regressions: ['run_id', 'baseline_run_id'],
};

describe('写入契约：领域模型字段 ↔ 真实数据库列', () => {
  const store = createTestStore();
  const businessTables = () =>
    store.driver
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((r) => r.name)
      // FTS5 会创建一批影子表（*_data/_idx/_content/_docsize/_config），不是业务表
      .filter((n) => n !== '_migrations' && !n.startsWith('search_fts'));

  it('注册表覆盖了所有业务表（新增表必须同步登记）', () => {
    const registered = new Set(REGISTRY.map((r) => r.table));
    const missing = businessTables().filter((t) => !registered.has(t));
    expect(missing).toEqual([]);
  });

  it.each(REGISTRY)('$table：INSERT 计划的每一列都真实存在', ({ table, schema }) => {
    const keys = schema.keyof().options as string[];
    expect(keys.length).toBeGreaterThan(0);
    const plan = planInsert(table, Object.fromEntries(keys.map((k) => [k, null])));
    const actual = new Set(store.driver.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name));
    const unknown = plan.columns.filter((c) => !actual.has(c));
    expect(unknown, `表 ${table} 上不存在的列：${unknown.join(', ')}`).toEqual([]);
  });

  it.each(REGISTRY)('$table：计划列可反向还原为同名 camelCase 字段', ({ table, schema }) => {
    const keys = schema.keyof().options as string[];
    const plan = planInsert(table, Object.fromEntries(keys.map((k) => [k, null])));
    const row = Object.fromEntries(plan.columns.map((c) => [c, null]));
    const restored = Object.keys(fromRow(table, row));
    expect([...restored].sort()).toEqual([...keys].sort());
  });

  it('领域模型字段数与表列数一致（不允许有“模型里有、库里没有”的字段）', () => {
    for (const { table, schema } of REGISTRY) {
      const keys = schema.keyof().options as string[];
      const plan = planInsert(table, Object.fromEntries(keys.map((k) => [k, null])));
      const actual = store.driver.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name);
      const extraInTable = actual.filter((c) => !plan.columns.includes(c));
      // id / created_at 由仓储层补；少数表有额外的外键列（见 REPO_MANAGED_COLUMNS）
      const allowed = new Set(['id', 'created_at', ...(REPO_MANAGED_COLUMNS[table] ?? [])]);
      expect(extraInTable.filter((c) => !allowed.has(c)), `${table} 表有未映射列`).toEqual([]);
    }
  });
});
