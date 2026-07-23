/**
 * Thin synchronous SQL wrapper over the Node built-in `node:sqlite` module.
 *
 * node:sqlite ships with Node >= 22.13 (and with the Node runtime embedded
 * in current Electron releases) and requires no native compilation. The
 * repositories only depend on the small `SqlDatabase` surface below, so the
 * engine can be swapped (e.g. for better-sqlite3) without touching them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './schema';

export type SqlValue = string | number | bigint | null;

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  all(...params: SqlValue[]): Record<string, unknown>[];
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (
    location: string,
    options?: { enableForeignKeyConstraints?: boolean },
  ) => {
    prepare(sql: string): SqlStatement;
    exec(sql: string): void;
    close(): void;
  };
}

/** Throws if node:sqlite is unavailable in the current runtime. */
export async function openSqliteDatabase(dbPath: string): Promise<SqlDatabase> {
  const sqlite = (await import('node:sqlite')) as unknown as NodeSqliteModule;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new sqlite.DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL;');

  const wrapper: SqlDatabase = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => db.close(),
  };

  runMigrations(wrapper);
  return wrapper;
}

export function runMigrations(db: SqlDatabase): number {
  const row = db.prepare('PRAGMA user_version').get();
  const current = Number(row?.user_version ?? 0);
  let applied = 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      // PRAGMA does not support bound parameters; version is a trusted integer.
      db.exec(`PRAGMA user_version = ${Number(migration.version)}`);
    });
    applied += 1;
  }
  return applied;
}
