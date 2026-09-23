/**
 * 轻量 JSON Schema 校验器（draft-07 子集）。
 * 目的：让 `expectedSchema` 这类确定性断言完全不依赖 LLM，也不引入 ajv 这类重依赖。
 * 支持：type / properties / required / items / enum / const / minimum / maximum /
 *       exclusiveMinimum / exclusiveMaximum / minLength / maxLength / pattern /
 *       minItems / maxItems / additionalProperties / anyOf / oneOf / allOf / nullable
 */

export interface SchemaLiteError {
  path: string;
  message: string;
  keyword: string;
}

export interface SchemaLiteResult {
  valid: boolean;
  errors: SchemaLiteError[];
}

type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  if (expected === 'object') return actual === 'object';
  return actual === expected;
}

export function validateSchemaLite(schema: unknown, value: unknown, path = '$'): SchemaLiteResult {
  const errors: SchemaLiteError[] = [];
  walk(schema as JsonSchema, value, path, errors);
  return { valid: errors.length === 0, errors };
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: SchemaLiteError[]): void {
  if (!schema || typeof schema !== 'object') return;

  // 组合关键字
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf as JsonSchema[]) {
      walk(sub, value, path, errors);
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const results = schema.anyOf.map((sub) => validateSchemaLite(sub, value, path));
    if (!results.some((r) => r.valid)) {
      errors.push({ path, keyword: 'anyOf', message: '不满足 anyOf 中任何一项' });
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const count = schema.oneOf.filter((sub) => validateSchemaLite(sub, value, path).valid).length;
    if (count !== 1) {
      errors.push({ path, keyword: 'oneOf', message: `oneOf 期望恰好匹配 1 项，实际 ${count} 项` });
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({
      path,
      keyword: 'enum',
      message: `值 ${short(value)} 不在枚举 [${schema.enum.map(short).join(', ')}] 中`,
    });
  }

  if ('const' in schema && !deepEqual(schema.const, value)) {
    errors.push({ path, keyword: 'const', message: `值必须恒为 ${short(schema.const)}` });
  }

  // nullable 必须先于 type 判断：`{type:'string', nullable:true}` 接受 null
  if (value === null && schema.nullable === true) return;

  const type = schema.type;
  if (typeof type === 'string' && !matchesType(value, type)) {
    errors.push({ path, keyword: 'type', message: `期望类型 ${type}，实际 ${typeOf(value)}` });
  } else if (Array.isArray(type)) {
    const ok = (type as string[]).some((t) => matchesType(value, t));
    if (!ok) {
      errors.push({
        path,
        keyword: 'type',
        message: `期望类型为 ${(type as string[]).join('|')}，实际 ${typeOf(value)}`,
      });
    }
  }

  if (value === null) return;

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, keyword: 'minimum', message: `${value} < minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, keyword: 'maximum', message: `${value} > maximum ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push({ path, keyword: 'exclusiveMinimum', message: `${value} <= exclusiveMinimum ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push({ path, keyword: 'exclusiveMaximum', message: `${value} >= exclusiveMaximum ${schema.exclusiveMaximum}` });
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, keyword: 'minLength', message: `长度 ${value.length} < minLength ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ path, keyword: 'maxLength', message: `长度 ${value.length} > maxLength ${schema.maxLength}` });
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push({ path, keyword: 'pattern', message: `不匹配 /${schema.pattern}/` });
        }
      } catch {
        errors.push({ path, keyword: 'pattern', message: `schema 中的 pattern 非法：${schema.pattern}` });
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, keyword: 'minItems', message: `元素数 ${value.length} < minItems ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, keyword: 'maxItems', message: `元素数 ${value.length} > maxItems ${schema.maxItems}` });
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, i) => walk(schema.items as JsonSchema, item, `${path}[${i}]`, errors));
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) {
        errors.push({ path, keyword: 'uniqueItems', message: '数组元素存在重复' });
      }
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as Record<string, JsonSchema>) ?? undefined;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, keyword: 'required', message: `缺少必需字段 ${key}` });
        }
      }
    }
    if (props) {
      for (const [key, sub] of Object.entries(props)) {
        if (key in obj) walk(sub, obj[key], `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in props)) {
            errors.push({ path: `${path}.${key}`, keyword: 'additionalProperties', message: `不允许的额外字段 ${key}` });
          }
        }
      }
    }
    if (typeof schema.minProperties === 'number' && Object.keys(obj).length < schema.minProperties) {
      errors.push({ path, keyword: 'minProperties', message: `字段数 < minProperties ${schema.minProperties}` });
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  return (s ?? String(v)).slice(0, 40);
}

/** 校验 schema 自身是否合法（导入 Dataset 时用），避免坏 schema 静默通过 */
export function isUsableSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const s = schema as JsonSchema;
  if ('pattern' in s && typeof s.pattern === 'string') {
    try {
      new RegExp(s.pattern);
    } catch {
      return false;
    }
  }
  if (Array.isArray(s.anyOf)) return s.anyOf.every(isUsableSchema);
  if (Array.isArray(s.oneOf)) return s.oneOf.every(isUsableSchema);
  if (Array.isArray(s.allOf)) return s.allOf.every(isUsableSchema);
  if (s.properties && typeof s.properties === 'object') {
    return Object.values(s.properties as Record<string, unknown>).every(isUsableSchema);
  }
  if (s.items) return isUsableSchema(s.items);
  return true;
}
