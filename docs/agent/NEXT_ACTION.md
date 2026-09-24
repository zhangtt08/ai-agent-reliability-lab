# NEXT_ACTION.md

> 新 Agent 读完本文件就应立刻知道该干什么。每次 checkpoint 必须重写本文件。

**Last Completed:** P0 全部 16 个 Stage 交付完成（见 `PROJECT_STATE.md` 与 `MASTER_PLAN.md` 全部 `[x]`）。

**Current Task:** 无进行中任务 —— 等待用户验收反馈（按用户习惯：逐项反馈、修一个收一个）。

**Why:** Final Acceptance 清单（规格 §104）已逐项达成：build/typecheck/unit/integration/e2e 全绿，dogfood 证明平台能真的发现 Agent 错误（stable 15/15；7 类缺陷全被检出；回归与严格门禁按预期触发）。

**Relevant Files:**
- `README.md`（产品全貌 + Quick Start）
- `docs/agent/EVAL_STATUS.md`（dogfood 实测矩阵与 evaluator 覆盖清单）
- `docs/agent/TEST_STATUS.md`（全部测试结果）
- `e2e/screenshots/*.png`（E2E 截图证据）

**Commands To Run:**
```bash
npm run dev          # 起 API+Web，浏览器打开 http://localhost:5173
npm test             # 174 单测
npm run test:integration   # 17 集成
npm run test:e2e     # 12 步浏览器 E2E（先 build 再跑）
npm run dogfood -- --detail   # 平台自证能发现 Agent 缺陷
```

**Expected Result:** 全绿。任何一项不绿 → 先修再谈新功能。

**Known Risks / 维护注意:**
- 测试必须串行执行文件（`fileParallelism: false`，见 K-005），别改回去。
- 禁止 `playwright install`（用户红线）——E2E 复用本机 Chromium。
- `node:sqlite` 通过 `createRequire` 间接加载（K-006），别改回静态 import。

**Do Not Break:**
- 版本不可覆盖触发器、dataset 冻结、证据表只增（有单测兜底）。
- Runtime 不看 expectedOutcome（`RuntimeCase` 类型已排除）。
- 确定性优先原则（D-003）。

**Next Task After 用户验收:** P2 清单见 README「Roadmap」与 `KNOWN_ISSUES.md` 待实现表（外部 Agent Adapter / 真实 provider 一等接入 / 语义聚类 / 报告导出）。
