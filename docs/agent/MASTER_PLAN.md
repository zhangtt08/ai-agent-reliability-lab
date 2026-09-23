# MASTER_PLAN.md — 完整任务树

状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[!]` 阻塞

## Stage 0 — Bootstrap + Persistent Agent Memory

- [x] 建立 `docs/agent/` 十个记忆文件
- [x] Monorepo 结构（packages/* + apps/*）
- [x] 依赖安装脚本与本地环境适配
- [ ] `git init` + 首个 checkpoint commit
- [ ] 冒烟：`npm test` 能跑起来（空测试集）

## Stage 1 — Domain Models + Persistence

- [ ] `packages/shared`：Zod schema（Agent / AgentVersion / PromptVersion / ToolDefinition / Dataset / TestCase / ExpectedOutcome / Evaluator / Metric / Failure / HumanReview / ReleaseGate …）
- [ ] ID 生成与时间工具
- [ ] `TraceRedactor`（Secret / 敏感字段脱敏）
- [ ] `packages/persistence`：SQLite 引擎封装（node:sqlite）
- [ ] 迁移系统（`migrations/*.sql` + `_migrations` 版本表，禁止删库）
- [ ] 表：agents / agent_versions / prompt_versions / tool_definitions / datasets / dataset_versions / test_cases
- [ ] 表：evaluation_runs / case_runs / traces / trace_steps / tool_calls / retrieval_events / model_calls
- [ ] 表：evaluators / evaluator_sets / evaluation_results / metrics
- [ ] 表：failures / failure_categories / human_reviews / release_gates / release_decisions / analysis_jobs
- [ ] Repository 层（不可覆盖历史：版本类表只插入不更新）
- [ ] 单元测试：schema 校验、迁移幂等、版本不可覆盖

## Stage 2 — Provider + Agent Runtime

- [ ] `ModelProvider` 接口（generate / generateStructured / usage / latency / modelName）
- [ ] `MockModelProvider`（确定性、可脚本化）
- [ ] Provider 注册表（预留 OpenAI / Anthropic / Gemini / OpenAI-compatible / Local）
- [ ] `AgentRuntime` 接口 → `AgentRunResult { finalOutput, trace, usage, duration, status, error }`
- [ ] `SimplePromptAgent`
- [ ] `ToolCallingAgent`（Tool 调用循环 + 最大步数保护）
- [ ] Tool 执行器 + Fixture Tools（getOrder / searchKnowledge / calculatePrice / createTicket / lookupUser / getBalance / refundOrder）
- [ ] Tool 调用完整捕获（arguments / validatedArguments / status / outputSummary / error）
- [ ] 单元测试：runtime 契约、tool 参数校验、最大步数

## Stage 3 — Dataset + Test Case

- [ ] Dataset / DatasetVersion CRUD
- [ ] TestCase CRUD（input / context / tags / priority / enabled / expectedOutcome）
- [ ] `ExpectedOutcome` 结构化规则（expectedText / mustContain / mustNotContain / expectedSchema / expectedTools / forbiddenTools / expectedToolArgs / maxToolCalls / requiredEvidence / expectedClassification / customRules）
- [ ] JSON / CSV 导入（逐行校验，坏行不炸整批）
- [ ] JSON / CSV 导出
- [ ] Golden Dataset 标记 + 修改即新版本
- [ ] 三个真实感 Mock Dataset（Customer Support / Knowledge QA / Tool Calling），各含正常 / 边界 / 失败 / Critical Case
- [ ] 单元测试：ExpectedOutcome 校验、导入器容错

## Stage 4 — Trace System

- [ ] Trace / TraceStep 模型（model_call / tool_call / retrieval / decision / output / error）
- [ ] Trace 采集器接入 runtime
- [ ] ModelCall 记录（usage / latency / status / prompt 隐私策略）
- [ ] RetrievalEvent 记录（query / rewrittenQuery / documents / scores / rank / selectedChunks / source / latency）
- [ ] TraceRedactor 接入保存路径
- [ ] 单元测试：TraceRedactor、step 顺序
- [ ] Prompt 隐私策略：store_full / store_redacted / store_metadata_only

## Stage 5 — Deterministic Evaluators

- [ ] Evaluator 接口 `evaluate(caseRun, testCase): EvaluationResult`
- [ ] ExactMatchEvaluator
- [ ] ContainsEvaluator
- [ ] RegexEvaluator
- [ ] JsonSchemaEvaluator
- [ ] ToolCalledEvaluator
- [ ] ToolNotCalledEvaluator
- [ ] ToolArgumentEvaluator
- [ ] ToolCallCountEvaluator
- [ ] ToolOrderEvaluator
- [ ] LatencyEvaluator
- [ ] CostEvaluator
- [ ] RetrievalHitEvaluator（expected doc / chunk / top-K）
- [ ] GroundednessRuleEvaluator（证据覆盖）
- [ ] LoopDetector（重复 tool / 重复 action / step 超限）
- [ ] RuleJudge（ALL / ANY / Weighted）
- [ ] 单元测试：每个 evaluator 正反例

## Stage 6 — Metrics Engine

- [ ] Metric 定义（版本化：`task_success@v1` 等）
- [ ] Task Pass Rate / Fail Rate / Partial Rate
- [ ] Tool Accuracy
- [ ] Format Compliance
- [ ] Groundedness
- [ ] Average / P50 / P95 Latency
- [ ] Average Cost
- [ ] Failure Distribution
- [ ] 每个指标带 `definition` 说明计算方式
- [ ] 单元测试：聚合数值精确断言

## Stage 7 — Evaluation Run Pipeline

- [ ] EvaluationRun 生命周期（queued / running / completed / failed / cancelled）
- [ ] Case Runner：串行 + 有限并发（concurrency limit）
- [ ] Timeout / Retry / Cancellation
- [ ] Retry 策略区分基础设施失败与 Agent 失败
- [ ] Case 级 Error Boundary（单 case 崩不影响批次）
- [ ] 可复现性记录（agent version / dataset version / evaluator version / model config / temperature / runtime config / seed / timestamp）
- [ ] AnalysisJob 队列
- [ ] 单元/集成测试：pipeline 端到端（fixture agent → trace → evaluator → metric）

## Stage 8 — Failure + Regression

- [ ] Failure Taxonomy（13 个标准分类 + 自定义扩展）
- [ ] Deterministic FailureClassifier（基于证据）
- [ ] RegressionDetector（Fail→Pass / Pass→Fail / 延迟回归 / 成本回归）
- [ ] Baseline 机制（标记某次 Run 为 baseline）
- [ ] Case-level Diff（Fixed / Regressed / BothFail / BothPass）
- [ ] Failure Clustering（按 category / tag / tool）
- [ ] 单元测试：regression fixture（V1 10/10 Pass，V2 9/10 → 必须检出 1 regression）

## Stage 9 — LLM Judge + Human Review

- [ ] JudgeRubric 模型（维度 / weight / scoreRange）
- [ ] LLMJudgeEvaluator（Structured Output + Zod 校验 + 解析失败重试/降级）
- [ ] 严格声明：LLM Judge 只是 Evaluator 之一，不是唯一真相
- [ ] HumanReview（Pass / Fail / Partial / Override / Comment / FailureCategory）
- [ ] 机器结果与人工结果并存可对比（人工不覆盖机器）
- [ ] 单元测试：Mock Judge、人工覆盖不丢失机器结果

## Stage 10 — Version Comparison

- [ ] Agent Version A/B 对比（相同 Dataset）
- [ ] Metric Diff / Fixed / Regressed / Changed Failures / Cost Diff / Latency Diff
- [ ] Prompt Version Diff（文本 diff）
- [ ] Prompt Regression 展示（Prompt Diff + Performance Diff）
- [ ] Experiment（离线对比，不是在线 A/B）

## Stage 11 — Release Gate

- [ ] Gate 规则模型（阈值 + 目标 metric + scope）
- [ ] Critical Case 规则（critical 必须全通过）
- [ ] 结果：PASS / FAIL / BLOCKED / UNKNOWN + 逐条解释
- [ ] ReleaseDecision 持久化
- [ ] 单元测试：Pass Rate 90% vs Gate 95% → 必须 FAIL

## Stage 12 — Dashboard + Explorer

- [ ] Dashboard（Agents / Runs / Pass Rate / Regression / Gate Failure / Cost / Latency / Top Failures）
- [ ] Agents 页面 + Agent Detail（Overview / Versions / Runs / Prompts / Tools / Comparisons）
- [ ] Dataset 页面（Case 表 + 编辑）
- [ ] Run 页面（Metrics / Cases / Failures / Trace Summary / Gate）
- [ ] Run Explorer（筛选 Passed / Failed / Category / Tag / Priority）
- [ ] Case Run Detail（Input / Expected / Output / Evaluations / Trace / Tools / Retrieval / Review）
- [ ] Trace Viewer（时间序 + 展开 + 过滤 Tool/Retrieval/Error）
- [ ] Compare 页面
- [ ] Failure Center
- [ ] Release Center
- [ ] Human Review Queue
- [ ] Search（SQLite FTS）
- [ ] UI 风格：Linear / GitHub Actions 式高信息密度，禁止紫色渐变与营销 Hero

## Stage 13 — Optimization Suggestions

- [ ] OptimizationSuggestion（prompt / tool / rag / runtime / dataset / guardrail）
- [ ] 必须附 Evidence（如「12/18 失败 Case 在 getOrder 缺少 orderId」）
- [ ] Prompt Candidate（P1，绝不自动覆盖生产 Prompt）

## Stage 14 — Integration + E2E

- [ ] Integration：fixture agent → runtime → trace → evaluator → metric
- [ ] Evaluation Integrity Tests（错 Tool Agent 必须被判 FAIL、Loop Agent 必须检出）
- [ ] E2E 主流程（Dashboard → Dataset → Run → Failure → Trace → Compare → Regression → Gate）
- [ ] Fixture：Release Gate 95% 阈值 vs 90% 实际 → FAIL

## Stage 15 — Security + Performance

- [ ] 禁止记录 API Key / Secret / Credential
- [ ] Trace 保存前 redaction
- [ ] 日志结构化且无 Secret
- [ ] 分页 / 避免一次性加载全部 Trace / 并发上限
- [ ] 错误处理（Provider 故障 / 超时 / 工具异常 / DB 异常 / 取消）

## Stage 16 — Recovery Audit + Documentation

- [ ] README（What / Why / Features / Architecture / Pipeline / Quick Start / Testing / Security / Limitations / Roadmap）
- [ ] Recovery Drill（只读 `docs/agent/` 能否判断现状）
- [ ] Fresh Agent Handoff Drill
- [ ] Final Acceptance 自查
- [ ] 交付报告
