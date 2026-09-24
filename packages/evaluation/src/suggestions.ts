import {
  FAILURE_TAXONOMY,
  type CaseRun,
  type EvaluationResult,
  type EvidenceReference,
  type Failure,
  type FailureCategory,
  type OptimizationSuggestion,
  type PromptCandidate,
  type PromptVersion,
  type RetrievalEvent,
  type TestCase,
  type ToolCall,
} from '@arl/shared';

export interface SuggestionInput {
  runId: string;
  agentId: string;
  agentVersionId: string;
  prompt: PromptVersion;
  caseRuns: CaseRun[];
  results: EvaluationResult[];
  failures: Failure[];
  testCases: Map<string, TestCase>;
  toolCallsByCase: Map<string, ToolCall[]>;
  retrievalsByCase: Map<string, RetrievalEvent[]>;
}

export type SuggestionDraft = Omit<OptimizationSuggestion, 'id' | 'createdAt'>;

function count<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

/**
 * 优化建议引擎（P1 能力的规则化实现）。
 *
 * 铁律：**每条建议都必须能被核对**。
 * 输出形如「12/18 个失败 case 在调用 getOrder 时缺少 orderId」，
 * 而不是「建议优化 Prompt」这种毫无信息量的话。
 */
export function generateSuggestions(input: SuggestionInput): SuggestionDraft[] {
  const suggestions: SuggestionDraft[] = [];
  const totalCases = input.caseRuns.length;
  const failureCases = input.caseRuns.filter((c) => c.status !== 'passed');
  const byCategory = new Map<FailureCategory, Failure[]>();
  for (const failure of input.failures) {
    const list = byCategory.get(failure.category) ?? [];
    list.push(failure);
    byCategory.set(failure.category, list);
  }

  const caseName = (caseRunId: string): string =>
    input.caseRuns.find((c) => c.id === caseRunId)?.testCaseName ?? caseRunId;

  const make = (
    category: SuggestionDraft['category'],
    title: string,
    detail: string,
    evidence: EvidenceReference[],
    affected: string[],
    impact: SuggestionDraft['impact'],
    confidence: number,
  ): SuggestionDraft => ({
    runId: input.runId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    category,
    title,
    detail,
    evidence,
    affectedCases: affected,
    impact,
    confidence,
    generator: 'rule',
    status: 'new',
  });

  // ── 1) 工具参数错误聚类 ───────────────────────────────────────
  const argFailures = byCategory.get('tool_argument_failure') ?? [];
  if (argFailures.length > 0) {
    const pathCounter = new Map<string, number>();
    const toolCounter = new Map<string, number>();
    for (const failure of argFailures) {
      const calls = input.toolCallsByCase.get(failure.caseRunId) ?? [];
      for (const call of calls) {
        if (call.status === 'invalid_arguments' || call.validationError) {
          toolCounter.set(call.toolName, (toolCounter.get(call.toolName) ?? 0) + 1);
          const missing = (call.arguments ? Object.entries(call.arguments) : [])
            .filter(([, v]) => v === '' || v === null || v === undefined)
            .map(([k]) => k);
          for (const key of missing) pathCounter.set(`${call.toolName}.${key}`, (pathCounter.get(`${call.toolName}.${key}`) ?? 0) + 1);
        }
      }
    }
    const topPath = [...pathCounter.entries()].sort((a, b) => b[1] - a[1])[0];
    const topTool = [...toolCounter.entries()].sort((a, b) => b[1] - a[1])[0];
    suggestions.push(
      make(
        'tool',
        topPath
          ? `${argFailures.length}/${totalCases} 个失败 case 在调用 ${topTool?.[0] ?? ''} 时缺少 ${topPath[0].split('.')[1]}`
          : `${argFailures.length}/${totalCases} 个 case 出现工具参数错误`,
        [
          'Agent 在参数抽取环节失败：典型表现是必填参数为空字符串或类型不符，导致工具在 schema 校验阶段就被拒绝。',
          topPath
            ? `建议：在任务 Prompt 中显式要求"调用 ${topTool?.[0]} 前必须先从用户问题中抽取 ${topPath[0].split('.')[1]}，抽不到则向用户追问，不要以空值调用"。`
            : '建议：补充参数抽取规则或增加参数校验前置步骤。',
        ].join('\n'),
        argFailures.slice(0, 5).flatMap((f) => [
          { type: 'case' as const, description: caseName(f.caseRunId) },
          ...f.evidence.slice(0, 2),
        ]),
        argFailures.map((f) => f.caseRunId),
        'high',
        0.9,
      ),
    );
  }

  // ── 2) 工具选择错误聚类 ───────────────────────────────────────
  const selectionFailures = byCategory.get('tool_selection_failure') ?? [];
  if (selectionFailures.length > 0) {
    const expectedMissing = new Map<string, number>();
    const wronglyCalled = new Map<string, number>();
    for (const failure of selectionFailures) {
      const testCase = input.testCases.get(input.caseRuns.find((c) => c.id === failure.caseRunId)?.testCaseId ?? '');
      const calls = input.toolCallsByCase.get(failure.caseRunId) ?? [];
      const calledNames = calls.map((c) => c.toolName);
      for (const expected of testCase?.expectedOutcome.expectedTools ?? []) {
        if (!calledNames.includes(expected)) expectedMissing.set(expected, (expectedMissing.get(expected) ?? 0) + 1);
      }
      for (const name of calledNames) {
        if (!(testCase?.expectedOutcome.expectedTools ?? []).includes(name)) {
          wronglyCalled.set(name, (wronglyCalled.get(name) ?? 0) + 1);
        }
      }
    }
    const missTop = [...expectedMissing.entries()].sort((a, b) => b[1] - a[1])[0];
    const wrongTop = [...wronglyCalled.entries()].sort((a, b) => b[1] - a[1])[0];
    suggestions.push(
      make(
        'prompt',
        `工具选择错误：${selectionFailures.length} 个 case（${missTop ? `漏调 ${missTop[0]} ${missTop[1]} 次` : ''}${
          wrongTop ? `${missTop ? '，' : ''}误调 ${wrongTop[0]} ${wrongTop[1]} 次` : ''
        }）`,
        [
          missTop ? `当问题涉及相关意图时，Agent 没有调用 ${missTop[0]}。` : '',
          wrongTop ? `Agent 倾向调用 ${wrongTop[0]}，但该工具与问题意图不匹配。` : '',
          '建议：在 Prompt 中加入工具选择决策表（意图 → 工具），并给出 1~2 个反例说明什么时候**不要**调用某工具。',
        ]
          .filter(Boolean)
          .join('\n'),
        selectionFailures.slice(0, 5).flatMap((f) => [
          { type: 'case' as const, description: caseName(f.caseRunId) },
          ...f.evidence.slice(0, 2),
        ]),
        selectionFailures.map((f) => f.caseRunId),
        'high',
        0.88,
      ),
    );
  }

  // ── 3) 格式失败 ───────────────────────────────────────────────
  const formatFailures = byCategory.get('format_failure') ?? [];
  if (formatFailures.length > 0) {
    const needsSchema = input.caseRuns.filter((c) => {
      const testCase = input.testCases.get(c.testCaseId);
      return Boolean(testCase?.expectedOutcome.expectedSchema);
    }).length;
    suggestions.push(
      make(
        'prompt',
        `${formatFailures.length}/${needsSchema || totalCases} 个用例未按结构化格式输出`,
        [
          'Agent 输出为自然语言散文，未满足 expectedSchema，导致后续结构化校验与下游系统无法消费。',
          '建议：在 system prompt 中给出**完整 JSON 示例**（含字段名与类型），并明确"只输出 JSON，不要解释文字"。',
        ].join('\n'),
        formatFailures.slice(0, 5).map((f) => ({ type: 'case' as const, description: caseName(f.caseRunId) })),
        formatFailures.map((f) => f.caseRunId),
        'medium',
        0.85,
      ),
    );
  }

  // ── 4) 检索失败 ───────────────────────────────────────────────
  const retrievalFailures = byCategory.get('retrieval_failure') ?? [];
  if (retrievalFailures.length > 0) {
    const emptyRetrievals = count(retrievalFailures, (f) => {
      const events = input.retrievalsByCase.get(f.caseRunId) ?? [];
      return events.length === 0 || events.every((e) => e.documents.length === 0);
    });
    suggestions.push(
      make(
        'rag',
        `检索未命中：${retrievalFailures.length} 个失败 case${emptyRetrievals > 0 ? `（其中 ${emptyRetrievals} 个完全无召回）` : ''}`,
        [
          emptyRetrievals > 0
            ? '部分用例的检索结果为空：可能是查询改写把关键词冲掉了，或知识库缺少对应文档。'
            : '存在召回但排位靠后：期望文档未进入 Top-K。',
          '建议：检查查询改写规则（是否保留业务名词）、提高 topK 或降低 scoreThreshold，并确认知识库覆盖这些主题。',
        ].join('\n'),
        retrievalFailures.slice(0, 5).flatMap((f) => {
          const events = input.retrievalsByCase.get(f.caseRunId) ?? [];
          return [
            { type: 'case' as const, description: caseName(f.caseRunId) },
            ...events.slice(0, 1).map((e) => ({
              type: 'retrieval' as const,
              retrievalId: e.id,
              description: `query="${e.query}" → 命中 ${e.documents.length} 条`,
            })),
          ];
        }),
        retrievalFailures.map((f) => f.caseRunId),
        'high',
        0.87,
      ),
    );
  }

  // ── 5) 幻觉 ───────────────────────────────────────────────────
  const hallucinations = byCategory.get('hallucination') ?? [];
  if (hallucinations.length > 0) {
    const sample = hallucinations[0]!;
    suggestions.push(
      make(
        'guardrail',
        `检测到 ${hallucinations.length} 个 case 出现无依据断言（幻觉）`,
        [
          '回答中包含检索上下文与工具输出都不支持的数字/承诺（例如具体赔偿金额、承诺时限）。',
          `示例证据：${sample.evidence[0]?.snippet?.slice(0, 80) ?? sample.explanation.slice(0, 80)}`,
          '建议：① 在 Prompt 中加硬约束"只能引用 [RETRIEVED_CONTEXT] 中的事实，不得编造金额与时限"；② 增加输出侧 guardrail 校验。',
        ].join('\n'),
        hallucinations.slice(0, 5).flatMap((f) => [{ type: 'case' as const, description: caseName(f.caseRunId) }, ...f.evidence.slice(0, 2)]),
        hallucinations.map((f) => f.caseRunId),
        'high',
        0.9,
      ),
    );
  }

  // ── 6) 循环 ───────────────────────────────────────────────────
  const loops = byCategory.get('loop') ?? [];
  if (loops.length > 0) {
    const repeated = loops.flatMap((f) => (input.toolCallsByCase.get(f.caseRunId) ?? []).map((c) => c.toolName));
    const topRepeated = [...new Set(repeated)].join('、');
    suggestions.push(
      make(
        'runtime',
        `${loops.length} 个 case 陷入工具调用循环${topRepeated ? `（涉及：${topRepeated}）` : ''}`,
        [
          'Agent 以相同参数反复调用同一工具，直到运行时 loop guard 终止。',
          '建议：缩短 maxSteps、在 Prompt 中要求"同一工具同一参数不要重复调用"，并检查工具是否返回了让模型无法判断的模糊结果。',
        ].join('\n'),
        loops.slice(0, 5).map((f) => ({ type: 'case' as const, description: caseName(f.caseRunId) })),
        loops.map((f) => f.caseRunId),
        'high',
        0.93,
      ),
    );
  }

  // ── 7) 策略违规 ───────────────────────────────────────────────
  const policyFailures = byCategory.get('policy_failure') ?? [];
  if (policyFailures.length > 0) {
    suggestions.push(
      make(
        'guardrail',
        `${policyFailures.length} 个 case 触发策略红线`,
        [
          '包括调用禁止工具或在输出中出现禁止内容。',
          '建议：把红线写进 system prompt 的"禁止事项"段落，并在运行时增加工具级准入校验（例如退款工具要求 confirmed=true）。',
        ].join('\n'),
        policyFailures.slice(0, 5).flatMap((f) => [{ type: 'case' as const, description: caseName(f.caseRunId) }, ...f.evidence.slice(0, 2)]),
        policyFailures.map((f) => f.caseRunId),
        'high',
        0.95,
      ),
    );
  }

  // ── 8) 答案内容缺项 ───────────────────────────────────────────
  const wrongAnswers = [...(byCategory.get('wrong_answer') ?? []), ...(byCategory.get('partial_completion') ?? [])];
  if (wrongAnswers.length > 0) {
    const missingTerms = new Map<string, number>();
    for (const failure of wrongAnswers) {
      const containsResult = input.results.find((r) => r.caseRunId === failure.caseRunId && r.evaluatorKey === 'output.contains');
      const details = (containsResult?.details ?? {}) as { misses?: unknown };
      const misses = Array.isArray(details.misses) ? (details.misses as string[]) : [];
      for (const term of misses) missingTerms.set(term, (missingTerms.get(term) ?? 0) + 1);
    }
    const topMisses = [...missingTerms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    suggestions.push(
      make(
        'dataset',
        `${wrongAnswers.length} 个 case 答案内容不达期望${topMisses.length > 0 ? `（高频缺失：${topMisses.map(([t, n]) => `${t}×${n}`).join('、')}）` : ''}`,
        [
          topMisses.length > 0
            ? `这些关键词在期望中被要求出现，但回答里没有：${topMisses.map(([t]) => t).join('、')}。`
            : '回答与期望存在差异，但未定位到单一缺失项。',
          '建议：先确认这些期望是否合理（是否需要 Agent 主动说明），再决定是改 Prompt（要求覆盖这些要点）还是改数据集（放宽期望）。',
        ].join('\n'),
        wrongAnswers.slice(0, 5).map((f) => ({ type: 'case' as const, description: caseName(f.caseRunId) })),
        wrongAnswers.map((f) => f.caseRunId),
        'medium',
        0.7,
      ),
    );
  }

  // ── 9) 覆盖率提示（数据集质量问题）────────────────────────────
  const unchecked = input.caseRuns.filter(
    (c) => !input.results.some((r) => r.caseRunId === c.id && r.status !== 'skipped'),
  );
  if (unchecked.length > 0) {
    suggestions.push(
      make(
        'dataset',
        `${unchecked.length} 个 case 没有任何有效检查项`,
        [
          '这些用例缺少 expectedOutcome 的判定字段，等于"跑了但没评测"，会虚高通过率。',
          '建议：为这些用例补充 mustContain / expectedTools / expectedSchema 中至少一项。',
        ].join('\n'),
        unchecked.slice(0, 10).map((c) => ({ type: 'case' as const, description: c.testCaseName })),
        unchecked.map((c) => c.id),
        'high',
        0.99,
      ),
    );
  }

  return suggestions;
}

/** 由建议生成 Prompt 候选（P1）。绝不自动覆盖生产 Prompt。 */
export function buildPromptCandidate(
  prompt: PromptVersion,
  agentId: string,
  suggestions: SuggestionDraft[],
): Omit<PromptCandidate, 'id' | 'createdAt'> | null {
  const promptSuggestions = suggestions.filter((s) => s.category === 'prompt' || s.category === 'guardrail');
  if (promptSuggestions.length === 0) return null;

  const additions = promptSuggestions
    .map((s, index) => `# 约束 ${index + 1}（来自评测证据：${s.affectedCases.length} 个失败用例）\n- ${s.detail.split('\n').pop() ?? s.title}`)
    .join('\n\n');

  return {
    agentId,
    basePromptVersionId: prompt.id,
    systemPrompt: `${prompt.systemPrompt}\n\n${additions}`,
    taskPromptTemplate: prompt.taskPromptTemplate,
    rationale: `基于本次评测的 ${promptSuggestions.length} 条规则化建议生成候选 Prompt。原始失败用例：${promptSuggestions.flatMap((s) => s.affectedCases).length} 个。**该候选不会被自动采用**，需人工确认后创建新的 Prompt Version。`,
    evidence: promptSuggestions.flatMap((s) => s.evidence.slice(0, 3)),
    status: 'proposed',
    adoptedPromptVersionId: null,
  };
}

export function suggestionCategoryLabel(category: string): string {
  switch (category) {
    case 'prompt':
      return '提示词';
    case 'tool':
      return '工具';
    case 'rag':
      return '检索';
    case 'runtime':
      return '运行时';
    case 'dataset':
      return '数据集';
    case 'guardrail':
      return '护栏';
    default:
      return category;
  }
}

export { FAILURE_TAXONOMY };
