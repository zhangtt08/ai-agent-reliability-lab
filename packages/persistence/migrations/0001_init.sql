-- ════════════════════════════════════════════════════════════════════
-- 0001_init.sql — AI Agent Reliability Lab 初始表结构
--
-- 设计铁律：
--   1. 历史不可覆盖。版本类 / 证据类表只能 INSERT，触发器在数据库层强制。
--   2. Dataset 版本一旦 published/golden 即冻结，改 Case 必须 fork 新版本。
--   3. 布尔字段统一用 INTEGER 0/1（驱动层自动归一化）。
--   4. 复杂对象统一 *_json TEXT，避免过度范式化导致迁移困难。
-- ════════════════════════════════════════════════════════════════════

-- ── Agent ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  tags_json     TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id                   TEXT PRIMARY KEY,
  agent_id             TEXT NOT NULL REFERENCES agents(id),
  version              INTEGER NOT NULL,
  label                TEXT NOT NULL DEFAULT '',
  system_prompt        TEXT NOT NULL,
  task_prompt_template TEXT NOT NULL,
  variables_json       TEXT NOT NULL DEFAULT '[]',
  hash                 TEXT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  created_by           TEXT NOT NULL DEFAULT 'system',
  created_at           TEXT NOT NULL,
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_agent ON prompt_versions(agent_id, version);

CREATE TABLE IF NOT EXISTS agent_versions (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  version             INTEGER NOT NULL,
  label               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'draft',
  prompt_version_id   TEXT NOT NULL REFERENCES prompt_versions(id),
  model_config_json   TEXT NOT NULL,
  tools_json          TEXT NOT NULL DEFAULT '[]',
  knowledge_json      TEXT,
  runtime_config_json TEXT NOT NULL,
  runtime_kind        TEXT NOT NULL DEFAULT 'tool-calling',
  fixture_id          TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  created_by          TEXT NOT NULL DEFAULT 'system',
  created_at          TEXT NOT NULL,
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON agent_versions(agent_id, version);
CREATE INDEX IF NOT EXISTS idx_agent_versions_status ON agent_versions(status);

-- 运行配置（Prompt / Model / Tools / RAG / Runtime）一经创建不可修改；只允许改 status / label / notes。
CREATE TRIGGER IF NOT EXISTS trg_agent_versions_immutable
BEFORE UPDATE ON agent_versions
FOR EACH ROW
WHEN OLD.agent_id <> NEW.agent_id
  OR OLD.version <> NEW.version
  OR OLD.prompt_version_id <> NEW.prompt_version_id
  OR OLD.model_config_json <> NEW.model_config_json
  OR OLD.tools_json <> NEW.tools_json
  OR COALESCE(OLD.knowledge_json, '') <> COALESCE(NEW.knowledge_json, '')
  OR OLD.runtime_config_json <> NEW.runtime_config_json
  OR OLD.runtime_kind <> NEW.runtime_kind
  OR OLD.fixture_id <> NEW.fixture_id
BEGIN
  SELECT RAISE(ABORT, 'agent_versions is immutable: create a new version instead of editing history');
END;

-- Prompt 正文不可修改（可改 label / notes）。
CREATE TRIGGER IF NOT EXISTS trg_prompt_versions_immutable
BEFORE UPDATE ON prompt_versions
FOR EACH ROW
WHEN OLD.system_prompt <> NEW.system_prompt
  OR OLD.task_prompt_template <> NEW.task_prompt_template
  OR OLD.variables_json <> NEW.variables_json
  OR OLD.hash <> NEW.hash
  OR OLD.version <> NEW.version
  OR OLD.agent_id <> NEW.agent_id
BEGIN
  SELECT RAISE(ABORT, 'prompt_versions is immutable: create a new prompt version instead');
END;

-- ── Dataset ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  tags_json      TEXT NOT NULL DEFAULT '[]',
  is_golden      INTEGER NOT NULL DEFAULT 0,
  latest_version INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id             TEXT PRIMARY KEY,
  dataset_id     TEXT NOT NULL REFERENCES datasets(id),
  version        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  case_count     INTEGER NOT NULL DEFAULT 0,
  is_golden      INTEGER NOT NULL DEFAULT 0,
  content_hash   TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL DEFAULT 'system',
  created_at     TEXT NOT NULL,
  UNIQUE (dataset_id, version)
);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset ON dataset_versions(dataset_id, version);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_status ON dataset_versions(status);

CREATE TABLE IF NOT EXISTS test_cases (
  id                   TEXT PRIMARY KEY,
  dataset_version_id   TEXT NOT NULL REFERENCES dataset_versions(id),
  name                 TEXT NOT NULL,
  input                TEXT NOT NULL DEFAULT '',
  context              TEXT NOT NULL DEFAULT '',
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  tags_json            TEXT NOT NULL DEFAULT '[]',
  priority             TEXT NOT NULL DEFAULT 'normal',
  enabled              INTEGER NOT NULL DEFAULT 1,
  expected_outcome_json TEXT NOT NULL DEFAULT '{}',
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_cases_version ON test_cases(dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_priority ON test_cases(priority);

-- 冻结保护：published / golden / archived 版本中的 Case 不可增删改。
CREATE TRIGGER IF NOT EXISTS trg_test_cases_frozen_insert
BEFORE INSERT ON test_cases
FOR EACH ROW
WHEN (SELECT status FROM dataset_versions WHERE id = NEW.dataset_version_id)
     IN ('published', 'golden', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'dataset version is frozen: fork a new dataset version to add cases');
END;

CREATE TRIGGER IF NOT EXISTS trg_test_cases_frozen_update
BEFORE UPDATE ON test_cases
FOR EACH ROW
WHEN (SELECT status FROM dataset_versions WHERE id = OLD.dataset_version_id)
     IN ('published', 'golden', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'dataset version is frozen: fork a new dataset version to edit cases');
END;

CREATE TRIGGER IF NOT EXISTS trg_test_cases_frozen_delete
BEFORE DELETE ON test_cases
FOR EACH ROW
WHEN (SELECT status FROM dataset_versions WHERE id = OLD.dataset_version_id)
     IN ('published', 'golden', 'archived')
BEGIN
  SELECT RAISE(ABORT, 'dataset version is frozen: fork a new dataset version to delete cases');
END;

CREATE TRIGGER IF NOT EXISTS trg_dataset_versions_immutable
BEFORE UPDATE ON dataset_versions
FOR EACH ROW
WHEN OLD.dataset_id <> NEW.dataset_id
  OR OLD.version <> NEW.version
  OR (OLD.content_hash <> '' AND OLD.content_hash <> NEW.content_hash)
BEGIN
  SELECT RAISE(ABORT, 'dataset_versions identity/content is immutable: fork a new version');
END;

-- ── 评测器 / Rubric / Gate 定义 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluator_sets (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  judge_mode      TEXT NOT NULL DEFAULT 'all',
  pass_threshold  REAL NOT NULL DEFAULT 1,
  members_json    TEXT NOT NULL DEFAULT '[]',
  is_builtin      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judge_rubrics (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  criteria_json  TEXT NOT NULL DEFAULT '[]',
  pass_threshold REAL NOT NULL DEFAULT 0.7,
  is_builtin     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_gates (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  agent_id               TEXT NOT NULL REFERENCES agents(id),
  rules_json             TEXT NOT NULL DEFAULT '[]',
  require_critical_pass  INTEGER NOT NULL DEFAULT 1,
  require_no_regression  INTEGER NOT NULL DEFAULT 0,
  enabled                INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_gates_agent ON release_gates(agent_id);

-- ── Run ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id),
  agent_version_id      TEXT NOT NULL REFERENCES agent_versions(id),
  dataset_id            TEXT NOT NULL REFERENCES datasets(id),
  dataset_version_id    TEXT NOT NULL REFERENCES dataset_versions(id),
  evaluator_set_id      TEXT NOT NULL REFERENCES evaluator_sets(id),
  status                TEXT NOT NULL DEFAULT 'queued',
  mode                  TEXT NOT NULL DEFAULT 'full',
  run_config_json       TEXT NOT NULL,
  case_count            INTEGER NOT NULL DEFAULT 0,
  passed                INTEGER NOT NULL DEFAULT 0,
  failed                INTEGER NOT NULL DEFAULT 0,
  partial               INTEGER NOT NULL DEFAULT 0,
  errored               INTEGER NOT NULL DEFAULT 0,
  usage_json            TEXT NOT NULL DEFAULT '{}',
  duration_ms           INTEGER NOT NULL DEFAULT 0,
  baseline_run_id       TEXT,
  is_baseline           INTEGER NOT NULL DEFAULT 0,
  reproducibility_json  TEXT,
  error                 TEXT,
  triggered_by          TEXT NOT NULL DEFAULT 'local',
  started_at            TEXT NOT NULL,
  completed_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON evaluation_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_version ON evaluation_runs(agent_version_id);
CREATE INDEX IF NOT EXISTS idx_runs_dataset_version ON evaluation_runs(dataset_version_id);

-- Run 的身份字段不可变更（否则历史不可复现）
CREATE TRIGGER IF NOT EXISTS trg_runs_identity_immutable
BEFORE UPDATE ON evaluation_runs
FOR EACH ROW
WHEN OLD.agent_version_id <> NEW.agent_version_id
  OR OLD.dataset_version_id <> NEW.dataset_version_id
  OR OLD.evaluator_set_id <> NEW.evaluator_set_id
  OR OLD.run_config_json <> NEW.run_config_json
  OR OLD.agent_id <> NEW.agent_id
  OR OLD.dataset_id <> NEW.dataset_id
BEGIN
  SELECT RAISE(ABORT, 'evaluation_runs identity is immutable: start a new run instead');
END;

CREATE TABLE IF NOT EXISTS case_runs (
  id                   TEXT PRIMARY KEY,
  run_id               TEXT NOT NULL REFERENCES evaluation_runs(id),
  test_case_id         TEXT NOT NULL REFERENCES test_cases(id),
  test_case_name       TEXT NOT NULL DEFAULT '',
  priority             TEXT NOT NULL DEFAULT 'normal',
  tags_json            TEXT NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'passed',
  machine_verdict      TEXT NOT NULL DEFAULT 'passed',
  final_output         TEXT NOT NULL DEFAULT '',
  output_json          TEXT,
  trace_id             TEXT,
  usage_json           TEXT NOT NULL DEFAULT '{}',
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  model_latency_ms     INTEGER NOT NULL DEFAULT 0,
  tool_latency_ms      INTEGER NOT NULL DEFAULT 0,
  retrieval_latency_ms INTEGER NOT NULL DEFAULT 0,
  attempt              INTEGER NOT NULL DEFAULT 1,
  failure_category     TEXT,
  error                TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_runs_run ON case_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_case_runs_case ON case_runs(test_case_id);
CREATE INDEX IF NOT EXISTS idx_case_runs_status ON case_runs(run_id, status);
CREATE INDEX IF NOT EXISTS idx_case_runs_failure ON case_runs(failure_category);

-- ── Trace（证据层：全部只 INSERT） ─────────────────────────────────
CREATE TABLE IF NOT EXISTS traces (
  id                TEXT PRIMARY KEY,
  case_run_id       TEXT NOT NULL REFERENCES case_runs(id),
  status            TEXT NOT NULL DEFAULT 'ok',
  step_count        INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  redaction_policy  TEXT NOT NULL DEFAULT 'store_full',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traces_case_run ON traces(case_run_id);

CREATE TABLE IF NOT EXISTS trace_steps (
  id             TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES traces(id),
  seq            INTEGER NOT NULL,
  type           TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'ok',
  started_at     TEXT NOT NULL,
  ended_at       TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  summary        TEXT NOT NULL DEFAULT '',
  payload_json   TEXT NOT NULL DEFAULT '{}',
  model_call_id  TEXT REFERENCES model_calls(id) DEFERRABLE INITIALLY DEFERRED,
  tool_call_id   TEXT REFERENCES tool_calls(id) DEFERRABLE INITIALLY DEFERRED,
  retrieval_id   TEXT REFERENCES retrieval_events(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_trace_steps_trace ON trace_steps(trace_id, seq);
CREATE INDEX IF NOT EXISTS idx_trace_steps_type ON trace_steps(trace_id, type);

CREATE TABLE IF NOT EXISTS model_calls (
  id              TEXT PRIMARY KEY,
  trace_id        TEXT NOT NULL REFERENCES traces(id),
  step_id         TEXT NOT NULL REFERENCES trace_steps(id) DEFERRABLE INITIALLY DEFERRED,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL,
  cost_source     TEXT NOT NULL DEFAULT 'unknown',
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ok',
  error           TEXT,
  prompt_mode     TEXT NOT NULL DEFAULT 'store_full',
  prompt_preview  TEXT,
  output_preview  TEXT,
  stopped         TEXT NOT NULL DEFAULT 'end_turn'
);
CREATE INDEX IF NOT EXISTS idx_model_calls_trace ON model_calls(trace_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id                     TEXT PRIMARY KEY,
  trace_id               TEXT NOT NULL REFERENCES traces(id),
  step_id                TEXT NOT NULL REFERENCES trace_steps(id) DEFERRABLE INITIALLY DEFERRED,
  seq                    INTEGER NOT NULL DEFAULT 0,
  tool_name              TEXT NOT NULL,
  arguments_json         TEXT NOT NULL DEFAULT '{}',
  validated_arguments_json TEXT NOT NULL DEFAULT '{}',
  validation_error       TEXT,
  status                 TEXT NOT NULL DEFAULT 'ok',
  started_at             TEXT NOT NULL,
  ended_at               TEXT NOT NULL,
  duration_ms            INTEGER NOT NULL DEFAULT 0,
  output_summary         TEXT NOT NULL DEFAULT '',
  output_json            TEXT,
  error                  TEXT,
  redacted_paths_json    TEXT NOT NULL DEFAULT '[]',
  attempt                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_trace ON tool_calls(trace_id, seq);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name, status);

CREATE TABLE IF NOT EXISTS retrieval_events (
  id                 TEXT PRIMARY KEY,
  trace_id           TEXT NOT NULL REFERENCES traces(id),
  step_id            TEXT NOT NULL REFERENCES trace_steps(id) DEFERRABLE INITIALLY DEFERRED,
  query              TEXT NOT NULL DEFAULT '',
  rewritten_query    TEXT NOT NULL DEFAULT '',
  mode               TEXT NOT NULL DEFAULT 'keyword',
  top_k              INTEGER NOT NULL DEFAULT 3,
  documents_json     TEXT NOT NULL DEFAULT '[]',
  selected_chunks_json TEXT NOT NULL DEFAULT '[]',
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_retrieval_trace ON retrieval_events(trace_id);

-- 证据一旦写入不得修改
CREATE TRIGGER IF NOT EXISTS trg_trace_steps_immutable
BEFORE UPDATE ON trace_steps FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'trace_steps is append-only evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_model_calls_immutable
BEFORE UPDATE ON model_calls FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'model_calls is append-only evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_tool_calls_immutable
BEFORE UPDATE ON tool_calls FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'tool_calls is append-only evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_retrieval_events_immutable
BEFORE UPDATE ON retrieval_events FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'retrieval_events is append-only evidence'); END;
CREATE TRIGGER IF NOT EXISTS trg_traces_immutable
BEFORE UPDATE ON traces FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'traces is append-only evidence'); END;

-- ── 评测结果 / 指标 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_results (
  id                TEXT PRIMARY KEY,
  case_run_id       TEXT NOT NULL REFERENCES case_runs(id),
  evaluator_key     TEXT NOT NULL,
  evaluator_version TEXT NOT NULL DEFAULT 'v1',
  name              TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'output',
  status            TEXT NOT NULL,
  score             REAL NOT NULL DEFAULT 0,
  severity          TEXT NOT NULL DEFAULT 'major',
  weight            REAL NOT NULL DEFAULT 1,
  blocking          INTEGER NOT NULL DEFAULT 0,
  message           TEXT NOT NULL DEFAULT '',
  details_json      TEXT NOT NULL DEFAULT '{}',
  evidence_json     TEXT NOT NULL DEFAULT '[]',
  duration_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_eval_results_case_run ON evaluation_results(case_run_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_key ON evaluation_results(evaluator_key, status);

CREATE TRIGGER IF NOT EXISTS trg_evaluation_results_immutable
BEFORE UPDATE ON evaluation_results FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'evaluation_results is append-only evidence'); END;

CREATE TABLE IF NOT EXISTS metric_results (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES evaluation_runs(id),
  metric_key     TEXT NOT NULL,
  metric_version TEXT NOT NULL DEFAULT 'v1',
  name           TEXT NOT NULL DEFAULT '',
  value          REAL NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'ratio',
  direction      TEXT NOT NULL DEFAULT 'higher_is_better',
  definition     TEXT NOT NULL DEFAULT '',
  sample_size    INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_metric_results_run ON metric_results(run_id, metric_key);

-- ── 失败 / 人工复核 / 回归 / 门禁 / 建议 ──────────────────────────
CREATE TABLE IF NOT EXISTS failures (
  id                   TEXT PRIMARY KEY,
  case_run_id          TEXT NOT NULL REFERENCES case_runs(id),
  run_id               TEXT NOT NULL REFERENCES evaluation_runs(id),
  category             TEXT NOT NULL DEFAULT 'unknown',
  custom_category      TEXT,
  confidence           REAL NOT NULL DEFAULT 0.5,
  source               TEXT NOT NULL DEFAULT 'rule',
  explanation          TEXT NOT NULL DEFAULT '',
  evidence_json        TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_failures_run ON failures(run_id, category);
CREATE INDEX IF NOT EXISTS idx_failures_case ON failures(case_run_id);

CREATE TABLE IF NOT EXISTS human_reviews (
  id                    TEXT PRIMARY KEY,
  case_run_id           TEXT NOT NULL REFERENCES case_runs(id),
  run_id                TEXT NOT NULL REFERENCES evaluation_runs(id),
  reviewer              TEXT NOT NULL DEFAULT 'local-reviewer',
  verdict               TEXT NOT NULL,
  comment               TEXT NOT NULL DEFAULT '',
  failure_category      TEXT,
  machine_verdict       TEXT NOT NULL,
  machine_snapshot_json TEXT NOT NULL DEFAULT '[]',
  overrides_machine     INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_reviews_case ON human_reviews(case_run_id);
CREATE INDEX IF NOT EXISTS idx_human_reviews_run ON human_reviews(run_id);

-- 人工结论只增不改：历史复核不可被覆盖
CREATE TRIGGER IF NOT EXISTS trg_human_reviews_immutable
BEFORE UPDATE ON human_reviews FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'human_reviews is append-only: add a new review instead of overwriting history'); END;

CREATE TABLE IF NOT EXISTS regressions (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES evaluation_runs(id),
  baseline_run_id TEXT NOT NULL,
  kind           TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'major',
  case_run_id    TEXT,
  test_case_id   TEXT,
  test_case_name TEXT NOT NULL DEFAULT '',
  metric_key     TEXT,
  baseline_value REAL,
  current_value  REAL,
  description    TEXT NOT NULL DEFAULT '',
  evidence_json  TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_regressions_run ON regressions(run_id);

CREATE TABLE IF NOT EXISTS comparisons (
  id                TEXT PRIMARY KEY,
  base_run_id       TEXT NOT NULL REFERENCES evaluation_runs(id),
  target_run_id     TEXT NOT NULL REFERENCES evaluation_runs(id),
  base_label        TEXT NOT NULL DEFAULT '',
  target_label      TEXT NOT NULL DEFAULT '',
  metric_diffs_json TEXT NOT NULL DEFAULT '[]',
  fixed_cases_json  TEXT NOT NULL DEFAULT '[]',
  regressed_cases_json TEXT NOT NULL DEFAULT '[]',
  both_passed       INTEGER NOT NULL DEFAULT 0,
  both_failed       INTEGER NOT NULL DEFAULT 0,
  regressions_json  TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comparisons_pair ON comparisons(base_run_id, target_run_id);

CREATE TABLE IF NOT EXISTS release_decisions (
  id                 TEXT PRIMARY KEY,
  gate_id            TEXT NOT NULL REFERENCES release_gates(id),
  gate_name          TEXT NOT NULL DEFAULT '',
  run_id             TEXT NOT NULL REFERENCES evaluation_runs(id),
  agent_id           TEXT NOT NULL,
  agent_version_id   TEXT NOT NULL,
  result             TEXT NOT NULL,
  rule_results_json  TEXT NOT NULL DEFAULT '[]',
  explanation        TEXT NOT NULL DEFAULT '',
  blocking_failures  INTEGER NOT NULL DEFAULT 0,
  regression_count   INTEGER NOT NULL DEFAULT 0,
  decided_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_decisions_run ON release_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_release_decisions_agent ON release_decisions(agent_id, decided_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_release_decisions_immutable
BEFORE UPDATE ON release_decisions FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'release_decisions is append-only: re-evaluate the gate to create a new decision'); END;

CREATE TABLE IF NOT EXISTS optimization_suggestions (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES evaluation_runs(id),
  agent_id          TEXT NOT NULL,
  agent_version_id  TEXT NOT NULL,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  detail            TEXT NOT NULL DEFAULT '',
  evidence_json     TEXT NOT NULL DEFAULT '[]',
  affected_cases_json TEXT NOT NULL DEFAULT '[]',
  impact            TEXT NOT NULL DEFAULT 'medium',
  confidence        REAL NOT NULL DEFAULT 0.5,
  generator         TEXT NOT NULL DEFAULT 'rule',
  status            TEXT NOT NULL DEFAULT 'new',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_run ON optimization_suggestions(run_id);

CREATE TABLE IF NOT EXISTS prompt_candidates (
  id                       TEXT PRIMARY KEY,
  agent_id                 TEXT NOT NULL REFERENCES agents(id),
  base_prompt_version_id   TEXT NOT NULL,
  system_prompt            TEXT NOT NULL,
  task_prompt_template     TEXT NOT NULL,
  rationale                TEXT NOT NULL DEFAULT '',
  evidence_json            TEXT NOT NULL DEFAULT '[]',
  status                   TEXT NOT NULL DEFAULT 'proposed',
  adopted_prompt_version_id TEXT,
  created_at               TEXT NOT NULL
);

-- ── 队列 / 产物 / 搜索 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  run_id       TEXT,
  progress     REAL NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  done         INTEGER NOT NULL DEFAULT 0,
  message      TEXT NOT NULL DEFAULT '',
  error        TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON analysis_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  run_id     TEXT,
  mime       TEXT NOT NULL DEFAULT 'application/json',
  content    TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, kind);

-- 全文检索（trigram 分词 → 对中文友好；<3 字查询由 repository 回落 LIKE）
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title,
  body,
  kind       UNINDEXED,
  ref_id     UNINDEXED,
  tags       UNINDEXED,
  tokenize = 'trigram'
);
