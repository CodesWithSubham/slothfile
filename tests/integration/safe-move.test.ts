import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeMove, type MoveStep } from '../../src/main/filesystem/operations/safe-move';
import { fingerprintOf } from '../../src/main/filesystem/hashing/fingerprint';
import { makeTempDir, writeFixture } from '../helpers/tmp';

describe('safeMove', () => {
  it('moves a file and creates the destination folder', async () => {
    const root = await makeTempDir();
    const src = await writeFixture(root, 'a.txt', 'hello');
    const dest = path.join(root, 'Documents', 'a-renamed.txt');
    const res = await safeMove({ source: src, destination: dest, expected: await fingerprintOf(src) });
    expect(res.method).toBe('link');
    expect(await fs.readFile(dest, 'utf8')).toBe('hello');
    await expect(fs.lstat(src)).rejects.toThrow();
    expect(res.createdDirs).toEqual([path.join(root, 'Documents')]);
  });

  it('never overwrites an existing destination', async () => {
    const root = await makeTempDir();
    const src = await writeFixture(root, 'a.txt', 'new');
    const dest = await writeFixture(root, 'Documents/a.txt', 'precious');
    await expect(safeMove({ source: src, destination: dest, expected: await fingerprintOf(src) })).rejects.toMatchObject({ code: 'DESTINATION_CONFLICT' });
    expect(await fs.readFile(dest, 'utf8')).toBe('precious');
    expect(await fs.readFile(src, 'utf8')).toBe('new');
  });

  it('refuses when the source changed since planning', async () => {
    const root = await makeTempDir();
    const src = await writeFixture(root, 'a.txt', 'v1');
    const expected = await fingerprintOf(src);
    await fs.writeFile(src, 'v2-longer');
    await expect(safeMove({ source: src, destination: path.join(root, 'X', 'a.txt'), expected })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(await fs.readFile(src, 'utf8')).toBe('v2-longer');
  });

  it('refuses to move a symlink or directory', async () => {
    const root = await makeTempDir();
    const target = await writeFixture(root, 'real.txt', 'x');
    const link = path.join(root, 'link.txt');
    await fs.symlink(target, link);
    await expect(fingerprintOf(link)).rejects.toMatchObject({ code: 'NOT_REGULAR_FILE' });
    await expect(fingerprintOf(root)).rejects.toMatchObject({ code: 'NOT_REGULAR_FILE' });
  });

  it('a crash after publishing the destination leaves two copies, never zero', async () => {
    const root = await makeTempDir();
    const src = await writeFixture(root, 'a.txt', 'data');
    const dest = path.join(root, 'D', 'a.txt');
    const crash = new Error('simulated crash');
    await expect(
      safeMove({
        source: src,
        destination: dest,
        expected: await fingerprintOf(src),
        onStep: (s: MoveStep) => {
          if (s === 'dest-published') throw crash;
        }
      })
    ).rejects.toBeDefined();
    expect(await fs.readFile(src, 'utf8')).toBe('data');
    expect(await fs.readFile(dest, 'utf8')).toBe('data');
  });

  it('honours an already-aborted signal without touching anything', async () => {
    const root = await makeTempDir();
    const src = await writeFixture(root, 'a.txt', 'x');
    const ac = new AbortController();
    ac.abort();
    await expect(safeMove({ source: src, destination: path.join(root, 'D', 'a.txt'), expected: await fingerprintOf(src), signal: ac.signal })).rejects.toMatchObject({ code: 'JOB_CANCELLED' });
    expect(await fs.readFile(src, 'utf8')).toBe('x');
  });
});
