import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OperationsRepo } from '../../src/main/database/repositories/operations-repo';
import { executePlan } from '../../src/main/operations/execution/execute-plan';
import { checkUndoEligibility, undoOperation } from '../../src/main/operations/undo/undo-operation';
import { reconcileInFlight } from '../../src/main/operations/recovery/reconcile';
import { validateOperation } from '../../src/main/operations/planning/validate-operation';
import { safeMove } from '../../src/main/filesystem/operations/safe-move';
import { makeApprovedOp, memoryDb } from '../helpers/plan-fixture';
import { makeTempDir, writeFixture } from '../helpers/tmp';

const EXCL = ['node_modules'];
async function setup() {
  const root = await makeTempDir();
  const db = memoryDb();
  const repo = new OperationsRepo(db);
  return { root, db, repo };
}
const run = (repo: OperationsRepo, root: string, planId: string, ids: string[]) =>
  executePlan(repo, { planId, confirmedOperationIds: ids, scopeRoot: root, excludedDirs: EXCL });

describe('execution', () => {
  it('moves only confirmed+approved operations and journals them', async () => {
    const { root, db, repo } = await setup();
    const a = await writeFixture(root, 'random-name-01.txt', 'A');
    const b = await writeFixture(root, 'other.txt', 'B');
    const unrelated = await writeFixture(root, 'keep.txt', 'K');
    const op1 = await makeApprovedOp(db, repo, root, a, 'Education', 'notes.txt');
    const op2 = await makeApprovedOp(db, repo, root, b, 'Other', 'other.txt', op1.planId);
    const res = await run(repo, root, op1.planId, [op1.id]); // op2 NOT confirmed
    expect(res.completed).toBe(1);
    expect(await fs.readFile(path.join(root, 'Education', 'notes.txt'), 'utf8')).toBe('A');
    expect(await fs.readFile(b, 'utf8')).toBe('B');
    expect(await fs.readFile(unrelated, 'utf8')).toBe('K');
    expect(repo.getOperation(op2.id)?.status).toBe('approved');
    const hist = repo.listHistory({ limit: 10, offset: 0 });
    expect(hist.items).toHaveLength(1);
    expect(hist.items[0]?.status).toBe('completed');
  });

  it('does not run unapproved operations even if confirmed', async () => {
    const { root, db, repo } = await setup();
    const a = await writeFixture(root, 'a.txt', 'A');
    const op = await makeApprovedOp(db, repo, root, a, 'D', 'a.txt');
    repo.setOperationStatus(op.id, 'proposed', null);
    const res = await run(repo, root, op.planId, [op.id]);
    expect(res.skipped).toBe(1);
    expect(await fs.readFile(a, 'utf8')).toBe('A');
  });

  it('reports a destination conflict and overwrites nothing', async () => {
    const { root, db, repo } = await setup();
    const a = await writeFixture(root, 'a.txt', 'new');
    await writeFixture(root, 'D/a2.txt', 'precious');
    const op = await makeApprovedOp(db, repo, root, a, 'D', 'a2.txt');
    const res = await run(repo, root, op.planId, [op.id]);
    expect(res.failed).toBe(1);
    expect(res.outcomes[0]?.message).toMatch(/never overwrites|No file was overwritten|Nothing was moved/i);
    expect(await fs.readFile(path.join(root, 'D', 'a2.txt'), 'utf8')).toBe('precious');
    expect(await fs.readFile(a, 'utf8')).toBe('new');
  });

  it('detects two operations targeting the same destination (case-insensitively)', async () => {
    const { root, db, repo } = await setup();
    const a = await writeFixture(root, 'a.txt', 'A');
    const b = await writeFixture(root, 'b.txt', 'B');
    const op1 = await makeApprovedOp(db, repo, root, a, 'D', 'same.txt');
    const op2 = await makeApprovedOp(db, repo, root, b, 'D', 'SAME.txt', op1.planId);
    const claimed = new Set<string>();
    expect(await validateOperation(op1, { scopeRoot: root, excludedDirs: EXCL, claimedDestinations: claimed })).toEqual([]);
    const issues = await validateOperation(op2, { scopeRoot: root, excludedDirs: EXCL, claimedDestinations: claimed });
    expect(issues.map((i) => i.code)).toContain('DUPLICATE_DEST');
  });

  it('rejects a destination folder that is a symlink pointing outside the scope', async () => {
    const { root, db, repo } = await setup();
    const outside = await makeTempDir('slothfile-outside-');
    const a = await writeFixture(root, 'a.txt', 'A');
    await fs.symlink(outside, path.join(root, 'Escape'), 'dir');
    const op = await makeApprovedOp(db, repo, root, a, 'Escape', 'a.txt');
    const issues = await validateOperation(op, { scopeRoot: root, excludedDirs: EXCL });
    expect(issues.map((i) => i.code)).toContain('OUTSIDE_SCOPE');
    const res = await run(repo, root, op.planId, [op.id]);
    expect(res.failed).toBe(1);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(await fs.readFile(a, 'utf8')).toBe('A');
  });

  it('refuses a file modified after planning', async () => {
    const { root, db, repo } = await setup();
    const a = await writeFixture(root, 'a.txt', 'v1');
    const op = await makeApprovedOp(db, repo, root, a, 'D', 'a.txt');
    await fs.writeFile(a, 'changed contents');
    const res = await run(repo, root, op.planId, [op.id]);
    expect(res.failed).toBe(1);
    expect(await fs.readFile(a, 'utf8')).toBe('changed contents');
  });
});

describe('undo', () => {
  async function moved() {
    const ctx = await setup();
    const a = await writeFixture(ctx.root, 'orig.txt', 'content');
    const op = await makeApprovedOp(ctx.db, ctx.repo, ctx.root, a, 'Education', 'renamed.txt');
    await run(ctx.repo, ctx.root, op.planId, [op.id]);
    const entry = ctx.repo.listHistory({ limit: 1, offset: 0 }).items[0];
    if (!entry) throw new Error('no history');
    return { ...ctx, a, entry, dest: path.join(ctx.root, 'Education', 'renamed.txt') };
  }

  it('restores the file and removes only the folder it created', async () => {
    const { root, repo, entry, a } = await moved();
    expect((await checkUndoEligibility(entry, root)).ok).toBe(true);
    const res = await undoOperation(repo, entry.id, root);
    expect(res.ok).toBe(true);
    expect(await fs.readFile(a, 'utf8')).toBe('content');
    await expect(fs.lstat(path.join(root, 'Education'))).rejects.toThrow();
    expect(repo.getHistory(entry.id)?.undoStatus).toBe('undone');
  });

  it('refuses when the original path is occupied and deletes nothing', async () => {
    const { root, repo, entry, a, dest } = await moved();
    await fs.writeFile(a, 'someone else');
    const res = await undoOperation(repo, entry.id, root);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/original location/i);
    expect(await fs.readFile(a, 'utf8')).toBe('someone else');
    expect(await fs.readFile(dest, 'utf8')).toBe('content');
  });

  it('refuses when the moved file was modified', async () => {
    const { root, repo, entry, dest, a } = await moved();
    await fs.writeFile(dest, 'edited after the move');
    const res = await undoOperation(repo, entry.id, root);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/modified/i);
    expect(await fs.readFile(dest, 'utf8')).toBe('edited after the move');
    await expect(fs.lstat(a)).rejects.toThrow();
  });

  it('refuses when the moved file is gone, and refuses a second undo', async () => {
    const { root, repo, entry, dest } = await moved();
    await fs.rm(dest);
    expect((await undoOperation(repo, entry.id, root)).ok).toBe(false);
    const again = await setup();
    const a = await writeFixture(again.root, 'x.txt', 'x');
    const op = await makeApprovedOp(again.db, again.repo, again.root, a, 'D', 'x.txt');
    await run(again.repo, again.root, op.planId, [op.id]);
    const e = again.repo.listHistory({ limit: 1, offset: 0 }).items[0];
    if (!e) throw new Error('no history');
    expect((await undoOperation(again.repo, e.id, again.root)).ok).toBe(true);
    expect((await undoOperation(again.repo, e.id, again.root)).ok).toBe(false);
  });
});

describe('recovery of interrupted operations', () => {
  async function crashAt(step: 'validated' | 'dest-dir-ready' | 'dest-published') {
    const ctx = await setup();
    const a = await writeFixture(ctx.root, 'a.txt', 'payload');
    const op = await makeApprovedOp(ctx.db, ctx.repo, ctx.root, a, 'D', 'a.txt');
    ctx.repo.journalStart(op); // journal says "started", then the process "dies" mid-move
    await expect(
      safeMove({ source: a, destination: op.destinationPath, expected: op.sourceFingerprint, onStep: (s) => { if (s === step) throw new Error('crash'); } })
    ).rejects.toBeDefined();
    return { ...ctx, a, dest: op.destinationPath, op };
  }

  it('crash before anything moved: marks not-started, file untouched', async () => {
    const { repo, a, op } = await crashAt('dest-dir-ready');
    const [r] = await reconcileInFlight(repo);
    expect(r?.result).toBe('not-started');
    expect(await fs.readFile(a, 'utf8')).toBe('payload');
    expect(repo.getOperation(op.id)?.status).toBe('interrupted');
  });

  it('crash after destination published: finishes the move after verifying identity', async () => {
    const { repo, a, dest } = await crashAt('dest-published');
    const [r] = await reconcileInFlight(repo);
    expect(r?.result).toBe('completed');
    await expect(fs.lstat(a)).rejects.toThrow();
    expect(await fs.readFile(dest, 'utf8')).toBe('payload');
    expect(repo.listHistory({ limit: 5, offset: 0 }).items[0]?.status).toBe('completed');
  });

  it('both present but different: keeps both and flags for review', async () => {
    const { repo, a, dest } = await crashAt('dest-published');
    await fs.rm(dest);
    await fs.writeFile(dest, 'a different file entirely');
    const [r] = await reconcileInFlight(repo);
    expect(r?.result).toBe('needs-review');
    expect(await fs.readFile(a, 'utf8')).toBe('payload');
    expect(await fs.readFile(dest, 'utf8')).toBe('a different file entirely');
  });

  it('neither present: deletes nothing and flags for review', async () => {
    const { repo, a } = await crashAt('dest-dir-ready');
    await fs.rm(a);
    const [r] = await reconcileInFlight(repo);
    expect(r?.result).toBe('needs-review');
  });
});
