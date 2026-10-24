import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDestinationPath, isPathWithin, sanitizeSuggestedName, validateFileName } from '../../src/main/security/path-policy';

describe('isPathWithin', () => {
  const root = path.resolve('/data/Downloads');
  it('accepts children and the root itself', () => {
    expect(isPathWithin(root, path.join(root, 'a', 'b.txt'))).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
  });
  it('rejects siblings that merely share a string prefix', () => {
    expect(isPathWithin(root, path.resolve('/data/Downloads-evil/x.txt'))).toBe(false);
  });
  it('rejects traversal', () => {
    expect(isPathWithin(root, path.join(root, '..', 'etc', 'passwd'))).toBe(false);
  });
});

describe('validateFileName', () => {
  it.each(['', ' a', 'a ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'x.', 'a\u0000b'])('rejects %j', (n) => {
    expect(validateFileName(n).ok).toBe(false);
  });
  it('rejects Windows reserved names only on win32', () => {
    expect(validateFileName('CON.txt', 'win32').ok).toBe(false);
    expect(validateFileName('nul', 'win32').ok).toBe(false);
    expect(validateFileName('CON.txt', 'linux').ok).toBe(true);
  });
  it('rejects overlong names', () => {
    expect(validateFileName('a'.repeat(250)).ok).toBe(false);
  });
  it('accepts normal Unicode names', () => {
    expect(validateFileName('résumé 2026 – 日本語.pdf').ok).toBe(true);
  });
});

describe('sanitizeSuggestedName (untrusted model output)', () => {
  it('forces the original extension', () => {
    const r = sanitizeSuggestedName('semester-5-notes.exe', '.pdf');
    expect(r).toEqual({ ok: true, name: 'semester-5-notes.exe.pdf' });
  });
  it('does not double the extension', () => {
    expect(sanitizeSuggestedName('Notes.PDF', '.pdf')).toEqual({ ok: true, name: 'Notes.pdf' });
  });
  it('neutralizes path traversal attempts', () => {
    const r = sanitizeSuggestedName('../../etc/passwd', '.txt');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.name).not.toMatch(/[\\/]/); expect(r.name.startsWith('.')).toBe(false); }
  });
  it('strips control characters and hidden-file dots', () => {
    const r = sanitizeSuggestedName('.hidden\u0007name', '.md');
    expect(r).toEqual({ ok: true, name: 'hidden name.md' });
  });
  it('fails when nothing usable remains', () => {
    expect(sanitizeSuggestedName('///', '.txt').ok).toBe(false);
  });
  it('caps length', () => {
    const r = sanitizeSuggestedName('x'.repeat(500), '.txt');
    expect(r.ok && r.name.length <= 200).toBe(true);
  });
});

describe('buildDestinationPath', () => {
  it('derives destination from root + category dir + file name', () => {
    const root = path.resolve('/data/Downloads');
    expect(buildDestinationPath(root, 'education', 'notes.pdf')).toBe(path.join(root, 'Education', 'notes.pdf'));
  });
  it('refuses a file name containing a separator', () => {
    expect(() => buildDestinationPath('/data/x', 'other', '../evil.txt')).toThrow();
  });
});
