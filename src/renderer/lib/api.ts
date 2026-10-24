import type { SerializedError } from '@shared/errors';
import type { IpcResult } from '@shared/contracts';

/** Error thrown into TanStack Query when a main-process call returns { ok: false }. Carries only the sanitized error. */
export class ApiError extends Error {
  readonly code: SerializedError['code'];
  constructor(e: SerializedError) { super(e.message); this.name = 'ApiError'; this.code = e.code; }
}

export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new ApiError(r.error);
  return r.data;
}

export const api = (): Window['slothfile'] => window.slothfile;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');
