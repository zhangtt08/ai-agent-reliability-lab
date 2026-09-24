import { Link } from 'react-router-dom';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, Table } from '../components/ui';

interface DatasetRow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  isGolden: boolean;
  versionCount: number;
  latestVersion: { id: string; version: number; status: string; caseCount: number; isGolden: boolean } | null;
}

export default function Datasets() {
  const { data, error, loading } = useData<DatasetRow[]>('/datasets');
  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div>
      <PageHeader title="Datasets" subtitle="评测数据集。golden 数据集的修改会 fork 新版本，历史版本不可覆盖" />
      <Card>
        <Table head={['数据集', '版本', '用例数', '状态', '标签']} empty={!data || data.length === 0}>
          {(data ?? []).map((dataset) => (
            <tr key={dataset.id} className="hover:bg-zinc-50/60">
              <td className="td">
                <Link className="font-medium text-indigo-600 hover:underline" to={`/datasets/${dataset.id}`}>
                  {dataset.name}
                </Link>
                <div className="mt-0.5 max-w-lg truncate text-[11px] text-zinc-500">{dataset.description}</div>
              </td>
              <td className="td">
                <div className="mono">v{dataset.latestVersion?.version ?? '—'}</div>
                <div className="text-[11px] text-zinc-500">{dataset.versionCount} 个版本</div>
              </td>
              <td className="td">{dataset.latestVersion?.caseCount ?? 0}</td>
              <td className="td">
                {dataset.latestVersion && <Badge tone={dataset.latestVersion.status === 'golden' ? 'golden' : dataset.latestVersion.status === 'published' ? 'passed' : 'info'}>{dataset.latestVersion.status}</Badge>}
                {dataset.isGolden && <span className="ml-1"><Badge tone="golden">Golden</Badge></span>}
              </td>
              <td className="td">
                <div className="flex gap-1">{dataset.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
