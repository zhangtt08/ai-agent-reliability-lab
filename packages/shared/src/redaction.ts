/**
 * TraceRedactor —— 落库前的最后一道闸门。
 * 铁律：任何 Trace / 日志 / 报告在持久化前都必须经过这里。
 */

export type RedactionPolicy = 'store_full' | 'store_redacted' | 'store_metadata_only';

export interface RedactionFinding {
  kind: string;
  preview: string;
  positions: number;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
  changed: boolean;
}

interface SecretPattern {
  kind: string;
  re: RegExp;
}

/** 常见凭据形态。宁可多脱一点，也不要漏。顺序有意义：更具体的模式必须排在更宽泛的前面。 */
const SECRET_PATTERNS: SecretPattern[] = [
  // 更具体的先匹配，避免被通用的 sk- 规则吞掉
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'openai_key', re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'password_assignment', re: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"',;]{4,}/gi },
  { kind: 'secret_assignment', re: /\b(?:api[_-]?key|secret|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi },
  { kind: 'connection_string', re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+:[^\s"'@]+@/gi },
];

/** 结构化字段名命中即整值替换（大小写不敏感、忽略下划线） */
const SENSITIVE_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|api[_-]?key|apikey|authorization|auth|credential|private[_-]?key|cookie|session[_-]?id|ssn|credit[_-]?card|card[_-]?number|cvv|pin)/i;

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.replace(/[^A-Za-z0-9]/g, '_'));
}

/** 文本级脱敏 */
export function redactText(input: string): RedactionResult {
  let text = input;
  const findings: RedactionFinding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const matches = text.match(pattern.re);
    if (matches && matches.length > 0) {
      findings.push({
        kind: pattern.kind,
        preview: maskPreview(matches[0]),
        positions: matches.length,
      });
      text = text.replace(pattern.re, `[REDACTED:${pattern.kind}]`);
    }
  }
  return { text, findings, changed: text !== input };
}

function maskPreview(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

/** 结构级脱敏：递归替换敏感 key 的值，并保留被替换的字段路径清单 */
export interface StructuralRedactionResult {
  value: unknown;
  redactedPaths: string[];
}

export function redactStructure(
  value: unknown,
  extraSensitiveKeys: string[] = [],
  path = '',
  acc: string[] = [],
): StructuralRedactionResult {
  const extra = new Set(extraSensitiveKeys.map((k) => k.toLowerCase()));

  const walk = (v: unknown, p: string): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${p}.${i}`));
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
      const childPath = p ? `${p}.${k}` : k;
      if (isSensitiveKey(k) || extra.has(k.toLowerCase())) {
        acc.push(childPath);
        out[k] = REDACTED_PLACEHOLDER;
      } else {
        out[k] = walk(raw, childPath);
      }
    }
    return out;
  };

  const redacted = walk(value, path);
  return { value: redacted, redactedPaths: acc };
}

/** 综合脱敏：文本先走正则，再走结构敏感 key */
export function redactAny(
  value: unknown,
  extraSensitiveKeys: string[] = [],
): { value: unknown; findings: RedactionFinding[]; redactedPaths: string[] } {
  const structural = redactStructure(value, extraSensitiveKeys);
  const findings: RedactionFinding[] = [];

  const walkText = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redactText(v);
      if (r.changed) findings.push(...r.findings);
      return r.text;
    }
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walkText);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walkText(val);
    return out;
  };

  return {
    value: walkText(structural.value),
    findings,
    redactedPaths: structural.redactedPaths,
  };
}

export interface TraceRedactorOptions {
  policy: RedactionPolicy;
  sensitiveFields?: string[];
  /** metadata_only 模式下保留多少字符的预览 */
  previewChars?: number;
}

export interface RedactedPayload {
  stored: string | null;
  mode: RedactionPolicy;
  byteLength: number;
  redactedPaths: string[];
  findings: RedactionFinding[];
  /** 便于 UI 展示「这里有内容但因为隐私策略没存」 */
  omitted: boolean;
}

/**
 * 按隐私策略处理一段 payload（prompt / output / tool args）。
 * - store_full：原样存（仍会脱敏敏感字段，凭据绝不落库）
 * - store_redacted：文本级 + 结构级脱敏后存
 * - store_metadata_only：只存长度与类型摘要
 */
export function redactPayload(payload: unknown, options: TraceRedactorOptions): RedactedPayload {
  const { policy, sensitiveFields = [], previewChars = 0 } = options;
  const byteLength = new TextEncoder().encode(
    typeof payload === 'string' ? payload : JSON.stringify(payload ?? null),
  ).length;

  if (policy === 'store_metadata_only') {
    return {
      stored: null,
      mode: policy,
      byteLength,
      redactedPaths: [],
      findings: [],
      omitted: true,
    };
  }

  const { value, findings, redactedPaths } = redactAny(payload, sensitiveFields);
  let stored = typeof value === 'string' ? value : JSON.stringify(value);

  if (policy === 'store_redacted' && previewChars > 0 && stored.length > previewChars) {
    stored = `${stored.slice(0, previewChars)}…[truncated ${stored.length - previewChars} chars]`;
  }

  return { stored, mode: policy, byteLength, redactedPaths, findings, omitted: false };
}

/** 校验：给定文本是否仍含疑似凭据（用于测试与自检） */
export function containsSecretLike(text: string): boolean {
  return SECRET_PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags).test(text));
}
