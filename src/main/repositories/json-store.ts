/**
 * File-backed JSON storage engine used as a fallback when node:sqlite is
 * unavailable in the current runtime. Implements the same repository
 * interfaces as the SQLite engine. Writes are atomic (tmp file + rename).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DomainConfig } from '../../shared/types';

export interface JsonStoreData {
  domains: DomainConfig[];
  settings: Record<string, unknown>;
}

const EMPTY: JsonStoreData = { domains: [], settings: {} };

export class JsonStore {
  private data: JsonStoreData;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): JsonStoreData {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(EMPTY);
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<JsonStoreData>;
    return {
      domains: Array.isArray(parsed.domains) ? parsed.domains : [],
      settings:
        parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    };
  }

  get(): JsonStoreData {
    return this.data;
  }

  /** Mutate inside `fn`, then persist atomically. Rolls back memory on failure. */
  write<T>(fn: (data: JsonStoreData) => T): T {
    const backup = structuredClone(this.data);
    try {
      const result = fn(this.data);
      this.persist();
      return result;
    } catch (err) {
      this.data = backup;
      throw err;
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
