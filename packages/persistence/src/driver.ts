/**
 * SQLite 驱动适配层 —— 全平台唯一的 `node:sqlite` 接触点。
 *
 * 之所以收敛到这一个文件：`node:sqlite` 在 Node 22 仍标记 experimental，
 * 未来若要替换为 better-sqlite3 / libsql，只需重写本文件（见 DECISIONS.md D-001/D-002）。
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * `node:sqlite` 的加载方式说明（踩过的坑，别改回去）：
 * 直接用 `import { DatabaseSync } from 'node:sqlite'` 时，Vite/Vitest 的模块解析器
 * 会把它当成普通包去 load（报 `Failed to load url sqlite`），因为 Vite 的内置模块表
 * 构建早于 `node:sqlite` 出现。用 createRequire 做一次运行时间接加载，Vite 静态分析
 * 看不到这个 specifier，Node 侧照常原生解析 —— 测试与生产行为一致。
 */
const nodeRequire = createRequire(import.meta.url);
const sqliteModule = nodeRequire('node:sqlite') as typeof import('node:sqlite');
const { DatabaseSync } = sqliteModule;

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParam = string | number | bigint | boolean | null | undefined | Date;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlDriver {
  readonly path: string;
  readonly inMemory: boolean;
  exec(sql: string): void;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): T | undefined;
  run(sql: string, params?: SqlParam[]): RunResult;
  transaction<T>(fn: () => T): T;
  close(): void;
}

/**
 * node:sqlite 只接受 null | number | bigint | string | Uint8Array。
 * boolean / undefined / Date 必须在这里归一化，否则会抛 TypeError。
 */
function normalize(param: SqlParam): SqlValue {
  if (param === undefined || param === null) return null;
  if (typeof param === 'boolean') return param ? 1 : 0;
  if (param instanceof Date) return param.toISOString();
  return param;
}

function normalizeAll(params: SqlParam[]): SqlValue[] {
  return params.map(normalize);
}

/** node:sqlite 返回 null-prototype 对象，统一转成普通对象，避免下游 `Object.hasOwn` 等行为差异 */
function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

export interface OpenOptions {
  /** 文件路径或 ':memory:' */
  path: string;
  /** 建库时自动创建父目录 */
  ensureDir?: boolean;
  verbose?: (sql: string) => void;
}

export function createDriver(options: OpenOptions): SqlDriver {
  const isMemory = options.path === ':memory:';
  const abs = isMemory ? ':memory:' : resolve(options.path);
  if (!isMemory && options.ensureDir !== false) {
    const dir = dirname(abs);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(abs);
  db.exec('PRAGMA foreign_keys = ON');
  if (!isMemory) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  db.exec('PRAGMA busy_timeout = 5000');

  let txDepth = 0;

  const driver: SqlDriver = {
    path: abs,
    inMemory: isMemory,
    exec(sql) {
      if (options.verbose) options.verbose(sql);
      db.exec(sql);
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      if (options.verbose) options.verbose(sql);
      const stmt = db.prepare(sql);
      return (stmt.all(...normalizeAll(params)) as unknown[]).map((r) => plain<T>(r));
    },
    get<T>(sql: string, params: SqlParam[] = []): T | undefined {
      if (options.verbose) options.verbose(sql);
      const stmt = db.prepare(sql);
      const row = stmt.get(...normalizeAll(params));
      return row === undefined ? undefined : plain<T>(row);
    },
    run(sql: string, params: SqlParam[] = []): RunResult {
      if (options.verbose) options.verbose(sql);
      const stmt = db.prepare(sql);
      const res = stmt.run(...normalizeAll(params));
      return {
        changes: Number(res.changes),
        lastInsertRowid: res.lastInsertRowid as number | bigint,
      };
    },
    /**
     * 支持嵌套调用：内层用 SAVEPOINT，避免 "cannot start a transaction within a transaction"。
     */
    transaction<T>(fn: () => T): T {
      const isOuter = txDepth === 0;
      const savepoint = `sp_${txDepth}`;
      if (isOuter) db.exec('BEGIN IMMEDIATE');
      else db.exec(`SAVEPOINT ${savepoint}`);
      txDepth += 1;
      try {
        const result = fn();
        txDepth -= 1;
        if (isOuter) db.exec('COMMIT');
        else db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (err) {
        txDepth -= 1;
        try {
          if (isOuter) db.exec('ROLLBACK');
          else db.exec(`ROLLBACK TO ${savepoint}`);
        } catch {
          /* 回滚失败时保留原始错误 */
        }
        throw err;
      }
    },
    close() {
      db.close();
    },
  };

  return driver;
}

export function createMemoryDriver(): SqlDriver {
  return createDriver({ path: ':memory:' });
}
