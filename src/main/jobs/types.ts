export type JobType = 'scan' | 'hash' | 'classify' | 'execute';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface JobSnapshot {
  id: string;
  type: JobType;
  status: JobStatus;
  phase: string | null;
  total: number | null;
  completed: number;
  failed: number;
  skipped: number;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

/** Legal transitions only. Terminal states have no outgoing edges. */
export const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled', 'interrupted'],
  running: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: []
};

export const canTransition = (from: JobStatus, to: JobStatus): boolean => TRANSITIONS[from].includes(to);
