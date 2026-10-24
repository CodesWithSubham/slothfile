import { randomUUID } from 'node:crypto';
import type { Db } from '../connection';
import type { Fingerprint } from '../../filesystem/hashing/fingerprint';
import type { Category } from '@shared/constants';
import type { HistoryEntry, HistoryStatus, OpStatus, PlannedOperation, UndoStatus } from '@shared/types/domain';
export type { HistoryEntry, HistoryStatus, OpStatus, PlannedOperation, UndoStatus };




interface OpRow {
  id: string; plan_id: string; file_id: string; classification_id: string | null; operation_type: 'move' | 'rename_move';
  category: Category; dest_dir_name: string; dest_file_name: string; source_path: string; destination_path: string;
  source_fingerprint: string; status: OpStatus; validation_errors: string; approved_at: number | null; created_at: number;
}
interface HistRow {
  id: string; operation_id: string; plan_id: string; source_path: string; destination_path: string; status: HistoryStatus;
  started_at: number; finished_at: number | null; error_code: string | null; error_message: string | null;
  source_fingerprint: string; destination_fingerprint: string | null; created_dirs: string; undo_status: UndoStatus;
  undone_at: number | null; undo_message: string | null;
}

const toOp = (r: OpRow): PlannedOperation => ({
  id: r.id, planId: r.plan_id, fileId: r.file_id, classificationId: r.classification_id, operationType: r.operation_type,
  category: r.category, destDirName: r.dest_dir_name, destFileName: r.dest_file_name, sourcePath: r.source_path,
  destinationPath: r.destination_path, sourceFingerprint: JSON.parse(r.source_fingerprint) as Fingerprint, status: r.status,
  validationErrors: JSON.parse(r.validation_errors) as string[], approvedAt: r.approved_at, createdAt: r.created_at
});
const toHist = (r: HistRow): HistoryEntry => ({
  id: r.id, operationId: r.operation_id, planId: r.plan_id, sourcePath: r.source_path, destinationPath: r.destination_path,
  status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, errorCode: r.error_code, errorMessage: r.error_message,
  sourceFingerprint: JSON.parse(r.source_fingerprint) as Fingerprint,
  destinationFingerprint: r.destination_fingerprint ? (JSON.parse(r.destination_fingerprint) as Fingerprint) : null,
  createdDirs: JSON.parse(r.created_dirs) as string[], undoStatus: r.undo_status, undoneAt: r.undone_at, undoMessage: r.undo_message
});

export class OperationsRepo {
  constructor(private readonly db: Db) {}

  createPlan(folderId: string, name: string, now = Date.now()): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO organization_plans (id, folder_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`).run(id, folderId, name, 'draft', now, now);
    return id;
  }

  setPlanStatus(planId: string, status: 'draft' | 'executing' | 'executed' | 'partial' | 'abandoned', now = Date.now()): void {
    this.db.prepare(`UPDATE organization_plans SET status=?, updated_at=? WHERE id=?`).run(status, now, planId);
  }

  getPlanFolderId(planId: string): string | null {
    const r = this.db.prepare(`SELECT folder_id FROM organization_plans WHERE id=?`).get(planId) as { folder_id: string } | undefined;
    return r?.folder_id ?? null;
  }

  insertOperation(op: Omit<PlannedOperation, 'id' | 'createdAt' | 'approvedAt'> & { id?: string }, now = Date.now()): string {
    const id = op.id ?? randomUUID();
    this.db.prepare(
      `INSERT INTO planned_operations (id, plan_id, file_id, classification_id, operation_type, category, dest_dir_name, dest_file_name,
        source_path, destination_path, source_fingerprint, status, validation_errors, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, op.planId, op.fileId, op.classificationId, op.operationType, op.category, op.destDirName, op.destFileName, op.sourcePath,
      op.destinationPath, JSON.stringify(op.sourceFingerprint), op.status, JSON.stringify(op.validationErrors), now);
    return id;
  }

  getOperation(id: string): PlannedOperation | null {
    const r = this.db.prepare(`SELECT * FROM planned_operations WHERE id=?`).get(id) as OpRow | undefined;
    return r ? toOp(r) : null;
  }

  listOperations(planId: string): PlannedOperation[] {
    return (this.db.prepare(`SELECT * FROM planned_operations WHERE plan_id=? ORDER BY created_at, id`).all(planId) as OpRow[]).map(toOp);
  }

  updateOperationEdit(id: string, patch: { category: Category; destDirName: string; destFileName: string; destinationPath: string; operationType: 'move' | 'rename_move'; validationErrors: string[] }): void {
    // Editing always drops approval: the user must re-approve what they changed.
    this.db.prepare(
      `UPDATE planned_operations SET category=?, dest_dir_name=?, dest_file_name=?, destination_path=?, operation_type=?, validation_errors=?,
        status='proposed', approved_at=NULL WHERE id=? AND status IN ('proposed','approved','rejected','failed','interrupted')`
    ).run(patch.category, patch.destDirName, patch.destFileName, patch.destinationPath, patch.operationType, JSON.stringify(patch.validationErrors), id);
  }

  setOperationStatus(id: string, status: OpStatus, approvedAt?: number | null): void {
    if (approvedAt !== undefined) this.db.prepare(`UPDATE planned_operations SET status=?, approved_at=? WHERE id=?`).run(status, approvedAt, id);
    else this.db.prepare(`UPDATE planned_operations SET status=? WHERE id=?`).run(status, id);
  }

  setValidationErrors(id: string, errors: string[]): void {
    this.db.prepare(`UPDATE planned_operations SET validation_errors=? WHERE id=?`).run(JSON.stringify(errors), id);
  }

  /** Write-ahead: called BEFORE the filesystem is touched. Atomically marks the op 'executing'. */
  journalStart(op: PlannedOperation, now = Date.now()): string {
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO operation_history (id, operation_id, plan_id, source_path, destination_path, status, started_at, source_fingerprint)
         VALUES (?,?,?,?,?,'started',?,?)`
      ).run(id, op.id, op.planId, op.sourcePath, op.destinationPath, now, JSON.stringify(op.sourceFingerprint));
      this.setOperationStatus(op.id, 'executing');
    })();
    return id;
  }

  /** Only called after the filesystem mutation really succeeded. */
  journalComplete(historyId: string, opId: string, dest: Fingerprint, createdDirs: string[], now = Date.now()): void {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE operation_history SET status='completed', finished_at=?, destination_fingerprint=?, created_dirs=? WHERE id=?`)
        .run(now, JSON.stringify(dest), JSON.stringify(createdDirs), historyId);
      this.setOperationStatus(opId, 'completed');
    })();
  }

  journalFail(historyId: string, opId: string, status: 'failed' | 'interrupted', code: string, message: string, now = Date.now()): void {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE operation_history SET status=?, finished_at=?, error_code=?, error_message=? WHERE id=?`).run(status, now, code, message, historyId);
      this.setOperationStatus(opId, status);
    })();
  }

  listHistory(opts: { limit: number; offset: number }): { items: HistoryEntry[]; total: number } {
    const items = (this.db.prepare(`SELECT * FROM operation_history ORDER BY started_at DESC, id LIMIT ? OFFSET ?`).all(opts.limit, opts.offset) as HistRow[]).map(toHist);
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM operation_history`).get() as { c: number }).c;
    return { items, total };
  }

  getHistory(id: string): HistoryEntry | null {
    const r = this.db.prepare(`SELECT * FROM operation_history WHERE id=?`).get(id) as HistRow | undefined;
    return r ? toHist(r) : null;
  }

  findInFlight(): HistoryEntry[] {
    return (this.db.prepare(`SELECT * FROM operation_history WHERE status='started' ORDER BY started_at`).all() as HistRow[]).map(toHist);
  }

  /** Any completed, not-yet-undone move whose destination equals this path (used by validation to avoid clobbering). */
  markUndo(id: string, status: 'undone' | 'refused', message: string | null, now = Date.now()): void {
    this.db.prepare(`UPDATE operation_history SET undo_status=?, undone_at=?, undo_message=? WHERE id=?`).run(status, status === 'undone' ? now : null, message, id);
  }
}
