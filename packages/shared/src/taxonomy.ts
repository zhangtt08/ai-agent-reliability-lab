/** 失败分类法 / 优先级 / 状态机 —— 全平台共享的枚举真相 */

export const FAILURE_CATEGORIES = [
  'wrong_answer',
  'hallucination',
  'retrieval_failure',
  'tool_selection_failure',
  'tool_argument_failure',
  'tool_execution_failure',
  'missing_context',
  'instruction_failure',
  'format_failure',
  'loop',
  'timeout',
  'policy_failure',
  'partial_completion',
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export interface FailureCategoryMeta {
  category: FailureCategory;
  label: string;
  description: string;
  defaultSeverity: 'info' | 'minor' | 'major' | 'critical';
  /** 是否可由确定性证据判定（决定 FailureClassifier 是否必须调用 LLM） */
  deterministic: boolean;
}

export const FAILURE_TAXONOMY: Record<FailureCategory, FailureCategoryMeta> = {
  wrong_answer: {
    category: 'wrong_answer',
    label: '答案错误',
    description: '输出与期望结论不一致，且不属于幻觉或格式问题。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  hallucination: {
    category: 'hallucination',
    label: '幻觉',
    description: '输出包含检索上下文中不存在的事实断言。',
    defaultSeverity: 'critical',
    deterministic: false,
  },
  retrieval_failure: {
    category: 'retrieval_failure',
    label: '检索失败',
    description: '应召回的文档/切片未出现在检索结果中（召回问题，非生成问题）。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  tool_selection_failure: {
    category: 'tool_selection_failure',
    label: '工具选择错误',
    description: '该调的 Tool 没调，或调了不该调的 Tool。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  tool_argument_failure: {
    category: 'tool_argument_failure',
    label: '工具参数错误',
    description: '调用了正确的 Tool，但参数缺失 / 类型错 / 值错。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  tool_execution_failure: {
    category: 'tool_execution_failure',
    label: '工具执行失败',
    description: 'Tool 本身返回错误或超时。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  missing_context: {
    category: 'missing_context',
    label: '上下文缺失',
    description: 'TestCase 未提供必要 context，或 Agent 未读取已提供的信息。',
    defaultSeverity: 'minor',
    deterministic: false,
  },
  instruction_failure: {
    category: 'instruction_failure',
    label: '指令遵循失败',
    description: '违反 system / task prompt 中的显式约束。',
    defaultSeverity: 'major',
    deterministic: false,
  },
  format_failure: {
    category: 'format_failure',
    label: '格式失败',
    description: '未输出要求的 JSON / 结构 / 必需字段。',
    defaultSeverity: 'minor',
    deterministic: true,
  },
  loop: {
    category: 'loop',
    label: '循环',
    description: '重复相同 Tool 调用或重复相同动作，超步数仍未收敛。',
    defaultSeverity: 'critical',
    deterministic: true,
  },
  timeout: {
    category: 'timeout',
    label: '超时',
    description: '超出单 Case 时间预算被中止。',
    defaultSeverity: 'major',
    deterministic: true,
  },
  policy_failure: {
    category: 'policy_failure',
    label: '策略违规',
    description: '违反 forbiddenTool / mustNotContain / 风控约束。',
    defaultSeverity: 'critical',
    deterministic: true,
  },
  partial_completion: {
    category: 'partial_completion',
    label: '部分完成',
    description: '完成了主要目标的一部分，缺少次要子任务。',
    defaultSeverity: 'minor',
    deterministic: false,
  },
  unknown: {
    category: 'unknown',
    label: '未知',
    description: '证据不足以归入以上任何一类。',
    defaultSeverity: 'minor',
    deterministic: false,
  },
};

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const AGENT_VERSION_STATUSES = [
  'draft',
  'candidate',
  'validated',
  'released',
  'deprecated',
] as const;
export type AgentVersionStatus = (typeof AGENT_VERSION_STATUSES)[number];

export const DATASET_VERSION_STATUSES = ['draft', 'published', 'golden', 'archived'] as const;
export type DatasetVersionStatus = (typeof DATASET_VERSION_STATUSES)[number];

export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CASE_RUN_STATUSES = [
  'passed',
  'failed',
  'partial',
  'error',
  'timeout',
  'cancelled',
  'skipped',
] as const;
export type CaseRunStatus = (typeof CASE_RUN_STATUSES)[number];

export const EVALUATION_STATUSES = ['pass', 'fail', 'partial', 'error', 'skipped'] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const TRACE_STEP_TYPES = [
  'model_call',
  'tool_call',
  'retrieval',
  'decision',
  'output',
  'error',
] as const;
export type TraceStepType = (typeof TRACE_STEP_TYPES)[number];

export const RELEASE_GATE_RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'UNKNOWN'] as const;
export type ReleaseGateResult = (typeof RELEASE_GATE_RESULTS)[number];

export const HUMAN_VERDICTS = ['pass', 'fail', 'partial'] as const;
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number];

export const SUGGESTION_CATEGORIES = [
  'prompt',
  'tool',
  'rag',
  'runtime',
  'dataset',
  'guardrail',
] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export const PROVIDER_KINDS = [
  'mock',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'local',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const EVALUATOR_CATEGORIES = [
  'output',
  'tool',
  'rag',
  'format',
  'performance',
  'safety',
  'process',
] as const;
export type EvaluatorCategory = (typeof EVALUATOR_CATEGORIES)[number];
