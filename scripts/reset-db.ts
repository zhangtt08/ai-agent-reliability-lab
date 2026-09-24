/**
 * 重置本地演示库（删除后下次启动/seed 自动重建）。
 * 仅限本地演示库；使用前会要求显式传 --yes。
 */
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDatabasePath } from '@arl/persistence';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env['ARL_DB_PATH'] ?? join(root, defaultDatabasePath());

if (!process.argv.includes('--yes')) {
  console.error('[reset] 这会删除本地演示数据库。确认请加 --yes（历史 run / 复核记录将不可恢复）。');
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${dbPath}${suffix}`;
  if (existsSync(file)) {
    rmSync(file, { force: true });
    console.log(`[reset] 已删除 ${file}`);
  }
}
console.log('[reset] 完成。下次启动将自动重新迁移并注入种子数据。');
