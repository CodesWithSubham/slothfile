import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from '@shared/errors';

export interface ScannedFile {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
}

export interface ScanIssue {
  path: string;
  reason: 'permission-denied' | 'vanished' | 'symlink-skipped' | 'special-file-skipped' | 'error';
}

export interface ScanOptions {
  root: string;
  excludedDirs: readonly string[];
  signal?: AbortSignal;
  /** Called for every regular file. Awaited, so the consumer applies back-pressure (batched DB writes). */
  onFile: (file: ScannedFile) => void | Promise<void>;
  onIssue?: (issue: ScanIssue) => void;
  onDirectory?: (dir: string) => void;
}

export interface ScanSummary {
  files: number;
  directories: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
}

/**
 * Iterative (stack-based, no recursion depth limit) scan using lstat/Dirent semantics:
 * symlinks and junction-like entries are reported and never followed, so traversal cannot leave `root`.
 * Entries are processed one directory at a time, so memory stays bounded by the widest directory.
 */
export async function scanFolder(opts: ScanOptions): Promise<ScanSummary> {
  const root = path.resolve(opts.root);
  const excluded = new Set(opts.excludedDirs.map((d) => d.toLowerCase()));
  const summary: ScanSummary = { files: 0, directories: 0, skipped: 0, failed: 0, cancelled: false };

  try {
    const st = await fs.lstat(root);
    if (!st.isDirectory()) throw new AppError('INVALID_PATH', 'The selected path is not a folder.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('FILE_NOT_FOUND', 'The selected folder is not available. It may have been moved, renamed or disconnected.', undefined, { cause: error });
  }

  const stack: string[] = [root];
  while (stack.length) {
    if (opts.signal?.aborted) { summary.cancelled = true; break; }
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      summary.failed++;
      opts.onIssue?.({ path: dir, reason: code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : code === 'ENOENT' ? 'vanished' : 'error' });
      continue;
    }
    summary.directories++;
    opts.onDirectory?.(dir);

    for (const entry of entries) {
      if (opts.signal?.aborted) { summary.cancelled = true; break; }
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) { summary.skipped++; opts.onIssue?.({ path: full, reason: 'symlink-skipped' }); continue; }
      if (entry.isDirectory()) {
        if (excluded.has(entry.name.toLowerCase())) { summary.skipped++; continue; }
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) { summary.skipped++; opts.onIssue?.({ path: full, reason: 'special-file-skipped' }); continue; }
      try {
        const st = await fs.lstat(full); // re-stat: also detects replacement by a symlink after readdir
        if (!st.isFile()) { summary.skipped++; opts.onIssue?.({ path: full, reason: 'symlink-skipped' }); continue; }
        await opts.onFile({
          path: full,
          relativePath: path.relative(root, full),
          name: entry.name,
          extension: path.extname(entry.name).toLowerCase(),
          size: st.size,
          modifiedAt: Math.trunc(st.mtimeMs)
        });
        summary.files++;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        summary.failed++;
        opts.onIssue?.({ path: full, reason: code === 'ENOENT' ? 'vanished' : code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : 'error' });
      }
    }
  }
  return summary;
}
