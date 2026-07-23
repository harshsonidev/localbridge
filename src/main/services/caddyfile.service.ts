/**
 * Caddyfile generation. Pure functions: DomainConfig[] + options in,
 * Caddyfile text out. Nothing here touches the filesystem or spawns
 * processes — CaddyService (later phase) owns the process lifecycle.
 */

import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from '../../shared/constants';
import { AppError } from '../../shared/errors';
import type { DomainConfig } from '../../shared/types';

export interface CertificatePaths {
  certFile: string;
  keyFile: string;
}

export interface CaddyfileOptions {
  httpPort: number;
  httpsPort: number;
  /** Absolute path of the Caddy access log file. */
  accessLogPath: string;
  /** Resolve where the certificate for a domain lives (or will live). */
  resolveCertificate(domain: DomainConfig): CertificatePaths;
  /**
   * Localhost-only admin endpoint (e.g. "localhost:2019") used for
   * graceful reloads. Omitted -> "admin off".
   */
  adminEndpoint?: string;
  /** Address the proxy binds to. Defaults to loopback only. */
  bindAddress?: string;
}

/**
 * Quote a value for safe inclusion in a Caddyfile. Rejects control
 * characters outright (defense in depth — input validation already
 * blocks them) and escapes quotes/backslashes.
 */
export function caddyQuote(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'Configuration value contains control characters.', {
      details: `Rejected value: ${JSON.stringify(value)}`,
    });
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Caddy prefers forward slashes even on Windows. */
export function toCaddyPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function siteAddress(protocol: 'http' | 'https', domain: string): string {
  // Ports come from the global http_port / https_port options,
  // so addresses never need an explicit port suffix.
  return `${protocol}://${domain}`;
}

function upstreamAddress(d: DomainConfig): string {
  const host = d.target.host === 'localhost' ? '127.0.0.1' : d.target.host;
  return d.target.protocol === 'https' ? `https://${host}:${d.target.port}` : `${host}:${d.target.port}`;
}

function renderReverseProxy(d: DomainConfig, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}reverse_proxy ${upstreamAddress(d)} {`);

  const inner = `${indent}    `;
  if (d.proxy.preserveHost) {
    lines.push(`${inner}header_up Host {host}`);
  } else if (d.proxy.rewriteHost) {
    lines.push(`${inner}header_up Host ${caddyQuote(d.proxy.rewriteHost)}`);
  } else {
    lines.push(`${inner}header_up Host {upstream_hostport}`);
  }
  lines.push(`${inner}header_up X-Forwarded-Host {host}`);
  lines.push(`${inner}header_up X-Forwarded-Proto {scheme}`);
  lines.push(`${inner}header_up X-Forwarded-Port {server_port}`);

  for (const [name, value] of Object.entries(d.proxy.requestHeaders)) {
    lines.push(`${inner}header_up ${name} ${caddyQuote(value)}`);
  }
  for (const [name, value] of Object.entries(d.proxy.responseHeaders)) {
    lines.push(`${inner}header_down ${name} ${caddyQuote(value)}`);
  }

  const transport: string[] = [];
  if (d.proxy.requestTimeoutMs > 0) {
    transport.push(`${inner}    dial_timeout ${Math.ceil(d.proxy.requestTimeoutMs / 1000)}s`);
  }
  if (d.proxy.responseTimeoutMs > 0) {
    transport.push(
      `${inner}    response_header_timeout ${Math.ceil(d.proxy.responseTimeoutMs / 1000)}s`,
    );
  }
  if (d.target.protocol === 'https' && d.target.allowInvalidCertificate) {
    transport.push(`${inner}    tls_insecure_skip_verify`);
  }
  if (transport.length > 0) {
    lines.push(`${inner}transport http {`, ...transport, `${inner}}`);
  }

  lines.push(`${indent}}`);
  return lines;
}

function renderRewrites(d: DomainConfig, indent: string): string[] {
  const lines: string[] = [];
  if (d.proxy.stripPrefix) {
    lines.push(`${indent}uri strip_prefix ${caddyQuote(d.proxy.stripPrefix)}`);
  }
  const prefix = d.proxy.addPrefix ?? d.target.basePath;
  if (prefix) {
    lines.push(`${indent}rewrite * ${caddyQuote(`${prefix}{uri}`)}`);
  }
  return lines;
}

function renderSiteBlock(d: DomainConfig, options: CaddyfileOptions): string[] {
  const lines: string[] = [];
  const https = d.frontend.protocol === 'https';

  if (https && d.frontend.redirectHttpToHttps) {
    lines.push(`${siteAddress('http', d.domain)} {`);
    const target =
      options.httpsPort === DEFAULT_HTTPS_PORT
        ? `https://${d.domain}{uri}`
        : `https://${d.domain}:${options.httpsPort}{uri}`;
    lines.push(`    redir ${target} permanent`);
    lines.push('}', '');
  }

  lines.push(`${siteAddress(https ? 'https' : 'http', d.domain)} {`);

  if (https) {
    const cert = options.resolveCertificate(d);
    lines.push(
      `    tls ${caddyQuote(toCaddyPath(cert.certFile))} ${caddyQuote(toCaddyPath(cert.keyFile))}`,
    );
    lines.push('');
  }

  const rewrites = renderRewrites(d, '    ');
  if (rewrites.length > 0) {
    lines.push(...rewrites, '');
  }

  lines.push(...renderReverseProxy(d, '    '));

  if (d.inspectionEnabled) {
    lines.push('');
    lines.push('    log {');
    lines.push(`        output file ${caddyQuote(toCaddyPath(options.accessLogPath))}`);
    // Strip credentials at the source so they never reach the log file.
    lines.push('        format filter {');
    lines.push('            wrap json');
    lines.push('            fields {');
    lines.push('                request>headers>Authorization delete');
    lines.push('                request>headers>Proxy-Authorization delete');
    lines.push('                request>headers>Cookie delete');
    lines.push('                resp_headers>Set-Cookie delete');
    lines.push('            }');
    lines.push('        }');
    lines.push('    }');
  }

  lines.push('}');
  return lines;
}

/** Generate the complete Caddyfile for all enabled domains. */
export function generateCaddyfile(
  domains: readonly DomainConfig[],
  options: CaddyfileOptions,
): string {
  const enabled = domains.filter((d) => d.enabled);

  const globalLines = [
    '{',
    options.adminEndpoint ? `    admin ${caddyQuote(options.adminEndpoint)}` : '    admin off',
    '    auto_https off',
    // Loopback-only by default: local domains resolve to 127.0.0.1 and
    // binding wider would expose dev servers to the LAN.
    `    default_bind ${caddyQuote(options.bindAddress ?? '127.0.0.1')}`,
  ];
  if (options.httpPort !== DEFAULT_HTTP_PORT) {
    globalLines.push(`    http_port ${options.httpPort}`);
  }
  if (options.httpsPort !== DEFAULT_HTTPS_PORT) {
    globalLines.push(`    https_port ${options.httpsPort}`);
  }
  globalLines.push('}');

  const sections: string[] = [
    '# Generated by LocalBridge. Do not edit by hand - changes are overwritten.',
    globalLines.join('\n'),
  ];

  for (const domain of [...enabled].sort((a, b) => a.domain.localeCompare(b.domain))) {
    sections.push(renderSiteBlock(domain, options).join('\n'));
  }

  return sections.join('\n\n') + '\n';
}
