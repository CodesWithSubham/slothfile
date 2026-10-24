import { promises as fs } from 'node:fs';
import { AppError, mapFsError } from '@shared/errors';

/**
 * A cheap identity snapshot of a regular file. Size + mtime are NOT proof that
 * content is unchanged (documented limitation); when a content hash is known it
 * is compared as well.
 */
export interface Fingerprint {
  size: number;
  mtimeMs: number;
  ino: string;
  dev: string;
  sha256?: string | null;
}

/** lstat-based: symlinks are never followed, and anything but a regular file is rejected. */
export async function fingerprintOf(filePath: string, sha256?: string | null): Promise<Fingerprint> {
  let st;
  try {
    st = await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    throw mapFsError(error, 'Reading file information');
  }
  if (!st.isFile()) throw new AppError('NOT_REGULAR_FILE', 'Only regular files can be organized (not folders, links or special files).');
  return {
    size: Number(st.size),
    // mtime in ms, truncated to integer so JSON round-trips exactly.
    mtimeMs: Math.trunc(Number(st.mtimeNs) / 1e6),
    ino: st.ino.toString(),
    dev: st.dev.toString(),
    sha256: sha256 ?? null
  };
}

/**
 * True if size and mtime match exactly (and the hash too, when both sides have one).
 * Fingerprints are always taken from the volume the file currently lives on, so no
 * timestamp-granularity slack is needed. Inode/device are intentionally not compared.
 */
export function sameContentFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  if (a.size !== b.size) return false;
  if (a.mtimeMs !== b.mtimeMs) return false;
  if (a.sha256 && b.sha256 && a.sha256 !== b.sha256) return false;
  return true;
}
