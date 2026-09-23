/**
 * Drizzle ORM 表定义 —— **DDL 契约的单一事实来源**。
 *
 * 为什么保留 Drizzle 却不用它的 query builder：
 *   `drizzle-orm` 没有 `node:sqlite` 的同步驱动（见 DECISIONS.md D-002）。
 *   因此本文件的作用是「类型化契约」，由 `tests/unit/persistence-contract.test.ts`
 *   将它同 `migrations/*.sql` 实际建出的表结构逐列比对。
 *   一旦迁移与契约漂移，测试立刻失败 —— 这保证 schema 不是装饰品。
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const agentsTable = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  tagsJson: text('tags_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const promptVersionsTable = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  version: integer('version').notNull(),
  label: text('label').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  taskPromptTemplate: text('task_prompt_template').notNull(),
  variablesJson: text('variables_json').notNull(),
  hash: text('hash').notNull(),
  notes: text('notes').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const agentVersionsTable = sqliteTable('agent_versions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  version: integer('version').notNull(),
  label: text('label').notNull(),
  status: text('status').notNull(),
  promptVersionId: text('prompt_version_id').notNull(),
  modelConfigJson: text('model_config_json').notNull(),
  toolsJson: text('tools_json').notNull(),
  knowledgeJson: text('knowledge_json'),
  runtimeConfigJson: text('runtime_config_json').notNull(),
  runtimeKind: text('runtime_kind').notNull(),
  fixtureId: text('fixture_id').notNull(),
  notes: text('notes').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const datasetsTable = sqliteTable('datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  tagsJson: text('tags_json').notNull(),
  isGolden: integer('is_golden').notNull(),
  latestVersion: integer('latest_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const datasetVersionsTable = sqliteTable('dataset_versions', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  version: integer('version').notNull(),
  status: text('status').notNull(),
  caseCount: integer('case_count').notNull(),
  isGolden: integer('is_golden').notNull(),
  contentHash: text('content_hash').notNull(),
  notes: text('notes').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const testCasesTable = sqliteTable('test_cases', {
  id: text('id').primaryKey(),
  datasetVersionId: text('dataset_version_id').notNull(),
  name: text('name').notNull(),
  input: text('input').notNull(),
  context: text('context').notNull(),
  metadataJson: text('metadata_json').notNull(),
  tagsJson: text('tags_json').notNull(),
  priority: text('priority').notNull(),
  enabled: integer('enabled').notNull(),
  expectedOutcomeJson: text('expected_outcome_json').notNull(),
  notes: text('notes').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evaluatorSetsTable = sqliteTable('evaluator_sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  judgeMode: text('judge_mode').notNull(),
  passThreshold: real('pass_threshold').notNull(),
  membersJson: text('members_json').notNull(),
  isBuiltin: integer('is_builtin').notNull(),
  createdAt: text('created_at').notNull(),
});

export const judgeRubricsTable = sqliteTable('judge_rubrics', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  criteriaJson: text('criteria_json').notNull(),
  passThreshold: real('pass_threshold').notNull(),
  isBuiltin: integer('is_builtin').notNull(),
  createdAt: text('created_at').notNull(),
});

export const releaseGatesTable = sqliteTable('release_gates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  agentId: text('agent_id').notNull(),
  rulesJson: text('rules_json').notNull(),
  requireCriticalPass: integer('require_critical_pass').notNull(),
  requireNoRegression: integer('require_no_regression').notNull(),
  enabled: integer('enabled').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evaluationRunsTable = sqliteTable('evaluation_runs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentVersionId: text('agent_version_id').notNull(),
  datasetId: text('dataset_id').notNull(),
  datasetVersionId: text('dataset_version_id').notNull(),
  evaluatorSetId: text('evaluator_set_id').notNull(),
  status: text('status').notNull(),
  mode: text('mode').notNull(),
  runConfigJson: text('run_config_json').notNull(),
  caseCount: integer('case_count').notNull(),
  passed: integer('passed').notNull(),
  failed: integer('failed').notNull(),
  partial: integer('partial').notNull(),
  errored: integer('errored').notNull(),
  usageJson: text('usage_json').notNull(),
  durationMs: integer('duration_ms').notNull(),
  baselineRunId: text('baseline_run_id'),
  isBaseline: integer('is_baseline').notNull(),
  reproducibilityJson: text('reproducibility_json'),
  error: text('error'),
  triggeredBy: text('triggered_by').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

export const caseRunsTable = sqliteTable('case_runs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  testCaseId: text('test_case_id').notNull(),
  testCaseName: text('test_case_name').notNull(),
  priority: text('priority').notNull(),
  tagsJson: text('tags_json').notNull(),
  status: text('status').notNull(),
  machineVerdict: text('machine_verdict').notNull(),
  finalOutput: text('final_output').notNull(),
  outputJson: text('output_json'),
  traceId: text('trace_id'),
  usageJson: text('usage_json').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  modelLatencyMs: integer('model_latency_ms').notNull(),
  toolLatencyMs: integer('tool_latency_ms').notNull(),
  retrievalLatencyMs: integer('retrieval_latency_ms').notNull(),
  attempt: integer('attempt').notNull(),
  failureCategory: text('failure_category'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const tracesTable = sqliteTable('traces', {
  id: text('id').primaryKey(),
  caseRunId: text('case_run_id').notNull(),
  status: text('status').notNull(),
  stepCount: integer('step_count').notNull(),
  totalDurationMs: integer('total_duration_ms').notNull(),
  redactionPolicy: text('redaction_policy').notNull(),
  createdAt: text('created_at').notNull(),
});

export const traceStepsTable = sqliteTable('trace_steps', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull(),
  seq: integer('seq').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  summary: text('summary').notNull(),
  payloadJson: text('payload_json').notNull(),
  modelCallId: text('model_call_id'),
  toolCallId: text('tool_call_id'),
  retrievalId: text('retrieval_id'),
});

export const modelCallsTable = sqliteTable('model_calls', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull(),
  stepId: text('step_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),
  costUsd: real('cost_usd'),
  costSource: text('cost_source').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  promptMode: text('prompt_mode').notNull(),
  promptPreview: text('prompt_preview'),
  outputPreview: text('output_preview'),
  stopped: text('stopped').notNull(),
});

export const toolCallsTable = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull(),
  stepId: text('step_id').notNull(),
  seq: integer('seq').notNull(),
  toolName: text('tool_name').notNull(),
  argumentsJson: text('arguments_json').notNull(),
  validatedArgumentsJson: text('validated_arguments_json').notNull(),
  validationError: text('validation_error'),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  outputSummary: text('output_summary').notNull(),
  outputJson: text('output_json'),
  error: text('error'),
  redactedPathsJson: text('redacted_paths_json').notNull(),
  attempt: integer('attempt').notNull(),
});

export const retrievalEventsTable = sqliteTable('retrieval_events', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull(),
  stepId: text('step_id').notNull(),
  query: text('query').notNull(),
  rewrittenQuery: text('rewritten_query').notNull(),
  mode: text('mode').notNull(),
  topK: integer('top_k').notNull(),
  documentsJson: text('documents_json').notNull(),
  selectedChunksJson: text('selected_chunks_json').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  status: text('status').notNull(),
});

export const evaluationResultsTable = sqliteTable('evaluation_results', {
  id: text('id').primaryKey(),
  caseRunId: text('case_run_id').notNull(),
  evaluatorKey: text('evaluator_key').notNull(),
  evaluatorVersion: text('evaluator_version').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull(),
  score: real('score').notNull(),
  severity: text('severity').notNull(),
  weight: real('weight').notNull(),
  blocking: integer('blocking').notNull(),
  message: text('message').notNull(),
  detailsJson: text('details_json').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  durationMs: integer('duration_ms').notNull(),
});

export const metricResultsTable = sqliteTable('metric_results', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  metricKey: text('metric_key').notNull(),
  metricVersion: text('metric_version').notNull(),
  name: text('name').notNull(),
  value: real('value').notNull(),
  unit: text('unit').notNull(),
  direction: text('direction').notNull(),
  definition: text('definition').notNull(),
  sampleSize: integer('sample_size').notNull(),
  breakdownJson: text('breakdown_json').notNull(),
});

export const failuresTable = sqliteTable('failures', {
  id: text('id').primaryKey(),
  caseRunId: text('case_run_id').notNull(),
  runId: text('run_id').notNull(),
  category: text('category').notNull(),
  customCategory: text('custom_category'),
  confidence: real('confidence').notNull(),
  source: text('source').notNull(),
  explanation: text('explanation').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const humanReviewsTable = sqliteTable('human_reviews', {
  id: text('id').primaryKey(),
  caseRunId: text('case_run_id').notNull(),
  runId: text('run_id').notNull(),
  reviewer: text('reviewer').notNull(),
  verdict: text('verdict').notNull(),
  comment: text('comment').notNull(),
  failureCategory: text('failure_category'),
  machineVerdict: text('machine_verdict').notNull(),
  machineSnapshotJson: text('machine_snapshot_json').notNull(),
  overridesMachine: integer('overrides_machine').notNull(),
  createdAt: text('created_at').notNull(),
});

export const regressionsTable = sqliteTable('regressions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  baselineRunId: text('baseline_run_id').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  caseRunId: text('case_run_id'),
  testCaseId: text('test_case_id'),
  testCaseName: text('test_case_name').notNull(),
  metricKey: text('metric_key'),
  baselineValue: real('baseline_value'),
  currentValue: real('current_value'),
  description: text('description').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const comparisonsTable = sqliteTable('comparisons', {
  id: text('id').primaryKey(),
  baseRunId: text('base_run_id').notNull(),
  targetRunId: text('target_run_id').notNull(),
  baseLabel: text('base_label').notNull(),
  targetLabel: text('target_label').notNull(),
  metricDiffsJson: text('metric_diffs_json').notNull(),
  fixedCasesJson: text('fixed_cases_json').notNull(),
  regressedCasesJson: text('regressed_cases_json').notNull(),
  bothPassed: integer('both_passed').notNull(),
  bothFailed: integer('both_failed').notNull(),
  regressionsJson: text('regressions_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const releaseDecisionsTable = sqliteTable('release_decisions', {
  id: text('id').primaryKey(),
  gateId: text('gate_id').notNull(),
  gateName: text('gate_name').notNull(),
  runId: text('run_id').notNull(),
  agentId: text('agent_id').notNull(),
  agentVersionId: text('agent_version_id').notNull(),
  result: text('result').notNull(),
  ruleResultsJson: text('rule_results_json').notNull(),
  explanation: text('explanation').notNull(),
  blockingFailures: integer('blocking_failures').notNull(),
  regressionCount: integer('regression_count').notNull(),
  decidedAt: text('decided_at').notNull(),
});

export const optimizationSuggestionsTable = sqliteTable('optimization_suggestions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  agentId: text('agent_id').notNull(),
  agentVersionId: text('agent_version_id').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  affectedCasesJson: text('affected_cases_json').notNull(),
  impact: text('impact').notNull(),
  confidence: real('confidence').notNull(),
  generator: text('generator').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const promptCandidatesTable = sqliteTable('prompt_candidates', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  basePromptVersionId: text('base_prompt_version_id').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  taskPromptTemplate: text('task_prompt_template').notNull(),
  rationale: text('rationale').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  status: text('status').notNull(),
  adoptedPromptVersionId: text('adopted_prompt_version_id'),
  createdAt: text('created_at').notNull(),
});

export const analysisJobsTable = sqliteTable('analysis_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  runId: text('run_id'),
  progress: real('progress').notNull(),
  total: integer('total').notNull(),
  done: integer('done').notNull(),
  message: text('message').notNull(),
  error: text('error'),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});

export const artifactsTable = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  runId: text('run_id'),
  mime: text('mime').notNull(),
  content: text('content').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
});

/** 与 migrations 对应的全部表；契约测试遍历此表 */
export const ALL_TABLES = {
  agents: agentsTable,
  prompt_versions: promptVersionsTable,
  agent_versions: agentVersionsTable,
  datasets: datasetsTable,
  dataset_versions: datasetVersionsTable,
  test_cases: testCasesTable,
  evaluator_sets: evaluatorSetsTable,
  judge_rubrics: judgeRubricsTable,
  release_gates: releaseGatesTable,
  evaluation_runs: evaluationRunsTable,
  case_runs: caseRunsTable,
  traces: tracesTable,
  trace_steps: traceStepsTable,
  model_calls: modelCallsTable,
  tool_calls: toolCallsTable,
  retrieval_events: retrievalEventsTable,
  evaluation_results: evaluationResultsTable,
  metric_results: metricResultsTable,
  failures: failuresTable,
  human_reviews: humanReviewsTable,
  regressions: regressionsTable,
  comparisons: comparisonsTable,
  release_decisions: releaseDecisionsTable,
  optimization_suggestions: optimizationSuggestionsTable,
  prompt_candidates: promptCandidatesTable,
  analysis_jobs: analysisJobsTable,
  artifacts: artifactsTable,
} as const;
