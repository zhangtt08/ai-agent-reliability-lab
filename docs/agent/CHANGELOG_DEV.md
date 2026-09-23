# CHANGELOG_DEV.md — 开发变更日志

（开发期日志，非产品 CHANGELOG）

## 2026-09-23 — Session 1

### Stage 0 — Bootstrap
- 初始化 monorepo（npm workspaces：`packages/*` + `apps/*`）。
- 建立 `docs/agent/` 持久化项目记忆（PROJECT_STATE / MASTER_PLAN / NEXT_ACTION / DECISIONS / TEST_STATUS / EVAL_STATUS / KNOWN_ISSUES / CHANGELOG_DEV / ARCHITECTURE / RECOVERY）。
- 环境探测：Node v22.22.2；`node:sqlite` 可用；本机已有 Chromium `chromium-1243`（E2E 复用，不下载）。
- 架构决策 D-001 ~ D-006 落档。

### Stage 1 — Domain Models + Persistence
- `packages/shared`：全量 Zod 领域模型（Agent/AgentVersion/PromptVersion/Dataset/TestCase/ExpectedOutcome/Run/CaseRun/Trace/Evaluator/Failure/HumanReview/Gate/…）。
- 失败分类法 14 类 + 优先级 + 各状态机常量；JSON Schema 子集校验器（不引入 ajv）；TraceRedactor（凭据正则 + 结构脱敏 + 三种隐私策略）。
- `packages/persistence`：`node:sqlite` 驱动适配（参数归一化、嵌套事务 SAVEPOINT）、迁移系统（checksum 校验）、
  29 张表 + 不可覆盖触发器（agent_versions / prompt_versions / dataset 冻结 / run 身份 / 证据只增） + FTS5(trigram) 搜索。
- **踩坑**：Vite 解析不了 `node:sqlite` → 改 createRequire 间接加载；
  vitest 并发写模块缓存 EPERM 导致测试文件静默丢失 → 改 `fileParallelism: false`。
- 单元测试 122 项全绿，其中「写入契约」一测发现并修掉了 `humanVerdict` 无对应列、`outputJson` 被拼成 `output_json_json` 两个真 bug。

### Stage 2 — Provider + Agent Runtime
- `packages/providers`：ModelProvider 接口、MockModelProvider（一等公民）、确定性 fixture 策略
  （stable / wrong-tool / wrong-args / bad-format / rag-failure / loop / hallucination / regression-v2 / slow / flaky）、
  LLM Judge 替身（读 `[ARL_JUDGE_PAYLOAD]` 按 rubric 确定性打分）、OpenAI-compatible 真实实现、Provider 注册表。
- `packages/runtime`：BM25 + trigram 伪向量检索（含查询改写、Recall@K / Hit@K）、Fixture 工具集（7 个）+ 执行器
  （schema 校验 → 故障注入 → 敏感字段脱敏）、Trace 采集器（6 类 step，落库前脱敏）、
  ToolCallingAgent（RAG → model ↔ tool 循环 → output，含 loop guard / 步数 / 工具数 / 时间预算四重保护）、
  SimplePromptAgent、runtime 注册表、硬超时包装。
- 冒烟验证：trace 顺序正确；loop 在 3 次相同调用后被判定并终止；空订单号被判 `invalid_arguments`；幻觉文本成功注入。
