import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteDatabase } from '../src/main/database/database';
import {
  JsonDomainRepository,
  SqliteDomainRepository,
  type DomainRepository,
} from '../src/main/repositories/domain.repository';
import {
  JsonSettingsRepository,
  SqliteSettingsRepository,
} from '../src/main/repositories/settings.repository';
import { JsonStore } from '../src/main/repositories/json-store';
import type { DomainConfig } from '../src/shared/types';

function makeDomain(overrides: Partial<DomainConfig> = {}): DomainConfig {
  return {
    id: crypto.randomUUID(),
    name: 'Test',
    domain: 'test.local',
    enabled: true,
    frontend: { protocol: 'https', redirectHttpToHttps: true },
    target: { protocol: 'http', host: 'localhost', port: 3000, basePath: '/api' },
    proxy: {
      preserveHost: true,
      rewriteHost: undefined,
      websockets: true,
      http2: true,
      requestHeaders: { 'X-Env': 'local' },
      responseHeaders: { 'X-Res': 'yes' },
      requestTimeoutMs: 30000,
      responseTimeoutMs: 45000,
    },
    healthCheck: { enabled: true, path: '/health', intervalSeconds: 15 },
    inspectionEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let dir: string;
let openDbs: { close(): void }[] = [];

async function openTracked(dbPath: string) {
  const db = await openSqliteDatabase(dbPath);
  openDbs.push(db);
  return db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-repo-'));
  openDbs = [];
});

afterEach(() => {
  // SQLite files stay locked on Windows until the handle is closed.
  for (const db of openDbs) {
    try {
      db.close();
    } catch {
      // Already closed by the test itself.
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function repoSuite(name: string, factory: () => Promise<DomainRepository>) {
  describe(`${name} domain repository`, () => {
    it('inserts and reads back a full config round-trip', async () => {
      const repo = await factory();
      const domain = makeDomain();
      repo.insert(domain);

      const loaded = repo.getById(domain.id);
      expect(loaded).toEqual(domain);
      expect(repo.getByDomain('test.local')?.id).toBe(domain.id);
    });

    it('lists domains sorted by name', async () => {
      const repo = await factory();
      repo.insert(makeDomain({ domain: 'zeta.local' }));
      repo.insert(makeDomain({ domain: 'alpha.local' }));
      expect(repo.list().map((d) => d.domain)).toEqual(['alpha.local', 'zeta.local']);
    });

    it('updates domains including headers', async () => {
      const repo = await factory();
      const domain = makeDomain();
      repo.insert(domain);

      const updated: DomainConfig = {
        ...domain,
        enabled: false,
        proxy: { ...domain.proxy, requestHeaders: { 'X-New': 'value' } },
      };
      repo.update(updated);

      const loaded = repo.getById(domain.id);
      expect(loaded?.enabled).toBe(false);
      expect(loaded?.proxy.requestHeaders).toEqual({ 'X-New': 'value' });
    });

    it('removes domains', async () => {
      const repo = await factory();
      const domain = makeDomain();
      repo.insert(domain);
      repo.remove(domain.id);
      expect(repo.getById(domain.id)).toBeNull();
      expect(repo.list()).toHaveLength(0);
    });

    it('rejects duplicate domain names', async () => {
      const repo = await factory();
      repo.insert(makeDomain({ domain: 'dup.local' }));
      expect(() => repo.insert(makeDomain({ domain: 'dup.local' }))).toThrow();
    });
  });
}

repoSuite('sqlite', async () => {
  const db = await openTracked(path.join(dir, 'test.db'));
  return new SqliteDomainRepository(db);
});

repoSuite('json', async () => {
  return new JsonDomainRepository(new JsonStore(path.join(dir, 'store.json')));
});

describe('json store persistence', () => {
  it('persists across instances', () => {
    const file = path.join(dir, 'persist.json');
    const repo1 = new JsonDomainRepository(new JsonStore(file));
    const domain = makeDomain();
    repo1.insert(domain);

    const repo2 = new JsonDomainRepository(new JsonStore(file));
    expect(repo2.getById(domain.id)).toEqual(domain);
  });
});

describe('settings repositories', () => {
  it('sqlite: upserts and reads settings', async () => {
    const db = await openTracked(path.join(dir, 'settings.db'));
    const repo = new SqliteSettingsRepository(db);
    repo.set('app', { httpPort: 8080 });
    repo.set('app', { httpPort: 9090 });
    expect(repo.getAll()).toEqual({ app: { httpPort: 9090 } });
  });

  it('json: upserts and reads settings', () => {
    const repo = new JsonSettingsRepository(new JsonStore(path.join(dir, 's.json')));
    repo.set('app', { theme: 'dark' });
    expect(repo.getAll()).toEqual({ app: { theme: 'dark' } });
  });
});

describe('migrations', () => {
  it('creates the full schema and is idempotent on reopen', async () => {
    const dbPath = path.join(dir, 'migrate.db');
    const db1 = await openTracked(dbPath);
    db1.close();
    const db2 = await openTracked(dbPath);
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    for (const expected of ['domains', 'domain_headers', 'certificates', 'settings', 'traffic_records', 'logs']) {
      expect(tables).toContain(expected);
    }
    // The Projects feature was removed in migration 2.
    expect(tables).not.toContain('projects');
    expect(tables).not.toContain('services');
    db2.close();
  });
});
