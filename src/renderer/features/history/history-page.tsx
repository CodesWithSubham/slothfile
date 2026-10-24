import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { HistoryItem } from '@shared/types/domain';
import { Button, Card, ConfirmationDialog, Dialog, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, StatusIndicator, Table, Td, Th, useToast } from '../../components/ui';
import { useApiMutation, useHistory } from '../../hooks/use-api';
import { api } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';

const PAGE = 25;

export function HistoryPage() {
  const [offset, setOffset] = useState(0);
  const history = useHistory(PAGE, offset);
  const toast = useToast();
  const [undoing, setUndoing] = useState<HistoryItem | null>(null);
  const [detail, setDetail] = useState<HistoryItem | null>(null);
  const undo = useApiMutation((historyId: string) => api()['history.undo']({ historyId }), {
    onSuccess: (r) => { toast.show(r.ok ? 'success' : 'error', r.message); setUndoing(null); }
  });

  return (
    <>
      <PageHeader title="History" description="Every move SlothFile has attempted. Undo is offered only when it is safe: the file must be unchanged and the original spot must be free. Undo is not a backup." />
      {history.isLoading && <LoadingState label="Loading history" />}
      {history.error && <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />}
      {history.data?.items.length === 0 && <Card><EmptyState title="Nothing here yet" description="Moves you approve and run will be listed here." /></Card>}
      {(history.data?.items.length ?? 0) > 0 && (
        <Card>
          <Table aria-label="Operation history">
            <thead><tr><Th>When</Th><Th>From → To</Th><Th>Result</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {history.data?.items.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDate(h.startedAt)}</Td>
                  <Td><p className="break-all font-mono text-[11px]">{h.sourcePath}</p><p className="break-all font-mono text-[11px] text-muted">→ {h.destinationPath}</p>
                    {h.errorMessage && <p className="mt-1 text-xs text-danger">{h.errorMessage}</p>}
                    {h.status === 'completed' && !h.canUndo && h.undoBlockedReason && h.undoStatus !== 'undone' && <p className="mt-1 text-xs text-warn">Undo unavailable: {h.undoBlockedReason}</p>}</Td>
                  <Td><StatusIndicator status={h.undoStatus === 'undone' ? 'undone' : h.status} /></Td>
                  <Td><span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setDetail(h)} aria-label="View details">Details</Button>
                    <Button size="sm" icon={<Undo2 className="size-3.5" />} disabled={!h.canUndo} onClick={() => setUndoing(h)}>Undo</Button></span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="px-3 pb-3"><Pagination offset={offset} limit={PAGE} total={history.data?.total ?? 0} onChange={setOffset} /></div>
        </Card>
      )}
      <ConfirmationDialog open={!!undoing} onCancel={() => setUndoing(null)} loading={undo.isPending} confirmLabel="Move it back" onConfirm={() => undoing && undo.mutate(undoing.id)} title="Move this file back?">
        <p className="break-all text-[13px]">The file will return to <span className="font-mono text-xs">{undoing?.sourcePath}</span>. It is re-checked first; if anything looks different, SlothFile will refuse rather than guess.</p>
      </ConfirmationDialog>
      <Dialog open={!!detail} onClose={() => setDetail(null)} title="Operation details" wide footer={<Button variant="primary" onClick={() => setDetail(null)}>Close</Button>}>
        {detail && (
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-muted">Status</dt><dd><StatusIndicator status={detail.status} /></dd>
            <dt className="text-muted">Started</dt><dd>{formatDate(detail.startedAt)}</dd>
            <dt className="text-muted">Finished</dt><dd>{formatDate(detail.finishedAt)}</dd>
            <dt className="text-muted">From</dt><dd className="break-all font-mono text-xs">{detail.sourcePath}</dd>
            <dt className="text-muted">To</dt><dd className="break-all font-mono text-xs">{detail.destinationPath}</dd>
            <dt className="text-muted">Size</dt><dd>{formatBytes(detail.sourceFingerprint.size)}</dd>
            <dt className="text-muted">Error</dt><dd>{detail.errorCode ? `${detail.errorCode}: ${detail.errorMessage}` : '—'}</dd>
            <dt className="text-muted">Undo</dt><dd>{detail.undoStatus === 'undone' ? `Reversed ${formatDate(detail.undoneAt)}` : detail.undoMessage ?? (detail.canUndo ? 'Available' : detail.undoBlockedReason ?? '—')}</dd>
          </dl>
        )}
      </Dialog>
    </>
  );
}
