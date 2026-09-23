import type { RetrievedDocument, ToolDefinition } from '@arl/shared';
import type { ChatMessage, GenerateMetadata, ToolObservation } from './types';

export interface MockTurnContext {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  callIndex: number;
  caseInput: string;
  observations: ToolObservation[];
  retrievedDocs: RetrievedDocument[];
  knowledgeEnabled: boolean;
  metadata: GenerateMetadata;
}

export type MockTurnDecision =
  | { kind: 'tool_call'; toolName: string; args: Record<string, unknown>; latencyMs?: number; reasoning?: string }
  | { kind: 'final'; text: string; latencyMs?: number; reasoning?: string }
  | { kind: 'provider_error'; failure: 'rate_limit' | 'provider_error'; message: string };

export type MockPolicy = (ctx: MockTurnContext) => MockTurnDecision;

/** agent 的 prompt 是否要求 JSON 输出（决定 mock 的应答形态） */
export function wantsJson(ctx: MockTurnContext): boolean {
  return /json/i.test(ctx.systemPrompt);
}

export function toContext(
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  metadata: GenerateMetadata,
): MockTurnContext {
  return {
    systemPrompt,
    messages,
    tools,
    callIndex: metadata.callIndex,
    caseInput: metadata.caseInput,
    observations: metadata.observations,
    retrievedDocs: metadata.retrievedDocs,
    knowledgeEnabled: metadata.knowledgeEnabled,
    metadata,
  };
}
