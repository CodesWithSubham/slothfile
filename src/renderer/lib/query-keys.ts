import type { IpcInput } from '@shared/contracts';

export const qk = {
  appInfo: ['app-info'] as const,
  dashboard: ['dashboard'] as const,
  folders: ['folders'] as const,
  files: (q: IpcInput<'files.list'>) => ['files', q] as const,
  filesAll: ['files'] as const,
  duplicates: (folderId?: string) => ['duplicates', folderId ?? 'all'] as const,
  aiStatus: ['ai-status'] as const,
  plan: (planId: string | null) => ['plan', planId] as const,
  history: (limit: number, offset: number) => ['history', limit, offset] as const,
  historyAll: ['history'] as const,
  settings: ['settings'] as const,
  jobs: ['jobs'] as const
};
