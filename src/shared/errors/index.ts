/**
 * Application error model shared by main, preload and renderer.
 * Only `SerializedError` ever crosses the IPC boundary: no stacks, no raw
 * Node error objects.
 */

export const ERROR_CODES = [
  'PERMISSION_DENIED',
  'FILE_NOT_FOUND',
  'FILE_CHANGED',
  'INVALID_PATH',
  'OUTSIDE_SCOPE',
  'DESTINATION_CONFLICT',
  'NOT_REGULAR_FILE',
  'UNSUPPORTED_FILE_TYPE',
  'EXTRACTION_FAILED',
  'MODEL_UNAVAILABLE',
  'MODEL_TIMEOUT',
  'INVALID_AI_RESPONSE',
  'DATABASE_ERROR',
  'JOB_CANCELLED',
  'OPERATION_INTERRUPTED',
  'UNDO_UNAVAILABLE',
  'VALIDATION_FAILED',
  'NOT_APPROVED',
  'IPC_FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  /** Short, non-sensitive extra context. Never contains stack traces. */
  details?: Record<string, string | number | boolean | null>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: SerializedError['details'];

  constructor(code: ErrorCode, message: string, details?: SerializedError['details'], options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  serialize(): SerializedError {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Map a Node.js fs error to an actionable AppError. Never leaks raw paths beyond the message. */
export function mapFsError(error: unknown, context: string): AppError {
  if (isAppError(error)) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  switch (code) {
    case 'ENOENT':
      return new AppError('FILE_NOT_FOUND', `${context}: the file or folder no longer exists.`, undefined, { cause: error });
    case 'EACCES':
    case 'EPERM':
      return new AppError('PERMISSION_DENIED', `${context}: permission denied. Check the file is not read-only or locked by another program.`, undefined, { cause: error });
    case 'EEXIST':
      return new AppError('DESTINATION_CONFLICT', `${context}: the destination already exists. No file was overwritten.`, undefined, { cause: error });
    case 'EBUSY':
      return new AppError('PERMISSION_DENIED', `${context}: the file is in use by another program.`, undefined, { cause: error });
    default:
      return new AppError('INTERNAL', `${context}: unexpected filesystem error${code ? ` (${code})` : ''}.`, undefined, { cause: error });
  }
}

/** Convert anything thrown into a sanitized error that is safe to send to the renderer. */
export function toSerializedError(error: unknown): SerializedError {
  if (isAppError(error)) return error.serialize();
  return { code: 'INTERNAL', message: 'An unexpected error occurred. Check the diagnostic log for details.' };
}
