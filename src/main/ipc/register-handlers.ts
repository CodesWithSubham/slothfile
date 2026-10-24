import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { AppError, toSerializedError } from '@shared/errors';
import { IPC_INVOKE_CHANNEL, JOB_EVENT_CHANNEL, ipcSchemas, type InvokeRequest, type IpcName, type IpcResult } from '@shared/contracts';
import type { JobSnapshot } from '@shared/types/domain';
import type { Logger } from 'pino';
import type { Handlers } from './handlers';
import { isTrustedSender, type AppOrigin } from './sender-policy';

/**
 * One invoke channel; the request names a handler from a closed set. Steps for every call:
 *  1. verify the sender is our own window loading our own app content,
 *  2. verify the name is a known handler (own-property check, no prototype tricks),
 *  3. validate the input with its Zod schema,
 *  4. run, and convert any failure into a sanitized serialized error.
 */
export function registerHandlers(handlers: Handlers, log: Logger, getTrustedContents: () => WebContents[], origin: AppOrigin): () => void {
  const listener = async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<unknown>> => {
    try {
      if (!isTrustedSender(event, getTrustedContents(), origin)) throw new AppError('IPC_FORBIDDEN', 'This request was not sent by the SlothFile window.');
      if (typeof raw !== 'object' || raw === null) throw new AppError('VALIDATION_FAILED', 'Malformed request.');
      const { name, input } = raw as InvokeRequest;
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ipcSchemas, name)) throw new AppError('VALIDATION_FAILED', 'Unknown request.');
      const parsed = ipcSchemas[name as IpcName].safeParse(input);
      if (!parsed.success) throw new AppError('VALIDATION_FAILED', `Invalid input: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; ')}`);
      const handler = handlers[name as IpcName] as (i: unknown) => unknown;
      return { ok: true, data: await handler(parsed.data) };
    } catch (error) {
      if (!(error instanceof AppError)) log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'unhandled IPC handler error');
      return { ok: false, error: toSerializedError(error) };
    }
  };
  ipcMain.handle(IPC_INVOKE_CHANNEL, listener);
  return () => ipcMain.removeHandler(IPC_INVOKE_CHANNEL);
}

export function broadcastJob(contents: WebContents[], job: JobSnapshot): void {
  for (const c of contents) if (!c.isDestroyed()) c.send(JOB_EVENT_CHANNEL, job);
}
