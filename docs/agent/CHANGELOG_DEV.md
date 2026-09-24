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

### Stage 3~8 — Dataset / Evaluators / Metrics / Pipeline / Failure / Regression / Gate
- `dataset-io`：JSON/CSV 导入导出（RFC4180 解析器、逐行校验、坏行不炸整批）。
- `@arl/evaluation`：19 个内置确定性 evaluator + RuleJudge（all/any/weighted + blocking 语义） +
  18 个带 definition 的指标 + 确定性失败归因（12 级证据强度递减） + 回归检测（用例/指标/延迟/成本） +
  Release Gate（PASS/FAIL/BLOCKED/UNKNOWN 四态 + 逐条解释） + LLM Judge（Zod 强校验） + 规则化优化建议（必须带证据）。
- Run Pipeline：有限并发池、case 级错误隔离、可复现性快照、进度任务、失败归因落库、回归/门禁/建议后处理。
- 种子数据：10 个 fixture agent（含回归 V2 / 限流 / 慢速）+ 3 个 golden 数据集（15 用例）+ 5 个评测集 + 2 个门禁。
- **Dogfood 实测**（scripts/dogfood.ts）：stable 15/15 全绿；7 类缺陷 agent 全部被对应 evaluator 检出；
  限流 fixture 被重试策略正确吸收；回归 V2 精确检出 1 条用例回归；严格门禁(95%)对 V2 判 FAIL。
- **踩坑与修复**：
  1) traces ↔ steps/calls 互引用外键 → 改 DEFERRABLE INITIALLY DEFERRED + createBundle 单事务落证据；
  2) 证据 id 必须沿用 collector 生成的值（repository 曾重新生成导致引用断裂）；
  3) 意图规则需分层（实体规则优先于"为什么/怎么"这类泛问词），否则"我的订单为什么重复扣款"会被误路由；
  4) LLM Judge 的 groundedness 语义与规则版幻觉检测对齐：惩罚"无出处的硬事实"，而不是"没有复读上下文"。

### Stage 12~16 — Dashboard / API / 集成 / E2E / 文档
- Express API 全量端点（overview / agents+versions+prompts+diff / datasets+import+export / runs+jobs / case+trace / review / compare / failures / suggestions+prompt-candidates / gates+decisions / search / providers / evaluators / rubrics）。
- Web：Dashboard、Agents、AgentDetail（版本状态机 + Prompt diff）、Datasets、DatasetDetail（冻结/Fork/导入导出）、Runs（启动评测 + 进度）、RunDetail（指标卡片带 definition、Gate 逐条解释、用例筛选、建议、可复现性快照）、CaseDetail（评测结果+证据、失败归因、Trace Viewer 按类型过滤展开、人工复核表单）、Compare（指标差异 + Fixed/Regressed + 失败形态变化）、Failures、Reviews（队列+一致性矩阵）、Release（门禁规则 + 决策历史 + Prompt 候选采纳）、Search（FTS5）。
- 集成测试 17 项 + E2E 12 步（复用本机 chromium-1243，截图 10 张）。
- **修掉的真 bug**：stats 查询用了不存在的 `case_runs.duration_ms`（应为 latency_ms）；人工复核 verdict 与 case status 枚举不一致导致 overridesMachine 误判。
- 最终验证：tsc 0 error；单测 174/174；集成 17/17；E2E 12/12；dogfood stable 15/15 + 7 类缺陷全检出。

### Self Review（§100）+ Recovery/Handoff Drill（§102/103）
- 七角色自审发现并修复 3 个真问题：
  1) `scripts/dev.mjs` 含 TS 语法但被 node 按纯 JS 执行 → `npm run dev` 直接崩（改写为纯 JS，实测双端口恢复）；
  2) RunDetail 对已完成 run 仍然每 2s 轮询 → 改为仅 running 时轮询、状态变化经 useEffect 刷新；
  3) `evaluators.ts` 残留一个恒返回 'major' 的无效函数与 `main.ts` 死代码 → 移除。
- 清理了上一 session 遗留的 8787 端口服务进程（属本 session 自己启动的进程）。
- Drill 证据落档：`docs/agent/RECOVERY_DRILL.md`（失忆恢复 + 新 Agent 交接均通过，且 Drill 过程中实际暴露并修复了 dev.mjs bug）。
- 最终交付报告：`docs/agent/FINAL_REPORT.md`。
