import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-zinc-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PASS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  fail: 'bg-rose-50 text-rose-700 border-rose-200',
  FAIL: 'bg-rose-50 text-rose-700 border-rose-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  timeout: 'bg-amber-50 text-amber-700 border-amber-200',
  BLOCKED: 'bg-amber-50 text-amber-700 border-amber-200',
  UNKNOWN: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  skipped: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  running: 'bg-sky-50 text-sky-700 border-sky-200',
  queued: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  cancelled: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  normal: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  low: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  golden: 'bg-violet-50 text-violet-700 border-violet-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  const cls = (tone && TONES[tone]) || 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-zinc-900';
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-zinc-200 bg-zinc-50/60">
          <tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
      {empty && <div className="px-3 py-8 text-center text-xs text-zinc-400">暂无数据</div>}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="mono max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 leading-relaxed text-zinc-700">
      {typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{message}</div>;
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return <div className="py-8 text-center text-xs text-zinc-400">{label}</div>;
}

export function Bar({ value, tone = 'indigo' }: { value: number; tone?: 'indigo' | 'emerald' | 'rose' | 'amber' }) {
  const colors = { indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500', amber: 'bg-amber-500' };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100">
      <div className={`h-full rounded ${colors[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function RunLink({ id }: { id: string | null }) {
  if (!id) return <span className="text-zinc-400">—</span>;
  return (
    <Link className="mono text-indigo-600 hover:underline" to={`/runs/${id}`}>
      {id.slice(4, 12)}
    </Link>
  );
}

export function CaseLink({ id }: { id: string | null }) {
  if (!id) return <span className="text-zinc-400">—</span>;
  return (
    <Link className="text-indigo-600 hover:underline" to={`/cases/${id}`}>
      查看
    </Link>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
