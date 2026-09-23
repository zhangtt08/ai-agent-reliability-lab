# KNOWN_ISSUES.md

> 禁止隐藏问题。任何 Bug / 技术债 / 未实现功能 / 临时 Mock / 失败 Case / 第三方限制都必须在这里。

## Open

| ID | 类型 | 描述 | 影响 | 计划 |
| --- | --- | --- | --- | --- |
| K-001 | 第三方限制 | `node:sqlite` 在 Node 22 标记 experimental，启动时会打印 `ExperimentalWarning` | 仅噪音，功能正常 | 通过 `scripts/dev.mjs` 的 `--no-warnings=ExperimentalWarning` 抑制；保留记录 |
| K-002 | 环境限制 | 本机 npm 到 registry 慢 | 安装耗时长 | 一律 `--prefer-offline --ignore-scripts` |
| K-003 | 技术债 | `drizzle-orm` 无 `node:sqlite` 同步驱动，query builder 能力未完全使用 | 数据访问经 repository 层 | 见 `DECISIONS.md` D-002 |
| K-004 | 第三方限制 | E2E 依赖本机已存在的 Chromium（`chromium-1243`），不下载 | 换机需自行准备浏览器 | `e2e/run-e2e.mjs` 找不到浏览器时明确 SKIP 并报错退出 |
| K-005 | 环境限制 | vitest 2.1 文件级并发会并发写 `<tmpdir>/<id>/ssr/<hash>` 模块缓存，在本机被 brokered-fs 拒绝（EPERM），**导致部分测试文件被静默跳过**（假绿） | 曾出现 5 个测试文件只跑 2 个 | 已在 `vitest.config.ts` 固定 `fileParallelism: false`；串行后 122/122 稳定通过 |
| K-006 | 构建集成 | Vite/Vitest 的模块解析器不认识 `node:sqlite`（报 `Failed to load url sqlite`），因为其内置模块表早于该模块出现 | `@arl/persistence` 在测试环境无法加载 | 已在 `driver.ts` 用 `createRequire` 做运行时间接加载，Vite 静态分析看不到该 specifier；生产与测试行为一致 |
| K-007 | 技术债 | Mock provider 的 token 用量为字符估算（CJK 1 token/字，其余 4 字符/token） | usage 数值非真实计费值 | trace 中 provider 标注为 `mock`、`costSource` 为 `unknown`；README 明示 |

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
