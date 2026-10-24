import { z } from 'zod';
import { CATEGORIES } from '../constants';
import { IPC_NAMES } from './names';
export { IPC_INVOKE_CHANNEL, IPC_NAMES, JOB_EVENT_CHANNEL } from './names';
import { SettingsPatchSchema, type Settings } from '../schemas/settings';
import type { SerializedError } from '../errors';
import type {
  AIProviderStatus, AppInfo, DashboardData, DuplicateGroup, ExecutionResult, FileRecord, FolderRecord, HistoryItem, JobSnapshot,
  Paginated, PlanPreview, UndoResult, ClassificationRecord
} from '../types/domain';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

const id = z.string().uuid();
const ids = z.array(id).min(1).max(5000);
const page = { limit: z.number().int().min(1).max(500), offset: z.number().int().min(0) };

/**
 * Runtime validation for every renderer->main request. Names (not arbitrary strings) select channels:
 * the renderer can only ever call a key of this object. No schema accepts a filesystem path, except none:
 * paths are always looked up in the main process from IDs.
 */
export const ipcSchemas = {
  'app.info': z.void(),
  'dashboard.get': z.void(),
  'folders.select': z.void(),
  'folders.list': z.void(),
  'folders.remove': z.object({ folderId: id }).strict(),
  'scan.start': z.object({ folderId: id }).strict(),
  'hash.start': z.object({ folderId: id.optional(), force: z.boolean().optional() }).strict(),
  'jobs.get': z.object({ jobId: id }).strict(),
  'jobs.list': z.void(),
  'jobs.cancel': z.object({ jobId: id }).strict(),
  'files.list': z.object({
    folderId: id.optional(), search: z.string().max(200).optional(), extension: z.string().regex(/^\.[a-z0-9]{1,10}$/i).optional(),
    classificationStatus: z.enum(['none', 'pending', 'classified', 'skipped', 'failed']).optional(), ...page
  }).strict(),
  'files.reveal': z.object({ fileId: id }).strict(),
  'files.classification': z.object({ fileId: id }).strict(),
  'duplicates.list': z.object({ folderId: id.optional() }).strict(),
  'ai.status': z.void(),
  'ai.classify': z.object({ fileIds: ids }).strict(),
  'plans.create': z.object({ folderId: id, fileIds: ids }).strict(),
  'plans.get': z.object({ planId: id }).strict(),
  'plans.edit': z.object({ operationId: id, category: z.enum(CATEGORIES).optional(), fileName: z.string().max(255).optional() }).strict(),
  'plans.approve': z.object({ operationIds: ids, approved: z.boolean() }).strict(),
  'plans.execute': z.object({ planId: id, confirmedOperationIds: ids }).strict(),
  'history.list': z.object(page).strict(),
  'history.undo': z.object({ historyId: id }).strict(),
  'settings.get': z.void(),
  'settings.update': SettingsPatchSchema,
  'data.clear': z.object({ confirm: z.literal('CLEAR LOCAL DATA') }).strict()
} as const satisfies Record<(typeof IPC_NAMES)[number], z.ZodType>;

export type IpcName = keyof typeof ipcSchemas;
export type IpcInput<K extends IpcName> = z.infer<(typeof ipcSchemas)[K]>;

export interface IpcOutputs {
  'app.info': AppInfo;
  'dashboard.get': DashboardData;
  'folders.select': FolderRecord | null;
  'folders.list': FolderRecord[];
  'folders.remove': void;
  'scan.start': JobSnapshot;
  'hash.start': JobSnapshot;
  'jobs.get': JobSnapshot | null;
  'jobs.list': JobSnapshot[];
  'jobs.cancel': boolean;
  'files.list': Paginated<FileRecord>;
  'files.reveal': void;
  'files.classification': ClassificationRecord | null;
  'duplicates.list': DuplicateGroup[];
  'ai.status': AIProviderStatus;
  'ai.classify': JobSnapshot;
  'plans.create': PlanPreview;
  'plans.get': PlanPreview;
  'plans.edit': PlanPreview;
  'plans.approve': PlanPreview | null;
  'plans.execute': ExecutionResult;
  'history.list': Paginated<HistoryItem>;
  'history.undo': UndoResult;
  'settings.get': Settings;
  'settings.update': Settings;
  'data.clear': void;
}

/** Compile-time guarantee that schemas and outputs cover exactly the same names. */
type _Exact = IpcName extends keyof IpcOutputs ? (keyof IpcOutputs extends IpcName ? true : never) : never;
export const _exactContract: _Exact = true;
/** Every listed name must have a schema (satisfies above) and vice versa (below). */
type _NamesCovered = IpcName extends (typeof IPC_NAMES)[number] ? true : never;
export const _namesCovered: _NamesCovered = true;

export interface InvokeRequest { name: IpcName; input?: unknown; }

export type SlothFileApi = {
  [K in IpcName]: IpcInput<K> extends void | undefined ? () => Promise<IpcResult<IpcOutputs[K]>> : (input: IpcInput<K>) => Promise<IpcResult<IpcOutputs[K]>>;
} & {
  onJobUpdate(callback: (job: JobSnapshot) => void): () => void;
};
