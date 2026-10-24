import { contextBridge, ipcRenderer } from 'electron';
import { IPC_INVOKE_CHANNEL, IPC_NAMES, JOB_EVENT_CHANNEL } from '@shared/contracts/names';
import type { SlothFileApi } from '@shared/contracts';
import type { JobSnapshot } from '@shared/types/domain';

/**
 * The entire surface exposed to the renderer. It is generated from the closed set of names in the shared
 * contract, so there is no way to pass an arbitrary channel, path or function through it.
 * ipcRenderer itself is never exposed.
 */
const invokers = Object.fromEntries(IPC_NAMES.map((name) => [name, (input?: unknown) => ipcRenderer.invoke(IPC_INVOKE_CHANNEL, { name, input })]));

const api = {
  ...invokers,
  onJobUpdate(callback: (job: JobSnapshot) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, job: JobSnapshot): void => callback(job);
    ipcRenderer.on(JOB_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(JOB_EVENT_CHANNEL, listener);
  }
} as unknown as SlothFileApi; // Single, documented cast: `invokers` is generated from the same key set that types SlothFileApi.

contextBridge.exposeInMainWorld('slothfile', api);
