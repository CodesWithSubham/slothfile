import type { ReactNode } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Button } from './button';
import { Card } from './display';

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-muted" aria-hidden>{icon}</div>}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-12 text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /><span>{label}…</span></div>;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <Card className="border-danger/40">
      <div role="alert" className="flex items-start gap-3 p-4">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{message}</p>
        </div>
        {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
      </div>
    </Card>
  );
}
