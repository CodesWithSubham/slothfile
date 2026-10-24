import { NavLink, Outlet } from 'react-router';
import { Copy, FolderOpen, History, LayoutDashboard, ListChecks, Settings, Sparkles, Files } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAiStatus, useAppInfo, useJobEvents } from '../../hooks/use-api';
import { Badge } from '../ui';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/folders', label: 'Folders & scan', icon: FolderOpen },
  { to: '/files', label: 'Files', icon: Files },
  { to: '/organize', label: 'Organize', icon: ListChecks },
  { to: '/duplicates', label: 'Duplicates', icon: Copy },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings }
];

function AiPill() {
  const { data, isLoading } = useAiStatus();
  if (isLoading) return <Badge>Checking AI…</Badge>;
  const ready = data?.state === 'ready';
  return (
    <NavLink to="/settings" className="block rounded-md px-3 py-2 text-[12px] hover:bg-surface-2" title={data?.message}>
      <span className="flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5" aria-hidden />AI suggestions</span>
      <span className={cn('mt-0.5 block', ready ? 'text-accent' : 'text-muted')}>{ready ? `On · ${data?.selectedModel}` : data?.state === 'disabled' ? 'Off' : 'Not available'}</span>
    </NavLink>
  );
}

export function AppShell() {
  useJobEvents();
  const { data: info } = useAppInfo();
  return (
    <div className="grid h-full grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-1 border-r border-line bg-surface px-3 py-4" aria-label="Primary">
        <div className="mb-4 px-3">
          <p className="font-display text-xl font-semibold tracking-tight">SlothFile</p>
          <p className="text-[11px] text-muted">Slow and steady wins the folder.</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
              <Icon className="size-4" aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
        <AiPill />
        {info && <p className="px-3 pt-1 text-[11px] text-muted">v{info.version}</p>}
      </aside>
      <main className="sf-scroll min-w-0 overflow-auto" id="main">
        <div className="mx-auto max-w-6xl px-8 py-7"><Outlet /></div>
      </main>
    </div>
  );
}
