import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AppError, toSerializedError } from '@shared/errors';
import type { Db } from '../database/connection';
import { canTransition, type JobSnapshot, type JobStatus, type JobType } from './types';

export interface JobContext {
  readonly id: string;
  readonly signal: AbortSignal;
  setTotal(n: number): void;
  setPhase(phase: string): void;
  progress(delta: { completed?: number; failed?: number; skipped?: number }): void;
}

export type JobRunner = (ctx: JobContext) => Promise<void>;

interface Row { id: string; type: JobType; status: JobStatus; phase: string | null; total: number | null; completed: number; failed: number; skipped: number; cancel_requested: number; error_code: string | null; error_message: string | null; created_at: number; updated_at: number; finished_at: number | null; }
const toSnap = (r: Row): JobSnapshot => ({ id: r.id, type: r.type, status: r.status, phase: r.phase, total: r.total, completed: r.completed, failed: r.failed, skipped: r.skipped, cancelRequested: r.cancel_requested === 1, errorCode: r.error_code, errorMessage: r.error_message, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at });

/**
 * Local, in-process job manager. Persisted so the app can explain what happened after a restart.
 * Progress events are throttled so a fast scan cannot flood the renderer.
 */
export class JobManager {
  private readonly events = new EventEmitter();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Set<Promise<void>>();
  private readonly queue: { id: string; run: JobRunner }[] = [];
  private active = 0;
  private readonly lastEmit = new Map<string, number>();

  constructor(private readonly db: Db, private readonly maxConcurrent = 2, private readonly emitIntervalMs = 100) {
    this.events.setMaxListeners(20);
  }

  /** Jobs left 'running'/'queued' by a previous process were interrupted. Never auto-resumed. */
  markStaleJobsInterrupted(now = Date.now()): number {
    return this.db.prepare(`UPDATE jobs SET status='interrupted', finished_at=?, updated_at=?, error_code='OPERATION_INTERRUPTED', error_message='The app closed while this job was running.' WHERE status IN ('queued','running')`).run(now, now).changes;
  }

  onUpdate(listener: (job: JobSnapshot) => void): () => void {
    this.events.on('update', listener);
    return () => this.events.off('update', listener);
  }

  get(id: string): JobSnapshot | null {
    const r = this.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as Row | undefined;
    return r ? toSnap(r) : null;
  }
  list(limit = 20): JobSnapshot[] {
    return (this.db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`).all(limit) as Row[]).map(toSnap);
  }
  hasActive(type: JobType): boolean {
    return (this.db.prepare(`SELECT COUNT(*) c FROM jobs WHERE type=? AND status IN ('queued','running')`).get(type) as { c: number }).c > 0;
  }

  submit(type: JobType, run: JobRunner, opts: { exclusive?: boolean } = {}): JobSnapshot {
    if (opts.exclusive !== false && this.hasActive(type)) throw new AppError('VALIDATION_FAILED', `A ${type} job is already running. Wait for it to finish or cancel it.`);
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO jobs (id,type,status,created_at,updated_at) VALUES (?,?,'queued',?,?)`).run(id, type, now, now);
    this.controllers.set(id, new AbortController());
    this.queue.push({ id, run });
    this.pump();
    return this.get(id) as JobSnapshot;
  }

  cancel(id: string): boolean {
    const job = this.get(id);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return false;
    this.db.prepare(`UPDATE jobs SET cancel_requested=1, updated_at=? WHERE id=?`).run(Date.now(), id);
    this.controllers.get(id)?.abort();
    if (job.status === 'queued') {
      const i = this.queue.findIndex((q) => q.id === id);
      if (i >= 0) this.queue.splice(i, 1);
      this.transition(id, 'cancelled');
    }
    this.emit(id, true);
    return true;
  }

  /** Requests cancellation of everything and waits for running jobs to settle. Used at shutdown. */
  async shutdown(): Promise<void> {
    for (const q of this.queue.splice(0)) this.transition(q.id, 'interrupted');
    for (const [id, c] of this.controllers) { c.abort(); this.db.prepare(`UPDATE jobs SET cancel_requested=1 WHERE id=?`).run(id); }
    await Promise.allSettled(this.running);
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift();
      if (!next) break;
      this.active++;
      const p: Promise<void> = this.execute(next.id, next.run).finally(() => { this.active--; this.running.delete(p); this.controllers.delete(next.id); this.lastEmit.delete(next.id); this.pump(); });
      this.running.add(p);
    }
  }

  private async execute(id: string, run: JobRunner): Promise<void> {
    const controller = this.controllers.get(id) as AbortController;
    this.transition(id, 'running');
    const ctx: JobContext = {
      id, signal: controller.signal,
      setTotal: (n) => { this.db.prepare(`UPDATE jobs SET total=?, updated_at=? WHERE id=?`).run(n, Date.now(), id); this.emit(id); },
      setPhase: (p) => { this.db.prepare(`UPDATE jobs SET phase=?, updated_at=? WHERE id=?`).run(p, Date.now(), id); this.emit(id, true); },
      progress: (d) => { this.db.prepare(`UPDATE jobs SET completed=completed+?, failed=failed+?, skipped=skipped+?, updated_at=? WHERE id=?`).run(d.completed ?? 0, d.failed ?? 0, d.skipped ?? 0, Date.now(), id); this.emit(id); }
    };
    try {
      await run(ctx);
      this.transition(id, controller.signal.aborted ? 'cancelled' : 'completed');
    } catch (error) {
      const ser = toSerializedError(error);
      if (ser.code === 'JOB_CANCELLED' || controller.signal.aborted) this.transition(id, 'cancelled');
      else this.transition(id, 'failed', ser.code, ser.message);
    }
  }

  private transition(id: string, to: JobStatus, code?: string, message?: string): void {
    const cur = this.get(id);
    if (!cur) return;
    if (!canTransition(cur.status, to)) throw new AppError('INTERNAL', `Illegal job transition ${cur.status} -> ${to}`);
    const now = Date.now();
    const terminal = to !== 'running';
    this.db.prepare(`UPDATE jobs SET status=?, updated_at=?, finished_at=?, error_code=?, error_message=? WHERE id=?`).run(to, now, terminal ? now : null, code ?? null, message ?? null, id);
    this.emit(id, true);
  }

  private emit(id: string, force = false): void {
    const now = Date.now();
    if (!force && now - (this.lastEmit.get(id) ?? 0) < this.emitIntervalMs) return;
    this.lastEmit.set(id, now);
    const snap = this.get(id);
    if (snap) this.events.emit('update', snap);
  }
}
