import { describe, expect, it } from 'vitest';
import {
  generateCaddyfile,
  caddyQuote,
  toCaddyPath,
  type CaddyfileOptions,
} from '../src/main/services/caddyfile.service';
import type { DomainConfig } from '../src/shared/types';

function makeDomain(overrides: Partial<DomainConfig> = {}): DomainConfig {
  const base: DomainConfig = {
    id: 'test-id',
    name: 'Test',
    domain: 'app.local',
    enabled: true,
    frontend: { protocol: 'https', redirectHttpToHttps: true },
    target: { protocol: 'http', host: 'localhost', port: 3000 },
    proxy: {
      preserveHost: true,
      websockets: true,
      http2: true,
      requestHeaders: {},
      responseHeaders: {},
      requestTimeoutMs: 30000,
      responseTimeoutMs: 30000,
    },
    healthCheck: { enabled: false, path: '/', intervalSeconds: 10 },
    inspectionEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    ...base,
    ...overrides,
    frontend: { ...base.frontend, ...overrides.frontend },
    target: { ...base.target, ...overrides.target },
    proxy: { ...base.proxy, ...overrides.proxy },
  };
}

const options: CaddyfileOptions = {
  httpPort: 80,
  httpsPort: 443,
  accessLogPath: 'C:\\Users\\dev\\AppData\\Roaming\\LocalBridge\\caddy\\access.log',
  resolveCertificate: (d) => ({
    certFile: `C:\\certs\\${d.domain}.pem`,
    keyFile: `C:\\certs\\${d.domain}-key.pem`,
  }),
};

describe('caddyQuote', () => {
  it('quotes and escapes values', () => {
    expect(caddyQuote('plain')).toBe('"plain"');
    expect(caddyQuote('with "quotes"')).toBe('"with \\"quotes\\""');
    expect(caddyQuote('back\\slash')).toBe('"back\\\\slash"');
  });

  it('rejects control characters (config injection)', () => {
    expect(() => caddyQuote('bad\nvalue')).toThrow();
    expect(() => caddyQuote('bad\rvalue')).toThrow();
  });
});

describe('toCaddyPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toCaddyPath('C:\\Users\\x\\cert.pem')).toBe('C:/Users/x/cert.pem');
  });
});

describe('generateCaddyfile', () => {
  it('emits global options with admin and auto_https off', () => {
    const output = generateCaddyfile([makeDomain()], options);
    expect(output).toContain('admin off');
    expect(output).toContain('auto_https off');
  });

  it('emits custom ports in the global block only when non-default', () => {
    const def = generateCaddyfile([makeDomain()], options);
    expect(def).not.toContain('http_port');
    const custom = generateCaddyfile([makeDomain()], { ...options, httpPort: 8080, httpsPort: 8443 });
    expect(custom).toContain('http_port 8080');
    expect(custom).toContain('https_port 8443');
  });

  it('binds to loopback only and supports the admin endpoint option', () => {
    const off = generateCaddyfile([makeDomain()], options);
    expect(off).toContain('admin off');
    expect(off).toContain('default_bind "127.0.0.1"');

    const withAdmin = generateCaddyfile([makeDomain()], {
      ...options,
      adminEndpoint: 'localhost:2019',
    });
    expect(withAdmin).toContain('admin "localhost:2019"');
    expect(withAdmin).not.toContain('admin off');
  });

  it('generates an HTTPS site with tls paths in forward-slash form', () => {
    const output = generateCaddyfile([makeDomain()], options);
    expect(output).toContain('https://app.local {');
    expect(output).toContain('tls "C:/certs/app.local.pem" "C:/certs/app.local-key.pem"');
  });

  it('generates the HTTP redirect block when enabled', () => {
    const output = generateCaddyfile([makeDomain()], options);
    expect(output).toContain('http://app.local {');
    expect(output).toContain('redir https://app.local{uri} permanent');
  });

  it('omits the redirect when disabled', () => {
    const output = generateCaddyfile(
      [makeDomain({ frontend: { protocol: 'https', redirectHttpToHttps: false } })],
      options,
    );
    expect(output).not.toContain('redir');
  });

  it('points the redirect at the custom https port', () => {
    const output = generateCaddyfile([makeDomain()], { ...options, httpsPort: 8443 });
    expect(output).toContain('redir https://app.local:8443{uri} permanent');
  });

  it('proxies to the target with forwarding headers', () => {
    const output = generateCaddyfile([makeDomain()], options);
    expect(output).toContain('reverse_proxy 127.0.0.1:3000 {');
    expect(output).toContain('header_up Host {host}');
    expect(output).toContain('header_up X-Forwarded-Host {host}');
    expect(output).toContain('header_up X-Forwarded-Proto {scheme}');
    expect(output).toContain('header_up X-Forwarded-Port {server_port}');
  });

  it('rewrites Host when preserveHost is off', () => {
    const rewritten = generateCaddyfile(
      [makeDomain({ proxy: { preserveHost: false, rewriteHost: 'internal.host' } as never })],
      options,
    );
    expect(rewritten).toContain('header_up Host "internal.host"');

    const upstream = generateCaddyfile(
      [makeDomain({ proxy: { preserveHost: false } as never })],
      options,
    );
    expect(upstream).toContain('header_up Host {upstream_hostport}');
  });

  it('includes custom request/response headers, quoted', () => {
    const output = generateCaddyfile(
      [
        makeDomain({
          proxy: {
            requestHeaders: { 'X-Env': 'local "dev"' },
            responseHeaders: { 'X-Powered-By': 'LocalBridge' },
          } as never,
        }),
      ],
      options,
    );
    expect(output).toContain('header_up X-Env "local \\"dev\\""');
    expect(output).toContain('header_down X-Powered-By "LocalBridge"');
  });

  it('supports https upstreams and insecure TLS opt-in', () => {
    const output = generateCaddyfile(
      [
        makeDomain({
          target: { protocol: 'https', host: '127.0.0.1', port: 8443, allowInvalidCertificate: true },
        }),
      ],
      options,
    );
    expect(output).toContain('reverse_proxy https://127.0.0.1:8443 {');
    expect(output).toContain('tls_insecure_skip_verify');
  });

  it('excludes disabled domains', () => {
    const output = generateCaddyfile(
      [makeDomain(), makeDomain({ id: 'x2', domain: 'off.local', enabled: false })],
      options,
    );
    expect(output).toContain('app.local');
    expect(output).not.toContain('off.local');
  });

  it('adds a JSON access log with credential filtering only when inspection is enabled', () => {
    const off = generateCaddyfile([makeDomain()], options);
    expect(off).not.toContain('wrap json');
    const on = generateCaddyfile([makeDomain({ inspectionEnabled: true })], options);
    expect(on).toContain('output file');
    expect(on).toContain('wrap json');
    expect(on).toContain('request>headers>Authorization delete');
    expect(on).toContain('request>headers>Cookie delete');
    expect(on).toContain('resp_headers>Set-Cookie delete');
  });

  it('generates plain HTTP sites without tls', () => {
    const output = generateCaddyfile(
      [makeDomain({ frontend: { protocol: 'http', redirectHttpToHttps: false } })],
      options,
    );
    expect(output).toContain('http://app.local {');
    expect(output).not.toContain('tls ');
  });

  it('supports strip prefix and base-path rewrite', () => {
    const output = generateCaddyfile(
      [
        makeDomain({
          proxy: { stripPrefix: '/app' } as never,
          target: { protocol: 'http', host: 'localhost', port: 3000, basePath: '/api' },
        }),
      ],
      options,
    );
    expect(output).toContain('uri strip_prefix "/app"');
    expect(output).toContain('rewrite * "/api{uri}"');
  });

  it('sorts site blocks by domain', () => {
    const output = generateCaddyfile(
      [makeDomain({ id: 'b', domain: 'zeta.local' }), makeDomain({ id: 'a', domain: 'alpha.local' })],
      options,
    );
    expect(output.indexOf('alpha.local')).toBeLessThan(output.indexOf('zeta.local'));
  });
});
