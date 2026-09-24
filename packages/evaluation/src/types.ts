import type { ModelProvider } from '@arl/providers';
import type { TraceBundle } from '@arl/runtime';
import type {
  CaseRun,
  EvaluationResult,
  EvaluatorCategory,
  EvaluatorConfig,
  EvidenceReference,
  JudgeRubric,
  ModelCall,
  RetrievalEvent,
  Severity,
  TestCase,
  ToolCall,
  TraceStep,
} from '@arl/shared';

/** 一次评测所需的全部证据。Evaluator 只能读这里，不能去查库。 */
export interface EvaluationContext {
  testCase: TestCase;
  caseRun: CaseRun;
  bundle: TraceBundle | null;
  steps: TraceStep[];
  toolCalls: ToolCall[];
  retrievals: RetrievalEvent[];
  modelCalls: ModelCall[];
  /** 需要 LLM 的 evaluator 用（Mock 亦可） */
  provider?: ModelProvider;
  rubric?: JudgeRubric;
  /** 期望检索命中的文档 id（来自 testCase.metadata.expectedDocIds） */
  expectedDocIds: string[];
  /** 评测器自身的配置（来自 EvaluatorConfig.config） */
  config: Record<string, unknown>;
  severity: Severity;
  weight: number;
  blocking: boolean;
}

export type EvaluationDraft = Omit<EvaluationResult, 'id' | 'caseRunId'>;

export interface Evaluator {
  key: string;
  name: string;
  version: string;
  kind: 'deterministic' | 'llm' | 'human';
  category: EvaluatorCategory;
  description: string;
  severity: Severity;
  blocking: boolean;
  /**
   * 该 evaluator 对当前用例是否有意义。
   * 例如 expectedTools 为空的用例，「工具是否调用」返回 skipped 而不是 pass —— 避免拉高通过率。
   */
  appliesTo(ctx: EvaluationContext): boolean;
  evaluate(ctx: EvaluationContext): EvaluationDraft | Promise<EvaluationDraft>;
}

export function createDraft(
  evaluator: Pick<Evaluator, 'key' | 'name' | 'version' | 'category'>,
  partial: Partial<EvaluationDraft> & { status: EvaluationDraft['status']; message: string },
  ctx: EvaluationContext,
): EvaluationDraft {
  return {
    evaluatorKey: evaluator.key,
    evaluatorVersion: evaluator.version,
    name: evaluator.name,
    category: evaluator.category,
    status: partial.status,
    score: partial.score ?? (partial.status === 'pass' ? 1 : 0),
    severity: partial.severity ?? ctx.severity,
    weight: partial.weight ?? ctx.weight,
    blocking: partial.blocking ?? ctx.blocking,
    message: partial.message,
    details: partial.details ?? {},
    evidence: partial.evidence ?? [],
    durationMs: partial.durationMs ?? 0,
  };
}

export function evidence(partial: Omit<EvidenceReference, 'description'> & { description?: string }): EvidenceReference {
  return { description: '', ...partial };
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 在输出中定位片段，产出可点击的证据区间 */
export function findOutputRange(output: string, needle: string): { start: number; end: number } | null {
  const idx = output.indexOf(needle);
  if (idx < 0) return null;
  return { start: idx, end: idx + needle.length };
}

export interface EvaluatorWithConfig {
  evaluator: Evaluator;
  config: EvaluatorConfig;
}

export type { EvaluationResult };
