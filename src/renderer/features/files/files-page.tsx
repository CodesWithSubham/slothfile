import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ExternalLink, ListChecks, Sparkles } from 'lucide-react';
import { Button, Card, Checkbox, EmptyState, ErrorState, IconButton, LoadingState, PageHeader, Pagination, SearchInput, Select, StatusIndicator, Table, Td, Th, FileTypeIcon, useToast } from '../../components/ui';
import { useAiStatus, useApiMutation, useFiles, useFolders, useJobs } from '../../hooks/use-api';
import { api, unwrap, errorMessage } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { useUi } from '../../stores/ui-store';
import { JobProgressCard } from '../folders/job-progress';

const PAGE = 50;

function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function FilesPage() {
  const nav = useNavigate();
  const toast = useToast();
  const folders = useFolders();
  const ai = useAiStatus();
  const jobs = useJobs();
  const { activeFolderId, setActiveFolder, selectedFileIds, toggleFile, setSelectedFiles, clearSelection, setActivePlan } = useUi();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const q = useDebounced(search);
  const folderId = activeFolderId ?? folders.data?.[0]?.id;

  useEffect(() => setOffset(0), [q, status, folderId]);
  const files = useFiles({ folderId, search: q || undefined, classificationStatus: (status || undefined) as never, limit: PAGE, offset });
  const classify = useApiMutation((fileIds: string[]) => api()['ai.classify']({ fileIds }), { success: 'AI classification started.' });
  const createPlan = useApiMutation((i: { folderId: string; fileIds: string[] }) => api()['plans.create'](i), {
    onSuccess: (p) => { setActivePlan(p.planId); clearSelection(); nav('/organize'); }
  });
  const classifyJob = (jobs.data ?? []).find((j) => j.type === 'classify' && (j.status === 'running' || j.status === 'queued'));

  const items = files.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((f) => selectedFileIds.has(f.id));
  const ids = [...selectedFileIds];

  return (
    <>
      <PageHeader title="Files" description="Everything found by your last scan. Select files to get AI suggestions or to build an organization plan. Nothing moves until you approve it."
        actions={<>
          <Button icon={<Sparkles className="size-4" />} disabled={!ids.length || ai.data?.state !== 'ready'} loading={classify.isPending}
            title={ai.data?.state !== 'ready' ? ai.data?.message : undefined} onClick={() => classify.mutate(ids)}>Suggest with AI</Button>
          <Button variant="primary" icon={<ListChecks className="size-4" />} disabled={!ids.length || !folderId} loading={createPlan.isPending}
            onClick={() => folderId && createPlan.mutate({ folderId, fileIds: ids })}>Build plan ({ids.length})</Button>
        </>} />
      {ai.data && ai.data.state !== 'ready' && <p className="mb-3 text-[13px] text-muted">AI suggestions are unavailable: {ai.data.message} You can still build a plan; files keep their names and go to "Other" until you edit them.</p>}
      {classifyJob && <div className="mb-4"><JobProgressCard job={classifyJob} /></div>}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SearchInput label="Search files" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          {(folders.data?.length ?? 0) > 1 && (
            <Select aria-label="Folder" className="w-48" value={folderId ?? ''} onChange={(e) => { setActiveFolder(e.target.value); }}>
              {folders.data?.map((f) => <option key={f.id} value={f.id}>{f.displayName}</option>)}
            </Select>
          )}
          <Select aria-label="Classification status" className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option><option value="none">Not classified</option><option value="classified">Classified</option><option value="failed">Failed</option>
          </Select>
          <span className="ml-auto text-xs text-muted">{ids.length} selected</span>
        </div>
        {files.isLoading && <LoadingState label="Loading files" />}
        {files.error && <div className="p-3"><ErrorState message={files.error.message} onRetry={() => void files.refetch()} /></div>}
        {files.data && items.length === 0 && <EmptyState title={q || status ? 'No files match' : 'No files yet'} description={q || status ? 'Try a different search or filter.' : 'Scan a folder first from "Folders & scan".'} />}
        {items.length > 0 && (
          <>
            <Table aria-label="Scanned files">
              <thead><tr>
                <Th className="w-8"><Checkbox label="Select all files on this page" checked={allOnPage} onChange={(e) => (e.target.checked ? setSelectedFiles([...new Set([...selectedFileIds, ...items.map((f) => f.id)])]) : setSelectedFiles([...selectedFileIds].filter((id) => !items.some((f) => f.id === id))))} /></Th>
                <Th>Name</Th><Th>Type</Th><Th>Size</Th><Th>Modified</Th><Th>Location</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th>
              </tr></thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id} className="hover:bg-surface-2/60">
                    <Td><Checkbox label={`Select ${f.name}`} checked={selectedFileIds.has(f.id)} onChange={() => toggleFile(f.id)} /></Td>
                    <Td><span className="flex items-center gap-2"><FileTypeIcon extension={f.extension} /><span className="break-all">{f.name}</span></span></Td>
                    <Td className="text-muted">{f.extension || '—'}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatBytes(f.size)}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(f.modifiedAt)}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs text-muted" title={f.relativePath}>{f.relativePath.includes('/') || f.relativePath.includes('\\') ? f.relativePath.replace(/[\\/][^\\/]*$/, '') : '.'}</Td>
                    <Td><span className="flex flex-wrap gap-1"><StatusIndicator status={f.classificationStatus} />{f.hashStatus !== 'none' && <StatusIndicator status={f.hashStatus} />}</span></Td>
                    <Td><IconButton label={`Show ${f.name} in file manager`} onClick={() => { unwrap(api()['files.reveal']({ fileId: f.id })).catch((e) => toast.show('error', errorMessage(e))); }}><ExternalLink className="size-4" /></IconButton></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="px-3 pb-3"><Pagination offset={offset} limit={PAGE} total={files.data?.total ?? 0} onChange={setOffset} /></div>
          </>
        )}
      </Card>
    </>
  );
}
