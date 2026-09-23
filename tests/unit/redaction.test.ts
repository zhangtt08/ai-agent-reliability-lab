import { describe, expect, it } from 'vitest';
import {
  TraceRedactorOptions,
  containsSecretLike,
  isSensitiveKey,
  redactAny,
  redactPayload,
  redactStructure,
  redactText,
} from '@arl/shared';

const FAKE_OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';
const FAKE_ANTHROPIC = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
const FAKE_GOOGLE = 'AIzaSyA1234567890abcdefghijklmnopqrst';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
const FAKE_AWS = 'AKIAIOSFODNN7EXAMPLE';

describe('TraceRedactor —— 落库前的最后一道闸门', () => {
  it('识别并脱敏常见凭据形态', () => {
    const input = `keys: ${FAKE_OPENAI} / ${FAKE_ANTHROPIC} / ${FAKE_GOOGLE} / ${FAKE_JWT} / ${FAKE_AWS}`;
    const result = redactText(input);
    expect(result.changed).toBe(true);
    expect(result.text).not.toContain(FAKE_OPENAI);
    expect(result.text).not.toContain(FAKE_ANTHROPIC);
    expect(result.text).not.toContain(FAKE_GOOGLE);
    expect(result.text).not.toContain(FAKE_JWT);
    expect(result.text).not.toContain(FAKE_AWS);
    expect(result.findings.map((f) => f.kind)).toEqual(
      expect.arrayContaining(['openai_key', 'anthropic_key', 'google_api_key', 'jwt', 'aws_access_key']),
    );
  });

  it('脱敏 Bearer token 与连接串', () => {
    const r = redactText('Authorization: Bearer abcdefghijklmnopqrstuvwx\npostgres://user:secretpw@db.local:5432/app');
    expect(r.text).not.toMatch(/Bearer\s+abcdefghijklmnop/);
    expect(r.text).not.toContain('secretpw');
  });

  it('PEM 私钥整块脱敏', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----';
    const r = redactText(`before\n${pem}\nafter`);
    expect(r.text).not.toContain('MIIEowIBAAKC');
    expect(r.text).toContain('before');
    expect(r.text).toContain('after');
  });

  it('结构级脱敏按 key 命中整值替换', () => {
    const { value, redactedPaths } = redactStructure({
      user: 'zhang',
      apiKey: FAKE_OPENAI,
      nested: { password: 'p@ssw0rd', token: 'abc', keep: 'visible' },
    });
    const out = value as Record<string, unknown>;
    expect(out['apiKey']).toBe('[REDACTED]');
    expect((out['nested'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect((out['nested'] as Record<string, unknown>)['keep']).toBe('visible');
    expect(redactedPaths).toEqual(expect.arrayContaining(['apiKey', 'nested.password', 'nested.token']));
  });

  it('isSensitiveKey 覆盖常见命名变体', () => {
    for (const key of ['password', 'api_key', 'apiKey', 'API-KEY', 'accessToken', 'client_secret', 'authorization', 'cvv', 'sessionId']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['orderId', 'title', 'amount', 'customer_name']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('redactAny 同时处理文本正则与结构 key', () => {
    const { value } = redactAny({
      note: `call with ${FAKE_OPENAI}`,
      secret: 'plain-value',
      list: [{ token: 'abc123456789' }, { ok: 'fine' }],
    });
    const out = value as Record<string, unknown>;
    expect(out['note']).toBe('call with [REDACTED:openai_key]');
    expect(out['secret']).toBe('[REDACTED]');
    expect((out['list'] as Record<string, unknown>[])[0]!['token']).toBe('[REDACTED]');
    expect((out['list'] as Record<string, unknown>[])[1]!['ok']).toBe('fine');
  });

  describe('redactPayload 三种隐私策略', () => {
    const payload = { prompt: `secret ${FAKE_OPENAI}`, extra: 'x'.repeat(50) };
    const base: Omit<TraceRedactorOptions, 'policy'> = { sensitiveFields: [] };

    it('store_full：保留内容，但仍去掉凭据', () => {
      const r = redactPayload(payload, { ...base, policy: 'store_full' });
      expect(r.omitted).toBe(false);
      expect(r.stored).toContain('"extra"');
      expect(r.stored).not.toContain(FAKE_OPENAI);
    });

    it('store_redacted：可截断为预览', () => {
      const r = redactPayload(payload, { ...base, policy: 'store_redacted', previewChars: 10 });
      expect(r.stored).toContain('truncated');
      expect(r.stored!.length).toBeLessThan(JSON.stringify(payload).length);
    });

    it('store_metadata_only：只留长度，不留内容', () => {
      const r = redactPayload(payload, { ...base, policy: 'store_metadata_only' });
      expect(r.stored).toBeNull();
      expect(r.omitted).toBe(true);
      expect(r.byteLength).toBeGreaterThan(0);
    });
  });

  it('containsSecretLike 作为自检工具本身可信', () => {
    expect(containsSecretLike(`x ${FAKE_OPENAI}`)).toBe(true);
    expect(containsSecretLike('nothing to see here')).toBe(false);
  });

  it('敏感字段白名单可扩展（ToolDefinition.sensitiveFields）', () => {
    const { value, redactedPaths } = redactStructure({ orderId: 'A1', internalNote: 'x' }, ['internalNote']);
    expect((value as Record<string, unknown>)['internalNote']).toBe('[REDACTED]');
    expect((value as Record<string, unknown>)['orderId']).toBe('A1');
    expect(redactedPaths).toContain('internalNote');
  });
});
