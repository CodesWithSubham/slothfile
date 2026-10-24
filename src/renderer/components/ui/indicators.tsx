import { Archive, File, FileText, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Badge, type Tone } from './display';

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const ARCHIVE = new Set(['.zip', '.rar', '.7z', '.tar', '.gz']);
const TEXT = new Set(['.txt', '.md', '.pdf', '.doc', '.docx', '.rtf', '.csv']);

export function FileTypeIcon({ extension, className }: { extension: string; className?: string }) {
  const e = extension.toLowerCase();
  const Icon = IMAGE.has(e) ? ImageIcon : ARCHIVE.has(e) ? Archive : TEXT.has(e) ? FileText : File;
  return <Icon className={cn('size-4 shrink-0 text-muted', className)} aria-hidden />;
}

/** Confidence is shown as number + bar + words, never colour alone. It is the model's self-report, not a measured accuracy. */
export function ConfidenceIndicator({ value, threshold = 0.6 }: { value: number | null; threshold?: number }) {
  if (value === null) return <span className="text-xs text-muted">No AI suggestion</span>;
  const pct = Math.round(value * 100);
  const low = value < threshold;
  return (
    <span className="inline-flex items-center gap-2" title="The model's own estimate. It is a suggestion, not a verified fact.">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden><span className={cn('block h-full rounded-full', low ? 'bg-warn' : 'bg-accent')} style={{ width: `${pct}%` }} /></span>
      <span className="text-xs tabular-nums">{pct}%</span>
      <span className={cn('text-xs', low ? 'text-warn' : 'text-muted')}>{low ? 'Low confidence' : 'AI suggestion'}</span>
    </span>
  );
}

const statusMap: Record<string, { tone: Tone; label: string }> = {
  proposed: { tone: 'neutral', label: 'Proposed' }, approved: { tone: 'accent', label: 'Approved' }, rejected: { tone: 'neutral', label: 'Rejected' },
  executing: { tone: 'info', label: 'Running' }, completed: { tone: 'accent', label: 'Completed' }, failed: { tone: 'danger', label: 'Failed' },
  interrupted: { tone: 'warn', label: 'Interrupted' }, started: { tone: 'info', label: 'In progress' }, undone: { tone: 'neutral', label: 'Reversed' },
  none: { tone: 'neutral', label: 'Not classified' }, classified: { tone: 'accent', label: 'Classified' }, pending: { tone: 'info', label: 'Pending' },
  skipped: { tone: 'neutral', label: 'Skipped' }, hashed: { tone: 'accent', label: 'Hashed' }, stale: { tone: 'warn', label: 'Needs re-hash' },
  queued: { tone: 'neutral', label: 'Queued' }, running: { tone: 'info', label: 'Running' }, cancelled: { tone: 'neutral', label: 'Cancelled' }
};
export function StatusIndicator({ status }: { status: string }) {
  const s = statusMap[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
