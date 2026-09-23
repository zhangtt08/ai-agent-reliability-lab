# RECOVERY.md — 断联 / 上下文丢失后的恢复协议

> **给未来的 Agent（可能是别的模型、别的工具、完全失忆的你）**

## 0. 铁律

1. **不要问用户「之前做到哪里了」。**
2. **不要从零重写已有代码。**
3. 先读文档，再动代码。
4. 恢复流程结束前不要开启新的大模块。

## 1. 恢复步骤（严格按顺序）

```bash
# 1) 读项目记忆
cat docs/agent/PROJECT_STATE.md
cat docs/agent/NEXT_ACTION.md
cat docs/agent/MASTER_PLAN.md
cat docs/agent/KNOWN_ISSUES.md
cat docs/agent/TEST_STATUS.md
cat docs/agent/EVAL_STATUS.md

# 2) 看仓库状态
git log --oneline -10
git status --short

# 3) 最低成本验证（从便宜到贵）
npm run typecheck
npm run test:unit
npm run test:integration

# 4) 起服务，确认 Demo 可跑
npm run dev
```

## 2. 判断「当前做到哪」

| 你想知道 | 看哪里 |
| --- | --- |
| 现在处于哪个 Stage | `PROJECT_STATE.md` → Current Stage |
| 哪些模块已完成 | `MASTER_PLAN.md` 的 `[x]` |
| 立刻该做什么 | `NEXT_ACTION.md` |
| 上次测试是否通过 | `TEST_STATUS.md` |
| 平台能否真的发现 Agent 错误 | `EVAL_STATUS.md` |
| 有哪些坑不能踩 | `KNOWN_ISSUES.md` |
| 为什么这样设计 | `DECISIONS.md` |
| 代码怎么分层 | `ARCHITECTURE.md` |

## 3. 从中断处继续

1. 读 `NEXT_ACTION.md` 的 **Current Task**。
2. 执行其 **Commands To Run**，对比 **Expected Result**。
3. 若不一致 → 先修，不推进。
4. 完成后：更新 `MASTER_PLAN` → `PROJECT_STATE` → `NEXT_ACTION` → `TEST_STATUS`/`EVAL_STATUS` → `CHANGELOG_DEV`，然后 `git commit` 一个 checkpoint。
5. 自动进入下一任务（**不要询问用户是否继续**）。

## 4. 环境坑速查（本机特有）

| 现象 | 处理 |
| --- | --- |
| Bash 无 `ls` / `mkdir` | 用 PowerShell 或 `python -c` |
| PowerShell stdout 不回传 | 输出写文件再读 |
| `cmd.exe` 被拦截 | 不要用 cmd，用 bash / node |
| `npm install` 极慢 | 加 `--prefer-offline --no-audit --no-fund --ignore-scripts` |
| 需要浏览器 | **复用** `%LOCALAPPDATA%\ms-playwright\chromium-1243`，**禁止** `playwright install`（用户红线，会删旧浏览器） |
| GUI/Electron 无法在沙箱启动 | 用 `node --check` + 逻辑层隔离测试替代 |

## 5. 绝对禁止

- 删库 / `rm -rf` / DROP TABLE 式「重置」
- `git push --force` / `git reset --hard` 覆盖历史
- 为了让测试过而删测试、调低 Release Gate 阈值
- 覆盖历史 AgentVersion / DatasetVersion / EvaluationRun / HumanReview / ReleaseDecision
- 把没完成的 P0 包装成 Roadmap
- 静默降级（做不到就说做不到）
