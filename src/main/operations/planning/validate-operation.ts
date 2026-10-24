import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError, isAppError } from '@shared/errors';
import { assertWithinScope, foldKey, isPathWithin, samePath, validateFileName } from '../../security/path-policy';
import { fingerprintOf, sameContentFingerprint } from '../../filesystem/hashing/fingerprint';
import type { PlannedOperation } from '../../database/repositories/operations-repo';

export interface ValidationContext {
  /** The selected folder. Source and destination must both live inside it. */
  scopeRoot: string;
  excludedDirs: readonly string[];
  /** Destination keys already claimed by other operations in the same plan (case/Unicode folded). */
  claimedDestinations?: Set<string>;
}

export interface ValidationIssue {
  code: 'SOURCE_MISSING' | 'NOT_REGULAR' | 'OUTSIDE_SCOPE' | 'SOURCE_CHANGED' | 'DEST_EXISTS' | 'DEST_SAME_AS_SOURCE' | 'BAD_NAME' | 'EXCLUDED' | 'DUPLICATE_DEST' | 'DEST_PARENT_IS_FILE' | 'UNREADABLE';
  message: string;
}

/**
 * Pure-ish validation (reads the filesystem, never writes). Run when a plan is built, whenever
 * an operation is edited, when the plan is previewed, and again immediately before execution.
 */
export async function validateOperation(op: PlannedOperation, ctx: ValidationContext): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], message: string): void => { issues.push({ code, message }); };

  const nameCheck = validateFileName(op.destFileName);
  if (!nameCheck.ok) add('BAD_NAME', nameCheck.reason);
  const dirCheck = validateFileName(op.destDirName);
  if (!dirCheck.ok) add('BAD_NAME', `Destination folder: ${dirCheck.reason}`);

  // The stored destination must equal what trusted code derives from (root, dir, name). Blocks tampered rows.
  const derived = path.join(path.resolve(ctx.scopeRoot), op.destDirName, op.destFileName);
  if (!samePath(derived, op.destinationPath)) add('OUTSIDE_SCOPE', 'The destination does not match the approved folder and file name.');

  try {
    await assertWithinScope(ctx.scopeRoot, op.sourcePath, 'The source file');
    await assertWithinScope(ctx.scopeRoot, op.destinationPath, 'The destination');
  } catch (e) {
    add('OUTSIDE_SCOPE', isAppError(e) ? e.message : 'Path could not be verified.');
    return issues; // nothing else is safe to evaluate
  }

  const rel = path.relative(path.resolve(ctx.scopeRoot), path.resolve(op.sourcePath)).split(path.sep);
  const excluded = new Set(ctx.excludedDirs.map((d) => d.toLowerCase()));
  if (rel.slice(0, -1).some((seg) => excluded.has(seg.toLowerCase())) || excluded.has(op.destDirName.toLowerCase())) {
    add('EXCLUDED', 'This path is inside an excluded folder.');
  }

  if (samePath(op.sourcePath, op.destinationPath)) add('DEST_SAME_AS_SOURCE', 'The file is already at this location with this name.');

  try {
    const fp = await fingerprintOf(op.sourcePath);
    if (!sameContentFingerprint(op.sourceFingerprint, fp)) add('SOURCE_CHANGED', 'The file changed since this plan was created.');
  } catch (e) {
    if (e instanceof AppError && e.code === 'FILE_NOT_FOUND') add('SOURCE_MISSING', 'The source file no longer exists.');
    else if (e instanceof AppError && e.code === 'NOT_REGULAR_FILE') add('NOT_REGULAR', 'The source is no longer a regular file.');
    else add('UNREADABLE', isAppError(e) ? e.message : 'The source could not be read.');
  }

  try {
    await fs.lstat(op.destinationPath);
    if (!samePath(op.sourcePath, op.destinationPath)) add('DEST_EXISTS', 'A file already exists at the destination. SlothFile never overwrites files.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && (e as NodeJS.ErrnoException).code !== 'ENOTDIR') add('UNREADABLE', 'The destination could not be checked.');
  }
  try {
    const parent = await fs.lstat(path.dirname(op.destinationPath));
    if (!parent.isDirectory()) add('DEST_PARENT_IS_FILE', 'A file (not a folder) exists where the destination folder should be.');
  } catch { /* parent will be created during execution */ }

  if (ctx.claimedDestinations) {
    // Always case-insensitive: over-matching is safe, and the target volume may be case-insensitive even on Linux.
    const key = foldKey(op.destinationPath, 'darwin');
    if (ctx.claimedDestinations.has(key)) add('DUPLICATE_DEST', 'Another operation in this plan targets the same destination.');
    else ctx.claimedDestinations.add(key);
  }
  return issues;
}

export const issuesToMessages = (issues: ValidationIssue[]): string[] => issues.map((i) => i.message);
export { isPathWithin };
