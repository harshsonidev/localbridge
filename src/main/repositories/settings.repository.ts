import type { SqlDatabase } from '../database/database';
import type { JsonStore } from './json-store';

export interface SettingsRepository {
  /** Raw key/value map; values are already-parsed JSON. */
  getAll(): Record<string, unknown>;
  set(key: string, value: unknown): void;
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  getAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[String(row.key)] = JSON.parse(String(row.value_json));
      } catch {
        // Skip unreadable values; defaults will apply.
      }
    }
    return result;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}

export class JsonSettingsRepository implements SettingsRepository {
  constructor(private readonly store: JsonStore) {}

  getAll(): Record<string, unknown> {
    return { ...this.store.get().settings };
  }

  set(key: string, value: unknown): void {
    this.store.write((data) => {
      data.settings[key] = value;
    });
  }
}
