# NEXT_ACTION.md

> 新 Agent 读完本文件就应立刻知道该干什么。每次 checkpoint 必须重写本文件。

**Last Completed:** Stage 0 部分完成 —— monorepo 骨架、`docs/agent/*` 记忆体系、依赖安装启动

**Current Task:** 完成 Stage 0 收尾，随后进入 Stage 1（Domain Models + Persistence）

**Why:** 先把「可运行 + 可续跑」的地基打好，再写任何业务代码。所有后续 Stage 都依赖 Stage 1 的 domain schema 与 SQLite 持久层。

**Relevant Files:**
- `package.json`（根，workspaces）
- `docs/agent/*`（记忆体系）
- `packages/shared/src/**`（即将创建）
- `packages/persistence/src/**`（即将创建）

**Commands To Run:**
```bash
npm install --prefer-offline --no-audit --no-fund --ignore-scripts
npm run typecheck
npm test
```

**Expected Result:** 依赖装完；typecheck 0 error；unit 测试全绿。

**Known Risks:**
- 本机 npm 慢，必须加 `--prefer-offline`。
- 禁止 `playwright install`（用户红线，会删旧浏览器）。
- `better-sqlite3` 原生编译不可用 → 用 `node:sqlite`。

**Do Not Break:**
- `docs/agent/` 十个记忆文件必须持续维护。
- 「版本类数据只插入不更新」的不可覆盖约束。
- Deterministic-first：确定性 evaluator 优先，LLM Judge 仅作补充。

**Next Task After Completion:** Stage 2 — Provider 抽象 + MockModelProvider + AgentRuntime + Fixture Tools。
