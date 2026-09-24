import {
  AnalysisJobSchema,
  ArtifactSchema,
  ids,
  nowIso,
  type AnalysisJob,
  type Artifact,
} from '@arl/shared';
import type { SqlDriver } from '../driver';
import { and, insertInto, placeholders, selectAll, selectOne, updateById } from '../repo-utils';

export function createJobRepository(driver: SqlDriver) {
  const T = 'analysis_jobs';
  const repo = {
    create(input: Partial<AnalysisJob> & { type: AnalysisJob['type']; payload?: Record<string, unknown> }): AnalysisJob {
      const record: AnalysisJob = AnalysisJobSchema.parse({
        id: ids.job(),
        type: input.type,
        status: 'queued',
        runId: input.runId ?? null,
        progress: 0,
        total: input.total ?? 0,
        done: 0,
        message: input.message ?? '',
        error: null,
        payload: input.payload ?? {},
        createdAt: nowIso(),
        startedAt: null,
        completedAt: null,
      });
      insertInto(driver, T, record);
      return record;
    },

    get(id: string): AnalysisJob | undefined {
      return selectOne<AnalysisJob>(driver, T, { where: 'id = ?', params: [id] });
    },

    list(filters: { status?: AnalysisJob['status']; limit?: number } = {}): AnalysisJob[] {
      return selectAll<AnalysisJob>(driver, T, {
        where: filters.status ? 'status = ?' : undefined,
        params: filters.status ? [filters.status] : [],
        orderBy: 'created_at DESC',
        limit: filters.limit ?? 50,
      });
    },

    markRunning(id: string, total: number, message = ''): void {
      updateById(driver, T, id, { status: 'running', startedAt: nowIso(), total, message });
    },

    progress(id: string, done: number, total: number, message = ''): void {
      updateById(driver, T, id, {
        done,
        total,
        progress: total > 0 ? Math.min(1, done / total) : 0,
        message,
      });
    },

    finish(id: string, patch: { status: 'completed' | 'failed' | 'cancelled'; error?: string | null; runId?: string | null }): void {
      updateById(driver, T, id, {
        status: patch.status,
        error: patch.error ?? null,
        ...(patch.runId ? { runId: patch.runId } : {}),
        progress: patch.status === 'completed' ? 1 : undefined,
        completedAt: nowIso(),
      });
    },

    /** 取消：只有 queued/running 才能被取消 */
    cancel(id: string): number {
      return driver.run(`UPDATE ${T} SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('queued','running')`, [
        nowIso(),
        id,
      ]).changes;
    },

    isCancelled(id: string): boolean {
      const job = repo.get(id);
      return job?.status === 'cancelled';
    },
  };
  return repo;
}

export function createArtifactRepository(driver: SqlDriver) {
  const T = 'artifacts';
  const repo = {
    save(input: { kind: Artifact['kind']; name: string; content: string; runId?: string | null; mime?: string }): Artifact {
      const record: Artifact = ArtifactSchema.parse({
        ...input,
        id: ids.artifact(),
        sizeBytes: new TextEncoder().encode(input.content).length,
        createdAt: nowIso(),
      });
      insertInto(driver, T, record);
      return record;
    },

    get(id: string): Artifact | undefined {
      return selectOne<Artifact>(driver, T, { where: 'id = ?', params: [id] });
    },

    list(filters: { runId?: string; kind?: Artifact['kind']; limit?: number } = {}): Artifact[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filters.runId) {
        clauses.push('run_id = ?');
        params.push(filters.runId);
      }
      if (filters.kind) {
        clauses.push('kind = ?');
        params.push(filters.kind);
      }
      return selectAll<Artifact>(driver, T, {
        where: clauses.length ? clauses.join(' AND ') : undefined,
        params,
        orderBy: 'created_at DESC',
        limit: filters.limit ?? 50,
      });
    },

    getByIds(idsList: string[]): Artifact[] {
      if (idsList.length === 0) return [];
      return selectAll<Artifact>(driver, T, {
        where: `id IN (${placeholders(idsList.length)})`,
        params: idsList,
      });
    },
  };
  return repo;
}

export interface SearchHit {
  kind: string;
  refId: string;
  title: string;
  snippet: string;
}

export function createSearchRepository(driver: SqlDriver) {
  const T = 'search_fts';

  const repo = {
    /** upsert：先删同名 kind+refId，再插入，保证索引不重复 */
    index(kind: string, refId: string, title: string, body: string, tags: string[] = []): void {
      driver.transaction(() => {
        driver.run(`DELETE FROM ${T} WHERE kind = ? AND ref_id = ?`, [kind, refId]);
        driver.run(`INSERT INTO ${T} (title, body, kind, ref_id, tags) VALUES (?, ?, ?, ?, ?)`, [
          title,
          body,
          kind,
          refId,
          tags.join(' '),
        ]);
      });
    },

    indexMany(items: { kind: string; refId: string; title: string; body: string; tags?: string[] }[]): void {
      driver.transaction(() => {
        for (const item of items) repo.index(item.kind, item.refId, item.title, item.body, item.tags ?? []);
      });
    },

    clear(kind?: string): void {
      if (kind) driver.run(`DELETE FROM ${T} WHERE kind = ?`, [kind]);
      else driver.run(`DELETE FROM ${T}`);
    },

    /**
     * 搜索策略：
     *  - 查询串 ≥ 3 字符 → FTS5 trigram MATCH（对中文友好）
     *  - 更短（如「餐」这类单字/双字）→ trigram 无法命中，回落 LIKE
     * 这是实测结论，不是猜测（见 KNOWN_ISSUES）。
     */
    search(query: string, options: { kinds?: string[]; limit?: number } = {}): SearchHit[] {
      const q = query.trim();
      if (!q) return [];
      const limit = options.limit ?? 20;
      const kindClause = options.kinds && options.kinds.length > 0 ? `AND kind IN (${placeholders(options.kinds.length)})` : '';
      const kindParams = options.kinds ?? [];

      if (q.length >= 3) {
        try {
          const rows = driver.all<{ kind: string; ref_id: string; title: string; body: string }>(
            `SELECT kind, ref_id, title, body FROM ${T} WHERE ${T} MATCH ? ${kindClause} LIMIT ${Math.max(1, Math.trunc(limit))}`,
            [q, ...kindParams],
          );
          if (rows.length > 0) return rows.map(toHit);
        } catch {
          // MATCH 语法异常（含特殊字符等）时静默回落到 LIKE，不让搜索框把页面搞崩
        }
      }

      const like = `%${q}%`;
      const rows = driver.all<{ kind: string; ref_id: string; title: string; body: string }>(
        `SELECT kind, ref_id, title, body FROM ${T} WHERE (title LIKE ? OR body LIKE ? OR tags LIKE ?) ${kindClause} LIMIT ${Math.max(1, Math.trunc(limit))}`,
        [like, like, like, ...kindParams],
      );
      return rows.map(toHit);
    },

    count(): number {
      const row = driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T}`);
      return row ? Number(row.n) : 0;
    },
  };

  function toHit(r: { kind: string; ref_id: string; title: string; body: string }): SearchHit {
    return {
      kind: r.kind,
      refId: r.ref_id,
      title: r.title,
      snippet: r.body.length > 200 ? `${r.body.slice(0, 200)}…` : r.body,
    };
  }

  return repo;
}

/** 只读统计，供 Dashboard 使用 —— 全部走 SQL 聚合，不把大表拉进内存 */
export function createStatsRepository(driver: SqlDriver) {
  const scalar = (sql: string, params: (string | number)[] = []): number => {
    const row = driver.get<{ v: number | null }>(sql, params);
    return row && row.v !== null ? Number(row.v) : 0;
  };

  return {
    totalAgents: () => scalar('SELECT COUNT(*) AS v FROM agents'),
    totalAgentVersions: () => scalar('SELECT COUNT(*) AS v FROM agent_versions'),
    totalDatasets: () => scalar('SELECT COUNT(*) AS v FROM datasets'),
    totalCases: () => scalar('SELECT COUNT(*) AS v FROM test_cases'),
    totalRuns: () => scalar('SELECT COUNT(*) AS v FROM evaluation_runs'),
    totalCaseRuns: () => scalar('SELECT COUNT(*) AS v FROM case_runs'),
    totalFailures: () => scalar('SELECT COUNT(*) AS v FROM failures'),
    totalRegressions: () => scalar('SELECT COUNT(*) AS v FROM regressions'),
    totalToolCalls: () => scalar('SELECT COUNT(*) AS v FROM tool_calls'),
    pendingReviews: () =>
      scalar(
        `SELECT COUNT(*) AS v FROM case_runs cr
         WHERE cr.machine_verdict IN ('failed','partial','error','timeout')
           AND NOT EXISTS (SELECT 1 FROM human_reviews hr WHERE hr.case_run_id = cr.id)`,
      ),
    gateFailures: () => scalar("SELECT COUNT(*) AS v FROM release_decisions WHERE result = 'FAIL'"),

    /** 最近 N 次 run 的通过率趋势（Dashboard 折线） */
    passRateTrend(limit = 10): { runId: string; label: string; passRate: number; startedAt: string; agentId: string }[] {
      return driver
        .all<{ id: string; agent_id: string; passed: number; case_count: number; started_at: string; agent_name: string; version: number }>(
          `SELECT r.id, r.agent_id, r.passed, r.case_count, r.started_at, a.name AS agent_name, av.version AS version
           FROM evaluation_runs r
           JOIN agents a ON a.id = r.agent_id
           JOIN agent_versions av ON av.id = r.agent_version_id
           WHERE r.status = 'completed' AND r.case_count > 0
           ORDER BY r.started_at DESC LIMIT ${Math.max(1, Math.trunc(limit))}`,
        )
        .map((r) => ({
          runId: r.id,
          agentId: r.agent_id,
          label: `${r.agent_name} v${r.version}`,
          passRate: r.case_count > 0 ? Number(r.passed) / Number(r.case_count) : 0,
          startedAt: r.started_at,
        }));
    },

    /** 跨 run 的失败分类排行（Failure Analytics） */
    topFailureCategories(limit = 6): { category: string; count: number }[] {
      return driver
        .all<{ category: string; n: number }>(
          `SELECT category, COUNT(*) AS n FROM failures GROUP BY category ORDER BY n DESC LIMIT ${Math.max(1, Math.trunc(limit))}`,
        )
        .map((r) => ({ category: r.category, count: Number(r.n) }));
    },

    /** 最难用的 tag：失败率最高的 case tag */
    hardestTags(limit = 5): { tag: string; total: number; failed: number }[] {
      const rows = driver.all<{ tags_json: string; status: string }>(
        `SELECT tags_json, status FROM case_runs`,
      );
      const acc = new Map<string, { total: number; failed: number }>();
      for (const row of rows) {
        let tags: string[] = [];
        try {
          tags = JSON.parse(row.tags_json) as string[];
        } catch {
          tags = [];
        }
        for (const tag of tags) {
          const entry = acc.get(tag) ?? { total: 0, failed: 0 };
          entry.total += 1;
          if (row.status !== 'passed') entry.failed += 1;
          acc.set(tag, entry);
        }
      }
      return [...acc.entries()]
        .map(([tag, v]) => ({ tag, ...v }))
        .sort((a, b) => b.failed - a.failed)
        .slice(0, limit);
    },

    /** 平均成本 / 平均延迟（只用真实数据，unknown 成本不参与） */
    costAndLatencyAverages(): { avgCostUsd: number | null; avgLatencyMs: number; p95LatencyMs: number; costedRuns: number } {
      const row = driver.get<{ avg_cost: number | null; avg_lat: number | null; n_cost: number }>(
        `SELECT AVG(duration_ms) AS avg_lat,
                AVG(CASE WHEN usage_json LIKE '%"costUsd":null%' THEN NULL ELSE json_extract(usage_json, '$.costUsd') END) AS avg_cost,
                SUM(CASE WHEN usage_json LIKE '%"costUsd":null%' THEN 0 ELSE 1 END) AS n_cost
         FROM evaluation_runs WHERE status = 'completed'`,
      );
      // case 端到端耗时的列名是 latency_ms（不是 duration_ms —— 那是 evaluation_runs 的列）
      const latencies = driver
        .all<{ latency_ms: number }>('SELECT latency_ms FROM case_runs ORDER BY latency_ms ASC')
        .map((r) => Number(r.latency_ms));
      return {
        avgCostUsd: row?.avg_cost ?? null,
        avgLatencyMs: row?.avg_lat ?? 0,
        p95LatencyMs: percentile(latencies, 0.95),
        costedRuns: row?.n_cost ?? 0,
      };
    },
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx]!;
}

export { and };
