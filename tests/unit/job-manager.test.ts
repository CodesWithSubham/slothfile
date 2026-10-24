import { describe, expect, it } from 'vitest';
import { JobManager } from '../../src/main/jobs/job-manager';
import { canTransition } from '../../src/main/jobs/types';
import { memoryDb } from '../helpers/plan-fixture';

const settle = async (jm: JobManager, id: string) => { for (let i = 0; i < 200; i++) { const j = jm.get(id); if (j && !['queued', 'running'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('job did not settle'); };

describe('job state machine', () => {
  it('only allows legal transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('cancelled', 'completed')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
  });
});

describe('JobManager', () => {
  it('runs a job and records progress', async () => {
    const jm = new JobManager(memoryDb());
    const j = jm.submit('scan', async (c) => { c.setTotal(3); c.progress({ completed: 3 }); });
    const done = await settle(jm, j.id);
    expect(done.status).toBe('completed');
    expect(done.completed).toBe(3);
  });
  it('records failures with a sanitized error', async () => {
    const jm = new JobManager(memoryDb());
    const j = jm.submit('scan', async () => { throw new Error('secret /home/user/stuff'); });
    const done = await settle(jm, j.id);
    expect(done.status).toBe('failed');
    expect(done.errorMessage).not.toMatch(/secret|home/);
  });
  it('cancels a running job', async () => {
    const jm = new JobManager(memoryDb());
    const j = jm.submit('hash', (c) => new Promise<void>((res) => c.signal.addEventListener('abort', () => res())));
    await new Promise((r) => setTimeout(r, 20));
    expect(jm.cancel(j.id)).toBe(true);
    expect((await settle(jm, j.id)).status).toBe('cancelled');
  });
  it('rejects a second exclusive job of the same type', async () => {
    const jm = new JobManager(memoryDb());
    jm.submit('scan', () => new Promise<void>(() => undefined));
    expect(() => jm.submit('scan', async () => undefined)).toThrow(/already running/);
  });
  it('bounds concurrency', async () => {
    const jm = new JobManager(memoryDb(), 1);
    let concurrent = 0, max = 0;
    const work = async () => { concurrent++; max = Math.max(max, concurrent); await new Promise((r) => setTimeout(r, 15)); concurrent--; };
    const a = jm.submit('scan', work), b = jm.submit('hash', work);
    await settle(jm, a.id); await settle(jm, b.id);
    expect(max).toBe(1);
  });
  it('marks stale jobs interrupted on startup and never resumes them', () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO jobs (id,type,status,created_at,updated_at) VALUES ('x','scan','running',1,1)`).run();
    expect(new JobManager(db).markStaleJobsInterrupted()).toBe(1);
    expect(new JobManager(db).get('x')?.status).toBe('interrupted');
  });
  it('removes event listeners when unsubscribed', async () => {
    const jm = new JobManager(memoryDb());
    let n = 0;
    const off = jm.onUpdate(() => { n++; });
    off();
    const j = jm.submit('scan', async () => undefined);
    await settle(jm, j.id);
    expect(n).toBe(0);
  });
});
