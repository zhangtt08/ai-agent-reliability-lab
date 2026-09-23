# ARCHITECTURE.md

## 分层

```
┌──────────────────────────────────────────────────────────┐
│ apps/web             React + Vite + Tailwind + Zustand    │  UI 层
├──────────────────────────────────────────────────────────┤
│ apps/server          Express API + Run Pipeline + Queue   │  API / 编排层
├──────────────────────────────────────────────────────────┤
│ packages/evaluation  Evaluators / Judges / Metrics /      │  评测层
│                      Regression / Gate / Failure / Suggest│
├──────────────────────────────────────────────────────────┤
│ packages/runtime     AgentRuntime / Tools / Trace 采集     │  运行时层
│ packages/providers   ModelProvider（mock / 真实）          │
├──────────────────────────────────────────────────────────┤
│ packages/persistence SQLite（node:sqlite）+ 迁移 + Repo    │  持久层
├──────────────────────────────────────────────────────────┤
│ packages/shared      Zod Schema / 类型 / 脱敏 / 工具        │  领域层
└──────────────────────────────────────────────────────────┘
```

依赖方向**单向向下**：`web → server → evaluation/runtime/providers → persistence → shared`。
`evaluation` 不依赖 `persistence`（纯函数，输入 domain 对象），所以能被单元测试直接喂 fixture。

## 四个可插拔接口（新增实现无需改核心）

```ts
interface ModelProvider {
  id: string;
  generate(req: GenerateRequest): Promise<GenerateResponse>;          // 文本
  generateStructured<T>(req, schema: ZodType<T>): Promise<StructuredResponse<T>>;
  stream?(req): AsyncIterable<StreamChunk>;                           // 可选
}

interface AgentRuntime {
  id: string;
  run(input: RuntimeInput): Promise<AgentRunResult>;                  // 含 trace
}

interface Evaluator {
  id: string; type: string; version: string;
  evaluate(ctx: EvaluationContext): EvaluationResult;                 // 纯函数
}

interface ToolExecutor {
  execute(call: ToolCallRequest, tool: ToolDefinition): Promise<ToolCallRecord>;
}
```

## 核心数据流（一次 EvaluationRun）

```
TestCase ──┐
           ├─► CaseRunner ──► AgentRuntime.run() ──► AgentRunResult
AgentVersion┘        │                                │
                     │                                ├─ finalOutput
                     │                                ├─ trace[]  ──► TraceRedactor ──► DB
                     │                                ├─ usage / duration / status
                     ▼
            EvaluatorSet ──► EvaluationResult[]（每条带 EvidenceReference）
                     ▼
              RuleJudge（ALL / ANY / Weighted）──► CaseRun verdict
                     ▼
          MetricsEngine ──► MetricResult[]（每个指标带 definition）
                     ▼
        FailureClassifier ──► Failure(category, confidence, evidence)
                     ▼
   RegressionDetector（vs Baseline）──► Regression[]
                     ▼
             ReleaseGate ──► ReleaseDecision(PASS/FAIL/BLOCKED/UNKNOWN)
                     ▼
      SuggestionEngine ──► OptimizationSuggestion[]（必须带 evidence）
```

## 关键设计约束

1. **版本不可覆盖**：`agent_versions` / `prompt_versions` / `dataset_versions` / `evaluation_runs` / `human_reviews` / `release_decisions` 只 INSERT，不 UPDATE 历史行。
2. **可复现性快照**：每次 Run 保存 `reproducibility_json`（agent version、dataset version、evaluator 版本集、model config、temperature、runtime config、seed、timestamp）。
3. **确定性优先**：见 `DECISIONS.md` D-003。
4. **隔离性**：每个 Case 独立 error boundary；一个 case 崩不终止批次。
5. **脱敏前置**：Trace 落库前必经 `TraceRedactor`。
6. **Mock 可见**：`provider: "mock"` 贯穿 trace / UI / 报告，`costSource: "unknown"` 时不得展示伪造真实费用。

## 目录地图

```
apps/server/src/
  main.ts              HTTP 入口
  api/                 REST 路由（agents/datasets/runs/traces/evaluations/...）
  services/            RunPipeline、Queue、Seeder、SuggestionEngine 编排
apps/web/src/
  routes/              页面
  components/          UI 组件（trace viewer、metric card、diff 表…）
  store/               Zustand
packages/shared/src/   schemas.ts types.ts redaction.ts ids.ts json.ts
packages/persistence/  driver.ts migrations/ repositories/
packages/providers/src/  types.ts mock-provider.ts registry.ts
packages/runtime/src/    types.ts tools/ agents/ trace-collector.ts
packages/evaluation/src/ evaluators/ rule-judge.ts metrics.ts
                         failure-classifier.ts regression.ts gate.ts
                         llm-judge.ts rubrics.ts suggestions.ts
tests/unit/ tests/integration/ e2e/ scripts/
```
