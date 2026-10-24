import type { Category } from '../constants';

export interface Fingerprint { size: number; mtimeMs: number; ino: string; dev: string; sha256?: string | null; }

export interface FolderRecord { id: string; path: string; displayName: string; createdAt: number; lastScannedAt: number | null; isEnabled: boolean; }
export type HashStatus = 'none' | 'hashed' | 'failed' | 'stale';
export type ClassificationStatus = 'none' | 'pending' | 'classified' | 'skipped' | 'failed';
export interface FileRecord {
  id: string; folderId: string; path: string; relativePath: string; name: string; extension: string; size: number; modifiedAt: number;
  contentHash: string | null; hashStatus: HashStatus; classificationStatus: ClassificationStatus; missing: boolean; lastScannedAt: number;
}
export interface ClassificationRecord { id: string; fileId: string; provider: string; model: string; category: string; suggestedName: string; confidence: number; reason: string; createdAt: number; }
export interface FileQuery { folderId?: string; search?: string; extension?: string; classificationStatus?: ClassificationStatus; limit: number; offset: number; }
export interface DuplicateGroup { hash: string; size: number; files: FileRecord[]; }
export interface Paginated<T> { items: T[]; total: number; }

export type OpStatus = 'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'interrupted';
export type HistoryStatus = 'started' | 'completed' | 'failed' | 'interrupted';
export type UndoStatus = 'none' | 'undone' | 'refused';

export interface PlannedOperation {
  id: string; planId: string; fileId: string; classificationId: string | null; operationType: 'move' | 'rename_move'; category: Category;
  destDirName: string; destFileName: string; sourcePath: string; destinationPath: string; sourceFingerprint: Fingerprint; status: OpStatus;
  validationErrors: string[]; approvedAt: number | null; createdAt: number;
}
export interface HistoryEntry {
  id: string; operationId: string; planId: string; sourcePath: string; destinationPath: string; status: HistoryStatus; startedAt: number;
  finishedAt: number | null; errorCode: string | null; errorMessage: string | null; sourceFingerprint: Fingerprint; destinationFingerprint: Fingerprint | null;
  createdDirs: string[]; undoStatus: UndoStatus; undoneAt: number | null; undoMessage: string | null;
}
export interface HistoryItem extends HistoryEntry { canUndo: boolean; undoBlockedReason: string | null; }

export interface PlanOperationView extends PlannedOperation {
  originalName: string; relativeSource: string; relativeDestination: string; confidence: number | null; reason: string | null; lowConfidence: boolean;
}
export interface PlanPreview { planId: string; folderId: string; operations: PlanOperationView[]; approvedCount: number; blockedCount: number; }

export interface OperationOutcome { operationId: string; status: 'completed' | 'failed' | 'skipped' | 'cancelled'; message?: string; code?: string; }
export interface ExecutionResult { planId: string; outcomes: OperationOutcome[]; completed: number; failed: number; skipped: number; cancelled: boolean; }
export interface UndoResult { ok: boolean; message: string; }

export type JobType = 'scan' | 'hash' | 'classify' | 'execute';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface JobSnapshot {
  id: string; type: JobType; status: JobStatus; phase: string | null; total: number | null; completed: number; failed: number; skipped: number;
  cancelRequested: boolean; errorCode: string | null; errorMessage: string | null; createdAt: number; updatedAt: number; finishedAt: number | null;
}

export interface AIModelInfo { name: string; sizeBytes: number | null; looksLikeGemma: boolean; }
export type AIStatusState = 'ready' | 'disabled' | 'unreachable' | 'no-model' | 'model-missing';
export interface AIProviderStatus { state: AIStatusState; message: string; models: AIModelInfo[]; selectedModel: string | null; isRemote: boolean; }

export interface DashboardData {
  folders: FolderRecord[]; fileCount: number; duplicateGroupCount: number; pendingProposals: number; completedOperations: number;
  recentHistory: HistoryEntry[]; lastScanAt: number | null;
}
export interface RecoveryNotice { historyId: string; result: 'completed' | 'not-started' | 'needs-review'; message: string; }
export interface AppInfo { version: string; dataDir: string; logDir: string; platform: string; recovery: RecoveryNotice[]; interruptedJobs: number; }
