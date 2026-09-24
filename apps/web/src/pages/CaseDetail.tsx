import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, fmtMs, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Json, Loading, PageHeader, Table } from '../components/ui';

interface EvaluationResultRow {
  id: string;
  evaluatorKey: string;
  name: string;
  category: string;
  status: string;
  score: number;
  severity: string;
  blocking: boolean;
  message: string;
  details: Record<string, unknown>;
  evidence: { type: string; description: string; snippet?: string }[];
  durationMs: number;
}
interface FailureRow {
  id: string;
  category: string;
  confidence: number;
  source: string;
  explanation: string;
  evidence: { type: string; description: string; snippet?: string }[];
}
interface ReviewRow {
  id: string;
  reviewer: string;
  verdict: string;
  comment: string;
  machineVerdict: string;
  overridesMachine: boolean;
  createdAt: string;
}
interface TraceBundle {
  trace: { id: string; status: string; stepCount: number; totalDurationMs: number; redactionPolicy: string };
  steps: { id: string; seq: number; type: string; name: string; status: string; durationMs: number; summary: string; payload: Record<string, unknown>; modelCallId: string | null; toolCallId: string | null; retrievalId: string | null }[];
  modelCalls: { id: string; provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null; costSource: string; latencyMs: number; promptMode: string; promptPreview: string | null; outputPreview: string | null; error: string | null }[];
  toolCalls: { id: string; toolName: string; arguments: Record<string, unknown>; status: string; validationError: string | null; outputSummary: string; outputJson: unknown; error: string | null; durationMs: number }[];
  retrievals: { id: string; query: string; rewrittenQuery: string; mode: string; topK: number; documents: { title: string; score: number; rank: number; selectedChunk: string }[]; latencyMs: number; status: string }[];
}
interface CaseDetail {
  caseRun: {
    id: string;
    status: string;
    machineVerdict: string;
    finalOutput: string;
    priority: string;
    tags: string[];
    latencyMs: number;
    modelLatencyMs: number;
    toolLatencyMs: number;
    retrievalLatencyMs: number;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null; costSource: string };
    failureCategory: string | null;
    error: string | null;
    createdAt: string;
    runId: string;
  };
  results: EvaluationResultRow[];
  failures: FailureRow[];
  reviews: ReviewRow[];
  testCase: { id: string; name: string; input: string; context: string; priority: string; expectedOutcome: Record<string, unknown> } | null;
  trace: TraceBundle | null;
}

const STEP_TONE: Record<string, string> = {
  model_call: 'bg-sky-500',
  tool_call: 'bg-violet-500',
  retrieval: 'bg-emerald-500',
  decision: 'bg-amber-500',
  output: 'bg-zinc-500',
  error: 'bg-rose-500',
};

export default function CaseDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useData<CaseDetail>(`/case-runs/${id}`);
  const [stepFilter, setStepFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verdict, setVerdict] = useState('pass');
  const [comment, setComment] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const steps = (data.trace?.steps ?? []).filter((s) => !stepFilter || s.type === stepFilter);
  const toolCallById = new Map((data.trace?.toolCalls ?? []).map((t) => [t.id, t]));
  const modelCallById = new Map((data.trace?.modelCalls ?? []).map((m) => [m.id, m]));
  const retrievalById = new Map((data.trace?.retrievals ?? []).map((r) => [r.id, r]));

  async function submitReview() {
    setBusy(true);
    try {
      await api.post(`/case-runs/${id}/review`, {
        verdict,
        comment,
        failureCategory: category || null,
      });
      setComment('');
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={data.testCase?.name ?? data.caseRun.id}
        subtitle={`机器裁决 ${data.caseRun.machineVerdict} · ${fmtTime(data.caseRun.createdAt)} · 延迟 ${fmtMs(data.caseRun.latencyMs)}（模型 ${fmtMs(data.caseRun.modelLatencyMs)} / 工具 ${fmtMs(data.caseRun.toolLatencyMs)} / 检索 ${fmtMs(data.caseRun.retrievalLatencyMs)}）`}
        actions={<Badge tone={data.caseRun.status}>{data.caseRun.status}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="输入">
          <div className="mono whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-zinc-700">{data.testCase?.input}</div>
          {data.testCase?.context && (
            <div className="mt-2">
              <div className="mb-1 text-[11px] text-zinc-500">上下文</div>
              <Json value={data.testCase.context} />
            </div>
          )}
        </Card>

        <Card title="期望（ExpectedOutcome）">
          <Json value={data.testCase?.expectedOutcome ?? {}} />
        </Card>

        <Card title="最终输出">
          <Json value={data.caseRun.finalOutput || '（空）'} />
          {data.caseRun.error && <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">{data.caseRun.error}</div>}
        </Card>

        <Card title="评测结果（含证据）">
          <div className="space-y-2">
            {data.results.map((result) => (
              <div key={result.id} className={`rounded-md border p-2.5 ${result.status === 'pass' ? 'border-zinc-200' : result.status === 'fail' ? 'border-rose-200 bg-rose-50/40' : 'border-zinc-200'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={result.status}>{result.status}</Badge>
                  <span className="text-xs font-medium text-zinc-800">{result.name}</span>
                  <span className="mono text-zinc-400">{result.evaluatorKey}</span>
                  {result.blocking && <Badge tone="critical">blocking</Badge>}
                  <span className="ml-auto mono text-zinc-400">score {result.score.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-600">{result.message}</div>
                {result.evidence.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                    {result.evidence.slice(0, 4).map((e, i) => (
                      <li key={i}>· [{e.type}] {e.description}{e.snippet ? ` — “${e.snippet.slice(0, 80)}”` : ''}</li>
                    ))}
                  </ul>
                )}
                {Object.keys(result.details).length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-indigo-600">details</summary>
                    <div className="mt-1"><Json value={result.details} /></div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Card>

        {data.failures.length > 0 && (
          <Card title="失败归因">
            <div className="space-y-2">
              {data.failures.map((failure) => (
                <div key={failure.id} className="rounded-md border border-rose-200 bg-rose-50/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone="fail">{failure.category}</Badge>
                    <span className="text-[11px] text-zinc-500">置信 {failure.confidence} · 来源 {failure.source}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-zinc-700">{failure.explanation}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="人工复核（不覆盖机器结论）">
          {data.reviews.length > 0 && (
            <Table head={['复核人', '人工', '机器', '说明', '时间']}>
              {data.reviews.map((review) => (
                <tr key={review.id}>
                  <td className="td">{review.reviewer}</td>
                  <td className="td"><Badge tone={review.verdict}>{review.verdict}</Badge>{review.overridesMachine && <span className="ml-1 text-[10px] text-amber-600">override</span>}</td>
                  <td className="td"><Badge tone={review.machineVerdict}>{review.machineVerdict}</Badge></td>
                  <td className="td text-zinc-500">{review.comment || '—'}</td>
                  <td className="td text-zinc-400">{fmtTime(review.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <select className="input" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
              <option value="pass">pass</option>
              <option value="fail">fail</option>
              <option value="partial">partial</option>
            </select>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">失败分类（可选）</option>
              {['wrong_answer', 'hallucination', 'retrieval_failure', 'tool_selection_failure', 'tool_argument_failure', 'tool_execution_failure', 'missing_context', 'instruction_failure', 'format_failure', 'loop', 'timeout', 'policy_failure', 'partial_completion'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input className="input" placeholder="复核说明" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <button className="btn btn-primary mt-2" disabled={busy} onClick={submitReview}>提交复核结论</button>
        </Card>
      </div>

      <Card
        title={`Trace（${data.trace?.steps.length ?? 0} 步 · 脱敏策略 ${data.trace?.trace.redactionPolicy ?? '-'}）`}
        className="mt-4"
        actions={
          <select className="input w-auto" value={stepFilter} onChange={(e) => setStepFilter(e.target.value)}>
            <option value="">全部类型</option>
            {['model_call', 'tool_call', 'retrieval', 'decision', 'output', 'error'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      >
        {!data.trace && <div className="text-xs text-zinc-400">该用例没有 trace（可能在硬超时时被终止）</div>}
        <div className="space-y-1.5">
          {steps.map((step) => {
            const toolCall = step.toolCallId ? toolCallById.get(step.toolCallId) : undefined;
            const modelCall = step.modelCallId ? modelCallById.get(step.modelCallId) : undefined;
            const retrieval = step.retrievalId ? retrievalById.get(step.retrievalId) : undefined;
            const isOpen = expanded === step.id;
            return (
              <div key={step.id} className="rounded-md border border-zinc-200">
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setExpanded(isOpen ? null : step.id)}>
                  <span className={`h-2 w-2 rounded-full ${STEP_TONE[step.type] ?? 'bg-zinc-400'}`} />
                  <span className="mono w-6 text-zinc-400">{step.seq}</span>
                  <Badge>{step.type}</Badge>
                  <span className="text-xs font-medium text-zinc-700">{step.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{step.summary}</span>
                  {step.status !== 'ok' && <Badge tone={step.status === 'error' ? 'fail' : 'skipped'}>{step.status}</Badge>}
                  <span className="mono text-zinc-400">{fmtMs(step.durationMs)}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-zinc-100 p-3">
                    {toolCall && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="mb-1 text-[11px] text-zinc-500">arguments</div>
                            <Json value={toolCall.arguments} />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] text-zinc-500">输出（{toolCall.status}）</div>
                            <Json value={toolCall.outputJson ?? toolCall.outputSummary} />
                          </div>
                        </div>
                        {toolCall.validationError && <div className="text-[11px] text-rose-600">参数校验失败：{toolCall.validationError}</div>}
                      </div>
                    )}
                    {modelCall && (
                      <div className="space-y-2">
                        <div className="flex gap-3 text-[11px] text-zinc-600">
                          <span>{modelCall.provider}/{modelCall.model}</span>
                          <span>tokens {modelCall.inputTokens}→{modelCall.outputTokens}</span>
                          <span>成本 {modelCall.costUsd === null ? `未知（${modelCall.costSource}）` : `$${modelCall.costUsd}`}</span>
                          <span>prompt 模式 {modelCall.promptMode}</span>
                        </div>
                        {modelCall.promptPreview && (
                          <div>
                            <div className="mb-1 text-[11px] text-zinc-500">prompt（按隐私策略存储）</div>
                            <Json value={modelCall.promptPreview} />
                          </div>
                        )}
                        {modelCall.outputPreview && (
                          <div>
                            <div className="mb-1 text-[11px] text-zinc-500">输出</div>
                            <Json value={modelCall.outputPreview} />
                          </div>
                        )}
                      </div>
                    )}
                    {retrieval && (
                      <div className="space-y-2">
                        <div className="text-[11px] text-zinc-600">
                          query：<span className="mono">{retrieval.query}</span>
                          {retrieval.rewrittenQuery && <> → 改写后：<span className="mono">{retrieval.rewrittenQuery}</span></>}
                        </div>
                        <ul className="space-y-1">
                          {retrieval.documents.map((doc) => (
                            <li key={`${doc.rank}`} className="rounded border border-zinc-200 p-2 text-[11px]">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-zinc-700">#{doc.rank} {doc.title}</span>
                                <span className="mono text-zinc-400">score {doc.score}</span>
                              </div>
                              <div className="mt-1 text-zinc-500">{doc.selectedChunk.slice(0, 200)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!toolCall && !modelCall && !retrieval && <Json value={step.payload} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
