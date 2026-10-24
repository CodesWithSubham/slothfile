import { promises as fs } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openDatabase, runMigrations } from '../../src/main/database/connection';
import { FilesRepo } from '../../src/main/database/repositories/files-repo';
import { SettingsRepo } from '../../src/main/database/repositories/settings-repo';
import { OperationsRepo } from '../../src/main/database/repositories/operations-repo';
import { PlanService } from '../../src/main/operations/planning/plan-service';
import { scanFolder, type ScannedFile } from '../../src/main/filesystem/scanning/scanner';
import { hashFile } from '../../src/main/filesystem/hashing/hash-file';
import { memoryDb } from '../helpers/plan-fixture';
import { makeTempDir, writeFixture } from '../helpers/tmp';

let clock = Date.now();
async function scanInto(repo: FilesRepo, folderId: string, root: string) {
  const t = (clock += 10); // strictly increasing scan timestamps, like real consecutive scans
  const batch: ScannedFile[] = [];
  await scanFolder({ root, excludedDirs: [], onFile: (f) => { batch.push(f); } });
  repo.upsertBatch(folderId, batch, t);
  repo.markMissingNotSeenSince(folderId, t);
}

describe('migrations', () => {
  it('apply once and are idempotent; persist across reopen', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'a.db');
    const first = openDatabase(file);
    expect(first.migrations.applied).toEqual(MIGRATIONS.map((m) => m.version));
    new SettingsRepo(first.db).update({ theme: 'dark' });
    first.db.close();
    const second = openDatabase(file);
    expect(second.migrations.applied).toEqual([]);
    expect(new SettingsRepo(second.db).get().theme).toBe('dark');
    second.db.close();
  });
  it('refuses a database from a newer app version', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 999');
    expect(() => runMigrations(db)).toThrow(/newer version/);
  });
  it('enforces foreign keys', () => {
    const db = memoryDb();
    expect(() => db.prepare(`INSERT INTO files (id,folder_id,path,relative_path,name,extension,size,modified_at,last_scanned_at) VALUES ('x','nope','p','p','p','',1,1,1)`).run()).toThrow();
  });
});

describe('SettingsRepo', () => {
  it('validates updates and keeps valid fields when stored data is partly corrupt', () => {
    const db = memoryDb();
    const repo = new SettingsRepo(db);
    expect(() => repo.update({ aiConcurrency: 99 })).toThrow();
    db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES ('app', ?, 1)`).run(JSON.stringify({ theme: 'dark', aiConcurrency: 'lots' }));
    const s = repo.get();
    expect(s.theme).toBe('dark');
    expect(s.aiConcurrency).toBe(1);
  });
  it('recovers from unparseable stored JSON', () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES ('app','{{{',1)`).run();
    expect(new SettingsRepo(db).get().theme).toBe('system');
  });
});

describe('FilesRepo reconciliation and duplicates', () => {
  it('flags vanished files as missing, resets hash when content changes, keeps it otherwise', async () => {
    const root = await makeTempDir();
    const repo = new FilesRepo(memoryDb());
    const folder = repo.addFolder(root);
    const a = await writeFixture(root, 'a.txt', 'aaaa');
    await writeFixture(root, 'b.txt', 'bbbb');
    await scanInto(repo, folder.id, root);
    const fa = repo.listFiles({ limit: 10, offset: 0 }).items.find((f) => f.name === 'a.txt');
    if (!fa) throw new Error('missing');
    repo.setHash(fa.id, 'deadbeef');
    await scanInto(repo, folder.id, root);
    expect(repo.getFile(fa.id)?.hashStatus).toBe('hashed');
    await fs.writeFile(a, 'changed content');
    await fs.rm(path.join(root, 'b.txt'));
    await scanInto(repo, folder.id, root);
    expect(repo.getFile(fa.id)?.hashStatus).toBe('stale');
    const names = repo.listFiles({ limit: 10, offset: 0 }).items.map((f) => f.name);
    expect(names).toEqual(['a.txt']);
  });
  it('groups only content-identical files (acceptance fixture)', async () => {
    const root = await makeTempDir();
    const repo = new FilesRepo(memoryDb());
    const folder = repo.addFolder(root);
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    await writeFixture(root, 'image-copy-a.png', png);
    await writeFixture(root, 'image-copy-b.png', png);
    await writeFixture(root, 'same-size-different.png', Buffer.from([137, 80, 78, 71, 9, 9, 9]));
    await writeFixture(root, 'unique-size.txt', 'hello');
    await scanInto(repo, folder.id, root);
    const need = repo.filesNeedingHash(folder.id);
    expect(need.map((f) => f.name).sort()).toEqual(['image-copy-a.png', 'image-copy-b.png', 'same-size-different.png']); // unique sizes are skipped
    for (const f of need) repo.setHash(f.id, (await hashFile(f.path)).sha256);
    const groups = repo.duplicateGroups(folder.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files.map((f) => f.name).sort()).toEqual(['image-copy-a.png', 'image-copy-b.png']);
  });
  it('searches safely with LIKE wildcards in the query', async () => {
    const root = await makeTempDir();
    const repo = new FilesRepo(memoryDb());
    const folder = repo.addFolder(root);
    await writeFixture(root, '100%_done.txt', 'x');
    await writeFixture(root, 'other.txt', 'y');
    await scanInto(repo, folder.id, root);
    expect(repo.listFiles({ search: '%', limit: 10, offset: 0 }).items.map((f) => f.name)).toEqual(['100%_done.txt']);
  });
  it('clearing metadata removes rows but never touches user files', async () => {
    const root = await makeTempDir();
    const repo = new FilesRepo(memoryDb());
    const folder = repo.addFolder(root);
    const f = await writeFixture(root, 'keep.txt', 'k');
    await scanInto(repo, folder.id, root);
    repo.clearAllMetadata();
    expect(repo.listFolders()).toEqual([]);
    expect(await fs.readFile(f, 'utf8')).toBe('k');
  });
});

describe('PlanService (full acceptance flow without a live model)', () => {
  it('builds, edits, warns on conflicts, requires approval, executes, and updates tracked paths', async () => {
    const root = await makeTempDir();
    const db = memoryDb();
    const files = new FilesRepo(db);
    const ops = new OperationsRepo(db);
    const folder = files.addFolder(root);
    await writeFixture(root, 'random-name-01.txt', 'notes about graphs');
    await writeFixture(root, 'lecture-notes.md', '# Lecture');
    await writeFixture(root, 'Education/semester-5-notes.txt', 'already here');
    await scanInto(files, folder.id, root);
    const all = files.listFiles({ limit: 50, offset: 0 }).items;
    const rn = all.find((f) => f.name === 'random-name-01.txt');
    const ln = all.find((f) => f.name === 'lecture-notes.md');
    if (!rn || !ln) throw new Error('fixtures');
    // deterministic "mock AI" classifications
    files.addClassification({ fileId: rn.id, provider: 'mock', model: 'm', category: 'education', suggestedName: 'semester-5-notes', confidence: 0.94, reason: 'Study notes.' });
    files.addClassification({ fileId: ln.id, provider: 'mock', model: 'm', category: 'education', suggestedName: '../../evil', confidence: 0.4, reason: 'Notes.' });
    const svc = new PlanService(files, ops, () => ({ excludedDirs: [], confidenceThreshold: 0.6 }));

    const plan = await svc.createPlan(folder.id, [rn.id, ln.id]);
    const opRn = plan.operations.find((o) => o.originalName === 'random-name-01.txt');
    const opLn = plan.operations.find((o) => o.originalName === 'lecture-notes.md');
    if (!opRn || !opLn) throw new Error('ops');
    expect(opRn.destFileName).toBe('semester-5-notes.txt');
    expect(opRn.validationErrors.join(' ')).toMatch(/already exists/); // conflict with Education/semester-5-notes.txt
    expect(opLn.destFileName).not.toMatch(/[\\/]/); // unsafe model name neutralized
    expect(opLn.lowConfidence).toBe(true);

    // conflicting op cannot be approved
    let p = await svc.setApproval([opRn.id], true);
    expect(p?.operations.find((o) => o.id === opRn.id)?.status).not.toBe('approved');
    // editing the filename resolves the conflict, but approval is dropped until re-approved
    p = await svc.editOperation(opRn.id, { fileName: 'graph-theory-notes.txt' });
    expect(p.operations.find((o) => o.id === opRn.id)?.validationErrors).toEqual([]);
    expect(p.operations.find((o) => o.id === opRn.id)?.status).toBe('proposed');
    // an invalid edit is surfaced, not accepted
    p = await svc.editOperation(opLn.id, { fileName: 'bad/name.md' });
    expect(p.operations.find((o) => o.id === opLn.id)?.validationErrors.length).toBeGreaterThan(0);

    // executing an unapproved op does nothing
    const noop = await svc.execute(plan.planId, [opRn.id]);
    expect(noop.completed).toBe(0);
    expect(await fs.readFile(path.join(root, 'random-name-01.txt'), 'utf8')).toBe('notes about graphs');

    await svc.setApproval([opRn.id], true);
    const res = await svc.execute(plan.planId, [opRn.id]);
    expect(res.completed).toBe(1);
    expect(await fs.readFile(path.join(root, 'Education', 'graph-theory-notes.txt'), 'utf8')).toBe('notes about graphs');
    expect(await fs.readFile(path.join(root, 'lecture-notes.md'), 'utf8')).toBe('# Lecture'); // unrelated file preserved
    expect(files.getFile(rn.id)?.path).toBe(path.join(root, 'Education', 'graph-theory-notes.txt'));
  });
});
