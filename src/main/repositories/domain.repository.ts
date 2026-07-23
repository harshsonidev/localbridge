import type { DomainConfig } from '../../shared/types';
import type { SqlDatabase, SqlValue } from '../database/database';
import type { JsonStore } from './json-store';

/**
 * Storage abstraction for domains. Both engines are synchronous; the
 * service layer treats the repository as a black box, so the engine can
 * be replaced without touching business logic.
 */
export interface DomainRepository {
  list(): DomainConfig[];
  getById(id: string): DomainConfig | null;
  getByDomain(domain: string): DomainConfig | null;
  insert(domain: DomainConfig): void;
  update(domain: DomainConfig): void;
  remove(id: string): void;
}

/* ------------------------------- SQLite ------------------------------- */

const bool = (v: boolean): number => (v ? 1 : 0);
const asBool = (v: unknown): boolean => Number(v) === 1;
const optText = (v: string | undefined): SqlValue => v ?? null;

function rowToDomain(
  row: Record<string, unknown>,
  headers: { direction: string; header_name: string; header_value: string }[],
): DomainConfig {
  const requestHeaders: Record<string, string> = {};
  const responseHeaders: Record<string, string> = {};
  for (const h of headers) {
    if (h.direction === 'request') requestHeaders[h.header_name] = h.header_value;
    else responseHeaders[h.header_name] = h.header_value;
  }

  return {
    id: String(row.id),
    name: String(row.name),
    domain: String(row.domain),
    enabled: asBool(row.enabled),
    frontend: {
      protocol: row.frontend_protocol === 'http' ? 'http' : 'https',
      redirectHttpToHttps: asBool(row.redirect_http_to_https),
    },
    target: {
      protocol: row.target_protocol === 'https' ? 'https' : 'http',
      host: String(row.target_host),
      port: Number(row.target_port),
      basePath: row.target_base_path ? String(row.target_base_path) : undefined,
      allowInvalidCertificate: asBool(row.target_allow_invalid_cert) || undefined,
    },
    proxy: {
      preserveHost: asBool(row.preserve_host),
      rewriteHost: row.rewrite_host ? String(row.rewrite_host) : undefined,
      websockets: asBool(row.websockets),
      http2: asBool(row.http2),
      stripPrefix: row.strip_prefix ? String(row.strip_prefix) : undefined,
      addPrefix: row.add_prefix ? String(row.add_prefix) : undefined,
      requestHeaders,
      responseHeaders,
      requestTimeoutMs: Number(row.request_timeout_ms),
      responseTimeoutMs: Number(row.response_timeout_ms),
    },
    healthCheck: {
      enabled: asBool(row.health_check_enabled),
      path: String(row.health_check_path),
      intervalSeconds: Number(row.health_check_interval_s),
    },
    inspectionEnabled: asBool(row.inspection_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteDomainRepository implements DomainRepository {
  constructor(private readonly db: SqlDatabase) {}

  private loadHeaders(domainId: string) {
    return this.db
      .prepare(
        'SELECT direction, header_name, header_value FROM domain_headers WHERE domain_id = ?',
      )
      .all(domainId) as { direction: string; header_name: string; header_value: string }[];
  }

  list(): DomainConfig[] {
    const rows = this.db.prepare('SELECT * FROM domains ORDER BY domain ASC').all();
    return rows.map((row) => rowToDomain(row, this.loadHeaders(String(row.id))));
  }

  getById(id: string): DomainConfig | null {
    const row = this.db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
    return row ? rowToDomain(row, this.loadHeaders(id)) : null;
  }

  getByDomain(domain: string): DomainConfig | null {
    const row = this.db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
    return row ? rowToDomain(row, this.loadHeaders(String(row.id))) : null;
  }

  insert(d: DomainConfig): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO domains (
            id, name, domain, enabled,
            frontend_protocol, redirect_http_to_https,
            target_protocol, target_host, target_port, target_base_path, target_allow_invalid_cert,
            preserve_host, rewrite_host, websockets, http2, strip_prefix, add_prefix,
            inspection_enabled, health_check_enabled, health_check_path, health_check_interval_s,
            request_timeout_ms, response_timeout_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...this.toParams(d));
      this.writeHeaders(d);
    });
  }

  update(d: DomainConfig): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE domains SET
            name = ?, domain = ?, enabled = ?,
            frontend_protocol = ?, redirect_http_to_https = ?,
            target_protocol = ?, target_host = ?, target_port = ?, target_base_path = ?, target_allow_invalid_cert = ?,
            preserve_host = ?, rewrite_host = ?, websockets = ?, http2 = ?, strip_prefix = ?, add_prefix = ?,
            inspection_enabled = ?, health_check_enabled = ?, health_check_path = ?, health_check_interval_s = ?,
            request_timeout_ms = ?, response_timeout_ms = ?, created_at = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(...this.toParams(d).slice(1), d.id);
      this.db.prepare('DELETE FROM domain_headers WHERE domain_id = ?').run(d.id);
      this.writeHeaders(d);
    });
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM domains WHERE id = ?').run(id);
  }

  private toParams(d: DomainConfig): SqlValue[] {
    return [
      d.id,
      d.name,
      d.domain,
      bool(d.enabled),
      d.frontend.protocol,
      bool(d.frontend.redirectHttpToHttps),
      d.target.protocol,
      d.target.host,
      d.target.port,
      optText(d.target.basePath),
      bool(d.target.allowInvalidCertificate ?? false),
      bool(d.proxy.preserveHost),
      optText(d.proxy.rewriteHost),
      bool(d.proxy.websockets),
      bool(d.proxy.http2),
      optText(d.proxy.stripPrefix),
      optText(d.proxy.addPrefix),
      bool(d.inspectionEnabled),
      bool(d.healthCheck.enabled),
      d.healthCheck.path,
      d.healthCheck.intervalSeconds,
      d.proxy.requestTimeoutMs,
      d.proxy.responseTimeoutMs,
      d.createdAt,
      d.updatedAt,
    ];
  }

  private writeHeaders(d: DomainConfig): void {
    const stmt = this.db.prepare(
      'INSERT INTO domain_headers (domain_id, direction, header_name, header_value) VALUES (?, ?, ?, ?)',
    );
    for (const [name, value] of Object.entries(d.proxy.requestHeaders)) {
      stmt.run(d.id, 'request', name, value);
    }
    for (const [name, value] of Object.entries(d.proxy.responseHeaders)) {
      stmt.run(d.id, 'response', name, value);
    }
  }
}

/* -------------------------------- JSON -------------------------------- */

export class JsonDomainRepository implements DomainRepository {
  constructor(private readonly store: JsonStore) {}

  list(): DomainConfig[] {
    return [...this.store.get().domains].sort((a, b) => a.domain.localeCompare(b.domain));
  }

  getById(id: string): DomainConfig | null {
    return this.store.get().domains.find((d) => d.id === id) ?? null;
  }

  getByDomain(domain: string): DomainConfig | null {
    return this.store.get().domains.find((d) => d.domain === domain) ?? null;
  }

  insert(domain: DomainConfig): void {
    this.store.write((data) => {
      if (data.domains.some((d) => d.domain === domain.domain)) {
        throw new Error(`UNIQUE constraint failed: domains.domain (${domain.domain})`);
      }
      data.domains.push(structuredClone(domain));
    });
  }

  update(domain: DomainConfig): void {
    this.store.write((data) => {
      const index = data.domains.findIndex((d) => d.id === domain.id);
      if (index === -1) throw new Error(`Domain not found: ${domain.id}`);
      data.domains[index] = structuredClone(domain);
    });
  }

  remove(id: string): void {
    this.store.write((data) => {
      data.domains = data.domains.filter((d) => d.id !== id);
    });
  }
}
