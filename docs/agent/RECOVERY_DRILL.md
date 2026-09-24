# Recovery Drill + Fresh Agent Handoff Drill（规格 §102 / §103）

> 执行时间：2026-09-24。目的：证明"当前 Agent 突然失忆"或"换一个全新 Agent"时，
> 仅凭仓库（README + docs/agent）就能恢复并继续，而不是依赖聊天上下文。

## Drill 1：Recovery Drill（模拟失忆）

**约束**：只允许读 `docs/agent/` 与 `git log`，不允许回忆本会话。

| 必须能回答 | 答案来源 | 结论 |
| --- | --- | --- |
| 项目做到哪里 | `PROJECT_STATE.md` → Current Stage = Stage 16 已完成；Completed Modules 列出 Stage 0~16 | ✅ |
| 当前任务 | `NEXT_ACTION.md` → Current Task = 无进行中任务，等待用户逐项验收 | ✅ |
| 立刻该干什么 | `NEXT_ACTION.md` → Commands To Run + Do Not Break | ✅ |
| 最近测试是否通过 | `TEST_STATUS.md` → unit 174/174、integration 17/17、E2E 12 步、build PASS | ✅ |
| 平台能否真的发现 Agent 错误 | `EVAL_STATUS.md` → dogfood 矩阵（stable 15/15；7 类缺陷全被检出） | ✅ |
| 有哪些坑不能踩 | `KNOWN_ISSUES.md` K-001~K-007（含 vitest 并发丢测试文件、node:sqlite 加载方式、禁 playwright install） | ✅ |
| 关键架构决策与理由 | `DECISIONS.md` D-001~D-006（node:sqlite / Drizzle 定位 / 确定性优先 / Mock 隔离 / E2E 复用浏览器 / Trace 结构化） | ✅ |
| 下一步该做什么 | `MASTER_PLAN.md` P2 项 + `README.md` Roadmap | ✅ |

**最低成本验证命令**（RECOVERY.md §1 规定的顺序，本次实际执行结果）：

```
npm run typecheck        → 0 error
npm test                 → 191/191（unit 174 + integration 17）
npm run build            → tsc 通过 + vite 228KB
npm run dev              → API 8787 ✓ / Web 5173 ✓（实测双端口响应）
```

**Drill 结论：通过。** 恢复过程中发现并修复 1 个问题：`scripts/dev.mjs` 含 TS 语法但按纯 JS 执行，
导致 `npm run dev` 直接崩溃 —— 该 bug 恰好是靠"按 RECOVERY.md 顺序逐条最低成本验证"暴露的，
修复后已实测双端口可用。这正是 Drill 的价值：文档不仅要能读，还要能照着跑通。

## Drill 2：Fresh Agent Handoff（只有 Repository + README + docs/agent）

**模拟约束**：一个从未见过本项目的 Agent，只拿到仓库目录。

| 步骤 | 依据 | 结果 |
| --- | --- | --- |
| 理解项目是什么 | `README.md` 开头 What/Why/核心闭环 | ✅ 无需读代码即可复述产品定位 |
| 安装并启动 | README Quick Start：`npm install --prefer-offline --no-audit --no-fund --ignore-scripts` → `npm run dev` | ✅（本机已验证 dev 双端口） |
| 运行测试 | README Testing 节：`npm test` / `test:integration` / `test:e2e` | ✅ 命令与实际 scripts 一致 |
| 跑 Demo 体验 | README Demo Mode 节（无需 API Key）+ Web 页面 | ✅ |
| 知道当前阶段 | `docs/agent/PROJECT_STATE.md` | ✅ |
| 继续开发 | `docs/agent/NEXT_ACTION.md` → Do Not Break → P2 清单 | ✅ |
| 不踩历史坑 | `docs/agent/RECOVERY.md` §4 环境坑速查 + `KNOWN_ISSUES.md` | ✅ |

**环境特殊性核对**（换机器时的差异点，README/RECOVERY 均已标注）：
- Node ≥ 22.5（`node:sqlite`）；
- npm 慢 → 安装参数已在 Quick Start 写明；
- E2E 需要本机 Chromium（缺失时 `npm run test:e2e` 以 exit 2 明确报错，不会静默通过，更不会自动下载）。

**Drill 结论：通过。** 唯一无法仅凭文档完成的步骤是 `npm install`（网络事实），
但安装参数、已知风险与替代方案均已写明，符合"文档能指导、不需要口头交接"的标准。
