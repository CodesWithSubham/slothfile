import { AppError } from '@shared/errors';
import type { FilesRepo, FileRecord } from '../database/repositories/files-repo';
import { hashFile } from '../filesystem/hashing/hash-file';
import { scanFolder, type ScannedFile } from '../filesystem/scanning/scanner';
import type { JobContext } from '../jobs/job-manager';
import type { Logger } from 'pino';

const BATCH = 200;

/** Scan: enumerate and persist metadata in batched transactions. Missing files are only flagged after a COMPLETE scan. */
export async function runScan(files: FilesRepo, folderId: string, excludedDirs: string[], ctx: JobContext, log: Logger): Promise<void> {
  const folder = files.getFolder(folderId);
  if (!folder) throw new AppError('NOT_FOUND', 'That folder is no longer in SlothFile.');
  const scanTime = Date.now();
  ctx.setPhase('Scanning files');
  let batch: ScannedFile[] = [];
  const flush = (): void => { if (batch.length) { files.upsertBatch(folderId, batch, scanTime); ctx.progress({ completed: batch.length }); batch = []; } };
  const summary = await scanFolder({
    root: folder.path, excludedDirs, signal: ctx.signal,
    onFile: (f) => { batch.push(f); if (batch.length >= BATCH) flush(); },
    onIssue: (i) => { ctx.progress({ [i.reason === 'symlink-skipped' || i.reason === 'special-file-skipped' ? 'skipped' : 'failed']: 1 }); }
  });
  flush();
  if (summary.cancelled) return; // partial scan: do not flag anything missing
  const gone = files.markMissingNotSeenSince(folderId, scanTime);
  files.markScanned(folderId);
  log.info({ files: summary.files, dirs: summary.directories, skipped: summary.skipped, failed: summary.failed, gone }, 'scan finished');
}

/** Hash only files whose size matches another file's (unique sizes cannot be duplicates). Streaming and cancellable. */
export async function runHash(files: FilesRepo, folderId: string | undefined, ctx: JobContext, opts: { force?: boolean } = {}): Promise<void> {
  if (opts.force) files.markAllHashesStale(folderId);
  const todo: FileRecord[] = files.filesNeedingHash(folderId);
  ctx.setTotal(todo.length);
  ctx.setPhase('Comparing file contents');
  for (const f of todo) {
    if (ctx.signal.aborted) return;
    try {
      const r = await hashFile(f.path, ctx.signal);
      files.setHash(f.id, r.sha256);
      ctx.progress({ completed: 1 });
    } catch (e) {
      if (e instanceof AppError && e.code === 'JOB_CANCELLED') return;
      files.setHashFailed(f.id);
      ctx.progress({ failed: 1 });
    }
  }
}
