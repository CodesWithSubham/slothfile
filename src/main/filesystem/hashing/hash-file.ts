import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { AppError, mapFsError } from '@shared/errors';

export interface HashResult {
  sha256: string;
  size: number;
  mtimeMs: number;
}

/**
 * Streaming SHA-256. Never loads the file into memory, honours cancellation, and
 * fails with FILE_CHANGED if size or mtime moved while hashing.
 */
export async function hashFile(filePath: string, signal?: AbortSignal): Promise<HashResult> {
  if (signal?.aborted) throw new AppError('JOB_CANCELLED', 'Hashing was cancelled.');
  let before;
  try {
    before = await fs.lstat(filePath);
  } catch (error) {
    throw mapFsError(error, 'Hashing file');
  }
  if (!before.isFile()) throw new AppError('NOT_REGULAR_FILE', 'Only regular files can be hashed.');

  const hash = createHash('sha256');
  try {
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024, signal });
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw new AppError('JOB_CANCELLED', 'Hashing was cancelled.');
    throw mapFsError(error, 'Hashing file');
  }

  let after;
  try {
    after = await fs.lstat(filePath);
  } catch (error) {
    throw mapFsError(error, 'Hashing file');
  }
  if (after.size !== before.size || Math.trunc(after.mtimeMs) !== Math.trunc(before.mtimeMs)) {
    throw new AppError('FILE_CHANGED', 'The file changed while it was being hashed. Try again when it is no longer being modified.');
  }
  return { sha256: hash.digest('hex'), size: after.size, mtimeMs: Math.trunc(after.mtimeMs) };
}
