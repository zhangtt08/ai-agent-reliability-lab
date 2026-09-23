import type { RetrievedDocument, ToolDefinition } from '@arl/shared';
import type { ToolObservation } from './types';
import type { MockTurnContext } from './mock-types';

/**
 * Mock 模型的「应答组织器」：把工具观测与检索结果拼成人类可读回答。
 * 全部为确定性逻辑（无随机数），保证同一个 case 每次跑出同样的输出 —— 评测可复现。
 */

export interface ComposedAnswer {
  text: string;
  json: Record<string, unknown> | null;
  /** 回答中引用的证据来源（用于 groundedness 判定） */
  groundedOn: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sentence(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const first = /^[^。！？.!?]*[。！？.!?]/.exec(flat)?.[0];
  const picked = first && first.length >= 8 ? first : flat;
  return picked.length > limit ? `${picked.slice(0, limit)}…` : picked;
}

function renderObservation(observation: ToolObservation): { line: string; grounded: string[] } {
  const out = asRecord(observation.output);
  const grounded: string[] = [];

  switch (observation.toolName) {
    case 'getOrder': {
      const id = String(out['orderId'] ?? out['id'] ?? '未知订单');
      const status = String(out['status'] ?? '未知状态');
      const amount = out['amount'] !== undefined ? `金额 ¥${out['amount']}` : '';
      const duplicate = out['duplicateCharge'] === true;
      if (duplicate) grounded.push(id);
      const note = typeof out['note'] === 'string' ? out['note'] : '';
      return {
        line: `订单 ${id} 当前状态为 ${status}${amount ? `，${amount}` : ''}${note ? `。${note}` : ''}`,
        grounded: duplicate ? [id] : [],
      };
    }
    case 'getBalance': {
      return { line: `账户余额为 ¥${String(out['balance'] ?? '未知')}（币种 ${String(out['currency'] ?? 'CNY')}）`, grounded: [] };
    }
    case 'searchKnowledge': {
      const docs = Array.isArray(out['documents']) ? (out['documents'] as Record<string, unknown>[]) : [];
      if (docs.length === 0) return { line: '知识库中未检索到相关条目。', grounded: [] };
      const top = docs[0]!;
      const title = String(top['title'] ?? '知识库条目');
      const content = String(top['content'] ?? '');
      grounded.push(title);
      return { line: `知识库《${title}》指出：${sentence(content)}`, grounded: [title] };
    }
    case 'calculatePrice': {
      return { line: `按当前报价规则计算，总价为 ¥${String(out['total'] ?? '未知')}`, grounded: [] };
    }
    case 'createTicket': {
      return { line: `已创建工单 ${String(out['ticketId'] ?? '')}，我们会尽快跟进。`, grounded: [] };
    }
    case 'lookupUser': {
      return { line: `用户 ${String(out['name'] ?? '')}（等级 ${String(out['tier'] ?? 'standard')}）已查询到。`, grounded: [] };
    }
    case 'refundOrder': {
      return { line: `退款已受理，金额 ¥${String(out['refunded'] ?? '')}。`, grounded: [] };
    }
    default:
      return { line: `${observation.toolName} 返回：${observation.summary}`, grounded: [] };
  }
}

export function composeAnswer(ctx: MockTurnContext, style: 'json' | 'text'): ComposedAnswer {
  const lines: string[] = [];
  const grounded: string[] = [];
  const sources: string[] = [];

  for (const doc of ctx.retrievedDocs) {
    sources.push(doc.title);
  }

  if (ctx.retrievedDocs.length > 0) {
    const top = ctx.retrievedDocs[0]!;
    const chunk = top.selectedChunk || sentence(top.title);
    lines.push(`参考《${top.title}》：${sentence(chunk, 160)}`);
    grounded.push(top.title);
  }

  for (const observation of ctx.observations) {
    if (observation.status !== 'ok') {
      lines.push(`调用 ${observation.toolName} 失败：${observation.error ?? observation.summary}`);
      continue;
    }
    const rendered = renderObservation(observation);
    lines.push(rendered.line);
    grounded.push(...rendered.grounded);
  }

  if (lines.length === 0) {
    lines.push('我已收到你的问题，但当前没有可用的工具或知识库数据来给出确切结论。');
  }

  const advice = ctx.observations.some((o) => o.toolName === 'refundOrder')
    ? '建议：请在退款到账后 3 个工作日核对账单。'
    : '建议：如需进一步处理，我可以为你创建工单并升级至人工客服。';

  const body = `${lines.join('\n')}\n${advice}`;

  // 置信度是确定性推导：有工具/检索证据 → 0.9，否则 0.4。不是“AI 打分”。
  const confidence = grounded.length > 0 && (ctx.observations.length > 0 || ctx.retrievedDocs.length > 0) ? 0.9 : 0.4;
  const json = { answer: body, confidence, sources: Array.from(new Set(sources)) };

  return {
    text: style === 'json' ? JSON.stringify(json, null, 2) : body,
    json,
    groundedOn: Array.from(new Set(grounded)),
  };
}

/** 从输入里挑最合适的工具：关键词 → 工具名，按工具名/描述再兜一层 */
export interface ToolPick {
  tool: ToolDefinition | null;
  reason: string;
}

const KEYWORD_TO_TOOL: { re: RegExp; tool: string; reason: string }[] = [
  { re: /(确认退款|同意退款|立即退款|confirm refund)/i, tool: 'refundOrder', reason: '输入包含明确的退款确认语句' },
  { re: /(退款|refund)/i, tool: 'searchKnowledge', reason: '退款类问题先查政策，不直接执行退款' },
  { re: /(ORD-\d+|订单|扣款|order)/i, tool: 'getOrder', reason: '输入涉及订单号或订单状态' },
  { re: /(余额|balance|账户剩余)/i, tool: 'getBalance', reason: '输入询问账户余额' },
  { re: /(工单|ticket|升级人工|客服跟进)/i, tool: 'createTicket', reason: '输入需要创建工单' },
  { re: /(价格|报价|运费|多少(钱|元)|计算|price)/i, tool: 'calculatePrice', reason: '输入需要价格计算' },
  { re: /(用户|会员|等级|user|profile)/i, tool: 'lookupUser', reason: '输入需要查询用户信息' },
  { re: /(政策|规则|多久|怎么|为什么|如何|知识|说明|标准|流程|refund|policy)/i, tool: 'searchKnowledge', reason: '输入属于政策/知识类问题' },
];

export function pickToolForInput(input: string, tools: ToolDefinition[]): ToolPick {
  const enabled = tools.filter((t) => t.enabled);
  if (enabled.length === 0) return { tool: null, reason: '未配置可用工具' };

  for (const rule of KEYWORD_TO_TOOL) {
    if (rule.re.test(input)) {
      const tool = enabled.find((t) => t.name === rule.tool);
      if (tool) return { tool, reason: rule.reason };
    }
  }

  // 退一步：按词面重合度挑
  const tokens = input.toLowerCase().split(/[\s,，。；;:：]+/).filter((t) => t.length > 1);
  let best: { tool: ToolDefinition; score: number } | null = null;
  for (const tool of enabled) {
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
    const score = tokens.filter((t) => haystack.includes(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { tool, score };
  }
  return best
    ? { tool: best.tool, reason: `与输入词面重合度最高（${best.score} 项）` }
    : { tool: null, reason: '输入与任何工具都没有明显关联' };
}

/** 按 tool.inputSchema 的 required 字段从输入里抽取参数（确定性启发式） */
export function extractArgsForTool(tool: ToolDefinition, input: string): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
  const props = schema.properties ?? {};
  const required = schema.required ?? Object.keys(props);
  const args: Record<string, unknown> = {};
  const confirmed = /(确认退款|同意退款|立即退款|confirm refund)/i.test(input);

  for (const key of required) {
    const def = props[key] ?? {};
    const lower = key.toLowerCase();
    if (/order/.test(lower)) {
      args[key] = /ORD-\d+/i.exec(input)?.[0] ?? '';
    } else if (/(user|email|customer)/.test(lower)) {
      args[key] =
        /[\w.+-]+@[\w-]+\.[\w.]+/.exec(input)?.[0] ??
        /U-\d+/i.exec(input)?.[0] ??
        '';
    } else if (/(query|question|keyword|text|prompt)/.test(lower)) {
      args[key] = input;
    } else if (/(confirm|approved|agree)/.test(lower)) {
      args[key] = confirmed;
    } else if (/(quantity|qty|count)/.test(lower)) {
      args[key] = Number(/(\d+)\s*(件|个|份|qty)?/i.exec(input)?.[1] ?? 1);
    } else if (/(amount|price|total|weight)/.test(lower)) {
      args[key] = Number(/(\d+(?:\.\d+)?)/.exec(input)?.[1] ?? 0);
    } else if (def.type === 'number' || def.type === 'integer') {
      args[key] = Number(/(\d+(?:\.\d+)?)/.exec(input)?.[1] ?? 0);
    } else if (def.type === 'boolean') {
      args[key] = confirmed;
    } else if (Array.isArray(def.enum) && def.enum.length > 0) {
      args[key] = def.enum[0];
    } else {
      args[key] = '';
    }
  }
  return args;
}
