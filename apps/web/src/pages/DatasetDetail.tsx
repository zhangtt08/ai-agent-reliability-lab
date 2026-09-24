import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { api, download } from '../api';
import { useData } from '../hooks';
import { Badge, Card, ErrorNote, Loading, PageHeader, Table } from '../components/ui';

interface DatasetDetail {
  dataset: { id: string; name: string; description: string; tags: string[]; isGolden: boolean };
  versions: { id: string; version: number; status: string; caseCount: number; isGolden: boolean; contentHash: string; notes: string; createdAt: string }[];
  activeVersionId: string | null;
  cases: {
    id: string;
    name: string;
    input: string;
    priority: string;
    tags: string[];
    enabled: boolean;
    notes: string;
    expectedOutcome: {
      mustContain: string[];
      mustNotContain: string[];
      expectedTools: string[];
      forbiddenTools: string[];
      expectedSchema: unknown;
      maxToolCalls: number | null;
      requiredEvidence: string[];
      customRules: { id: string; description: string }[];
    };
  }[];
}

export default function DatasetDetail() {
  const { id } = useParams();
  const [versionId, setVersionId] = useState<string>('');
  const { data, error, loading, reload } = useData<DatasetDetail>(`/datasets/${id}`);
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('json');
  const [importContent, setImportContent] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const active = data.versions.find((v) => v.id === (versionId || data.activeVersionId)) ?? data.versions[0];
  const editable = active?.status === 'draft';

  async function freeze(status: 'published' | 'golden') {
    if (!active) return;
    setBusy(true);
    try {
      await api.post(`/dataset-versions/${active.id}/freeze`, { status });
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function fork() {
    if (!active) return;
    setBusy(true);
    try {
      await api.post(`/datasets/${id}/versions`, { forkFrom: active.id, notes: `fork 自 v${active.version}` });
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!id || !importContent.trim()) return;
    setBusy(true);
    setImportResult(null);
    try {
      const result = await api.post<{ imported: number; errors: { row: number; message: string }[]; skipped: string[] }>(
        `/datasets/${id}/import`,
        { format: importFormat, content: importContent },
      );
      setImportResult(
        `导入 ${result.imported} 条；解析错误 ${result.errors.length} 条${result.skipped.length ? `；跳过 ${result.skipped.length} 条` : ''}` +
          (result.errors.length ? ` → 首个错误：${result.errors[0]?.message}` : ''),
      );
      setImportContent('');
      reload();
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportDataset(format: 'json' | 'csv') {
    if (!active) return;
    const result = await api.get<{ filename: string; mime: string; content: string }>(
      `/datasets/${id}/export?versionId=${active.id}&format=${format}`,
    );
    download(result.filename, result.content, result.mime);
  }

  async function deleteCase(caseId: string) {
    setBusy(true);
    try {
      await api.del(`/test-cases/${caseId}`);
      reload();
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={data.dataset.name}
        subtitle={data.dataset.description}
        actions={
          <>
            {data.dataset.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
            <select className="input w-auto" value={active?.id ?? ''} onChange={(e) => setVersionId(e.target.value)}>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {v.status} · {v.caseCount} cases
                </option>
              ))}
            </select>
            <button className="btn" disabled={busy} onClick={() => exportDataset('json')}>导出 JSON</button>
            <button className="btn" disabled={busy} onClick={() => exportDataset('csv')}>导出 CSV</button>
            {editable ? (
              <>
                <button className="btn" disabled={busy} onClick={() => freeze('published')}>冻结发布</button>
                <button className="btn" disabled={busy} onClick={() => freeze('golden')}>设为 Golden</button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={fork}>Fork 新版本以编辑</button>
            )}
          </>
        }
      />

      {!editable && active && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          版本 v{active.version} 已冻结（{active.status}），用例不可增删改 —— 这是数据库触发器强制的，不是前端约束。
          内容指纹 <span className="mono">{active.contentHash || '（未冻结时为空）'}</span>。要修改请 Fork 新版本。
        </div>
      )}

      <Card title={`用例（${data.cases.length}）`}>
        <Table
          head={['用例', '输入', '优先级', '期望要点', '工具期望', '备注']}
          empty={data.cases.length === 0}
        >
          {data.cases.map((c) => (
            <tr key={c.id} className="hover:bg-zinc-50/60">
              <td className="td">
                <div className="font-medium text-zinc-800">{c.name}</div>
                <div className="mt-1 flex gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                {!editable && <Link className="mt-1 inline-block text-[11px] text-indigo-600 hover:underline" to={`/cases/${c.id}`}>用例详情</Link>}
              </td>
              <td className="td max-w-sm">
                <div className="mono line-clamp-2 text-zinc-600">{c.input}</div>
              </td>
              <td className="td"><Badge tone={c.priority}>{c.priority}</Badge></td>
              <td className="td">
                <ul className="space-y-0.5 text-[11px] text-zinc-600">
                  {c.expectedOutcome.mustContain.length > 0 && <li>含：{c.expectedOutcome.mustContain.join('、')}</li>}
                  {c.expectedOutcome.mustNotContain.length > 0 && <li className="text-rose-600">禁：{c.expectedOutcome.mustNotContain.join('、')}</li>}
                  {c.expectedOutcome.requiredEvidence.length > 0 && <li>证据：{c.expectedOutcome.requiredEvidence.join('、')}</li>}
                  {c.expectedOutcome.customRules.length > 0 && <li>自定义规则 ×{c.expectedOutcome.customRules.length}</li>}
                </ul>
              </td>
              <td className="td">
                <ul className="space-y-0.5 text-[11px] text-zinc-600">
                  {c.expectedOutcome.expectedTools.length > 0 && <li>必须：{c.expectedOutcome.expectedTools.join('、')}</li>}
                  {c.expectedOutcome.forbiddenTools.length > 0 && <li className="text-rose-600">禁止：{c.expectedOutcome.forbiddenTools.join('、')}</li>}
                  {c.expectedOutcome.maxToolCalls !== null && <li>次数 ≤ {c.expectedOutcome.maxToolCalls}</li>}
                  {Boolean(c.expectedOutcome.expectedSchema) && <li>Schema 校验</li>}
                </ul>
              </td>
              <td className="td">
                <div className="max-w-xs text-[11px] text-zinc-500">{c.notes}</div>
                {editable && (
                  <button className="btn mt-1" disabled={busy} onClick={() => deleteCase(c.id)}>删除</button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {editable && (
        <Card title="导入用例（JSON / CSV）" className="mt-4">
          <div className="flex items-center gap-2">
            <select className="input w-auto" value={importFormat} onChange={(e) => setImportFormat(e.target.value as 'json' | 'csv')}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
            <span className="text-[11px] text-zinc-500">逐行校验，坏行不会影响其他行；写失败会给出明确原因</span>
          </div>
          <textarea
            className="input mono mt-2 h-32"
            placeholder={importFormat === 'json' ? '[{"name":"...","input":"...","expectedOutcome":{"mustContain":["..."]}}]' : 'name,input,priority,expectedTools,mustContain\n...'}
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
          />
          <button className="btn btn-primary mt-2" disabled={busy || !importContent.trim()} onClick={runImport}>
            导入到 v{active?.version}（draft）
          </button>
          {importResult && <div className="mt-2 text-[11px] text-zinc-600">{importResult}</div>}
        </Card>
      )}
    </div>
  );
}
