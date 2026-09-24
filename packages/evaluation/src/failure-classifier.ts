import { FAILURE_TAXONOMY, type CaseRun, type EvidenceReference, type FailureCategory, type RetrievalEvent, type TestCase, type ToolCall, type TraceStep } from '@arl/shared';
import { normalizeText, type EvaluationDraft } from './types';

export interface ClassificationInput {
  caseRun: CaseRun;
  testCase: TestCase;
  results: (EvaluationDraft | { evaluatorKey: string; status: string; message: string; evidence: EvidenceReference[] })[];
  toolCalls: ToolCall[];
  retrievals: RetrievalEvent[];
  steps: TraceStep[];
  /** trace 里是否出现过 runtime loop guard */
  loopGuarded?: boolean;
}

export interface FailureClassification {
  category: FailureCategory;
  confidence: number;
  source: 'rule' | 'llm' | 'hybrid';
  explanation: string;
  evidence: EvidenceReference[];
}

function resultOf(input: ClassificationInput, key: string): (ClassificationInput['results'][number]) | undefined {
  return input.results.find((r) => r.evaluatorKey === key);
}

function failed(input: ClassificationInput, key: string): boolean {
  const r = resultOf(input, key);
  return r?.status === 'fail' || r?.status === 'partial';
}

function hardFailed(input: ClassificationInput, key: string): boolean {
  return resultOf(input, key)?.status === 'fail';
}

/**
 * Failure Classifier（确定性优先）。
 *
 * 判定顺序刻意设计成「证据强度递减」：先看硬性事实（超时/循环/违规调用），
 * 再看结构性事实（工具/格式/检索），最后才落到来回答质量类判断。
 * 只有规则无法定论时（unknown / 低置信），才允许调用 LLM 分类器作为补充。
 */
export function classifyFailure(input: ClassificationInput): FailureClassification | null {
  const { caseRun, testCase } = input;
  const verdict = caseRun.status;
  if (verdict === 'passed') return null;

  const evidence: EvidenceReference[] = [];
  const addEvidence = (...items: EvidenceReference[]) => evidence.push(...items);
  const failing = (key: string) => resultOf(input, key)?.evidence ?? [];
  const explain = (key: string): string => resultOf(input, key)?.message ?? '';

  // 1) 超时
  if (verdict === 'timeout' || caseRun.error?.includes('超时')) {
    return {
      category: 'timeout',
      confidence: 0.98,
      source: 'rule',
      explanation: caseRun.error ?? `用例超出时间预算（耗时 ${caseRun.latencyMs}ms）`,
      evidence,
    };
  }

  // 2) 循环
  if (input.loopGuarded || hardFailed(input, 'process.loop')) {
    return {
      category: 'loop',
      confidence: 0.97,
      source: 'rule',
      explanation: explain('process.loop') || '运行时检测到重复工具调用循环',
      evidence: failing('process.loop'),
    };
  }

  // 3) 策略 / 安全违规
  const policyFails = ['tool.not_called', 'output.not_contains'].filter((k) => hardFailed(input, k));
  if (policyFails.length > 0) {
    return {
      category: 'policy_failure',
      confidence: 0.96,
      source: 'rule',
      explanation: policyFails.map((k) => explain(k)).join('；'),
      evidence: policyFails.flatMap((k) => failing(k)),
    };
  }

  // 4) 工具选择错误
  if (hardFailed(input, 'tool.called')) {
    const attempted = input.toolCalls.map((c) => c.toolName);
    return {
      category: 'tool_selection_failure',
      confidence: 0.95,
      source: 'rule',
      explanation: `${explain('tool.called')}${attempted.length > 0 ? `（实际调用：${attempted.join('、')}）` : '（全程未调用任何工具）'}`,
      evidence: failing('tool.called'),
    };
  }

  // 5) 工具参数错误
  if (hardFailed(input, 'tool.arguments') || input.toolCalls.some((c) => c.status === 'invalid_arguments')) {
    const invalid = input.toolCalls.filter((c) => c.status === 'invalid_arguments');
    addEvidence(
      ...invalid.map((c) => ({
        type: 'tool_call' as const,
        toolCallId: c.id,
        traceStepId: c.stepId,
        description: `参数非法：${c.validationError ?? ''}`,
      })),
    );
    return {
      category: 'tool_argument_failure',
      confidence: 0.94,
      source: 'rule',
      explanation: explain('tool.arguments') || `工具 ${invalid.map((c) => c.toolName).join('、')} 参数校验失败`,
      evidence: [...failing('tool.arguments'), ...evidence],
    };
  }

  // 6) 工具执行失败
  const executionFailure = resultOf(input, 'tool.execution');
  if (executionFailure?.status === 'fail') {
    return {
      category: 'tool_execution_failure',
      confidence: 0.9,
      source: 'rule',
      explanation: executionFailure.message,
      evidence: executionFailure.evidence,
    };
  }

  // 7) 格式失败
  const formatFails = ['format.json_parse', 'format.json_schema'].filter((k) => hardFailed(input, k));
  if (formatFails.length > 0) {
    return {
      category: 'format_failure',
      confidence: 0.95,
      source: 'rule',
      explanation: formatFails.map((k) => explain(k)).join('；'),
      evidence: formatFails.flatMap((k) => failing(k)),
    };
  }

  // 8) 检索失败（该召回的没召回）
  if (hardFailed(input, 'rag.hit') || hardFailed(input, 'rag.recall_at_k')) {
    const expected = testCase.expectedOutcome.requiredEvidence;
    const retrieved = input.retrievals.flatMap((r) => r.documents.map((d) => d.title));
    return {
      category: 'retrieval_failure',
      confidence: 0.92,
      source: 'rule',
      explanation: `${explain('rag.hit')}（检索到：${retrieved.slice(0, 5).join('、') || '空'}）${
        expected.length > 0 ? `；期望证据：${expected.join('、')}` : ''
      }`,
      evidence: [...failing('rag.hit'), ...failing('rag.recall_at_k')],
    };
  }

  // 9) 幻觉（有据可依得分低）
  const groundedness = resultOf(input, 'rag.groundedness');
  if (groundedness && (groundedness.status === 'fail' || (groundedness.status === 'partial' && caseRun.status !== 'passed'))) {
    return {
      category: 'hallucination',
      confidence: groundedness.status === 'fail' ? 0.9 : 0.7,
      source: 'rule',
      explanation: groundedness.message,
      evidence: groundedness.evidence,
    };
  }

  // 10) 内容类：区分「缺上下文」「部分完成」「答案错」
  const contains = resultOf(input, 'output.contains');
  if (contains && contains.status !== 'pass' && contains.status !== 'skipped') {
    const details = (contains as { details?: Record<string, unknown> }).details ?? {};
    const misses = Array.isArray(details['misses']) ? (details['misses'] as string[]) : [];
    const retrievedText = normalizeText(input.retrievals.flatMap((r) => r.selectedChunks).join('\n'));
    const evidenceMissing = testCase.expectedOutcome.requiredEvidence.filter((term) => !retrievedText.includes(normalizeText(term)));
    const noRetrievalAtAll = input.retrievals.every((r) => r.documents.length === 0);

    if ((noRetrievalAtAll || evidenceMissing.length > 0) && testCase.expectedOutcome.requiredEvidence.length > 0) {
      return {
        category: 'missing_context',
        confidence: 0.72,
        source: 'rule',
        explanation: `${contains.message}；而回答所需的证据（${(evidenceMissing.length > 0 ? evidenceMissing : testCase.expectedOutcome.requiredEvidence).join('、')}）并未出现在检索上下文中`,
        evidence: contains.evidence,
      };
    }
    if (contains.status === 'partial') {
      return {
        category: 'partial_completion',
        confidence: 0.75,
        source: 'rule',
        explanation: `${contains.message}；已命中部分要点但未覆盖全部：${misses.join('、')}`,
        evidence: contains.evidence,
      };
    }
    return {
      category: 'wrong_answer',
      confidence: 0.8,
      source: 'rule',
      explanation: contains.message,
      evidence: contains.evidence,
    };
  }

  // 11) 指令/自定义规则失败
  const custom = resultOf(input, 'custom.rules');
  if (custom && custom.status !== 'pass' && custom.status !== 'skipped') {
    return {
      category: 'instruction_failure',
      confidence: 0.8,
      source: 'rule',
      explanation: custom.message,
      evidence: custom.evidence,
    };
  }

  // 12) 兜底
  const errorStep = input.steps.find((s) => s.type === 'error');
  if (errorStep) {
    return {
      category: 'tool_execution_failure',
      confidence: 0.6,
      source: 'rule',
      explanation: errorStep.summary,
      evidence: [{ type: 'trace_step', traceStepId: errorStep.id, description: errorStep.summary }],
    };
  }

  return {
    category: 'unknown',
    confidence: 0.4,
    source: 'rule',
    explanation: `裁决为 ${verdict}，但确定性规则无法归因（检查项：${input.results.map((r) => `${r.evaluatorKey}=${r.status}`).join(', ')}）`,
    evidence,
  };
}

export function severityOf(category: FailureCategory): 'info' | 'minor' | 'major' | 'critical' {
  return FAILURE_TAXONOMY[category].defaultSeverity;
}

export function isDeterministicCategory(category: FailureCategory): boolean {
  return FAILURE_TAXONOMY[category].deterministic;
}
