import { app, BrowserWindow, dialog, type WebContents } from 'electron';
import path from 'node:path';
import { createAppContext, type AppContext } from './services/app-context';
import { createLogger } from './services/logger';
import { createHandlers } from './ipc/handlers';
import { broadcastJob, registerHandlers } from './ipc/register-handlers';
import { createMainWindow } from './windows/main-window';
import type { AppOrigin } from './ipc/sender-policy';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const origin: AppOrigin = { isDev, devUrl: process.env.ELECTRON_RENDERER_URL };

// Single instance: two processes sharing one SQLite journal would defeat crash reconciliation.
if (!app.requestSingleInstanceLock()) app.quit();

let ctx: AppContext | null = null;
let win: BrowserWindow | null = null;
let teardown: (() => void)[] = [];
let quitting = false;

const trusted = (): WebContents[] => (win && !win.isDestroyed() ? [win.webContents] : []);

async function boot(): Promise<void> {
  const dataDir = app.getPath('userData'); // per-user writable location, never the install directory
  const logDir = path.join(dataDir, 'logs');
  const log = createLogger(logDir);
  log.info({ version: app.getVersion(), platform: process.platform }, 'startup');
  try {
    ctx = await createAppContext(path.join(dataDir, 'slothfile.db'), log);
  } catch (e) {
    dialog.showErrorBox('SlothFile could not start', e instanceof Error ? e.message : 'The local database could not be opened.');
    app.exit(1);
    return;
  }
  const { handlers, dispose } = createHandlers(
    ctx,
    {
      version: app.getVersion(), dataDir, logDir, platform: process.platform,
      pickFolder: async () => {
        const opts = { title: 'Choose a folder to organize', properties: ['openDirectory' as const] };
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      }
    },
    (job) => broadcastJob(trusted(), job)
  );
  teardown.push(dispose, registerHandlers(handlers, log, trusted, origin));
  openWindow();
}

function openWindow(): void {
  win = createMainWindow(origin);
  win.on('closed', () => { win = null; });
  if (isDev && origin.devUrl) void win.loadURL(origin.devUrl);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(boot).catch((e: unknown) => {
  console.error('SlothFile failed to start:', e instanceof Error ? e.message : e);
  app.exit(1);
});

app.on('activate', () => { if (ctx && BrowserWindow.getAllWindows().length === 0) openWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Graceful shutdown: let any in-flight file move finish (jobs only stop BETWEEN operations), then close the DB.
app.on('before-quit', (e) => {
  if (quitting || !ctx) return;
  e.preventDefault();
  quitting = true;
  const c = ctx;
  teardown.forEach((t) => t());
  teardown = [];
  c.close().catch(() => undefined).finally(() => { ctx = null; app.quit(); });
});
