import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ALL_TABLES, JSON_COLUMNS, columnNameFor, createTestStore, openStore, runMigrations } from '@arl/persistence';

/**
 * Drizzle schema 是 DDL 契约的单一事实来源。
 * 本测试把它与 migrations 实际建出的表结构逐列比对 —— schema 一旦与迁移漂移就红。
 */
describe('持久层契约：Drizzle schema ↔ SQLite 实际表结构', () => {
  const store = createTestStore();

  it('迁移已全部应用', () => {
    expect(store.migrations.applied).toContain('0001_init.sql');
  });

  it.each(Object.entries(ALL_TABLES))('表 %s 的列与 Drizzle 定义完全一致', (tableName, table) => {
    const actual = store.driver.all<{ name: string }>(`PRAGMA table_info(${tableName})`).map((r) => r.name);
    expect(actual.length).toBeGreaterThan(0);
    const declared = Object.values(getTableColumns(table as never) as Record<string, { name: string }>).map((c) => c.name);
    expect([...actual].sort()).toEqual([...declared].sort());
  });

  it('JSON_COLUMNS 登记的每个字段都能映射到真实 *_json 列', () => {
    for (const [table, fields] of Object.entries(JSON_COLUMNS)) {
      const actual = new Set(store.driver.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name));
      expect(actual.size, `表 ${table} 不存在`).toBeGreaterThan(0);
      for (const field of fields) {
        const column = columnNameFor(table, field);
        expect(column.endsWith('_json'), `${table}.${field} 应映射到 *_json 列`).toBe(true);
        expect(actual.has(column), `列 ${table}.${column} 缺失`).toBe(true);
      }
    }
  });

  it('不存在的表名不会静默通过（PRAGMA 返回空则视为失败）', () => {
    const bogus = store.driver.all('PRAGMA table_info(not_a_real_table)');
    expect(bogus).toHaveLength(0);
  });

  it('迁移 checksum 被篡改时会报错（历史不可悄悄漂移）', () => {
    const s = openStore({ memory: true });
    s.driver.run('UPDATE _migrations SET checksum = ? WHERE id = ?', ['deadbeef', '0001_init.sql']);
    expect(() => runMigrations(s.driver)).toThrow(/checksum mismatch/);
    s.close();
  });

  it('重复执行迁移是幂等的', () => {
    const s = openStore({ memory: true });
    const second = runMigrations(s.driver);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied).toContain('0001_init.sql');
    s.close();
  });
});
