/**
 * 测试用具：把 Zod schema 以最小接口暴露给契约测试，避免 `as never` 到处飞。
 */
export interface ZodObjectLike {
  keyof(): { options: unknown };
}

export {
  AgentSchema,
  AgentVersionSchema,
  AnalysisJobSchema,
  ArtifactSchema,
  CaseRunSchema,
  ComparisonSchema,
  DatasetSchema,
  DatasetVersionSchema,
  EvaluationResultSchema,
  EvaluationRunSchema,
  EvaluatorSetSchema,
  FailureSchema,
  HumanReviewSchema,
  JudgeRubricSchema,
  MetricResultSchema,
  ModelCallSchema,
  OptimizationSuggestionSchema,
  PromptCandidateSchema,
  PromptVersionSchema,
  RegressionSchema,
  ReleaseDecisionSchema,
  ReleaseGateSchema,
  RetrievalEventSchema,
  TestCaseSchema,
  ToolCallSchema,
  TraceSchema,
  TraceStepSchema,
} from '@arl/shared';
