/**
 * Certificate lifecycle: one certificate per HTTPS domain, inspected with
 * node:crypto and regenerated through mkcert only when a certificate is
 * missing, expiring or no longer covers its domain.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CertificateInfo, CertificateState, DomainConfig } from '../../shared/types';
import type { MkcertService } from './mkcert.service';
import type { CategoryLogger } from './logger.service';

export interface CertificateGroup {
  name: string;
  certFile: string;
  keyFile: string;
  domains: string[];
}

/** Pure: one certificate bundle per enabled HTTPS domain. */
export function groupDomainsForCertificates(
  domains: readonly DomainConfig[],
  certificatesDir: string,
): CertificateGroup[] {
  return domains
    .filter((d) => d.enabled && d.frontend.protocol === 'https')
    .map((d) => ({
      name: d.domain,
      certFile: path.join(certificatesDir, `${d.domain}.pem`),
      keyFile: path.join(certificatesDir, `${d.domain}-key.pem`),
      domains: [d.domain],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ParsedCertificate {
  sans: string[];
  issuedAt?: string;
  expiresAt?: string;
}

/** Parse SANs and validity window from a PEM file. Null if unreadable. */
export function parseCertificate(certFile: string): ParsedCertificate | null {
  try {
    const pem = fs.readFileSync(certFile);
    const cert = new crypto.X509Certificate(pem);
    const sans = (cert.subjectAltName ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('DNS:'))
      .map((s) => s.slice(4).toLowerCase());
    return {
      sans,
      issuedAt: new Date(cert.validFrom).toISOString(),
      expiresAt: new Date(cert.validTo).toISOString(),
    };
  } catch {
    return null;
  }
}

export function certificateState(
  group: CertificateGroup,
  parsed: ParsedCertificate | null,
  keyExists: boolean,
  now = new Date(),
): CertificateState {
  if (!parsed || !keyExists) return 'missing';
  if (!group.domains.every((d) => parsed.sans.includes(d))) return 'domain-mismatch';
  if (parsed.expiresAt) {
    const expires = new Date(parsed.expiresAt).getTime();
    if (expires <= now.getTime()) return 'expired';
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (expires - now.getTime() <= thirtyDays) return 'expiring-soon';
  }
  return 'valid';
}

export interface CertificateServiceDeps {
  mkcert: MkcertService;
  certificatesDir: string;
  log: CategoryLogger;
}

export class CertificateService {
  constructor(private readonly deps: CertificateServiceDeps) {}

  groups(domains: readonly DomainConfig[]): CertificateGroup[] {
    return groupDomainsForCertificates(domains, this.deps.certificatesDir);
  }

  inspect(group: CertificateGroup): CertificateInfo {
    const parsed = parseCertificate(group.certFile);
    const keyExists = fs.existsSync(group.keyFile);
    return {
      name: group.name,
      certFile: group.certFile,
      keyFile: group.keyFile,
      domains: group.domains,
      coveredDomains: parsed?.sans ?? [],
      issuedAt: parsed?.issuedAt,
      expiresAt: parsed?.expiresAt,
      status: certificateState(group, parsed, keyExists),
    };
  }

  list(domains: readonly DomainConfig[]): CertificateInfo[] {
    return this.groups(domains).map((g) => this.inspect(g));
  }

  /** A certificate usable for serving exists for this group right now. */
  isUsable(group: CertificateGroup): boolean {
    const status = this.inspect(group).status;
    return status === 'valid' || status === 'expiring-soon';
  }

  /**
   * Generate every certificate that is missing/stale. Never regenerates
   * certificates that are still valid unless `force` is set.
   */
  async ensure(domains: readonly DomainConfig[], force = false): Promise<CertificateInfo[]> {
    const results: CertificateInfo[] = [];
    if (!this.deps.mkcert.isAvailable()) {
      // No mkcert: report current state without generating.
      return this.list(domains);
    }
    for (const group of this.groups(domains)) {
      const before = this.inspect(group);
      const needsWork = force || (before.status !== 'valid' && before.status !== 'expiring-soon');
      if (needsWork) {
        await this.deps.mkcert.generate(group.certFile, group.keyFile, group.domains);
        this.pruneOrphans(domains);
        results.push(this.inspect(group));
      } else {
        results.push(before);
      }
    }
    return results;
  }

  /** Remove certificate files that no longer belong to any group. */
  private pruneOrphans(domains: readonly DomainConfig[]): void {
    try {
      const keep = new Set(
        this.groups(domains).flatMap((g) => [path.basename(g.certFile), path.basename(g.keyFile)]),
      );
      for (const file of fs.readdirSync(this.deps.certificatesDir)) {
        if (file.endsWith('.pem') && !keep.has(file)) {
          fs.unlinkSync(path.join(this.deps.certificatesDir, file));
          this.deps.log.info('Removed orphaned certificate file', { file });
        }
      }
    } catch {
      // Pruning is best-effort.
    }
  }
}
