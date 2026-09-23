import { createDriver, createMemoryDriver, type SqlDriver } from './driver';
import { listMigrationFiles, runMigrations, type MigrationReport } from './migrate';
import { createAgentRepository, createAgentVersionRepository, createPromptRepository } from './repositories/agent-repo';
import { createDatasetRepository } from './repositories/dataset-repo';
import {
  createEvaluationResultRepository,
  createRunRepository,
  createTraceRepository,
} from './repositories/run-repo';
import {
  createEvaluatorSetRepository,
  createFailureRepository,
  createGateRepository,
  createHumanReviewRepository,
  createRegressionRepository,
  createSuggestionRepository,
} from './repositories/governance-repo';
import {
  createArtifactRepository,
  createJobRepository,
  createSearchRepository,
  createStatsRepository,
} from './repositories/misc-repo';

export interface Store {
  driver: SqlDriver;
  migrations: MigrationReport;
  agents: ReturnType<typeof createAgentRepository>;
  prompts: ReturnType<typeof createPromptRepository>;
  agentVersions: ReturnType<typeof createAgentVersionRepository>;
  datasets: ReturnType<typeof createDatasetRepository>;
  runs: ReturnType<typeof createRunRepository>;
  traces: ReturnType<typeof createTraceRepository>;
  evalResults: ReturnType<typeof createEvaluationResultRepository>;
  failures: ReturnType<typeof createFailureRepository>;
  reviews: ReturnType<typeof createHumanReviewRepository>;
  regressions: ReturnType<typeof createRegressionRepository>;
  gates: ReturnType<typeof createGateRepository>;
  suggestions: ReturnType<typeof createSuggestionRepository>;
  evaluatorSets: ReturnType<typeof createEvaluatorSetRepository>;
  jobs: ReturnType<typeof createJobRepository>;
  artifacts: ReturnType<typeof createArtifactRepository>;
  search: ReturnType<typeof createSearchRepository>;
  stats: ReturnType<typeof createStatsRepository>;
  close(): void;
}

export interface OpenStoreOptions {
  /** 文件路径；不传则用 memory（测试）或默认 data/arl.sqlite */
  path?: string;
  memory?: boolean;
  verbose?: boolean;
  /** 打开时自动执行迁移（默认 true） */
  migrate?: boolean;
}

export function defaultDatabasePath(): string {
  return process.env['ARL_DB_PATH'] ?? 'data/arl.sqlite';
}

export function openStore(options: OpenStoreOptions = {}): Store {
  const memory = options.memory ?? options.path === ':memory:';
  const driver = memory
    ? createMemoryDriver()
    : createDriver({
        path: options.path ?? defaultDatabasePath(),
        verbose: options.verbose ? (sql: string) => console.log(`[sql] ${sql.slice(0, 160)}`) : undefined,
      });

  if (!memory && options.verbose) {
    // 便于排查「迁移没跑」这类问题
    console.log(`[store] sqlite at ${driver.path}`);
  }

  const migrations: MigrationReport =
    options.migrate === false || listMigrationFiles().length === 0
      ? { applied: [], alreadyApplied: [], pending: [] }
      : runMigrations(driver);

  return {
    driver,
    migrations,
    agents: createAgentRepository(driver),
    prompts: createPromptRepository(driver),
    agentVersions: createAgentVersionRepository(driver),
    datasets: createDatasetRepository(driver),
    runs: createRunRepository(driver),
    traces: createTraceRepository(driver),
    evalResults: createEvaluationResultRepository(driver),
    failures: createFailureRepository(driver),
    reviews: createHumanReviewRepository(driver),
    regressions: createRegressionRepository(driver),
    gates: createGateRepository(driver),
    suggestions: createSuggestionRepository(driver),
    evaluatorSets: createEvaluatorSetRepository(driver),
    jobs: createJobRepository(driver),
    artifacts: createArtifactRepository(driver),
    search: createSearchRepository(driver),
    stats: createStatsRepository(driver),
    close() {
      driver.close();
    },
  };
}

export function createTestStore(): Store {
  return openStore({ memory: true });
}
