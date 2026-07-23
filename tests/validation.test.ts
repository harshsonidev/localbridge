import { describe, expect, it } from 'vitest';
import {
  normalizeDomain,
  validateDomainName,
  validateTargetHost,
  parseTargetUrl,
  isValidPort,
  isCircularTarget,
  validateHeaderName,
  validateHeaderValue,
} from '../src/shared/validation';

describe('normalizeDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeDomain('  App.LOCAL ').domain).toBe('app.local');
  });

  it('strips protocol, path, port and trailing dot', () => {
    expect(normalizeDomain('https://api.local/admin?q=1').domain).toBe('api.local');
    expect(normalizeDomain('app.local:8080').domain).toBe('app.local');
    expect(normalizeDomain('app.local.').domain).toBe('app.local');
  });

  it('reports what it changed', () => {
    const result = normalizeDomain('https://App.local/path');
    expect(result.changes).toContain('removed protocol');
    expect(result.changes).toContain('removed path');
    expect(result.changes).toContain('lowercased');
  });
});

describe('validateDomainName', () => {
  it('accepts typical local domains', () => {
    for (const d of [
      'app.local',
      'api.app.local',
      'app.local',
      'admin.backend.local',
      'superadmin.backend.local',
    ]) {
      expect(validateDomainName(d).valid, d).toBe(true);
    }
  });

  it('rejects invalid input', () => {
    for (const d of [
      '',
      'nodots',
      '*.app.local',
      'has space.local',
      '-bad.local',
      'bad-.local',
      'ünïcode.local',
      'semi;colon.local',
      `${'x'.repeat(64)}.local`,
    ]) {
      expect(validateDomainName(d).valid, JSON.stringify(d)).toBe(false);
    }
  });

  it('rejects injection attempts', () => {
    expect(validateDomainName('foo.local\nmalicious.entry').valid).toBe(false);
    expect(validateDomainName('foo.local 127.0.0.1 evil.com').valid).toBe(false);
  });
});

describe('validateTargetHost', () => {
  it('accepts hostnames and IPv4', () => {
    expect(validateTargetHost('localhost').valid).toBe(true);
    expect(validateTargetHost('127.0.0.1').valid).toBe(true);
    expect(validateTargetHost('my-server.internal').valid).toBe(true);
  });

  it('rejects bad values', () => {
    expect(validateTargetHost('999.1.1.1').valid).toBe(false);
    expect(validateTargetHost('bad host').valid).toBe(false);
    expect(validateTargetHost('').valid).toBe(false);
  });
});

describe('parseTargetUrl', () => {
  it('parses full URLs', () => {
    const r = parseTargetUrl('http://localhost:3000');
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ protocol: 'http', host: 'localhost', port: 3000 });
  });

  it('defaults ports by protocol', () => {
    expect(parseTargetUrl('http://localhost').port).toBe(80);
    expect(parseTargetUrl('https://localhost').port).toBe(443);
  });

  it('assumes http:// when protocol is missing', () => {
    const r = parseTargetUrl('localhost:4000');
    expect(r.errors).toEqual([]);
    expect(r.port).toBe(4000);
    expect(r.protocol).toBe('http');
  });

  it('captures base paths', () => {
    expect(parseTargetUrl('http://localhost:3000/api/').basePath).toBe('/api');
    expect(parseTargetUrl('http://localhost:3000').basePath).toBeUndefined();
  });

  it('rejects non-http protocols and garbage', () => {
    expect(parseTargetUrl('ftp://localhost').errors.length).toBeGreaterThan(0);
    expect(parseTargetUrl('http://exa mple').errors.length).toBeGreaterThan(0);
    expect(parseTargetUrl('').errors.length).toBeGreaterThan(0);
  });
});

describe('isValidPort', () => {
  it('accepts 1..65535 integers only', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(3.14)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
  });
});

describe('isCircularTarget', () => {
  const managed = ['app.local', 'api.local'];

  it('detects a target pointing at a managed domain', () => {
    expect(isCircularTarget('app.local', 3000, managed, [80, 443])).toBe(true);
  });

  it('detects loopback on the proxy ports', () => {
    expect(isCircularTarget('localhost', 443, managed, [80, 443])).toBe(true);
    expect(isCircularTarget('127.0.0.1', 80, managed, [80, 443])).toBe(true);
  });

  it('allows normal dev targets', () => {
    expect(isCircularTarget('localhost', 3000, managed, [80, 443])).toBe(false);
    expect(isCircularTarget('127.0.0.1', 8443, managed, [80, 443])).toBe(false);
  });
});

describe('header validation', () => {
  it('accepts normal headers', () => {
    expect(validateHeaderName('X-Custom-Header')).toBe(true);
    expect(validateHeaderValue('some value')).toBe(true);
  });

  it('blocks CRLF injection', () => {
    expect(validateHeaderName('X-Bad\r\nHeader')).toBe(false);
    expect(validateHeaderValue('value\r\nSet-Cookie: pwned')).toBe(false);
  });
});
