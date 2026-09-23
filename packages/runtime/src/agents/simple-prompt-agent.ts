import { extractJson, type RunUsage } from '@arl/shared';
import type { GenerateRequest } from '@arl/providers';
import {
  EMPTY_USAGE,
  addUsage,
  buildInitialMessages,
  createBudget,
  privateFieldsFor,
  renderTaskPrompt,
  sleep,
  wantsJsonOutput,
  withProviderRetry,
} from '../internal';
import { retrieve, rewriteQuery } from '../retrieval';
import { createTraceCollector } from '../trace/collector';
import type { AgentRunResult, AgentRuntime, RuntimeInput } from '../types';

/** 单轮 Prompt Agent：无工具、可带 RAG 前置检索。用于对照「纯提示词」与「工具型 Agent」的差别。 */
export function createSimplePromptAgent(): AgentRuntime {
  return {
    id: 'simple-prompt-agent',
    kind: 'simple-prompt',

    async run(input: RuntimeInput): Promise<AgentRunResult> {
      const { version, prompt, testCase, provider, runSignature } = input;
      const cfg = version.runtimeConfig;
      const timeoutMs = input.timeoutMs ?? cfg.timeoutMs;
      const budget = createBudget(timeoutMs);
      const collector = createTraceCollector({
        caseRunId: testCase.id,
        policy: cfg.promptPrivacy,
        sensitiveFields: privateFieldsFor(version),
      });
      const startedAt = Date.now();
      let usage: RunUsage = { ...EMPTY_USAGE };
      let retrievalLatencyMs = 0;
      let retrievedDocs: ReturnType<typeof retrieve>['documents'] = [];

      if (version.knowledge?.enabled) {
        const knowledge = version.knowledge;
        const outcome = retrieve(testCase.input, knowledge.documents, {
          topK: knowledge.topK,
          mode: knowledge.retrievalMode,
          scoreThreshold: knowledge.scoreThreshold,
        });
        const latency = Math.min(300, knowledge.simulatedLatencyMs);
        await sleep(latency);
        retrievalLatencyMs += latency;
        collector.addRetrieval({
          query: testCase.input,
          rewrittenQuery: rewriteQuery(testCase.input),
          mode: knowledge.retrievalMode,
          topK: knowledge.topK,
          documents: outcome.documents,
          selectedChunks: outcome.selectedChunks,
          latencyMs: latency,
          status: outcome.status,
        });
        retrievedDocs = outcome.documents;
      }

      const systemPrompt = [
        prompt.systemPrompt,
        prompt.taskPromptTemplate
          ? renderTaskPrompt(prompt.taskPromptTemplate, {
              input: testCase.input,
              context: testCase.context,
              question: testCase.input,
              retrieved: retrievedDocs.map((d) => `${d.title}: ${d.selectedChunk}`).join('\n'),
            })
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const request: GenerateRequest = {
        systemPrompt,
        messages: buildInitialMessages(testCase, retrievedDocs),
        tools: [],
        model: version.modelConfig.model,
        temperature: version.modelConfig.temperature,
        maxTokens: version.modelConfig.maxTokens,
        responseFormat: wantsJsonOutput(prompt) ? 'json' : 'text',
        metadata: {
          fixtureId: version.fixtureId || undefined,
          callIndex: 0,
          caseInput: testCase.input,
          observations: [],
          retrievedDocs,
          knowledgeEnabled: Boolean(version.knowledge?.enabled),
          runSignature,
          providerPricing: version.modelConfig.pricing,
        },
      };

      let status: AgentRunResult['status'] = 'completed';
      let error: string | null = null;
      let finalOutput = '';
      let modelLatencyMs = 0;

      try {
        if (budget.exhausted()) throw new Error(`超出时间预算 ${timeoutMs}ms`);
        const outcome = await withProviderRetry(() => provider.generate(request), cfg.retry, (attempt, reason) => {
          collector.addDecision('provider_retry', `基础设施类失败，按策略重试：${reason}`, { attempt, reason });
        });
        const response = outcome.value;
        modelLatencyMs += response.latencyMs;
        usage = addUsage(usage, {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
          costUsd: response.costUsd,
          costSource: response.costSource,
        });
        collector.addModelCall({
          provider: response.provider,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
          costUsd: response.costUsd,
          costSource: response.costSource,
          latencyMs: response.latencyMs,
          status: 'ok',
          promptPayload: { systemPrompt, messages: request.messages },
          outputPayload: response.toolCall ? { toolCall: response.toolCall, text: response.text } : response.text,
          summary: `单轮回答（${response.text.length} 字符）`,
          ...(response.note ? { note: response.note } : {}),
        });

        if (response.toolCall) {
          // 单轮 agent 不执行工具：明确记为流程失败，而不是悄悄忽略
          error = `simple-prompt agent 不支持工具调用，但模型请求了 ${response.toolCall.name}`;
          status = 'failed';
          collector.addError(error, { toolName: response.toolCall.name });
        } else {
          finalOutput = response.text;
        }
      } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : String(err);
        collector.addError(error);
      }

      const parsed = extractJson<unknown>(finalOutput);
      const outputJson = parsed.ok ? parsed.value : null;
      if (finalOutput) collector.addOutput(finalOutput, outputJson);
      const bundle = collector.finish(status === 'completed' ? 'ok' : 'error');

      return {
        status,
        stopReason: status === 'completed' ? 'end_turn' : 'error',
        finalOutput,
        outputJson,
        bundle,
        usage,
        durationMs: Date.now() - startedAt,
        modelLatencyMs,
        toolLatencyMs: 0,
        retrievalLatencyMs,
        error,
        observations: [],
      };
    },
  };
}
