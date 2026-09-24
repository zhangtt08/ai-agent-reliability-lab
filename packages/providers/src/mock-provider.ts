import type { ProviderInfo } from '@arl/shared';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { extractJson } from '@arl/shared';
import { builtinPolicies, MOCK_JUDGE_FIXTURE_ID } from './judge-mock';
import { resolvePolicy } from './fixture-policies';
import { toContext, type MockPolicy } from './mock-types';
import {
  computeCost,
  computeUsage,
  serializeRequestInput,
  type GenerateRequest,
  type GenerateResponse,
  type ModelProvider,
  type StreamChunk,
  type StructuredGenerateResponse,
} from './types';

/** Provider 侧的可重试故障（与「Agent 答错了」严格区分） */
export class ProviderRequestError extends Error {
  readonly kind: 'rate_limit' | 'provider_error';
  readonly retryable: boolean;
  constructor(kind: 'rate_limit' | 'provider_error', message: string) {
    super(message);
    this.name = 'ProviderRequestError';
    this.kind = kind;
    this.retryable = true;
  }
}

export interface MockProviderOptions {
  id?: string;
  /** 策略表：fixtureId → 行为。默认使用内置 fixture + judge 替身 */
  policies?: Record<string, MockPolicy>;
  /** 默认基础延迟（毫秒），让 latency 指标有真实可测的值 */
  baseLatencyMs?: number;
  /** 允许单次延迟上限，避免测试变慢 */
  maxLatencyMs?: number;
  /** 延迟缩放：测试/dogfood 时设为 0.05 可以大幅提速，同时保留相对快慢关系 */
  latencyScale?: number;
}

export interface MockModelProvider extends ModelProvider {
  registerPolicy(fixtureId: string, policy: MockPolicy): void;
  readonly policyIds: string[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * MockModelProvider —— 一等公民，不是「还没实现的占位」。
 *
 * 它的价值：
 *  1. 没有 API Key 也能跑通完整评测闭环（Demo Mode 的基石）。
 *  2. 行为确定、可脚本化 → 能构造出「工具选错 / 参数错 / 格式错 / 检索错 / 循环 / 幻觉」等
 *     各类缺陷 agent，用来证明平台**真的能发现问题**（见 EVAL_STATUS.md）。
 *
 * 它绝不伪装成真实模型：trace / 报告里 provider 一律标注为 `mock`，
 * 无价目表时 costSource 恒为 `unknown`。
 */
export function createMockModelProvider(options: MockProviderOptions = {}): MockModelProvider {
  const id = options.id ?? 'mock';
  const baseLatencyMs = options.baseLatencyMs ?? 10;
  const maxLatencyMs = options.maxLatencyMs ?? 1_200;
  const latencyScale = options.latencyScale ?? 1;
  const policies: Record<string, MockPolicy> = { ...builtinPolicies, ...(options.policies ?? {}) };

  const info: ProviderInfo = {
    id,
    name: 'Mock Provider（离线确定性）',
    kind: 'mock',
    available: true,
    requiresApiKey: false,
    isMock: true,
    models: ['mock-reliable-1', 'mock-deterministic-1'],
    note: '离线确定性 provider，用于 Demo / 测试 / fixture agent。usage 为估算值，无价目表时成本标记为 unknown。',
  };

  const provider: MockModelProvider = {
    id,
    info,
    policyIds: Object.keys(policies),

    registerPolicy(fixtureId, policy) {
      policies[fixtureId] = policy;
    },

    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const policy = resolvePolicy(req.metadata.fixtureId, policies);
      const ctx = toContext(req.systemPrompt, req.messages, req.tools, req.metadata);
      const decision = policy(ctx);
      const startedAt = Date.now();

      if (decision.kind === 'provider_error') {
        // 不 sleep：基础设施故障应当快速失败并由 runtime 的 retry 策略处理
        throw new ProviderRequestError(decision.failure, decision.message);
      }

      const latency = Math.min(maxLatencyMs, Math.round((decision.latencyMs ?? baseLatencyMs) * latencyScale));
      await sleep(latency);

      const inputText = serializeRequestInput(req);
      const outputText = decision.kind === 'final' ? decision.text : JSON.stringify({ tool: decision.toolName, args: decision.args });

      const usage = computeUsage(inputText, outputText);
      const cost = computeCost(usage, req.metadata.providerPricing ?? null);

      return {
        text: decision.kind === 'final' ? decision.text : '',
        toolCall: decision.kind === 'tool_call' ? { name: decision.toolName, arguments: decision.args } : null,
        usage,
        costUsd: cost.costUsd,
        costSource: cost.costSource,
        latencyMs: Date.now() - startedAt,
        provider: id,
        model: req.model,
        finishReason: decision.kind === 'tool_call' ? 'tool_call' : 'stop',
        error: null,
        note: decision.reasoning,
      };
    },

    /**
     * 结构化输出：Zod 校验 + 一次修复重试；仍失败则显式 fallback（fallbackUsed=true），
     * 绝不静默吞掉解析错误。
     */
    async generateStructured<S extends ZodTypeAny>(req: GenerateRequest, schema: S): Promise<StructuredGenerateResponse<ZodInfer<S>>> {
      const attempt = async (extra?: string): Promise<{ raw: string; usage: ReturnType<typeof computeUsage>; latencyMs: number; costUsd: number | null; costSource: ReturnType<typeof computeCost>['costSource'] }> => {
        const messages = extra
          ? [...req.messages, { role: 'user' as const, content: `${extra}\n只输出符合 schema 的 JSON，不要任何解释文字。` }]
          : req.messages;
        const res = await provider.generate({ ...req, messages, responseFormat: 'json' });
        return { raw: res.text, usage: res.usage, latencyMs: res.latencyMs, costUsd: res.costUsd, costSource: res.costSource };
      };

      const first = await attempt();
      const parsedFirst = parseStructured(first.raw, schema);
      if (parsedFirst.ok) {
        return {
          value: parsedFirst.value,
          raw: first.raw,
          parseAttempts: 1,
          fallbackUsed: false,
          parseError: null,
          usage: first.usage,
          latencyMs: first.latencyMs,
          costUsd: first.costUsd,
          costSource: first.costSource,
        };
      }

      const second = await attempt(`上一次输出无法解析为要求的 JSON：${parsedFirst.error}`);
      const parsedSecond = parseStructured(second.raw, schema);
      return {
        value: parsedSecond.ok ? parsedSecond.value : null,
        raw: parsedSecond.ok ? second.raw : first.raw,
        parseAttempts: 2,
        fallbackUsed: !parsedSecond.ok,
        parseError: parsedSecond.ok ? null : parsedSecond.error,
        usage: {
          inputTokens: first.usage.inputTokens + second.usage.inputTokens,
          outputTokens: first.usage.outputTokens + second.usage.outputTokens,
          totalTokens: first.usage.totalTokens + second.usage.totalTokens,
        },
        latencyMs: first.latencyMs + second.latencyMs,
        costUsd: first.costUsd === null || second.costUsd === null ? null : first.costUsd + second.costUsd,
        costSource: first.costSource === 'unknown' || second.costSource === 'unknown' ? 'unknown' : 'configured',
      };
    },

    async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
      const res = await provider.generate(req);
      const chunks = res.text.match(/.{1,24}/gs) ?? [];
      for (const chunk of chunks) {
        yield { delta: chunk, done: false };
      }
      yield { delta: '', done: true };
    },
  };

  return provider;
}

function parseStructured<S extends ZodTypeAny>(raw: string, schema: S): { ok: true; value: ZodInfer<S> } | { ok: false; error: string } {
  const extracted = extractJson<unknown>(raw);
  if (!extracted.ok) return { ok: false, error: `未找到 JSON：${extracted.error}` };
  const validated = schema.safeParse(extracted.value);
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: validated.data };
}

export { MOCK_JUDGE_FIXTURE_ID };
