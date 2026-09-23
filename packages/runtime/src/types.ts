import type { ModelProvider, ToolObservation } from '@arl/providers';
import type {
  AgentVersion,
  KnowledgeDocument,
  ModelCall,
  PromptVersion,
  RetrievalEvent,
  RunUsage,
  ToolCall,
  ToolDefinition,
  Trace,
  TraceStep,
} from '@arl/shared';

/**
 * Runtime 与 Provider 完全解耦：runtime 只依赖 ModelProvider 接口。
 * 想接外部 Agent（HTTP / CLI）时，实现 AgentRuntime 即可，核心系统无需改动。
 */

export interface ToolExecutionRequest {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  /** 用于让同一个 run 内的 fixture 行为保持一致 */
  context: { runSignature: string; caseId: string; knowledge: KnowledgeDocument[] };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  status: 'ok' | 'error' | 'timeout' | 'invalid_arguments';
  output: unknown;
  outputSummary: string;
  error: string | null;
  validationError: string | null;
  durationMs: number;
  /** 输出中被脱敏的字段路径 */
  redactedPaths: string[];
}

export interface ToolExecutor {
  readonly id: string;
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
  /** 暴露 fixture 工具能力清单，用于种子数据与 UI 展示 */
  availableTools(): string[];
}

export interface TraceBundle {
  trace: Trace;
  steps: TraceStep[];
  modelCalls: ModelCall[];
  toolCalls: ToolCall[];
  retrievals: RetrievalEvent[];
}

export type RunStopReason =
  | 'end_turn'
  | 'max_steps'
  | 'max_tool_calls'
  | 'loop'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'provider_unavailable';

export interface AgentRunResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  stopReason: RunStopReason;
  finalOutput: string;
  outputJson: unknown | null;
  bundle: TraceBundle;
  usage: RunUsage;
  durationMs: number;
  modelLatencyMs: number;
  toolLatencyMs: number;
  retrievalLatencyMs: number;
  error: string | null;
  observations: ToolObservation[];
}

/**
 * 运行一个 TestCase 所需的**全部**信息。
 * 注意：这里**没有** expectedOutcome —— Runtime 绝不允许看到期望答案，
 * 否则评测就变成了「让被测对象照着答案抄」。
 */
export interface RuntimeCase {
  id: string;
  name: string;
  input: string;
  context: string;
  metadata: Record<string, unknown>;
  tags: string[];
}

export interface RuntimeInput {
  version: AgentVersion;
  prompt: PromptVersion;
  testCase: RuntimeCase;
  provider: ModelProvider;
  executor: ToolExecutor;
  /** 覆盖 version.runtimeConfig.timeoutMs */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 同一次 Run 的签名，用于让 mock 行为可复现（seed 派生） */
  runSignature: string;
}

export interface AgentRuntime {
  readonly id: string;
  readonly kind: AgentVersion['runtimeKind'];
  run(input: RuntimeInput): Promise<AgentRunResult>;
}
