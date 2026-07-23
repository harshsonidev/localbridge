import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainService } from '../src/main/services/domain.service';
import { HostsService, parseManagedBlock } from '../src/main/services/hosts.service';
import { SettingsService } from '../src/main/services/settings.service';
import { MkcertService } from '../src/main/services/mkcert.service';
import { CertificateService } from '../src/main/services/certificate.service';
import { JsonStore } from '../src/main/repositories/json-store';
import { JsonDomainRepository } from '../src/main/repositories/domain.repository';
import { JsonSettingsRepository } from '../src/main/repositories/settings.repository';
import type { DomainCreateInput } from '../src/shared/types';

const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

let dir: string;
let service: DomainService;
let repo: JsonDomainRepository;

function makeInput(overrides: Partial<DomainCreateInput> = {}): DomainCreateInput {
  return {
    domain: 'app.local',
    // Plain-http frontend so these tests never need certificates.
    frontend: { protocol: 'http', redirectHttpToHttps: false },
    target: { host: 'localhost', port: 3000 },
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-svc-'));
  const store = new JsonStore(path.join(dir, 'store.json'));
  repo = new JsonDomainRepository(store);
  const settings = new SettingsService(new JsonSettingsRepository(store), noopLog);

  const hosts = new HostsService(
    {
      hostsPath: path.join(dir, 'mock', 'hosts'),
      backupDir: path.join(dir, 'backups', 'hosts'),
      stagingDir: path.join(dir, 'staging'),
      shouldFlushDns: () => false,
    },
    { grantFileWritable: async () => {}, elevatedReplaceFile: async () => {}, flushDns: async () => {} },
    noopLog,
  );

  // Unavailable mkcert: certificate generation is skipped and https
  // sites are excluded with a warning (the integration suite covers
  // the real-mkcert path).
  const mkcert = new MkcertService(
    { getBinaryPath: () => path.join(dir, 'no-such-mkcert.exe') },
    noopLog,
  );
  const certificates = new CertificateService({
    mkcert,
    certificatesDir: path.join(dir, 'certificates'),
    log: noopLog,
  });

  service = new DomainService({
    repo,
    hosts,
    settings,
    certificates,
    paths: {
      userData: dir,
      database: path.join(dir, 'data'),
      certificatesDir: path.join(dir, 'certificates'),
      caddyDir: path.join(dir, 'caddy'),
      caddyfile: path.join(dir, 'caddy', 'Caddyfile'),
      hostsFile: path.join(dir, 'mock', 'hosts'),
      hostsBackupDir: path.join(dir, 'backups', 'hosts'),
      stagingDir: path.join(dir, 'staging'),
      logsDir: path.join(dir, 'logs'),
      logFile: path.join(dir, 'logs', 'localbridge.log'),
      accessLogFile: path.join(dir, 'caddy', 'access.log'),
    },
    log: noopLog,
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('DomainService.create', () => {
  it('persists the domain and writes hosts block + Caddyfile', async () => {
    const result = await service.create(makeInput());

    expect(result.domain.domain).toBe('app.local');
    expect(repo.getByDomain('app.local')).not.toBeNull();

    const hostsContent = fs.readFileSync(path.join(dir, 'mock', 'hosts'), 'utf8');
    expect(parseManagedBlock(hostsContent)).toEqual(['app.local']);

    const caddyfile = fs.readFileSync(path.join(dir, 'caddy', 'Caddyfile'), 'utf8');
    expect(caddyfile).toContain('http://app.local {');
    expect(result.preview.caddyfile).toBe(caddyfile);
  });

  it('excludes https domains and warns when no certificate is available', async () => {
    const result = await service.create(
      makeInput({ frontend: { protocol: 'https', redirectHttpToHttps: true } }),
    );
    expect(result.preview.warnings.some((w) => w.includes('certificate not available'))).toBe(true);
    expect(result.preview.caddyfile).not.toContain('https://app.local {');
    // Hosts entry still exists so the domain resolves once certs arrive.
    const hostsContent = fs.readFileSync(path.join(dir, 'mock', 'hosts'), 'utf8');
    expect(parseManagedBlock(hostsContent)).toEqual(['app.local']);
  });

  it('warns when the target is unreachable but still creates', async () => {
    const result = await service.create(makeInput({ target: { host: '127.0.0.1', port: 1 } }));
    expect(result.warnings.some((w) => w.includes('not reachable'))).toBe(true);
    expect(repo.getByDomain('app.local')).not.toBeNull();
  });

  it('rejects duplicates', async () => {
    await service.create(makeInput());
    await expect(service.create(makeInput())).rejects.toThrow(/already exists/i);
  });

  it('rejects circular targets', async () => {
    await expect(
      service.create(makeInput({ target: { host: 'app.local', port: 3000 } })),
    ).rejects.toThrow(/loop/i);
    await expect(
      service.create(makeInput({ target: { host: 'localhost', port: 443 } })),
    ).rejects.toThrow(/loop/i);
  });
});

describe('DomainService.update / setEnabled', () => {
  it('disabling a domain removes it from the hosts block but keeps it stored', async () => {
    const created = await service.create(makeInput());
    await service.setEnabled(created.domain.id, false);

    const hostsContent = fs.readFileSync(path.join(dir, 'mock', 'hosts'), 'utf8');
    expect(parseManagedBlock(hostsContent)).toEqual([]);
    expect(repo.getById(created.domain.id)?.enabled).toBe(false);

    const caddyfile = fs.readFileSync(path.join(dir, 'caddy', 'Caddyfile'), 'utf8');
    expect(caddyfile).not.toContain('app.local');
  });

  it('updates the target', async () => {
    const created = await service.create(makeInput());
    const result = await service.update(created.domain.id, {
      target: { host: 'localhost', port: 4000 },
    });
    expect(result.domain.target.port).toBe(4000);
    expect(result.preview.caddyfile).toContain('127.0.0.1:4000');
  });
});

describe('DomainService.remove', () => {
  it('removes the domain and cleans the hosts block', async () => {
    const created = await service.create(makeInput());
    await service.remove(created.domain.id);

    expect(repo.getById(created.domain.id)).toBeNull();
    const hostsContent = fs.readFileSync(path.join(dir, 'mock', 'hosts'), 'utf8');
    expect(hostsContent).not.toContain('app.local');
  });
});

describe('DomainService rollback', () => {
  it('rolls back the database record when config generation fails', async () => {
    // Force the hosts write to fail by replacing the hosts file path
    // with a directory of the same name.
    fs.mkdirSync(path.join(dir, 'mock', 'hosts'), { recursive: true });

    await expect(service.create(makeInput())).rejects.toThrow();
    expect(repo.getByDomain('app.local')).toBeNull();
  });
});

describe('DomainService.publicUrl', () => {
  it('builds the URL from protocol and configured ports', async () => {
    const created = await service.create(makeInput());
    expect(service.publicUrl(created.domain.id)).toBe('http://app.local');
  });
});
