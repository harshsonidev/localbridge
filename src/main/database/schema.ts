/**
 * Versioned migrations. The runner applies every migration with a version
 * greater than the database's current PRAGMA user_version, inside a
 * transaction. Never edit an existing migration — add a new one.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        directory TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE services (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_protocol TEXT NOT NULL DEFAULT 'http',
        target_host TEXT NOT NULL,
        target_port INTEGER NOT NULL,
        target_base_path TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE domains (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        frontend_protocol TEXT NOT NULL DEFAULT 'https',
        redirect_http_to_https INTEGER NOT NULL DEFAULT 1,
        target_protocol TEXT NOT NULL DEFAULT 'http',
        target_host TEXT NOT NULL,
        target_port INTEGER NOT NULL,
        target_base_path TEXT,
        target_allow_invalid_cert INTEGER NOT NULL DEFAULT 0,
        preserve_host INTEGER NOT NULL DEFAULT 1,
        rewrite_host TEXT,
        websockets INTEGER NOT NULL DEFAULT 1,
        http2 INTEGER NOT NULL DEFAULT 1,
        strip_prefix TEXT,
        add_prefix TEXT,
        inspection_enabled INTEGER NOT NULL DEFAULT 0,
        health_check_enabled INTEGER NOT NULL DEFAULT 0,
        health_check_path TEXT NOT NULL DEFAULT '/',
        health_check_interval_s INTEGER NOT NULL DEFAULT 10,
        request_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        response_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_domains_project ON domains(project_id);
      CREATE INDEX idx_domains_enabled ON domains(enabled);

      CREATE TABLE domain_headers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK (direction IN ('request', 'response')),
        header_name TEXT NOT NULL,
        header_value TEXT NOT NULL
      );

      CREATE INDEX idx_domain_headers_domain ON domain_headers(domain_id);

      CREATE TABLE certificates (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        certificate_path TEXT NOT NULL,
        private_key_path TEXT NOT NULL,
        domain_names_json TEXT NOT NULL,
        issued_at TEXT,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE traffic_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id TEXT,
        timestamp TEXT NOT NULL,
        method TEXT,
        path TEXT,
        query TEXT,
        status_code INTEGER,
        duration_ms REAL,
        request_size INTEGER,
        response_size INTEGER,
        client_ip TEXT,
        upstream_address TEXT,
        metadata_json TEXT
      );

      CREATE INDEX idx_traffic_timestamp ON traffic_records(timestamp);

      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT
      );
    `,
  },
  {
    version: 2,
    name: 'remove-projects',
    // The Projects feature was removed. Rebuild domains/certificates
    // without their project/service columns (SQLite table-rebuild
    // pattern) and drop the projects/services tables. domain_headers is
    // preserved through a backup table because dropping the old domains
    // table cascades its rows.
    sql: `
      DROP INDEX IF EXISTS idx_domains_project;

      CREATE TABLE domain_headers_backup AS SELECT * FROM domain_headers;

      CREATE TABLE domains_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        frontend_protocol TEXT NOT NULL DEFAULT 'https',
        redirect_http_to_https INTEGER NOT NULL DEFAULT 1,
        target_protocol TEXT NOT NULL DEFAULT 'http',
        target_host TEXT NOT NULL,
        target_port INTEGER NOT NULL,
        target_base_path TEXT,
        target_allow_invalid_cert INTEGER NOT NULL DEFAULT 0,
        preserve_host INTEGER NOT NULL DEFAULT 1,
        rewrite_host TEXT,
        websockets INTEGER NOT NULL DEFAULT 1,
        http2 INTEGER NOT NULL DEFAULT 1,
        strip_prefix TEXT,
        add_prefix TEXT,
        inspection_enabled INTEGER NOT NULL DEFAULT 0,
        health_check_enabled INTEGER NOT NULL DEFAULT 0,
        health_check_path TEXT NOT NULL DEFAULT '/',
        health_check_interval_s INTEGER NOT NULL DEFAULT 10,
        request_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        response_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO domains_new
        SELECT id, name, domain, enabled, frontend_protocol, redirect_http_to_https,
               target_protocol, target_host, target_port, target_base_path,
               target_allow_invalid_cert, preserve_host, rewrite_host, websockets,
               http2, strip_prefix, add_prefix, inspection_enabled,
               health_check_enabled, health_check_path, health_check_interval_s,
               request_timeout_ms, response_timeout_ms, created_at, updated_at
        FROM domains;

      DROP TABLE domains;
      ALTER TABLE domains_new RENAME TO domains;
      CREATE INDEX idx_domains_enabled ON domains(enabled);

      INSERT INTO domain_headers SELECT * FROM domain_headers_backup;
      DROP TABLE domain_headers_backup;

      CREATE TABLE certificates_new (
        id TEXT PRIMARY KEY,
        certificate_path TEXT NOT NULL,
        private_key_path TEXT NOT NULL,
        domain_names_json TEXT NOT NULL,
        issued_at TEXT,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO certificates_new
        SELECT id, certificate_path, private_key_path, domain_names_json,
               issued_at, expires_at, status, created_at, updated_at
        FROM certificates;

      DROP TABLE certificates;
      ALTER TABLE certificates_new RENAME TO certificates;

      DROP TABLE IF EXISTS services;
      DROP TABLE IF EXISTS projects;

      -- Traffic inspection became the default for new domains; turn it
      -- on for existing ones so the Traffic page works out of the box.
      UPDATE domains SET inspection_enabled = 1;
    `,
  },
];
