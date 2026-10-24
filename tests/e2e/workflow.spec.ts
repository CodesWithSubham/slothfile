import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFakeOllama } from './fake-ollama';
import { tinyPdf } from '../helpers/pdf';

const root = path.resolve(__dirname, '../..');
const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function launch(userData: string, pickedFolder: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env } as Record<string, string>;
  delete env.NODE_OPTIONS; // Electron rejects some NODE_OPTIONS flags
  const app = await electron.launch({ args: [root, '--no-sandbox', `--user-data-dir=${userData}`], env });
  // Stub only the native folder dialog; everything else is the real app.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never; }, pickedFolder);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test('primary workflow: scan, dedupe, classify, review, execute, history, undo, restart', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'sf-e2e-'));
  const fixtures = path.join(work, 'fixtures');
  const userData = path.join(work, 'userdata');
  await fs.mkdir(fixtures, { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  await fs.writeFile(path.join(fixtures, 'random-name-01.txt'), 'Lecture about graph theory and shortest paths.');
  await fs.writeFile(path.join(fixtures, 'lecture-notes.md'), '# Lecture notes\nTrees and traversals.');
  await fs.writeFile(path.join(fixtures, 'sample-report.pdf'), tinyPdf('Quarterly Sales Report'));
  await fs.writeFile(path.join(fixtures, 'image-copy-a.png'), png);
  await fs.writeFile(path.join(fixtures, 'image-copy-b.png'), png);
  const fake = await startFakeOllama();

  let { app, page } = await launch(userData, fixtures);
  try {
    // First run: empty state, AI not required.
    await expect(page.getByRole('heading', { name: 'Start with a folder' })).toBeVisible();

    // Select + scan
    await page.getByRole('link', { name: 'Folders & scan' }).click();
    await page.getByRole('button', { name: 'Choose folder…' }).first().click();
    await expect(page.getByText('fixtures', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await expect(page.getByText(/Last scanned/)).toBeVisible();

    // Duplicates (deterministic, no AI)
    await page.getByRole('button', { name: 'Find duplicates' }).first().click();
    await page.getByRole('link', { name: 'Duplicates' }).click();
    await expect(page.getByText('2 identical files')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('image-copy-a.png', { exact: true })).toBeVisible();

    // Point settings at the fake local Ollama (loopback => no remote consent needed)
    await page.evaluate(([url]) => window.slothfile['settings.update']({ ollamaUrl: url, model: 'fake-gemma:1b' }), [fake.url] as [string]);
    await page.reload();

    // Files: select all, classify
    await page.getByRole('link', { name: 'Files' }).click();
    await expect(page.getByRole('row', { name: /random-name-01\.txt/ })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select all files on this page' }).check();
    await page.getByRole('button', { name: 'Suggest with AI' }).click();
    await expect(page.getByRole('row', { name: /random-name-01\.txt.*Classified/ })).toBeVisible({ timeout: 30_000 });
    expect(fake.requests).toBe(5);

    // Plan
    await page.getByRole('button', { name: /Build plan/ }).click();
    await expect(page.getByRole('heading', { name: 'Review your plan' })).toBeVisible();
    // two images proposed with the same name => conflict warning, cannot be approved
    await expect(page.getByText('Another operation in this plan targets the same destination.')).toBeVisible();
    // Nothing has moved yet.
    expect(await exists(path.join(fixtures, 'random-name-01.txt'))).toBe(true);
    expect(await exists(path.join(fixtures, 'Education'))).toBe(false);

    // Edit a proposed filename
    await page.getByRole('button', { name: 'Edit random-name-01.txt' }).click();
    await page.getByLabel('New file name').fill('graph-theory-notes.txt');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('graph-theory-notes.txt', { exact: true }).first()).toBeVisible();

    // Approve explicitly, then confirm
    await page.getByRole('button', { name: 'Approve random-name-01.txt' }).click();
    await page.getByRole('button', { name: 'Approve lecture-notes.md' }).click();
    await page.getByRole('button', { name: /Review & run \(2\)/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Nothing is overwritten');
    await page.getByRole('button', { name: 'Move 2 files' }).click();
    await expect(page.getByRole('heading', { name: 'Execution finished' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Filesystem truth
    expect(await fs.readFile(path.join(fixtures, 'Education', 'graph-theory-notes.txt'), 'utf8')).toContain('graph theory');
    expect(await exists(path.join(fixtures, 'Education', 'lecture-notes.md'))).toBe(true);
    expect(await exists(path.join(fixtures, 'random-name-01.txt'))).toBe(false);
    // Unapproved and unrelated files are untouched
    for (const n of ['sample-report.pdf', 'image-copy-a.png', 'image-copy-b.png']) expect(await exists(path.join(fixtures, n))).toBe(true);

    // History + Undo
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'graph-theory-notes.txt' })).toContainText('Completed');

    // Unsafe undo is refused: occupy the original location of lecture-notes.md
    await fs.writeFile(path.join(fixtures, 'lecture-notes.md'), 'someone else');
    await page.reload();
    await page.getByRole('link', { name: 'History' }).click();
    const lectureRow = page.getByRole('row').filter({ hasText: 'lecture-notes.md' });
    await expect(lectureRow).toContainText('Undo unavailable');
    await expect(lectureRow.getByRole('button', { name: 'Undo' })).toBeDisabled();

    // Safe undo succeeds
    const noteRow = page.getByRole('row').filter({ hasText: 'graph-theory-notes.txt' });
    await noteRow.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Move it back' }).click();
    await expect.poll(() => exists(path.join(fixtures, 'random-name-01.txt'))).toBe(true);
    expect(await exists(path.join(fixtures, 'Education', 'graph-theory-notes.txt'))).toBe(false);
    expect(await fs.readFile(path.join(fixtures, 'lecture-notes.md'), 'utf8')).toBe('someone else'); // never overwritten

    // Restart: history and settings persist
    await app.close();
    ({ app, page } = await launch(userData, fixtures));
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByText('Reversed')).toBeVisible();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByLabel('Ollama address')).toHaveValue(fake.url);
  } finally {
    await app.close().catch(() => undefined);
    await fake.close();
    await rm(work, { recursive: true, force: true });
  }
});

test('app starts and stays useful when Ollama is not running', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'sf-e2e-noai-'));
  const { app, page } = await launch(path.join(work, 'userdata'), work);
  try {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByText(/Could not reach Ollama|Install Ollama/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('How to set up local AI')).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByText(/AI is optional/)).toBeVisible();
  } finally {
    await app.close();
    await rm(work, { recursive: true, force: true });
  }
});

test('renderer is isolated: no Node globals, no raw ipcRenderer', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'sf-e2e-sec-'));
  const { app, page } = await launch(path.join(work, 'userdata'), work);
  try {
    const probe = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      ipc: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
      api: Object.keys(window.slothfile).length > 0,
      forged: undefined as unknown
    }));
    expect(probe.require).toBe('undefined');
    expect(probe.process).toBe('undefined');
    expect(probe.ipc).toBe('undefined');
    expect(probe.api).toBe(true);
    // A malformed or path-bearing request is rejected by main-process validation.
    const r = await page.evaluate(() => (window.slothfile as unknown as Record<string, (i: unknown) => Promise<{ ok: boolean; error?: { code: string } }>>)['scan.start']({ folderId: '/etc' }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
  } finally {
    await app.close();
    await rm(work, { recursive: true, force: true });
  }
});
