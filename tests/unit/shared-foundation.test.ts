import { describe, expect, it } from 'vitest';
import {
  ExpectedOutcomeSchema,
  contentHash,
  extractJson,
  getByPath,
  isUsableSchema,
  safeJsonParse,
  stableStringify,
  validateSchemaLite,
} from '@arl/shared';

describe('validateSchemaLite —— 让确定性格式断言不依赖 LLM', () => {
  it('type / required / properties 基本校验', () => {
    const schema = {
      type: 'object',
      required: ['answer'],
      properties: { answer: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
      additionalProperties: false,
    };
    expect(validateSchemaLite(schema, { answer: 'ok', confidence: 0.5 }).valid).toBe(true);

    const missing = validateSchemaLite(schema, { confidence: 0.5 });
    expect(missing.valid).toBe(false);
    expect(missing.errors[0]).toMatchObject({ keyword: 'required', path: '$.answer' });

    const extra = validateSchemaLite(schema, { answer: 'ok', hacker: 1 });
    expect(extra.errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);

    const outOfRange = validateSchemaLite(schema, { answer: 'ok', confidence: 2 });
    expect(outOfRange.errors.some((e) => e.keyword === 'maximum')).toBe(true);
  });

  it('integer 与 number 区分', () => {
    expect(validateSchemaLite({ type: 'integer' }, 3).valid).toBe(true);
    expect(validateSchemaLite({ type: 'integer' }, 3.5).valid).toBe(false);
    expect(validateSchemaLite({ type: 'number' }, 3.5).valid).toBe(true);
  });

  it('数组 items / minItems / uniqueItems', () => {
    const schema = { type: 'array', minItems: 2, items: { type: 'string' } };
    expect(validateSchemaLite(schema, ['a', 'b']).valid).toBe(true);
    expect(validateSchemaLite(schema, ['a']).errors.some((e) => e.keyword === 'minItems')).toBe(true);
    expect(validateSchemaLite(schema, ['a', 2]).errors.some((e) => e.path === '$[1]')).toBe(true);
    expect(validateSchemaLite({ type: 'array', uniqueItems: true }, ['a', 'a']).errors.some((e) => e.keyword === 'uniqueItems')).toBe(true);
  });

  it('字符串 pattern / minLength / maxLength', () => {
    const schema = { type: 'string', pattern: '^ORD-\\d+$', minLength: 3 };
    expect(validateSchemaLite(schema, 'ORD-42').valid).toBe(true);
    expect(validateSchemaLite(schema, 'ord-42').errors.some((e) => e.keyword === 'pattern')).toBe(true);
  });

  it('enum / const / oneOf / anyOf', () => {
    expect(validateSchemaLite({ enum: ['a', 'b'] }, 'c').valid).toBe(false);
    expect(validateSchemaLite({ const: 1 }, 2).valid).toBe(false);
    expect(validateSchemaLite({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 5).valid).toBe(true);
    expect(validateSchemaLite({ oneOf: [{ type: 'number' }, { type: 'number' }] }, 5).valid).toBe(false);
  });

  it('nullable 与 null 处理', () => {
    expect(validateSchemaLite({ type: 'string', nullable: true }, null).valid).toBe(true);
    expect(validateSchemaLite({ type: 'string' }, null).valid).toBe(false);
  });

  it('isUsableSchema 拒绝坏 schema（导入时必须先验）', () => {
    expect(isUsableSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBe(true);
    expect(isUsableSchema('not a schema')).toBe(false);
    expect(isUsableSchema({ type: 'string', pattern: '([unclosed' })).toBe(false);
  });
});

describe('JSON 工具：绝不裸 parse', () => {
  it('safeJsonParse 返回结果对象而不是抛异常', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = safeJsonParse('{oops');
    expect(bad.ok).toBe(false);
  });

  it('extractJson 能从 markdown fence 与废话中抠出 JSON', () => {
    const fenced = extractJson<{ ok: boolean }>('Sure!\n```json\n{"ok":true}\n```\nthanks');
    expect(fenced.ok && fenced.value.ok).toBe(true);
    const noisy = extractJson<number[]>('the answer is [1,2,3] ok');
    expect(noisy.ok && noisy.value.length).toBe(3);
    expect(extractJson('no json at all').ok).toBe(false);
  });

  it('getByPath 支持数组下标且不抛异常', () => {
    const obj = { a: { b: [{ c: 7 }] } };
    expect(getByPath(obj, 'a.b.0.c')).toBe(7);
    expect(getByPath(obj, 'a.b.9.c')).toBeUndefined();
    expect(getByPath(obj, 'a.x.y')).toBeUndefined();
    expect(getByPath(obj, '')).toEqual(obj);
  });

  it('stableStringify 对 key 顺序不敏感（内容指纹可比较）', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(contentHash(stableStringify({ a: 1 }))).toHaveLength(16);
  });
});

describe('ExpectedOutcome schema —— 结构化期望，而非一段自然语言', () => {
  it('默认值填充且非法值被拒', () => {
    const parsed = ExpectedOutcomeSchema.parse({});
    expect(parsed.mustContain).toEqual([]);
    expect(parsed.forbiddenTools).toEqual([]);
    expect(parsed.expectedTools).toEqual([]);
    expect(parsed.maxToolCalls).toBeNull();
    expect(parsed.expectedSchema).toBeNull();
  });

  it('完整期望可被表达', () => {
    const parsed = ExpectedOutcomeSchema.parse({
      expectedText: '重复扣款说明',
      mustContain: ['重复扣款'],
      mustNotContain: ['已退款'],
      expectedTools: ['getOrder'],
      forbiddenTools: ['refundOrder'],
      expectedToolArgs: [{ tool: 'getOrder', path: 'orderId', op: 'equals', expected: 'ORD-1' }],
      maxToolCalls: 3,
      expectedCallOrder: ['getOrder', 'searchKnowledge'],
      requiredEvidence: ['重复扣款'],
      customRules: [{ id: 'r1', kind: 'regex', value: 'ORD-\\d+' }],
      expectedSchema: { type: 'object', required: ['answer'] },
    });
    expect(parsed.expectedToolArgs[0]!.op).toBe('equals');
    expect(parsed.customRules[0]!.target).toBe('output');
  });

  it('非法枚举值直接失败（防止笔误静默变成“永不通过”的检查）', () => {
    expect(() => ExpectedOutcomeSchema.parse({ expectedToolArgs: [{ tool: 'x', op: 'equalz' }] })).toThrow();
  });
});
