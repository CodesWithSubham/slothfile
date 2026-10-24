/**
 * Zod-free list of every IPC request name plus channel constants. The sandboxed preload script imports
 * ONLY this file: a sandboxed preload cannot require npm packages such as zod.
 */
export const IPC_NAMES = [
  'app.info',
  'dashboard.get',
  'folders.select',
  'folders.list',
  'folders.remove',
  'scan.start',
  'hash.start',
  'jobs.get',
  'jobs.list',
  'jobs.cancel',
  'files.list',
  'files.reveal',
  'files.classification',
  'duplicates.list',
  'ai.status',
  'ai.classify',
  'plans.create',
  'plans.get',
  'plans.edit',
  'plans.approve',
  'plans.execute',
  'history.list',
  'history.undo',
  'settings.get',
  'settings.update',
  'data.clear'
] as const;

export const JOB_EVENT_CHANNEL = 'slothfile:job-update' as const;
export const IPC_INVOKE_CHANNEL = 'slothfile:invoke' as const;
