import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../hooks';
import { Card, ErrorNote, Loading, PageHeader } from '../components/ui';

interface Hit {
  kind: string;
  refId: string;
  title: string;
  snippet: string;
}

const KIND_TARGET: Record<string, { label: string; to: string | ((refId: string) => string) }> = {
  agent: { label: 'Agent', to: (id) => `/agents/${id}` },
  dataset: { label: 'Dataset', to: (id) => `/datasets/${id}` },
  test_case: { label: '用例', to: () => '/datasets' },
  case: { label: 'Case Run', to: (id) => `/cases/${id}` },
  run: { label: 'Run', to: (id) => `/runs/${id}` },
  failure: { label: '失败', to: '/failures' },
  suggestion: { label: '建议', to: '/release' },
  prompt_candidate: { label: 'Prompt 候选', to: '/release' },
};

export default function Search() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useData<Hit[]>(query.trim() ? `/search?q=${encodeURIComponent(query)}` : null, [query]);

  return (
    <div>
      <PageHeader title="Search" subtitle="全文检索 Agent / 数据集 / 用例 / 运行 / 失败 / 建议（SQLite FTS5 trigram，对中文友好；单字查询自动回落 LIKE）" />
      <Card>
        <input
          className="input"
          placeholder="搜索，例如：重复扣款 / getOrder / hallucination / Support Agent"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {loading && <Loading label="搜索中…" />}
        {error && <ErrorNote message={error} />}
        {data && (
          <div className="mt-3 space-y-2">
            {data.length === 0 && query.trim() && <div className="py-6 text-center text-xs text-zinc-400">没有匹配结果</div>}
            {data.map((hit, index) => {
              const target = KIND_TARGET[hit.kind];
              return (
                <div key={`${hit.kind}-${hit.refId}-${index}`} className="rounded-md border border-zinc-200 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{target?.label ?? hit.kind}</span>
                    {target ? (
                      <Link
                        className="text-xs font-medium text-indigo-600 hover:underline"
                        to={typeof target.to === 'function' ? target.to(hit.refId) : target.to}
                      >
                        {hit.title}
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-zinc-700">{hit.title}</span>
                    )}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{hit.snippet}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
