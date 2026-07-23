import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLogContent, LogsService } from '../src/main/services/logs.service';
import { parseAccessLogLine, TrafficService } from '../src/main/services/traffic.service';

const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

describe('parseLogContent', () => {
  it('parses scoped entries', () => {
    const entries = parseLogContent(
      '[2026-07-22 15:46:14.729] [info] (hosts) Hosts managed block updated {"domains":1}\n',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      timestamp: '2026-07-22 15:46:14.729',
      level: 'info',
      category: 'hosts',
    });
    expect(entries[0].message).toContain('Hosts managed block updated');
  });

  it('parses legacy entries without a scope', () => {
    const entries = parseLogContent('[2026-07-22 15:23:46.710] [warn]  Something happened\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].category).toBe('app');
  });

  it('attaches continuation lines to the previous entry', () => {
    const entries = parseLogContent(
      [
        '[2026-07-22 15:00:00.000] [error] (caddy) Crash detected',
        '    at somewhere (file.js:1)',
        '[2026-07-22 15:00:01.000] [info] (app) Recovered',
      ].join('\n'),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toContain('at somewhere');
  });

  it('normalizes unknown levels to info', () => {
    const entries = parseLogContent('[2026-07-22 15:00:00.000] [silly] (app) Message\n');
    expect(entries[0].level).toBe('info');
  });
});

describe('LogsService', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-logs-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists, limits and clears entries', () => {
    const file = path.join(dir, 'app.log');
    const lines = Array.from(
      { length: 20 },
      (_, i) => `[2026-07-22 15:00:${String(i).padStart(2, '0')}.000] [info] (app) entry ${i}`,
    );
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const service = new LogsService(file);
    expect(service.list()).toHaveLength(20);
    expect(service.list(5).map((e) => e.message)).toEqual([
      'entry 15',
      'entry 16',
      'entry 17',
      'entry 18',
      'entry 19',
    ]);

    service.clear();
    expect(service.list()).toHaveLength(0);
  });

  it('returns empty for a missing file', () => {
    expect(new LogsService(path.join(dir, 'missing.log')).list()).toEqual([]);
  });
});

const sampleEntry = {
  level: 'info',
  ts: 1784112000.5,
  msg: 'handled request',
  request: {
    remote_ip: '127.0.0.1',
    client_ip: '127.0.0.1',
    proto: 'HTTP/2.0',
    method: 'POST',
    host: 'app.local',
    uri: '/api/login?next=%2Fhome',
    headers: {
      'User-Agent': ['TestAgent/1.0'],
      Authorization: ['Bearer secret-token'],
      Cookie: ['session=abc'],
      'X-Custom': ['keep-me'],
    },
  },
  bytes_read: 128,
  duration: 0.042,
  size: 512,
  status: 201,
  resp_headers: {
    'Content-Type': ['application/json'],
    'Set-Cookie': ['session=def'],
  },
};

describe('parseAccessLogLine', () => {
  it('parses a caddy access-log entry into a traffic record', () => {
    const record = parseAccessLogLine(JSON.stringify(sampleEntry), 1);
    expect(record).toMatchObject({
      id: 1,
      host: 'app.local',
      method: 'POST',
      path: '/api/login',
      query: 'next=%2Fhome',
      protocol: 'HTTP/2.0',
      status: 201,
      requestSize: 128,
      responseSize: 512,
      clientIp: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
    });
    expect(record?.durationMs).toBeCloseTo(42, 0);
  });

  it('redacts sensitive request and response headers', () => {
    const record = parseAccessLogLine(JSON.stringify(sampleEntry), 1);
    expect(record?.requestHeaders['Authorization']).toBe('[redacted]');
    expect(record?.requestHeaders['Cookie']).toBe('[redacted]');
    expect(record?.requestHeaders['X-Custom']).toBe('keep-me');
    expect(record?.responseHeaders['Set-Cookie']).toBe('[redacted]');
    expect(JSON.stringify(record)).not.toContain('secret-token');
    expect(JSON.stringify(record)).not.toContain('session=');
  });

  it('ignores non-request and malformed lines', () => {
    expect(parseAccessLogLine('{"msg":"not a request"}', 1)).toBeNull();
    expect(parseAccessLogLine('not json at all', 1)).toBeNull();
  });
});

describe('TrafficService', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-traffic-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('tails the access log incrementally and handles partial lines', () => {
    const file = path.join(dir, 'access.log');
    const service = new TrafficService(file, noopLog);

    expect(service.list()).toEqual([]);

    const line = JSON.stringify(sampleEntry);
    fs.writeFileSync(file, `${line}\n`);
    expect(service.list()).toHaveLength(1);

    // Append a partial line, then complete it: exactly one new record.
    fs.appendFileSync(file, line.slice(0, 40));
    expect(service.list()).toHaveLength(1);
    fs.appendFileSync(file, `${line.slice(40)}\n`);
    const records = service.list();
    expect(records).toHaveLength(2);
    // Newest first.
    expect(records[0].id).toBeGreaterThan(records[1].id);
  });

  it('recovers when the log file is truncated and regrows', () => {
    const file = path.join(dir, 'access.log');
    const service = new TrafficService(file, noopLog);
    const line = `${JSON.stringify(sampleEntry)}\n`;
    fs.writeFileSync(file, line);
    expect(service.list()).toHaveLength(1);

    // External truncation + regrowth past the previous offset.
    fs.writeFileSync(file, '');
    expect(service.list()).toHaveLength(1);
    fs.appendFileSync(file, line + line);
    expect(service.list().length).toBeGreaterThanOrEqual(2);
  });

  it('clear() empties the buffer and the file', () => {
    const file = path.join(dir, 'access.log');
    const service = new TrafficService(file, noopLog);
    fs.writeFileSync(file, `${JSON.stringify(sampleEntry)}\n`);
    expect(service.list()).toHaveLength(1);

    service.clear();
    expect(service.list()).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe('');
  });
});
