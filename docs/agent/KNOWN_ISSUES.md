# KNOWN_ISSUES.md

> 禁止隐藏问题。任何 Bug / 技术债 / 未实现功能 / 临时 Mock / 失败 Case / 第三方限制都必须在这里。

## Open

| ID | 类型 | 描述 | 影响 | 计划 |
| --- | --- | --- | --- | --- |
| K-001 | 第三方限制 | `node:sqlite` 在 Node 22 标记 experimental，启动时会打印 `ExperimentalWarning` | 仅噪音，功能正常 | 通过 `scripts/dev.mjs` 的 `--no-warnings=ExperimentalWarning` 抑制；保留记录 |
| K-002 | 环境限制 | 本机 npm 到 registry 慢 | 安装耗时长 | 一律 `--prefer-offline --ignore-scripts` |
| K-003 | 技术债 | `drizzle-orm` 无 `node:sqlite` 同步驱动，query builder 能力未完全使用 | 数据访问经 repository 层 | 见 `DECISIONS.md` D-002 |
| K-004 | 第三方限制 | E2E 依赖本机已存在的 Chromium（`chromium-1243`），不下载 | 换机需自行准备浏览器 | `e2e/run-e2e.mjs` 找不到浏览器时明确 SKIP 并报错退出 |

## Closed

（空）

## 待实现（P1/P2，非缺陷）

| 项 | 优先级 | 说明 |
| --- | --- | --- |
| 真实外部 Agent Adapter（HTTP / CLI） | P2 | 已预留接口，未实现 |
| 在线 Production Trace 接入 | P2 | 未实现 |
| 团队权限 / SSO / 分布式 Runner | P2 | 未实现 |
| Semantic Failure Clustering（向量聚类） | P1 | MVP 先做 category / tag / tool 维度聚类 |
| HTML / Markdown 评测报告导出 | P1 | Dataset/Run JSON+CSV 导出为 P0 |
| Recall@K 之外的高级 RAG 指标（nDCG 等） | P1 | 未实现 |
