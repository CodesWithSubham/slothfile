import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { isTrustedUrl, type AppOrigin } from '../ipc/sender-policy';

export const CSP_PROD = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// Dev needs the Vite HMR websocket and inline module preamble.
export const CSP_DEV = "default-src 'self' http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*; object-src 'none'; base-uri 'none'";

export function createMainWindow(origin: AppOrigin): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 880, minHeight: 600, show: false, title: 'SlothFile', backgroundColor: '#f6f5f1',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, spellcheck: false
    }
  });

  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [origin.isDev ? CSP_DEV : CSP_PROD] } });
  });

  // No navigation away from the app, no new windows. External http(s) links open in the default browser only.
  win.webContents.on('will-navigate', (e, url) => { if (!isTrustedUrl(url, origin)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString()); } catch { /* ignore */ }
    return { action: 'deny' };
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.once('ready-to-show', () => win.show());
  return win;
}
