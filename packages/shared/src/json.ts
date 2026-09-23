/** 安全的 JSON 工具集：绝不裸 JSON.parse 抛异常穿透业务层 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; error: string; raw: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

export function safeJsonParse<T = unknown>(raw: string): ParseResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), raw };
  }
}

/**
 * 从可能夹带 markdown fence / 前后废话的模型输出里抠出第一个合法 JSON。
 * 用于 LLM structured output 解析，失败返回 ParseErr 而不是抛异常。
 */
export function extractJson<T = unknown>(raw: string): ParseResult<T> {
  const direct = safeJsonParse<T>(raw);
  if (direct.ok) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1]) {
    const parsed = safeJsonParse<T>(fenced[1].trim());
    if (parsed.ok) return parsed;
  }

  const start = raw.search(/[[{]/);
  if (start >= 0) {
    const open = raw[start];
    const close = open === '{' ? '}' : ']';
    const end = raw.lastIndexOf(close);
    if (end > start) {
      const parsed = safeJsonParse<T>(raw.slice(start, end + 1));
      if (parsed.ok) return parsed;
    }
  }
  return { ok: false, error: 'no_json_found', raw };
}

/** 稳定序列化：对象 key 排序，用于生成可比较的内容指纹 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = walk((v as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

/** 按 `a.b.0.c` 路径取值，取不到返回 undefined */
export function getByPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function toJsonText(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
