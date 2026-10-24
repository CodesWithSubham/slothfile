import Database from 'better-sqlite3';
import { AppError } from '@shared/errors';
import { migration001 } from './migrations/001-initial';

export type Db = Database.Database;

export const MIGRATIONS = [migration001] as const;

export interface MigrationResult {
  applied: number[];
  currentVersion: number;
}

/** Applies pending migrations, each in its own transaction. Refuses databases from a newer app version. */
export function runMigrations(db: Db): MigrationResult {
  const current = db.pragma('user_version', { simple: true }) as number;
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  if (current > latest) {
    throw new AppError('DATABASE_ERROR', `The database was created by a newer version of SlothFile (schema ${current}). Update SlothFile to open it.`);
  }
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
    applied.push(m.version);
  }
  return { applied, currentVersion: Math.max(current, latest) };
}

export function openDatabase(file: string): { db: Db; migrations: MigrationResult } {
  try {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL'); // journal durability matters more than speed here
    db.pragma('busy_timeout = 3000');
    return { db, migrations: runMigrations(db) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DATABASE_ERROR', 'The SlothFile database could not be opened. It may be corrupted or locked by another instance.', undefined, { cause: error });
  }
}
