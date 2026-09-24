# PROJECT_STATE.md — AI Agent Reliability Lab

> 任何新 Agent 接手时，**先读本文件**，再读 `NEXT_ACTION.md`。

| 字段 | 值 |
| --- | --- |
| Project Name | AI Agent Reliability Lab（AI 智能体评测与可靠性平台） |
| Repository Root | `C:\Users\Administrator\Desktop\AI-Agent-Reliability-Lab` |
| Current Version | 0.1.0 |
| Current Stage | Stage 16 — Recovery Audit + Documentation（已完成，等待验收） |
| Current Objective | P0 全部交付：Final Acceptance 条目已逐项达成（见 README 与 EVAL_STATUS） |
| Overall Status | COMPLETE (P0) |
| Last Updated | 2026-09-23 (session 1) |

## Completed Modules

- Stage 0：持久化项目记忆（`docs/agent/*`）、monorepo、依赖、git checkpoint
- Stage 1：`@arl/shared` + `@arl/persistence`（领域模型 / 迁移 + 不可覆盖触发器 / repositories / FTS5）
- Stage 2：`@arl/providers` + `@arl/runtime`（Mock Provider / fixture 策略 / Judge 替身 / RAG / Trace 采集 / loop guard）
- Stage 3~8：Dataset IO、19 个确定性 Evaluator、RuleJudge、18 个指标、确定性失败归因、回归检测、Release Gate、Run Pipeline
- Stage 9~11：LLM Judge（Zod 强校验）、Human Review（与机器结论并存）、版本对比、Baseline、Gate fixture
- Stage 12：Web 全部页面（Dashboard / Agents / Datasets / Runs / Case+Trace Viewer / Compare / Failures / Reviews / Release / Search）
- Stage 13：规则化优化建议（带证据）+ Prompt 候选（显式采纳）
- Stage 14：集成测试 17 项（integrity / regression+gate / human-review / API 主流程）+ E2E 12 步（真 Chromium）
- Stage 15：脱敏前置、错误处理、并发上限、分页查询
- Stage 16：README + Recovery Drill + Dogfood（stable 15/15；7 类缺陷全被检出）

## Current Module

- 无（P0 交付完成；续作请读 NEXT_ACTION.md 的 P2 清单）

## Pending Modules

- Stage 4 → Stage 16（见 `MASTER_PLAN.md`）

## Current Blockers

- 无

## Verification Status

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Latest Build Status | PASS | tsc 0 error；vite build 228KB |
| Latest Unit Test Status | PASS | 174/174（6 个测试文件） |
| Latest Integration Status | PASS | 17/17（4 个测试文件） |
| Latest E2E Status | PASS | 12/12 步骤（截图落 e2e/screenshots/） |
| Latest Evaluation Status | PASS | Dogfood：stable 15/15；7 类缺陷全被检出；回归+严格门禁按预期触发（见 EVAL_STATUS.md） |

## Current Git State

- `ba507cd` chore: bootstrap（Stage 0 + Stage 1）
- 待提交：Stage 2（providers + runtime）

## Known Critical Risks

1. npm 到 registry 慢 → 一律 `--prefer-offline --ignore-scripts`。
2. `better-sqlite3` 原生编译不可用 → 用 `node:sqlite`（D-001）。
3. **禁止** `playwright install`（用户红线，会删旧浏览器）→ E2E 复用 `chromium-1243`。
4. vitest 文件级并发在本机会触发 fs 缓存 EPERM 并静默丢测试文件 → 已设 `fileParallelism: false`（K-005）。
5. 评测必须确定性优先，LLM Judge 只能作为其中一个 Evaluator。

## Last Successful Checkpoint

- 见 `git log`：bootstrap → runtime → evaluation → final（P0 交付）

## Next Action

见 `NEXT_ACTION.md`
