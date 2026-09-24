# TEST_STATUS.md

| Type | Command | Result | Passed | Failed | Known Failure |
| --- | --- | --- | --- | --- | --- |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | PASS | - | 0 | - |
| Build | `npm run build` | PASS | tsc 0 error + vite 228KB | 0 | - |
| Unit | `npm run test:unit` | PASS | 174 | 0 | - |
| Integration | `npm run test:integration` | PASS | 17 | 0 | - |
| E2E | `npm run test:e2e` | PASS | 12 步 | 0 | 截图见 e2e/screenshots/ |

## 测试文件清单

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/unit/shared-foundation.test.ts` | 14 | JSON Schema 子集校验 / JSON 工具 / ExpectedOutcome schema / 数据集导入导出 |
| `tests/unit/redaction.test.ts` | 11 | TraceRedactor：凭据正则、结构脱敏、三种隐私策略 |
| `tests/unit/persistence-contract.test.ts` | 32 | Drizzle schema ↔ 迁移 DDL 逐列契约、迁移幂等与 checksum |
| `tests/unit/persistence-write-contract.test.ts` | 56 | 领域模型字段 ↔ 真实数据库列（INSERT 计划可执行） |
| `tests/unit/persistence-immutability.test.ts` | 9 | 版本不可覆盖、dataset 冻结、trace 只增改 |
| `tests/unit/evaluation.test.ts` | 52 | 19 个 evaluator 正反例 / RuleJudge / 指标精确断言 / 失败归因 / 回归检测 / 建议 |

## 说明

- `Result` 取值：`PASS` / `FAIL` / `PARTIAL` / `NOT_RUN` / `SKIPPED`。
- 任何失败必须同时在 `KNOWN_ISSUES.md` 有对应条目，禁止隐藏。
- E2E 依赖本机已有 Chromium；不存在时标 `SKIPPED` 并说明，**不得静默通过**。
- 本机必须串行执行测试文件（`fileParallelism: false`），否则 vitest 会出现 EPERM 并静默丢文件（K-005）。

## 集成 / E2E 清单

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `tests/integration/evaluation-integrity.test.ts` | 8 | 8 个 fixture agent 的完整性验证（§86） |
| `tests/integration/regression-gate.test.ts` | 3 | 回归 fixture（§87）+ 门禁 fixture（§88）+ 合格版本不误判 |
| `tests/integration/human-review.test.ts` | 1 | 机器 FAIL + 人工 PASS 并存（§89） |
| `tests/integration/api.test.ts` | 5 | HTTP 层主流程 + 错误处理 |
| `e2e/run-e2e.mjs` | 12 步 | 浏览器主流程（§90），复用本机 Chromium |
