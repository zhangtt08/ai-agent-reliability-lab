# EVAL_STATUS.md — 平台对自身 Fixture Agents 的评测验收状态（Dogfooding）

> 这是「平台能不能真的发现 Agent 错误」的证据表，不是装饰。
> 数据来源：`npm run test:integration` 中的 evaluation-integrity 用例 + `scripts/dogfood.ts` 输出。

| Fixture | 预期 | 实际 | 状态 |
| --- | --- | --- | --- |
| Stable Agent (A) | 全通过 | - | NOT_RUN |
| Wrong Tool Agent (B) | ToolCalledEvaluator 检出失败 | - | NOT_RUN |
| Wrong Args Agent (C) | ToolArgumentEvaluator 检出失败 | - | NOT_RUN |
| Bad Format Agent (D) | Schema/Format evaluator 检出失败 | - | NOT_RUN |
| RAG Failure Agent (E) | RetrievalHitEvaluator 检出失败 | - | NOT_RUN |
| Loop Agent (F) | LoopDetector 检出 loop | - | NOT_RUN |
| Regression fixture (V1→V2) | 检出 1 条 regression | - | NOT_RUN |
| Release Gate fixture (阈值 95% vs 实际 90%) | Gate = FAIL | - | NOT_RUN |
| Hallucination fixture | Groundedness evaluator 检出 | - | NOT_RUN |
| Human Review override | 机器 FAIL + 人工 PASS 并存 | - | NOT_RUN |

## Evaluator 覆盖清单

| Evaluator | 实现 | 单测 | 集成验证 |
| --- | --- | --- | --- |
| ExactMatch | [ ] | [ ] | [ ] |
| Contains | [ ] | [ ] | [ ] |
| Regex | [ ] | [ ] | [ ] |
| JsonSchema | [ ] | [ ] | [ ] |
| ToolCalled | [ ] | [ ] | [ ] |
| ToolNotCalled | [ ] | [ ] | [ ] |
| ToolArgument | [ ] | [ ] | [ ] |
| ToolCallCount | [ ] | [ ] | [ ] |
| ToolOrder | [ ] | [ ] | [ ] |
| LoopDetector | [ ] | [ ] | [ ] |
| Latency | [ ] | [ ] | [ ] |
| Cost | [ ] | [ ] | [ ] |
| RetrievalHit / Recall@K | [ ] | [ ] | [ ] |
| Groundedness (rule) | [ ] | [ ] | [ ] |
| LLMJudge (mock provider) | [ ] | [ ] | [ ] |
| RuleJudge (ALL/ANY/Weighted) | [ ] | [ ] | [ ] |
