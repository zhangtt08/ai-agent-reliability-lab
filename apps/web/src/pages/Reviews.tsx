import { useState } from 'react';
import { CaseLink } from '../components/ui';
import { api, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, Table } from '../components/ui';

interface PendingItem {
  caseRunId: string;
  runId: string;
  agentId: string;
  machineVerdict: string;
  caseRun: { testCaseName: string; finalOutput: string; failureCategory: string | null; priority: string } | null;
  results: { id: string; name: string; status: string; message: string }[];
}
interface ReviewsPage {
  pending: PendingItem[];
  agreement: { machineVerdict: string; humanVerdict: string; count: number }[];
}

export default function Reviews() {
  const { data, error, loading, reload } = useData<ReviewsPage>('/reviews/pending');
  const [verdict, setVerdict] = useState<Record<string, string>>({});
  const [comment, setComment] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  async function submit(caseRunId: string) {
    setBusy(true);
    try {
      await api.post(`/case-runs/${caseRunId}/review`, {
        verdict: verdict[caseRunId] ?? 'pass',
        comment: comment[caseRunId] ?? '',
      });
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Human Review Queue"
        subtitle="机器判定为 failed / partial / error 的用例等待人工确认。人工结论与机器结论都保留，可对比一致性"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {data.pending.length === 0 && (
            <Card>
              <div className="py-8 text-center text-xs text-zinc-400">队列已清空 —— 所有失败用例都有人工结论</div>
            </Card>
          )}
          {data.pending.map((item) => (
            <Card
              key={item.caseRunId}
              title={item.caseRun?.testCaseName ?? item.caseRunId}
              actions={
                <>
                  <Badge tone={item.machineVerdict}>{item.machineVerdict}</Badge>
                  {item.caseRun?.failureCategory && <Badge tone="fail">{item.caseRun.failureCategory}</Badge>}
                  <CaseLink id={item.caseRunId} />
                </>
              }
            >
              <div className="mono mb-2 max-h-24 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 text-[11px] text-zinc-600">
                {item.caseRun?.finalOutput?.slice(0, 400) || '（空）'}
              </div>
              <ul className="mb-2 space-y-0.5 text-[11px] text-zinc-600">
                {item.results.filter((r) => r.status === 'fail' || r.status === 'partial').slice(0, 4).map((r) => (
                  <li key={r.id}>· {r.name}：{r.message.slice(0, 120)}</li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input w-auto" value={verdict[item.caseRunId] ?? 'pass'} onChange={(e) => setVerdict({ ...verdict, [item.caseRunId]: e.target.value })}>
                  <option value="pass">人工：pass</option>
                  <option value="fail">人工：fail</option>
                  <option value="partial">人工：partial</option>
                </select>
                <input
                  className="input flex-1"
                  placeholder="复核说明（为什么推翻/确认机器结论）"
                  value={comment[item.caseRunId] ?? ''}
                  onChange={(e) => setComment({ ...comment, [item.caseRunId]: e.target.value })}
                />
                <button className="btn btn-primary" disabled={busy} onClick={() => submit(item.caseRunId)}>提交</button>
              </div>
            </Card>
          ))}
        </div>

        <Card title="人工 vs 机器一致性">
          <Table head={['机器', '人工', '数量']}>
            {data.agreement.map((row, i) => (
              <tr key={i}>
                <td className="td"><Badge tone={row.machineVerdict}>{row.machineVerdict}</Badge></td>
                <td className="td"><Badge tone={row.humanVerdict}>{row.humanVerdict}</Badge></td>
                <td className="td mono">{row.count}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            人工结论用于校准评测集与 evaluator，**不覆盖**机器结果 —— 原始机器判定永远保留，便于事后审计。
          </div>
        </Card>
      </div>
    </div>
  );
}
