import { extractJson } from '@arl/shared';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import {
  computeCost,
  computeUsage,
  serializeRequestInput,
  type GenerateRequest,
  type GenerateResponse,
  type ModelProvider,
  type StructuredGenerateResponse,
} from './types';
import { ProviderRequestError } from './mock-provider';

export interface OpenAiCompatibleOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
  models?: string[];
  /** 允许注入 fetch（测试用），默认全局 fetch */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenAI-compatible provider（真实网络实现）。
 *
 * 设计要点：
 *  - 未配置 API Key 时 `info.available = false`，registry 会明确标注「不可用」，
 *    绝不静默回退到 mock 冒充真实调用。
 *  - 凭据只存在内存中的 requests header，不写日志、不进 trace（trace 里只留模型名与 usage）。
 */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): ModelProvider {
  const id = options.id ?? 'openai-compatible';
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const available = Boolean(options.apiKey);

  const call = async (req: GenerateRequest): Promise<{ text: string; toolCall: GenerateResponse['toolCall']; usage: GenerateResponse['usage']; latencyMs: number }> => {
    if (!available) {
      throw new ProviderRequestError('provider_error', `${id}: 未配置 API Key，provider 不可用`);
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = {
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.systemPrompt },
          ...req.messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
        ],
        ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        ...(req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      };

      const res = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429) throw new ProviderRequestError('rate_limit', `${id}: 429 rate limited`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProviderRequestError('provider_error', `${id}: HTTP ${res.status} ${text.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const message = json.choices?.[0]?.message;
      const toolCallRaw = message?.tool_calls?.[0]?.function;
      const parsedArgs = toolCallRaw?.arguments ? extractJson<Record<string, unknown>>(toolCallRaw.arguments) : null;

      const usage = {
        inputTokens: json.usage?.prompt_tokens ?? computeUsage(serializeRequestInput(req), '').inputTokens,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      };
      if (usage.totalTokens === 0) usage.totalTokens = usage.inputTokens + usage.outputTokens;

      return {
        text: message?.content ?? '',
        toolCall:
          toolCallRaw?.name && parsedArgs?.ok
            ? { name: toolCallRaw.name, arguments: parsedArgs.value }
            : toolCallRaw?.name
              ? { name: toolCallRaw.name, arguments: {} }
              : null,
        usage,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id,
    info: {
      id,
      name: 'OpenAI-compatible',
      kind: 'openai-compatible',
      available,
      requiresApiKey: true,
      isMock: false,
      models: options.models ?? ['gpt-4o-mini'],
      note: available
        ? '已配置 API Key，将发起真实网络调用（产生真实费用）。'
        : '未配置 API Key，不可用。平台不会用它冒充真实调用。',
    },

    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      const res = await call(req);
      const usage = res.usage;
      const cost = computeCost(usage, req.metadata.providerPricing ?? null);
      return {
        text: res.text,
        toolCall: res.toolCall,
        usage,
        costUsd: cost.costUsd,
        costSource: cost.costSource,
        latencyMs: res.latencyMs,
        provider: id,
        model: req.model,
        finishReason: res.toolCall ? 'tool_call' : 'stop',
        error: null,
      };
    },

    async generateStructured<S extends ZodTypeAny>(req: GenerateRequest, schema: S): Promise<StructuredGenerateResponse<ZodInfer<S>>> {
      const res = await call({ ...req, responseFormat: 'json' });
      const extracted = extractJson<unknown>(res.text);
      const validated = extracted.ok ? schema.safeParse(extracted.value) : null;
      const ok = Boolean(validated && validated.success);
      const cost = computeCost(res.usage, req.metadata.providerPricing ?? null);
      return {
        value: ok ? (validated!.data as ZodInfer<S>) : null,
        raw: res.text,
        parseAttempts: 1,
        fallbackUsed: !ok,
        parseError: ok ? null : validated && !validated.success ? validated.error.issues.map((i) => i.message).join('; ') : extracted.ok ? 'schema 校验失败' : extracted.error,
        usage: res.usage,
        latencyMs: res.latencyMs,
        costUsd: cost.costUsd,
        costSource: cost.costSource,
      };
    },
  };
}
