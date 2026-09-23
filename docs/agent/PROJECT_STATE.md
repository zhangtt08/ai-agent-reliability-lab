# PROJECT_STATE.md — AI Agent Reliability Lab

> 任何新 Agent 接手时，**先读本文件**，再读 `NEXT_ACTION.md`。

| 字段 | 值 |
| --- | --- |
| Project Name | AI Agent Reliability Lab（AI 智能体评测与可靠性平台） |
| Repository Root | `C:\Users\Administrator\Desktop\AI-Agent-Reliability-Lab` |
| Current Version | 0.1.0 |
| Current Stage | Stage 3 — Dataset + Test Case（进行中） |
| Current Objective | 建立三个真实感 Mock Dataset + ExpectedOutcome 结构化期望 + JSON/CSV 导入导出 |
| Overall Status | IN_PROGRESS |
| Last Updated | 2026-09-23 (session 1) |

## Completed Modules

- Stage 0：持久化项目记忆（`docs/agent/*`）、monorepo、依赖、git checkpoint
- Stage 1：`@arl/shared`（Zod 领域模型 / 失败分类法 / JSON-Schema 子集校验 / TraceRedactor）、
  `@arl/persistence`（node:sqlite 驱动、迁移 + 不可覆盖触发器、typed repositories、FTS5 搜索）
- Stage 2：`@arl/providers`（ModelProvider 抽象 / MockModelProvider / 确定性 fixture 策略 / Judge 替身 / OpenAI-compatible 真实实现）、
  `@arl/runtime`（ToolCallingAgent / SimplePromptAgent / RAG 检索 / Tool 执行器 / Trace 采集器 / loop guard / retry / 硬超时）

## Current Module

- Stage 3：Dataset / TestCase / ExpectedOutcome / 导入导出 / Golden Dataset

## Pending Modules

- Stage 4 → Stage 16（见 `MASTER_PLAN.md`）

## Current Blockers

- 无

## Verification Status

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Latest Build Status | NOT_RUN | 前端尚未建立；`tsc --noEmit` 通过 |
| Latest Unit Test Status | PASS | 122/122（5 个测试文件） |
| Latest Integration Status | NOT_RUN | 集成测试待 Stage 7 建立 |
| Latest E2E Status | NOT_RUN | Playwright（复用本机 Chromium）待 Stage 14 |
| Latest Evaluation Status | PARTIAL | Runtime 冒烟已验证：loop 检测 / invalid_arguments / 幻觉注入 / 限流重试链路；正式 EVAL_STATUS 见文件 |

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

- `ba507cd`（Stage 0+1）

## Next Action

见 `NEXT_ACTION.md`
