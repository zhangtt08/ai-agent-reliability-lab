import { redactAny, validateSchemaLite, type KnowledgeDocument, type ToolDefinition } from '@arl/shared';
import { defaultKnowledgeDocuments, createFixtureHandlers, FixtureToolError, type FixtureHandlerContext } from './fixtures';
import type { ToolExecutionRequest, ToolExecutionResult, ToolExecutor } from '../types';

export interface FixtureExecutorOptions {
  knowledge?: KnowledgeDocument[];
  /** 把 fixture 延迟整体缩放，测试里可设为 0 提速 */
  latencyScale?: number;
  /** 每天花板：避免伪造延迟拖慢评测 */
  maxLatencyMs?: number;
  runSignature?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function summarize(toolName: string, output: unknown, status: string): string {
  if (status !== 'ok') return `${toolName} 未成功返回`;
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (toolName === 'getOrder') return `订单 ${String(obj['orderId'])} 状态 ${String(obj['status'])}，重复扣款=${String(obj['duplicateCharge'])}`;
    if (toolName === 'searchKnowledge') {
      const docs = Array.isArray(obj['documents']) ? obj['documents'].length : 0;
      return `知识库命中 ${docs} 条`;
    }
    if (toolName === 'getBalance') return `余额 ¥${String(obj['balance'])}`;
    if (toolName === 'createTicket') return `已创建 ${String(obj['ticketId'])}`;
    if (toolName === 'lookupUser') return `用户 ${String(obj['name'])}（${String(obj['tier'])}）`;
    if (toolName === 'calculatePrice') return `总价 ¥${String(obj['total'])}`;
    if (toolName === 'refundOrder') return `退款受理 ${String(obj['refundId'])}`;
    const keys = Object.keys(obj).slice(0, 4).join(', ');
    return `${toolName} 返回字段：${keys}`;
  }
  return `${toolName} 返回 ${String(output).slice(0, 80)}`;
}

/**
 * Fixture Tool Executor —— 工具执行的唯一入口。
 *
 * 关键点：
 *  - 参数先过 JSON Schema 校验，不合法**不执行** handler，直接记 `invalid_arguments`。
 *  - 输出按 tool.sensitiveFields 脱敏，并把被脱敏的路径记进 trace。
 *  - 支持故障注入（error / timeout），用于验证「工具执行失败」能否被平台识别。
 */
export function createFixtureToolExecutor(options: FixtureExecutorOptions = {}): ToolExecutor {
  const knowledge = options.knowledge ?? defaultKnowledgeDocuments();
  const latencyScale = options.latencyScale ?? 1;
  const maxLatencyMs = options.maxLatencyMs ?? 400;
  const handlers = createFixtureHandlers();
  const ctx: FixtureHandlerContext = {
    knowledge,
    runSignature: options.runSignature ?? 'fixture',
    ticketCounter: { value: 0 },
  };

  return {
    id: 'fixture-tool-executor',
    availableTools: () => Object.keys(handlers),

    async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
      const { tool, args } = request;
      const startedAt = Date.now();

      if (!tool.enabled) {
        return {
          status: 'error',
          output: null,
          outputSummary: `工具 ${tool.name} 已被禁用`,
          error: `工具 ${tool.name} 已被禁用`,
          validationError: null,
          durationMs: 0,
          redactedPaths: [],
        };
      }

      const handler = handlers[tool.handlerRef || tool.name];
      if (!handler) {
        return {
          status: 'error',
          output: null,
          outputSummary: `未找到工具实现 ${tool.name}`,
          error: `未找到工具实现 ${tool.name}`,
          validationError: null,
          durationMs: 0,
          redactedPaths: [],
        };
      }

      const validation = validateSchemaLite(tool.inputSchema, args);
      if (!validation.valid) {
        const message = validation.errors.map((e) => `${e.path} ${e.message}`).join('; ');
        return {
          status: 'invalid_arguments',
          output: null,
          outputSummary: `参数校验失败：${message}`,
          error: null,
          validationError: message,
          durationMs: Date.now() - startedAt,
          redactedPaths: [],
        };
      }

      const latency = Math.min(maxLatencyMs, Math.round(tool.simulatedLatencyMs * latencyScale));
      if (latency > 0) await sleep(latency);

      if (tool.failureMode === 'timeout') {
        return {
          status: 'timeout',
          output: null,
          outputSummary: `${tool.name} 执行超时`,
          error: `工具 ${tool.name} 执行超时（>${latency}ms）`,
          validationError: null,
          durationMs: Date.now() - startedAt,
          redactedPaths: [],
        };
      }
      if (tool.failureMode === 'error') {
        return {
          status: 'error',
          output: null,
          outputSummary: `${tool.name} 返回错误`,
          error: `工具 ${tool.name} 内部错误（故障注入）`,
          validationError: null,
          durationMs: Date.now() - startedAt,
          redactedPaths: [],
        };
      }

      try {
        const raw = handler(args, ctx);
        const redacted = redactAny(raw, tool.sensitiveFields);
        return {
          status: 'ok',
          output: redacted.value,
          outputSummary: summarize(tool.name, redacted.value, 'ok'),
          error: null,
          validationError: null,
          durationMs: Date.now() - startedAt,
          redactedPaths: redacted.redactedPaths,
        };
      } catch (err) {
        const message = err instanceof FixtureToolError ? err.message : err instanceof Error ? err.message : String(err);
        return {
          status: 'error',
          output: null,
          outputSummary: `${tool.name} 执行失败：${message}`,
          error: message,
          validationError: null,
          durationMs: Date.now() - startedAt,
          redactedPaths: [],
        };
      }
    },
  };
}

/** 工具定义 + 执行器组合：把 fixture 工具直接挂到 agent version 上 */
export function withFixtureTools(tools: ToolDefinition[], names: string[]): ToolDefinition[] {
  const wanted = new Set(names);
  return tools.filter((t) => wanted.has(t.name)).map((t) => ({ ...t, enabled: true }));
}
