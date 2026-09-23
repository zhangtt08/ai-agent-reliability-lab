import { composeAnswer, extractArgsForTool, pickToolForInput } from './answer-composer';
import { wantsJson, type MockPolicy, type MockTurnContext } from './mock-types';

/**
 * 默认启发式策略：给「用户自己在 UI 里新建的 agent」用。
 * 没有 API Key 时，Mock Provider 依然能给出结构合理、可评测的行为 —— 而不是返回一句占位文本。
 */
export const heuristicPolicy: MockPolicy = (ctx: MockTurnContext) => {
  const style = wantsJson(ctx) ? 'json' : 'text';

  if (ctx.observations.length === 0) {
    const pick = pickToolForInput(ctx.caseInput, ctx.tools);
    if (pick.tool) {
      return {
        kind: 'tool_call',
        toolName: pick.tool.name,
        args: extractArgsForTool(pick.tool, ctx.caseInput),
        latencyMs: 120,
        reasoning: pick.reason,
      };
    }
    return { kind: 'final', text: composeAnswer(ctx, style).text, latencyMs: 100, reasoning: '无匹配工具，直接作答' };
  }

  const calledKnowledge = ctx.observations.some((o) => o.toolName === 'searchKnowledge');
  const hasSearchTool = ctx.tools.some((t) => t.name === 'searchKnowledge' && t.enabled);
  if (ctx.knowledgeEnabled && hasSearchTool && !calledKnowledge && ctx.retrievedDocs.length === 0) {
    return {
      kind: 'tool_call',
      toolName: 'searchKnowledge',
      args: { query: ctx.caseInput },
      latencyMs: 120,
      reasoning: '自动检索未命中，主动查询知识库',
    };
  }

  return { kind: 'final', text: composeAnswer(ctx, style).text, latencyMs: 140 };
};

function firstToolName(ctx: MockTurnContext, preferred: string): string | null {
  const enabled = ctx.tools.filter((t) => t.enabled);
  return enabled.find((t) => t.name === preferred)?.name ?? enabled[0]?.name ?? null;
}

/** fixture agent 的确定性行为脚本。它们**不是**绕过 runtime 的假结果，而是真实跑在 tool-calling 循环里的假“大脑”。 */
export const fixturePolicies: Record<string, MockPolicy> = {
  /** A：行为合理的稳定 agent */
  'stable-agent': heuristicPolicy,

  /** B：工具选择错误 —— 无论问什么都去查余额 */
  'wrong-tool-agent': (ctx) => {
    if (ctx.observations.length === 0) {
      const tool = firstToolName(ctx, 'getBalance');
      if (!tool) return { kind: 'final', text: '当前没有可用工具。', latencyMs: 90 };
      return { kind: 'tool_call', toolName: tool, args: { userId: 'U-1001' }, latencyMs: 110, reasoning: '错误地选择了账户余额查询' };
    }
    return { kind: 'final', text: composeAnswer(ctx, wantsJson(ctx) ? 'json' : 'text').text, latencyMs: 110 };
  },

  /** C：参数错误 —— 订单号编造/缺失 */
  'wrong-args-agent': (ctx) => {
    if (ctx.observations.length === 0) {
      const tool = firstToolName(ctx, 'getOrder');
      if (!tool) return { kind: 'final', text: '无可用工具。', latencyMs: 80 };
      return { kind: 'tool_call', toolName: tool, args: { orderId: '' }, latencyMs: 110, reasoning: '未从输入中解析出订单号' };
    }
    return { kind: 'final', text: composeAnswer(ctx, wantsJson(ctx) ? 'json' : 'text').text, latencyMs: 110 };
  },

  /** D：格式错误 —— prompt 要求 JSON 却输出散文 */
  'bad-format-agent': (ctx) => {
    if (ctx.observations.length === 0) {
      const pick = pickToolForInput(ctx.caseInput, ctx.tools);
      if (pick.tool) {
        return { kind: 'tool_call', toolName: pick.tool.name, args: extractArgsForTool(pick.tool, ctx.caseInput), latencyMs: 100 };
      }
    }
    const plain = composeAnswer(ctx, 'text').text;
    return { kind: 'final', text: plain, latencyMs: 100, reasoning: '忽略 JSON 格式要求' };
  },

  /** E：检索失败 —— 用一条几乎不可能命中的 query 打知识库 */
  'rag-failure-agent': (ctx) => {
    const searchTool = ctx.tools.find((t) => t.name === 'searchKnowledge' && t.enabled);
    const alreadySearched = ctx.observations.some((o) => o.toolName === 'searchKnowledge');
    if (searchTool && !alreadySearched) {
      return { kind: 'tool_call', toolName: 'searchKnowledge', args: { query: 'zzqqzz-no-such-topic' }, latencyMs: 120, reasoning: '检索 query 与问题无关' };
    }
    return { kind: 'final', text: composeAnswer(ctx, wantsJson(ctx) ? 'json' : 'text').text, latencyMs: 120 };
  },

  /** F：循环 —— 永远重复同一个工具调用，直到 runtime 的 loop guard 介入 */
  'loop-agent': (ctx) => {
    const tool = firstToolName(ctx, 'searchKnowledge');
    if (!tool) return { kind: 'final', text: '无可用工具。', latencyMs: 60 };
    return { kind: 'tool_call', toolName: tool, args: { query: 'order policy' }, latencyMs: 60, reasoning: '重复同样的检索动作' };
  },

  /** G：幻觉 —— 工具调用正确，但编造上下文里没有的承诺 */
  'hallucination-agent': (ctx) => {
    if (ctx.observations.length === 0) {
      return heuristicPolicy(ctx);
    }
    const base = composeAnswer(ctx, wantsJson(ctx) ? 'json' : 'text').text;
    const fabricated = '另外，根据系统记录，你的账户已自动获得 100 元补偿，订单将在 2 小时内完成退款并全额返还运费。';
    if (wantsJson(ctx)) {
      const parsed = JSON.parse(base) as Record<string, unknown>;
      parsed['answer'] = `${String(parsed['answer'])}\n${fabricated}`;
      return { kind: 'final', text: JSON.stringify(parsed, null, 2), latencyMs: 130, reasoning: '追加了无依据的承诺' };
    }
    return { kind: 'final', text: `${base}\n${fabricated}`, latencyMs: 130, reasoning: '追加了无依据的承诺' };
  },

  /** H：回归版本 V2 —— 只在「重复扣款」类问题上退步，其余与 stable 一致 */
  'regression-v2-agent': (ctx) => {
    if (/重复扣款/.test(ctx.caseInput) && ctx.observations.length === 0) {
      return { kind: 'final', text: '请稍后重试，我们已记录你的问题。', latencyMs: 100, reasoning: 'V2 未调用 getOrder 直接作答' };
    }
    return heuristicPolicy(ctx);
  },

  /** I：慢 —— 延迟回归演示 */
  'slow-agent': (ctx) => {
    const decision = heuristicPolicy(ctx);
    return { ...decision, latencyMs: 900 };
  },

  /** J：不稳定的 provider —— 第一次调用命中限流，验证重试策略不会把基础设施故障当成 Agent 失败 */
  'flaky-provider-agent': (ctx) => {
    if (ctx.metadata.callIndex === 0 && ctx.observations.length === 0) {
      return { kind: 'provider_error', failure: 'rate_limit', message: '429 rate limit exceeded (mock)' };
    }
    return heuristicPolicy(ctx);
  },
};

export function resolvePolicy(fixtureId: string | undefined, policies: Record<string, MockPolicy>): MockPolicy {
  if (fixtureId && policies[fixtureId]) return policies[fixtureId]!;
  return heuristicPolicy;
}
