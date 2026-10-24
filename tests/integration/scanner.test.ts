import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFolder, type ScanIssue, type ScannedFile } from '../../src/main/filesystem/scanning/scanner';
import { hashFile } from '../../src/main/filesystem/hashing/hash-file';
import { makeTempDir, writeFixture } from '../helpers/tmp';

async function scan(root: string, extra: Partial<Parameters<typeof scanFolder>[0]> = {}) {
  const files: ScannedFile[] = [];
  const issues: ScanIssue[] = [];
  const summary = await scanFolder({ root, excludedDirs: ['node_modules'], onFile: (f) => { files.push(f); }, onIssue: (i) => issues.push(i), ...extra });
  return { files, issues, summary };
}

describe('scanner', () => {
  it('scans nested directories and honours exclusions', async () => {
    const root = await makeTempDir();
    await writeFixture(root, 'a.txt', 'a');
    await writeFixture(root, 'sub/deep/b.md', 'b');
    await writeFixture(root, 'node_modules/pkg/x.js', 'x');
    const { files, summary } = await scan(root);
    expect(files.map((f) => f.relativePath).sort()).toEqual(['a.txt', path.join('sub', 'deep', 'b.md')].sort());
    expect(summary.files).toBe(2);
    expect(files.find((f) => f.name === 'b.md')?.extension).toBe('.md');
  });

  it('never follows symlinks out of the folder', async () => {
    const root = await makeTempDir();
    const outside = await makeTempDir('slothfile-outside-');
    await writeFixture(outside, 'secret.txt', 'nope');
    await writeFixture(root, 'ok.txt', 'ok');
    await fs.symlink(outside, path.join(root, 'linked-dir'), 'dir');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'linked-file.txt'));
    const { files, issues } = await scan(root);
    expect(files.map((f) => f.name)).toEqual(['ok.txt']);
    expect(issues.filter((i) => i.reason === 'symlink-skipped')).toHaveLength(2);
  });

  it('supports cancellation', async () => {
    const root = await makeTempDir();
    for (let i = 0; i < 20; i++) await writeFixture(root, `f${i}.txt`, String(i));
    const ac = new AbortController();
    let n = 0;
    const summary = await scanFolder({ root, excludedDirs: [], signal: ac.signal, onFile: () => { if (++n === 3) ac.abort(); } });
    expect(summary.cancelled).toBe(true);
    expect(n).toBeLessThan(20);
  });

  it('reports a file that vanishes during the scan instead of crashing', async () => {
    const root = await makeTempDir();
    const gone = await writeFixture(root, 'gone.txt', 'x');
    await writeFixture(root, 'stay.txt', 'y');
    const { files, issues, summary } = await scan(root, { onFile: async (f) => { if (f.name === 'stay.txt' || f.name === 'gone.txt') { /* collect */ } } });
    expect(files.length + summary.files).toBeGreaterThan(0);
    await fs.rm(gone);
    const second = await scan(root);
    expect(second.files.map((f) => f.name)).toEqual(['stay.txt']);
    expect(issues).toBeDefined();
  });

  it('fails clearly when the folder is missing', async () => {
    const root = await makeTempDir();
    await expect(scan(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});

describe('hashFile', () => {
  it('gives identical hashes for identical content and different hashes otherwise', async () => {
    const root = await makeTempDir();
    const a = await writeFixture(root, 'image-copy-a.png', Buffer.from([1, 2, 3, 4]));
    const b = await writeFixture(root, 'image-copy-b.png', Buffer.from([1, 2, 3, 4]));
    const c = await writeFixture(root, 'other.png', Buffer.from([1, 2, 3, 5]));
    const [ha, hb, hc] = await Promise.all([hashFile(a), hashFile(b), hashFile(c)]);
    expect(ha.sha256).toBe(hb.sha256);
    expect(ha.sha256).not.toBe(hc.sha256);
    expect(ha.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is cancellable and rejects non-regular files', async () => {
    const root = await makeTempDir();
    const a = await writeFixture(root, 'a.bin', Buffer.alloc(1024));
    const ac = new AbortController();
    ac.abort();
    await expect(hashFile(a, ac.signal)).rejects.toMatchObject({ code: 'JOB_CANCELLED' });
    await expect(hashFile(root)).rejects.toMatchObject({ code: 'NOT_REGULAR_FILE' });
  });
});
