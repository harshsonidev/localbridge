/**
 * Storage factory. Prefers SQLite (node:sqlite, no native build step);
 * falls back to the JSON engine if the runtime lacks node:sqlite so the
 * app remains usable everywhere. The rest of the app only ever sees the
 * repository interfaces.
 */

import path from 'node:path';
import { openSqliteDatabase } from '../database/database';
import {
  JsonDomainRepository,
  SqliteDomainRepository,
  type DomainRepository,
} from './domain.repository';
import {
  JsonSettingsRepository,
  SqliteSettingsRepository,
  type SettingsRepository,
} from './settings.repository';
import { JsonStore } from './json-store';

export interface Storage {
  engine: 'sqlite' | 'json';
  domains: DomainRepository;
  settings: SettingsRepository;
  close(): void;
}

export async function createStorage(
  dataDir: string,
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<Storage> {
  const dbPath = path.join(dataDir, 'localbridge.db');
  try {
    const db = await openSqliteDatabase(dbPath);
    log.info(`Storage engine: sqlite (${dbPath})`);
    let closed = false;
    return {
      engine: 'sqlite',
      domains: new SqliteDomainRepository(db),
      settings: new SqliteSettingsRepository(db),
      close: () => {
        // Idempotent: node:sqlite throws if a database is closed twice.
        if (closed) return;
        closed = true;
        db.close();
      },
    };
  } catch (err) {
    log.warn(
      `node:sqlite unavailable in this runtime (${err instanceof Error ? err.message : String(err)}); ` +
        'falling back to the JSON storage engine.',
    );
    const store = new JsonStore(path.join(dataDir, 'localbridge.json'));
    return {
      engine: 'json',
      domains: new JsonDomainRepository(store),
      settings: new JsonSettingsRepository(store),
      close: () => undefined,
    };
  }
}
