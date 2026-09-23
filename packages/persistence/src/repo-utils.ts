import type { SqlDriver, SqlParam } from './driver';
import { fromRow, fromRows, planInsert, planUpdate } from './row-mapper';

/**
 * 表名只来自本仓库内的常量，不接受外部输入 —— 因此 `table` 直接拼接是安全的。
 * 所有「值」一律走参数绑定，绝不字符串拼接。
 */

export function insertInto(
  driver: SqlDriver,
  table: string,
  obj: Record<string, unknown>,
  mode: 'insert' | 'replace' | 'ignore' = 'insert',
): void {
  const plan = planInsert(table, obj);
  const verb = mode === 'replace' ? 'INSERT OR REPLACE' : mode === 'ignore' ? 'INSERT OR IGNORE' : 'INSERT';
  driver.run(
    `${verb} INTO ${table} (${plan.columns.join(', ')}) VALUES (${plan.placeholders})`,
    plan.values,
  );
}

export function updateById(
  driver: SqlDriver,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): number {
  const plan = planUpdate(table, patch);
  if (!plan.clause) return 0;
  const res = driver.run(`UPDATE ${table} SET ${plan.clause} WHERE id = ?`, [...plan.values, id]);
  return res.changes;
}

export interface SelectOptions {
  where?: string;
  params?: SqlParam[];
  orderBy?: string;
  limit?: number;
  offset?: number;
}

function buildSql(table: string, options: SelectOptions, count: boolean): string {
  const parts = [count ? `SELECT COUNT(*) AS n FROM ${table}` : `SELECT * FROM ${table}`];
  if (options.where) parts.push(`WHERE ${options.where}`);
  if (!count && options.orderBy) parts.push(`ORDER BY ${options.orderBy}`);
  if (!count && options.limit !== undefined) parts.push(`LIMIT ${Math.max(0, Math.trunc(options.limit))}`);
  if (!count && options.offset !== undefined) parts.push(`OFFSET ${Math.max(0, Math.trunc(options.offset))}`);
  return parts.join(' ');
}

export function selectAll<T>(driver: SqlDriver, table: string, options: SelectOptions = {}): T[] {
  const rows = driver.all<Record<string, unknown>>(buildSql(table, options, false), options.params ?? []);
  return fromRows<T>(table, rows);
}

export function selectOne<T>(driver: SqlDriver, table: string, options: SelectOptions = {}): T | undefined {
  const rows = driver.all<Record<string, unknown>>(buildSql(table, { ...options, limit: 1 }, false), options.params ?? []);
  return rows.length > 0 ? fromRow<T>(table, rows[0]!) : undefined;
}

export function countRows(driver: SqlDriver, table: string, options: SelectOptions = {}): number {
  const row = driver.get<{ n: number }>(buildSql(table, options, true), options.params ?? []);
  return row ? Number(row.n) : 0;
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

export function inClause(column: string, values: (string | number)[]): { sql: string; params: SqlParam[] } {
  if (values.length === 0) return { sql: '1 = 0', params: [] };
  return { sql: `${column} IN (${placeholders(values.length)})`, params: [...values] };
}

export function and(...clauses: (string | undefined | null)[]): string {
  const list = clauses.filter((c): c is string => typeof c === 'string' && c.length > 0);
  return list.length > 0 ? list.join(' AND ') : '1 = 1';
}
