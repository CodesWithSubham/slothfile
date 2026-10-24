import path from 'node:path';
import { AppError } from '@shared/errors';
import { CATEGORIES, DEFAULT_CATEGORY_DIRS, type Category } from '@shared/constants';
import type { FilesRepo, FileRecord } from '../../database/repositories/files-repo';
import type { OperationsRepo, PlannedOperation } from '../../database/repositories/operations-repo';
import { fingerprintOf } from '../../filesystem/hashing/fingerprint';
import { buildDestinationPath, sanitizeSuggestedName, validateFileName } from '../../security/path-policy';
import { issuesToMessages, validateOperation } from './validate-operation';
import { executePlan, type ExecutionResult } from '../execution/execute-plan';

export interface PlanOperationView extends PlannedOperation {
  originalName: string;
  relativeSource: string;
  relativeDestination: string;
  confidence: number | null;
  reason: string | null;
  lowConfidence: boolean;
}
export interface PlanPreview { planId: string; folderId: string; operations: PlanOperationView[]; approvedCount: number; blockedCount: number; }

/**
 * All plan logic lives here and runs in the trusted main process. The renderer only ever sends
 * IDs, a category enum value and a bare file name; destinations are always recomputed from those.
 */
export class PlanService {
  constructor(
    private readonly files: FilesRepo,
    private readonly ops: OperationsRepo,
    private readonly getSettings: () => { excludedDirs: string[]; confidenceThreshold: number }
  ) {}

  private folderRoot(folderId: string): string {
    const f = this.files.getFolder(folderId);
    if (!f) throw new AppError('NOT_FOUND', 'That folder is no longer in SlothFile.');
    return f.path;
  }

  async createPlan(folderId: string, fileIds: string[], name = 'Organization plan'): Promise<PlanPreview> {
    const root = this.folderRoot(folderId);
    const planId = this.ops.createPlan(folderId, name);
    for (const file of this.files.listFilesByIds(fileIds)) {
      if (file.folderId !== folderId || file.missing) continue;
      const cls = this.files.latestClassification(file.id);
      const category: Category = cls && (CATEGORIES as readonly string[]).includes(cls.category) ? (cls.category as Category) : 'other';
      let destName = file.name;
      if (cls) {
        const s = sanitizeSuggestedName(cls.suggestedName, file.extension);
        if (s.ok) destName = s.name;
      }
      await this.insert(planId, root, file, category, destName, cls?.id ?? null);
    }
    return this.preview(planId);
  }

  private async insert(planId: string, root: string, file: FileRecord, category: Category, destName: string, classificationId: string | null): Promise<void> {
    const dest = buildDestinationPath(root, category, destName);
    let fingerprint;
    try { fingerprint = await fingerprintOf(file.path, file.contentHash); } catch { return; /* vanished or not a regular file: not plannable */ }
    this.ops.insertOperation({
      planId, fileId: file.id, classificationId, operationType: destName === file.name ? 'move' : 'rename_move', category,
      destDirName: DEFAULT_CATEGORY_DIRS[category], destFileName: destName, sourcePath: file.path, destinationPath: dest,
      sourceFingerprint: fingerprint, status: 'proposed', validationErrors: []
    });
  }

  /** User edit: only a category and a bare file name are accepted; everything else is recomputed. */
  async editOperation(opId: string, edit: { category?: Category; fileName?: string }): Promise<PlanPreview> {
    const op = this.requireOp(opId);
    if (['executing', 'completed'].includes(op.status)) throw new AppError('VALIDATION_FAILED', 'This operation has already run and cannot be edited.');
    const folderId = this.ops.getPlanFolderId(op.planId) as string;
    const root = this.folderRoot(folderId);
    const category = edit.category ?? op.category;
    const fileName = edit.fileName ?? op.destFileName;
    const check = validateFileName(fileName);
    const errors: string[] = [];
    let destinationPath = op.destinationPath;
    if (!check.ok) errors.push(check.reason);
    else destinationPath = buildDestinationPath(root, category, check.name);
    const file = this.files.getFile(op.fileId);
    this.ops.updateOperationEdit(op.id, {
      category, destDirName: DEFAULT_CATEGORY_DIRS[category], destFileName: check.ok ? check.name : fileName, destinationPath,
      operationType: file && file.name === (check.ok ? check.name : fileName) ? 'move' : 'rename_move', validationErrors: errors
    });
    await this.revalidate(op.planId);
    return this.preview(op.planId);
  }

  /** Re-validates every operation in the plan (cross-operation duplicate detection needs the whole set). */
  async revalidate(planId: string): Promise<void> {
    const folderId = this.ops.getPlanFolderId(planId) as string;
    const root = this.folderRoot(folderId);
    const { excludedDirs } = this.getSettings();
    const claimed = new Set<string>();
    for (const op of this.ops.listOperations(planId)) {
      if (op.status === 'rejected' || op.status === 'completed') continue;
      const issues = await validateOperation(op, { scopeRoot: root, excludedDirs, claimedDestinations: claimed });
      const msgs = issuesToMessages(issues);
      this.ops.setValidationErrors(op.id, msgs);
      // An approval is only valid while validation stays clean.
      if (msgs.length && op.status === 'approved') this.ops.setOperationStatus(op.id, 'proposed', null);
    }
  }

  /** `approved=false` rejects (removes from execution). `approved=true` approves only operations whose validation is clean. */
  async setApproval(opIds: string[], approved: boolean): Promise<PlanPreview | null> {
    const ops = opIds.map((id) => this.requireOp(id)).filter((o) => !['executing', 'completed'].includes(o.status));
    const planId = ops[0]?.planId ?? null;
    if (!planId) return null;
    if (!approved) {
      for (const o of ops) this.ops.setOperationStatus(o.id, 'rejected', null);
      return this.preview(planId);
    }
    for (const o of ops) if (o.status === 'rejected') this.ops.setOperationStatus(o.id, 'proposed', null);
    await this.revalidate(planId);
    for (const o of ops) {
      const fresh = this.requireOp(o.id);
      // Blocked operations stay unapproved and are shown with their warnings.
      if (fresh.validationErrors.length === 0) this.ops.setOperationStatus(o.id, 'approved', Date.now());
    }
    return this.preview(planId);
  }

  async preview(planId: string): Promise<PlanPreview> {
    const folderId = this.ops.getPlanFolderId(planId);
    if (!folderId) throw new AppError('NOT_FOUND', 'That plan does not exist.');
    const root = this.folderRoot(folderId);
    await this.revalidate(planId);
    const { confidenceThreshold } = this.getSettings();
    const operations = this.ops.listOperations(planId).map<PlanOperationView>((o) => {
      const file = this.files.getFile(o.fileId);
      const cls = o.classificationId ? this.files.latestClassification(o.fileId) : null;
      return {
        ...o, originalName: file?.name ?? path.basename(o.sourcePath), relativeSource: path.relative(root, o.sourcePath), relativeDestination: path.relative(root, o.destinationPath),
        confidence: cls?.confidence ?? null, reason: cls?.reason ?? null, lowConfidence: cls ? cls.confidence < confidenceThreshold : false
      };
    });
    return { planId, folderId, operations, approvedCount: operations.filter((o) => o.status === 'approved').length, blockedCount: operations.filter((o) => o.validationErrors.length > 0).length };
  }

  /** Execution needs the user's explicit list of IDs (`confirmedOperationIds`) AND each op must already be approved. */
  async execute(planId: string, confirmedOperationIds: string[], signal?: AbortSignal, onProgress?: Parameters<typeof executePlan>[1]['onProgress']): Promise<ExecutionResult> {
    const folderId = this.ops.getPlanFolderId(planId);
    if (!folderId) throw new AppError('NOT_FOUND', 'That plan does not exist.');
    const root = this.folderRoot(folderId);
    const res = await executePlan(this.ops, { planId, confirmedOperationIds, scopeRoot: root, excludedDirs: this.getSettings().excludedDirs, signal, onProgress });
    for (const o of res.outcomes) if (o.status === 'completed') {
      const op = this.ops.getOperation(o.operationId);
      if (op) this.files.updateFilePath(op.fileId, op.destinationPath, root);
    }
    return res;
  }

  private requireOp(id: string): PlannedOperation {
    const op = this.ops.getOperation(id);
    if (!op) throw new AppError('NOT_FOUND', 'That operation does not exist.');
    return op;
  }
}
