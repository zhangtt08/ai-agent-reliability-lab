# AI Agent Reliability Lab — 最终交付报告

> 生成时间：2026-09-24 · 对应规格 §110 · 证据均可在仓库内复跑

## Status

**COMPLETE（P0 全量 + P1 核心项）**

P0 的 16 个 Stage 全部交付并验证；P1 中 LLM Judge / Human Review / RAG 评测（Recall@K、命中、Groundedness）/ 优化建议 / Prompt 候选 / 分类-标签-工具三维聚类已交付；P1 中"语义（向量）失败聚类"与"HTML 报告导出"未实现，已如实列入 Known Limitations，未包装成已完成项。

## Implemented（真实模块，全部有测试或可运行入口）

| 模块 | 内容 |
| --- | --- |
| 领域层 `packages/shared` | 30+ Zod 模型、失败分类法、JSON-Schema 子集校验、TraceRedactor、数据集 IO |
| 持久层 `packages/persistence` | node:sqlite 驱动、迁移（checksum）、29 表、不可覆盖触发器、repositories、FTS5 |
| Provider `packages/providers` | 接口 + Mock（一等公民）+ 10 种 fixture 行为 + Judge 替身 + OpenAI-compatible + 注册表 |
| Runtime `packages/runtime` | ToolCalling/SimplePrompt、BM25+伪向量 RAG、7 fixture 工具、Trace 采集、loop guard/超时/重试 |
| 评测 `packages/evaluation` | 19 evaluator、RuleJudge、18 指标、失败归因、回归、Gate、LLM Judge、建议 |
| 编排 `apps/server` | Run Pipeline（并发池/隔离/可复现快照/任务队列）、Express API 全量端点、种子数据 |
| 前端 `apps/web` | Dashboard / Agents / Datasets / Runs / Trace Viewer / Compare / Failures / Reviews / Release / Search |
| 工具链 | vitest（unit+integration）、playwright-core E2E、seed/reset/dev 脚本、5 个 git checkpoint |

## Evaluation Capabilities

19 个内置确定性 Evaluator（全部有单测正反例，见 `EVAL_STATUS.md` 覆盖矩阵）：
exact_match / contains / not_contains / json_parse / json_schema / tool.called / tool.not_called / tool.arguments / tool.call_count / tool.order / tool.execution / process.loop / rag.hit / rag.recall_at_k / rag.groundedness / custom.rules / performance.latency / performance.cost / process.classification + `llm.judge`（Zod 强校验，解析失败显式 error 不默认通过）。

## Demo

无需 API Key：`npm run dev` → http://localhost:5173。种子含 10 个缺陷各异的 fixture agent、3 个 golden 数据集、5 个评测集、2 个门禁。

## Validation

| 项 | 命令 | 结果 |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 error |
| Build | `npm run build` | tsc 通过 + vite 228KB |
| Unit | `npm test`（unit 部分） | 174/174 |
| Integration | `npm run test:integration` | 17/17 |
| E2E | `npm run test:e2e` | 12/12 步（截图 e2e/screenshots/） |
| Dogfood | `npm run dogfood -- --detail` | 见下 |

## Fixture Result（不伪造，全部实测）

- Stable Agent：**15/15 PASS**（3 数据集 × 5 用例），Core Gate PASS
- Wrong Tool Agent：13× `tool_selection_failure`（工具选择错误被检出）
- Wrong Args Agent：9× `tool_argument_failure`（空订单号 → invalid_arguments，trace 留证据）
- Bad Format Agent：14× `format_failure`
- RAG Failure Agent：Knowledge QA 上 `retrieval_failure`（期望文档未召回）
- Loop Agent：15× `loop`（loop guard 第 3 次相同调用终止，run 不挂死）
- Hallucination Agent：`hallucination`（"100 元补偿/2 小时退款"无出处被 Groundedness 检出）
- Flaky Provider：**15/15 PASS** —— 限流被重试策略吸收（trace 有 provider_retry 步骤），未误判为 Agent 失败
- Regression V2：4/5，**精确检出 1 条用例回归** + 通过率指标回归
- Strict Gate（95% + 零回归）对 V2：**FAIL**（解释含实际 0.8 与回归数 2）
- Human Review：机器 FAIL + 人工 PASS 并存，machineVerdict 永不被覆盖（数据库触发器）

## Architecture

分层：`web → server → evaluation/runtime/providers → persistence → shared`，单向依赖；evaluation 为纯函数层（不碰库）可直接单测。四个插件接口：ModelProvider / AgentRuntime / Evaluator / ToolExecutor。Drizzle schema 作为 DDL 契约由持久层契约测试逐列强制（防止 schema 与迁移漂移）。

## Security

- 落库前脱敏（TraceRedactor）：OpenAI/Anthropic/Google key、Bearer、JWT、AWS、PEM、连接串、password/api_key 赋值；工具输出按 sensitiveFields 结构化脱敏并记录被脱敏路径
- Prompt 隐私三档：store_full / store_redacted / store_metadata_only
- 历史不可覆盖：版本、冻结数据集、run 身份、trace/结果证据、复核、门禁决策 —— 触发器强制
- 日志无 Secret；API 错误结构化返回不白屏；未配置的 provider 如实显示不可用

## Known Limitations（真实写）

1. `node:sqlite`（Node 22）experimental —— 已收敛到单一驱动文件，替换成本低
2. Mock token 用量为估算（CJK 1/字，其余 4 字符/token）；无价目表时成本恒 unknown，不伪造费用
3. 检索为本地 BM25 + trigram 伪向量，非真实 embedding；指标口径真实，语义召回有限
4. 语义（向量）失败聚类未实现；现有聚类为 category / tag / tool 三维统计
5. HTML/Markdown 评测报告导出未实现（Run JSON 导出已实现）
6. 真实外部 Agent Adapter（HTTP/CLI）、在线 production trace、团队权限、分布式 runner：P2 未实现（接口已预留）
7. E2E 复用本机 Chromium；缺失时 exit 2 明确报错（不自动下载，见用户红线）
8. LLM Judge 默认为确定性"替身"（rubric 规则打分）用于验证链路与降级路径；接入真实 provider 后同一段 prompt 走真实模型
9. 本机 vitest 必须串行执行测试文件（`fileParallelism: false`），否则出现 EPERM 并静默丢测试文件

## Next Production Steps（仅 P2）

真实 provider 一等接入（Anthropic/Gemini/本地模型）· 外部 Agent Adapter（HTTP/CLI）· 在线 production trace 回放 · 语义失败聚类 · HTML 报告 · 团队权限/SSO · 分布式 runner。
