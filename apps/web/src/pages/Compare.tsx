import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtPercent, fmtMs, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, Table } from '../components/ui';

interface RunOption {
  id: string;
  agentName: string;
  versionLabel: string;
  datasetName: string;
  datasetVersion: number;
  passRate: number | null;
  startedAt: string;
}
interface Comparison {
  base: { runId: string; agentName: string; version: number; startedAt: string; datasetVersion: number };
  target: { runId: string; agentName: string; version: number; startedAt: string; datasetVersion: number };
  metricDiffs: { metricKey: string; name: string; base: number | null; target: number | null; delta: number | null; direction: string; improved: boolean | null }[];
  fixedCases: { testCaseId: string; testCaseName: string; baseStatus: string; targetStatus: string }[];
  regressedCases: { testCaseId: string; testCaseName: string; baseStatus: string; targetStatus: string; failureCategory: string | null }[];
  bothPassed: unknown[];
  bothFailed: unknown[];
  changedFailures: { testCaseName: string; from: string | null; to: string | null }[];
  regressions: { id: string; kind: string; severity: string; description: string }[];
}

function fmtMetric(key: string, value: number | null): string {
  if (value === null) return '—';
  if (key.includes('latency')) return fmtMs(value);
  if (key.includes('cost')) return `$${value}`;
  if (key.includes('rate') || key.includes('accuracy') || key.includes('compliance') || key.includes('groundedness')) return fmtPercent(value);
  return String(Math.round(value * 10000) / 10000);
}

export default function Compare() {
  const [params] = useSearchParams();
  const { data: runs } = useData<RunOption[]>('/runs?limit=50');
  const base = params.get('base') ?? '';
  const [target, setTarget] = useState(params.get('target') ?? '');
  const { data, error, loading } = useData<Comparison>(
    base && target ? `/compare?base=${base}&target=${target}` : null,
    [base, target],
  );

  const baseRun = (runs ?? []).find((r) => r.id === base);
  const candidates = (runs ?? []).filter((r) => r.id !== base);

  return (
    <div>
      <PageHeader title="版本对比" subtitle="同一数据集上的两次运行：指标差异、修复用例、回归用例、失败形态变化" />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] text-zinc-500">Baseline Run</div>
            {baseRun ? (
              <div className="rounded-md border border-zinc-200 p-2.5 text-xs">
                <div className="font-medium text-zinc-800">{baseRun.agentName} {baseRun.versionLabel}</div>
                <div className="text-[11px] text-zinc-500">{baseRun.datasetName} v{baseRun.datasetVersion} · {fmtTime(baseRun.startedAt)} · 通过率 {fmtPercent(baseRun.passRate)}</div>
              </div>
            ) : (
              <div className="text-xs text-zinc-400">从 Runs 列表点击「版本对比」进入，或使用 URL 参数 ?base=&lt;runId&gt;</div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] text-zinc-500">对比 Run</div>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">选择要对比的 run…</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.agentName} {r.versionLabel} · {r.datasetName} v{r.datasetVersion} · {fmtPercent(r.passRate)} · {fmtTime(r.startedAt)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {loading && <Loading />}
      {error && <ErrorNote message={error} />}

      {data && (
        <div className="space-y-4">
          <Card title="指标差异">
            <Table head={['指标', 'Baseline', '对比', '变化', '解读']}>
              {data.metricDiffs.map((diff) => (
                <tr key={diff.metricKey}>
                  <td className="td">
                    <div className="font-medium text-zinc-800">{diff.name}</div>
                    <div className="mono text-[10px] text-zinc-400">{diff.metricKey}</div>
                  </td>
                  <td className="td mono">{fmtMetric(diff.metricKey, diff.base)}</td>
                  <td className="td mono">{fmtMetric(diff.metricKey, diff.target)}</td>
                  <td className="td mono">
                    {diff.delta === null ? '—' : (
                      <span className={diff.improved === true ? 'text-emerald-600' : diff.improved === false ? 'text-rose-600' : 'text-zinc-500'}>
                        {diff.delta > 0 ? '+' : ''}{fmtMetric(diff.metricKey, Math.abs(diff.delta) === diff.delta ? diff.delta : -diff.delta).replace('-', diff.delta < 0 ? '-' : '')}
                      </span>
                    )}
                  </td>
                  <td className="td text-zinc-500">
                    {diff.improved === true ? '改善' : diff.improved === false ? '恶化' : '—'}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={`回归用例（${data.regressedCases.length}）`}>
              {data.regressedCases.length === 0 && <div className="text-xs text-zinc-400">无回归 🎉</div>}
              <ul className="space-y-1.5">
                {data.regressedCases.map((c) => (
                  <li key={c.testCaseId} className="rounded-md border border-rose-200 bg-rose-50/40 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-800">{c.testCaseName}</span>
                      <Badge tone="fail">{c.baseStatus} → {c.targetStatus}</Badge>
                    </div>
                    {c.failureCategory && <div className="mt-0.5 text-zinc-500">归因：{c.failureCategory}</div>}
                  </li>
                ))}
              </ul>
            </Card>

            <Card title={`修复用例（${data.fixedCases.length}）`}>
              {data.fixedCases.length === 0 && <div className="text-xs text-zinc-400">无</div>}
              <ul className="space-y-1.5">
                {data.fixedCases.map((c) => (
                  <li key={c.testCaseId} className="rounded-md border border-emerald-200 bg-emerald-50/40 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-800">{c.testCaseName}</span>
                      <Badge tone="passed">{c.baseStatus} → {c.targetStatus}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[11px] text-zinc-500">两者都通过 {data.bothPassed.length} · 两者都失败 {data.bothFailed.length}</div>
            </Card>
          </div>

          {data.changedFailures.length > 0 && (
            <Card title="失败形态变化（仍失败但换了原因）">
              <ul className="space-y-1 text-[11px] text-zinc-600">
                {data.changedFailures.map((c, i) => (
                  <li key={i}>· {c.testCaseName}：{c.from ?? '无'} → {c.to ?? '无'}</li>
                ))}
              </ul>
            </Card>
          )}

          {data.regressions.length > 0 && (
            <Card title={`回归汇总（${data.regressions.length}）`}>
              <ul className="space-y-1.5">
                {data.regressions.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 rounded-md border border-zinc-200 p-2.5 text-[11px]">
                    <Badge tone={r.severity === 'critical' ? 'critical' : 'high'}>{r.kind}</Badge>
                    <span className="text-zinc-700">{r.description}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[11px] text-zinc-400">
                回归定义：之前通过、现在失败；或指标向坏方向漂移超过阈值（通过率 -2%、P95 延迟 ×1.5 且 +500ms、成本 ×1.5）。
              </div>
            </Card>
          )}

          <div className="text-[11px] text-zinc-400">
            需要看单条用例的 trace 差异？<Link className="text-indigo-600 hover:underline" to={`/runs/${data.target.runId}`}>打开对比 run 的详情</Link>，再进入具体用例。
          </div>
        </div>
      )}
    </div>
  );
}
