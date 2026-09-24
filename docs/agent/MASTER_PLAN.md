# MASTER_PLAN.md — 完整任务树

状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[!]` 阻塞

## Stage 0 — Bootstrap + Persistent Agent Memory

- [x] 建立 `docs/agent/` 十个记忆文件
- [x] Monorepo 结构（packages/* + apps/*）
- [x] 依赖安装脚本与本地环境适配
- [x] `git init` + 首个 checkpoint commit
- [x] 冒烟：`npm test` 全绿（122 项单元测试）

## Stage 1 — Domain Models + Persistence

- [x] `packages/shared`：Zod schema（Agent / AgentVersion / PromptVersion / ToolDefinition / Dataset / TestCase / ExpectedOutcome / Evaluator / Metric / Failure / HumanReview / ReleaseGate …）
- [x] ID 生成与时间工具
- [x] `TraceRedactor`（Secret / 敏感字段脱敏）
- [x] `packages/persistence`：SQLite 引擎封装（node:sqlite）
- [x] 迁移系统（`migrations/*.sql` + `_migrations` 版本表，禁止删库）
- [x] 表：agents / agent_versions / prompt_versions / tool_definitions / datasets / dataset_versions / test_cases
- [x] 表：evaluation_runs / case_runs / traces / trace_steps / tool_calls / retrieval_events / model_calls
- [x] 表：evaluators / evaluator_sets / evaluation_results / metrics
- [x] 表：failures / failure_categories / human_reviews / release_gates / release_decisions / analysis_jobs
- [x] Repository 层（不可覆盖历史：版本类表只插入不更新）
- [x] 单元测试：schema 校验、迁移幂等、版本不可覆盖

## Stage 2 — Provider + Agent Runtime

- [x] `ModelProvider` 接口（generate / generateStructured / usage / latency / modelName）
- [x] `MockModelProvider`（确定性、可脚本化）
- [x] Provider 注册表（预留 OpenAI / Anthropic / Gemini / OpenAI-compatible / Local）
- [x] `AgentRuntime` 接口 → `AgentRunResult { finalOutput, trace, usage, duration, status, error }`
- [x] `SimplePromptAgent`
- [x] `ToolCallingAgent`（Tool 调用循环 + 最大步数保护）
- [x] Tool 执行器 + Fixture Tools（getOrder / searchKnowledge / calculatePrice / createTicket / lookupUser / getBalance / refundOrder）
- [x] Tool 调用完整捕获（arguments / validatedArguments / status / outputSummary / error）
- [x] 单元测试：runtime 契约、tool 参数校验、最大步数

## Stage 3 — Dataset + Test Case

- [x] Dataset / DatasetVersion CRUD
- [x] TestCase CRUD（input / context / tags / priority / enabled / expectedOutcome）
- [x] `ExpectedOutcome` 结构化规则（expectedText / mustContain / mustNotContain / expectedSchema / expectedTools / forbiddenTools / expectedToolArgs / maxToolCalls / requiredEvidence / expectedClassification / customRules）
- [x] JSON / CSV 导入（逐行校验，坏行不炸整批）
- [x] JSON / CSV 导出
- [x] Golden Dataset 标记 + 修改即新版本
- [x] 三个真实感 Mock Dataset（Customer Support / Knowledge QA / Tool Calling），各含正常 / 边界 / 失败 / Critical Case
- [x] 单元测试：ExpectedOutcome 校验、导入器容错

## Stage 4 — Trace System

- [x] Trace / TraceStep 模型（model_call / tool_call / retrieval / decision / output / error）
- [x] Trace 采集器接入 runtime
- [x] ModelCall 记录（usage / latency / status / prompt 隐私策略）
- [x] RetrievalEvent 记录（query / rewrittenQuery / documents / scores / rank / selectedChunks / source / latency）
- [x] TraceRedactor 接入保存路径
- [x] 单元测试：TraceRedactor、step 顺序
- [x] Prompt 隐私策略：store_full / store_redacted / store_metadata_only

## Stage 5 — Deterministic Evaluators

- [x] Evaluator 接口 `evaluate(caseRun, testCase): EvaluationResult`
- [x] ExactMatchEvaluator
- [x] ContainsEvaluator
- [x] RegexEvaluator
- [x] JsonSchemaEvaluator
- [x] ToolCalledEvaluator
- [x] ToolNotCalledEvaluator
- [x] ToolArgumentEvaluator
- [x] ToolCallCountEvaluator
- [x] ToolOrderEvaluator
- [x] LatencyEvaluator
- [x] CostEvaluator
- [x] RetrievalHitEvaluator（expected doc / chunk / top-K）
- [x] GroundednessRuleEvaluator（证据覆盖）
- [x] LoopDetector（重复 tool / 重复 action / step 超限）
- [x] RuleJudge（ALL / ANY / Weighted）
- [x] 单元测试：每个 evaluator 正反例

## Stage 6 — Metrics Engine

- [x] Metric 定义（版本化：`task_success@v1` 等）
- [x] Task Pass Rate / Fail Rate / Partial Rate
- [x] Tool Accuracy
- [x] Format Compliance
- [x] Groundedness
- [x] Average / P50 / P95 Latency
- [x] Average Cost
- [x] Failure Distribution
- [x] 每个指标带 `definition` 说明计算方式
- [x] 单元测试：聚合数值精确断言

## Stage 7 — Evaluation Run Pipeline

- [x] EvaluationRun 生命周期（queued / running / completed / failed / cancelled）
- [x] Case Runner：串行 + 有限并发（concurrency limit）
- [x] Timeout / Retry / Cancellation
- [x] Retry 策略区分基础设施失败与 Agent 失败
- [x] Case 级 Error Boundary（单 case 崩不影响批次）
- [x] 可复现性记录（agent version / dataset version / evaluator version / model config / temperature / runtime config / seed / timestamp）
- [x] AnalysisJob 队列
- [x] 单元/集成测试：pipeline 端到端（fixture agent → trace → evaluator → metric）

## Stage 8 — Failure + Regression

- [x] Failure Taxonomy（13 个标准分类 + 自定义扩展）
- [x] Deterministic FailureClassifier（基于证据）
- [x] RegressionDetector（Fail→Pass / Pass→Fail / 延迟回归 / 成本回归）
- [x] Baseline 机制（标记某次 Run 为 baseline）
- [x] Case-level Diff（Fixed / Regressed / BothFail / BothPass）
- [x] Failure Clustering（按 category / tag / tool）
- [x] 单元测试：regression fixture（V1 10/10 Pass，V2 9/10 → 必须检出 1 regression）

## Stage 9 — LLM Judge + Human Review

- [x] JudgeRubric 模型（维度 / weight / scoreRange）
- [x] LLMJudgeEvaluator（Structured Output + Zod 校验 + 解析失败重试/降级）
- [x] 严格声明：LLM Judge 只是 Evaluator 之一，不是唯一真相
- [x] HumanReview（Pass / Fail / Partial / Override / Comment / FailureCategory）
- [x] 机器结果与人工结果并存可对比（人工不覆盖机器）
- [x] 单元测试：Mock Judge、人工覆盖不丢失机器结果

## Stage 10 — Version Comparison

- [x] Agent Version A/B 对比（相同 Dataset）
- [x] Metric Diff / Fixed / Regressed / Changed Failures / Cost Diff / Latency Diff
- [x] Prompt Version Diff（文本 diff）
- [x] Prompt Regression 展示（Prompt Diff + Performance Diff）
- [x] Experiment（离线对比，不是在线 A/B）

## Stage 11 — Release Gate

- [x] Gate 规则模型（阈值 + 目标 metric + scope）
- [x] Critical Case 规则（critical 必须全通过）
- [x] 结果：PASS / FAIL / BLOCKED / UNKNOWN + 逐条解释
- [x] ReleaseDecision 持久化
- [x] 单元测试：Pass Rate 90% vs Gate 95% → 必须 FAIL

## Stage 12 — Dashboard + Explorer

- [x] Dashboard（Agents / Runs / Pass Rate / Regression / Gate Failure / Cost / Latency / Top Failures）
- [x] Agents 页面 + Agent Detail（Overview / Versions / Runs / Prompts / Tools / Comparisons）
- [x] Dataset 页面（Case 表 + 编辑）
- [x] Run 页面（Metrics / Cases / Failures / Trace Summary / Gate）
- [x] Run Explorer（筛选 Passed / Failed / Category / Tag / Priority）
- [x] Case Run Detail（Input / Expected / Output / Evaluations / Trace / Tools / Retrieval / Review）
- [x] Trace Viewer（时间序 + 展开 + 过滤 Tool/Retrieval/Error）
- [x] Compare 页面
- [x] Failure Center
- [x] Release Center
- [x] Human Review Queue
- [x] Search（SQLite FTS）
- [x] UI 风格：Linear / GitHub Actions 式高信息密度，禁止紫色渐变与营销 Hero

## Stage 13 — Optimization Suggestions

- [x] OptimizationSuggestion（prompt / tool / rag / runtime / dataset / guardrail）
- [x] 必须附 Evidence（如「12/18 失败 Case 在 getOrder 缺少 orderId」）
- [x] Prompt Candidate（P1，绝不自动覆盖生产 Prompt）

## Stage 14 — Integration + E2E

- [x] Integration：fixture agent → runtime → trace → evaluator → metric
- [x] Evaluation Integrity Tests（错 Tool Agent 必须被判 FAIL、Loop Agent 必须检出）
- [x] E2E 主流程（Dashboard → Dataset → Run → Failure → Trace → Compare → Regression → Gate）
- [x] Fixture：Release Gate 95% 阈值 vs 90% 实际 → FAIL

## Stage 15 — Security + Performance

- [x] 禁止记录 API Key / Secret / Credential
- [x] Trace 保存前 redaction
- [x] 日志结构化且无 Secret
- [x] 分页 / 避免一次性加载全部 Trace / 并发上限
- [x] 错误处理（Provider 故障 / 超时 / 工具异常 / DB 异常 / 取消）

## Stage 16 — Recovery Audit + Documentation

- [x] README（What / Why / Features / Architecture / Pipeline / Quick Start / Testing / Security / Limitations / Roadmap）
- [x] Recovery Drill（只读 `docs/agent/` 能否判断现状）
- [x] Fresh Agent Handoff Drill
- [x] Final Acceptance 自查
- [x] 交付报告
