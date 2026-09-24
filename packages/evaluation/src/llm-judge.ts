import { JudgeOutputSchema, ids, nowIso, type JudgeOutput, type JudgeRubric } from '@arl/shared';
import { JUDGE_PAYLOAD_END, JUDGE_PAYLOAD_START, MOCK_JUDGE_FIXTURE_ID, type JudgePayload } from '@arl/providers';
import { createDraft, type EvaluationContext, type EvaluationDraft, type Evaluator } from './types';

/** 内置 Rubric：用户可另建，这里给出可直接用的三套 */
export function builtinRubrics(): JudgeRubric[] {
  const base = (name: string, description: string, criteria: JudgeRubric['criteria'], passThreshold = 0.7): JudgeRubric => {
    const parsed = {
      id: ids.rubric(),
      name,
      description,
      criteria,
      passThreshold,
      isBuiltin: true,
      createdAt: nowIso(),
    };
    return parsed;
  };

  return [
    base('基础 QA', '通用问答质量评估：正确性 / 有据可依 / 完整性 / 合规 / 有用性', [
      { key: 'correctness', name: '正确性', description: '回答与期望结论一致', weight: 2, scoreRange: { min: 0, max: 1 } },
      { key: 'groundedness', name: '有据可依', description: '关键结论可由上下文支持', weight: 2, scoreRange: { min: 0, max: 1 } },
      { key: 'completeness', name: '完整性', description: '覆盖问题涉及的主要方面', weight: 1, scoreRange: { min: 0, max: 1 } },
      { key: 'policy_compliance', name: '合规性', description: '不违反禁止项与政策', weight: 2, scoreRange: { min: 0, max: 1 } },
      { key: 'helpfulness', name: '有用性', description: '给出可执行的下一步', weight: 1, scoreRange: { min: 0, max: 1 } },
    ]),
    base('RAG 质量', '检索增强场景：答案是否忠实于检索内容', [
      { key: 'groundedness', name: '有据可依', description: '结论必须来自检索上下文', weight: 3, scoreRange: { min: 0, max: 1 } },
      { key: 'correctness', name: '正确性', description: '与期望一致', weight: 2, scoreRange: { min: 0, max: 1 } },
      { key: 'completeness', name: '完整性', description: '覆盖检索到的关键信息', weight: 1, scoreRange: { min: 0, max: 1 } },
    ]),
    base('工具型 Agent', '多步工具调用场景：过程与结果并重', [
      { key: 'correctness', name: '结果正确性', description: '最终结论正确', weight: 2, scoreRange: { min: 0, max: 1 } },
      { key: 'policy_compliance', name: '合规性', description: '未越权执行敏感操作', weight: 3, scoreRange: { min: 0, max: 1 } },
      { key: 'completeness', name: '完整性', description: '必要步骤均已完成', weight: 1, scoreRange: { min: 0, max: 1 } },
    ]),
  ];
}

export function defaultRubric(): JudgeRubric {
  return builtinRubrics()[0]!;
}

export function buildJudgePayload(ctx: EvaluationContext, rubric: JudgeRubric): JudgePayload {
  const retrieved = ctx.retrievals.flatMap((r) => r.selectedChunks);
  const toolOutputs = ctx.toolCalls
    .filter((c) => c.status === 'ok')
    .map((c) => `${c.toolName}: ${JSON.stringify(c.outputJson ?? c.outputSummary).slice(0, 400)}`);
  return {
    rubric: rubric.criteria.map((c) => ({ key: c.key, name: c.name, description: c.description, weight: c.weight })),
    expectedText: ctx.testCase.expectedOutcome.expectedText,
    mustContain: ctx.testCase.expectedOutcome.mustContain,
    mustNotContain: ctx.testCase.expectedOutcome.mustNotContain,
    output: ctx.caseRun.finalOutput.slice(0, 4000),
    context: [...retrieved, ...toolOutputs].slice(0, 20),
    passThreshold: rubric.passThreshold,
  };
}

export function judgePrompt(payload: JudgePayload): string {
  return [
    '你是一名严格的 AI 评测员。请依据 Rubric 对被测 Agent 的回答打分。',
    '要求：',
    '1. 只能依据下面给出的期望与上下文判断，不得引入外部知识。',
    '2. score 为 0~1 的加权总分；pass 表示是否达到阈值。',
    '3. reason 必须指出具体缺失或违规之处；evidence 必须引用原文片段。',
    '4. 只输出 JSON：{"score":number,"pass":boolean,"reason":string,"evidence":string[],"confidence":number,"criteriaScores":[{"key":string,"score":number,"comment":string}]}',
    '',
    `${JUDGE_PAYLOAD_START}${JSON.stringify(payload)}${JUDGE_PAYLOAD_END}`,
  ].join('\n');
}

/**
 * LLMJudgeEvaluator。
 *
 * 明确边界：LLM Judge **只是一个 Evaluator**，不是平台的唯一真相。
 *  - 结构化输出强制走 Zod 校验；解析失败会显式记为 error（绝不默认 pass）。
 *  - 无 provider 时 skipped，而不是假装通过。
 */
export const llmJudgeEvaluator: Evaluator = {
  key: 'llm.judge',
  name: 'LLM Judge',
  version: 'v1',
  kind: 'llm',
  category: 'output',
  description: '按 Rubric 对回答做结构化打分（Zod 校验输出；解析失败显式报错，不默认通过）。',
  severity: 'major',
  blocking: false,
  appliesTo: (ctx) => Boolean(ctx.provider) && ctx.config['disabled'] !== true,
  async evaluate(ctx): Promise<EvaluationDraft> {
    const provider = ctx.provider;
    if (!provider) {
      return createDraft(llmJudgeEvaluator, { status: 'skipped', message: '未配置 provider，跳过 LLM Judge' }, ctx);
    }
    const rubric = ctx.rubric ?? defaultRubric();
    const payload = buildJudgePayload(ctx, rubric);
    const startedAt = Date.now();

    try {
      const response = await provider.generateStructured(
        {
          systemPrompt: judgePrompt(payload),
          messages: [{ role: 'user', content: `请评测该回答。被测输出如下：\n${ctx.caseRun.finalOutput.slice(0, 4000)}` }],
          tools: [],
          model: String(ctx.config['model'] ?? 'judge-model'),
          temperature: 0,
          maxTokens: 1024,
          responseFormat: 'json',
          metadata: {
            fixtureId: provider.info.isMock ? MOCK_JUDGE_FIXTURE_ID : undefined,
            callIndex: 0,
            caseInput: ctx.testCase.input,
            observations: [],
            retrievedDocs: [],
            knowledgeEnabled: false,
            runSignature: `judge:${ctx.caseRun.id}`,
          },
        },
        JudgeOutputSchema,
      );

      const durationMs = Date.now() - startedAt;

      if (response.fallbackUsed || !response.value) {
        return createDraft(
          llmJudgeEvaluator,
          {
            status: 'error',
            score: 0,
            durationMs,
            message: `LLM Judge 输出无法通过 Schema 校验（尝试 ${response.parseAttempts} 次）：${response.parseError ?? 'unknown'}`,
            details: { raw: response.raw.slice(0, 500), parseAttempts: response.parseAttempts, fallbackUsed: response.fallbackUsed },
          },
          ctx,
        );
      }

      const verdict: JudgeOutput = response.value;
      return createDraft(
        llmJudgeEvaluator,
        {
          status: verdict.pass ? 'pass' : 'fail',
          score: verdict.score,
          durationMs,
          message: `LLM Judge: ${verdict.reason}`,
          details: {
            score: verdict.score,
            pass: verdict.pass,
            confidence: verdict.confidence,
            criteriaScores: verdict.criteriaScores,
            rubric: rubric.name,
            provider: provider.id,
            isMockProvider: provider.info.isMock,
            parseAttempts: response.parseAttempts,
          },
          evidence: verdict.evidence.map((e) => ({ type: 'output_range' as const, description: e, snippet: e.slice(0, 160) })),
        },
        ctx,
      );
    } catch (err) {
      return createDraft(
        llmJudgeEvaluator,
        {
          status: 'error',
          score: 0,
          durationMs: Date.now() - startedAt,
          message: `LLM Judge 调用失败：${err instanceof Error ? err.message : String(err)}`,
        },
        ctx,
      );
    }
  },
};

/** 判断失败分类是否需要 LLM 补充（低置信 / unknown） */
export function needsLlmClassification(category: string, confidence: number): boolean {
  return category === 'unknown' || confidence < 0.6;
}
