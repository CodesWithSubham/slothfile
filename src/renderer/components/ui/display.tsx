import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info'
};
export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-surface shadow-card', className)} {...rest} />;
}

export function Separator({ className }: { className?: string }) {
  return <hr role="separator" className={cn('border-0 border-t border-line', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-md bg-[linear-gradient(90deg,var(--sf-surface-2),var(--sf-border),var(--sf-surface-2))] bg-[length:200%_100%] [animation:sf-shimmer_1.4s_linear_infinite]', className)} />;
}

export interface ProgressProps { value: number | null; max?: number; label: string; }
/** `value=null` renders an indeterminate bar. */
export function Progress({ value, max = 100, label }: ProgressProps) {
  const pct = value === null ? null : Math.min(100, Math.max(0, (value / (max || 1)) * 100));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined} className="h-2 overflow-hidden rounded-full bg-surface-2">
      <div className={cn('h-full rounded-full bg-accent transition-[width]', pct === null && 'w-1/3 animate-pulse')} style={pct === null ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <div className="sf-scroll overflow-x-auto"><table className={cn('w-full border-collapse text-left text-[13px]', className)} {...rest} /></div>;
}
export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted', className)} {...rest} />;
}
export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-line/60 px-3 py-2 align-top', className)} {...rest} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
