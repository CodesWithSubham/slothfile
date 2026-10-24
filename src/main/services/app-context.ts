import type { Logger } from 'pino';
import { AppError } from '@shared/errors';
import { openDatabase, type Db } from '../database/connection';
import { FilesRepo } from '../database/repositories/files-repo';
import { OperationsRepo } from '../database/repositories/operations-repo';
import { SettingsRepo } from '../database/repositories/settings-repo';
import { JobManager } from '../jobs/job-manager';
import { OllamaProvider } from '../ai/providers/ollama-provider';
import type { AIProvider } from '../ai/providers/types';
import { PlanService } from '../operations/planning/plan-service';
import { reconcileInFlight } from '../operations/recovery/reconcile';
import type { RecoveryNotice } from '@shared/types/domain';

export interface AppContext {
  db: Db;
  log: Logger;
  settings: SettingsRepo;
  files: FilesRepo;
  ops: OperationsRepo;
  jobs: JobManager;
  plans: PlanService;
  ai: AIProvider;
  recovery: RecoveryNotice[];
  interruptedJobs: number;
  close(): Promise<void>;
}

/**
 * Startup order matters for safety: open DB -> migrate -> reconcile interrupted file operations
 * against the real filesystem -> mark stale jobs interrupted. No job is ever auto-resumed.
 * The AI provider is constructed lazily and is never contacted here, so a missing Ollama cannot block startup.
 */
export async function createAppContext(dbFile: string, log: Logger, aiOverride?: AIProvider): Promise<AppContext> {
  let opened;
  try { opened = openDatabase(dbFile); } catch (e) { log.error({ err: e instanceof AppError ? e.code : 'unknown' }, 'database open failed'); throw e; }
  const { db, migrations } = opened;
  log.info({ applied: migrations.applied, version: migrations.currentVersion }, 'database ready');

  const settings = new SettingsRepo(db);
  const files = new FilesRepo(db);
  const ops = new OperationsRepo(db);
  const jobs = new JobManager(db);
  const interruptedJobs = jobs.markStaleJobsInterrupted();
  const recovery = await reconcileInFlight(ops);
  if (recovery.length) log.warn({ count: recovery.length, results: recovery.map((r) => r.result) }, 'reconciled interrupted operations');

  const plans = new PlanService(files, ops, () => {
    const s = settings.get();
    return { excludedDirs: s.excludedDirs, confidenceThreshold: s.confidenceThreshold };
  });
  const ai = aiOverride ?? new OllamaProvider(() => settings.get());

  return {
    db, log, settings, files, ops, jobs, plans, ai, recovery, interruptedJobs,
    async close() {
      await jobs.shutdown();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
  };
}
