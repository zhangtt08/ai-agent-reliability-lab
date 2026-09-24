import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import AgentDetail from './pages/AgentDetail';
import Datasets from './pages/Datasets';
import DatasetDetail from './pages/DatasetDetail';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import CaseDetail from './pages/CaseDetail';
import Compare from './pages/Compare';
import Failures from './pages/Failures';
import Reviews from './pages/Reviews';
import Release from './pages/Release';
import Search from './pages/Search';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/agents', label: 'Agents' },
  { to: '/datasets', label: 'Datasets' },
  { to: '/runs', label: 'Runs' },
  { to: '/compare', label: 'Compare' },
  { to: '/failures', label: 'Failure Center' },
  { to: '/reviews', label: 'Review Queue' },
  { to: '/release', label: 'Release Center' },
  { to: '/search', label: 'Search' },
];

export default function App() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-4 py-4">
          <div className="text-sm font-semibold text-zinc-900">Agent Reliability Lab</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">local-first 评测与可靠性平台</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = item.end ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={`block rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                  active ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-zinc-100 px-4 py-3 text-[11px] leading-relaxed text-zinc-400">
          Deterministic-first
          <br />
          Evidence-based · Local-first
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-5">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentDetail />} />
            <Route path="/datasets" element={<Datasets />} />
            <Route path="/datasets/:id" element={<DatasetDetail />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/failures" element={<Failures />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/release" element={<Release />} />
            <Route path="/search" element={<Search />} />
            <Route path="*" element={<div className="py-20 text-center text-sm text-zinc-400">404</div>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
