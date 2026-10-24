import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const dirs: string[] = [];

/** Creates an isolated temp dir that is always removed after the test. Never touches real user folders. */
export async function makeTempDir(prefix = 'slothfile-test-'): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export async function writeFixture(root: string, rel: string, content: string | Buffer): Promise<string> {
  const p = path.join(root, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content);
  return p;
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});
