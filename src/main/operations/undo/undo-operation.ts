import { AppError, toSerializedError } from '@shared/errors';
import type { HistoryEntry, OperationsRepo } from '../../database/repositories/operations-repo';
import { fingerprintOf, sameContentFingerprint } from '../../filesystem/hashing/fingerprint';
import { hashFile } from '../../filesystem/hashing/hash-file';
import { removeEmptyDirs, safeMove } from '../../filesystem/operations/safe-move';
import { assertWithinScope } from '../../security/path-policy';
import { promises as fs } from 'node:fs';

export type UndoEligibility = { ok: true } | { ok: false; reason: string };

/** Read-only check. Used both to decide whether the UI offers Undo and again right before undoing. */
export async function checkUndoEligibility(entry: HistoryEntry, scopeRoot: string): Promise<UndoEligibility> {
  if (entry.status !== 'completed') return { ok: false, reason: 'Only completed moves can be undone.' };
  if (entry.undoStatus === 'undone') return { ok: false, reason: 'This move was already undone.' };
  if (!entry.destinationFingerprint) return { ok: false, reason: 'No record of the moved file exists, so it cannot be verified.' };

  try {
    await assertWithinScope(scopeRoot, entry.destinationPath, 'The moved file');
    await assertWithinScope(scopeRoot, entry.sourcePath, 'The original location');
  } catch (e) {
    return { ok: false, reason: e instanceof AppError ? e.message : 'Paths could not be verified.' };
  }

  let current;
  try {
    current = await fingerprintOf(entry.destinationPath);
  } catch (e) {
    return { ok: false, reason: e instanceof AppError && e.code === 'FILE_NOT_FOUND' ? 'The file is no longer where SlothFile moved it (it was moved, renamed or deleted).' : 'The moved file is not a regular file any more.' };
  }
  if (!sameContentFingerprint(entry.destinationFingerprint, current)) return { ok: false, reason: 'The file has been modified since it was moved, so SlothFile will not move it back automatically.' };

  try {
    await fs.lstat(entry.sourcePath);
    return { ok: false, reason: 'Something else now exists at the original location. SlothFile will not overwrite or remove it.' };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, reason: 'The original location could not be checked.' };
  }
  return { ok: true };
}

export interface UndoResult { ok: boolean; message: string; }

export async function undoOperation(repo: OperationsRepo, historyId: string, scopeRoot: string): Promise<UndoResult> {
  const entry = repo.getHistory(historyId);
  if (!entry) throw new AppError('NOT_FOUND', 'That history entry does not exist.');
  const eligible = await checkUndoEligibility(entry, scopeRoot);
  if (!eligible.ok) {
    repo.markUndo(entry.id, 'refused', eligible.reason);
    return { ok: false, message: eligible.reason };
  }
  try {
    // Extra content check when the original hash is known.
    if (entry.destinationFingerprint?.sha256) {
      const h = await hashFile(entry.destinationPath);
      if (h.sha256 !== entry.destinationFingerprint.sha256) {
        const reason = 'The file content differs from what was moved, so Undo was refused.';
        repo.markUndo(entry.id, 'refused', reason);
        return { ok: false, message: reason };
      }
    }
    const expected = await fingerprintOf(entry.destinationPath);
    await safeMove({ source: entry.destinationPath, destination: entry.sourcePath, expected });
    // Remove only the (empty) folders SlothFile itself created for this move.
    await removeEmptyDirs(entry.createdDirs);
    repo.markUndo(entry.id, 'undone', null);
    return { ok: true, message: 'The file was moved back to its original location.' };
  } catch (error) {
    const ser = toSerializedError(error);
    repo.markUndo(entry.id, 'refused', ser.message);
    return { ok: false, message: ser.message };
  }
}
