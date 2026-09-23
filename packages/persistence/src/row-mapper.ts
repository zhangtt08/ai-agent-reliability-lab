/**
 * 行映射器 —— 让 repository 层保持 DRY 的关键。
 *
 * 约定（全平台统一，不得违反）：
 *   camelCase 字段  ↔  snake_case 列名
 *   需要 JSON 序列化的字段 → 列名追加 `_json`
 *   布尔字段 → INTEGER 0/1
 *   undefined → NULL
 *
 * `JSON_COLUMNS` 是唯一的显式登记表：凡是对象/数组类型的字段都必须登记，
 * 由 `tests/unit/persistence-contract.test.ts` 与 Drizzle schema 定义交叉校验。
 */

export const JSON_COLUMNS: Record<string, string[]> = {
  agents: ['tags'],
  prompt_versions: ['variables'],
  agent_versions: ['modelConfig', 'tools', 'knowledge', 'runtimeConfig'],
  datasets: ['tags'],
  dataset_versions: [],
  test_cases: ['metadata', 'tags', 'expectedOutcome'],
  evaluator_sets: ['members'],
  judge_rubrics: ['criteria'],
  release_gates: ['rules'],
  evaluation_runs: ['runConfig', 'usage', 'reproducibility'],
  case_runs: ['tags', 'outputJson', 'usage'],
  traces: [],
  trace_steps: ['payload'],
  model_calls: [],
  tool_calls: ['arguments', 'validatedArguments', 'outputJson', 'redactedPaths'],
  retrieval_events: ['documents', 'selectedChunks'],
  evaluation_results: ['details', 'evidence'],
  metric_results: ['breakdown'],
  failures: ['evidence'],
  human_reviews: ['machineSnapshot'],
  regressions: ['evidence'],
  comparisons: ['metricDiffs', 'fixedCases', 'regressedCases', 'regressions'],
  release_decisions: ['ruleResults'],
  optimization_suggestions: ['evidence', 'affectedCases'],
  prompt_candidates: ['evidence'],
  analysis_jobs: ['payload'],
  artifacts: [],
};

export const BOOLEAN_FIELDS = new Set([
  'isGolden',
  'enabled',
  'blocking',
  'requireCriticalPass',
  'requireNoRegression',
  'isBuiltin',
  'isMock',
  'isBaseline',
  'overridesMachine',
  'selected',
]);

export function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function columnNameFor(table: string, field: string): string {
  const snake = camelToSnake(field);
  if (!JSON_COLUMNS[table]?.includes(field)) return snake;
  // 有些字段的 snake 形式本身就以 _json 结尾（如 outputJson → output_json），不要重复追加
  return snake.endsWith('_json') ? snake : `${snake}_json`;
}

export interface InsertPlan {
  columns: string[];
  placeholders: string;
  values: (string | number | bigint | null)[];
}

function toSqlValue(field: string, value: unknown): string | number | bigint | null {
  if (value === undefined || value === null) return null;
  if (BOOLEAN_FIELDS.has(field) || typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function planInsert(table: string, obj: Record<string, unknown>): InsertPlan {
  const columns: string[] = [];
  const values: (string | number | bigint | null)[] = [];
  for (const [field, value] of Object.entries(obj)) {
    columns.push(columnNameFor(table, field));
    values.push(toSqlValue(field, value));
  }
  return {
    columns,
    placeholders: columns.map(() => '?').join(', '),
    values,
  };
}

export interface UpdatePlan {
  clause: string;
  values: (string | number | bigint | null)[];
}

export function planUpdate(table: string, patch: Record<string, unknown>): UpdatePlan {
  const parts: string[] = [];
  const values: (string | number | bigint | null)[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    parts.push(`${columnNameFor(table, field)} = ?`);
    values.push(toSqlValue(field, value));
  }
  return { clause: parts.join(', '), values };
}

/** 把数据库行还原成领域对象（camelCase + JSON 解析 + 布尔还原） */
export function fromRow<T>(table: string, row: Record<string, unknown>): T {
  const jsonFields = new Set(JSON_COLUMNS[table] ?? []);
  const out: Record<string, unknown> = {};
  for (const [column, raw] of Object.entries(row)) {
    let field: string;
    let value: unknown = raw;
    if (column.endsWith('_json')) {
      const base = snakeToCamel(column.slice(0, -'_json'.length));
      // 形如 outputJson → output_json 的字段，反向必须还原成 outputJson 而不是 output
      const withJsonSuffix = `${base}Json`;
      field = jsonFields.has(withJsonSuffix) ? withJsonSuffix : base;
      if (typeof raw === 'string') {
        try {
          value = JSON.parse(raw);
        } catch {
          // 坏数据不能让整行读取崩掉，保留原始字符串并标注
          value = raw;
        }
      }
    } else {
      field = snakeToCamel(column);
      if (BOOLEAN_FIELDS.has(field) && (raw === 0 || raw === 1)) value = raw === 1;
    }
    if (jsonFields.has(field) && value === null) value = null;
    out[field] = value;
  }
  return out as T;
}

export function fromRows<T>(table: string, rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => fromRow<T>(table, r));
}
