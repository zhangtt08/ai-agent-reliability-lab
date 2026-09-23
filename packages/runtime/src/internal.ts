import { ProviderRequestError, type ChatMessage, type ToolObservation } from '@arl/providers';
import type { AgentVersion, PromptVersion, RetrievedDocument, RunUsage, RuntimeConfig } from '@arl/shared';
import type { RuntimeCase } from './types';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const EMPTY_USAGE: RunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: null,
  costSource: 'unknown',
};

export function addUsage(target: RunUsage, delta: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null; costSource: RunUsage['costSource'] }): RunUsage {
  const costUsd = target.costUsd === null || delta.costUsd === null ? null : Number((target.costUsd + delta.costUsd).toFixed(6));
  const costSource: RunUsage['costSource'] =
    costUsd === null ? 'unknown' : target.costSource === 'unknown' ? delta.costSource : target.costSource === delta.costSource ? target.costSource : 'mixed';
  return {
    inputTokens: target.inputTokens + delta.inputTokens,
    outputTokens: target.outputTokens + delta.outputTokens,
    totalTokens: target.totalTokens + delta.totalTokens,
    costUsd,
    costSource,
  };
}

/** 模板渲染：支持 {{input}} / {{context}} / {{question}} / {{retrieved}} */
export function renderTaskPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_m, key: string) => values[key] ?? '');
}

export function buildRetrievedBlock(docs: RetrievedDocument[]): string {
  if (docs.length === 0) return '';
  const lines = docs.map((d) => `- 《${d.title}》（score=${d.score}）: ${d.selectedChunk}`);
  return `\n[RETRIEVED_CONTEXT]\n${lines.join('\n')}\n[/RETRIEVED_CONTEXT]`;
}

export function buildInitialMessages(testCase: RuntimeCase, docs: RetrievedDocument[]): ChatMessage[] {
  const contextBlock = testCase.context ? `\n[USER_CONTEXT]\n${testCase.context}\n[/USER_CONTEXT]` : '';
  return [{ role: 'user', content: `${testCase.input}${contextBlock}${buildRetrievedBlock(docs)}` }];
}

export function messagesAfterToolCall(messages: ChatMessage[], toolName: string, args: Record<string, unknown>, observation: ToolObservation): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: JSON.stringify({ tool_call: { name: toolName, arguments: args } }) },
    {
      role: 'tool',
      toolName,
      content:
        observation.status === 'ok'
          ? JSON.stringify(observation.output)
          : JSON.stringify({ error: observation.error ?? observation.summary }),
    },
  ];
}

export function wantsJsonOutput(prompt: PromptVersion): boolean {
  return /json/i.test(`${prompt.systemPrompt}\n${prompt.taskPromptTemplate}`);
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
  retriedErrors: string[];
}

/**
 * 重试策略：**只对基础设施类失败重试**（限流 / provider 报错）。
 * Agent 答错了不是「失败」，绝不该重试掩盖问题。
 */
export async function withProviderRetry<T>(
  fn: () => Promise<T>,
  config: RuntimeConfig['retry'],
  onRetry?: (attempt: number, reason: string) => void,
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, config.maxAttempts);
  const retryOn = new Set(config.retryOn);
  const errors: string[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await fn();
      return { value, attempts: attempt, retriedErrors: errors };
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof ProviderRequestError && err.retryable && (retryOn.has(err.kind === 'rate_limit' ? 'rate_limit' : 'provider_error') || retryOn.has('provider_error'));
      errors.push(err instanceof Error ? err.message : String(err));
      if (!retryable || attempt === maxAttempts) break;
      onRetry?.(attempt, err instanceof Error ? err.message : String(err));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createBudget(timeoutMs: number) {
  const startedAt = Date.now();
  return {
    elapsed: () => Date.now() - startedAt,
    exhausted: () => Date.now() - startedAt >= timeoutMs,
    remaining: () => Math.max(0, timeoutMs - (Date.now() - startedAt)),
  };
}

export function privateFieldsFor(version: AgentVersion): string[] {
  return Array.from(new Set(version.tools.flatMap((t) => t.sensitiveFields)));
}

export function sameArguments(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)));
}
