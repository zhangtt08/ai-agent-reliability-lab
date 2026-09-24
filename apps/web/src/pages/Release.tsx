import { useState } from 'react';
import { api, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, RunLink, Table } from '../components/ui';

interface Gate {
  id: string;
  name: string;
  description: string;
  agentId: string;
  rules: { id: string; description: string; metricKey: string; op: string; value: number; scope: string; blocking: boolean }[];
  requireCriticalPass: boolean;
  requireNoRegression: boolean;
  recentDecisions: { id: string; result: string; explanation: string; decidedAt: string; runId: string }[];
}
interface Decision {
  id: string;
  gateName: string;
  result: string;
  explanation: string;
  agentName: string;
  version: number;
  decidedAt: string;
  runId: string;
}
interface Candidate {
  id: string;
  agentId: string;
  rationale: string;
  status: string;
  createdAt: string;
  systemPrompt: string;
}

export default function Release() {
  const { data: gates, error, loading, reload } = useData<Gate[]>('/gates');
  const { data: decisions } = useData<Decision[]>('/release-decisions?limit=20');
  const { data: candidates } = useData<Candidate[]>('/prompt-candidates');
  const { data: runs } = useData<{ id: string; agentName: string; versionLabel: string; agentVersionId: string }[]>('/runs?limit=30');
  const [runByGate, setRunByGate] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  async function evaluate(gateId: string) {
    const runId = runByGate[gateId];
    if (!runId) return;
    setBusy(true);
    setNotice(null);
    try {
      const decision = await api.post<{ result: string }>(`/gates/${gateId}/evaluate`, { runId });
      setNotice(`门禁评估完成：${decision.result}`);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function adopt(candidateId: string) {
    setBusy(true);
    try {
      await api.post(`/prompt-candidates/${candidateId}/adopt`);
      setNotice('候选 Prompt 已采纳为新的 Prompt Version（历史版本未受影响）');
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Release Center" subtitle="发布门禁与决策历史。BLOCKED ≠ FAIL：前者是「无法判定」，后者是「明确不达标」" />

      {notice && <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(gates ?? []).map((gate) => (
          <Card key={gate.id} title={gate.name} actions={<span className="text-[11px] text-zinc-400">{gate.rules.length} 条规则</span>}>
            <p className="text-[11px] text-zinc-500">{gate.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {gate.requireCriticalPass && <Badge tone="critical">critical 全通过</Badge>}
              {gate.requireNoRegression && <Badge tone="high">零回归</Badge>}
            </div>
            <Table head={['规则', '指标', '阻断']}>
              {gate.rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="td">{rule.description}</td>
                  <td className="td mono">{rule.metricKey} {rule.op} {rule.value}（{rule.scope}）</td>
                  <td className="td">{rule.blocking ? <Badge tone="critical">blocking</Badge> : <Badge>建议</Badge>}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center gap-2">
              <select className="input flex-1" value={runByGate[gate.id] ?? ''} onChange={(e) => setRunByGate({ ...runByGate, [gate.id]: e.target.value })}>
                <option value="">选择要评估的 run…</option>
                {(runs ?? []).filter((r) => r.agentVersionId && r.agentName).map((r) => (
                  <option key={r.id} value={r.id}>{r.agentName} {r.versionLabel} · {r.id.slice(4, 12)}</option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={busy || !runByGate[gate.id]} onClick={() => evaluate(gate.id)}>评估门禁</button>
            </div>
            {gate.recentDecisions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {gate.recentDecisions.slice(0, 3).map((decision) => (
                  <div key={decision.id} className="rounded border border-zinc-200 p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <Badge tone={decision.result}>{decision.result}</Badge>
                      <span className="text-zinc-400">{fmtTime(decision.decidedAt)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-zinc-600">{decision.explanation}</div>
                    <RunLink id={decision.runId} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card title="决策历史（只增不改）" className="mt-4">
        <Table head={['时间', 'Agent / 版本', '门禁', '结论', '说明', '']} empty={!decisions || decisions.length === 0}>
          {(decisions ?? []).map((decision) => (
            <tr key={decision.id}>
              <td className="td text-zinc-500">{fmtTime(decision.decidedAt)}</td>
              <td className="td">{decision.agentName} <span className="mono text-zinc-400">v{decision.version}</span></td>
              <td className="td">{decision.gateName}</td>
              <td className="td"><Badge tone={decision.result}>{decision.result}</Badge></td>
              <td className="td max-w-md"><div className="line-clamp-2 text-zinc-600">{decision.explanation}</div></td>
              <td className="td"><RunLink id={decision.runId} /></td>
            </tr>
          ))}
        </Table>
      </Card>

      {candidates && candidates.length > 0 && (
        <Card title="Prompt 候选（P1）— 绝不自动覆盖生产 Prompt" className="mt-4">
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-md border border-zinc-200 p-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="mono text-zinc-500">{candidate.id}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={candidate.status === 'accepted' ? 'passed' : 'info'}>{candidate.status}</Badge>
                    {candidate.status === 'proposed' && (
                      <button className="btn" disabled={busy} onClick={() => adopt(candidate.id)}>采纳为新 Prompt Version</button>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 text-zinc-600">{candidate.rationale}</div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-indigo-600">候选 prompt 内容</summary>
                  <div className="mt-1 whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-2 text-zinc-700">{candidate.systemPrompt}</div>
                </details>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
