import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, download, fmtMs, fmtPercent, fmtTime, METRIC_DIRECTION_LABEL } from '../api';
import { useData, usePolling } from '../hooks';
import { Badge, Bar, CaseLink, Card, ErrorNote, Json, Loading, PageHeader, Stat, Table } from '../components/ui';

interface Metric {
  runId: string;
  metricKey: string;
  metricVersion: string;
  name: string;
  value: number;
  unit: string;
  direction: string;
  definition: string;
  sampleSize: number;
}
interface CaseRunRow {
  id: string;
  testCaseId: string;
  testCaseName: string;
  status: string;
  machineVerdict: string;
  priority: string;
  tags: string[];
  latencyMs: number;
  failureCategory: string | null;
  usage: { costUsd: number | null; totalTokens: number };
  traceId: string | null;
}
interface RunDetail {
  run: {
    id: string;
    status: string;
    mode: string;
    caseCount: number;
    passed: number;
    failed: number;
    partial: number;
    errored: number;
    durationMs: number;
    startedAt: string;
    isBaseline: boolean;
    reproducibility: Record<string, unknown> | null;
  };
  agent: { id: string; name: string } | null;
  version: { id: string; version: number; label: string; fixtureId: string } | null;
  dataset: { id: string; name: string } | null;
  datasetVersion: { id: string; version: number } | null;
  metrics: Metric[];
  caseRuns: CaseRunRow[];
  failures: { id: string; caseRunId: string; category: string; confidence: number; explanation: string }[];
  gate: {
    result: string;
    explanation: string;
    ruleResults: { ruleId: string; description: string; result: string; expected: number; actual: number | null; explanation: string; blocking: boolean }[];
  } | null;
  suggestions: { id: string; category: string; title: string; detail: string; evidence: unknown[]; affectedCases: string[]; status: string }[];
  job: { id: string; status: string; done: number; total: number; message: string } | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  wrong_answer: '答案错误', hallucination: '幻觉', retrieval_failure: '检索失败',
  tool_selection_failure: '工具选择错误', tool_argument_failure: '工具参数错误',
  tool_execution_failure: '工具执行失败', missing_context: '上下文缺失',
  instruction_failure: '指令遵循失败', format_failure: '格式失败', loop: '循环',
  timeout: '超时', policy_failure: '策略违规', partial_completion: '部分完成', unknown: '未知',
};

function metricDisplay(metric: Metric): string {
  if (metric.unit === 'ratio') return fmtPercent(metric.value, 2);
  if (metric.unit === 'ms') return fmtMs(metric.value);
  if (metric.unit === 'usd') return `$${metric.value}`;
  return String(metric.value);
}

export default function RunDetail() {
  const { id } = useParams();
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [query, setQuery] = useState('');

  const isRunning = true; // 由 job 状态决定
  const { data, error, loading, reload } = useData<RunDetail>(`/runs/${id}`);
  const { data: polled } = usePolling<{ status: string }>(`/runs/${id}`, 2000, isRunning && data?.run.status === 'running');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  if (polled && polled.status === 'running' && data.run.status === 'running') {
    // 轮询中：保持展示当前数据即可
  }

  const cases = data.caseRuns.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (categoryFilter && c.failureCategory !== categoryFilter) return false;
    if (priorityFilter && c.priority !== priorityFilter) return false;
    if (query && !`${c.testCaseName}`.includes(query)) return false;
    return true;
  });

  const categories = [...new Set(data.failures.map((f) => f.category))];

  async function markBaseline() {
    setBusy(true);
    try {
      await api.post(`/runs/${id}/baseline`);
      setNotice('已标记为该数据集版本的 baseline，后续 run 自动对比');
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function reAnalyze() {
    setBusy(true);
    try {
      await api.post(`/runs/${id}/analyze`, {});
      setNotice('已重新执行分析链（回归 / 门禁 / 建议）');
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function exportRun() {
    const result = await api.get<{ filename: string; mime: string; content: string }>(`/runs/${id}/export`);
    download(result.filename, result.content, result.mime);
  }

  return (
    <div>
      <PageHeader
        title={`Run ${id?.slice(4, 12)}`}
        subtitle={`${data.agent?.name ?? ''} ${data.version ? `v${data.version.version}` : ''} × ${data.dataset?.name ?? ''} v${data.datasetVersion?.version ?? ''} · ${data.run.mode} · ${fmtTime(data.run.startedAt)}`}
        actions={
          <>
            <Badge tone={data.run.status}>{data.run.status}</Badge>
            {data.run.isBaseline && <Badge tone="golden">baseline</Badge>}
            <button className="btn" disabled={busy} onClick={markBaseline}>设为 Baseline</button>
            <button className="btn" disabled={busy} onClick={reAnalyze}>重新分析</button>
            <button className="btn" onClick={exportRun}>导出 JSON</button>
            <Link className="btn" to={`/compare?base=${id}`}>版本对比</Link>
          </>
        }
      />

      {notice && <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{notice}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="用例" value={data.run.caseCount} hint={`passed ${data.run.passed} / failed ${data.run.failed} / partial ${data.run.partial} / error ${data.run.errored}`} />
        <Stat
          label="通过率"
          value={fmtPercent(data.metrics.find((m) => m.metricKey === 'task_success_rate')?.value ?? null)}
          tone={data.run.failed === 0 && data.run.errored === 0 ? 'good' : 'bad'}
        />
        <Stat label="平均延迟" value={fmtMs(data.metrics.find((m) => m.metricKey === 'avg_latency_ms')?.value ?? null)} hint={`P95 ${fmtMs(data.metrics.find((m) => m.metricKey === 'p95_latency_ms')?.value ?? null)}`} />
        <Stat
          label="幻觉率"
          value={fmtPercent(data.metrics.find((m) => m.metricKey === 'hallucination_rate')?.value ?? null)}
          tone={(data.metrics.find((m) => m.metricKey === 'hallucination_rate')?.value ?? 0) > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="工具正确率"
          value={fmtPercent(data.metrics.find((m) => m.metricKey === 'tool_accuracy')?.value ?? null)}
        />
      </div>

      {data.job && data.run.status === 'running' && (
        <Card title="运行进度" className="mt-4">
          <div className="text-xs text-zinc-600">{data.job.message}</div>
          <div className="mt-2"><Bar value={data.job.total > 0 ? data.job.done / data.job.total : 0} /></div>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="指标（每项都注明计算方式）" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.metrics.map((metric) => (
              <div key={metric.metricKey} className="rounded-md border border-zinc-200 p-2.5" title={metric.definition}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">{metric.name}</span>
                  <span className="mono text-zinc-900">{metricDisplay(metric)}</span>
                </div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-500">{metric.definition}</div>
                <div className="mt-1 text-[10px] text-zinc-400">
                  {metric.metricKey}@{metric.metricVersion} · n={metric.sampleSize} · {METRIC_DIRECTION_LABEL[metric.direction]}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Release Gate">
          {!data.gate && <div className="text-xs text-zinc-400">该 Agent 未配置启用的门禁</div>}
          {data.gate && (
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={data.gate.result}>{data.gate.result}</Badge>
                <span className="text-[11px] text-zinc-500">阻断失败 {data.gate.ruleResults.filter((r) => r.blocking && r.result === 'FAIL').length}</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{data.gate.explanation}</p>
              <div className="mt-3 space-y-2">
                {data.gate.ruleResults.map((rule) => (
                  <div key={rule.ruleId} className="rounded-md border border-zinc-200 p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-700">{rule.description}</span>
                      <Badge tone={rule.result}>{rule.result}</Badge>
                    </div>
                    <div className="mt-1 text-zinc-500">{rule.explanation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title={`用例（${cases.length}/${data.caseRuns.length}）`}
        className="mt-4"
        actions={
          <>
            <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              {['passed', 'failed', 'partial', 'error', 'timeout', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">全部失败分类</option>
              {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            </select>
            <select className="input w-auto" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">全部优先级</option>
              {['critical', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="input w-36" placeholder="搜索用例名" value={query} onChange={(e) => setQuery(e.target.value)} />
          </>
        }
      >
        <Table head={['用例', '裁决', '失败分类', '延迟', 'Tokens', '']} empty={cases.length === 0}>
          {cases.map((c) => (
            <tr key={c.id} className="hover:bg-zinc-50/60">
              <td className="td">
                <div className="font-medium text-zinc-800">{c.testCaseName}</div>
                <div className="mt-1 flex gap-1">
                  <Badge tone={c.priority}>{c.priority}</Badge>
                  {c.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                </div>
              </td>
              <td className="td"><Badge tone={c.status}>{c.machineVerdict}</Badge></td>
              <td className="td">
                {c.failureCategory ? (
                  <span className="text-rose-600">{CATEGORY_LABELS[c.failureCategory] ?? c.failureCategory}</span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="td mono">{fmtMs(c.latencyMs)}</td>
              <td className="td mono">{c.usage.totalTokens}{c.usage.costUsd !== null ? ` · $${c.usage.costUsd}` : ''}</td>
              <td className="td"><CaseLink id={c.id} /></td>
            </tr>
          ))}
        </Table>
      </Card>

      {data.suggestions.length > 0 && (
        <Card title={`优化建议（${data.suggestions.length}）— 每条都带可核对的证据`} className="mt-4">
          <div className="space-y-3">
            {data.suggestions.map((s) => (
              <div key={s.id} className="rounded-md border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{s.category}</Badge>
                  <span className="text-xs font-medium text-zinc-800">{s.title}</span>
                  <span className="text-[11px] text-zinc-400">证据 {s.evidence.length} 条 · 影响 {s.affectedCases.length} 个用例</span>
                </div>
                <div className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-zinc-600">{s.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.run.reproducibility && (
        <Card title="可复现性快照" className="mt-4">
          <Json value={data.run.reproducibility} />
        </Card>
      )}
    </div>
  );
}
