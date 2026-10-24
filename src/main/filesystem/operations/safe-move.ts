import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError, mapFsError } from '@shared/errors';
import { TEMP_PREFIX } from '@shared/constants';
import { fingerprintOf, sameContentFingerprint, type Fingerprint } from '../hashing/fingerprint';
import { hashFile } from '../hashing/hash-file';

/**
 * Safe, never-overwriting move.
 *
 * Strategy (same volume): `link(source, dest)` fails with EEXIST if dest exists, so it is an
 * atomic "create only if absent". Only after it succeeds is the source unlinked. A crash between
 * the two steps leaves both names present (never zero copies), which recovery can detect and finish.
 *
 * Fallback (different volume, or filesystem without hard links): copy to a hidden temp file in the
 * destination folder with COPYFILE_EXCL, verify SHA-256 against the source, publish it with
 * link (no-overwrite), then remove the temp and finally the source. If hard links are unavailable
 * on the destination, publish with a check-then-rename; that single case has a small residual race
 * (documented in docs/security.md).
 *
 * Nothing here ever deletes a file that was not just verified to be a byte-identical copy.
 */

export type MoveStep = 'validated' | 'dest-dir-ready' | 'dest-published' | 'source-removed';

export interface SafeMoveOptions {
  source: string;
  destination: string;
  expected: Fingerprint;
  /** Called after each durable step; used for journaling and for crash injection in tests. */
  onStep?: (step: MoveStep) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface SafeMoveResult {
  method: 'link' | 'copy-verify' | 'rename';
  destination: Fingerprint;
  createdDirs: string[];
}

const LINK_FALLBACK_CODES = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

async function mkdirpTracked(dir: string): Promise<string[]> {
  const created: string[] = [];
  const missing: string[] = [];
  let cur = path.resolve(dir);
  for (;;) {
    try {
      const st = await fs.lstat(cur);
      if (!st.isDirectory()) throw new AppError('INVALID_PATH', 'A file exists where a destination folder is needed.');
      break;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw mapFsError(error, 'Preparing destination folder');
      missing.push(cur);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  for (const d of missing.reverse()) {
    try {
      await fs.mkdir(d);
      created.push(d);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw mapFsError(error, 'Creating destination folder');
    }
  }
  return created;
}

async function sha256Of(filePath: string, signal?: AbortSignal): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { signal })) h.update(chunk as Buffer);
  return h.digest('hex');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw mapFsError(error, 'Checking destination');
  }
}

export async function safeMove(opts: SafeMoveOptions): Promise<SafeMoveResult> {
  const { source, destination, expected, onStep, signal } = opts;
  if (signal?.aborted) throw new AppError('JOB_CANCELLED', 'The operation was cancelled before it started.');
  if (path.resolve(source) === path.resolve(destination)) throw new AppError('INVALID_PATH', 'Source and destination are the same file.');

  // Revalidate immediately before mutating.
  const current = await fingerprintOf(source);
  if (!sameContentFingerprint(expected, current)) {
    throw new AppError('FILE_CHANGED', 'The file changed after the plan was created. Rebuild the plan to continue; nothing was moved.');
  }
  if (await exists(destination)) throw new AppError('DESTINATION_CONFLICT', 'The destination already exists. No file was overwritten.');
  await onStep?.('validated');

  const createdDirs = await mkdirpTracked(path.dirname(destination));
  await onStep?.('dest-dir-ready');

  // ---- Fast path: atomic no-overwrite publish via hard link ----
  try {
    await fs.link(source, destination);
    await onStep?.('dest-published');
    await removeSourceVerified(source, destination, current);
    await onStep?.('source-removed');
    return { method: 'link', destination: await fingerprintOf(destination, expected.sha256), createdDirs };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST') throw new AppError('DESTINATION_CONFLICT', 'The destination already exists. No file was overwritten.', undefined, { cause: error });
    if (error instanceof AppError) throw error;
    if (!LINK_FALLBACK_CODES.has(code)) throw mapFsError(error, 'Moving file');
  }

  // ---- Fallback: verified copy ----
  const temp = path.join(path.dirname(destination), `${TEMP_PREFIX}${randomUUID()}.tmp`);
  try {
    await fs.copyFile(source, temp, (await import('node:fs')).constants.COPYFILE_EXCL);
    const [srcHash, tmpHash] = await Promise.all([sha256Of(source, signal), sha256Of(temp, signal)]);
    const after = await fingerprintOf(source);
    if (srcHash !== tmpHash || !sameContentFingerprint(current, after)) {
      throw new AppError('FILE_CHANGED', 'The copy could not be verified because the file changed while copying. The original was left untouched.');
    }
    let method: SafeMoveResult['method'] = 'copy-verify';
    try {
      await fs.link(temp, destination);
      await fs.unlink(temp);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code === 'EEXIST') throw new AppError('DESTINATION_CONFLICT', 'The destination already exists. No file was overwritten.', undefined, { cause: error });
      if (!LINK_FALLBACK_CODES.has(code)) throw mapFsError(error, 'Publishing copied file');
      // No hard-link support at the destination: check-then-rename (residual race documented).
      if (await exists(destination)) throw new AppError('DESTINATION_CONFLICT', 'The destination already exists. No file was overwritten.');
      await fs.rename(temp, destination);
      method = 'rename';
    }
    await onStep?.('dest-published');
    // Destination is a verified byte-identical copy; only now may the source go.
    await removeSourceVerified(source, destination, after, srcHash);
    await onStep?.('source-removed');
    return { method, destination: await fingerprintOf(destination, srcHash), createdDirs };
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error instanceof AppError ? error : mapFsError(error, 'Moving file across volumes');
  }
}

/** Remove the source only if it is still the file we validated (and, for copies, still matches the hash). */
async function removeSourceVerified(source: string, destination: string, validated: Fingerprint, knownHash?: string): Promise<void> {
  const now = await fingerprintOf(source);
  if (!sameContentFingerprint(validated, now)) {
    // Source changed after we published the destination: keep both, report, never delete the edited file.
    throw new AppError('FILE_CHANGED', 'The file changed during the move. Both copies were kept; review them before deleting either.');
  }
  if (knownHash) {
    const destHash = (await hashFile(destination)).sha256;
    if (destHash !== knownHash) throw new AppError('FILE_CHANGED', 'The moved copy did not verify. The original was kept.');
  }
  try {
    await fs.unlink(source);
  } catch (error) {
    throw mapFsError(error, 'Removing the original after the move');
  }
}

/** Remove empty folders SlothFile created itself, deepest first. Never touches non-empty folders. */
export async function removeEmptyDirs(dirs: string[]): Promise<void> {
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    await fs.rmdir(d).catch(() => undefined);
  }
}
