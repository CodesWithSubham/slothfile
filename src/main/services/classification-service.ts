import { AppError } from '@shared/errors';
import { extractText } from '../documents/extractors';
import type { FilesRepo, FileRecord } from '../database/repositories/files-repo';
import type { AIProvider } from '../ai/providers/types';
import type { JobContext } from '../jobs/job-manager';
import type { Settings } from '@shared/schemas/settings';
import type { Logger } from 'pino';

/**
 * Bounded-concurrency classification. Per-file failures are isolated and recorded; the job continues.
 * Extracted text lives only in memory for the duration of one request: it is never stored or logged.
 */
export async function runClassification(
  files: FilesRepo, provider: AIProvider, fileIds: string[], settings: Settings, ctx: JobContext, log: Logger
): Promise<void> {
  const status = await provider.getStatus();
  if (status.state !== 'ready') throw new AppError('MODEL_UNAVAILABLE', status.message);
  const todo = files.listFilesByIds(fileIds).filter((f) => !f.missing);
  ctx.setTotal(todo.length);
  ctx.setPhase('Classifying files');
  const model = status.selectedModel ?? '';
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (;;) {
      if (ctx.signal.aborted) return;
      const f = queue.shift();
      if (!f) return;
      await classifyOne(files, provider, f, model, settings, ctx, log);
    }
  };
  await Promise.all(Array.from({ length: Math.min(settings.aiConcurrency, Math.max(1, todo.length)) }, worker));
}

async function classifyOne(files: FilesRepo, provider: AIProvider, f: FileRecord, model: string, settings: Settings, ctx: JobContext, log: Logger): Promise<void> {
  try {
    let excerpt: string | null = null;
    if (settings.extractableExtensions.includes(f.extension)) {
      try { excerpt = (await extractText(f.path, f.extension, { maxFileBytes: settings.maxExtractBytes, maxChars: 4000, signal: ctx.signal })).text || null; }
      catch (e) { if (e instanceof AppError && e.code === 'JOB_CANCELLED') return; /* fall back to name/metadata only */ }
    }
    const result = await provider.classifyFile({ fileName: f.name, extension: f.extension, sizeBytes: f.size, excerpt }, { signal: ctx.signal });
    files.addClassification({ fileId: f.id, provider: provider.id, model, category: result.category, suggestedName: result.suggestedName, confidence: result.confidence, reason: result.reason });
    ctx.progress({ completed: 1 });
  } catch (e) {
    if (e instanceof AppError && e.code === 'JOB_CANCELLED') return;
    const code = e instanceof AppError ? e.code : 'INTERNAL';
    files.setClassificationStatus(f.id, 'failed');
    ctx.progress({ failed: 1 });
    log.warn({ fileId: f.id, code }, 'classification failed'); // never log file names or content
    if (code === 'MODEL_UNAVAILABLE') throw e; // the model is gone; stop instead of failing every file
  }
}
