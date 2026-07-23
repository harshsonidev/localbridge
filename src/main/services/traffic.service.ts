/**
 * Traffic inspection (metadata phase): tails Caddy's JSON access log,
 * parses each entry into a TrafficRecord and keeps a bounded in-memory
 * buffer. Nothing is persisted to disk beyond Caddy's own log file, and
 * sensitive headers are redacted before records ever leave this module.
 */

import fs from 'node:fs';
import type { TrafficRecord } from '../../shared/types';
import type { CategoryLogger } from './logger.service';

const REDACTED_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token)$/i;

const MAX_RECORDS = 5000;

interface CaddyAccessEntry {
  ts?: number;
  msg?: string;
  status?: number;
  size?: number;
  duration?: number;
  bytes_read?: number;
  request?: {
    method?: string;
    host?: string;
    uri?: string;
    proto?: string;
    remote_ip?: string;
    client_ip?: string;
    headers?: Record<string, string[]>;
  };
  resp_headers?: Record<string, string[]>;
}

function redactHeaders(headers: Record<string, string[]> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const [name, values] of Object.entries(headers)) {
    result[name] = REDACTED_HEADER_RE.test(name) ? '[redacted]' : (values ?? []).join(', ');
  }
  return result;
}

/** Parse one JSON access-log line. Returns null for non-request lines. */
export function parseAccessLogLine(line: string, id: number): TrafficRecord | null {
  let entry: CaddyAccessEntry;
  try {
    entry = JSON.parse(line) as CaddyAccessEntry;
  } catch {
    return null;
  }
  if (!entry.request || typeof entry.status !== 'number') return null;

  const uri = entry.request.uri ?? '/';
  const queryIndex = uri.indexOf('?');
  const requestHeaders = redactHeaders(entry.request.headers);

  return {
    id,
    timestamp: new Date((entry.ts ?? 0) * 1000).toISOString(),
    host: entry.request.host ?? '',
    method: entry.request.method ?? 'GET',
    path: queryIndex === -1 ? uri : uri.slice(0, queryIndex),
    query: queryIndex === -1 ? undefined : uri.slice(queryIndex + 1),
    protocol: entry.request.proto ?? '',
    status: entry.status,
    durationMs: Math.round((entry.duration ?? 0) * 1000 * 100) / 100,
    requestSize: entry.bytes_read ?? 0,
    responseSize: entry.size ?? 0,
    clientIp: entry.request.client_ip ?? entry.request.remote_ip ?? '',
    userAgent: requestHeaders['User-Agent'] || undefined,
    referer: requestHeaders['Referer'] || undefined,
    requestHeaders,
    responseHeaders: redactHeaders(entry.resp_headers),
  };
}

export class TrafficService {
  private records: TrafficRecord[] = [];
  private offset = 0;
  private remainder = '';
  private nextId = 1;

  constructor(
    private readonly accessLogPath: string,
    private readonly log: CategoryLogger,
  ) {}

  /** Read any new bytes from the access log and parse them. */
  private refresh(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.accessLogPath);
    } catch {
      this.offset = 0;
      this.remainder = '';
      return;
    }

    if (stat.size < this.offset) {
      // File was truncated or rotated - start over.
      this.offset = 0;
      this.remainder = '';
    }
    if (stat.size === this.offset) return;

    const length = stat.size - this.offset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(this.accessLogPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, this.offset);
    } finally {
      fs.closeSync(fd);
    }
    this.offset = stat.size;

    const text = this.remainder + buffer.toString('utf8');
    const lines = text.split('\n');
    // The final element is either '' (text ended with \n) or a partial line.
    this.remainder = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim() === '') continue;
      const record = parseAccessLogLine(line, this.nextId);
      if (record) {
        this.nextId += 1;
        this.records.push(record);
      }
    }
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
  }

  /** Latest records, newest first. */
  list(limit = 500): TrafficRecord[] {
    this.refresh();
    return this.records.slice(-limit).reverse();
  }

  clear(): void {
    this.records = [];
    this.remainder = '';
    try {
      fs.writeFileSync(this.accessLogPath, '', 'utf8');
      this.offset = 0;
    } catch {
      // Caddy keeps the file open; if truncation fails just skip ahead.
      try {
        this.offset = fs.statSync(this.accessLogPath).size;
      } catch {
        this.offset = 0;
      }
    }
    this.log.info('Traffic records cleared');
  }
}
