# CHANGELOG_DEV.md — 开发变更日志

（开发期日志，非产品 CHANGELOG）

## 2026-09-23 — Session 1

### Stage 0 — Bootstrap
- 初始化 monorepo（npm workspaces：`packages/*` + `apps/*`）。
- 建立 `docs/agent/` 持久化项目记忆（PROJECT_STATE / MASTER_PLAN / NEXT_ACTION / DECISIONS / TEST_STATUS / EVAL_STATUS / KNOWN_ISSUES / CHANGELOG_DEV / ARCHITECTURE / RECOVERY）。
- 环境探测：Node v22.22.2；`node:sqlite` 可用；本机已有 Chromium `chromium-1243`（E2E 复用，不下载）。
- 架构决策 D-001 ~ D-006 落档。
