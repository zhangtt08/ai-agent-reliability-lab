import type { ZodType } from 'zod';
import type { ModelConfig, ProviderInfo, RetrievedDocument, ToolDefinition } from '@arl/shared';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
}

export interface ToolObservation {
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'ok' | 'error' | 'timeout' | 'invalid_arguments';
  output: unknown;
  summary: string;
  error?: string | null;
}

export interface GenerateMetadata {
  /** fixture agent 的脚本 id；MockModelProvider 用它挑选确定性行为 */
  fixtureId?: string;
  /** 本次 Run 内第几次模型调用（0-based） */
  callIndex: number;
  /** 用例原始输入（= 首条 user message，模型的合法可见输入） */
  caseInput: string;
  /** 已完成的工具调用观测（模型在多轮里看到的工具结果） */
  observations: ToolObservation[];
  /** RAG 阶段检索到的文档（结构化传入，避免模型需要解析文本） */
  retrievedDocs: RetrievedDocument[];
  /** 知识库是否启用 */
  knowledgeEnabled: boolean;
  runSignature: string;
  /** agent 的价目表（可能为 null —— 此时成本必须标记为 unknown） */
  providerPricing?: ModelConfig['pricing'];
}

export interface GenerateRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  model: string;
  temperature: number;
  maxTokens: number;
  seed?: number;
  /** 期望输出格式；agent 的 prompt 里若要求 JSON，runtime 会把它置为 json */
  responseFormat?: 'text' | 'json';
  metadata: GenerateMetadata;
}

export type CostSource = 'provider' | 'configured' | 'unknown';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateResponse {
  text: string;
  /** 模型决定调用工具时给出（runtime 负责执行） */
  toolCall: { name: string; arguments: Record<string, unknown> } | null;
  usage: TokenUsage;
  costUsd: number | null;
  costSource: CostSource;
  latencyMs: number;
  provider: string;
  model: string;
  finishReason: 'stop' | 'tool_call' | 'length' | 'error';
  error: string | null;
  /** provider 侧的决策说明（mock 策略用来说明“为什么这样回答”），只进 trace，不进最终输出比对 */
  note?: string;
}

export interface StructuredGenerateResponse<T> {
  value: T | null;
  raw: string;
  parseAttempts: number;
  /** 解析失败后是否用兜底值填充（必须显式暴露，禁止静默降级） */
  fallbackUsed: boolean;
  parseError: string | null;
  usage: TokenUsage;
  latencyMs: number;
  costUsd: number | null;
  costSource: CostSource;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

/**
 * LLM Judge 的请求载荷约定（providers 与 evaluation 两个包共享的唯一契约）。
 * evaluation 负责按此格式拼 prompt；MockModelProvider 的 'arl-judge' 策略负责按同一格式应答。
 * 换成真实 provider 时，这段标记会原样出现在 prompt 里，模型输出同样被强制为 JSON。
 */
export const JUDGE_PAYLOAD_START = '[ARL_JUDGE_PAYLOAD]';
export const JUDGE_PAYLOAD_END = '[/ARL_JUDGE_PAYLOAD]';

export interface JudgePayload {
  rubric: { key: string; name: string; description: string; weight: number }[];
  expectedText: string;
  mustContain: string[];
  mustNotContain: string[];
  output: string;
  context: string[];
  passThreshold: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly info: ProviderInfo;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  generateStructured<T>(req: GenerateRequest, schema: ZodType<T>): Promise<StructuredGenerateResponse<T>>;
  stream?(req: GenerateRequest): AsyncIterable<StreamChunk>;
}

/**
 * Token 估算：CJK 字符按 1 token/字，其余按 4 字符/token。
 * 这是**估算**，不是真实计费数据 —— 因此 costSource 在无价目表时必须是 'unknown'。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export function computeUsage(inputText: string, outputText: string): TokenUsage {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

/**
 * 只有配置了价目表才计算成本，并把 costSource 标为 'configured'。
 * 没有价目表时返回 null / 'unknown' —— 绝不伪造真实费用。
 */
export function computeCost(usage: TokenUsage, pricing: ModelConfig['pricing']): { costUsd: number | null; costSource: CostSource } {
  if (!pricing) return { costUsd: null, costSource: 'unknown' };
  const cost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M + (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  return { costUsd: Number(cost.toFixed(6)), costSource: 'configured' };
}

export function serializeRequestInput(req: GenerateRequest): string {
  return [
    `[system]\n${req.systemPrompt}`,
    ...req.messages.map((m) => `[${m.role}${m.toolName ? `:${m.toolName}` : ''}]\n${m.content}`),
  ].join('\n');
}
