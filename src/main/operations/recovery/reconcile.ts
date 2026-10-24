import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TEMP_PREFIX } from '@shared/constants';
import type { HistoryEntry, OperationsRepo } from '../../database/repositories/operations-repo';
import { fingerprintOf, sameContentFingerprint } from '../../filesystem/hashing/fingerprint';
import { hashFile } from '../../filesystem/hashing/hash-file';

export interface ReconcileOutcome {
  historyId: string;
  result: 'completed' | 'not-started' | 'needs-review';
  message: string;
}

/**
 * Called at startup for journal rows still marked 'started' (the app died mid-operation).
 * Decisions come from the actual filesystem, never from the stale journal alone, and the only
 * deletion it can perform is of a source that is proven byte-identical to an existing destination.
 */
export async function reconcileInFlight(repo: OperationsRepo): Promise<ReconcileOutcome[]> {
  const results: ReconcileOutcome[] = [];
  for (const entry of repo.findInFlight()) results.push(await reconcileOne(repo, entry));
  return results;
}

async function tryFp(p: string) {
  try { return await fingerprintOf(p); } catch { return null; }
}

async function reconcileOne(repo: OperationsRepo, e: HistoryEntry): Promise<ReconcileOutcome> {
  await cleanTemps(path.dirname(e.destinationPath));
  const src = await tryFp(e.sourcePath);
  const dst = await tryFp(e.destinationPath);

  if (src && !dst) {
    repo.journalFail(e.id, e.operationId, 'interrupted', 'OPERATION_INTERRUPTED', 'The app closed before this file was moved. Nothing changed; the file is still in its original place.');
    return { historyId: e.id, result: 'not-started', message: 'Not started; file is untouched.' };
  }
  if (!src && dst) {
    if (dst.size !== e.sourceFingerprint.size) {
      repo.journalFail(e.id, e.operationId, 'interrupted', 'OPERATION_INTERRUPTED', 'A file exists at the destination but its size does not match the original. Please inspect it.');
      return { historyId: e.id, result: 'needs-review', message: 'Destination size mismatch.' };
    }
    repo.journalComplete(e.id, e.operationId, dst, []);
    return { historyId: e.id, result: 'completed', message: 'The move had finished; the record was updated.' };
  }
  if (src && dst) {
    // Both present: finish only if provably identical and the source is unchanged from the plan.
    const unchanged = sameContentFingerprint(e.sourceFingerprint, src);
    const identical = unchanged && src.size === dst.size && (src.ino === dst.ino && src.dev === dst.dev ? true : (await hashFile(e.sourcePath)).sha256 === (await hashFile(e.destinationPath)).sha256);
    if (identical) {
      await fs.unlink(e.sourcePath);
      const final = await fingerprintOf(e.destinationPath);
      repo.journalComplete(e.id, e.operationId, final, []);
      return { historyId: e.id, result: 'completed', message: 'Finished an interrupted move after verifying both copies were identical.' };
    }
    repo.journalFail(e.id, e.operationId, 'interrupted', 'OPERATION_INTERRUPTED', 'Both the original and destination files exist but could not be verified as identical. Neither was changed; please review them.');
    return { historyId: e.id, result: 'needs-review', message: 'Both copies kept for review.' };
  }
  repo.journalFail(e.id, e.operationId, 'interrupted', 'OPERATION_INTERRUPTED', 'Neither the original nor the destination file could be found. SlothFile did not delete anything; check whether the file was moved or removed by another program.');
  return { historyId: e.id, result: 'needs-review', message: 'File not found in either location.' };
}

/** Remove only SlothFile's own hidden partial-copy files. Never touches anything else. */
async function cleanTemps(dir: string): Promise<void> {
  try {
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith(TEMP_PREFIX) && name.endsWith('.tmp')) await fs.unlink(path.join(dir, name)).catch(() => undefined);
    }
  } catch { /* folder may not exist */ }
}
