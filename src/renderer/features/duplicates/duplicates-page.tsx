import { Copy, Fingerprint } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';
import { useApiMutation, useDuplicates, useFolders } from '../../hooks/use-api';
import { api } from '../../lib/api';
import { formatBytes, shortHash } from '../../lib/format';

export function DuplicatesPage() {
  const dups = useDuplicates();
  const folders = useFolders();
  const hash = useApiMutation((i: { force: boolean }) => api()['hash.start']({ force: i.force }), { success: 'Comparing file contents…' });
  const savable = (dups.data ?? []).reduce((n, g) => n + g.size * (g.files.length - 1), 0);

  return (
    <>
      <PageHeader title="Duplicates" description="Files grouped by an identical SHA-256 content fingerprint. Identical fingerprints very strongly indicate identical content. SlothFile never deletes, merges or moves duplicates for you."
        actions={<><Button icon={<Fingerprint className="size-4" />} loading={hash.isPending} disabled={!folders.data?.length} onClick={() => hash.mutate({ force: false })}>Find duplicates</Button><Button disabled={!folders.data?.length} onClick={() => hash.mutate({ force: true })}>Re-check all</Button></>} />
      <p className="mb-4 text-[13px] text-muted">Only files with the same size are hashed, since different sizes can never be identical. Matching names or sizes alone are never treated as duplicates.</p>
      {dups.isLoading && <LoadingState label="Loading duplicates" />}
      {dups.error && <ErrorState message={dups.error.message} onRetry={() => void dups.refetch()} />}
      {dups.data?.length === 0 && <Card><EmptyState icon={<Copy className="size-8" />} title="No duplicates found" description="Run “Find duplicates” after scanning a folder. Groups appear here when two or more files have identical contents." /></Card>}
      {(dups.data?.length ?? 0) > 0 && <p className="mb-3 text-[13px]"><Badge tone="info">{dups.data?.length} group(s)</Badge> Up to {formatBytes(savable)} is occupied by extra copies.</p>}
      <ul className="space-y-4">
        {dups.data?.map((g) => (
          <li key={g.hash}>
            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px]">
                <span className="font-medium">{g.files.length} identical files · {formatBytes(g.size)} each</span>
                <span className="font-mono text-xs text-muted" title={g.hash}>SHA-256 {shortHash(g.hash)}…</span>
              </div>
              <ul className="divide-y divide-line">
                {g.files.map((f) => <li key={f.id} className="px-4 py-2 text-[13px]"><p className="break-all font-medium">{f.name}</p><p className="break-all font-mono text-[11px] text-muted">{f.path}</p></li>)}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
