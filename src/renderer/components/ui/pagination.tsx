import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './button';

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-1 pt-3 text-[13px] text-muted">
      <span aria-live="polite">{from}–{to} of {total.toLocaleString()}</span>
      <div className="flex gap-1">
        <IconButton label="Previous page" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}><ChevronLeft className="size-4" /></IconButton>
        <IconButton label="Next page" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}><ChevronRight className="size-4" /></IconButton>
      </div>
    </nav>
  );
}
