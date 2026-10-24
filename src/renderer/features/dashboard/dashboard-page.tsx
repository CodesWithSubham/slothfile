import { Link } from 'react-router';
import { FolderPlus, Sparkles } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusIndicator } from '../../components/ui';
import { useAiStatus, useAppInfo, useApiMutation, useDashboard } from '../../hooks/use-api';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { SUPPORTING_MESSAGE, TAGLINE } from '@shared/constants';

function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const body = (<><p className="text-xs uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p></>);
  return <Card className="p-4">{to ? <Link to={to} className="block">{body}</Link> : body}</Card>;
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();
  const ai = useAiStatus();
  const info = useAppInfo();
  const select = useApiMutation(() => api()['folders.select'](), { success: (f) => (f ? 'Folder added.' : null) });

  if (isLoading) return <LoadingState label="Loading dashboard" />;
  if (error || !data) return <ErrorState message={error?.message ?? 'Unknown error'} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader title="Welcome to SlothFile" description={`${TAGLINE} ${SUPPORTING_MESSAGE}`}
        actions={<Button variant="primary" icon={<FolderPlus className="size-4" />} loading={select.isPending} onClick={() => select.mutate(undefined)}>Choose folder…</Button>} />

      {info.data && (info.data.recovery.length > 0 || info.data.interruptedJobs > 0) && (
        <Card className="mb-5 border-warn/50 bg-warn-soft p-4">
          <p className="font-medium text-warn">SlothFile closed unexpectedly last time</p>
          <ul className="mt-1 list-disc pl-5 text-[13px]">
            {info.data.recovery.map((r) => <li key={r.historyId}>{r.message}</li>)}
            {info.data.interruptedJobs > 0 && <li>{info.data.interruptedJobs} background job(s) were stopped. They were not resumed automatically.</li>}
          </ul>
          <p className="mt-1 text-[13px]">Check <Link className="underline" to="/history">History</Link> for details.</p>
        </Card>
      )}

      {data.folders.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderPlus className="size-9" />} title="Start with a folder"
            description="SlothFile scans a folder you choose, suggests where each file belongs, and waits for your approval before moving anything. It works without AI too."
            action={<Button variant="primary" onClick={() => select.mutate(undefined)}>Choose folder…</Button>} />
        </Card>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Files scanned" value={data.fileCount.toLocaleString()} to="/files" />
            <Stat label="Pending proposals" value={data.pendingProposals.toLocaleString()} to="/organize" />
            <Stat label="Completed moves" value={data.completedOperations.toLocaleString()} to="/history" />
            <Stat label="Duplicate groups" value={data.duplicateGroupCount.toLocaleString()} to="/duplicates" />
          </section>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h2 className="font-display text-lg font-semibold">Recent activity</h2>
              {data.recentHistory.length === 0 ? <p className="mt-2 text-[13px] text-muted">No file has been moved yet.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {data.recentHistory.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                      <span className="truncate font-mono text-xs">{h.destinationPath.split(/[\\/]/).slice(-2).join('/')}</span>
                      <span className="flex shrink-0 items-center gap-2"><StatusIndicator status={h.undoStatus === 'undone' ? 'undone' : h.status} /><span className="text-xs text-muted">{formatDate(h.startedAt)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4">
              <h2 className="font-display text-lg font-semibold">Folders</h2>
              <ul className="mt-2 space-y-1 text-[13px]">{data.folders.map((f) => <li key={f.id} className="truncate" title={f.path}>{f.displayName}</li>)}</ul>
              <p className="mt-3 text-xs text-muted">Last scan: {formatDate(data.lastScanAt)}</p>
              <Link to="/folders" className="mt-2 inline-block text-[13px] text-accent underline">Manage folders</Link>
            </Card>
          </div>
        </>
      )}

      <Card className="mt-6 flex items-start gap-3 p-4">
        <Sparkles className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="text-[13px]">
          <p className="font-medium">AI suggestions <Badge tone={ai.data?.state === 'ready' ? 'accent' : 'neutral'}>{ai.data?.state === 'ready' ? 'Available' : ai.isLoading ? 'Checking…' : 'Not available'}</Badge></p>
          <p className="mt-1 text-muted">{ai.data?.message ?? 'Checking for a local Ollama installation…'}</p>
          <p className="mt-1 text-muted">AI is optional: scanning, duplicates, manual organizing, history and Undo all work without it.</p>
        </div>
      </Card>
    </>
  );
}
