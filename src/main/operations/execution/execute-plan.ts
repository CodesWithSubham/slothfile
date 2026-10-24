import { toSerializedError } from '@shared/errors';
import type { OperationsRepo, PlannedOperation } from '../../database/repositories/operations-repo';
import { fingerprintOf } from '../../filesystem/hashing/fingerprint';
import { safeMove } from '../../filesystem/operations/safe-move';
import { issuesToMessages, validateOperation } from '../planning/validate-operation';

export interface ExecuteInput {
  planId: string;
  /** Operation IDs the user explicitly confirmed in this call. Anything else is ignored. */
  confirmedOperationIds: string[];
  scopeRoot: string;
  excludedDirs: readonly string[];
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; failed: number; currentOperationId: string | null }) => void;
}

export interface OperationOutcome {
  operationId: string;
  status: 'completed' | 'failed' | 'skipped' | 'cancelled';
  message?: string;
  code?: string;
}

export interface ExecutionResult {
  planId: string;
  outcomes: OperationOutcome[];
  completed: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
}

/**
 * Failure policy: failures are isolated per file. One failed operation never blocks the
 * rest of the approved set, and never rolls back completed ones (each is individually journaled
 * and individually undoable). Cancellation is honoured between operations, never mid-move.
 */
export async function executePlan(repo: OperationsRepo, input: ExecuteInput): Promise<ExecutionResult> {
  const confirmed = new Set(input.confirmedOperationIds);
  const all = repo.listOperations(input.planId);
  const candidates = all.filter((o) => confirmed.has(o.id));
  const outcomes: OperationOutcome[] = [];
  let failed = 0;
  let completed = 0;
  let cancelled = false;
  const claimed = new Set<string>();

  repo.setPlanStatus(input.planId, 'executing');

  for (const [i, op] of candidates.entries()) {
    if (input.signal?.aborted) { cancelled = true; outcomes.push({ operationId: op.id, status: 'cancelled', code: 'JOB_CANCELLED', message: 'Not started: execution was cancelled.' }); continue; }
    input.onProgress?.({ done: i, total: candidates.length, failed, currentOperationId: op.id });

    if (op.status !== 'approved' || op.approvedAt === null) {
      outcomes.push({ operationId: op.id, status: 'skipped', code: 'NOT_APPROVED', message: 'This operation is not approved.' });
      continue;
    }
    // Revalidate everything immediately before mutation.
    const issues = await validateOperation(op, { scopeRoot: input.scopeRoot, excludedDirs: input.excludedDirs, claimedDestinations: claimed });
    if (issues.length) {
      const msgs = issuesToMessages(issues);
      repo.setValidationErrors(op.id, msgs);
      repo.setOperationStatus(op.id, 'failed');
      failed++;
      outcomes.push({ operationId: op.id, status: 'failed', code: 'VALIDATION_FAILED', message: `${msgs.join(' ')} Nothing was moved.` });
      continue;
    }

    const historyId = repo.journalStart(op);
    try {
      const res = await safeMove({ source: op.sourcePath, destination: op.destinationPath, expected: op.sourceFingerprint, signal: input.signal });
      repo.journalComplete(historyId, op.id, res.destination, res.createdDirs);
      completed++;
      outcomes.push({ operationId: op.id, status: 'completed' });
    } catch (error) {
      const ser = toSerializedError(error);
      // Distinguish "nothing happened" from "possibly half-done" by looking at the disk, not the error.
      const half = await possiblyPartial(op, ser.code);
      repo.journalFail(historyId, op.id, half ? 'interrupted' : 'failed', ser.code, half ? `${ser.message} Both locations may contain the file; run recovery from History.` : ser.message);
      failed++;
      outcomes.push({ operationId: op.id, status: 'failed', code: ser.code, message: ser.message });
    }
  }
  input.onProgress?.({ done: candidates.length, total: candidates.length, failed, currentOperationId: null });
  const skipped = outcomes.filter((o) => o.status === 'skipped').length;
  repo.setPlanStatus(input.planId, failed === 0 && !cancelled && skipped === 0 && completed === all.length ? 'executed' : completed + failed > 0 ? 'partial' : 'draft');
  return { planId: input.planId, outcomes, completed, failed, skipped, cancelled };
}

/**
 * After a failure, did the move possibly leave a destination file behind that THIS operation created?
 * A DESTINATION_CONFLICT means the destination belongs to someone else, so it is never "partial".
 */
async function possiblyPartial(op: PlannedOperation, code: string): Promise<boolean> {
  if (code === 'DESTINATION_CONFLICT') return false;
  try {
    await fingerprintOf(op.destinationPath);
    return true;
  } catch {
    return false;
  }
}
