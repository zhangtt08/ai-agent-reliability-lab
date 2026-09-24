import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtTime } from '../api';
import { useData } from '../hooks';
import { Badge, Card, CaseLink, ErrorNote, Loading, PageHeader, Table } from '../components/ui';

interface FailureRow {
  id: string;
  runId: string;
  agentName: string;
  version: number;
  testCaseName: string;
  category: string;
  confidence: number;
  source: string;
  explanation: string;
  priority: string;
  tags: string[];
  caseRunId: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  wrong_answer: '答案错误', hallucination: '幻觉', retrieval_failure: '检索失败',
  tool_selection_failure: '工具选择错误', tool_argument_failure: '工具参数错误',
  tool_execution_failure: '工具执行失败', missing_context: '上下文缺失',
  instruction_failure: '指令遵循失败', format_failure: '格式失败', loop: '循环',
  timeout: '超时', policy_failure: '策略违规', partial_completion: '部分完成', unknown: '未知',
};

export default function Failures() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const agentId = params.get('agentId') ?? '';
  const { data: failures, error, loading } = useData<FailureRow[]>(
    `/failures?${new URLSearchParams({ ...(category ? { category } : {}), ...(agentId ? { agentId } : {}) }).toString()}`,
  );
  const { data: agents } = useData<{ id: string; name: string }[]>('/agents');

  return (
    <div>
      <PageHeader
        title="Failure Center"
        subtitle="所有失败用例，按 Agent / 版本 / 分类 / 优先级筛选"
        actions={
          <>
            <select className="input w-auto" value={category} onChange={(e) => setParams(e.target.value ? { category: e.target.value, ...(agentId ? { agentId } : {}) } : agentId ? { agentId } : {})}>
              <option value="">全部分类</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select className="input w-auto" value={agentId} onChange={(e) => setParams({ ...(category ? { category } : {}), ...(e.target.value ? { agentId: e.target.value } : {}) })}>
              <option value="">全部 Agent</option>
              {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        }
      />

      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {failures && (
        <Card>
          <Table head={['Agent / 版本', '用例', '分类', '置信度', '归因说明', '时间', '']} empty={failures.length === 0}>
            {failures.map((failure) => (
              <tr key={failure.id} className="hover:bg-zinc-50/60">
                <td className="td">
                  <div className="font-medium text-zinc-800">{failure.agentName}</div>
                  <div className="mono text-zinc-400">v{failure.version}</div>
                </td>
                <td className="td">
                  <div className="text-zinc-800">{failure.testCaseName}</div>
                  <div className="mt-1 flex gap-1">
                    <Badge tone={failure.priority}>{failure.priority}</Badge>
                    {failure.tags.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
                  </div>
                </td>
                <td className="td"><Badge tone="fail">{CATEGORY_LABELS[failure.category] ?? failure.category}</Badge></td>
                <td className="td mono">{failure.confidence}</td>
                <td className="td max-w-md">
                  <div className="line-clamp-3 text-zinc-600">{failure.explanation}</div>
                </td>
                <td className="td text-zinc-400">{fmtTime(failure.createdAt)}</td>
                <td className="td"><CaseLink id={failure.caseRunId} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
