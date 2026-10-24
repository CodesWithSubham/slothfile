import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Db } from '../connection';
import type { ScannedFile } from '../../filesystem/scanning/scanner';
import type { ClassificationRecord, ClassificationStatus, DuplicateGroup, FileQuery, FileRecord, FolderRecord, HashStatus } from '@shared/types/domain';
export type { ClassificationRecord, ClassificationStatus, DuplicateGroup, FileQuery, FileRecord, FolderRecord, HashStatus };


interface FRow { id: string; folder_id: string; path: string; relative_path: string; name: string; extension: string; size: number; modified_at: number; content_hash: string | null; hash_status: HashStatus; classification_status: ClassificationStatus; missing: number; last_scanned_at: number; }
const toFile = (r: FRow): FileRecord => ({ id: r.id, folderId: r.folder_id, path: r.path, relativePath: r.relative_path, name: r.name, extension: r.extension, size: r.size, modifiedAt: r.modified_at, contentHash: r.content_hash, hashStatus: r.hash_status, classificationStatus: r.classification_status, missing: r.missing === 1, lastScannedAt: r.last_scanned_at });

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export class FilesRepo {
  constructor(private readonly db: Db) {}

  // ---- folders ----
  addFolder(folderPath: string, now = Date.now()): FolderRecord {
    const existing = this.db.prepare(`SELECT * FROM selected_folders WHERE path=?`).get(folderPath) as { id: string } | undefined;
    if (existing) return this.getFolder(existing.id) as FolderRecord;
    const id = randomUUID();
    this.db.prepare(`INSERT INTO selected_folders (id,path,display_name,created_at) VALUES (?,?,?,?)`).run(id, folderPath, path.basename(folderPath) || folderPath, now);
    return this.getFolder(id) as FolderRecord;
  }
  getFolder(id: string): FolderRecord | null {
    const r = this.db.prepare(`SELECT * FROM selected_folders WHERE id=?`).get(id) as { id: string; path: string; display_name: string; created_at: number; last_scanned_at: number | null; is_enabled: number } | undefined;
    return r ? { id: r.id, path: r.path, displayName: r.display_name, createdAt: r.created_at, lastScannedAt: r.last_scanned_at, isEnabled: r.is_enabled === 1 } : null;
  }
  listFolders(): FolderRecord[] {
    return (this.db.prepare(`SELECT id FROM selected_folders ORDER BY created_at`).all() as { id: string }[]).map((r) => this.getFolder(r.id) as FolderRecord);
  }
  removeFolder(id: string): void { this.db.prepare(`DELETE FROM selected_folders WHERE id=?`).run(id); }
  markScanned(id: string, now = Date.now()): void { this.db.prepare(`UPDATE selected_folders SET last_scanned_at=? WHERE id=?`).run(now, id); }

  // ---- files ----
  /**
   * Reconciliation: a file is identified by (folder, path). If size or mtime changed, any stored hash is
   * marked stale and classification is reset. Unchanged files keep their hash and classification.
   */
  upsertScanned(folderId: string, f: ScannedFile, scanTime: number): void {
    const existing = this.db.prepare(`SELECT id,size,modified_at,hash_status FROM files WHERE folder_id=? AND path=?`).get(folderId, f.path) as { id: string; size: number; modified_at: number; hash_status: HashStatus } | undefined;
    if (!existing) {
      this.db.prepare(`INSERT INTO files (id,folder_id,path,relative_path,name,extension,size,modified_at,last_scanned_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), folderId, f.path, f.relativePath, f.name, f.extension, f.size, f.modifiedAt, scanTime);
      return;
    }
    const changed = existing.size !== f.size || existing.modified_at !== f.modifiedAt;
    if (changed) {
      this.db.prepare(`UPDATE files SET relative_path=?,name=?,extension=?,size=?,modified_at=?,last_scanned_at=?,missing=0,
        hash_status=CASE WHEN hash_status='hashed' THEN 'stale' ELSE hash_status END, classification_status='none' WHERE id=?`)
        .run(f.relativePath, f.name, f.extension, f.size, f.modifiedAt, scanTime, existing.id);
    } else {
      this.db.prepare(`UPDATE files SET last_scanned_at=?, missing=0 WHERE id=?`).run(scanTime, existing.id);
    }
  }
  upsertBatch(folderId: string, files: ScannedFile[], scanTime: number): void {
    this.db.transaction(() => { for (const f of files) this.upsertScanned(folderId, f, scanTime); })();
  }
  /** After a COMPLETE (not cancelled) scan, files not seen are flagged missing, never deleted. */
  markMissingNotSeenSince(folderId: string, scanTime: number): number {
    return this.db.prepare(`UPDATE files SET missing=1 WHERE folder_id=? AND last_scanned_at<? AND missing=0`).run(folderId, scanTime).changes;
  }

  getFile(id: string): FileRecord | null {
    const r = this.db.prepare(`SELECT * FROM files WHERE id=?`).get(id) as FRow | undefined;
    return r ? toFile(r) : null;
  }
  listFiles(q: FileQuery): { items: FileRecord[]; total: number } {
    const where: string[] = ['missing=0'];
    const args: (string | number)[] = [];
    if (q.folderId) { where.push('folder_id=?'); args.push(q.folderId); }
    if (q.search) { where.push(`(name LIKE ? ESCAPE '\\' OR relative_path LIKE ? ESCAPE '\\')`); const s = `%${escapeLike(q.search)}%`; args.push(s, s); }
    if (q.extension) { where.push('extension=?'); args.push(q.extension.toLowerCase()); }
    if (q.classificationStatus) { where.push('classification_status=?'); args.push(q.classificationStatus); }
    const w = where.join(' AND ');
    const items = (this.db.prepare(`SELECT * FROM files WHERE ${w} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...args, q.limit, q.offset) as FRow[]).map(toFile);
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM files WHERE ${w}`).get(...args) as { c: number }).c;
    return { items, total };
  }
  listFilesByIds(ids: string[]): FileRecord[] {
    if (!ids.length) return [];
    return (this.db.prepare(`SELECT * FROM files WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as FRow[]).map(toFile);
  }
  countFiles(folderId?: string): number {
    const row = (folderId
      ? this.db.prepare(`SELECT COUNT(*) c FROM files WHERE missing=0 AND folder_id=?`).get(folderId)
      : this.db.prepare(`SELECT COUNT(*) c FROM files WHERE missing=0`).get()) as { c: number };
    return row.c;
  }

  // ---- hashing / duplicates ----
  setHash(id: string, hash: string): void { this.db.prepare(`UPDATE files SET content_hash=?, hash_status='hashed' WHERE id=?`).run(hash, id); }
  /** "Revalidate hashes": forces every stored hash to be recomputed on the next hash job. */
  markAllHashesStale(folderId?: string): void {
    if (folderId) this.db.prepare(`UPDATE files SET hash_status='stale' WHERE hash_status='hashed' AND folder_id=?`).run(folderId);
    else this.db.prepare(`UPDATE files SET hash_status='stale' WHERE hash_status='hashed'`).run();
  }
  setHashFailed(id: string): void { this.db.prepare(`UPDATE files SET hash_status='failed' WHERE id=?`).run(id); }
  /** Files that need hashing and share their size with another file (unique sizes can never be duplicates). */
  filesNeedingHash(folderId?: string): FileRecord[] {
    const f = folderId ? 'AND folder_id=@folder' : '';
    return (this.db.prepare(`SELECT * FROM files WHERE missing=0 ${f} AND hash_status IN ('none','stale') AND size>0
      AND size IN (SELECT size FROM files WHERE missing=0 ${f} GROUP BY size HAVING COUNT(*)>1)`).all(folderId ? { folder: folderId } : {}) as FRow[]).map(toFile);
  }
  duplicateGroups(folderId?: string): DuplicateGroup[] {
    const f = folderId ? 'AND folder_id=?' : '';
    const hashes = this.db.prepare(`SELECT content_hash h FROM files WHERE missing=0 AND hash_status='hashed' ${f} GROUP BY content_hash HAVING COUNT(*)>1 ORDER BY SUM(size) DESC`).all(...(folderId ? [folderId] : [])) as { h: string }[];
    return hashes.map(({ h }) => {
      const files = (this.db.prepare(`SELECT * FROM files WHERE missing=0 AND hash_status='hashed' AND content_hash=? ${f} ORDER BY path`).all(h, ...(folderId ? [folderId] : [])) as FRow[]).map(toFile);
      return { hash: h, size: files[0]?.size ?? 0, files };
    });
  }
  /** Called after a successful move so stored paths follow the file. */
  updateFilePath(id: string, newPath: string, folderRoot: string): void {
    this.db.prepare(`UPDATE files SET path=?, relative_path=?, name=? WHERE id=?`).run(newPath, path.relative(folderRoot, newPath), path.basename(newPath), id);
  }

  // ---- classifications ----
  setClassificationStatus(id: string, status: ClassificationStatus): void { this.db.prepare(`UPDATE files SET classification_status=? WHERE id=?`).run(status, id); }
  addClassification(c: Omit<ClassificationRecord, 'id' | 'createdAt'>, now = Date.now()): string {
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO classifications (id,file_id,provider,model,category,suggested_name,confidence,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, c.fileId, c.provider, c.model, c.category, c.suggestedName, c.confidence, c.reason, now);
      this.setClassificationStatus(c.fileId, 'classified');
    })();
    return id;
  }
  latestClassification(fileId: string): ClassificationRecord | null {
    const r = this.db.prepare(`SELECT * FROM classifications WHERE file_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(fileId) as { id: string; file_id: string; provider: string; model: string; category: string; suggested_name: string; confidence: number; reason: string; created_at: number } | undefined;
    return r ? { id: r.id, fileId: r.file_id, provider: r.provider, model: r.model, category: r.category, suggestedName: r.suggested_name, confidence: r.confidence, reason: r.reason, createdAt: r.created_at } : null;
  }

  /** "Clear local data": removes SlothFile's metadata only. User files are never touched. */
  clearAllMetadata(): void {
    this.db.transaction(() => {
      for (const t of ['operation_history', 'planned_operations', 'organization_plans', 'classifications', 'files', 'selected_folders', 'jobs', 'settings']) this.db.prepare(`DELETE FROM ${t}`).run();
    })();
  }
}
