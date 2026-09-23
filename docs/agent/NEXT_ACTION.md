# NEXT_ACTION.md

> 新 Agent 读完本文件就应立刻知道该干什么。每次 checkpoint 必须重写本文件。

**Last Completed:** Stage 2 —— `@arl/providers` + `@arl/runtime` 全部落地，Runtime 冒烟验证通过
（trace 顺序：retrieval → model_call → tool_call → model_call → output；loop 检测生效；空参数被判 invalid_arguments）

**Current Task:** Stage 3 —— Dataset / TestCase / ExpectedOutcome / 导入导出 / 三个 Mock Dataset 种子数据

**Why:** 评测的一切都建立在「数据集 + 结构化期望」之上。没有 ExpectedOutcome，Evaluator 就只能靠 LLM 猜，
平台会退化成提示词打分玩具。

**Relevant Files:**
- `packages/shared/src/dataset-io.ts`（待创建：JSON/CSV 解析与校验，逐行容错）
- `packages/persistence/src/repositories/dataset-repo.ts`（已有：createCase / freezeVersion / forkVersion）
- `scripts/seed.ts`（待创建：三个数据集 + fixture agent versions + evaluator sets + gate）
- `packages/runtime/src/tools/fixtures.ts`（fixture 数据与知识库）

**Commands To Run:**
```bash
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run --reporter=basic
node node_modules/tsx/dist/cli.mjs scripts/seed.ts --dry
```

**Expected Result:** 类型 0 error；单测全绿；seed 能建出 3 个数据集（含正常/边界/失败/Critical case）。

**Known Risks:**
- 冻结后的 dataset version 不能改 case（数据库触发器）→ 改数据必须 `forkVersion`。
- `mustContain` 等期望必须能和 fixture 的真实输出对上，否则 stable agent 会「假失败」。

**Do Not Break:**
- Runtime **不得**看到 `expectedOutcome`（RuntimeCase 类型已硬性排除）。
- 版本类数据只插入不更新。
- 确定性优先：能规则判定的绝不交给 LLM。

**Next Task After Completion:** Stage 4/5 —— Trace 落库 + 确定性 Evaluator 全套（13 个 + RuleJudge）。
