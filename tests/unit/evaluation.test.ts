import { describe, expect, it } from 'vitest';
import {
  BUILTIN_EVALUATORS,
  classifyFailure,
  computeMetrics,
  compareRuns,
  evaluatorByKey,
  generateSuggestions,
  judgeCase,
  metricDefinition,
  percentile,
} from '@arl/evaluation';
import { CaseRunSchema, TestCaseSchema, type CaseRun, type EvaluationResult, type TestCase } from '@arl/shared';
import type { EvaluationContext } from '@arl/evaluation';
import type { TraceBundle } from '@arl/runtime';

const now = new Date().toISOString();

function makeCase(overrides: Record<string, unknown> = {}): TestCase {
  return TestCaseSchema.parse({
    id: 'tc_1',
    datasetVersionId: 'dsv_1',
    name: '重复扣款咨询',
    input: '我的订单 ORD-1001 为什么重复扣款？',
    context: '',
    metadata: {},
    tags: ['order'],
    priority: 'normal',
    enabled: true,
    expectedOutcome: {
      expectedText: '',
      mustContain: ['重复扣款', '退款'],
      mustNotContain: ['无法处理'],
      expectedSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } } },
      expectedTools: ['getOrder'],
      forbiddenTools: ['refundOrder'],
      expectedToolArgs: [{ tool: 'getOrder', path: 'orderId', op: 'equals', expected: 'ORD-1001' }],
      maxToolCalls: 3,
      requiredEvidence: ['重复扣款'],
    },
    notes: '',
    createdAt: now,
    ...overrides,
  });
}

function makeCaseRun(overrides: Record<string, unknown> = {}): CaseRun {
  return CaseRunSchema.parse({
    id: 'cr_1',
    runId: 'run_1',
    testCaseId: 'tc_1',
    testCaseName: '重复扣款咨询',
    priority: 'normal',
    tags: ['order'],
    status: 'passed',
    machineVerdict: 'passed',
    finalOutput: '{"answer":"订单存在重复扣款，我们将按流程退款。"}',
    outputJson: { answer: '订单存在重复扣款，我们将按流程退款。' },
    traceId: 'tr_1',
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, costUsd: null, costSource: 'unknown' },
    latencyMs: 1200,
    modelLatencyMs: 900,
    toolLatencyMs: 100,
    retrievalLatencyMs: 50,
    attempt: 1,
    failureCategory: null,
    error: null,
    createdAt: now,
    ...overrides,
  });
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  const testCase = overrides.testCase ?? makeCase();
  const caseRun = overrides.caseRun ?? makeCaseRun();
  return {
    testCase,
    caseRun,
    bundle: null,
    steps: [],
    toolCalls: [
      {
        id: 'tcl_1',
        traceId: 'tr_1',
        stepId: 'st_1',
        seq: 0,
        toolName: 'getOrder',
        arguments: { orderId: 'ORD-1001' },
        validatedArguments: { orderId: 'ORD-1001' },
        validationError: null,
        status: 'ok',
        startedAt: now,
        endedAt: now,
        durationMs: 100,
        outputSummary: '订单 ORD-1001 状态 shipped, 重复扣款=true',
        outputJson: { orderId: 'ORD-1001', duplicateCharge: true, amount: 199 },
        error: null,
        redactedPaths: [],
        attempt: 1,
      },
    ],
    retrievals: [
      {
        id: 'rtv_1',
        traceId: 'tr_1',
        stepId: 'st_0',
        query: '订单重复扣款',
        rewrittenQuery: '订单 重复扣款 退款 流水',
        mode: 'keyword',
        topK: 3,
        documents: [
          { id: 'kb-duplicate-charge', title: '订单重复扣款处理规范', source: 'kb://x', score: 4.2, rank: 1, selected: true, selectedChunk: '当订单出现重复扣款时，客服应先核对订单号与扣款流水，确认确实存在两次扣款后再提交退款申请。' },
        ],
        selectedChunks: ['当订单出现重复扣款时，客服应先核对订单号与扣款流水，确认确实存在两次扣款后再提交退款申请。'],
        latencyMs: 50,
        status: 'ok',
      },
    ],
    modelCalls: [],
    rubric: undefined,
    expectedDocIds: ['kb-duplicate-charge'],
    config: {},
    severity: 'major',
    weight: 1,
    blocking: false,
    ...overrides,
  };
}

async function runEvaluator(key: string, ctx: EvaluationContext) {
  const evaluator = evaluatorByKey(key)!;
  expect(evaluator, `evaluator ${key} 未注册`).toBeDefined();
  expect(evaluator.appliesTo(ctx), `evaluator ${key} 不适用于该用例`).toBe(true);
  return evaluator.evaluate(ctx);
}

describe('确定性 Evaluator 正反例', () => {
  it('每个内置 evaluator 都有 key/name/version/category/description', () => {
    for (const e of BUILTIN_EVALUATORS) {
      expect(e.key, e.name).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(e.version).toMatch(/^v\d+$/);
      expect(e.description.length).toBeGreaterThan(5);
      expect(typeof e.appliesTo).toBe('function');
    }
    expect(new Set(BUILTIN_EVALUATORS.map((e) => e.key)).size).toBe(BUILTIN_EVALUATORS.length);
  });

  it('output.contains：全部命中 pass / 部分命中 partial / 全缺 fail', async () => {
    const pass = await runEvaluator('output.contains', makeCtx());
    expect(pass.status).toBe('pass');
    expect(pass.score).toBe(1);
    expect(pass.evidence.length).toBeGreaterThan(0);

    const partial = await runEvaluator(
      'output.contains',
      makeCtx({
        caseRun: makeCaseRun({ finalOutput: '存在重复扣款情况。', outputJson: null }),
      }),
    );
    expect(partial.status).toBe('partial');
    expect(partial.details['misses']).toEqual(['退款']);

    const fail = await runEvaluator('output.contains', makeCtx({ caseRun: makeCaseRun({ finalOutput: '一切正常。', outputJson: null }) }));
    expect(fail.status).toBe('fail');
    expect(fail.score).toBe(0);
  });

  it('output.not_contains 命中禁止内容时判定为阻断性失败', async () => {
    const fail = await runEvaluator('output.not_contains', makeCtx({ caseRun: makeCaseRun({ finalOutput: '抱歉，我们无法处理该问题。' }) }));
    expect(fail.status).toBe('fail');
    expect(fail.blocking).toBe(true);
    expect(fail.severity).toBe('critical');
  });

  it('format.json_schema 能定位到具体字段错误', async () => {
    const fail = await runEvaluator(
      'format.json_schema',
      makeCtx({ caseRun: makeCaseRun({ finalOutput: '{"confidence":0.9}', outputJson: { confidence: 0.9 } }) }),
    );
    expect(fail.status).toBe('fail');
    expect((fail.details['errors'] as { path: string }[])[0]!.path).toBe('$.answer');
  });

  it('format.json_parse 在无结构化输出时失败', async () => {
    const fail = await runEvaluator('format.json_parse', makeCtx({ caseRun: makeCaseRun({ finalOutput: '纯文本回答', outputJson: null }) }));
    expect(fail.status).toBe('fail');
  });

  it('tool.called：漏调 → fail；调用失败 → partial；正常 → pass', async () => {
    expect((await runEvaluator('tool.called', makeCtx())).status).toBe('pass');

    const missing = await runEvaluator('tool.called', makeCtx({ toolCalls: [] }));
    expect(missing.status).toBe('fail');
    expect(missing.details['missing']).toEqual(['getOrder']);

    const errored = await runEvaluator(
      'tool.called',
      makeCtx({ toolCalls: [{ ...makeCtx().toolCalls[0]!, status: 'error', error: 'boom' }] }),
    );
    expect(errored.status).toBe('partial');
  });

  it('tool.not_called：调用禁止工具 → 阻断性失败', async () => {
    const ctx = makeCtx({
      toolCalls: [{ ...makeCtx().toolCalls[0]!, toolName: 'refundOrder', arguments: { orderId: 'ORD-1001', confirmed: false } }],
    });
    const result = await runEvaluator('tool.not_called', ctx);
    expect(result.status).toBe('fail');
    expect(result.blocking).toBe(true);
    expect(result.message).toContain('refundOrder');
  });

  it('tool.arguments：参数不匹配时给出期望/实际对比', async () => {
    const bad = await runEvaluator(
      'tool.arguments',
      makeCtx({ toolCalls: [{ ...makeCtx().toolCalls[0]!, validatedArguments: { orderId: 'ORD-9999' }, arguments: { orderId: 'ORD-9999' } }] }),
    );
    expect(bad.status).toBe('fail');
    const checks = bad.details['checks'] as { actual: unknown; expected: unknown }[];
    expect(checks[0]!.actual).toBe('ORD-9999');
    expect(checks[0]!.expected).toBe('ORD-1001');
  });

  it('tool.call_count：超过上限判 fail', async () => {
    const calls = [0, 1, 2, 3].map((i) => ({ ...makeCtx().toolCalls[0]!, id: `tcl_${i}` }));
    const result = await runEvaluator('tool.call_count', makeCtx({ toolCalls: calls }));
    expect(result.status).toBe('fail');
    expect(result.details).toMatchObject({ max: 3, actual: 4 });
  });

  it('process.loop：相同工具相同参数重复超过阈值 → 阻断失败', async () => {
    const call = makeCtx().toolCalls[0]!;
    const repeated = [call, { ...call, id: 'tcl_2' }, { ...call, id: 'tcl_3' }];
    const result = await runEvaluator('process.loop', makeCtx({ toolCalls: repeated }));
    expect(result.status).toBe('fail');
    expect(result.severity).toBe('critical');
    expect(result.message).toContain('重复 3 次');
  });

  it('rag.hit：期望文档未召回 → fail', async () => {
    const miss = await runEvaluator(
      'rag.hit',
      makeCtx({ retrievals: [{ ...makeCtx().retrievals[0]!, documents: [], selectedChunks: [] }] }),
    );
    expect(miss.status).toBe('fail');
    expect(miss.details['missing']).toEqual(['kb-duplicate-charge']);
  });

  it('rag.recall_at_k：给出 Recall@K 与 Hit@K 数值', async () => {
    const result = await runEvaluator('rag.recall_at_k', makeCtx());
    expect(result.status).toBe('pass');
    expect(result.details).toMatchObject({ k: 3, recall: 1, hit: 1 });
  });

  it('rag.groundedness：无依据的数字断言必须被检出（幻觉检测）', async () => {
    const grounded = await runEvaluator('rag.groundedness', makeCtx());
    expect(grounded.status).toBe('pass');

    const hallucinated = await runEvaluator(
      'rag.groundedness',
      makeCtx({
        caseRun: makeCaseRun({
          finalOutput: '{"answer":"订单存在重复扣款。另外，根据系统记录，你的账户已自动获得 100 元补偿，2 小时内完成退款。"}',
          outputJson: null,
        }),
      }),
    );
    expect(['fail', 'partial']).toContain(hallucinated.status);
    expect(hallucinated.details['unsupported']).toBeTruthy();
    expect(JSON.stringify(hallucinated.details)).toContain('100 元');
  });

  it('performance.latency：超阈值判 fail 且给出阈值与实测', async () => {
    const slow = await runEvaluator('performance.latency', makeCtx({ caseRun: makeCaseRun({ latencyMs: 20000 }), config: { maxLatencyMs: 8000 } }));
    expect(slow.status).toBe('fail');
    expect(slow.details).toMatchObject({ threshold: 8000, actual: 20000 });
  });

  it('performance.cost：成本未知时判 skipped 而不是通过', async () => {
    const result = await runEvaluator('performance.cost', makeCtx({ config: { maxCostUsd: 0.01 } }));
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('成本未知');
  });

  it('用例未产出结果时，输出类 evaluator 判 fail 而不是 skipped', async () => {
    const ctx = makeCtx({ caseRun: makeCaseRun({ status: 'timeout', finalOutput: '', outputJson: null, error: '超时' }) });
    const result = await runEvaluator('output.contains', ctx);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('timeout');
  });

  it('不适用时 appliesTo 返回 false（避免虚高通过率）', () => {
    const noTools = makeCase({ expectedOutcome: { mustContain: ['x'] } });
    const ctx = makeCtx({ testCase: noTools });
    expect(evaluatorByKey('tool.called')!.appliesTo(ctx)).toBe(false);
    expect(evaluatorByKey('format.json_schema')!.appliesTo(ctx)).toBe(false);
    expect(evaluatorByKey('output.contains')!.appliesTo(ctx)).toBe(true);
  });
});

describe('Rule Judge', () => {
  const pass = (key: string, extra: Partial<EvaluationResult> = {}) => ({
    evaluatorKey: key,
    evaluatorVersion: 'v1',
    name: key,
    category: 'output' as const,
    status: 'pass' as const,
    score: 1,
    severity: 'major' as const,
    weight: 1,
    blocking: false,
    message: '',
    details: {},
    evidence: [],
    durationMs: 0,
    ...extra,
  });

  it('ALL：任一 fail 即 failed', () => {
    const outcome = judgeCase([pass('a'), pass('b', { status: 'fail', score: 0 })], 'all', 1);
    expect(outcome.verdict).toBe('failed');
  });

  it('ALL：有 partial 则 partial', () => {
    const outcome = judgeCase([pass('a'), pass('b', { status: 'partial', score: 0.5 })], 'all', 1);
    expect(outcome.verdict).toBe('partial');
  });

  it('ANY：存在 pass 即 passed', () => {
    const outcome = judgeCase([pass('a', { status: 'fail', score: 0 }), pass('b')], 'any', 1);
    expect(outcome.verdict).toBe('passed');
  });

  it('WEIGHTED：按权重与阈值判定', () => {
    const results = [
      pass('a', { score: 1, weight: 3 }),
      pass('b', { status: 'fail', score: 0, weight: 1 }),
    ];
    expect(judgeCase(results, 'weighted', 0.7).verdict).toBe('passed');
    expect(judgeCase(results, 'weighted', 0.8).verdict).toBe('partial');
    expect(judgeCase(results, 'weighted', 0.95).verdict).toBe('failed');
  });

  it('blocking 检查失败直接 failed（无视加权）', () => {
    const outcome = judgeCase(
      [pass('a', { score: 1, weight: 100 }), pass('safety', { status: 'fail', score: 0, blocking: true })],
      'weighted',
      0.1,
    );
    expect(outcome.verdict).toBe('failed');
    expect(outcome.blockingFailures).toBe(1);
  });

  it('skipped 不参与判定但会被统计；全 skipped 时明确提示数据集问题', () => {
    const outcome = judgeCase([pass('a', { status: 'skipped' })], 'all', 1);
    expect(outcome.verdict).toBe('passed');
    expect(outcome.noApplicableChecks).toBe(true);
    expect(outcome.skippedCount).toBe(1);
  });

  it('evaluator 报错时裁决为 partial 并说明结论不可信', () => {
    const outcome = judgeCase([pass('a'), pass('b', { status: 'error', score: 0 })], 'all', 1);
    expect(outcome.verdict).toBe('partial');
    expect(outcome.reason).toContain('结论不可信');
  });
});

describe('Metrics Engine', () => {
  const runs: CaseRun[] = [
    makeCaseRun({ id: 'cr_1', status: 'passed' }),
    makeCaseRun({ id: 'cr_2', status: 'failed', priority: 'critical', latencyMs: 3000 }),
    makeCaseRun({ id: 'cr_3', status: 'partial', latencyMs: 2000 }),
    makeCaseRun({ id: 'cr_4', status: 'timeout', latencyMs: 9000 }),
  ];

  const results: EvaluationResult[] = [
    { evaluatorKey: 'tool.called', evaluatorVersion: 'v1', name: 't', category: 'tool', status: 'pass', score: 1, severity: 'major', weight: 1, blocking: false, message: '', details: {}, evidence: [], durationMs: 0, id: 'e1', caseRunId: 'cr_1' },
    { evaluatorKey: 'tool.arguments', evaluatorVersion: 'v1', name: 't', category: 'tool', status: 'fail', score: 0, severity: 'major', weight: 1, blocking: false, message: '', details: {}, evidence: [], durationMs: 0, id: 'e2', caseRunId: 'cr_2' },
    { evaluatorKey: 'format.json_parse', evaluatorVersion: 'v1', name: 'f', category: 'format', status: 'pass', score: 1, severity: 'major', weight: 1, blocking: false, message: '', details: {}, evidence: [], durationMs: 0, id: 'e3', caseRunId: 'cr_1' },
    { evaluatorKey: 'rag.groundedness', evaluatorVersion: 'v1', name: 'g', category: 'rag', status: 'partial', score: 0.5, severity: 'major', weight: 1, blocking: false, message: '', details: {}, evidence: [], durationMs: 0, id: 'e4', caseRunId: 'cr_1' },
    { evaluatorKey: 'rag.groundedness', evaluatorVersion: 'v1', name: 'g', category: 'rag', status: 'pass', score: 1, severity: 'major', weight: 1, blocking: false, message: '', details: {}, evidence: [], durationMs: 0, id: 'e5', caseRunId: 'cr_3' },
  ];

  const metrics = computeMetrics({
    caseRuns: runs,
    results,
    failures: [
      { id: 'f1', caseRunId: 'cr_2', runId: 'run_1', category: 'tool_argument_failure', customCategory: null, confidence: 0.9, source: 'rule', explanation: '', evidence: [], createdAt: now },
      { id: 'f2', caseRunId: 'cr_4', runId: 'run_1', category: 'timeout', customCategory: null, confidence: 0.9, source: 'rule', explanation: '', evidence: [], createdAt: now },
    ],
    toolCallStats: { total: 10, errors: 2 },
  });

  const value = (key: string) => metrics.find((m) => m.metricKey === key)?.value;

  it('通过率 / 失败率 / 部分率 / 错误率按定义计算', () => {
    expect(value('task_success_rate')).toBe(0.25);
    expect(value('fail_rate')).toBe(0.25);
    expect(value('partial_rate')).toBe(0.25);
    expect(value('error_rate')).toBe(0.25);
  });

  it('critical 通过率只统计 critical 用例', () => {
    expect(value('critical_pass_rate')).toBe(0);
  });

  it('工具与格式指标按 evaluator 聚合', () => {
    expect(value('tool_accuracy')).toBe(0.5);
    expect(value('format_compliance')).toBe(1);
  });

  it('groundedness 取 rag.groundedness 的 score 平均', () => {
    expect(value('groundedness')).toBe(0.75);
  });

  it('延迟分位数使用最近秩，结果可复算', () => {
    expect(value('avg_latency_ms')).toBe(Math.round(((1200 + 3000 + 2000 + 9000) / 4) * 10) / 10);
    expect(value('p50_latency_ms')).toBe(2000);
    expect(value('p95_latency_ms')).toBe(9000);
  });

  it('成本未知时明确暴露：avg_cost 不产出、cost_known_ratio=0', () => {
    expect(metrics.find((m) => m.metricKey === 'avg_cost_usd')).toBeUndefined();
    expect(value('cost_known_ratio')).toBe(0);
  });

  it('checked_case_ratio 暴露「跑了但没评测」的用例', () => {
    expect(value('checked_case_ratio')).toBe(0.75);
  });

  it('每个指标都带 definition 与 version（可解释、可版本化比较）', () => {
    for (const m of metrics) {
      expect(m.definition.length, m.metricKey).toBeGreaterThan(10);
      expect(m.metricVersion).toMatch(/^v\d+$/);
      expect(metricDefinition(m.metricKey)).toBeDefined();
    }
  });

  it('percentile 边界正确', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1], 0.95)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('临界子集指标可独立计算（供 Gate 使用）', () => {
    const critical = computeMetrics({ caseRuns: runs, results, failures: [] }, 'critical');
    expect(critical.find((m) => m.metricKey === 'task_success_rate')?.value).toBe(0);
    expect(critical.find((m) => m.metricKey === 'task_success_rate')?.sampleSize).toBe(1);
  });
});

describe('Failure Classifier（确定性优先）', () => {
  const base = { testCase: makeCase(), toolCalls: makeCtx().toolCalls, retrievals: makeCtx().retrievals, steps: [] };

  it('passed 的用例返回 null', () => {
    expect(classifyFailure({ ...base, caseRun: makeCaseRun({ status: 'passed' }), results: [] })).toBeNull();
  });

  it('超时优先归为 timeout', () => {
    const c = classifyFailure({ ...base, caseRun: makeCaseRun({ status: 'timeout' }), results: [] });
    expect(c!.category).toBe('timeout');
    expect(c!.confidence).toBeGreaterThan(0.9);
  });

  it('循环证据 → loop', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'process.loop', status: 'fail', message: '重复调用', evidence: [] }],
      loopGuarded: true,
    });
    expect(c!.category).toBe('loop');
  });

  it('禁止工具被调用 → policy_failure', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'tool.not_called', status: 'fail', message: '调用了 refundOrder', evidence: [] }],
    });
    expect(c!.category).toBe('policy_failure');
  });

  it('漏调工具 → tool_selection_failure，并给出实际调用', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'tool.called', status: 'fail', message: '未调用必需工具：getOrder', evidence: [] }],
      toolCalls: [{ ...base.toolCalls[0]!, toolName: 'getBalance' }],
    });
    expect(c!.category).toBe('tool_selection_failure');
    expect(c!.explanation).toContain('getBalance');
  });

  it('参数非法 → tool_argument_failure', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [],
      toolCalls: [{ ...base.toolCalls[0]!, status: 'invalid_arguments', validationError: '$.orderId 长度 0 < minLength 1' }],
    });
    expect(c!.category).toBe('tool_argument_failure');
    expect(c!.evidence.length).toBeGreaterThan(0);
  });

  it('格式错误优先于内容错误', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [
        { evaluatorKey: 'format.json_parse', status: 'fail', message: '不是合法 JSON', evidence: [] },
        { evaluatorKey: 'output.contains', status: 'fail', message: '缺关键词', evidence: [] },
      ],
    });
    expect(c!.category).toBe('format_failure');
  });

  it('检索未召回 → retrieval_failure', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'rag.hit', status: 'fail', message: '未召回 kb-x', evidence: [] }],
    });
    expect(c!.category).toBe('retrieval_failure');
  });

  it('有据可依失败 → hallucination', () => {
    const c = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'rag.groundedness', status: 'fail', message: '1/1 条断言缺乏依据', evidence: [] }],
    });
    expect(c!.category).toBe('hallucination');
  });

  it('缺关键词且检索为空 → missing_context；部分命中 → partial_completion', () => {
    const missingContext = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'failed' }),
      results: [{ evaluatorKey: 'output.contains', status: 'fail', message: '缺少关键词 2 个', evidence: [], details: { misses: ['重复扣款', '退款'] } }],
      retrievals: [],
    });
    expect(missingContext!.category).toBe('missing_context');

    const partial = classifyFailure({
      ...base,
      caseRun: makeCaseRun({ status: 'partial' }),
      results: [{ evaluatorKey: 'output.contains', status: 'partial', message: '缺少关键词 1 个', evidence: [], details: { misses: ['退款'] } }],
    });
    expect(partial!.category).toBe('partial_completion');
  });

  it('无任何线索时归为 unknown 且置信度低（触发 LLM 补充）', () => {
    const c = classifyFailure({ ...base, caseRun: makeCaseRun({ status: 'failed', category: undefined } as never), results: [], toolCalls: [], retrievals: [] });
    expect(c!.category).toBe('unknown');
    expect(c!.confidence).toBeLessThan(0.6);
  });
});

describe('Regression Detector', () => {
  const mk = (id: string, status: CaseRun['status'], priority: CaseRun['priority'] = 'normal') =>
    makeCaseRun({ id, testCaseId: `tc_${id}`, status, machineVerdict: status, priority });

  it('检出 Pass → Fail 的回归，且 critical 用例升级为 critical 级别', () => {
    const comparison = compareRuns(
      { runId: 'r1', label: 'v1', caseRuns: [mk('a', 'passed'), mk('b', 'passed', 'critical'), mk('c', 'failed')], metrics: [] },
      { runId: 'r2', label: 'v2', caseRuns: [mk('a', 'passed'), mk('b', 'failed', 'critical'), mk('c', 'passed')], metrics: [] },
    );
    expect(comparison.regressedCases.map((c) => c.testCaseId)).toEqual(['tc_b']);
    expect(comparison.fixedCases.map((c) => c.testCaseId)).toEqual(['tc_c']);
    expect(comparison.regressions[0]!.severity).toBe('critical');
    expect(comparison.regressions[0]!.kind).toBe('case');
  });

  it('指标回归：通过率下降超阈值', () => {
    const metrics = (passRate: number, p95 = 1000) => [
      { runId: 'r', metricKey: 'task_success_rate', metricVersion: 'v1', name: '通过率', value: passRate, unit: 'ratio' as const, direction: 'higher_is_better' as const, definition: '', sampleSize: 10, breakdown: {} },
      { runId: 'r', metricKey: 'p95_latency_ms', metricVersion: 'v1', name: 'P95', value: p95, unit: 'ms' as const, direction: 'lower_is_better' as const, definition: '', sampleSize: 10, breakdown: {} },
    ];
    const comparison = compareRuns(
      { runId: 'r1', label: 'v1', caseRuns: [mk('a', 'passed')], metrics: metrics(0.91) },
      { runId: 'r2', label: 'v2', caseRuns: [mk('a', 'passed')], metrics: metrics(0.88) },
    );
    const metricRegression = comparison.regressions.find((r) => r.kind === 'metric');
    expect(metricRegression).toBeDefined();
    expect(metricRegression!.description).toContain('91.0%');
  });

  it('延迟回归：P95 3.2s → 7.9s 被检出', () => {
    const metrics = (p95: number) => [
      { runId: 'r', metricKey: 'p95_latency_ms', metricVersion: 'v1', name: 'P95', value: p95, unit: 'ms' as const, direction: 'lower_is_better' as const, definition: '', sampleSize: 10, breakdown: {} },
    ];
    const comparison = compareRuns(
      { runId: 'r1', label: 'v1', caseRuns: [], metrics: metrics(3200) },
      { runId: 'r2', label: 'v2', caseRuns: [], metrics: metrics(7900) },
    );
    const latency = comparison.regressions.find((r) => r.kind === 'latency');
    expect(latency).toBeDefined();
    expect(latency!.currentValue).toBe(7900);
  });

  it('成本未知时不产生成本回归（不猜）', () => {
    const comparison = compareRuns(
      { runId: 'r1', label: 'v1', caseRuns: [], metrics: [] },
      { runId: 'r2', label: 'v2', caseRuns: [], metrics: [] },
    );
    expect(comparison.regressions.filter((r) => r.kind === 'cost')).toHaveLength(0);
  });

  it('metricDiffs 给出方向与改善判定', () => {
    const comparison = compareRuns(
      {
        runId: 'r1',
        label: 'v1',
        caseRuns: [],
        metrics: [{ runId: 'r', metricKey: 'groundedness', metricVersion: 'v1', name: 'g', value: 0.5, unit: 'score' as const, direction: 'higher_is_better' as const, definition: '', sampleSize: 1, breakdown: {} }],
      },
      {
        runId: 'r2',
        label: 'v2',
        caseRuns: [],
        metrics: [{ runId: 'r', metricKey: 'groundedness', metricVersion: 'v1', name: 'g', value: 0.9, unit: 'score' as const, direction: 'higher_is_better' as const, definition: '', sampleSize: 1, breakdown: {} }],
      },
    );
    const diff = comparison.metricDiffs.find((d) => d.metricKey === 'groundedness')!;
    expect(diff.delta).toBeCloseTo(0.4, 5);
    expect(diff.improved).toBe(true);
  });
});

describe('Optimization Suggestions —— 必须带可核对证据', () => {
  it('工具参数错误聚类会指出具体缺失参数与涉及用例数', () => {
    const testCase = makeCase();
    const caseRun = makeCaseRun({ id: 'cr_x', status: 'failed' });
    const suggestions = generateSuggestions({
      runId: 'run_1',
      agentId: 'ag_1',
      agentVersionId: 'agv_1',
      prompt: {
        id: 'pv_1',
        agentId: 'ag_1',
        version: 1,
        label: 'v1',
        systemPrompt: 'sys',
        taskPromptTemplate: '{{input}}',
        variables: [],
        hash: 'h',
        notes: '',
        createdBy: 't',
        createdAt: now,
      },
      caseRuns: [caseRun, makeCaseRun({ id: 'cr_y', status: 'passed' })],
      results: [],
      failures: [
        { id: 'f1', caseRunId: 'cr_x', runId: 'run_1', category: 'tool_argument_failure', customCategory: null, confidence: 0.9, source: 'rule', explanation: '', evidence: [], createdAt: now },
      ],
      testCases: new Map([[testCase.id, testCase]]),
      toolCallsByCase: new Map([
        ['cr_x', [{ ...makeCtx().toolCalls[0]!, status: 'invalid_arguments', arguments: { orderId: '' }, validatedArguments: {} }]],
      ]),
      retrievalsByCase: new Map(),
    });

    const toolSuggestion = suggestions.find((s) => s.category === 'tool');
    expect(toolSuggestion).toBeDefined();
    expect(toolSuggestion!.title).toContain('1/2');
    expect(toolSuggestion!.title).toContain('orderId');
    expect(toolSuggestion!.evidence.length).toBeGreaterThan(0);
    expect(toolSuggestion!.affectedCases).toEqual(['cr_x']);
  });

  it('没有任何有效检查项的用例会被显式指出（防止虚高通过率）', () => {
    const testCase = makeCase();
    const suggestions = generateSuggestions({
      runId: 'run_1',
      agentId: 'ag_1',
      agentVersionId: 'agv_1',
      prompt: { id: 'pv_1', agentId: 'ag_1', version: 1, label: 'v1', systemPrompt: 's', taskPromptTemplate: '{{input}}', variables: [], hash: 'h', notes: '', createdBy: 't', createdAt: now },
      caseRuns: [makeCaseRun({ id: 'cr_z', status: 'passed' })],
      results: [],
      failures: [],
      testCases: new Map([[testCase.id, testCase]]),
      toolCallsByCase: new Map(),
      retrievalsByCase: new Map(),
    });
    expect(suggestions.some((s) => s.title.includes('没有任何有效检查项'))).toBe(true);
  });
});
