# DECISIONS.md — 架构决策记录

## D-001 SQLite 驱动：node:sqlite 而非 better-sqlite3

- **Context:** 规格要求 SQLite + Drizzle ORM。本机 npm 访问 registry 慢，且 `better-sqlite3` 需要在 `postinstall` 触发原生编译（`node-gyp`），而安装策略要求 `--ignore-scripts` 以保证速度与安全。
- **Alternatives:** (a) `better-sqlite3`（原生，需编译）(b) `sql.js`（WASM，需手动持久化）(c) `node:sqlite`（Node 22 内置）
- **Chosen Approach:** `node:sqlite`（实测 `DatabaseSync` 可用，仅一条 ExperimentalWarning）
- **Why:** 零安装、零原生编译、同步 API、事务语义完整；避免用户环境被 node-gyp/预编译下载污染。
- **Tradeoffs:** 标记 experimental，未来 Node 大版本可能改 API → 已在 `packages/persistence/src/driver.ts` 收敛为唯一适配点，替换成本 = 1 个文件。
- **Future Migration:** 若需生产级稳定，可换 `better-sqlite3` 或 `libsql`，只需重写 driver 适配层。

## D-002 Drizzle 的定位：Schema 单一事实来源 + 类型安全查询封装

- **Context:** 规格要求 Drizzle ORM。`drizzle-orm` 官方无 `node:sqlite` 同步驱动。
- **Alternatives:** (a) 放弃 Drizzle，手写 SQL (b) `drizzle-orm/sqlite-proxy`（异步回调）(c) 用 Drizzle 定义 schema/migration，自建极薄 typed repository 层
- **Chosen Approach:** (c) — Drizzle 的 `sqlite-core` 用于**表结构定义与类型推导**，迁移用 Drizzle 风格生成的静态 SQL 文件，数据访问经 `packages/persistence/src/repositories/*` 的 typed repository。
- **Why:** 保留 Drizzle 的类型价值与表定义单一事实来源，同时不与同步驱动硬碰。
- **Tradeoffs:** 无法使用 Drizzle 的链式 query builder 全部能力；repository 层承担了查询拼装。
- **Future Migration:** 若换 better-sqlite3，可直接启用 `drizzle-orm/better-sqlite3`，schema 定义无需改动。

## D-003 评测确定性优先（Deterministic-first）

- **Context:** 行业常见做法是把评测整体交给 LLM Judge，导致不可复现、不可解释、成本高。
- **Chosen Approach:** 所有可判定为确定性的事实（是否调用了某 Tool、调用次数、参数是否正确、是否合法 JSON、是否含关键词、是否满足 schema）一律用规则 Evaluator。LLM Judge 仅用于开放式语义维度（correctness / groundedness 等），且必须结构化输出 + Zod 校验，并明确其非唯一真相地位。
- **Why:** 可复现、可解释、零成本、可回归比较。
- **Tradeoffs:** 需要为每个 Case 写结构化 ExpectedOutcome，数据准备成本上升 —— 但这正是评测平台应有的纪律。

## D-004 Mock 与真实 Provider 强隔离

- **Context:** 无 API Key 时项目必须完整可演示。
- **Chosen Approach:** `ModelProvider` 接口 + provider registry。`MockModelProvider` 是**一等公民**，但 trace / UI / 报告中始终标注 `provider: "mock"` 且 `costSource: "unknown"`，绝不把 mock 成本伪装成真实费用。
- **Tradeoffs:** 演示数据非真实模型行为 —— 已在 README「Known Limitations」明示。

## D-005 E2E 复用已有 Chromium，禁止下载浏览器

- **Context:** 用户红线：`playwright install` 曾静默删除其在用的 firefox/webkit。
- **Chosen Approach:** 使用 `playwright-core`，`executablePath` 指向已有的 `%LOCALAPPDATA%\ms-playwright\chromium-1243\chrome-win64\chrome.exe`；`npm run test:e2e` 绝不触发浏览器下载。
- **Tradeoffs:** 依赖本机已有浏览器版本；未安装时 E2E 会 skip 并给出明确提示（不静默通过）。

## D-006 Trace 存储粒度：结构化 step 而非纯文本日志

- **Chosen Approach:** `trace_steps` 表按 `seq` 存储结构化 step，`payload_json` 存扩展字段；tool_call / retrieval / model_call 各自有专表以便 SQL 级聚合（如「哪个 Tool 最容易错」）。
- **Why:** Failure Analytics 与 Optimization Suggestions 需要可聚合的数据，纯文本 trace 无法支撑。
