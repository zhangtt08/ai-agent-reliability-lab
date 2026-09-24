import { ExpectedOutcomeSchema, type ExpectedOutcome, type TestCase } from './schemas';
import { isUsableSchema } from './json-schema';
import { safeJsonParse } from './json';
import { PRIORITIES, type Priority } from './taxonomy';

/**
 * Dataset 导入 / 导出。
 *
 * 硬约束：**一条坏数据不能让整批导入崩溃**。
 * 解析器逐行校验，把问题行的行号 / 字段 / 原因收集起来返回，调用方决定是否继续。
 */

export interface DatasetImportError {
  row: number;
  field: string;
  message: string;
  raw: string;
}

export interface ParsedCase {
  name: string;
  input: string;
  context: string;
  metadata: Record<string, unknown>;
  tags: string[];
  priority: Priority;
  enabled: boolean;
  expectedOutcome: ExpectedOutcome;
  notes: string;
}

export interface DatasetImportResult {
  cases: ParsedCase[];
  errors: DatasetImportError[];
  totalRows: number;
}

export const DATASET_CSV_COLUMNS = [
  'name',
  'input',
  'context',
  'priority',
  'tags',
  'enabled',
  'expectedText',
  'mustContain',
  'mustNotContain',
  'expectedTools',
  'forbiddenTools',
  'expectedSchema',
  'maxToolCalls',
  'requiredEvidence',
  'notes',
] as const;

// ── CSV 基础：RFC4180 风格，支持引号转义与字段内换行 ──────────────

export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // 忽略 CR，交给 \n 收行
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const [header, ...rest] = nonEmpty;
  return { header: (header ?? []).map((h) => h.trim()), rows: rest };
}

function csvEscape(value: string): string {
  const needsQuote = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');
}

function splitList(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', '是'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', '否'].includes(v)) return false;
  return fallback;
}

function normalizePriority(value: string): Priority {
  const v = value.trim().toLowerCase();
  return (PRIORITIES as readonly string[]).includes(v) ? (v as Priority) : 'normal';
}

/** 从一组 record 构造用例：逐行校验，坏行进 errors */
export function buildCasesFromRecords(records: Record<string, string>[], sourceLabel = 'row'): DatasetImportResult {
  const cases: ParsedCase[] = [];
  const errors: DatasetImportError[] = [];
  let row = 0;

  for (const record of records) {
    row += 1;
    const label = `${sourceLabel} ${row}`;
    if (Object.values(record).every((v) => (v ?? '').trim() === '')) continue;

    const name = (record['name'] ?? '').trim() || `case-${row}`;
    const input = (record['input'] ?? '').trim();
    if (input === '') {
      errors.push({ row, field: 'input', message: 'input 不能为空', raw: JSON.stringify(record).slice(0, 200) });
      continue;
    }

    let expectedSchema: Record<string, unknown> | null = null;
    const schemaRaw = (record['expectedSchema'] ?? '').trim();
    if (schemaRaw !== '') {
      const parsed = safeJsonParse<Record<string, unknown>>(schemaRaw);
      if (!parsed.ok) {
        errors.push({ row, field: 'expectedSchema', message: `不是合法 JSON：${parsed.error}`, raw: schemaRaw.slice(0, 120) });
        continue;
      }
      if (!isUsableSchema(parsed.value)) {
        errors.push({ row, field: 'expectedSchema', message: 'schema 结构不可用（pattern/properties 非法）', raw: schemaRaw.slice(0, 120) });
        continue;
      }
      expectedSchema = parsed.value;
    }

    let metadata: Record<string, unknown> = {};
    const metadataRaw = (record['metadata'] ?? '').trim();
    if (metadataRaw !== '') {
      const parsed = safeJsonParse<Record<string, unknown>>(metadataRaw);
      if (!parsed.ok) {
        errors.push({ row, field: 'metadata', message: `不是合法 JSON：${parsed.error}`, raw: metadataRaw.slice(0, 120) });
        continue;
      }
      metadata = parsed.value;
    }

    const maxToolCallsRaw = (record['maxToolCalls'] ?? '').trim();
    const maxToolCalls = maxToolCallsRaw === '' ? null : Number(maxToolCallsRaw);

    const outcomeCandidate = {
      expectedText: record['expectedText'] ?? '',
      mustContain: splitList(record['mustContain'] ?? '', /\|/),
      mustNotContain: splitList(record['mustNotContain'] ?? '', /\|/),
      expectedTools: splitList(record['expectedTools'] ?? '', /[|,]/),
      forbiddenTools: splitList(record['forbiddenTools'] ?? '', /[|,]/),
      expectedSchema,
      maxToolCalls: maxToolCalls !== null && Number.isFinite(maxToolCalls) ? maxToolCalls : null,
      requiredEvidence: splitList(record['requiredEvidence'] ?? '', /\|/),
    };

    const validated = ExpectedOutcomeSchema.safeParse(outcomeCandidate);
    if (!validated.success) {
      errors.push({
        row,
        field: 'expectedOutcome',
        message: validated.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; '),
        raw: JSON.stringify(outcomeCandidate).slice(0, 200),
      });
      continue;
    }

    cases.push({
      name,
      input,
      context: record['context'] ?? '',
      metadata,
      tags: splitList(record['tags'] ?? '', /[|,]/),
      priority: normalizePriority(record['priority'] ?? 'normal'),
      enabled: parseBool(record['enabled'] ?? 'true', true),
      expectedOutcome: validated.data,
      notes: record['notes'] ?? '',
    });
    void label;
  }

  return { cases, errors, totalRows: row };
}

export function parseDatasetCsv(text: string): DatasetImportResult {
  const { header, rows } = parseCsv(text);
  if (header.length === 0) return { cases: [], errors: [{ row: 0, field: 'header', message: 'CSV 为空或缺少表头', raw: '' }], totalRows: 0 };
  const missing = ['name', 'input'].filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      cases: [],
      errors: [{ row: 0, field: 'header', message: `缺少必需列：${missing.join(', ')}`, raw: header.join(',') }],
      totalRows: 0,
    };
  }
  const records = rows.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = cells[index] ?? '';
    });
    return record;
  });
  return buildCasesFromRecords(records, 'csv row');
}

export function parseDatasetJson(text: string): DatasetImportResult {
  const parsed = safeJsonParse<unknown>(text);
  if (!parsed.ok) {
    return { cases: [], errors: [{ row: 0, field: '$', message: `不是合法 JSON：${parsed.error}`, raw: text.slice(0, 120) }], totalRows: 0 };
  }
  const value = parsed.value;
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { cases?: unknown }).cases)
      ? ((value as { cases: unknown[] }).cases as unknown[])
      : null;

  if (!list) {
    return {
      cases: [],
      errors: [{ row: 0, field: '$', message: 'JSON 顶层必须是数组，或包含 cases 数组的对象', raw: '' }],
      totalRows: 0,
    };
  }

  const cases: ParsedCase[] = [];
  const errors: DatasetImportError[] = [];

  list.forEach((item, index) => {
    const row = index + 1;
    if (!item || typeof item !== 'object') {
      errors.push({ row, field: '$', message: '元素不是对象', raw: JSON.stringify(item).slice(0, 120) });
      return;
    }
    const obj = item as Record<string, unknown>;
    const input = typeof obj['input'] === 'string' ? obj['input'].trim() : '';
    if (input === '') {
      errors.push({ row, field: 'input', message: 'input 不能为空', raw: JSON.stringify(obj).slice(0, 120) });
      return;
    }
    if (obj['expectedSchema'] !== undefined && obj['expectedSchema'] !== null && !isUsableSchema(obj['expectedSchema'])) {
      errors.push({ row, field: 'expectedSchema', message: 'schema 结构不可用', raw: JSON.stringify(obj['expectedSchema']).slice(0, 120) });
      return;
    }
    const validated = ExpectedOutcomeSchema.safeParse(obj['expectedOutcome'] ?? {});
    if (!validated.success) {
      errors.push({
        row,
        field: 'expectedOutcome',
        message: validated.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; '),
        raw: JSON.stringify(obj['expectedOutcome']).slice(0, 200),
      });
      return;
    }
    cases.push({
      name: typeof obj['name'] === 'string' && obj['name'].trim() !== '' ? obj['name'].trim() : `case-${row}`,
      input,
      context: typeof obj['context'] === 'string' ? obj['context'] : '',
      metadata: (obj['metadata'] as Record<string, unknown>) ?? {},
      tags: Array.isArray(obj['tags']) ? (obj['tags'] as unknown[]).map(String) : [],
      priority: normalizePriority(typeof obj['priority'] === 'string' ? obj['priority'] : 'normal'),
      enabled: obj['enabled'] === undefined ? true : Boolean(obj['enabled']),
      expectedOutcome: validated.data,
      notes: typeof obj['notes'] === 'string' ? obj['notes'] : '',
    });
  });

  return { cases, errors, totalRows: list.length };
}

// ── 导出 ──────────────────────────────────────────────────────────

export function exportDatasetJson(cases: TestCase[]): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      caseCount: cases.length,
      cases: cases.map((c) => ({
        name: c.name,
        input: c.input,
        context: c.context,
        metadata: c.metadata,
        tags: c.tags,
        priority: c.priority,
        enabled: c.enabled,
        expectedOutcome: c.expectedOutcome,
        notes: c.notes,
      })),
    },
    null,
    2,
  );
}

export function exportDatasetCsv(cases: TestCase[]): string {
  const rows = cases.map((c) => [
    c.name,
    c.input,
    c.context,
    c.priority,
    c.tags.join('|'),
    c.enabled ? 'true' : 'false',
    c.expectedOutcome.expectedText,
    c.expectedOutcome.mustContain.join('|'),
    c.expectedOutcome.mustNotContain.join('|'),
    c.expectedOutcome.expectedTools.join('|'),
    c.expectedOutcome.forbiddenTools.join('|'),
    c.expectedOutcome.expectedSchema ? JSON.stringify(c.expectedOutcome.expectedSchema) : '',
    c.expectedOutcome.maxToolCalls === null ? '' : String(c.expectedOutcome.maxToolCalls),
    c.expectedOutcome.requiredEvidence.join('|'),
    c.notes,
  ]);
  return toCsv([...DATASET_CSV_COLUMNS], rows);
}
