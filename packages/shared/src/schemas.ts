import { z } from 'zod';
import {
  AGENT_VERSION_STATUSES,
  CASE_RUN_STATUSES,
  DATASET_VERSION_STATUSES,
  EVALUATION_STATUSES,
  EVALUATOR_CATEGORIES,
  FAILURE_CATEGORIES,
  HUMAN_VERDICTS,
  PRIORITIES,
  PROVIDER_KINDS,
  RELEASE_GATE_RESULTS,
  RUN_STATUSES,
  SEVERITIES,
  SUGGESTION_CATEGORIES,
  TRACE_STEP_TYPES,
} from './taxonomy';

// ─────────────────────────────────────────────────────────────
// 基础
// ─────────────────────────────────────────────────────────────

export const IdSchema = z.string().min(1);
export const IsoDateSchema = z.string().min(1);
export const JsonObjectSchema = z.record(z.string(), z.unknown());

// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────

export const PromptVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
});
export type PromptVariable = z.infer<typeof PromptVariableSchema>;

export const PromptVersionSchema = z.object({
  id: IdSchema,
  agentId: IdSchema,
  version: z.number().int().positive(),
  label: z.string().default(''),
  systemPrompt: z.string(),
  taskPromptTemplate: z.string(),
  variables: z.array(PromptVariableSchema).default([]),
  hash: z.string(),
  notes: z.string().default(''),
  createdBy: z.string().default('system'),
  createdAt: IsoDateSchema,
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

// ─────────────────────────────────────────────────────────────
// Model / Runtime 配置
// ─────────────────────────────────────────────────────────────

export const ModelPricingSchema = z.object({
  inputPer1M: z.number().nonnegative(),
  outputPer1M: z.number().nonnegative(),
  currency: z.literal('USD').default('USD'),
});
export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const ModelConfigSchema = z.object({
  provider: z.string().default('mock'),
  model: z.string().default('mock-reliable-1'),
  temperature: z.number().min(0).max(2).default(0),
  maxTokens: z.number().int().positive().default(1024),
  topP: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  /** 没有配置价目表时必须为 null —— 禁止编造费用 */
  pricing: ModelPricingSchema.nullable().default(null),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const LoopGuardSchema = z.object({
  maxIdenticalToolCalls: z.number().int().positive().default(2),
  maxSteps: z.number().int().positive().default(12),
});
export type LoopGuard = z.infer<typeof LoopGuardSchema>;

export const RuntimeConfigSchema = z.object({
  maxSteps: z.number().int().positive().default(8),
  maxToolCalls: z.number().int().positive().default(6),
  timeoutMs: z.number().int().positive().default(30_000),
  loopGuard: LoopGuardSchema.default({
    maxIdenticalToolCalls: 2,
    maxSteps: 12,
  }),
  promptPrivacy: z.enum(['store_full', 'store_redacted', 'store_metadata_only']).default('store_full'),
  /** 只有基础设施类失败才允许自动重试 */
  retry: z
    .object({
      maxAttempts: z.number().int().min(0).max(5).default(1),
      retryOn: z.array(z.enum(['provider_error', 'rate_limit', 'tool_error', 'none'])).default(['rate_limit']),
    })
    .default({ maxAttempts: 1, retryOn: ['rate_limit'] }),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

// ─────────────────────────────────────────────────────────────
// Tool / Knowledge
// ─────────────────────────────────────────────────────────────

export const ToolDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  inputSchema: JsonObjectSchema.default({ type: 'object', properties: {} }),
  outputSchema: JsonObjectSchema.default({ type: 'object' }),
  handlerType: z.enum(['fixture', 'http', 'local']).default('fixture'),
  /** 该 handler 引用 / fixture 行为名，例如 'getOrder' */
  handlerRef: z.string().default(''),
  enabled: z.boolean().default(true),
  /** 输出中这些字段在 trace 里必须脱敏 */
  sensitiveFields: z.array(z.string()).default([]),
  /** 伪造延迟，用于演示 latency 差异（毫秒） */
  simulatedLatencyMs: z.number().int().nonnegative().default(20),
  /** 故障注入：none / error / timeout */
  failureMode: z.enum(['none', 'error', 'timeout']).default('none'),
  tags: z.array(z.string()).default([]),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const KnowledgeDocumentSchema = z.object({
  id: IdSchema,
  title: z.string(),
  source: z.string().default('fixture://kb'),
  content: z.string(),
  tags: z.array(z.string()).default([]),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const KnowledgeConfigSchema = z.object({
  id: IdSchema,
  name: z.string(),
  enabled: z.boolean().default(true),
  retrievalMode: z.enum(['keyword', 'mock-vector']).default('keyword'),
  topK: z.number().int().positive().default(3),
  scoreThreshold: z.number().min(0).max(1).default(0.1),
  documents: z.array(KnowledgeDocumentSchema).default([]),
  simulatedLatencyMs: z.number().int().nonnegative().default(40),
});
export type KnowledgeConfig = z.infer<typeof KnowledgeConfigSchema>;

// ─────────────────────────────────────────────────────────────
// Agent / AgentVersion
// ─────────────────────────────────────────────────────────────

export const AgentSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  status: z.enum(['active', 'archived']).default('active'),
  tags: z.array(z.string()).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentVersionSchema = z.object({
  id: IdSchema,
  agentId: IdSchema,
  version: z.number().int().positive(),
  label: z.string().default(''),
  status: z.enum(AGENT_VERSION_STATUSES).default('draft'),
  promptVersionId: IdSchema,
  modelConfig: ModelConfigSchema,
  tools: z.array(ToolDefinitionSchema).default([]),
  knowledge: KnowledgeConfigSchema.nullable().default(null),
  runtimeConfig: RuntimeConfigSchema,
  /** 运行时实现：simple-prompt / tool-calling / fixture */
  runtimeKind: z.enum(['simple-prompt', 'tool-calling', 'fixture']).default('tool-calling'),
  /** fixture 行为名（runtimeKind = fixture 时使用） */
  fixtureId: z.string().default(''),
  notes: z.string().default(''),
  createdBy: z.string().default('system'),
  createdAt: IsoDateSchema,
});
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

// ─────────────────────────────────────────────────────────────
// Expected Outcome / Test Case / Dataset
// ─────────────────────────────────────────────────────────────

export const CustomRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(''),
  kind: z.enum(['contains', 'not_contains', 'regex', 'json_path_equals', 'json_path_exists']),
  target: z.enum(['output', 'final_json']).default('output'),
  value: z.string().default(''),
  path: z.string().optional(),
  severity: z.enum(SEVERITIES).default('major'),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const ExpectedToolArgSchema = z.object({
  tool: z.string().min(1),
  path: z.string().default(''),
  op: z.enum(['equals', 'contains', 'exists', 'matches', 'oneOf']).default('equals'),
  expected: z.unknown().optional(),
  description: z.string().default(''),
});
export type ExpectedToolArg = z.infer<typeof ExpectedToolArgSchema>;

export const ExpectedOutcomeSchema = z.object({
  expectedText: z.string().default(''),
  mustContain: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
  expectedSchema: JsonObjectSchema.nullable().default(null),
  expectedTools: z.array(z.string()).default([]),
  forbiddenTools: z.array(z.string()).default([]),
  expectedToolArgs: z.array(ExpectedToolArgSchema).default([]),
  expectedCallOrder: z.array(z.string()).default([]),
  maxToolCalls: z.number().int().nonnegative().nullable().default(null),
  /** 关键结论必须能被检索上下文支持（groundedness） */
  requiredEvidence: z.array(z.string()).default([]),
  expectedClassification: z.string().optional(),
  customRules: z.array(CustomRuleSchema).default([]),
});
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export const TestCaseSchema = z.object({
  id: IdSchema,
  datasetVersionId: IdSchema,
  name: z.string().min(1),
  input: z.string(),
  context: z.string().default(''),
  metadata: JsonObjectSchema.default({}),
  tags: z.array(z.string()).default([]),
  priority: z.enum(PRIORITIES).default('normal'),
  enabled: z.boolean().default(true),
  expectedOutcome: ExpectedOutcomeSchema,
  notes: z.string().default(''),
  createdAt: IsoDateSchema,
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const DatasetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  isGolden: z.boolean().default(false),
  latestVersion: z.number().int().positive().default(1),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const DatasetVersionSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  version: z.number().int().positive(),
  status: z.enum(DATASET_VERSION_STATUSES).default('draft'),
  caseCount: z.number().int().nonnegative().default(0),
  isGolden: z.boolean().default(false),
  contentHash: z.string().default(''),
  notes: z.string().default(''),
  createdBy: z.string().default('system'),
  createdAt: IsoDateSchema,
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;

// ─────────────────────────────────────────────────────────────
// Trace / Tool Call / Retrieval / Model Call
// ─────────────────────────────────────────────────────────────

export const EvidenceReferenceSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['trace_step', 'tool_call', 'retrieval', 'output_range', 'rule', 'metric', 'human', 'case']),
  traceStepId: z.string().optional(),
  toolCallId: z.string().optional(),
  retrievalId: z.string().optional(),
  outputRange: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  ruleId: z.string().optional(),
  description: z.string().default(''),
  snippet: z.string().optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const TraceStepSchema = z.object({
  id: IdSchema,
  traceId: IdSchema,
  seq: z.number().int().nonnegative(),
  type: z.enum(TRACE_STEP_TYPES),
  name: z.string().default(''),
  status: z.enum(['ok', 'error', 'skipped']).default('ok'),
  startedAt: IsoDateSchema,
  endedAt: IsoDateSchema,
  durationMs: z.number().nonnegative().default(0),
  summary: z.string().default(''),
  payload: JsonObjectSchema.default({}),
  modelCallId: z.string().nullable().default(null),
  toolCallId: z.string().nullable().default(null),
  retrievalId: z.string().nullable().default(null),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TraceSchema = z.object({
  id: IdSchema,
  caseRunId: IdSchema,
  status: z.enum(['ok', 'error', 'incomplete']).default('ok'),
  stepCount: z.number().int().nonnegative().default(0),
  totalDurationMs: z.number().nonnegative().default(0),
  redactionPolicy: z.enum(['store_full', 'store_redacted', 'store_metadata_only']).default('store_full'),
  createdAt: IsoDateSchema,
});
export type Trace = z.infer<typeof TraceSchema>;

export const ModelCallSchema = z.object({
  id: IdSchema,
  traceId: IdSchema,
  stepId: IdSchema,
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().nullable().default(null),
  costSource: z.enum(['provider', 'configured', 'unknown']).default('unknown'),
  latencyMs: z.number().nonnegative().default(0),
  status: z.enum(['ok', 'error']).default('ok'),
  error: z.string().nullable().default(null),
  promptMode: z.enum(['store_full', 'store_redacted', 'store_metadata_only']).default('store_full'),
  promptPreview: z.string().nullable().default(null),
  outputPreview: z.string().nullable().default(null),
  stopped: z.enum(['end_turn', 'max_steps', 'error']).default('end_turn'),
});
export type ModelCall = z.infer<typeof ModelCallSchema>;

export const ToolCallSchema = z.object({
  id: IdSchema,
  traceId: IdSchema,
  stepId: IdSchema,
  seq: z.number().int().nonnegative().default(0),
  toolName: z.string(),
  arguments: JsonObjectSchema.default({}),
  validatedArguments: JsonObjectSchema.default({}),
  validationError: z.string().nullable().default(null),
  status: z.enum(['ok', 'error', 'timeout', 'invalid_arguments']).default('ok'),
  startedAt: IsoDateSchema,
  endedAt: IsoDateSchema,
  durationMs: z.number().nonnegative().default(0),
  outputSummary: z.string().default(''),
  outputJson: z.unknown().nullable().default(null),
  error: z.string().nullable().default(null),
  redactedPaths: z.array(z.string()).default([]),
  attempt: z.number().int().positive().default(1),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const RetrievedDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  score: z.number(),
  rank: z.number().int().positive(),
  selected: z.boolean().default(false),
  selectedChunk: z.string().default(''),
});
export type RetrievedDocument = z.infer<typeof RetrievedDocumentSchema>;

export const RetrievalEventSchema = z.object({
  id: IdSchema,
  traceId: IdSchema,
  stepId: IdSchema,
  query: z.string(),
  rewrittenQuery: z.string().default(''),
  mode: z.enum(['keyword', 'mock-vector']).default('keyword'),
  topK: z.number().int().positive().default(3),
  documents: z.array(RetrievedDocumentSchema).default([]),
  selectedChunks: z.array(z.string()).default([]),
  latencyMs: z.number().nonnegative().default(0),
  status: z.enum(['ok', 'empty', 'error']).default('ok'),
});
export type RetrievalEvent = z.infer<typeof RetrievalEventSchema>;

// ─────────────────────────────────────────────────────────────
// Evaluator / EvaluationResult / Metrics
// ─────────────────────────────────────────────────────────────

export const EvaluatorDescriptorSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  kind: z.enum(['deterministic', 'llm', 'human']),
  category: z.enum(EVALUATOR_CATEGORIES),
  version: z.string(),
  description: z.string().default(''),
  configSchema: JsonObjectSchema.default({}),
  isBuiltin: z.boolean().default(true),
});
export type EvaluatorDescriptor = z.infer<typeof EvaluatorDescriptorSchema>;

export const EvaluatorConfigSchema = z.object({
  evaluatorKey: z.string().min(1),
  enabled: z.boolean().default(true),
  weight: z.number().nonnegative().default(1),
  blocking: z.boolean().default(false),
  severity: z.enum(SEVERITIES).default('major'),
  config: JsonObjectSchema.default({}),
});
export type EvaluatorConfig = z.infer<typeof EvaluatorConfigSchema>;

export const EvaluatorSetSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().default(''),
  judgeMode: z.enum(['all', 'any', 'weighted']).default('all'),
  passThreshold: z.number().min(0).max(1).default(1),
  members: z.array(EvaluatorConfigSchema).default([]),
  isBuiltin: z.boolean().default(false),
  createdAt: IsoDateSchema,
});
export type EvaluatorSet = z.infer<typeof EvaluatorSetSchema>;

export const EvaluationResultSchema = z.object({
  id: IdSchema,
  caseRunId: IdSchema,
  evaluatorKey: z.string(),
  evaluatorVersion: z.string().default('v1'),
  name: z.string().default(''),
  category: z.enum(EVALUATOR_CATEGORIES).default('output'),
  status: z.enum(EVALUATION_STATUSES),
  score: z.number().min(0).max(1).default(0),
  severity: z.enum(SEVERITIES).default('major'),
  weight: z.number().nonnegative().default(1),
  blocking: z.boolean().default(false),
  message: z.string().default(''),
  details: JsonObjectSchema.default({}),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  durationMs: z.number().nonnegative().default(0),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const MetricDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  version: z.string().default('v1'),
  unit: z.enum(['ratio', 'count', 'ms', 'usd', 'score']),
  direction: z.enum(['higher_is_better', 'lower_is_better', 'neutral']),
  /** 计算方式必须写清楚 —— 平台上展示的定义文本 */
  definition: z.string(),
  scope: z.enum(['run', 'agent_version', 'case']).default('run'),
});
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

export const MetricResultSchema = z.object({
  runId: IdSchema,
  metricKey: z.string(),
  metricVersion: z.string().default('v1'),
  name: z.string().default(''),
  value: z.number(),
  unit: z.enum(['ratio', 'count', 'ms', 'usd', 'score']).default('ratio'),
  direction: z.enum(['higher_is_better', 'lower_is_better', 'neutral']).default('higher_is_better'),
  definition: z.string().default(''),
  sampleSize: z.number().int().nonnegative().default(0),
  breakdown: JsonObjectSchema.default({}),
});
export type MetricResult = z.infer<typeof MetricResultSchema>;

// ─────────────────────────────────────────────────────────────
// Failure / Human Review
// ─────────────────────────────────────────────────────────────

export const FailureSchema = z.object({
  id: IdSchema,
  caseRunId: IdSchema,
  runId: IdSchema,
  category: z.enum(FAILURE_CATEGORIES).default('unknown'),
  customCategory: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  source: z.enum(['rule', 'llm', 'human', 'hybrid']).default('rule'),
  explanation: z.string().default(''),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  createdAt: IsoDateSchema,
});
export type Failure = z.infer<typeof FailureSchema>;

export const HumanReviewSchema = z.object({
  id: IdSchema,
  caseRunId: IdSchema,
  runId: IdSchema,
  reviewer: z.string().default('local-reviewer'),
  verdict: z.enum(HUMAN_VERDICTS),
  comment: z.string().default(''),
  failureCategory: z.enum(FAILURE_CATEGORIES).nullable().default(null),
  /** 人工结论不覆盖机器结论 —— 两者都保存 */
  machineVerdict: z.enum(CASE_RUN_STATUSES),
  machineSnapshot: z.array(JsonObjectSchema).default([]),
  overridesMachine: z.boolean().default(false),
  createdAt: IsoDateSchema,
});
export type HumanReview = z.infer<typeof HumanReviewSchema>;

// ─────────────────────────────────────────────────────────────
// Run / CaseRun
// ─────────────────────────────────────────────────────────────

export const RunConfigSchema = z.object({
  concurrency: z.number().int().positive().max(16).default(2),
  timeoutMs: z.number().int().positive().default(30_000),
  retries: z.number().int().min(0).max(5).default(0),
  mode: z.enum(['full', 'smoke']).default('full'),
  seed: z.number().int().default(42),
  promptPrivacy: z.enum(['store_full', 'store_redacted', 'store_metadata_only']).default('store_full'),
  /** smoke 模式下最多跑多少 case */
  smokeLimit: z.number().int().positive().default(5),
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const ReproducibilitySnapshotSchema = z.object({
  agentVersionId: IdSchema,
  agentVersion: z.number().int(),
  promptVersionId: IdSchema,
  promptHash: z.string(),
  datasetVersionId: IdSchema,
  datasetVersion: z.number().int(),
  datasetContentHash: z.string().default(''),
  evaluatorSetId: IdSchema,
  evaluatorKeys: z.array(z.string()).default([]),
  evaluatorVersions: z.record(z.string(), z.string()).default({}),
  modelConfig: ModelConfigSchema,
  runtimeConfig: RuntimeConfigSchema,
  runConfig: RunConfigSchema,
  seed: z.number().int().default(42),
  platformVersion: z.string().default('0.1.0'),
  startedAt: IsoDateSchema,
});
export type ReproducibilitySnapshot = z.infer<typeof ReproducibilitySnapshotSchema>;

export const RunUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().nullable().default(null),
  costSource: z.enum(['provider', 'configured', 'unknown', 'mixed']).default('unknown'),
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

export const EvaluationRunSchema = z.object({
  id: IdSchema,
  agentId: IdSchema,
  agentVersionId: IdSchema,
  datasetId: IdSchema,
  datasetVersionId: IdSchema,
  evaluatorSetId: IdSchema,
  status: z.enum(RUN_STATUSES).default('queued'),
  mode: z.enum(['full', 'smoke']).default('full'),
  runConfig: RunConfigSchema,
  caseCount: z.number().int().nonnegative().default(0),
  passed: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  partial: z.number().int().nonnegative().default(0),
  errored: z.number().int().nonnegative().default(0),
  usage: RunUsageSchema,
  durationMs: z.number().nonnegative().default(0),
  baselineRunId: z.string().nullable().default(null),
  isBaseline: z.boolean().default(false),
  reproducibility: ReproducibilitySnapshotSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  triggeredBy: z.string().default('local'),
  startedAt: IsoDateSchema,
  completedAt: IsoDateSchema.nullable().default(null),
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export const CaseRunSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  testCaseId: IdSchema,
  testCaseName: z.string().default(''),
  priority: z.enum(PRIORITIES).default('normal'),
  tags: z.array(z.string()).default([]),
  status: z.enum(CASE_RUN_STATUSES).default('passed'),
  machineVerdict: z.enum(CASE_RUN_STATUSES).default('passed'),
  finalOutput: z.string().default(''),
  outputJson: z.unknown().nullable().default(null),
  traceId: z.string().nullable().default(null),
  usage: RunUsageSchema,
  latencyMs: z.number().nonnegative().default(0),
  modelLatencyMs: z.number().nonnegative().default(0),
  toolLatencyMs: z.number().nonnegative().default(0),
  retrievalLatencyMs: z.number().nonnegative().default(0),
  attempt: z.number().int().positive().default(1),
  failureCategory: z.enum(FAILURE_CATEGORIES).nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: IsoDateSchema,
});
export type CaseRun = z.infer<typeof CaseRunSchema>;

// ─────────────────────────────────────────────────────────────
// Regression / Gate / Suggestion / Job / Rubric
// ─────────────────────────────────────────────────────────────

export const RegressionSchema = z.object({
  id: IdSchema,
  kind: z.enum(['case', 'metric', 'latency', 'cost']),
  severity: z.enum(SEVERITIES).default('major'),
  caseRunId: z.string().nullable().default(null),
  testCaseId: z.string().nullable().default(null),
  testCaseName: z.string().default(''),
  metricKey: z.string().nullable().default(null),
  baselineValue: z.number().nullable().default(null),
  currentValue: z.number().nullable().default(null),
  description: z.string(),
  evidence: z.array(EvidenceReferenceSchema).default([]),
});
export type Regression = z.infer<typeof RegressionSchema>;

export const ComparisonSchema = z.object({
  id: IdSchema,
  baseRunId: IdSchema,
  targetRunId: IdSchema,
  baseLabel: z.string().default(''),
  targetLabel: z.string().default(''),
  metricDiffs: z
    .array(
      z.object({
        metricKey: z.string(),
        name: z.string().default(''),
        base: z.number().nullable(),
        target: z.number().nullable(),
        delta: z.number().nullable(),
        direction: z.enum(['higher_is_better', 'lower_is_better', 'neutral']).default('higher_is_better'),
        improved: z.boolean().nullable().default(null),
      }),
    )
    .default([]),
  fixedCases: z.array(JsonObjectSchema).default([]),
  regressedCases: z.array(JsonObjectSchema).default([]),
  bothPassed: z.number().int().nonnegative().default(0),
  bothFailed: z.number().int().nonnegative().default(0),
  regressions: z.array(RegressionSchema).default([]),
  createdAt: IsoDateSchema,
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const GateRuleSchema = z.object({
  id: z.string().min(1),
  metricKey: z.string().min(1),
  op: z.enum(['>=', '<=', '>', '<', '==']),
  value: z.number(),
  /** overall = 全体 case；critical = 仅 critical 优先级 case；tag / category = 限定子集 */
  scope: z.enum(['overall', 'critical', 'tag', 'category']).default('overall'),
  scopeValue: z.string().default(''),
  blocking: z.boolean().default(true),
  description: z.string().default(''),
});
export type GateRule = z.infer<typeof GateRuleSchema>;

export const ReleaseGateSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().default(''),
  agentId: IdSchema,
  rules: z.array(GateRuleSchema).default([]),
  requireCriticalPass: z.boolean().default(true),
  requireNoRegression: z.boolean().default(false),
  enabled: z.boolean().default(true),
  createdAt: IsoDateSchema,
});
export type ReleaseGate = z.infer<typeof ReleaseGateSchema>;

export const GateRuleResultSchema = z.object({
  ruleId: z.string(),
  description: z.string().default(''),
  metricKey: z.string(),
  scope: z.enum(['overall', 'critical', 'tag', 'category']).default('overall'),
  scopeValue: z.string().default(''),
  op: z.string(),
  expected: z.number(),
  actual: z.number().nullable(),
  result: z.enum(RELEASE_GATE_RESULTS),
  blocking: z.boolean(),
  explanation: z.string().default(''),
  evidence: z.array(EvidenceReferenceSchema).default([]),
});
export type GateRuleResult = z.infer<typeof GateRuleResultSchema>;

export const ReleaseDecisionSchema = z.object({
  id: IdSchema,
  gateId: IdSchema,
  gateName: z.string().default(''),
  runId: IdSchema,
  agentId: IdSchema,
  agentVersionId: IdSchema,
  result: z.enum(RELEASE_GATE_RESULTS),
  ruleResults: z.array(GateRuleResultSchema).default([]),
  explanation: z.string().default(''),
  blockingFailures: z.number().int().nonnegative().default(0),
  regressionCount: z.number().int().nonnegative().default(0),
  decidedAt: IsoDateSchema,
});
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;

export const OptimizationSuggestionSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  agentId: IdSchema,
  agentVersionId: IdSchema,
  category: z.enum(SUGGESTION_CATEGORIES),
  title: z.string(),
  detail: z.string().default(''),
  /** 必须给出可核对的证据，禁止“建议优化 Prompt”式空话 */
  evidence: z.array(EvidenceReferenceSchema).default([]),
  affectedCases: z.array(z.string()).default([]),
  impact: z.enum(['low', 'medium', 'high']).default('medium'),
  confidence: z.number().min(0).max(1).default(0.5),
  generator: z.enum(['rule', 'llm']).default('rule'),
  status: z.enum(['new', 'accepted', 'dismissed', 'promoted']).default('new'),
  createdAt: IsoDateSchema,
});
export type OptimizationSuggestion = z.infer<typeof OptimizationSuggestionSchema>;

export const PromptCandidateSchema = z.object({
  id: IdSchema,
  agentId: IdSchema,
  basePromptVersionId: IdSchema,
  systemPrompt: z.string(),
  taskPromptTemplate: z.string(),
  rationale: z.string().default(''),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  status: z.enum(['proposed', 'accepted', 'rejected']).default('proposed'),
  /** 绝不自动覆盖生产 Prompt —— 必须显式采用 */
  adoptedPromptVersionId: z.string().nullable().default(null),
  createdAt: IsoDateSchema,
});
export type PromptCandidate = z.infer<typeof PromptCandidateSchema>;

export const RubricCriterionSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  description: z.string().default(''),
  weight: z.number().nonnegative().default(1),
  scoreRange: z.object({ min: z.number(), max: z.number() }).default({ min: 0, max: 5 }),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const JudgeRubricSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().default(''),
  criteria: z.array(RubricCriterionSchema).default([]),
  passThreshold: z.number().min(0).max(1).default(0.7),
  isBuiltin: z.boolean().default(false),
  createdAt: IsoDateSchema,
});
export type JudgeRubric = z.infer<typeof JudgeRubricSchema>;

export const JudgeOutputSchema = z.object({
  score: z.number().min(0).max(1),
  pass: z.boolean(),
  reason: z.string(),
  evidence: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  criteriaScores: z
    .array(z.object({ key: z.string(), score: z.number(), comment: z.string().default('') }))
    .default([]),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export const AnalysisJobSchema = z.object({
  id: IdSchema,
  type: z.enum(['evaluation_run', 'post_analysis', 'dogfood', 'seed']),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).default('queued'),
  runId: z.string().nullable().default(null),
  progress: z.number().min(0).max(1).default(0),
  total: z.number().int().nonnegative().default(0),
  done: z.number().int().nonnegative().default(0),
  message: z.string().default(''),
  error: z.string().nullable().default(null),
  payload: JsonObjectSchema.default({}),
  createdAt: IsoDateSchema,
  startedAt: IsoDateSchema.nullable().default(null),
  completedAt: IsoDateSchema.nullable().default(null),
});
export type AnalysisJob = z.infer<typeof AnalysisJobSchema>;

export const ProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(PROVIDER_KINDS),
  available: z.boolean(),
  requiresApiKey: z.boolean(),
  isMock: z.boolean().default(false),
  models: z.array(z.string()).default([]),
  note: z.string().default(''),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ArtifactSchema = z.object({
  id: IdSchema,
  kind: z.enum(['dataset_json', 'dataset_csv', 'run_json', 'report_markdown', 'trace_json']),
  name: z.string(),
  runId: z.string().nullable().default(null),
  mime: z.string().default('application/json'),
  content: z.string().default(''),
  sizeBytes: z.number().int().nonnegative().default(0),
  createdAt: IsoDateSchema,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ─────────────────────────────────────────────────────────────
// 输入类型（z.input）：带 default() 的字段在构造时可选，由 parse 补齐默认值。
// 仓储层的「创建」入参一律使用这些类型，调用方无需手写全部默认字段。
// ─────────────────────────────────────────────────────────────

export type ModelConfigInput = z.input<typeof ModelConfigSchema>;
export type RuntimeConfigInput = z.input<typeof RuntimeConfigSchema>;
export type ToolDefinitionInput = z.input<typeof ToolDefinitionSchema>;
export type KnowledgeConfigInput = z.input<typeof KnowledgeConfigSchema>;
export type ExpectedOutcomeInput = z.input<typeof ExpectedOutcomeSchema>;
export type PromptVariableInput = z.input<typeof PromptVariableSchema>;
export type EvaluatorConfigInput = z.input<typeof EvaluatorConfigSchema>;
export type GateRuleInput = z.input<typeof GateRuleSchema>;
export type RunConfigInput = z.input<typeof RunConfigSchema>;
export type RunUsageInput = z.input<typeof RunUsageSchema>;
export type ReproducibilitySnapshotInput = z.input<typeof ReproducibilitySnapshotSchema>;
export type RubricCriterionInput = z.input<typeof RubricCriterionSchema>;
export type EvidenceReferenceInput = z.input<typeof EvidenceReferenceSchema>;
export type ExpectedToolArgInput = z.input<typeof ExpectedToolArgSchema>;
