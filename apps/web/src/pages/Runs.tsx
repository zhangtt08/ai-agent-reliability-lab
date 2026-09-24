import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api, fmtPercent, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, RunLink, Table } from '../components/ui';

interface RunRow {
  id: string;
  status: string;
  agentName: string;
  versionLabel: string;
  datasetName: string;
  datasetVersion: number;
  passRate: number | null;
  failed: number;
  caseCount: number;
  gateResult: string | null;
  startedAt: string;
  agentVersionId: string;
  datasetVersionId: string;
  isBaseline: boolean;
}

interface AgentOption {
  id: string;
  name: string;
  versions: { id: string; version: number; status: string }[];
  latestVersion: { id: string; version: number } | null;
}
interface DatasetOption {
  id: string;
  name: string;
  latestVersion: { id: string; version: number } | null;
}
interface EvaluatorSetOption {
  id: string;
  name: string;
  description: string;
  judgeMode: string;
  memberCount?: number;
}

export default function Runs() {
  const { data: runs, error, loading, reload } = useData<RunRow[]>('/runs?limit=50');
  const { data: agents } = useData<AgentOption[]>('/agents');
  const { data: datasets } = useData<DatasetOption[]>('/datasets');
  const { data: sets } = useData<EvaluatorSetOption[]>('/evaluator-sets');

  const [agentVersionId, setAgentVersionId] = useState('');
  const [datasetVersionId, setDatasetVersionId] = useState('');
  const [evaluatorSetId, setEvaluatorSetId] = useState('');
  const [mode, setMode] = useState<'full' | 'smoke'>('full');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const agentOptions = (agents ?? []).flatMap((a) =>
    (a.versions ?? []).map((v) => ({ versionId: v.id, label: `${a.name} v${v.version}${v.status === 'released' ? '（已发布）' : ''}` })),
  );
  const datasetOptions = (datasets ?? []).flatMap((d) =>
    d.latestVersion ? [{ versionId: d.latestVersion.id, label: `${d.name} v${d.latestVersion.version}` }] : [],
  );

  async function startRun() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<{ jobId: string | null }>('/runs', {
        agentVersionId,
        datasetVersionId,
        evaluatorSetId,
        runConfig: { mode, concurrency: 2, timeoutMs: 30000, seed: 42, promptPrivacy: 'store_full', smokeLimit: 5 },
      });
      setNotice(`评测已启动${result.jobId ? `（任务 ${result.jobId.slice(4, 12)}）` : ''}，列表将自动刷新`);
      setTimeout(reload, 1500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div>
      <PageHeader title="Evaluation Runs" subtitle="每次运行都保存可复现性快照：Agent 版本、数据集版本、evaluator 版本、模型配置与 seed" />

      <Card title="启动评测" className="mb-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-[11px] text-zinc-500">
            Agent 版本
            <select className="input mt-1" value={agentVersionId} onChange={(e) => setAgentVersionId(e.target.value)}>
              <option value="">选择…</option>
              {agentOptions.map((o) => <option key={o.versionId} value={o.versionId}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-zinc-500">
            数据集版本
            <select className="input mt-1" value={datasetVersionId} onChange={(e) => setDatasetVersionId(e.target.value)}>
              <option value="">选择…</option>
              {datasetOptions.map((o) => <option key={o.versionId} value={o.versionId}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-zinc-500">
            评测集
            <select className="input mt-1" value={evaluatorSetId} onChange={(e) => setEvaluatorSetId(e.target.value)}>
              <option value="">选择…</option>
              {(sets ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}（{s.judgeMode}）</option>)}
            </select>
          </label>
          <label className="text-[11px] text-zinc-500">
            模式
            <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'smoke')}>
              <option value="full">Full</option>
              <option value="smoke">Smoke（前 5 条）</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-primary" disabled={busy || !agentVersionId || !datasetVersionId || !evaluatorSetId} onClick={startRun}>
            启动评测
          </button>
          {notice && <span className="text-[11px] text-zinc-600">{notice}</span>}
        </div>
      </Card>

      <Card>
        <Table head={['Agent / 版本', '数据集', '状态', '通过率', '失败', '门禁', '时间', '']} empty={!runs || runs.length === 0}>
          {(runs ?? []).map((run) => (
            <tr key={run.id} className="hover:bg-zinc-50/60">
              <td className="td">
                <div className="font-medium text-zinc-800">{run.agentName}</div>
                <div className="mono text-zinc-400">{run.versionLabel}{run.isBaseline ? ' · baseline' : ''}</div>
              </td>
              <td className="td">{run.datasetName} <span className="mono text-zinc-400">v{run.datasetVersion}</span></td>
              <td className="td"><Badge tone={run.status}>{run.status}</Badge></td>
              <td className="td">
                <span className={run.passRate === null ? 'text-zinc-400' : run.passRate >= 0.9 ? 'text-emerald-600' : run.passRate >= 0.6 ? 'text-amber-600' : 'text-rose-600'}>
                  {fmtPercent(run.passRate)}
                </span>
              </td>
              <td className="td">{run.failed > 0 ? <span className="text-rose-600">{run.failed}</span> : 0}</td>
              <td className="td">{run.gateResult ? <Badge tone={run.gateResult}>{run.gateResult}</Badge> : '—'}</td>
              <td className="td text-zinc-500">{fmtTime(run.startedAt)}</td>
              <td className="td">
                <Link className="text-indigo-600 hover:underline" to={`/runs/${run.id}`}>详情</Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
