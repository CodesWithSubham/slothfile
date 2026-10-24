import { X } from 'lucide-react';
import type { JobSnapshot } from '@shared/types/domain';
import { Button, Card, Progress, StatusIndicator } from '../../components/ui';
import { api, unwrap } from '../../lib/api';

const TITLES = { scan: 'Scanning', hash: 'Comparing contents', classify: 'Classifying with AI', execute: 'Applying changes' } as const;

export function JobProgressCard({ job }: { job: JobSnapshot }) {
  const active = job.status === 'queued' || job.status === 'running';
  const determinate = job.total !== null && job.total > 0;
  return (
    <Card className="p-4" >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{TITLES[job.type]} <StatusIndicator status={job.status} /></p>
          <p className="text-[13px] text-muted" aria-live="polite">
            {job.phase ?? 'Starting'} · {job.completed.toLocaleString()} processed
            {job.skipped > 0 && ` · ${job.skipped} skipped`}{job.failed > 0 && ` · ${job.failed} failed`}
          </p>
        </div>
        {active && <Button size="sm" icon={<X className="size-3.5" />} onClick={() => { void unwrap(api()['jobs.cancel']({ jobId: job.id })); }}>{job.cancelRequested ? 'Cancelling…' : 'Cancel'}</Button>}
      </div>
      {active && <div className="mt-3"><Progress label={`${TITLES[job.type]} progress`} value={determinate ? job.completed + job.failed : null} max={job.total ?? 100} /></div>}
      {job.status === 'failed' && <p role="alert" className="mt-2 text-[13px] text-danger">{job.errorMessage}</p>}
      {job.status === 'cancelled' && <p className="mt-2 text-[13px] text-muted">Cancelled. Files already scanned were kept; nothing was moved.</p>}
      {job.status === 'completed' && job.type === 'scan' && <p className="mt-2 text-[13px] text-muted">Finished: {job.completed.toLocaleString()} files read, {job.skipped} skipped (links or special files), {job.failed} could not be read.</p>}
    </Card>
  );
}
