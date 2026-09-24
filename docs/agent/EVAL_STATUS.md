# EVAL_STATUS.md — 平台对自身 Fixture Agents 的评测验收状态（Dogfooding）

> 这是「平台能不能真的发现 Agent 错误」的证据表，不是装饰。
> 数据来源：`scripts/dogfood.ts`（2026-09-24 实测）+ `tests/integration/*`。
> 复现命令：`npx tsx scripts/dogfood.ts`（加 `--detail` 看逐用例明细）。

## Dogfood 结果矩阵（Full 评测集，3 个数据集 × 10 个 fixture agent）

| Fixture | 预期 | 实测 | 状态 |
| --- | --- | --- | --- |
| Stable Agent (A) | 全通过 | **15/15 PASS**，门禁 PASS（0 阻断） | ✅ |
| Regression V2 (H) | 只在「为什么重复扣款」意图上退步 | **4/5**，检出 **1 条用例回归**（重复扣款咨询：passed → failed）+ **1 条指标回归**（通过率 100%→80%；5 case 样本下 1 例 = 20 个百分点） | ✅ |
| Wrong Tool Agent (B) | ToolCalledEvaluator 检出失败 | 1/15，13× `tool_selection_failure`（如「实际调用 getBalance」） | ✅ |
| Wrong Args Agent (C) | ToolArgumentEvaluator 检出失败 | 0/15，9× `tool_argument_failure`（空订单号 → `invalid_arguments`） | ✅ |
| Bad Format Agent (D) | Schema/Format evaluator 检出失败 | 0/15，14× `format_failure`（输出非 JSON） | ✅ |
| RAG Failure Agent (E) | RetrievalHitEvaluator 检出失败 | Knowledge QA 上 `retrieval_failure`（期望文档未被召回） | ✅ |
| Loop Agent (F) | LoopDetector 检出 loop | 0/15，15× `loop`（loop guard 在第 3 次相同调用时终止） | ✅ |
| Hallucination Agent (G) | Groundedness evaluator 检出 | 多例 `hallucination`（"100 元补偿 / 2 小时内退款" 无出处） | ✅ |
| Flaky Provider (J) | 限流被重试策略吸收，**不判 Agent 失败** | **15/15 PASS**（trace 中可见 provider_retry 决策步骤） | ✅ |
| Slow Agent (I) | 延迟可量化 | 15/15 PASS，但 p95 延迟显著高于 stable（供延迟回归演示） | ✅ |

## Release Gate fixture

| 场景 | 预期 | 实测 | 状态 |
| --- | --- | --- | --- |
| Stable @ 3 数据集，Core Gate（≥90% + critical 全过 + 幻觉 ≤2%） | PASS | **PASS** | ✅ |
| Regression V2 vs baseline（1 例回归） | 检出回归 | **检出 2 条**（1 用例 + 1 指标） | ✅ |
| Strict Gate（≥95% + 零回归）对 V2 | **FAIL** | **FAIL**：「任务通过率 ≥ 95%（实际 0.8）；不允许相对 baseline 出现回归（实际 2）」 | ✅ |
| 门禁解释可读性 | 必须解释为什么 | 每条规则附「实际值 / 阈值 / 样本量 / 涉及用例名」 | ✅ |

## Human Review fixture

| 场景 | 预期 | 实测 | 状态 |
| --- | --- | --- | --- |
| 机器 FAIL + 人工 PASS 并存 | 两者都保留，人工不覆盖机器 | `human_reviews` 只增触发器 + agreement 统计（集成测试验证） | ✅ |

## Evaluator 覆盖清单（19 个内置）

| Evaluator | 实现 | 单测 | Dogfood 验证 |
| --- | --- | --- | --- |
| output.exact_match | ✅ | ✅ | 无 expectedText 用例自动 skipped |
| output.contains | ✅ | ✅ | ✅（pass/partial/fail 三态） |
| output.not_contains | ✅ | ✅ | ✅（禁止内容 → 阻断失败） |
| format.json_parse | ✅ | ✅ | ✅ |
| format.json_schema | ✅ | ✅ | ✅（定位到 `$.answer` 缺失） |
| tool.called | ✅ | ✅ | ✅（漏调/调用失败两种形态） |
| tool.not_called | ✅ | ✅ | ✅（退款护栏） |
| tool.arguments | ✅ | ✅ | ✅（equals/contains/exists/matches/oneOf） |
| tool.call_count | ✅ | ✅ | ✅（maxToolCalls=0 的追问用例） |
| tool.order | ✅ | ✅ | 数据集未使用（接口已验证） |
| tool.execution | ✅ | ✅ | ✅（invalid_arguments 计入异常） |
| process.loop | ✅ | ✅ | ✅（15 例循环全部检出） |
| rag.hit | ✅ | ✅ | ✅（expectedDocIds） |
| rag.recall_at_k | ✅ | ✅ | ✅（Recall@3 / Hit@3） |
| rag.groundedness | ✅ | ✅ | ✅（幻觉检出） |
| custom.rules | ✅ | ✅ | ✅（not_contains 边界用例） |
| performance.latency | ✅ | ✅ | ✅ |
| performance.cost | ✅ | ✅ | ✅（成本未知 → skipped 不假通过） |
| process.classification | ✅ | ✅ | 数据集未使用 |
| llm.judge（mock judge） | ✅ | 集成 | ✅（结构化输出 + rubric 加权） |

## 指标引擎

18 个指标全部带 `definition`（计算方式）与 `version`；在 `tests/unit/evaluation.test.ts` 中按定义精确断言
（如 `task_success_rate=0.25`、`p50=2000ms`、`cost_known_ratio=0`）。
