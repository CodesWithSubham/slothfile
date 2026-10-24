import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError, mapFsError } from '@shared/errors';
import { DEFAULT_CATEGORY_DIRS, type Category } from '@shared/constants';

/**
 * Path policy: the single place that decides whether a path is acceptable.
 * Nothing the renderer or the model sends is trusted; destinations are always
 * computed here from (scope root + category dir + sanitized file name).
 */

type Platform = NodeJS.Platform;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const KNOWN_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.rar', '.7z', '.csv', '.json', '.html']);
export const MAX_FILENAME_LENGTH = 200;

/** Case-insensitive, Unicode-normalized comparison key. Deliberately conservative: may over-match, never under-match. */
export function foldKey(p: string, platform: Platform = process.platform): string {
  const resolved = path.resolve(p).normalize('NFC');
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string, platform: Platform = process.platform): boolean {
  return foldKey(a, platform) === foldKey(b, platform);
}

/** Lexical containment using path.relative (never a string-prefix check). `root` itself counts as within. */
export function isPathWithin(root: string, target: string, platform: Platform = process.platform): boolean {
  const rel = path.relative(foldKey(root, platform), foldKey(target, platform));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function realpathOfDeepestExisting(target: string): Promise<string> {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw mapFsError(error, 'Resolving path');
      const parent = path.dirname(current);
      if (parent === current) throw new AppError('INVALID_PATH', 'The path has no existing parent folder.');
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Verify `target` is inside `root` after resolving symlinks on every existing component.
 * Catches `root/link-to-elsewhere/file` escapes that lexical checks miss.
 */
export async function assertWithinScope(root: string, target: string, what = 'Path'): Promise<void> {
  if (!path.isAbsolute(root) || !path.isAbsolute(target)) throw new AppError('INVALID_PATH', `${what} must be an absolute path.`);
  if (!isPathWithin(root, target)) throw new AppError('OUTSIDE_SCOPE', `${what} is outside the selected folder and was refused.`);
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root).catch((e) => { throw mapFsError(e, 'Selected folder'); }), realpathOfDeepestExisting(target)]);
  if (!isPathWithin(realRoot, realTarget)) {
    throw new AppError('OUTSIDE_SCOPE', `${what} resolves outside the selected folder (symbolic link or junction) and was refused.`);
  }
}

export type FileNameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Strict validation of a single path segment. Used for user-edited names. */
export function validateFileName(name: string, platform: Platform = process.platform): FileNameCheck {
  const n = name.normalize('NFC');
  if (n.trim() === '') return { ok: false, reason: 'File name cannot be empty.' };
  if (n !== n.trim()) return { ok: false, reason: 'File name cannot start or end with a space.' };
  if (n === '.' || n === '..') return { ok: false, reason: 'File name cannot be "." or "..".' };
  if (n.length > MAX_FILENAME_LENGTH) return { ok: false, reason: `File name is longer than ${MAX_FILENAME_LENGTH} characters.` };
  INVALID_CHARS.lastIndex = 0;
  if (INVALID_CHARS.test(n)) return { ok: false, reason: 'File name contains characters that are not allowed (\\ / : * ? " < > | or control characters).' };
  if (n.endsWith('.')) return { ok: false, reason: 'File name cannot end with a dot.' };
  const base = n.split('.')[0] ?? n;
  if (platform === 'win32' && WINDOWS_RESERVED.test(base)) return { ok: false, reason: `"${base}" is a reserved name on Windows.` };
  return { ok: true, name: n };
}

/**
 * Lossy cleanup for untrusted suggestions (model output). Always forces the original
 * extension so a suggestion can never change what kind of file something is.
 */
export function sanitizeSuggestedName(suggested: string, originalExtension: string, platform: Platform = process.platform): FileNameCheck {
  const ext = originalExtension.toLowerCase();
  let base = suggested.normalize('NFC').replace(INVALID_CHARS, ' ').replace(/\s+/g, ' ').trim();
  // Remove any path-like leftovers and leading dots (hidden files).
  base = base.replace(/^[.\s]+/, '');
  const lower = base.toLowerCase();
  if (ext && lower.endsWith(ext)) {
    base = base.slice(0, base.length - ext.length);
  } else {
    const dot = lower.lastIndexOf('.');
    if (dot > 0 && KNOWN_EXTENSIONS.has(lower.slice(dot))) base = base.slice(0, dot);
  }
  base = base.replace(/[. ]+$/, '').trim();
  const maxBase = MAX_FILENAME_LENGTH - ext.length;
  if (base.length > maxBase) base = base.slice(0, maxBase).trim();
  if (base === '') return { ok: false, reason: 'Suggested name was empty after cleanup.' };
  return validateFileName(`${base}${ext}`, platform);
}

export function categoryDirName(category: Category, overrides?: Partial<Record<Category, string>>): string {
  return overrides?.[category] ?? DEFAULT_CATEGORY_DIRS[category];
}

/** Deterministic destination. The only way a destination path is ever created. */
export function buildDestinationPath(root: string, category: Category, fileName: string, overrides?: Partial<Record<Category, string>>): string {
  const check = validateFileName(fileName);
  if (!check.ok) throw new AppError('INVALID_PATH', check.reason);
  const dir = categoryDirName(category, overrides);
  const checkedDir = validateFileName(dir);
  if (!checkedDir.ok) throw new AppError('INVALID_PATH', `Destination folder name is invalid: ${checkedDir.reason}`);
  const dest = path.join(path.resolve(root), checkedDir.name, check.name);
  if (!isPathWithin(root, dest)) throw new AppError('OUTSIDE_SCOPE', 'Destination escaped the selected folder.');
  return dest;
}
