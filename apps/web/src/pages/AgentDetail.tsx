import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, fmtPercent, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Json, Loading, PageHeader, RunLink, Table } from '../components/ui';

interface AgentDetail {
  agent: { id: string; name: string; description: string; tags: string[] };
  versions: {
    id: string;
    version: number;
    label: string;
    status: string;
    fixtureId: string;
    runtimeKind: string;
    toolCount: number;
    notes: string;
    createdAt: string;
    prompt: { id: string; version: number; hash: string; systemPrompt: string; taskPromptTemplate: string } | null;
    runs: { id: string; status: string; passed: number; caseCount: number; startedAt: string }[];
    metrics: { key: string; name: string; value: number; unit: string; definition: string }[];
  }[];
  runs: { id: string; status: string; passed: number; failed: number; caseCount: number; startedAt: string; datasetVersionId: string }[];
  gates: { id: string; name: string; description: string; rules: { id: string; description: string }[] }[];
  decisions: { id: string; result: string; explanation: string; decidedAt: string; runId: string }[];
  promptVersions: { id: string; version: number; label: string; hash: string; notes: string; createdAt: string }[];
}

export default function AgentDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useData<AgentDetail>(`/agents/${id}`);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [draftPrompt, setDraftPrompt] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const latestPrompt = data.promptVersions[0];
  const comparePrompt = data.promptVersions.find((p) => p.id === selectedPrompt);
  const promptChanged = latestPrompt && comparePrompt ? latestPrompt.hash !== comparePrompt.hash : false;

  async function createPromptVersion() {
    if (!latestPrompt || !draftPrompt.trim()) return;
    setBusy(true);
    try {
      await api.post(`/agents/${id}/prompts`, { systemPrompt: draftPrompt, taskPromptTemplate: '{{input}}' });
      setDraftPrompt('');
      setNotice('已创建新的 Prompt Version（原版本保留）');
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(versionId: string, status: string) {
    setBusy(true);
    try {
      await api.patch(`/agent-versions/${versionId}/status`, { status });
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={data.agent.name}
        subtitle={data.agent.description}
        actions={data.agent.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="版本（不可覆盖，只能新增）" className="lg:col-span-2">
          <Table head={['版本', '状态', 'Prompt', '工具', '最近通过率', '运行', '操作']}>
            {data.versions.map((v) => {
              const passRate = v.metrics.find((m) => m.key === 'task_success_rate')?.value ?? null;
              return (
                <tr key={v.id}>
                  <td className="td">
                    <div className="mono font-medium">v{v.version} · {v.label}</div>
                    <div className="text-[11px] text-zinc-500">{v.notes}</div>
                  </td>
                  <td className="td"><Badge tone={v.status === 'validated' || v.status === 'released' ? 'passed' : 'info'}>{v.status}</Badge></td>
                  <td className="td">
                    <div className="mono">{v.prompt?.hash}</div>
                    <div className="text-[11px] text-zinc-400">prompt v{v.prompt?.version}</div>
                  </td>
                  <td className="td">{v.toolCount}</td>
                  <td className="td">{fmtPercent(passRate)}</td>
                  <td className="td">{v.runs[0] ? <RunLink id={v.runs[0]!.id} /> : '—'}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {v.status !== 'validated' && (
                        <button className="btn" disabled={busy} onClick={() => setStatus(v.id, 'validated')}>标记 validated</button>
                      )}
                      {v.status !== 'released' && (
                        <button className="btn" disabled={busy} onClick={() => setStatus(v.id, 'released')}>发布</button>
                      )}
                      {v.status !== 'deprecated' && (
                        <button className="btn" disabled={busy} onClick={() => setStatus(v.id, 'deprecated')}>弃用</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <Card title="Prompt 版本与 Diff">
          <div className="space-y-2">
            {data.promptVersions.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="prompt-compare"
                  checked={selectedPrompt === p.id}
                  onChange={() => setSelectedPrompt(p.id)}
                />
                <span className="mono">v{p.version}</span>
                <span className="text-zinc-500">{p.label}</span>
                <span className="mono text-zinc-400">{p.hash}</span>
              </label>
            ))}
          </div>
          {latestPrompt && comparePrompt && (
            <div className="mt-3 rounded-md border border-zinc-200 p-3 text-xs">
              <div className="mb-1 font-medium">
                对比 v{latestPrompt.version}（最新） vs v{comparePrompt.version}
                {promptChanged ? <Badge tone="fail">内容已变化</Badge> : <Badge tone="passed">内容一致</Badge>}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] text-zinc-500">最新 system prompt</div>
                  <Json value={latestPrompt.hash} />
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-zinc-500">对比版本 hash</div>
                  <Json value={comparePrompt.hash} />
                </div>
              </div>
              {promptChanged && (
                <div className="mt-2 text-[11px] text-zinc-500">
                  Prompt 内容不同。可在 Runs 页面分别对两个版本运行同一数据集，观察「仅 Prompt 变化」带来的性能差异。
                </div>
              )}
            </div>
          )}
          <div className="mt-3">
            <div className="mb-1 text-[11px] text-zinc-500">新建 Prompt 候选版本（不影响历史）</div>
            <textarea
              className="input mono h-24"
              placeholder="新的 system prompt…"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
            />
            <button className="btn btn-primary mt-2" disabled={busy || !draftPrompt.trim()} onClick={createPromptVersion}>
              创建 Prompt Version
            </button>
          </div>
          {notice && <div className="mt-2 text-[11px] text-emerald-600">{notice}</div>}
        </Card>

        <Card title="发布门禁">
          {data.gates.length === 0 && <div className="text-xs text-zinc-400">未配置门禁</div>}
          <div className="space-y-3">
            {data.gates.map((gate) => (
              <div key={gate.id} className="rounded-md border border-zinc-200 p-3">
                <div className="text-xs font-medium text-zinc-800">{gate.name}</div>
                <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-600">
                  {gate.rules.map((rule) => (
                    <li key={rule.id}>· {rule.description}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {data.decisions.slice(0, 5).map((decision) => (
              <div key={decision.id} className="rounded-md border border-zinc-200 p-2.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <Badge tone={decision.result}>{decision.result}</Badge>
                  <span className="text-zinc-400">{fmtTime(decision.decidedAt)}</span>
                </div>
                <div className="mt-1 text-zinc-600">{decision.explanation}</div>
                <RunLink id={decision.runId} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="运行历史">
          <Table head={['状态', '通过', '时间', '']} empty={data.runs.length === 0}>
            {data.runs.map((run) => (
              <tr key={run.id}>
                <td className="td"><Badge tone={run.status}>{run.status}</Badge></td>
                <td className="td">{run.passed}/{run.caseCount}{run.failed > 0 && <span className="ml-1 text-rose-600">-{run.failed}</span>}</td>
                <td className="td text-zinc-500">{fmtTime(run.startedAt)}</td>
                <td className="td">
                  <Link className="text-indigo-600 hover:underline" to={`/runs/${run.id}`}>详情</Link>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
