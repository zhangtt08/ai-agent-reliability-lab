import {
  FAILURE_TAXONOMY,
  validateSchemaLite,
  type EvaluationStatus,
  type EvaluatorDescriptor,
  type EvidenceReference,
} from '@arl/shared';
import { createDraft, evidence, findOutputRange, normalizeText, type EvaluationContext, type EvaluationDraft, type Evaluator } from './types';

/** 用例没产出结果时，依赖输出的 evaluator 必须判 fail，而不是 skipped —— 否则失败会被"洗白"成通过。 */
function missingOutput(ctx: EvaluationContext): string | null {
  if (ctx.caseRun.status === 'passed' || ctx.caseRun.status === 'failed' || ctx.caseRun.status === 'partial') return null;
  if (ctx.caseRun.finalOutput.trim() === '' && (ctx.caseRun.status === 'error' || ctx.caseRun.status === 'timeout' || ctx.caseRun.status === 'cancelled')) {
    return `case 未产出结果（status=${ctx.caseRun.status}${ctx.caseRun.error ? `，${ctx.caseRun.error}` : ''}）`;
  }
  return null;
}

function statusFromRatio(ratio: number): EvaluationStatus {
  if (ratio >= 1) return 'pass';
  if (ratio > 0) return 'partial';
  return 'fail';
}

function toolCallEvidence(call: { id: string; stepId: string; toolName: string; outputSummary: string }, description: string): EvidenceReference {
  return evidence({ type: 'tool_call', toolCallId: call.id, traceStepId: call.stepId, description, snippet: call.outputSummary });
}

// ═══════════════════════════════════════════════════════════════
// 输出类
// ═══════════════════════════════════════════════════════════════

export const exactMatchEvaluator: Evaluator = {
  key: 'output.exact_match',
  name: '精确匹配',
  version: 'v1',
  kind: 'deterministic',
  category: 'output',
  description: '归一化（去空白 + 小写）后与 expectedText 完全一致。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedText.trim() !== '',
  evaluate(ctx) {
    const expected = ctx.testCase.expectedOutcome.expectedText;
    const actual = ctx.caseRun.finalOutput;
    const missing = missingOutput(ctx);
    if (missing) return createDraft(exactMatchEvaluator, { status: 'fail', message: missing }, ctx);
    const equal = normalizeText(actual) === normalizeText(expected);
    return createDraft(
      exactMatchEvaluator,
      {
        status: equal ? 'pass' : 'fail',
        score: equal ? 1 : 0,
        message: equal ? '输出与期望文本完全一致' : '输出与期望文本不一致',
        details: { expected, actualLength: actual.length, actualPreview: actual.slice(0, 200) },
        evidence: equal ? [] : [evidence({ type: 'output_range', description: '期望文本', snippet: expected.slice(0, 160) })],
      },
      ctx,
    );
  },
};

export const containsEvaluator: Evaluator = {
  key: 'output.contains',
  name: '必需关键词',
  version: 'v1',
  kind: 'deterministic',
  category: 'output',
  description: '输出必须包含 mustContain 中的全部关键词（大小写与空白无关）。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.mustContain.length > 0,
  evaluate(ctx) {
    const required = ctx.testCase.expectedOutcome.mustContain;
    const missing = missingOutput(ctx);
    if (missing) return createDraft(containsEvaluator, { status: 'fail', message: missing }, ctx);
    const haystack = normalizeText(ctx.caseRun.finalOutput);
    const hits: string[] = [];
    const misses: string[] = [];
    const ev: EvidenceReference[] = [];
    for (const term of required) {
      const range = findOutputRange(ctx.caseRun.finalOutput, term);
      if (haystack.includes(normalizeText(term))) {
        hits.push(term);
        if (range) ev.push(evidence({ type: 'output_range', outputRange: range, description: `命中关键词「${term}」`, snippet: term }));
      } else {
        misses.push(term);
      }
    }
    const ratio = hits.length / required.length;
    return createDraft(
      containsEvaluator,
      {
        status: statusFromRatio(ratio),
        score: ratio,
        message:
          misses.length === 0
            ? `必需关键词全部命中（${hits.length}/${required.length}）`
            : `缺少关键词 ${misses.length} 个：${misses.join('、')}`,
        details: { required, hits, misses },
        evidence: ev,
      },
      ctx,
    );
  },
};

export const forbiddenContainsEvaluator: Evaluator = {
  key: 'output.not_contains',
  name: '禁止内容',
  version: 'v1',
  kind: 'deterministic',
  category: 'safety',
  description: '输出不得出现 mustNotContain 中的任何内容（合规/策略红线）。',
  severity: 'critical',
  blocking: true,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.mustNotContain.length > 0,
  evaluate(ctx) {
    const forbidden = ctx.testCase.expectedOutcome.mustNotContain;
    const haystack = normalizeText(ctx.caseRun.finalOutput);
    const found = forbidden.filter((term) => haystack.includes(normalizeText(term)));
    const ev: EvidenceReference[] = [];
    for (const term of found) {
      const range = findOutputRange(ctx.caseRun.finalOutput, term);
      ev.push(evidence({ type: 'output_range', outputRange: range ?? undefined, description: `出现禁止内容「${term}」`, snippet: term }));
    }
    return createDraft(
      forbiddenContainsEvaluator,
      {
        status: found.length === 0 ? 'pass' : 'fail',
        score: found.length === 0 ? 1 : 0,
        severity: 'critical',
        blocking: true,
        message: found.length === 0 ? '未出现禁止内容' : `出现禁止内容：${found.join('、')}`,
        details: { forbidden, found },
        evidence: ev,
      },
      ctx,
    );
  },
};

// ═══════════════════════════════════════════════════════════════
// 格式类
// ═══════════════════════════════════════════════════════════════

export const jsonParseEvaluator: Evaluator = {
  key: 'format.json_parse',
  name: 'JSON 可解析',
  version: 'v1',
  kind: 'deterministic',
  category: 'format',
  description: '要求结构化输出时，最终回答必须能被解析为 JSON。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedSchema !== null,
  evaluate(ctx) {
    const missing = missingOutput(ctx);
    if (missing) return createDraft(jsonParseEvaluator, { status: 'fail', message: missing }, ctx);
    const ok = ctx.caseRun.outputJson !== null;
    return createDraft(
      jsonParseEvaluator,
      {
        status: ok ? 'pass' : 'fail',
        score: ok ? 1 : 0,
        message: ok ? '输出可解析为 JSON' : '输出不是合法 JSON（无法进行后续结构校验）',
        details: { preview: ctx.caseRun.finalOutput.slice(0, 200) },
      },
      ctx,
    );
  },
};

export const jsonSchemaEvaluator: Evaluator = {
  key: 'format.json_schema',
  name: 'JSON Schema 校验',
  version: 'v1',
  kind: 'deterministic',
  category: 'format',
  description: '输出 JSON 必须满足 expectedSchema（draft-07 子集：type/required/pattern/enum/…）。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedSchema !== null,
  evaluate(ctx) {
    const schema = ctx.testCase.expectedOutcome.expectedSchema;
    const missing = missingOutput(ctx);
    if (missing) return createDraft(jsonSchemaEvaluator, { status: 'fail', message: missing }, ctx);
    if (!schema) return createDraft(jsonSchemaEvaluator, { status: 'skipped', message: '该用例未定义 expectedSchema' }, ctx);
    if (ctx.caseRun.outputJson === null) {
      return createDraft(jsonSchemaEvaluator, { status: 'fail', score: 0, message: '输出不是合法 JSON，Schema 校验无法进行' }, ctx);
    }
    const result = validateSchemaLite(schema, ctx.caseRun.outputJson);
    return createDraft(
      jsonSchemaEvaluator,
      {
        status: result.valid ? 'pass' : 'fail',
        score: result.valid ? 1 : Math.max(0, 1 - result.errors.length * 0.25),
        message: result.valid ? '输出满足 Schema' : `Schema 校验失败 ${result.errors.length} 项：${result.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('；')}`,
        details: { errors: result.errors, schema },
        evidence: result.errors.map((e) => evidence({ type: 'rule', ruleId: `schema:${e.keyword}`, description: `${e.path} ${e.message}` })),
      },
      ctx,
    );
  },
};

// ═══════════════════════════════════════════════════════════════
// 工具类
// ═══════════════════════════════════════════════════════════════

export const toolCalledEvaluator: Evaluator = {
  key: 'tool.called',
  name: '必须调用的工具',
  version: 'v1',
  kind: 'deterministic',
  category: 'tool',
  description: 'expectedTools 中的每个工具都必须被调用且执行成功。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedTools.length > 0,
  evaluate(ctx) {
    const expected = ctx.testCase.expectedOutcome.expectedTools;
    const called = ctx.toolCalls.filter((c) => c.status === 'ok').map((c) => c.toolName);
    const attempted = ctx.toolCalls.map((c) => c.toolName);
    const missing = expected.filter((name) => !attempted.includes(name));
    const failed = expected.filter((name) => attempted.includes(name) && !called.includes(name));
    const ev = ctx.toolCalls.map((c) => toolCallEvidence(c, `调用 ${c.toolName}（${c.status}）`));
    if (missing.length > 0) {
      return createDraft(
        toolCalledEvaluator,
        {
          status: 'fail',
          score: 0,
          message: `未调用必需工具：${missing.join('、')}`,
          details: { expected, attempted, missing },
          evidence: ev,
        },
        ctx,
      );
    }
    if (failed.length > 0) {
      return createDraft(
        toolCalledEvaluator,
        {
          status: 'partial',
          score: 0.5,
          message: `工具已调用但执行未成功：${failed.join('、')}`,
          details: { expected, attempted, failed },
          evidence: ev,
        },
        ctx,
      );
    }
    return createDraft(
      toolCalledEvaluator,
      { status: 'pass', score: 1, message: `必需工具均已成功调用：${expected.join('、')}`, details: { expected, attempted }, evidence: ev },
      ctx,
    );
  },
};

export const toolNotCalledEvaluator: Evaluator = {
  key: 'tool.not_called',
  name: '禁止调用的工具',
  version: 'v1',
  kind: 'deterministic',
  category: 'safety',
  description: 'forbiddenTools 中的工具绝不允许出现（例如未确认就退款）。',
  severity: 'critical',
  blocking: true,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.forbiddenTools.length > 0,
  evaluate(ctx) {
    const forbidden = ctx.testCase.expectedOutcome.forbiddenTools;
    const violations = ctx.toolCalls.filter((c) => forbidden.includes(c.toolName));
    return createDraft(
      toolNotCalledEvaluator,
      {
        status: violations.length === 0 ? 'pass' : 'fail',
        score: violations.length === 0 ? 1 : 0,
        severity: 'critical',
        blocking: true,
        message:
          violations.length === 0
            ? `未调用禁止工具（${forbidden.join('、')}）`
            : `调用了禁止工具：${violations.map((v) => v.toolName).join('、')}`,
        details: { forbidden, violations: violations.map((v) => ({ toolName: v.toolName, args: v.arguments })) },
        evidence: violations.map((v) => toolCallEvidence(v, `违规调用 ${v.toolName}`)),
      },
      ctx,
    );
  },
};

function compareArg(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'equals':
      return JSON.stringify(actual) === JSON.stringify(expected);
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(expected));
      if (Array.isArray(actual)) return actual.some((v) => JSON.stringify(v) === JSON.stringify(expected));
      return false;
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'matches':
      try {
        return new RegExp(String(expected)).test(String(actual));
      } catch {
        return false;
      }
    case 'oneOf':
      return Array.isArray(expected) ? expected.some((v) => JSON.stringify(v) === JSON.stringify(actual)) : false;
    default:
      return false;
  }
}

export const toolArgumentEvaluator: Evaluator = {
  key: 'tool.arguments',
  name: '工具参数正确性',
  version: 'v1',
  kind: 'deterministic',
  category: 'tool',
  description: '校验 expectedToolArgs 指定的参数路径与期望值（equals / contains / exists / matches / oneOf）。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedToolArgs.length > 0,
  evaluate(ctx) {
    const specs = ctx.testCase.expectedOutcome.expectedToolArgs;
    const results = specs.map((spec) => {
      const calls = ctx.toolCalls.filter((c) => c.toolName === spec.tool);
      if (calls.length === 0) {
        return { spec, ok: false, reason: `未调用 ${spec.tool}`, call: null as (typeof calls)[number] | null, actual: undefined };
      }
      const match = calls.find((c) => compareArg(spec.op, getPath(c.validatedArguments, spec.path), spec.expected));
      const actual = getPath(calls[0]!.validatedArguments, spec.path);
      return {
        spec,
        ok: Boolean(match),
        reason: match ? '参数匹配' : `参数 ${spec.path || '(整体)'} 不满足 ${spec.op}`,
        call: match ?? calls[0]!,
        actual,
      };
    });
    const hit = results.filter((r) => r.ok).length;
    const ratio = hit / results.length;
    const failed = results.filter((r) => !r.ok);
    return createDraft(
      toolArgumentEvaluator,
      {
        status: statusFromRatio(ratio),
        score: ratio,
        message:
          failed.length === 0
            ? `工具参数全部正确（${hit}/${results.length}）`
            : `参数错误 ${failed.length} 项：${failed.map((f) => `${f.spec.tool}.${f.spec.path}（${f.reason}）`).join('；')}`,
        details: {
          checks: results.map((r) => ({
            tool: r.spec.tool,
            path: r.spec.path,
            op: r.spec.op,
            expected: r.spec.expected,
            actual: r.actual,
            ok: r.ok,
          })),
        },
        evidence: failed.map((f) =>
          f.call
            ? toolCallEvidence(f.call, `参数不匹配：${f.spec.tool}.${f.spec.path} 期望 ${JSON.stringify(f.spec.expected)}，实际 ${JSON.stringify(f.actual)}`)
            : evidence({ type: 'rule', ruleId: 'tool.arguments', description: `未调用 ${f.spec.tool}` }),
        ),
      },
      ctx,
    );
  },
};

function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export const toolCallCountEvaluator: Evaluator = {
  key: 'tool.call_count',
  name: '工具调用次数上限',
  version: 'v1',
  kind: 'deterministic',
  category: 'process',
  description: '工具调用总次数不得超过 maxToolCalls。',
  severity: 'minor',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.maxToolCalls !== null,
  evaluate(ctx) {
    const max = ctx.testCase.expectedOutcome.maxToolCalls ?? 0;
    const actual = ctx.toolCalls.length;
    const ok = actual <= max;
    return createDraft(
      toolCallCountEvaluator,
      {
        status: ok ? 'pass' : 'fail',
        score: ok ? 1 : 0,
        message: ok ? `工具调用 ${actual} 次，未超过上限 ${max}` : `工具调用 ${actual} 次，超过上限 ${max}`,
        details: { max, actual, calls: ctx.toolCalls.map((c) => c.toolName) },
        evidence: ctx.toolCalls.map((c) => toolCallEvidence(c, `${c.toolName}`)),
      },
      ctx,
    );
  },
};

export const toolOrderEvaluator: Evaluator = {
  key: 'tool.order',
  name: '工具调用顺序',
  version: 'v1',
  kind: 'deterministic',
  category: 'process',
  description: 'expectedCallOrder 必须作为实际调用序列的子序列出现。',
  severity: 'minor',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.expectedCallOrder.length > 0,
  evaluate(ctx) {
    const expected = ctx.testCase.expectedOutcome.expectedCallOrder;
    const actual = ctx.toolCalls.map((c) => c.toolName);
    let cursor = 0;
    for (const name of actual) {
      if (name === expected[cursor]) cursor += 1;
      if (cursor === expected.length) break;
    }
    const ok = cursor === expected.length;
    return createDraft(
      toolOrderEvaluator,
      {
        status: ok ? 'pass' : 'fail',
        score: ok ? 1 : cursor / expected.length,
        message: ok ? `调用顺序符合期望（${expected.join(' → ')}）` : `调用顺序不符：期望 ${expected.join(' → ')}，实际 ${actual.join(' → ') || '(无调用)'}`,
        details: { expected, actual },
      },
      ctx,
    );
  },
};

export const toolExecutionEvaluator: Evaluator = {
  key: 'tool.execution',
  name: '工具执行健康度',
  version: 'v1',
  kind: 'deterministic',
  category: 'tool',
  description: '任何一次工具调用都不应出现 error / timeout / 参数非法（参数非法=Agent 侧问题）。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.toolCalls.length > 0,
  evaluate(ctx) {
    const bad = ctx.toolCalls.filter((c) => c.status !== 'ok');
    return createDraft(
      toolExecutionEvaluator,
      {
        status: bad.length === 0 ? 'pass' : 'fail',
        score: bad.length === 0 ? 1 : 0,
        message:
          bad.length === 0
            ? `${ctx.toolCalls.length} 次工具调用全部成功`
            : `${bad.length} 次工具调用异常：${bad.map((b) => `${b.toolName}(${b.status}${b.validationError ? '：' + b.validationError : b.error ? '：' + b.error : ''})`).join('；')}`,
        details: { calls: ctx.toolCalls.map((c) => ({ toolName: c.toolName, status: c.status, args: c.arguments })) },
        evidence: bad.map((b) => toolCallEvidence(b, `${b.toolName} 状态 ${b.status}`)),
      },
      ctx,
    );
  },
};

// ═══════════════════════════════════════════════════════════════
// 流程类：循环检测
// ═══════════════════════════════════════════════════════════════

export const loopDetectorEvaluator: Evaluator = {
  key: 'process.loop',
  name: '循环检测',
  version: 'v1',
  kind: 'deterministic',
  category: 'process',
  description: '检测同一工具以相同参数被重复调用、以及 trace 步数异常膨胀。阈值可由 config 覆盖。',
  severity: 'critical',
  blocking: true,
  appliesTo: () => true,
  evaluate(ctx) {
    const repeatThreshold = Number(ctx.config['maxIdenticalToolCalls'] ?? 2);
    const stepLimit = Number(ctx.config['maxSteps'] ?? 12);
    const seen = new Map<string, { count: number; call: (typeof ctx.toolCalls)[number] }>();
    for (const call of ctx.toolCalls) {
      const key = `${call.toolName}:${JSON.stringify(call.arguments)}`;
      const entry = seen.get(key) ?? { count: 0, call };
      entry.count += 1;
      seen.set(key, entry);
    }
    const loops = [...seen.entries()].filter(([, v]) => v.count > repeatThreshold);
    const stepExplosion = ctx.steps.length > stepLimit;
    const runtimeLoop = ctx.bundle?.steps.some((s) => s.type === 'decision' && s.name === 'loop_guard_tripped') ?? false;

    if (loops.length === 0 && !stepExplosion && !runtimeLoop) {
      return createDraft(
        loopDetectorEvaluator,
        {
          status: 'pass',
          score: 1,
          message: `未检测到循环（工具调用 ${ctx.toolCalls.length} 次，trace ${ctx.steps.length} 步）`,
          details: { toolCalls: ctx.toolCalls.length, steps: ctx.steps.length },
        },
        ctx,
      );
    }

    const details: string[] = [];
    const ev: EvidenceReference[] = [];
    if (runtimeLoop) details.push('运行时 loop guard 触发');
    for (const [key, value] of loops) {
      details.push(`${key.split(':')[0]} 以相同参数重复 ${value.count} 次`);
      ev.push(toolCallEvidence(value.call, `重复调用：${key.slice(0, 80)}（${value.count} 次）`));
    }
    if (stepExplosion) details.push(`trace 步数 ${ctx.steps.length} 超过阈值 ${stepLimit}`);
    return createDraft(
      loopDetectorEvaluator,
      {
        status: 'fail',
        score: 0,
        severity: 'critical',
        blocking: true,
        message: `检测到循环：${details.join('；')}`,
        details: { loops: [...seen.entries()].map(([key, v]) => ({ key, count: v.count })), steps: ctx.steps.length },
        evidence: ev,
      },
      ctx,
    );
  },
};

// ═══════════════════════════════════════════════════════════════
// RAG 类
// ═══════════════════════════════════════════════════════════════

export const retrievalHitEvaluator: Evaluator = {
  key: 'rag.hit',
  name: '检索命中',
  version: 'v1',
  kind: 'deterministic',
  category: 'rag',
  description: '期望文档（testCase.metadata.expectedDocIds）必须出现在检索结果中，且命中位置在 Top-K 内。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.expectedDocIds.length > 0,
  evaluate(ctx) {
    const retrieved = ctx.retrievals.flatMap((r) => r.documents.map((d) => ({ id: d.id, rank: d.rank, retrievalId: r.id, stepId: r.stepId, title: d.title })));
    const found = ctx.expectedDocIds.filter((id) => retrieved.some((d) => d.id === id));
    const missing = ctx.expectedDocIds.filter((id) => !found.includes(id));
    const topRank = Math.min(...retrieved.filter((d) => ctx.expectedDocIds.includes(d.id)).map((d) => d.rank), Number.POSITIVE_INFINITY);
    const ratio = found.length / ctx.expectedDocIds.length;
    const ev: EvidenceReference[] = retrieved
      .filter((d) => ctx.expectedDocIds.includes(d.id))
      .map((d) => evidence({ type: 'retrieval', retrievalId: d.retrievalId, traceStepId: d.stepId, description: `命中《${d.title}》(rank ${d.rank})` }));
    return createDraft(
      retrievalHitEvaluator,
      {
        status: statusFromRatio(ratio),
        score: ratio,
        message:
          missing.length === 0
            ? `期望文档全部命中（best rank=${Number.isFinite(topRank) ? topRank : 'n/a'}）`
            : `未召回的期望文档：${missing.join('、')}`,
        details: { expected: ctx.expectedDocIds, retrieved: retrieved.map((d) => ({ id: d.id, rank: d.rank })), found, missing },
        evidence: ev,
      },
      ctx,
    );
  },
};

export const retrievalQualityEvaluator: Evaluator = {
  key: 'rag.recall_at_k',
  name: 'Recall@K / Hit@K',
  version: 'v1',
  kind: 'deterministic',
  category: 'rag',
  description: '按 ground truth 计算 Recall@K 与 Hit@K（无 ground truth 时不适用）。',
  severity: 'minor',
  blocking: false,
  appliesTo: (ctx) => ctx.expectedDocIds.length > 0 && ctx.retrievals.length > 0,
  evaluate(ctx) {
    const k = Number(ctx.config['k'] ?? 3);
    const topK = ctx.retrievals.flatMap((r) => r.documents.filter((d) => d.rank <= k).map((d) => d.id));
    const recall = ctx.expectedDocIds.filter((id) => topK.includes(id)).length / ctx.expectedDocIds.length;
    const hit = ctx.expectedDocIds.some((id) => topK.includes(id)) ? 1 : 0;
    return createDraft(
      retrievalQualityEvaluator,
      {
        status: recall >= 1 ? 'pass' : recall > 0 ? 'partial' : 'fail',
        score: recall,
        message: `Recall@${k}=${recall.toFixed(2)}，Hit@${k}=${hit}`,
        details: { k, recall, hit, expected: ctx.expectedDocIds, retrievedTopK: topK },
      },
      ctx,
    );
  },
};

export const groundednessEvaluator: Evaluator = {
  key: 'rag.groundedness',
  name: '有据可依（Groundedness）',
  version: 'v1',
  kind: 'deterministic',
  category: 'rag',
  description:
    '规则版幻觉检测：抽取回答中的硬事实（数字+单位）与承诺性表述，检查其能否被检索上下文 / 工具输出支持。不依赖 LLM。',
  severity: 'critical',
  blocking: false,
  appliesTo: (ctx) => ctx.retrievals.length > 0 || ctx.toolCalls.length > 0,
  evaluate(ctx) {
    const contextText = [
      ...ctx.retrievals.flatMap((r) => r.selectedChunks),
      ...ctx.retrievals.flatMap((r) => r.documents.map((d) => `${d.title} ${d.selectedChunk}`)),
      ...ctx.toolCalls.map((c) => JSON.stringify(c.outputJson ?? c.outputSummary)),
      ctx.testCase.context,
    ].join('\n');
    const normalizedContext = normalizeText(contextText);

    const sentences = ctx.caseRun.finalOutput
      .split(/(?<=[。！？.!?])|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 6);

    const FACT_RE = /(\d+(?:\.\d+)?)\s*(元|块|天|小时|分钟|个工作日|%|次|件|折)/g;
    const COMMIT_RE = /(承诺|保证|一定|必然|全额|100%|立即|马上|已自动|无条件)/;

    const unsupported: { sentence: string; reason: string }[] = [];
    let claimCount = 0;

    for (const sentence of sentences) {
      const facts = [...sentence.matchAll(FACT_RE)].map((m) => normalizeText(m[0]));
      const commits = [...sentence.matchAll(new RegExp(COMMIT_RE.source, 'g'))].map((m) => m[0]);
      if (facts.length === 0 && commits.length === 0) continue;
      claimCount += 1;

      const missingFacts = facts.filter((f) => !normalizedContext.includes(f));
      const missingCommits = commits.filter((c) => !normalizedContext.includes(normalizeText(c)));

      if (missingFacts.length > 0) {
        unsupported.push({ sentence, reason: `数字/单位「${missingFacts.join('、')}」在检索上下文与工具输出中均无出处` });
      } else if (missingCommits.length > 0) {
        unsupported.push({ sentence, reason: `承诺性表述「${missingCommits.join('、')}」无上下文依据` });
      }
    }

    if (claimCount === 0) {
      return createDraft(
        groundednessEvaluator,
        {
          status: 'pass',
          score: 1,
          message: '回答中未检测到需要外部证据支撑的硬事实断言',
          details: { sentences: sentences.length, claims: 0 },
        },
        ctx,
      );
    }

    const supported = claimCount - unsupported.length;
    const score = supported / claimCount;
    return createDraft(
      groundednessEvaluator,
      {
        status: score >= 1 ? 'pass' : score >= 0.6 ? 'partial' : 'fail',
        score,
        severity: unsupported.length > 0 ? 'critical' : 'info',
        message:
          unsupported.length === 0
            ? `${claimCount} 条硬事实断言均可在上下文中找到依据`
            : `${unsupported.length}/${claimCount} 条断言缺乏依据：${unsupported[0]!.sentence.slice(0, 60)}…`,
        details: { claims: claimCount, supported, unsupported },
        evidence: unsupported.map((u) =>
          evidence({
            type: 'output_range',
            outputRange: findOutputRange(ctx.caseRun.finalOutput, u.sentence) ?? undefined,
            description: u.reason,
            snippet: u.sentence.slice(0, 200),
          }),
        ),
      },
      ctx,
    );
  },
};

// ═══════════════════════════════════════════════════════════════
// 自定义规则 / 性能
// ═══════════════════════════════════════════════════════════════

export const customRuleEvaluator: Evaluator = {
  key: 'custom.rules',
  name: '自定义规则',
  version: 'v1',
  kind: 'deterministic',
  category: 'output',
  description: '执行用例自定义规则：contains / not_contains / regex / json_path_equals / json_path_exists。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => ctx.testCase.expectedOutcome.customRules.length > 0,
  evaluate(ctx) {
    const rules = ctx.testCase.expectedOutcome.customRules;
    const results = rules.map((rule) => {
      const target = rule.target === 'final_json' ? JSON.stringify(ctx.caseRun.outputJson ?? {}) : ctx.caseRun.finalOutput;
      switch (rule.kind) {
        case 'contains':
          return { rule, ok: normalizeText(target).includes(normalizeText(rule.value)) };
        case 'not_contains':
          return { rule, ok: !normalizeText(target).includes(normalizeText(rule.value)) };
        case 'regex':
          try {
            return { rule, ok: new RegExp(rule.value).test(target) };
          } catch {
            return { rule, ok: false, error: `正则非法：${rule.value}` };
          }
        case 'json_path_equals': {
          const actual = getPath(ctx.caseRun.outputJson, rule.path ?? '');
          return { rule, ok: JSON.stringify(actual) === JSON.stringify(rule.value) };
        }
        case 'json_path_exists': {
          const actual = getPath(ctx.caseRun.outputJson, rule.path ?? '');
          return { rule, ok: actual !== undefined && actual !== null && actual !== '' };
        }
        default:
          return { rule, ok: false };
      }
    });
    const hit = results.filter((r) => r.ok).length;
    const ratio = hit / results.length;
    const failed = results.filter((r) => !r.ok);
    return createDraft(
      customRuleEvaluator,
      {
        status: statusFromRatio(ratio),
        score: ratio,
        message:
          failed.length === 0
            ? `自定义规则全部通过（${hit}/${results.length}）`
            : `自定义规则失败 ${failed.length} 项：${failed.map((f) => f.rule.description || f.rule.id).join('、')}`,
        details: { results: results.map((r) => ({ id: r.rule.id, kind: r.rule.kind, ok: r.ok })) },
        evidence: failed.map((f) => evidence({ type: 'rule', ruleId: f.rule.id, description: f.rule.description || `${f.rule.kind} 未满足` })),
      },
      ctx,
    );
  },
};

export const latencyEvaluator: Evaluator = {
  key: 'performance.latency',
  name: '延迟预算',
  version: 'v1',
  kind: 'deterministic',
  category: 'performance',
  description: '单用例总耗时不得超过阈值（config.maxLatencyMs，或用例 metadata.maxLatencyMs，默认 8000ms）。',
  severity: 'minor',
  blocking: false,
  appliesTo: () => true,
  evaluate(ctx) {
    const threshold = Number(ctx.config['maxLatencyMs'] ?? ctx.testCase.metadata['maxLatencyMs'] ?? 8000);
    const actual = ctx.caseRun.latencyMs;
    const ratio = actual <= threshold ? 1 : Math.max(0, threshold / actual);
    return createDraft(
      latencyEvaluator,
      {
        status: actual <= threshold ? 'pass' : 'fail',
        score: ratio,
        message: `耗时 ${actual}ms（阈值 ${threshold}ms）`,
        details: { threshold, actual, modelLatencyMs: ctx.caseRun.modelLatencyMs, toolLatencyMs: ctx.caseRun.toolLatencyMs, retrievalLatencyMs: ctx.caseRun.retrievalLatencyMs },
      },
      ctx,
    );
  },
};

export const costEvaluator: Evaluator = {
  key: 'performance.cost',
  name: '成本预算',
  version: 'v1',
  kind: 'deterministic',
  category: 'performance',
  description: '单用例成本不得超过 config.maxCostUsd。成本未知（无价目表）时判 skipped 并说明，不伪造通过。',
  severity: 'minor',
  blocking: false,
  appliesTo: (ctx) => ctx.config['maxCostUsd'] !== undefined,
  evaluate(ctx) {
    const threshold = Number(ctx.config['maxCostUsd']);
    const actual = ctx.caseRun.usage.costUsd;
    if (actual === null) {
      return createDraft(
        costEvaluator,
        { status: 'skipped', message: '成本未知（provider 未提供价目表），无法进行成本判断', details: { threshold, costSource: ctx.caseRun.usage.costSource } },
        ctx,
      );
    }
    return createDraft(
      costEvaluator,
      {
        status: actual <= threshold ? 'pass' : 'fail',
        score: actual <= threshold ? 1 : Math.max(0, threshold / actual),
        message: `成本 $${actual}（阈值 $${threshold}）`,
        details: { threshold, actual },
      },
      ctx,
    );
  },
};

/** 失败分类对应的兜底 evaluator（把 FailureClassifier 的结论也纳入评测结果表，便于聚合） */
export const classificationEvaluator: Evaluator = {
  key: 'process.classification',
  name: '期望分类',
  version: 'v1',
  kind: 'deterministic',
  category: 'output',
  description: '输出中的分类字段必须等于 expectedClassification。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => Boolean(ctx.testCase.expectedOutcome.expectedClassification),
  evaluate(ctx) {
    const expected = ctx.testCase.expectedOutcome.expectedClassification ?? '';
    const json = ctx.caseRun.outputJson as Record<string, unknown> | null;
    const actual = json && typeof json === 'object' ? String(json['classification'] ?? json['category'] ?? '') : '';
    const ok = normalizeText(actual) === normalizeText(expected);
    return createDraft(
      classificationEvaluator,
      {
        status: ok ? 'pass' : 'fail',
        score: ok ? 1 : 0,
        message: ok ? `分类正确（${expected}）` : `分类不符：期望 ${expected}，实际 ${actual || '(缺失)'}`,
        details: { expected, actual },
      },
      ctx,
    );
  },
};

export const BUILTIN_EVALUATORS: Evaluator[] = [
  exactMatchEvaluator,
  containsEvaluator,
  forbiddenContainsEvaluator,
  jsonParseEvaluator,
  jsonSchemaEvaluator,
  toolCalledEvaluator,
  toolNotCalledEvaluator,
  toolArgumentEvaluator,
  toolCallCountEvaluator,
  toolOrderEvaluator,
  toolExecutionEvaluator,
  loopDetectorEvaluator,
  retrievalHitEvaluator,
  retrievalQualityEvaluator,
  groundednessEvaluator,
  customRuleEvaluator,
  latencyEvaluator,
  costEvaluator,
  classificationEvaluator,
];

export function evaluatorByKey(key: string): Evaluator | undefined {
  return BUILTIN_EVALUATORS.find((e) => e.key === key);
}

export function describeEvaluators(): EvaluatorDescriptor[] {
  return BUILTIN_EVALUATORS.map((e) => ({
    key: e.key,
    name: e.name,
    kind: e.kind,
    category: e.category,
    version: e.version,
    description: e.description,
    configSchema: {},
    isBuiltin: true,
  }));
}

export function defaultSeverityForCategory(category: Evaluator['category']): Evaluator['severity'] {
  switch (category) {
    case 'safety':
      return 'critical';
    case 'process':
      return 'major';
    default:
      return FAILURE_TAXONOMY.unknown.defaultSeverity === 'minor' ? 'major' : 'major';
  }
}
