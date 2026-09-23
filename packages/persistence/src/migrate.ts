import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, nowIso } from '@arl/shared';
import type { SqlDriver } from './driver';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
  pending: string[];
}

export function listMigrationFiles(dir = DEFAULT_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function ensureMigrationsTable(driver: SqlDriver): void {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function appliedMap(driver: SqlDriver): Map<string, string> {
  const rows = driver.all<{ id: string; checksum: string }>('SELECT id, checksum FROM _migrations');
  return new Map(rows.map((r) => [r.id, r.checksum]));
}

/**
 * 执行未应用的迁移。
 * - 已应用的迁移**校验 checksum**：迁移文件被事后篡改会直接报错，而不是静默漂移。
 * - 每个迁移在自己的事务里执行，失败不留半套结构。
 * - 永不 DROP：迁移只做增量，删库需要显式调用 resetDatabase()。
 */
export function runMigrations(driver: SqlDriver, dir = DEFAULT_DIR): MigrationReport {
  ensureMigrationsTable(driver);
  const applied = appliedMap(driver);
  const report: MigrationReport = { applied: [], alreadyApplied: [], pending: [] };

  for (const file of listMigrationFiles(dir)) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = contentHash(sql);
    const previous = applied.get(file);
    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `migration ${file} was modified after it was applied (checksum mismatch). ` +
            'Add a new migration instead of editing history.',
        );
      }
      report.alreadyApplied.push(file);
      continue;
    }
    driver.transaction(() => {
      driver.exec(sql);
      driver.run('INSERT INTO _migrations (id, checksum, applied_at) VALUES (?, ?, ?)', [
        file,
        checksum,
        nowIso(),
      ]);
    });
    report.applied.push(file);
    applied.set(file, checksum);
  }

  for (const file of listMigrationFiles(dir)) {
    if (!applied.has(file)) report.pending.push(file);
  }
  return report;
}

export function migrationStatus(driver: SqlDriver, dir = DEFAULT_DIR): MigrationReport {
  ensureMigrationsTable(driver);
  const applied = appliedMap(driver);
  const files = listMigrationFiles(dir);
  return {
    applied: files.filter((f) => applied.has(f)),
    alreadyApplied: files.filter((f) => applied.has(f)),
    pending: files.filter((f) => !applied.has(f)),
  };
}

export function appliedMigrations(driver: SqlDriver): { id: string; appliedAt: string }[] {
  ensureMigrationsTable(driver);
  return driver
    .all<{ id: string; applied_at: string }>('SELECT id, applied_at FROM _migrations ORDER BY id')
    .map((r) => ({ id: r.id, appliedAt: r.applied_at }));
}

/**
 * 显式破坏性操作：仅在用户明确要求「重置本地演示数据」时调用。
 * 生产/历史库不应触发（见 RECOVERY.md 禁止项）。
 */
export function dropAllTables(driver: SqlDriver): void {
  const tables = driver
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
    )
    .map((r) => r.name);
  driver.transaction(() => {
    driver.exec('PRAGMA foreign_keys = OFF');
    for (const t of tables) driver.exec(`DROP TABLE IF EXISTS "${t}"`);
    driver.exec('PRAGMA foreign_keys = ON');
  });
}
