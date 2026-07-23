/**
 * Pure domain/target validation and normalization helpers.
 * Shared so the renderer can give instant feedback with exactly the same
 * rules the main process enforces. The main process always re-validates.
 */

import { MAX_PORT, MIN_PORT } from './constants';

/** RFC 952/1123 label: alphanumeric, hyphens inside, 1-63 chars. */
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface NormalizedDomain {
  domain: string;
  /** Notes about what normalization changed (protocol stripped, etc.). */
  changes: string[];
}

/**
 * Normalize raw user input into a bare lowercase domain:
 * strips protocol, path, query, port suffix, trailing dot and whitespace.
 */
export function normalizeDomain(input: string): NormalizedDomain {
  const changes: string[] = [];
  let value = input.trim();

  if (value !== input) changes.push('trimmed whitespace');

  const protocolMatch = value.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (protocolMatch) {
    value = value.slice(protocolMatch[0].length);
    changes.push('removed protocol');
  }

  const slashIndex = value.search(/[/?#]/);
  if (slashIndex !== -1) {
    value = value.slice(0, slashIndex);
    changes.push('removed path');
  }

  const portMatch = value.match(/:(\d+)$/);
  if (portMatch) {
    value = value.slice(0, -portMatch[0].length);
    changes.push('removed port');
  }

  if (value.endsWith('.')) {
    value = value.slice(0, -1);
    changes.push('removed trailing dot');
  }

  const lowered = value.toLowerCase();
  if (lowered !== value) changes.push('lowercased');

  return { domain: lowered, changes };
}

export interface DomainValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an already-normalized domain name.
 * Wildcards are rejected (not supported in the MVP).
 */
export function validateDomainName(domain: string): DomainValidation {
  const errors: string[] = [];

  if (domain.length === 0) {
    return { valid: false, errors: ['Domain is required.'] };
  }
  if (domain.length > 253) {
    errors.push('Domain must be at most 253 characters.');
  }
  if (domain.includes('*')) {
    errors.push('Wildcard domains are not supported yet.');
  }
  if (/\s/.test(domain)) {
    errors.push('Domain must not contain whitespace.');
  }
  if (/[^a-z0-9.-]/.test(domain)) {
    errors.push('Domain contains invalid characters. Use letters, digits, hyphens and dots.');
  }

  if (errors.length === 0) {
    const labels = domain.split('.');
    if (labels.length < 2) {
      errors.push('Use a dotted name such as myapp.local.');
    }
    for (const label of labels) {
      if (!LABEL_RE.test(label)) {
        errors.push(`Invalid domain segment: "${label}".`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/** Hostname or IPv4 literal allowed as a proxy target host. */
export function validateTargetHost(host: string): DomainValidation {
  const errors: string[] = [];
  const value = host.trim().toLowerCase();

  if (value.length === 0) {
    return { valid: false, errors: ['Target host is required.'] };
  }

  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octetsValid = ipv4.slice(1).every((o) => Number(o) <= 255);
    if (!octetsValid) errors.push('Invalid IPv4 address.');
    return { valid: errors.length === 0, errors };
  }

  if (/[^a-z0-9.-]/.test(value)) {
    errors.push('Target host contains invalid characters.');
    return { valid: false, errors };
  }
  for (const label of value.split('.')) {
    if (!LABEL_RE.test(label)) {
      errors.push(`Invalid host segment: "${label}".`);
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Parse a target URL like "http://localhost:3000/api" into its parts.
 * Used by the simple add-domain form.
 */
export function parseTargetUrl(input: string): {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  basePath?: string;
  errors: string[];
} {
  const fallback = { protocol: 'http' as const, host: '', port: 0 };
  const raw = input.trim();
  if (raw.length === 0) {
    return { ...fallback, errors: ['Target is required.'] };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { ...fallback, errors: ['Target is not a valid URL.'] };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ...fallback, errors: ['Target protocol must be http or https.'] };
  }

  const protocol = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : protocol === 'https' ? 443 : 80;
  const host = url.hostname;

  const errors: string[] = [];
  const hostCheck = validateTargetHost(host);
  if (!hostCheck.valid) errors.push(...hostCheck.errors);
  if (!isValidPort(port)) errors.push('Target port must be between 1 and 65535.');

  const basePath = url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : undefined;

  return { protocol, host, port, basePath: basePath || undefined, errors };
}

/** Header names must be RFC 7230 tokens; values must not allow CRLF injection. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function validateHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name) && name.length <= 128;
}

export function validateHeaderValue(value: string): boolean {
  return !/[\r\n\0]/.test(value) && value.length <= 4096;
}

/**
 * Detect a target that would loop back into LocalBridge itself:
 * the target host equals a LocalBridge-managed domain, or it points at
 * the loopback address on one of the proxy's own listening ports.
 */
export function isCircularTarget(
  targetHost: string,
  targetPort: number,
  managedDomains: readonly string[],
  proxyPorts: readonly number[],
): boolean {
  const host = targetHost.trim().toLowerCase();
  if (managedDomains.includes(host)) return true;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return isLoopback && proxyPorts.includes(targetPort);
}
