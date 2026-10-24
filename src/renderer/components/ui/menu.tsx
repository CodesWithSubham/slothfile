import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; }

/** Menu button pattern: Enter/Space/ArrowDown open, arrows + Home/End move, Escape closes and restores focus, outside click dismisses. */
export function DropdownMenu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
    const away = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, active]);

  const close = () => { setOpen(false); btn.current?.focus(); };
  const move = (dir: 1 | -1 | 'first' | 'last') => {
    if (!enabled.length) return;
    const pos = enabled.indexOf(active);
    const next = dir === 'first' ? 0 : dir === 'last' ? enabled.length - 1 : (pos + dir + enabled.length) % enabled.length;
    setActive(enabled[next] as number);
  };

  return (
    <div className="relative inline-block">
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label}
        onClick={() => { setActive(enabled[0] ?? 0); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive(enabled[0] ?? 0); setOpen(true); } }}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">{trigger}</button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Home') { e.preventDefault(); move('first'); }
            else if (e.key === 'End') { e.preventDefault(); move('last'); }
            else if (e.key === 'Tab') setOpen(false);
          }}
          className="absolute right-0 z-40 mt-1 min-w-44 rounded-md border border-line bg-surface p-1 shadow-pop">
          {items.map((it, i) => (
            <button key={it.label} type="button" role="menuitem" data-index={i} tabIndex={i === active ? 0 : -1} disabled={it.disabled}
              onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}
              className={cn('flex w-full items-center rounded px-3 py-1.5 text-left text-[13px] hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-50', it.danger && 'text-danger')}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hover/focus tooltip wired with aria-describedby. Content is also reachable by keyboard focus. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs text-bg group-hover:block group-focus-within:block">{text}</span>
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-md bg-surface-2 p-1"
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.id === value);
        if (e.key === 'ArrowRight') onChange((tabs[(i + 1) % tabs.length] as { id: T }).id);
        if (e.key === 'ArrowLeft') onChange((tabs[(i - 1 + tabs.length) % tabs.length] as { id: T }).id);
      }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}
          className={cn('rounded px-3 py-1 text-[13px] font-medium', t.id === value ? 'bg-surface shadow-card' : 'text-muted hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}
