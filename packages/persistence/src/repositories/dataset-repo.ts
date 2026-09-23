import {
  DatasetSchema,
  DatasetVersionSchema,
  TestCaseSchema,
  contentHash,
  ids,
  nowIso,
  stableStringify,
  type Dataset,
  type DatasetVersion,
  type DatasetVersionStatus,
  type ExpectedOutcomeInput,
  type Priority,
  type TestCase,
} from '@arl/shared';
import type { SqlDriver } from '../driver';
import { and, countRows, insertInto, placeholders, selectAll, selectOne, updateById } from '../repo-utils';

export interface CreateDatasetInput {
  name: string;
  description?: string;
  tags?: string[];
  isGolden?: boolean;
}

export interface CreateTestCaseInput {
  name: string;
  input: string;
  context?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  priority?: Priority;
  enabled?: boolean;
  expectedOutcome: ExpectedOutcomeInput;
  notes?: string;
}

export interface TestCaseFilters {
  priority?: Priority;
  enabled?: boolean;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function createDatasetRepository(driver: SqlDriver) {
  const DS = 'datasets';
  const DV = 'dataset_versions';
  const TC = 'test_cases';

  const repo = {
    create(input: CreateDatasetInput): Dataset {
      const now = nowIso();
      const dataset: Dataset = DatasetSchema.parse({
        id: ids.dataset(),
        name: input.name,
        description: input.description ?? '',
        tags: input.tags ?? [],
        isGolden: input.isGolden ?? false,
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      insertInto(driver, DS, dataset);
      return dataset;
    },

    get(id: string): Dataset | undefined {
      return selectOne<Dataset>(driver, DS, { where: 'id = ?', params: [id] });
    },

    list(options: { q?: string; limit?: number; offset?: number } = {}): Dataset[] {
      return selectAll<Dataset>(driver, DS, {
        where: options.q ? '(name LIKE ? OR description LIKE ?)' : undefined,
        params: options.q ? [`%${options.q}%`, `%${options.q}%`] : [],
        orderBy: 'created_at DESC',
        limit: options.limit,
        offset: options.offset,
      });
    },

    count(): number {
      return countRows(driver, DS);
    },

    update(id: string, patch: Partial<Pick<Dataset, 'name' | 'description' | 'tags' | 'isGolden'>>): number {
      return updateById(driver, DS, id, { ...patch, updatedAt: nowIso() });
    },

    createVersion(
      datasetId: string,
      options: { status?: DatasetVersionStatus; notes?: string; isGolden?: boolean; createdBy?: string } = {},
    ): DatasetVersion {
      const previous = selectAll<DatasetVersion>(driver, DV, {
        where: 'dataset_id = ?',
        params: [datasetId],
        orderBy: 'version DESC',
        limit: 1,
      });
      const version = (previous[0]?.version ?? 0) + 1;
      const record: DatasetVersion = DatasetVersionSchema.parse({
        id: ids.datasetVersion(),
        datasetId,
        version,
        status: options.status ?? 'draft',
        caseCount: 0,
        isGolden: options.isGolden ?? false,
        contentHash: '',
        notes: options.notes ?? '',
        createdBy: options.createdBy ?? 'system',
        createdAt: nowIso(),
      });
      insertInto(driver, DV, record);
      updateById(driver, DS, datasetId, { latestVersion: version, updatedAt: nowIso() });
      return record;
    },

    getVersion(id: string): DatasetVersion | undefined {
      return selectOne<DatasetVersion>(driver, DV, { where: 'id = ?', params: [id] });
    },

    listVersions(datasetId: string): DatasetVersion[] {
      return selectAll<DatasetVersion>(driver, DV, {
        where: 'dataset_id = ?',
        params: [datasetId],
        orderBy: 'version DESC',
      });
    },

    latestVersion(datasetId: string): DatasetVersion | undefined {
      return selectAll<DatasetVersion>(driver, DV, {
        where: 'dataset_id = ?',
        params: [datasetId],
        orderBy: 'version DESC',
        limit: 1,
      })[0];
    },

    /** 找到最新一个 draft 版本，用于「编辑即新版本」的工作流 */
    latestDraft(datasetId: string): DatasetVersion | undefined {
      return selectAll<DatasetVersion>(driver, DV, {
        where: and('dataset_id = ?', "status = 'draft'"),
        params: [datasetId],
        orderBy: 'version DESC',
        limit: 1,
      })[0];
    },

    setVersionStatus(id: string, status: DatasetVersionStatus, isGolden = false): number {
      return updateById(driver, DV, id, { status, isGolden });
    },

    /** 标记 Golden Dataset：dataset 级 + 版本级同时打标 */
    markGolden(datasetId: string, versionId: string): void {
      driver.transaction(() => {
        updateById(driver, DS, datasetId, { isGolden: true, updatedAt: nowIso() });
        updateById(driver, DV, versionId, { isGolden: true, status: 'golden' });
      });
    },

    /**
     * 冻结一个版本：状态置 published/golden，并写入内容指纹。
     * 冻结后其 case 由数据库触发器拒绝任何增删改。
     */
    freezeVersion(versionId: string, options: { status?: 'published' | 'golden'; notes?: string } = {}): DatasetVersion {
      const version = repo.getVersion(versionId);
      if (!version) throw new Error(`dataset version ${versionId} not found`);
      const cases = repo.listCases(versionId, { limit: 100_000 });
      const hash = contentHash(stableStringify(cases.map((c) => ({ ...c, datasetVersionId: '' }))));
      const status = options.status ?? 'published';
      updateById(driver, DV, versionId, {
        status,
        isGolden: status === 'golden',
        contentHash: hash,
        caseCount: cases.length,
        ...(options.notes ? { notes: options.notes } : {}),
      });
      return repo.getVersion(versionId)!;
    },

    /** 复制一个版本为新的 draft（Golden 数据集演进必须走这条路，不能就地改） */
    forkVersion(versionId: string, options: { notes?: string } = {}): DatasetVersion {
      const source = repo.getVersion(versionId);
      if (!source) throw new Error(`dataset version ${versionId} not found`);
      const created = repo.createVersion(source.datasetId, {
        status: 'draft',
        notes: options.notes ?? `forked from v${source.version}`,
      });
      const cases = repo.listCases(versionId, { limit: 100_000 });
      for (const c of cases) {
        repo.createCase(created.id, {
          name: c.name,
          input: c.input,
          context: c.context,
          metadata: c.metadata,
          tags: c.tags,
          priority: c.priority,
          enabled: c.enabled,
          expectedOutcome: c.expectedOutcome,
          notes: c.notes,
        });
      }
      return repo.getVersion(created.id)!;
    },

    createCase(versionId: string, input: CreateTestCaseInput): TestCase {
      const record: TestCase = TestCaseSchema.parse({
        id: ids.testCase(),
        datasetVersionId: versionId,
        name: input.name,
        input: input.input,
        context: input.context ?? '',
        metadata: input.metadata ?? {},
        tags: input.tags ?? [],
        priority: input.priority ?? 'normal',
        enabled: input.enabled ?? true,
        expectedOutcome: input.expectedOutcome,
        notes: input.notes ?? '',
        createdAt: nowIso(),
      });
      insertInto(driver, TC, record);
      return record;
    },

    createCases(versionId: string, inputs: CreateTestCaseInput[]): TestCase[] {
      return driver.transaction(() => inputs.map((i) => repo.createCase(versionId, i)));
    },

    getCase(id: string): TestCase | undefined {
      return selectOne<TestCase>(driver, TC, { where: 'id = ?', params: [id] });
    },

    listCases(versionId: string, filters: TestCaseFilters = {}): TestCase[] {
      const clauses: string[] = ['dataset_version_id = ?'];
      const params: (string | number)[] = [versionId];
      if (filters.priority) {
        clauses.push('priority = ?');
        params.push(filters.priority);
      }
      if (filters.enabled !== undefined) {
        clauses.push('enabled = ?');
        params.push(filters.enabled ? 1 : 0);
      }
      if (filters.tag) {
        clauses.push('tags_json LIKE ?');
        params.push(`%"${filters.tag}"%`);
      }
      if (filters.q) {
        clauses.push('(name LIKE ? OR input LIKE ?)');
        params.push(`%${filters.q}%`, `%${filters.q}%`);
      }
      return selectAll<TestCase>(driver, TC, {
        where: clauses.join(' AND '),
        params,
        orderBy: "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, name",
        limit: filters.limit,
        offset: filters.offset,
      });
    },

    countCases(versionId: string): number {
      return countRows(driver, TC, { where: 'dataset_version_id = ?', params: [versionId] });
    },

    /** 冻结版本会抛错；调用方应捕获并提示「fork 新版本」 */
    updateCase(id: string, patch: Partial<TestCase>): number {
      return updateById(driver, TC, id, patch);
    },

    deleteCase(id: string): number {
      return driver.run(`DELETE FROM ${TC} WHERE id = ?`, [id]).changes;
    },

    listCasesByIds(ids_: string[]): TestCase[] {
      if (ids_.length === 0) return [];
      return selectAll<TestCase>(driver, TC, {
        where: `id IN (${placeholders(ids_.length)})`,
        params: ids_,
      });
    },

    /** 某个 case 属于哪个版本/数据集 —— 用于 UI 面包屑与 run 校验 */
    locateCase(caseId: string): { testCase: TestCase; version: DatasetVersion; dataset: Dataset } | undefined {
      const testCase = repo.getCase(caseId);
      if (!testCase) return undefined;
      const version = repo.getVersion(testCase.datasetVersionId);
      if (!version) return undefined;
      const dataset = repo.get(version.datasetId);
      if (!dataset) return undefined;
      return { testCase, version, dataset };
    },
  };

  return repo;
}
