import { Link } from 'react-router-dom';
import { fmtMs, fmtPercent, fmtTime } from '../api';
import { useData } from '../hooks';
import { Bar, Badge, Card, ErrorNote, Loading, PageHeader, RunLink, Stat, Table } from '../components/ui';

interface Overview {
  totalAgents: number;
  totalAgentVersions: number;
  totalDatasets: number;
  totalCases: number;
  totalRuns: number;
  totalCaseRuns: number;
  totalFailures: number;
  totalRegressions: number;
  pendingReviews: number;
  gateFailures: number;
  costLatency: { avgCostUsd: number | null; avgLatencyMs: number; p95LatencyMs: number; costedRuns: number };
  passRateTrend: { runId: string; label: string; passRate: number; startedAt: string }[];
  topFailureCategories: { category: string; count: number }[];
  recentRuns: {
    id: string;
    agentName: string;
    versionLabel: string;
    datasetName: string;
    status: string;
    passed: number;
    failed: number;
    caseCount: number;
    startedAt: string;
  }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  wrong_answer: '答案错误',
  hallucination: '幻觉',
  retrieval_failure: '检索失败',
  tool_selection_failure: '工具选择错误',
  tool_argument_failure: '工具参数错误',
  tool_execution_failure: '工具执行失败',
  missing_context: '上下文缺失',
  instruction_failure: '指令遵循失败',
  format_failure: '格式失败',
  loop: '循环',
  timeout: '超时',
  policy_failure: '策略违规',
  partial_completion: '部分完成',
  unknown: '未知',
};

export default function Dashboard() {
  const { data, error, loading } = useData<Overview>('/overview');

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const maxCategory = Math.max(1, ...data.topFailureCategories.map((c) => c.count));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${data.totalAgents} 个 Agent · ${data.totalAgentVersions} 个版本 · ${data.totalDatasets} 个数据集 / ${data.totalCases} 条用例 · ${data.totalRuns} 次评测运行`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="评测用例执行" value={data.totalCaseRuns} hint={`最近趋势见下方`} />
        <Stat
          label="失败用例"
          value={data.totalFailures}
          tone={data.totalFailures > 0 ? 'warn' : 'good'}
          hint="全部 run 累计"
        />
        <Stat
          label="检出回归"
          value={data.totalRegressions}
          tone={data.totalRegressions > 0 ? 'bad' : 'good'}
          hint="相对 baseline"
        />
        <Stat
          label="待人工复核"
          value={data.pendingReviews}
          tone={data.pendingReviews > 0 ? 'warn' : 'good'}
          hint="机器判定存疑的用例"
        />
        <Stat label="门禁拦截" value={data.gateFailures} tone={data.gateFailures > 0 ? 'bad' : 'good'} hint="FAIL 决策数" />
        <Stat label="平均延迟" value={fmtMs(data.costLatency.avgLatencyMs)} hint={`P95 ${fmtMs(data.costLatency.p95LatencyMs)}`} />
        <Stat
          label="平均成本"
          value={data.costLatency.avgCostUsd === null ? '未知' : `$${data.costLatency.avgCostUsd}`}
          hint={data.costLatency.costedRuns > 0 ? `${data.costLatency.costedRuns} 次运行有成本数据` : 'provider 未提供价目表'}
        />
        <Stat label="失败分类 Top1" value={CATEGORY_LABELS[data.topFailureCategories[0]?.category ?? ''] ?? '—'} hint="按累计失败数" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="最近评测运行" className="lg:col-span-2">
          <Table head={['Agent / 版本', '数据集', '状态', '通过', '门禁', '时间', '']} empty={data.recentRuns.length === 0}>
            {data.recentRuns.map((run) => (
              <tr key={run.id}>
                <td className="td">
                  <div className="font-medium text-zinc-800">{run.agentName}</div>
                  <div className="mono text-zinc-400">{run.versionLabel}</div>
                </td>
                <td className="td">{run.datasetName}</td>
                <td className="td"><Badge tone={run.status}>{run.status}</Badge></td>
                <td className="td">
                  {run.passed}/{run.caseCount}
                  {run.failed > 0 && <span className="ml-1 text-rose-600">-{run.failed}</span>}
                </td>
                <td className="td">{run.status === 'completed' ? <Link className="text-indigo-600 hover:underline" to={`/runs/${run.id}`}>详情</Link> : '—'}</td>
                <td className="td text-zinc-500">{fmtTime(run.startedAt)}</td>
                <td className="td"><RunLink id={run.id} /></td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="space-y-4">
          <Card title="通过率趋势（最近 8 次）">
            {data.passRateTrend.length === 0 && <div className="text-xs text-zinc-400">还没有完成的评测</div>}
            <div className="space-y-2.5">
              {data.passRateTrend.map((point) => (
                <div key={point.runId}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <Link className="text-zinc-600 hover:text-indigo-600" to={`/runs/${point.runId}`}>{point.label}</Link>
                    <span className="mono text-zinc-500">{fmtPercent(point.passRate)}</span>
                  </div>
                  <Bar value={point.passRate} tone={point.passRate >= 0.9 ? 'emerald' : point.passRate >= 0.6 ? 'amber' : 'rose'} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Top 失败分类">
            {data.topFailureCategories.length === 0 && <div className="text-xs text-zinc-400">暂无失败记录</div>}
            <div className="space-y-2.5">
              {data.topFailureCategories.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <Link className="text-zinc-600 hover:text-indigo-600" to={`/failures?category=${c.category}`}>
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </Link>
                    <span className="mono text-zinc-500">{c.count}</span>
                  </div>
                  <Bar value={c.count / maxCategory} tone="rose" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
