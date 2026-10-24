import { promises as fs } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createAppContext } from '../../src/main/services/app-context';
import { safeMove } from '../../src/main/filesystem/operations/safe-move';
import { makeApprovedOp } from '../helpers/plan-fixture';
import { makeTempDir, writeFixture } from '../helpers/tmp';
import { OperationsRepo } from '../../src/main/database/repositories/operations-repo';

const log = pino({ level: 'silent' });

describe('startup recovery (simulated crash mid-move)', () => {
  it('reconciles the journal against the filesystem on next launch and reports it', async () => {
    const dir = await makeTempDir();
    const root = path.join(dir, 'Downloads');
    await fs.mkdir(root);
    const dbFile = path.join(dir, 'slothfile.db');

    // Session 1: journal "started", publish the destination, then the process "dies" before removing the source.
    const s1 = await createAppContext(dbFile, log);
    const src = await writeFixture(root, 'report.txt', 'quarterly numbers');
    const op = await makeApprovedOp(s1.db, new OperationsRepo(s1.db), root, src, 'Finance', 'report.txt');
    s1.ops.journalStart(op);
    s1.jobs.submit('scan', () => new Promise<void>(() => undefined)); // a job that never finishes
    await expect(safeMove({ source: src, destination: op.destinationPath, expected: op.sourceFingerprint, onStep: (s) => { if (s === 'dest-published') throw new Error('power cut'); } })).rejects.toBeDefined();
    s1.db.close(); // no graceful shutdown

    // Session 2
    const s2 = await createAppContext(dbFile, log);
    expect(s2.recovery).toHaveLength(1);
    expect(s2.recovery[0]?.result).toBe('completed');
    expect(s2.interruptedJobs).toBe(1);
    await expect(fs.lstat(src)).rejects.toThrow();
    expect(await fs.readFile(op.destinationPath, 'utf8')).toBe('quarterly numbers');
    expect(s2.ops.listHistory({ limit: 5, offset: 0 }).items[0]?.status).toBe('completed');
    // Stale jobs are marked interrupted, never silently resumed.
    expect(s2.jobs.list()[0]?.status).toBe('interrupted');
    await s2.close();
    // And nothing is reconciled twice.
    const s3 = await createAppContext(dbFile, log);
    expect(s3.recovery).toHaveLength(0);
    await s3.close();
  });
});
