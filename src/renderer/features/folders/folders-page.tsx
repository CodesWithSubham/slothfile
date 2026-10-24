import { Copy, FolderPlus, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmationDialog, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useApiMutation, useFolders, useJobs } from '../../hooks/use-api';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { JobProgressCard } from './job-progress';
import type { FolderRecord } from '@shared/types/domain';

export function FoldersPage() {
  const folders = useFolders();
  const jobs = useJobs();
  const [removing, setRemoving] = useState<FolderRecord | null>(null);
  const select = useApiMutation(() => api()['folders.select'](), { success: (f) => (f ? 'Folder added. Nothing has been scanned yet.' : null) });
  const scan = useApiMutation((folderId: string) => api()['scan.start']({ folderId }));
  const hash = useApiMutation((folderId: string) => api()['hash.start']({ folderId }), { success: 'Comparing file contents.' });
  const remove = useApiMutation((folderId: string) => api()['folders.remove']({ folderId }), { success: 'Folder removed from SlothFile. Your files were not touched.', onSuccess: () => setRemoving(null) });
  const recent = (jobs.data ?? []).filter((j) => j.type === 'scan' || j.type === 'hash').slice(0, 3);

  return (
    <>
      <PageHeader title="Folders & scan" description="Choose a folder, then scan it. SlothFile only reads file names, sizes and dates during a scan; it records the folder's path on this computer so it can find your files again."
        actions={<Button variant="primary" icon={<FolderPlus className="size-4" />} loading={select.isPending} onClick={() => select.mutate(undefined)}>Choose folder…</Button>} />
      {folders.isLoading && <LoadingState label="Loading folders" />}
      {folders.error && <ErrorState message={folders.error.message} onRetry={() => void folders.refetch()} />}
      {folders.data?.length === 0 && (
        <Card><EmptyState icon={<FolderPlus className="size-8" />} title="No folders yet" description="Pick a cluttered folder such as Downloads. Nothing is scanned or changed until you ask." action={<Button variant="primary" onClick={() => select.mutate(undefined)}>Choose folder…</Button>} /></Card>
      )}
      <ul className="space-y-3">
        {folders.data?.map((f) => (
          <li key={f.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{f.displayName}</p>
                <p className="truncate font-mono text-xs text-muted" title={f.path}>{f.path}</p>
                <p className="mt-1 text-xs text-muted">{f.lastScannedAt ? `Last scanned ${formatDate(f.lastScannedAt)}` : <Badge>Not scanned yet</Badge>}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" icon={<Play className="size-3.5" />} loading={scan.isPending && scan.variables === f.id} onClick={() => scan.mutate(f.id)}>Scan</Button>
                <Button size="sm" icon={<Copy className="size-3.5" />} disabled={!f.lastScannedAt} onClick={() => hash.mutate(f.id)}>Find duplicates</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(f)}>Remove</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {recent.length > 0 && <section className="mt-8 space-y-3" aria-label="Recent jobs"><h2 className="font-display text-lg font-semibold">Activity</h2>{recent.map((j) => <JobProgressCard key={j.id} job={j} />)}</section>}
      <ConfirmationDialog open={!!removing} onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} loading={remove.isPending}
        title="Remove this folder from SlothFile?" confirmLabel="Remove from SlothFile" danger>
        <p className="text-[13px]">SlothFile will forget its scan results, plans and history for <strong>{removing?.displayName}</strong>. Your files stay exactly where they are; no file is deleted or moved.</p>
      </ConfirmationDialog>
    </>
  );
}
