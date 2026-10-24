import { shell } from 'electron';
import { AppError } from '@shared/errors';
import type { IpcInput, IpcName, IpcOutputs } from '@shared/contracts';
import type { ExecutionResult, HistoryItem, JobSnapshot } from '@shared/types/domain';
import type { AppContext } from '../services/app-context';
import { runClassification } from '../services/classification-service';
import { runHash, runScan } from '../services/scan-service';
import { checkUndoEligibility, undoOperation } from '../operations/undo/undo-operation';

export interface HostCapabilities {
  version: string; dataDir: string; logDir: string; platform: string;
  /** Opens the native folder picker. Returns null when cancelled. */
  pickFolder(): Promise<string | null>;
}

export type Handlers = { [K in IpcName]: (input: IpcInput<K>) => Promise<IpcOutputs[K]> | IpcOutputs[K] };

function scopeRootForPlan(ctx: AppContext, planId: string): string {
  const folderId = ctx.ops.getPlanFolderId(planId);
  const folder = folderId ? ctx.files.getFolder(folderId) : null;
  if (!folder) throw new AppError('NOT_FOUND', 'The folder this move belonged to is no longer tracked by SlothFile, so Undo is unavailable.');
  return folder.path;
}

export function createHandlers(ctx: AppContext, host: HostCapabilities, emitJob: (j: JobSnapshot) => void): { handlers: Handlers; dispose: () => void } {
  const dispose = ctx.jobs.onUpdate(emitJob);

  const handlers: Handlers = {
    'app.info': () => ({ version: host.version, dataDir: host.dataDir, logDir: host.logDir, platform: host.platform, recovery: ctx.recovery, interruptedJobs: ctx.interruptedJobs }),

    'dashboard.get': () => {
      const hist = ctx.ops.listHistory({ limit: 8, offset: 0 });
      const folders = ctx.files.listFolders();
      const pending = (ctx.db.prepare(`SELECT COUNT(*) c FROM planned_operations WHERE status IN ('proposed','approved')`).get() as { c: number }).c;
      const done = (ctx.db.prepare(`SELECT COUNT(*) c FROM operation_history WHERE status='completed' AND undo_status!='undone'`).get() as { c: number }).c;
      return {
        folders, fileCount: ctx.files.countFiles(), duplicateGroupCount: ctx.files.duplicateGroups().length, pendingProposals: pending, completedOperations: done,
        recentHistory: hist.items, lastScanAt: folders.reduce<number | null>((m, f) => (f.lastScannedAt && (!m || f.lastScannedAt > m) ? f.lastScannedAt : m), null)
      };
    },

    'folders.select': async () => {
      const p = await host.pickFolder();
      return p ? ctx.files.addFolder(p) : null;
    },
    'folders.list': () => ctx.files.listFolders(),
    'folders.remove': ({ folderId }) => { ctx.files.removeFolder(folderId); },

    'scan.start': ({ folderId }) => {
      if (!ctx.files.getFolder(folderId)) throw new AppError('NOT_FOUND', 'That folder is no longer tracked.');
      const excluded = ctx.settings.get().excludedDirs;
      return ctx.jobs.submit('scan', (c) => runScan(ctx.files, folderId, excluded, c, ctx.log));
    },
    'hash.start': ({ folderId, force }) => ctx.jobs.submit('hash', (c) => runHash(ctx.files, folderId, c, { force })),

    'jobs.get': ({ jobId }) => ctx.jobs.get(jobId),
    'jobs.list': () => ctx.jobs.list(),
    'jobs.cancel': ({ jobId }) => ctx.jobs.cancel(jobId),

    'files.list': (q) => ctx.files.listFiles(q),
    'files.reveal': ({ fileId }) => {
      const f = ctx.files.getFile(fileId); // path comes from our DB, never from the renderer
      if (!f) throw new AppError('NOT_FOUND', 'That file is not tracked.');
      shell.showItemInFolder(f.path);
    },
    'files.classification': ({ fileId }) => ctx.files.latestClassification(fileId),
    'duplicates.list': ({ folderId }) => ctx.files.duplicateGroups(folderId),

    'ai.status': () => ctx.ai.getStatus(),
    'ai.classify': ({ fileIds }) => {
      const settings = ctx.settings.get();
      return ctx.jobs.submit('classify', (c) => runClassification(ctx.files, ctx.ai, fileIds, settings, c, ctx.log));
    },

    'plans.create': ({ folderId, fileIds }) => ctx.plans.createPlan(folderId, fileIds),
    'plans.get': ({ planId }) => ctx.plans.preview(planId),
    'plans.edit': ({ operationId, category, fileName }) => ctx.plans.editOperation(operationId, { category, fileName }),
    'plans.approve': ({ operationIds, approved }) => ctx.plans.setApproval(operationIds, approved),
    // Execution runs as a tracked job so it shows progress, can be cancelled between files, and is awaited at shutdown.
    'plans.execute': ({ planId, confirmedOperationIds }) =>
      new Promise<ExecutionResult>((resolve, reject) => {
        try {
          const job = ctx.jobs.submit('execute', async (c) => {
            c.setTotal(confirmedOperationIds.length);
            c.setPhase('Moving files');
            let last = 0;
            try {
              const res = await ctx.plans.execute(planId, confirmedOperationIds, c.signal, (p) => {
                const done = p.done - last;
                last = p.done;
                if (done > 0) c.progress({ completed: done });
              });
              resolve(res);
            } catch (e) {
              reject(e);
              throw e;
            }
          });
          // A job cancelled while still queued never runs its body; make sure the caller is not left waiting.
          const off = ctx.jobs.onUpdate((j) => {
            if (j.id !== job.id || j.status === 'queued' || j.status === 'running') return;
            off();
            reject(new AppError('JOB_CANCELLED', 'Execution was cancelled before any file was moved.'));
          });
        } catch (e) {
          reject(e);
        }
      }),

    'history.list': async ({ limit, offset }) => {
      const { items, total } = ctx.ops.listHistory({ limit, offset });
      const out: HistoryItem[] = [];
      for (const e of items) {
        let canUndo = false;
        let reason: string | null = null;
        if (e.status === 'completed' && e.undoStatus === 'none') {
          try {
            const r = await checkUndoEligibility(e, scopeRootForPlan(ctx, e.planId));
            canUndo = r.ok;
            reason = r.ok ? null : r.reason;
          } catch (err) {
            reason = err instanceof AppError ? err.message : 'Undo could not be checked.';
          }
        } else if (e.status === 'completed' && e.undoStatus === 'undone') reason = 'Already undone.';
        else if (e.status !== 'completed') reason = 'Only completed moves can be undone.';
        out.push({ ...e, canUndo, undoBlockedReason: reason });
      }
      return { items: out, total };
    },
    'history.undo': async ({ historyId }) => {
      const e = ctx.ops.getHistory(historyId);
      if (!e) throw new AppError('NOT_FOUND', 'That history entry does not exist.');
      const root = scopeRootForPlan(ctx, e.planId);
      const res = await undoOperation(ctx.ops, historyId, root);
      if (res.ok) {
        const op = ctx.ops.getOperation(e.operationId);
        if (op) ctx.files.updateFilePath(op.fileId, e.sourcePath, root);
      }
      ctx.log.info({ ok: res.ok }, 'undo attempted');
      return res;
    },

    'settings.get': () => ctx.settings.get(),
    'settings.update': (patch) => ctx.settings.update(patch),

    'data.clear': () => {
      // Metadata only. This function has no code path that touches user files.
      ctx.files.clearAllMetadata();
      ctx.log.info('local metadata cleared');
    }
  };
  return { handlers, dispose };
}
