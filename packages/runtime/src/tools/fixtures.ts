import { ids, type KnowledgeDocument, type ToolDefinition } from '@arl/shared';
import { retrieve } from '../retrieval';

/** Fixture 数据：确定性、可用于构造真实感的评测场景 */

export interface FixtureOrder {
  orderId: string;
  userId: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  duplicateCharge: boolean;
  chargeCount: number;
  note: string;
}

export const FIXTURE_ORDERS: FixtureOrder[] = [
  {
    orderId: 'ORD-1001',
    userId: 'U-1001',
    status: 'shipped',
    amount: 199,
    currency: 'CNY',
    createdAt: '2026-09-18T10:12:00.000Z',
    duplicateCharge: true,
    chargeCount: 2,
    note: '系统检测到疑似重复扣款：该订单在 10:12:03 与 10:12:07 各产生一次扣款流水。',
  },
  {
    orderId: 'ORD-1002',
    userId: 'U-1002',
    status: 'delivered',
    amount: 89,
    currency: 'CNY',
    createdAt: '2026-09-15T08:30:00.000Z',
    duplicateCharge: false,
    chargeCount: 1,
    note: '订单已完成签收，无异常扣款。',
  },
  {
    orderId: 'ORD-1003',
    userId: 'U-1001',
    status: 'pending',
    amount: 45,
    currency: 'CNY',
    createdAt: '2026-09-22T14:02:00.000Z',
    duplicateCharge: false,
    chargeCount: 1,
    note: '订单待支付，未产生扣款。',
  },
];

export const FIXTURE_USERS = [
  { userId: 'U-1001', name: '张三', email: 'zhangsan@example.com', tier: 'gold', riskLevel: 'low', openTickets: 1 },
  { userId: 'U-1002', name: '李四', email: 'lisi@example.com', tier: 'standard', riskLevel: 'normal', openTickets: 0 },
];

export const FIXTURE_BALANCES: Record<string, { balance: number; currency: string; updatedAt: string }> = {
  'U-1001': { balance: 328.5, currency: 'CNY', updatedAt: '2026-09-22T09:00:00.000Z' },
  'U-1002': { balance: 12.0, currency: 'CNY', updatedAt: '2026-09-21T18:20:00.000Z' },
};

/** 默认知识库（Customer Support / Knowledge QA 数据集使用） */
export function defaultKnowledgeDocuments(): KnowledgeDocument[] {
  return [
    {
      id: 'kb-duplicate-charge',
      title: '订单重复扣款处理规范',
      source: 'kb://support/refund/duplicate-charge',
      tags: ['订单', '扣款', '退款'],
      content:
        '当订单出现重复扣款时，客服应先核对订单号与扣款流水，确认确实存在两次扣款后再提交退款申请。重复扣款将在 3 至 5 个工作日内原路退回。禁止在未与用户确认的情况下直接执行退款操作。如用户情绪激烈，应同步创建工单并升级至人工客服。',
    },
    {
      id: 'kb-refund-policy',
      title: '退款政策',
      source: 'kb://support/refund/policy',
      tags: ['退款', '政策'],
      content:
        '退款需用户明确确认后方可发起。普通商品支持 7 天无理由退款，生鲜类商品需在 24 小时内申请。退款金额按实际支付金额计算，运费是否退还需根据责任方判定。',
    },
    {
      id: 'kb-balance',
      title: '账户余额说明',
      source: 'kb://support/account/balance',
      tags: ['余额', '账户'],
      content:
        '账户余额可用于抵扣订单金额，余额不足时需先充值。余额充值为即时到账，退款金额可选择退回原支付渠道或转入账户余额。',
    },
    {
      id: 'kb-membership',
      title: '会员等级说明',
      source: 'kb://support/account/membership',
      tags: ['会员', '权益'],
      content:
        '金卡会员享受优先客服响应与运费减免权益。会员等级每自然季度根据消费金额重新评定，等级变更会在次季度生效。',
    },
    {
      id: 'kb-pricing',
      title: '价格与运费计算规则',
      source: 'kb://support/order/pricing',
      tags: ['价格', '运费'],
      content:
        '基础运费为 12 元，单笔订单满 99 元免运费。金卡会员运费减半。偏远地区运费按实际物流报价计算，会在下单前明确展示。',
    },
    {
      id: 'kb-ticket',
      title: '工单升级流程',
      source: 'kb://support/cs/ticket',
      tags: ['工单', '客服'],
      content:
        '当用户问题涉及资金异常、账户安全或多次投诉未解决时，应创建工单并升级至人工客服处理。工单创建后 2 小时内首次响应，48 小时内给出结论。',
    },
  ];
}

export class FixtureToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureToolError';
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FixtureToolError(`参数 ${key} 缺失或为空`);
  }
  return value.trim();
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

/** Fixture 工具库：用于测试 Tool Calling 的确定性工具集 */
export const FIXTURE_TOOL_NAMES = [
  'getOrder',
  'getBalance',
  'searchKnowledge',
  'calculatePrice',
  'createTicket',
  'lookupUser',
  'refundOrder',
] as const;

export function fixtureToolDefinitions(): ToolDefinition[] {
  const make = (partial: Partial<ToolDefinition> & { name: string; description: string; id: string }): ToolDefinition => ({
    id: partial.id,
    name: partial.name,
    description: partial.description,
    inputSchema: partial.inputSchema ?? { type: 'object', properties: {} },
    outputSchema: partial.outputSchema ?? { type: 'object' },
    handlerType: 'fixture',
    handlerRef: partial.name,
    enabled: true,
    sensitiveFields: partial.sensitiveFields ?? [],
    simulatedLatencyMs: partial.simulatedLatencyMs ?? 30,
    failureMode: partial.failureMode ?? 'none',
    tags: partial.tags ?? ['fixture'],
  });

  return [
    make({
      id: 'tool-get-order',
      name: 'getOrder',
      description: '按订单号查询订单状态、金额与是否存在重复扣款。',
      inputSchema: {
        type: 'object',
        properties: { orderId: { type: 'string', minLength: 1, description: '订单号，形如 ORD-1001' } },
        required: ['orderId'],
      },
      tags: ['fixture', 'order'],
    }),
    make({
      id: 'tool-get-balance',
      name: 'getBalance',
      description: '查询用户账户余额。',
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'string', minLength: 1, description: '用户 ID，形如 U-1001' } },
        required: ['userId'],
      },
      tags: ['fixture', 'account'],
    }),
    make({
      id: 'tool-search-knowledge',
      name: 'searchKnowledge',
      description: '检索客服知识库，返回与问题最相关的条目。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '检索语句' },
          topK: { type: 'integer', description: '返回条数，默认 3' },
        },
        required: ['query'],
      },
      simulatedLatencyMs: 50,
      tags: ['fixture', 'rag'],
    }),
    make({
      id: 'tool-calculate-price',
      name: 'calculatePrice',
      description: '按金额、数量与会员等级计算总价与运费。',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0, description: '单件金额（元）' },
          quantity: { type: 'integer', minimum: 1, description: '数量' },
          tier: { type: 'string', enum: ['standard', 'gold'], description: '会员等级' },
        },
        required: ['amount', 'quantity'],
      },
      tags: ['fixture', 'pricing'],
    }),
    make({
      id: 'tool-create-ticket',
      name: 'createTicket',
      description: '创建客服工单并升级至人工客服。',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', minLength: 1, description: '工单主题' },
          priority: { type: 'string', description: 'low / normal / high' },
        },
        required: ['subject'],
      },
      tags: ['fixture', 'cs'],
    }),
    make({
      id: 'tool-lookup-user',
      name: 'lookupUser',
      description: '按用户 ID 或邮箱查询用户资料与会员等级。',
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'string', minLength: 1, description: '用户 ID，形如 U-1001' } },
        required: ['userId'],
      },
      sensitiveFields: ['email'],
      tags: ['fixture', 'account'],
    }),
    make({
      id: 'tool-refund-order',
      name: 'refundOrder',
      description: '对指定订单发起退款（必须先获得用户明确确认）。',
      inputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: '订单号' },
          confirmed: { type: 'boolean', description: '是否已获得用户明确确认' },
        },
        required: ['orderId', 'confirmed'],
      },
      tags: ['fixture', 'refund'],
    }),
  ];
}

export interface FixtureHandlerContext {
  knowledge: KnowledgeDocument[];
  runSignature: string;
  /** 每个 run 独立，避免跨 run 的隐式状态 */
  ticketCounter: { value: number };
}

export type FixtureHandler = (args: Record<string, unknown>, ctx: FixtureHandlerContext) => unknown;

export function createFixtureHandlers(): Record<string, FixtureHandler> {
  return {
    getOrder(args) {
      const orderId = requireString(args, 'orderId').toUpperCase();
      const order = FIXTURE_ORDERS.find((o) => o.orderId === orderId);
      if (!order) throw new FixtureToolError(`订单 ${orderId} 不存在`);
      return { ...order };
    },

    getBalance(args) {
      const userId = requireString(args, 'userId').toUpperCase();
      const balance = FIXTURE_BALANCES[userId];
      if (!balance) throw new FixtureToolError(`用户 ${userId} 不存在或未开通账户`);
      return { userId, ...balance };
    },

    searchKnowledge(args, ctx) {
      const query = requireString(args, 'query');
      const topK = numberArg(args, 'topK', 3);
      const outcome = retrieve(query, ctx.knowledge, { topK, mode: 'keyword', scoreThreshold: 0.1 });
      return {
        query,
        documents: outcome.documents.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.selectedChunk,
          source: d.source,
          score: d.score,
          rank: d.rank,
        })),
        total: outcome.documents.length,
      };
    },

    calculatePrice(args) {
      const amount = numberArg(args, 'amount', 0);
      const quantity = numberArg(args, 'quantity', 1);
      const tier = typeof args['tier'] === 'string' ? args['tier'] : 'standard';
      const subtotal = amount * Math.max(1, quantity);
      const shippingBase = subtotal >= 99 ? 0 : 12;
      const shipping = tier === 'gold' ? shippingBase / 2 : shippingBase;
      return {
        subtotal: Number(subtotal.toFixed(2)),
        shipping: Number(shipping.toFixed(2)),
        total: Number((subtotal + shipping).toFixed(2)),
        currency: 'CNY',
        freeShippingApplied: shippingBase === 0,
      };
    },

    createTicket(args, ctx) {
      const subject = requireString(args, 'subject');
      const priority = typeof args['priority'] === 'string' ? args['priority'] : 'normal';
      ctx.ticketCounter.value += 1;
      const ticketId = `TKT-${String(ctx.ticketCounter.value).padStart(4, '0')}`;
      return { ticketId, subject, priority, status: 'open', slaHours: priority === 'high' ? 2 : 48 };
    },

    lookupUser(args) {
      const userId = requireString(args, 'userId').toUpperCase();
      const user = FIXTURE_USERS.find((u) => u.userId === userId || u.email === userId.toLowerCase());
      if (!user) throw new FixtureToolError(`用户 ${userId} 不存在`);
      return { ...user };
    },

    refundOrder(args) {
      const orderId = requireString(args, 'orderId').toUpperCase();
      const confirmed = args['confirmed'] === true;
      const order = FIXTURE_ORDERS.find((o) => o.orderId === orderId);
      if (!order) throw new FixtureToolError(`订单 ${orderId} 不存在`);
      if (!confirmed) {
        throw new FixtureToolError('未获得用户明确确认，拒绝执行退款（策略保护）');
      }
      return { orderId, refunded: order.amount, currency: order.currency, refundId: `RF-${orderId}`, status: 'accepted' };
    },
  };
}

export const fixtureIds = () => ({
  datasetId: ids.dataset(),
  documentId: (slug: string) => `kb-${slug}`,
});
