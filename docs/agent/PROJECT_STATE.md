# PROJECT_STATE.md — AI Agent Reliability Lab

> 任何新 Agent 接手时，**先读本文件**，再读 `NEXT_ACTION.md`。

| 字段 | 值 |
| --- | --- |
| Project Name | AI Agent Reliability Lab（AI 智能体评测与可靠性平台） |
| Repository Root | `C:\Users\Administrator\Desktop\AI-Agent-Reliability-Lab` |
| Current Version | 0.1.0 |
| Current Stage | Stage 0 — Bootstrap + Persistent Agent Memory |
| Current Objective | 建立持久化项目记忆 + Monorepo 骨架 + 可运行安装 |
| Overall Status | IN_PROGRESS |
| Last Updated | 2026-09-23 (session 1) |

## Completed Modules

- 无（项目刚初始化）

## Current Module

- Stage 0：`docs/agent/*` 记忆体系、monorepo 结构、依赖安装

## Pending Modules

- Stage 1 → Stage 16（见 `MASTER_PLAN.md`）

## Current Blockers

- 无

## Verification Status

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Latest Build Status | NOT_RUN | 依赖安装中 |
| Latest Unit Test Status | NOT_RUN | — |
| Latest Integration Status | NOT_RUN | — |
| Latest E2E Status | NOT_RUN | — |
| Latest Evaluation Status | NOT_RUN | 见 `EVAL_STATUS.md` |

## Current Git State

- 尚未初始化（Stage 0 结束后执行 `git init` + 首个 checkpoint commit）

## Known Critical Risks

1. 本机 `npm` 到 registry 较慢 → 一律使用 `--prefer-offline --ignore-scripts` 安装。
2. `better-sqlite3` 需原生编译 → 已改用 Node 内置 `node:sqlite`（实测可用，见 `DECISIONS.md` D-001）。
3. Playwright 浏览器**禁止**重新下载（用户红线，会静默删除旧浏览器）→ E2E 复用 `%LOCALAPPDATA%\ms-playwright\chromium-1243`。
4. 评测必须确定性优先，禁止把一切交给 LLM Judge。

## Last Successful Checkpoint

- 无（即将创建 `chore: bootstrap project memory`）

## Next Action

见 `NEXT_ACTION.md`
