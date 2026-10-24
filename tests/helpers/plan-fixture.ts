import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/main/database/connection';
import { OperationsRepo, type PlannedOperation } from '../../src/main/database/repositories/operations-repo';
import { fingerprintOf } from '../../src/main/filesystem/hashing/fingerprint';
import type { Category } from '../../src/shared/constants';

export function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Inserts folder + file rows and an approved operation for `sourcePath`. */
export async function makeApprovedOp(db: ReturnType<typeof memoryDb>, repo: OperationsRepo, root: string, sourcePath: string, destDir: string, destName: string, planId?: string): Promise<PlannedOperation> {
  let folderId = (db.prepare('SELECT id FROM selected_folders WHERE path=?').get(root) as { id: string } | undefined)?.id;
  if (!folderId) {
    folderId = randomUUID();
    db.prepare('INSERT INTO selected_folders (id,path,display_name,created_at) VALUES (?,?,?,?)').run(folderId, root, path.basename(root), Date.now());
  }
  const fileId = randomUUID();
  const fp = await fingerprintOf(sourcePath);
  db.prepare('INSERT INTO files (id,folder_id,path,relative_path,name,extension,size,modified_at,last_scanned_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(fileId, folderId, sourcePath, path.relative(root, sourcePath), path.basename(sourcePath), path.extname(sourcePath), fp.size, fp.mtimeMs, Date.now());
  const pid = planId ?? repo.createPlan(folderId, 'test');
  const id = repo.insertOperation({
    planId: pid, fileId, classificationId: null, operationType: 'rename_move', category: 'documents' as Category, destDirName: destDir, destFileName: destName,
    sourcePath, destinationPath: path.join(root, destDir, destName), sourceFingerprint: fp, status: 'approved', validationErrors: []
  });
  repo.setOperationStatus(id, 'approved', Date.now());
  const op = repo.getOperation(id);
  if (!op) throw new Error('fixture failed');
  return op;
}
