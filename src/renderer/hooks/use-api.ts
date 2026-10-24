import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { IpcInput, IpcResult } from '@shared/contracts';
import type { JobSnapshot } from '@shared/types/domain';
import { api, unwrap } from '../lib/api';
import { qk } from '../lib/query-keys';
import { useToast } from '../components/ui';
import { errorMessage } from '../lib/api';

export const useAppInfo = () => useQuery({ queryKey: qk.appInfo, queryFn: () => unwrap(api()['app.info']()), staleTime: Infinity });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard, queryFn: () => unwrap(api()['dashboard.get']()) });
export const useFolders = () => useQuery({ queryKey: qk.folders, queryFn: () => unwrap(api()['folders.list']()) });
export const useFiles = (q: IpcInput<'files.list'>) => useQuery({ queryKey: qk.files(q), queryFn: () => unwrap(api()['files.list'](q)), placeholderData: (p) => p });
export const useDuplicates = (folderId?: string) => useQuery({ queryKey: qk.duplicates(folderId), queryFn: () => unwrap(api()['duplicates.list']({ folderId })) });
export const useAiStatus = () => useQuery({ queryKey: qk.aiStatus, queryFn: () => unwrap(api()['ai.status']()), staleTime: 15_000, retry: false });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => unwrap(api()['settings.get']()) });
export const usePlan = (planId: string | null) => useQuery({ queryKey: qk.plan(planId), queryFn: () => unwrap(api()['plans.get']({ planId: planId as string })), enabled: !!planId });
export const useHistory = (limit: number, offset: number) => useQuery({ queryKey: qk.history(limit, offset), queryFn: () => unwrap(api()['history.list']({ limit, offset })), placeholderData: (p) => p });
export const useJobs = () => useQuery({ queryKey: qk.jobs, queryFn: () => unwrap(api()['jobs.list']()) });

function invalidateAll(qc: QueryClient): void {
  for (const key of [qk.dashboard, qk.filesAll, ['duplicates'], qk.historyAll, ['plan'], qk.folders]) void qc.invalidateQueries({ queryKey: key });
}

/** Pushes job progress into the query cache and refreshes data when a job finishes. Unsubscribes on unmount. */
export function useJobEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const off = window.slothfile.onJobUpdate((job: JobSnapshot) => {
      qc.setQueryData<JobSnapshot[]>(qk.jobs, (old) => [job, ...(old ?? []).filter((j) => j.id !== job.id)].slice(0, 20));
      if (!['queued', 'running'].includes(job.status)) invalidateAll(qc);
      else if (job.type === 'scan') void qc.invalidateQueries({ queryKey: qk.filesAll });
    });
    return off;
  }, [qc]);
}

/** Generic mutation wrapper: unwraps IPC results, reports failures as toasts, refreshes affected queries. */
export function useApiMutation<I, O>(fn: (input: I) => Promise<IpcResult<O>>, opts?: { success?: string | ((d: O) => string | null); onSuccess?: (d: O) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<O, Error, I>({
    mutationFn: (input) => unwrap(fn(input)),
    onSuccess: (d) => {
      const msg = typeof opts?.success === 'function' ? opts.success(d) : opts?.success;
      if (msg) toast.show('success', msg);
      invalidateAll(qc);
      opts?.onSuccess?.(d);
    },
    onError: (e) => toast.show('error', errorMessage(e))
  });
}
