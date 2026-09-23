# TEST_STATUS.md

| Type | Command | Result | Passed | Failed | Known Failure |
| --- | --- | --- | --- | --- | --- |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | PASS | - | 0 | - |
| Build | `npm run build` | NOT_RUN | - | - | 前端尚未建立 |
| Unit | `npm run test:unit` | PASS | 122 | 0 | - |
| Integration | `npm run test:integration` | NOT_RUN | - | - | 待 Stage 7 |
| E2E | `npm run test:e2e` | NOT_RUN | - | - | 待 Stage 14 |

## 测试文件清单

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/unit/shared-foundation.test.ts` | 14 | JSON Schema 子集校验 / JSON 工具 / ExpectedOutcome schema |
| `tests/unit/redaction.test.ts` | 11 | TraceRedactor：凭据正则、结构脱敏、三种隐私策略 |
| `tests/unit/persistence-contract.test.ts` | 32 | Drizzle schema ↔ 迁移 DDL 逐列契约、迁移幂等与 checksum |
| `tests/unit/persistence-write-contract.test.ts` | 56 | 领域模型字段 ↔ 真实数据库列（INSERT 计划可执行） |
| `tests/unit/persistence-immutability.test.ts` | 9 | 版本不可覆盖、dataset 冻结、trace 只增改 |

## 说明

- `Result` 取值：`PASS` / `FAIL` / `PARTIAL` / `NOT_RUN` / `SKIPPED`。
- 任何失败必须同时在 `KNOWN_ISSUES.md` 有对应条目，禁止隐藏。
- E2E 依赖本机已有 Chromium；不存在时标 `SKIPPED` 并说明，**不得静默通过**。
- 本机必须串行执行测试文件（`fileParallelism: false`），否则 vitest 会出现 EPERM 并静默丢文件（K-005）。
