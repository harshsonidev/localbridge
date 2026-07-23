/**
 * End-to-end integration: real mkcert + real Caddy, fully isolated.
 * - mkcert runs with CAROOT pointed at a temp dir (never touches the
 *   system trust store).
 * - Caddy listens on loopback-only high ports (18080/18443).
 * - The real system hosts file is never read or written (mock mode);
 *   requests use explicit Host/SNI headers instead of DNS.
 *
 * Skipped automatically when the bundled binaries are not downloaded.
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainService } from '../src/main/services/domain.service';
import { HostsService } from '../src/main/services/hosts.service';
import { SettingsService } from '../src/main/services/settings.service';
import { MkcertService } from '../src/main/services/mkcert.service';
import {
  CertificateService,
  parseCertificate,
} from '../src/main/services/certificate.service';
import { CaddyProcessManager } from '../src/main/services/caddy.service';
import { TrafficService } from '../src/main/services/traffic.service';
import { JsonStore } from '../src/main/repositories/json-store';
import { JsonDomainRepository } from '../src/main/repositories/domain.repository';
import { JsonSettingsRepository } from '../src/main/repositories/settings.repository';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caddyBin = path.join(repoRoot, 'resources', 'windows', 'caddy.exe');
const mkcertBin = path.join(repoRoot, 'resources', 'windows', 'mkcert.exe');
const binariesPresent =
  process.platform === 'win32' && fs.existsSync(caddyBin) && fs.existsSync(mkcertBin);

const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

const HTTP_PORT = 18080;
const HTTPS_PORT = 18443;
const DOMAIN_A = 'lb-e2e-a.local';
const DOMAIN_B = 'lb-e2e-b.local';

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function requestHttps(
  hostHeader: string,
  reqPath = '/',
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: HTTPS_PORT,
        path: reqPath,
        method: 'GET',
        headers: { host: hostHeader, ...extraHeaders },
        servername: hostHeader,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function requestHttp(hostHeader: string, reqPath = '/'): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HTTP_PORT,
        path: reqPath,
        method: 'GET',
        headers: { host: hostHeader },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe.skipIf(!binariesPresent)('end-to-end proxy flow (real mkcert + real Caddy)', () => {
  let dir: string;
  let upstream: http.Server;
  let upstreamPort: number;
  let service: DomainService;
  let caddy: CaddyProcessManager;
  let mkcert: MkcertService;
  let certificates: CertificateService;
  let repo: JsonDomainRepository;
  let traffic: TrafficService;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-e2e-'));
    for (const sub of ['caddy', 'caddy/data', 'certificates', 'mock', 'backups/hosts', 'caroot']) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }

    // Upstream "dev server" that echoes what it received.
    upstream = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          path: req.url,
          host: req.headers.host,
          forwardedProto: req.headers['x-forwarded-proto'],
          forwardedHost: req.headers['x-forwarded-host'],
        }),
      );
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as { port: number }).port;

    const store = new JsonStore(path.join(dir, 'store.json'));
    repo = new JsonDomainRepository(store);
    const settings = new SettingsService(new JsonSettingsRepository(store), noopLog);
    settings.update({ httpPort: HTTP_PORT, httpsPort: HTTPS_PORT });

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

    mkcert = new MkcertService(
      { getBinaryPath: () => mkcertBin, caRootOverride: path.join(dir, 'caroot') },
      noopLog,
    );
    certificates = new CertificateService({
      mkcert,
      certificatesDir: path.join(dir, 'certificates'),
      log: noopLog,
    });

    caddy = new CaddyProcessManager({
      getBinaryPath: () => caddyBin,
      caddyfilePath: path.join(dir, 'caddy', 'Caddyfile'),
      caddyDir: path.join(dir, 'caddy'),
      getPorts: () => ({ httpPort: HTTP_PORT, httpsPort: HTTPS_PORT }),
      log: noopLog,
    });

    traffic = new TrafficService(path.join(dir, 'caddy', 'access.log'), noopLog);

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
      // Non-default admin port so tests never collide with a running app.
      adminEndpoint: 'localhost:24019',
    });
  }, 60_000);

  afterAll(async () => {
    await caddy?.stop().catch(() => undefined);
    await new Promise<void>((r) => upstream?.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('creates an https domain with a real certificate', async () => {
    const result = await service.create({
      domain: DOMAIN_A,
      target: { host: '127.0.0.1', port: upstreamPort },
    });

    expect(result.preview.warnings).toEqual([]);
    expect(result.preview.caddyfile).toContain(`https://${DOMAIN_A} {`);

    const certFile = path.join(dir, 'certificates', `${DOMAIN_A}.pem`);
    expect(fs.existsSync(certFile)).toBe(true);
    const parsed = parseCertificate(certFile);
    expect(parsed?.sans).toContain(DOMAIN_A);

    const infos = certificates.list(repo.list());
    expect(infos).toHaveLength(1);
    expect(infos[0].status).toBe('valid');
  }, 60_000);

  it('validates the generated Caddyfile with the real binary', async () => {
    const validation = await caddy.validate();
    expect(validation.ok, validation.output).toBe(true);
  }, 30_000);

  it('starts Caddy and serves the domain over HTTPS end to end', async () => {
    const status = await caddy.start();
    expect(status.state).toBe('running');
    expect(status.pid).toBeGreaterThan(0);

    const res = await requestHttps(DOMAIN_A, '/api/hello?x=1');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, string>;
    expect(body.path).toBe('/api/hello?x=1');
    expect(body.host).toBe(DOMAIN_A);
    expect(body.forwardedProto).toBe('https');
    expect(body.forwardedHost).toBe(DOMAIN_A);
  }, 60_000);

  it('redirects HTTP to HTTPS', async () => {
    const res = await requestHttp(DOMAIN_A, '/somewhere');
    expect([301, 308]).toContain(res.status);
    expect(res.headers.location).toBe(`https://${DOMAIN_A}:${HTTPS_PORT}/somewhere`);
  }, 30_000);

  it('reloads gracefully when a second domain is added', async () => {
    await service.create({
      domain: DOMAIN_B,
      target: { host: '127.0.0.1', port: upstreamPort },
    });
    const status = await caddy.reload();
    expect(status.state).toBe('running');

    const res = await requestHttps(DOMAIN_B);
    expect(res.status).toBe(200);
    expect((JSON.parse(res.body) as Record<string, string>).host).toBe(DOMAIN_B);

    // The first domain keeps working through the reload.
    const resA = await requestHttps(DOMAIN_A);
    expect(resA.status).toBe(200);
  }, 60_000);

  it('captures traffic metadata and redacts sensitive headers', async () => {
    const res = await requestHttps(DOMAIN_A, '/traffic-probe?token=in-query', {
      authorization: 'Bearer super-secret-value',
      'x-trace': 'probe-123',
    });
    expect(res.status).toBe(200);

    // Give Caddy a moment to flush the access-log line.
    await new Promise((r) => setTimeout(r, 500));

    const records = traffic.list();
    const probe = records.find((r) => r.path === '/traffic-probe');
    expect(probe, 'traffic record for the probe request').toBeDefined();
    expect(probe?.host).toBe(DOMAIN_A);
    expect(probe?.method).toBe('GET');
    expect(probe?.status).toBe(200);
    expect(probe?.query).toBe('token=in-query');
    expect(probe?.durationMs).toBeGreaterThan(0);

    // Caddy's log filter deletes the Authorization header at the source;
    // if it were ever present, the service-level redaction masks it.
    const authHeader = Object.entries(probe?.requestHeaders ?? {}).find(
      ([name]) => name.toLowerCase() === 'authorization',
    );
    if (authHeader) expect(authHeader[1]).toBe('[redacted]');
    expect(JSON.stringify(probe)).not.toContain('super-secret-value');

    const trace = Object.entries(probe?.requestHeaders ?? {}).find(
      ([name]) => name.toLowerCase() === 'x-trace',
    );
    expect(trace?.[1]).toBe('probe-123');
  }, 30_000);

  it('returns 502-style errors when the upstream is down', async () => {
    await new Promise<void>((r) => upstream.close(() => r()));
    const res = await requestHttps(DOMAIN_A);
    expect(res.status).toBeGreaterThanOrEqual(500);
    // Bring it back for any later assertions/cleanup symmetry.
    upstream = http.createServer((_req, res2) => res2.end('ok'));
    await new Promise<void>((r) => upstream.listen(upstreamPort, '127.0.0.1', r));
  }, 30_000);

  it('stops cleanly', async () => {
    const status = await caddy.stop();
    expect(status.state).toBe('stopped');
    await expect(requestHttps(DOMAIN_A)).rejects.toThrow();
  }, 30_000);
});
