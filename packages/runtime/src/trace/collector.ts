import {
  ids,
  nowIso,
  redactPayload,
  type ModelCall,
  type RedactionPolicy,
  type RetrievalEvent,
  type RetrievedDocument,
  type ToolCall,
  type Trace,
  type TraceStep,
  type TraceStepType,
} from '@arl/shared';
import type { TraceBundle } from '../types';

export interface TraceCollectorOptions {
  caseRunId: string;
  policy: RedactionPolicy;
  sensitiveFields?: string[];
  traceId?: string;
  /** 模型输出前的 prompt 预览长度 */
  previewChars?: number;
}

export interface ModelCallInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  costSource: ModelCall['costSource'];
  latencyMs: number;
  status: 'ok' | 'error';
  error?: string | null;
  stopped?: ModelCall['stopped'];
  /** 完整 prompt 与输出（落库前按 policy 脱敏） */
  promptPayload: unknown;
  outputPayload: unknown;
  summary: string;
  note?: string;
}

export interface ToolCallInput {
  toolName: string;
  arguments: Record<string, unknown>;
  validatedArguments: Record<string, unknown>;
  validationError: string | null;
  status: ToolCall['status'];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  output: unknown;
  outputSummary: string;
  error: string | null;
  redactedPaths: string[];
  attempt: number;
}

export interface RetrievalInput {
  query: string;
  rewrittenQuery: string;
  mode: RetrievalEvent['mode'];
  topK: number;
  documents: RetrievedDocument[];
  selectedChunks: string[];
  latencyMs: number;
  status: RetrievalEvent['status'];
}

export interface TraceCollector {
  readonly traceId: string;
  addModelCall(input: ModelCallInput): ModelCall;
  addToolCall(input: ToolCallInput): ToolCall;
  addRetrieval(input: RetrievalInput): RetrievalEvent;
  addDecision(name: string, summary: string, payload?: Record<string, unknown>): TraceStep;
  addOutput(text: string, outputJson: unknown): TraceStep;
  addError(message: string, payload?: Record<string, unknown>): TraceStep;
  stepCount(): number;
  finish(status: Trace['status']): TraceBundle;
}

/**
 * Trace 采集器：所有 step / call 都带 id 与 seq，且**在写入前完成脱敏**。
 * 顺序即执行顺序（seq 单调递增），Trace Viewer 直接按 seq 渲染。
 */
export function createTraceCollector(options: TraceCollectorOptions): TraceCollector {
  const traceId = options.traceId ?? ids.trace();
  const policy = options.policy;
  const sensitiveFields = options.sensitiveFields ?? [];
  const previewChars = options.previewChars ?? 2000;
  const startedAt = nowIso();

  const steps: TraceStep[] = [];
  const modelCalls: ModelCall[] = [];
  const toolCalls: ToolCall[] = [];
  const retrievals: RetrievalEvent[] = [];
  let seq = 0;

  function pushStep(step: Omit<TraceStep, 'id' | 'traceId' | 'seq'>): TraceStep {
    const record: TraceStep = {
      ...step,
      id: ids.traceStep(),
      traceId,
      seq,
    };
    seq += 1;
    steps.push(record);
    return record;
  }

  return {
    traceId,

    addModelCall(input) {
      const step = pushStep({
        type: 'model_call',
        name: `${input.provider}/${input.model}`,
        status: input.status,
        startedAt: nowIso(),
        endedAt: nowIso(),
        durationMs: input.latencyMs,
        summary: input.summary,
        payload: {
          provider: input.provider,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          costUsd: input.costUsd,
          costSource: input.costSource,
          ...(input.note ? { note: input.note } : {}),
        },
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });

      const prompt = redactPayload(input.promptPayload, { policy, sensitiveFields, previewChars });
      const output = redactPayload(input.outputPayload, { policy, sensitiveFields, previewChars });

      const record: ModelCall = {
        id: ids.modelCall(),
        traceId,
        stepId: step.id,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        costUsd: input.costUsd,
        costSource: input.costSource,
        latencyMs: input.latencyMs,
        status: input.status,
        error: input.error ?? null,
        promptMode: policy,
        promptPreview: prompt.stored,
        outputPreview: output.stored,
        stopped: input.stopped ?? 'end_turn',
      };
      modelCalls.push(record);
      step.modelCallId = record.id;
      step.payload['promptOmitted'] = prompt.omitted;
      step.payload['promptBytes'] = prompt.byteLength;
      step.payload['redactedPaths'] = [...prompt.redactedPaths, ...output.redactedPaths];
      return record;
    },

    addToolCall(input) {
      const step = pushStep({
        type: 'tool_call',
        name: input.toolName,
        status: input.status === 'ok' ? 'ok' : 'error',
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationMs: input.durationMs,
        summary: input.outputSummary,
        payload: {
          arguments: input.arguments,
          validatedArguments: input.validatedArguments,
          validationError: input.validationError,
          error: input.error,
          redactedPaths: input.redactedPaths,
          attempt: input.attempt,
        },
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });

      const record: ToolCall = {
        id: ids.toolCall(),
        traceId,
        stepId: step.id,
        seq: toolCalls.length,
        toolName: input.toolName,
        arguments: input.arguments,
        validatedArguments: input.validatedArguments,
        validationError: input.validationError,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationMs: input.durationMs,
        outputSummary: input.outputSummary,
        outputJson: input.output,
        error: input.error,
        redactedPaths: input.redactedPaths,
        attempt: input.attempt,
      };
      toolCalls.push(record);
      step.toolCallId = record.id;
      return record;
    },

    addRetrieval(input) {
      const step = pushStep({
        type: 'retrieval',
        name: `retrieve(${input.mode})`,
        status: input.status === 'ok' ? 'ok' : input.status === 'error' ? 'error' : 'skipped',
        startedAt: nowIso(),
        endedAt: nowIso(),
        durationMs: input.latencyMs,
        summary: `命中 ${input.documents.length} 条（topK=${input.topK}）`,
        payload: {
          query: input.query,
          rewrittenQuery: input.rewrittenQuery,
          documents: input.documents.map((d) => ({ id: d.id, title: d.title, score: d.score, rank: d.rank })),
        },
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });

      const record: RetrievalEvent = {
        id: ids.retrieval(),
        traceId,
        stepId: step.id,
        query: input.query,
        rewrittenQuery: input.rewrittenQuery,
        mode: input.mode,
        topK: input.topK,
        documents: input.documents,
        selectedChunks: input.selectedChunks,
        latencyMs: input.latencyMs,
        status: input.status,
      };
      retrievals.push(record);
      step.retrievalId = record.id;
      return record;
    },

    addDecision(name, summary, payload = {}) {
      return pushStep({
        type: 'decision',
        name,
        status: 'ok',
        startedAt: nowIso(),
        endedAt: nowIso(),
        durationMs: 0,
        summary,
        payload,
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });
    },

    addOutput(text, outputJson) {
      return pushStep({
        type: 'output',
        name: 'final_output',
        status: 'ok',
        startedAt: nowIso(),
        endedAt: nowIso(),
        durationMs: 0,
        summary: text.length > 160 ? `${text.slice(0, 160)}…` : text,
        payload: {
          length: text.length,
          parsedAsJson: outputJson !== null,
          output: redactPayload(text, { policy, sensitiveFields, previewChars }).stored,
        },
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });
    },

    addError(message, payload = {}) {
      return pushStep({
        type: 'error',
        name: 'error',
        status: 'error',
        startedAt: nowIso(),
        endedAt: nowIso(),
        durationMs: 0,
        summary: message,
        payload: { message, ...payload },
        modelCallId: null,
        toolCallId: null,
        retrievalId: null,
      });
    },

    stepCount() {
      return steps.length;
    },

    finish(status) {
      const trace: Trace = {
        id: traceId,
        caseRunId: options.caseRunId,
        status,
        stepCount: steps.length,
        totalDurationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
        redactionPolicy: policy,
        createdAt: startedAt,
      };
      return { trace, steps, modelCalls, toolCalls, retrievals };
    },
  };
}

export function countByType(steps: TraceStep[], type: TraceStepType): number {
  return steps.filter((s) => s.type === type).length;
}
