import path from 'node:path';
import { mkdirSync } from 'node:fs';
import pino, { type Logger } from 'pino';

/**
 * Structured logging to a file in the app's log directory. Redaction removes obvious sensitive keys;
 * call sites are additionally required never to pass document text or file names (see docs/privacy.md).
 */
export function createLogger(logDir: string | null, level = process.env.SLOTHFILE_LOG_LEVEL ?? 'info'): Logger {
  const redact = { paths: ['text', 'excerpt', 'content', 'password', 'token', 'apiKey', '*.text', '*.excerpt', '*.content'], censor: '[redacted]' };
  if (!logDir) return pino({ level, redact });
  mkdirSync(logDir, { recursive: true });
  return pino({ level, redact }, pino.destination({ dest: path.join(logDir, 'slothfile.log'), sync: false, mkdir: true }));
}
