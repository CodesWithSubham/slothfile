import type { IpcMainInvokeEvent, WebContents } from 'electron';

export interface AppOrigin { isDev: boolean; devUrl?: string }

/**
 * A sender is trusted only if (a) its WebContents is one of our own windows, (b) the frame is the top-level
 * frame (no iframes), and (c) it is showing our bundled app (file://…/renderer/index.html) or, in dev only, the Vite dev server.
 */
export function isTrustedSender(event: IpcMainInvokeEvent, trusted: WebContents[], origin: AppOrigin): boolean {
  if (!trusted.some((w) => w.id === event.sender.id)) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  return isTrustedUrl(frame.url, origin);
}

export function isTrustedUrl(url: string, origin: AppOrigin): boolean {
  try {
    const u = new URL(url);
    if (origin.isDev && origin.devUrl) return u.origin === new URL(origin.devUrl).origin;
    return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html');
  } catch {
    return false;
  }
}
