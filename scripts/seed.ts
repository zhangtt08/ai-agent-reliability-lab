/**
 * 将 Demo 种子数据写入本地文件库（默认 data/arl.sqlite）。
 * 幂等：已有数据时跳过（可用 --force 删库重建）。
 *
 * 运行：npm run seed [-- --force]
 */
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, defaultDatabasePath, dropAllTables } from '@arl/persistence';
import { seedDemoData } from '../apps/server/src/services/seed';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const dbPath = process.env['ARL_DB_PATH'] ?? join(root, defaultDatabasePath());

if (force && existsSync(dbPath)) {
  console.warn(`[seed] --force：删除现有库 ${dbPath}（这是唯一允许删库的入口，且仅限本地演示库）`);
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

const store = openStore({ path: dbPath });
const summary = seedIfEmptyLocal(store);

if (summary) {
  console.log('[seed] 完成：');
  console.table(summary.agents.map((a) => ({ agent: a.name, version: a.version, fixtureId: a.fixtureId })));
  console.table(summary.datasets.map((d) => ({ dataset: d.name, versionId: d.versionId, cases: d.caseCount })));
  console.log(`[seed] evaluator sets: ${summary.evaluatorSets.map((s) => s.name).join(' / ')}`);
  console.log(`[seed] release gates: ${summary.gates.length} 个`);
} else {
  console.log('[seed] 库中已有数据，跳过（使用 --force 重建）');
}

store.close();

function seedIfEmptyLocal(s: ReturnType<typeof openStore>) {
  if (s.agents.count() > 0) return null;
  return seedDemoData(s);
}

void dropAllTables;
