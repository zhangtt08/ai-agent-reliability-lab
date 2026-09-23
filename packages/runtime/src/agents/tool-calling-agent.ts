import { extractJson, type RunUsage } from '@arl/shared';
import type { ChatMessage, GenerateRequest, ToolObservation } from '@arl/providers';
import {
  EMPTY_USAGE,
  addUsage,
  buildInitialMessages,
  createBudget,
  messagesAfterToolCall,
  privateFieldsFor,
  renderTaskPrompt,
  sameArguments,
  sleep,
  wantsJsonOutput,
  withProviderRetry,
} from '../internal';
import { retrieve, rewriteQuery } from '../retrieval';
import { createTraceCollector } from '../trace/collector';
import type { AgentRunResult, AgentRuntime, RuntimeInput, RunStopReason } from '../types';

/**
 * ToolCallingAgent —— 平台的默认运行时。
 *
 * 真实执行顺序（也就是 Trace 里的顺序）：
 *   [可选] retrieval → model_call → tool_call → tool_call … → model_call → output
 *
 * 行为约束（都是为了让评测结果可信）：
 *  - 只读 testCase.input/context，**看不到 expectedOutcome**。
 *  - 工具参数先过 schema 校验；不合法不执行。
 *  - loop guard：同一工具 + 同一参数重复超过阈值 → 判定 loop 并终止。
 *  - 步数 / 工具调用次数 / 时间预算三重上限。
 */
export function createToolCallingAgent(): AgentRuntime {
  return {
    id: 'tool-calling-agent',
    kind: 'tool-calling',

    async run(input: RuntimeInput): Promise<AgentRunResult> {
      const { version, prompt, testCase, provider, executor, runSignature } = input;
      const cfg = version.runtimeConfig;
      const timeoutMs = input.timeoutMs ?? cfg.timeoutMs;
      const budget = createBudget(timeoutMs);

      const collector = createTraceCollector({
        caseRunId: testCase.id,
        policy: cfg.promptPrivacy,
        sensitiveFields: privateFieldsFor(version),
      });

      const runStartedAt = Date.now();
      let usage: RunUsage = { ...EMPTY_USAGE };
      let modelLatencyMs = 0;
      let toolLatencyMs = 0;
      let retrievalLatencyMs = 0;
      let stopReason: RunStopReason = 'end_turn';
      let status: AgentRunResult['status'] = 'completed';
      let error: string | null = null;
      let finalOutput = '';
      let outputJson: unknown | null = null;
      const observations: ToolObservation[] = [];

      // ── 1) RAG 前置检索（knowledge.enabled 时） ──────────────────
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

      // ── 2) 工具调用循环 ───────────────────────────────────────────
      const responseFormat = wantsJsonOutput(prompt) ? 'json' : 'text';
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

      let messages: ChatMessage[] = buildInitialMessages(testCase, retrievedDocs);
      let modelCallIndex = 0;
      let stepsUsed = 0;

      while (stepsUsed < cfg.maxSteps) {
        if (budget.exhausted()) {
          stopReason = 'timeout';
          status = 'timeout';
          error = `超出时间预算 ${timeoutMs}ms`;
          collector.addError(error, { timeoutMs, elapsedMs: budget.elapsed() });
          break;
        }
        stepsUsed += 1;

        const request: GenerateRequest = {
          systemPrompt,
          messages,
          tools: version.tools.filter((t) => t.enabled),
          model: version.modelConfig.model,
          temperature: version.modelConfig.temperature,
          maxTokens: version.modelConfig.maxTokens,
          ...(version.modelConfig.seed !== undefined ? { seed: version.modelConfig.seed } : {}),
          responseFormat,
          metadata: {
            fixtureId: version.fixtureId || undefined,
            callIndex: modelCallIndex,
            caseInput: testCase.input,
            observations,
            retrievedDocs,
            knowledgeEnabled: Boolean(version.knowledge?.enabled),
            runSignature,
            providerPricing: version.modelConfig.pricing,
          },
        };

        let response;
        let attempts = 1;
        const retriedErrors: string[] = [];
        try {
          const outcome = await withProviderRetry(
            () => provider.generate(request),
            cfg.retry,
            (attempt, reason) => {
              retriedErrors.push(`attempt ${attempt}: ${reason}`);
              collector.addDecision('provider_retry', `基础设施类失败，按策略重试：${reason}`, { attempt, reason });
            },
          );
          response = outcome.value;
          attempts = outcome.attempts;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          status = 'failed';
          stopReason = 'error';
          error = message;
          collector.addModelCall({
            provider: provider.id,
            model: version.modelConfig.model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: null,
            costSource: 'unknown',
            latencyMs: 0,
            status: 'error',
            error: message,
            stopped: 'error',
            promptPayload: { systemPrompt, messages },
            outputPayload: null,
            summary: `模型调用失败：${message}`,
          });
          collector.addError(message, { retriedErrors });
          break;
        }

        modelCallIndex += 1;
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
          stopped: response.toolCall ? 'end_turn' : attempts > 1 ? 'end_turn' : 'end_turn',
          promptPayload: { systemPrompt, messages },
          outputPayload: response.toolCall ? { toolCall: response.toolCall, text: response.text } : response.text,
          summary: response.toolCall
            ? `模型决定调用工具 ${response.toolCall.name}`
            : `模型给出最终回答（${response.text.length} 字符）`,
          ...(response.note ? { note: response.note } : {}),
        });

        // ── 工具调用分支 ───────────────────────────────────────────
        if (response.toolCall) {
          const toolDef = version.tools.find((t) => t.name === response.toolCall!.name && t.enabled);
          const startedAt = new Date().toISOString();

          if (!toolDef) {
            const message = `模型请求了未定义或已禁用的工具：${response.toolCall.name}`;
            const observation: ToolObservation = {
              toolName: response.toolCall.name,
              arguments: response.toolCall.arguments,
              status: 'error',
              output: null,
              summary: message,
              error: message,
            };
            observations.push(observation);
            collector.addToolCall({
              toolName: response.toolCall.name,
              arguments: response.toolCall.arguments,
              validatedArguments: {},
              validationError: message,
              status: 'invalid_arguments',
              startedAt,
              endedAt: new Date().toISOString(),
              durationMs: 0,
              output: null,
              outputSummary: message,
              error: message,
              redactedPaths: [],
              attempt: 1,
            });
            messages = messagesAfterToolCall(messages, response.toolCall.name, response.toolCall.arguments, observation);
            continue;
          }

          const result = await executor.execute({
            tool: toolDef,
            args: response.toolCall.arguments,
            context: { runSignature, caseId: testCase.id, knowledge: version.knowledge?.documents ?? [] },
            timeoutMs: budget.remaining(),
            ...(input.signal ? { signal: input.signal } : {}),
          });
          toolLatencyMs += result.durationMs;

          const observation: ToolObservation = {
            toolName: toolDef.name,
            arguments: response.toolCall.arguments,
            status: result.status,
            output: result.output,
            summary: result.outputSummary,
            error: result.error,
          };
          observations.push(observation);

          collector.addToolCall({
            toolName: toolDef.name,
            arguments: response.toolCall.arguments,
            validatedArguments: result.status === 'invalid_arguments' ? {} : response.toolCall.arguments,
            validationError: result.validationError,
            status: result.status,
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: result.durationMs,
            output: result.output,
            outputSummary: result.outputSummary,
            error: result.error,
            redactedPaths: result.redactedPaths,
            attempt: 1,
          });

          // 检索类工具同时产生 RetrievalEvent（RAG Trace 需要结构化记录）
          if (toolDef.name === 'searchKnowledge' && result.status === 'ok') {
            const payload = result.output as { documents?: unknown[] } | null;
            const docs = Array.isArray(payload?.documents) ? payload!.documents : [];
            const { documents } = retrieve(String(response.toolCall.arguments['query'] ?? testCase.input), version.knowledge?.documents ?? [], {
              topK: version.knowledge?.topK ?? 3,
              mode: version.knowledge?.retrievalMode ?? 'keyword',
              scoreThreshold: version.knowledge?.scoreThreshold ?? 0.1,
            });
            collector.addRetrieval({
              query: String(response.toolCall.arguments['query'] ?? testCase.input),
              rewrittenQuery: rewriteQuery(String(response.toolCall.arguments['query'] ?? testCase.input)),
              mode: version.knowledge?.retrievalMode ?? 'keyword',
              topK: version.knowledge?.topK ?? 3,
              documents,
              selectedChunks: documents.map((d) => d.selectedChunk),
              latencyMs: result.durationMs,
              status: documents.length > 0 ? 'ok' : 'empty',
            });
            void docs;
          }

          messages = messagesAfterToolCall(messages, toolDef.name, response.toolCall.arguments, observation);

          const identical = observations.filter(
            (o) => o.toolName === toolDef.name && sameArguments(o.arguments, response.toolCall!.arguments),
          ).length;
          if (identical > cfg.loopGuard.maxIdenticalToolCalls) {
            stopReason = 'loop';
            status = 'failed';
            error = `检测到循环：${toolDef.name} 以相同参数被调用 ${identical} 次`;
            collector.addDecision('loop_guard_tripped', error, {
              toolName: toolDef.name,
              repeats: identical,
              threshold: cfg.loopGuard.maxIdenticalToolCalls,
            });
            collector.addError(error);
            break;
          }

          if (observations.length >= cfg.maxToolCalls) {
            stopReason = 'max_tool_calls';
            collector.addDecision('max_tool_calls_reached', `已达工具调用上限 ${cfg.maxToolCalls}，停止继续调用`, {
              maxToolCalls: cfg.maxToolCalls,
            });
            break;
          }

          continue;
        }

        // ── 最终回答分支 ───────────────────────────────────────────
        finalOutput = response.text;
        const parsed = extractJson<unknown>(response.text);
        outputJson = parsed.ok ? parsed.value : null;
        collector.addOutput(response.text, outputJson);
        stopReason = 'end_turn';
        status = 'completed';
        break;
      }

      if (stepsUsed >= cfg.maxSteps && stopReason === 'end_turn' && finalOutput === '') {
        stopReason = 'max_steps';
        collector.addDecision('max_steps_reached', `达到最大步数 ${cfg.maxSteps} 仍未给出最终回答`, { maxSteps: cfg.maxSteps });
      }

      const durationMs = Date.now() - runStartedAt;
      const bundle = collector.finish(status === 'completed' ? 'ok' : 'error');

      return {
        status,
        stopReason,
        finalOutput,
        outputJson,
        bundle,
        usage,
        durationMs,
        modelLatencyMs,
        toolLatencyMs,
        retrievalLatencyMs,
        error,
        observations,
      };
    },
  };
}
