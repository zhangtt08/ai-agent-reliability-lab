import { Link } from 'react-router-dom';
import { fmtPercent, fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, RunLink, Table } from '../components/ui';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  versionCount: number;
  latestVersion: { id: string; version: number; label: string; status: string; fixtureId: string } | null;
  latestPassRate: number | null;
  latestRunId: string | null;
  latestRunAt: string | null;
  releaseResult: string | null;
  regressionCount: number;
}

export default function Agents() {
  const { data, error, loading } = useData<AgentRow[]>('/agents');
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div>
      <PageHeader title="Agents" subtitle="被测 Agent 及其版本、最近通过率与发布状态" />
      <Card>
        <Table
          head={['Agent', '版本', '最近通过率', '最近运行', '发布状态', '回归', '更新时间']}
          empty={!data || data.length === 0}
        >
          {(data ?? []).map((agent) => (
            <tr key={agent.id} className="hover:bg-zinc-50/60">
              <td className="td">
                <Link className="font-medium text-indigo-600 hover:underline" to={`/agents/${agent.id}`}>
                  {agent.name}
                </Link>
                <div className="mt-0.5 max-w-md truncate text-[11px] text-zinc-500">{agent.description}</div>
                <div className="mt-1 flex gap-1">
                  {agent.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              </td>
              <td className="td">
                <div className="mono">{agent.latestVersion ? `v${agent.latestVersion.version}` : '—'}</div>
                <div className="text-[11px] text-zinc-500">{agent.versionCount} 个版本</div>
              </td>
              <td className="td">
                <span className={agent.latestPassRate === null ? 'text-zinc-400' : agent.latestPassRate >= 0.9 ? 'text-emerald-600' : agent.latestPassRate >= 0.6 ? 'text-amber-600' : 'text-rose-600'}>
                  {fmtPercent(agent.latestPassRate)}
                </span>
              </td>
              <td className="td">
                <RunLink id={agent.latestRunId} />
                <div className="text-[11px] text-zinc-400">{fmtTime(agent.latestRunAt)}</div>
              </td>
              <td className="td">{agent.releaseResult ? <Badge tone={agent.releaseResult}>{agent.releaseResult}</Badge> : <span className="text-zinc-400">—</span>}</td>
              <td className="td">{agent.regressionCount > 0 ? <span className="font-medium text-rose-600">{agent.regressionCount}</span> : <span className="text-zinc-400">0</span>}</td>
              <td className="td text-zinc-500">{fmtTime(agent.latestRunAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
