# TEST_STATUS.md

| Type | Command | Result | Passed | Failed | Known Failure |
| --- | --- | --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | NOT_RUN | - | - | - |
| Build | `npm run build` | NOT_RUN | - | - | - |
| Unit | `npm run test:unit` | NOT_RUN | - | - | - |
| Integration | `npm run test:integration` | NOT_RUN | - | - | - |
| E2E | `npm run test:e2e` | NOT_RUN | - | - | - |

## 说明

- 本表在每个 Stage checkpoint 后更新。
- `Result` 取值：`PASS` / `FAIL` / `PARTIAL` / `NOT_RUN` / `SKIPPED`。
- 任何失败必须同时在 `KNOWN_ISSUES.md` 有对应条目，禁止隐藏。
- E2E 依赖本机已有 Chromium；若不存在则标 `SKIPPED` 并说明原因，**不得静默标记为 PASS**。
