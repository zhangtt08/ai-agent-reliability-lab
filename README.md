# AI Agent Reliability Lab

中文名：**AI 智能体评测与可靠性平台**。一个 local-first 的工程平台，用于**测试、评估、比较、诊断和发布管控 AI Agent**。

> 一个 Agent 能跑，不代表它可靠。这个平台回答的问题是：成功率多少？失败在哪？新版本是否比旧版本好？改了 Prompt 有没有回归？工具调对了吗？检索错还是生成错？这个版本允许发布吗？

## What is Agent Reliability Lab

不是 Prompt Playground，不是单次聊天打分工具，而是一套完整评测闭环：

```
创建 Agent → 创建 Agent Version → 配置 Prompt/Model/Tools/RAG
→ 创建 Dataset（版本化）→ 定义结构化 ExpectedOutcome
→ 批量 Run（并发可控、单 case 隔离）→ 捕获完整 Trace
→ 确定性 Evaluator → RuleJudge → LLM Judge（可选）
→ 失败归因 → 指标聚合 → 版本对比 → 回归检测 → Release Gate → 优化建议 → 新版本 → 重跑
```

## Why Evaluation Matters

平台的原则是 **Deterministic-first**：

- 能用规则判定的**绝不交给 LLM 猜**：是否调用了某工具、调用次数、参数是否正确、是否合法 JSON、Schema 是否满足、关键词是否存在、是否循环——全部用确定性 Evaluator。
- LLM Judge 只是其中一个 Evaluator，输出必须通过 Zod 结构化校验，解析失败显式报错，绝不默认通过。
- 所有评测结果都带 `EvidenceReference`，点击失败结果能看到"为什么失败"（trace step / tool call / 检索文档 / 输出区间）。
- 所有指标都带 `definition`（计算方式说明），没有"神秘 AI 分"。

## Core Features

| 能力 | 说明 |
| --- | --- |
| Agent / Version | 版本不可覆盖（数据库触发器强制），Prompt 版本化 + hash，支持 diff |
| Dataset | 版本化 + Golden Dataset + 冻结保护；JSON/CSV 导入导出（逐行容错） |
| ExpectedOutcome | expectedText / mustContain / mustNotContain / expectedSchema / expectedTools / forbiddenTools / expectedToolArgs / maxToolCalls / expectedCallOrder / requiredEvidence / expectedClassification / customRules |
| Agent Runtime | ToolCallingAgent（RAG → model ↔ tool 循环）与 SimplePromptAgent；loop guard / 步数 / 工具数 / 时间预算四重保护 |
| Trace | model_call / tool_call / retrieval / decision / output / error 六类 step，按 seq 时间序；落库前强制脱敏 |
| Evaluator | 19 个内置确定性 Evaluator + RuleJudge（ALL/ANY/Weighted）+ LLM Judge |
| Metrics | 18 个版本化指标，每个都写明计算方式（通过率 / critical 通过率 / 工具正确率 / 格式合规 / groundedness / 幻觉率 / 循环率 / Recall@K / P50 / P95 / 成本…） |
| Failure | 14 类失败分类法；确定性归因器按证据强度递减判定，附置信度与证据 |
| Regression | 用例级（Pass→Fail）、指标级（通过率下降）、延迟（P95）、成本回归；baseline 机制 |
| Release Gate | 阈值规则 + critical 全通过 + 零回归；结论 PASS / FAIL / BLOCKED / UNKNOWN，逐条解释为什么 |
| Suggestions | 规则化优化建议，必须附可核对证据（如「1/2 个失败 case 调用 getOrder 时缺 orderId」）；Prompt 候选不自动覆盖生产 Prompt |
| Human Review | 人工 Pass/Fail/Partial/备注/分类；与机器结论并存可对比，绝不覆盖机器结果 |

## Architecture

```
apps/web          React + Vite + Tailwind + Zustand（Dashboard / Agents / Datasets / Runs / Trace Viewer
                  / Compare / Failure Center / Review Queue / Release Center / Search）
apps/server       Express API + Run Pipeline + 任务队列 + 种子数据
packages/evaluation   Evaluators / RuleJudge / Metrics / FailureClassifier / Regression / Gate / LLM Judge / Suggestions
packages/runtime      AgentRuntime / 工具执行器 / RAG 检索（BM25 + trigram 伪向量）/ Trace 采集器
packages/providers    ModelProvider 抽象 + MockModelProvider（一等公民）+ OpenAI-compatible + 注册表
packages/persistence  node:sqlite 驱动 + 迁移 + 不可覆盖触发器 + typed repositories + FTS5 搜索
packages/shared       Zod 领域模型 / 失败分类法 / JSON-Schema 子集校验 / TraceRedactor / 数据集 IO
```

四个可插拔接口：`ModelProvider` / `AgentRuntime` / `Evaluator` / `ToolExecutor`。新增实现无需改核心系统。

## Evaluation Pipeline（一次 Run 发生什么）

1. 记录可复现性快照（Agent 版本、Prompt hash、数据集版本 + 内容指纹、evaluator 版本、模型配置、seed、时间）。
2. 逐 case 执行（有限并发池，单 case 独立 error boundary）：Runtime 产出 `AgentRunResult`（finalOutput / trace / usage / latency）。
3. Trace 证据单事务落库（落库前已脱敏）。
4. 逐 Evaluator 判定 → RuleJudge 合成裁决（skipped 不参与判定；blocking 失败直接 fail）。
5. 非 passed 的 case 进入确定性失败归因。
6. 聚合指标 → 与 baseline 对比检出回归 → 评估 Release Gate → 生成带证据的优化建议。

## Agent Runtime

- Runtime 与 Provider 完全解耦（`RuntimeInput` 中**没有** expectedOutcome —— Runtime 永远看不到期望答案）。
- 工具参数先过 JSON Schema 校验，不合法不执行（`invalid_arguments`）。
- RAG：自动检索（查询改写 + BM25/伪向量打分）与 `searchKnowledge` 工具两条路径都记录结构化 RetrievalEvent（query / rewrittenQuery / documents / scores / rank / selectedChunks）。
- 重试策略只针对基础设施故障（限流 / provider 错误），Agent 答错不会触发重试。

## Dataset Model

- Dataset → DatasetVersion → TestCase（属于版本）。
- published/golden 版本中的用例由**数据库触发器**拒绝增删改；要改必须 fork 新版本。
- 冻结时写入内容指纹（SHA-256 前 16 位），Run 记录当时使用的数据集版本与指纹 → 可复现。

## Evaluator System

19 个内置确定性 Evaluator（每个都有单测正反例）：exact_match / contains / not_contains / json_parse / json_schema / tool.called / tool.not_called / tool.arguments / tool.call_count / tool.order / tool.execution / process.loop / rag.hit / rag.recall_at_k / rag.groundedness / custom.rules / performance.latency / performance.cost / process.classification，外加 `llm.judge`。

- 不适用的检查项返回 `skipped`（不计入通过判定，但会被统计并展示，防止"少跑检查 = 高通过率"）。
- case 未产出结果（超时/错误）时，输出类 Evaluator 判 `fail` 而不是 skipped。
- 成本未知（无价目表）时成本检查判 `skipped` 并说明，不伪造通过。

## Trace

每步记录 seq / type / name / status / duration / summary / payload，并与 model_call / tool_call / retrieval 三张专表关联（支持 SQL 级聚合，如"最容易出错的工具"）。隐私策略三档：`store_full` / `store_redacted` / `store_metadata_only`；凭据（sk-/Bearer/JWT/AWS/私钥/连接串）一律正则脱敏，工具输出按 sensitiveFields 结构化脱敏。

## Regression & Release Gate

- Regression = 之前通过、现在失败；另支持通过率下降（>2%）、P95 延迟（×1.5 且 +500ms）、成本（×1.5）回归。回归按用例优先级定级（critical 用例 → critical 回归）。
- Gate 规则：metric + 操作符 + 作用域（overall / critical / tag / category）+ 是否阻断。指标缺失 → `BLOCKED`（不是悄悄通过）。每条规则附实际值 / 阈值 / 样本量 / 涉及用例名。

## Demo Mode

**无需任何 API Key。** 种子数据包含：

- 10 个 fixture agent（真实跑在 tool-calling 循环里，仅"大脑"由 Mock Provider 扮演）：
  stable（基线） / regression-v2（精确回归）/ wrong-tool / wrong-args / bad-format / rag-failure / loop / hallucination / flaky-provider（限流重试）/ slow（延迟）。
- 3 个 golden 数据集（Customer Support / Knowledge QA / Tool Calling，共 15 条用例，含正常 / 边界 / 策略红线 / Critical）。
- 5 个评测集（Fast / Basic QA / Tool Agent / RAG Quality / Full）与 2 个门禁（Core 90% / Strict 95%）。

Dogfood 实测（`npm run dogfood`）：stable 15/15 全绿；7 类缺陷 agent 全部被对应 Evaluator 检出；限流被重试策略吸收；回归 V2 被精确检出 1 条用例回归；Strict Gate 判 FAIL。详见 `docs/agent/EVAL_STATUS.md`。

## Quick Start

```bash
npm install --prefer-offline --no-audit --no-fund --ignore-scripts
npm run dev          # API http://localhost:8787 + Web http://localhost:5173
```

首次启动自动建库、迁移并注入种子数据。

```bash
npm run seed         # 手动注入种子（--force 重建演示库）
npm run dogfood      # 用 fixture agents 验证平台真的能发现问题（--detail 看逐用例）
npm run build        # typecheck + 前端构建
npm test             # 全部单测
npm run test:unit    # 仅单元测试
npm run test:integration  # 集成测试（真实 runtime + 流水线 + API）
npm run test:e2e     # 浏览器级 E2E（自动构建前端；复用本机 Chromium，不下载）
```

## Provider Setup

默认使用 Mock Provider（确定性、离线、可脚本化）。要接真实模型：

```bash
# OpenAI-compatible（OpenAI / DeepSeek / 本地 Ollama / LM Studio 等）
ARL_OPENAI_BASE_URL=https://api.openai.com/v1
ARL_OPENAI_API_KEY=sk-xxx
```

配置了 Key 的 provider 会标记为 available；**未配置的 provider 在 UI 中如实显示"不可用"，平台不会用 mock 冒充真实调用**。真实调用会产生真实费用；价目表未配置时成本恒为 `unknown`，绝不编造。

## Security

- Trace 落库前必经 `TraceRedactor`：常见凭据形态（OpenAI/Anthropic/Google key、Bearer、JWT、AWS、PEM 私钥、连接串、password/api_key 赋值）正则脱敏 + 结构化字段脱敏（含工具级 sensitiveFields）。
- Prompt 隐私三档策略（run/agent 级可配），metadata_only 只存长度摘要。
- 历史不可覆盖：agent_versions / prompt_versions / dataset 冻结 / run 身份 / trace 证据 / human_reviews / release_decisions 均有数据库触发器强制，任何 UPDATE 尝试直接报错。
- 日志不打印 Secret；API 服务端错误返回结构化 JSON，不白屏。

## Testing

- 单元测试 174 项：schema 校验 / 脱敏 / 持久层契约（Drizzle 定义 ↔ 迁移 DDL 逐列比对；领域字段 ↔ 真实列）/ 不可覆盖触发器 / 19 个 Evaluator 正反例 / RuleJudge / 指标精确断言 / 失败归因 / 回归 / 建议 / 数据集 IO。
- 集成测试 17 项：真实 runtime + 流水线跑全部 fixture（integrity）、回归与门禁 fixture、人工复核、HTTP 层主流程。
- E2E 12 步：浏览器走完 Dashboard → Agent → Dataset → 启动评测 → Run 详情 → 失败 Trace → 版本对比 → Release → Review → 搜索（截图落 `e2e/screenshots/`）。

## Known Limitations

1. `node:sqlite`（Node 22）标记 experimental；已收敛到单一适配文件，替换成本低。
2. Mock Provider 的 token 用量为估算（CJK 1 token/字、其余 4 字符/token），成本在无价目表时恒为 unknown —— 不会伪造真实费用。
3. RAG 检索为 BM25 + trigram 伪向量的本地实现，非真实 embedding；指标口径真实可复现，但语义召回能力有限。
4. 语义级失败聚类（向量相似度）未实现；MVP 提供 category / tag / tool 三维聚类统计。
5. 真实外部 Agent Adapter（HTTP/CLI 接入第三方 agent）、在线 production trace、团队权限、分布式 runner 属 P2，未实现（接口已预留）。
6. E2E 依赖本机已有 Chromium（复用 `ms-playwright/chromium-*`）；缺失时明确报错退出，不会自动下载。
7. LLM Judge 默认是确定性"替身"（按 rubric 规则打分），用于验证链路与降级；接入真实 provider 后自动走真实模型。

## Roadmap（P2，非未完成的 P0）

- Anthropic / Gemini / 本地模型 provider 一等接入
- 真实外部 Agent Adapter（HTTP Agent / CLI Agent）
- 在线 production trace 回放评测
- 团队协作（权限、SSO）、分布式 runner、HTML/Markdown 评测报告导出
- 语义失败聚类（embedding）与 Prompt Candidate 自动生成（当前为规则生成 + 显式采纳）

---

*本项目由 AI 从 0 到 1 构建，开发过程与决策记录见 `docs/agent/`（PROJECT_STATE / MASTER_PLAN / DECISIONS / EVAL_STATUS / RECOVERY ...）。*
