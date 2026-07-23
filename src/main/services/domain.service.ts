import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import {
  frontendConfigSchema,
  healthCheckConfigSchema,
  proxyConfigSchema,
} from '../../shared/schemas';
import { isCircularTarget } from '../../shared/validation';
import type {
  AppPaths,
  ConfigPreview,
  DomainConfig,
  DomainCreateInput,
  DomainCreateResult,
  DomainUpdateInput,
} from '../../shared/types';
import type { DomainRepository } from '../repositories/domain.repository';
import { generateCaddyfile } from './caddyfile.service';
import { renderManagedBlock, findUnmanagedEntries, type HostsService } from './hosts.service';
import { checkTcpReachable, isPortAvailable } from './port.service';
import type { CertificateService } from './certificate.service';
import type { SettingsService } from './settings.service';
import type { CategoryLogger } from './logger.service';

export const CADDY_ADMIN_ENDPOINT = 'localhost:2019';

export interface DomainServiceDeps {
  repo: DomainRepository;
  hosts: HostsService;
  settings: SettingsService;
  certificates: CertificateService;
  paths: AppPaths;
  log: CategoryLogger;
  /** True when the embedded proxy currently owns the HTTP/HTTPS ports. */
  isProxyRunning?: () => boolean;
  /** Override the Caddy admin endpoint (tests use a non-default port). */
  adminEndpoint?: string;
}

export class DomainService {
  /** Called after configuration files change (wired to the Caddy manager). */
  private onConfigApplied: (() => Promise<void>) | null = null;

  constructor(private readonly deps: DomainServiceDeps) {}

  setOnConfigApplied(callback: () => Promise<void>): void {
    this.onConfigApplied = callback;
  }

  list(): DomainConfig[] {
    return this.deps.repo.list();
  }

  get(id: string): DomainConfig {
    const domain = this.deps.repo.getById(id);
    if (!domain) {
      throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found.', {
        details: `No domain with id ${id}`,
      });
    }
    return domain;
  }

  async create(input: DomainCreateInput): Promise<DomainCreateResult> {
    const operationId = crypto.randomUUID().slice(0, 8);
    const log = this.deps.log;

    if (this.deps.repo.getByDomain(input.domain)) {
      throw new AppError('DOMAIN_DUPLICATE', `"${input.domain}" already exists.`, {
        suggestion: 'Edit the existing domain or choose a different name.',
      });
    }

    this.assertNotCircular(input.domain, input.target.host, input.target.port);

    const now = new Date().toISOString();
    const domain: DomainConfig = {
      id: crypto.randomUUID(),
      name: input.name?.trim() || input.domain,
      domain: input.domain,
      enabled: input.enabled ?? true,
      frontend: frontendConfigSchema.parse(input.frontend ?? {}),
      target: {
        protocol: input.target.protocol ?? 'http',
        host: input.target.host,
        port: input.target.port,
        basePath: input.target.basePath,
        allowInvalidCertificate: input.target.allowInvalidCertificate,
      },
      proxy: proxyConfigSchema.parse(input.proxy ?? {}),
      healthCheck: healthCheckConfigSchema.parse(input.healthCheck ?? {}),
      inspectionEnabled: input.inspectionEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    log.info('Creating domain', {
      operationId,
      domain: domain.domain,
      target: `${domain.target.host}:${domain.target.port}`,
    });

    const warnings = await this.collectWarnings(domain);

    this.deps.repo.insert(domain);
    try {
      const preview = await this.applyConfigs();
      log.info('Domain created', { operationId, domain: domain.domain });
      return { domain, warnings: [...warnings, ...preview.warnings], preview };
    } catch (err) {
      try {
        this.deps.repo.remove(domain.id);
      } catch (rollbackErr) {
        log.error('Rollback after failed create also failed', {
          operationId,
          error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        });
      }
      log.error('Domain creation failed; rolled back', { operationId, domain: domain.domain });
      throw err;
    }
  }

  async update(id: string, input: DomainUpdateInput): Promise<DomainCreateResult> {
    const existing = this.get(id);
    const operationId = crypto.randomUUID().slice(0, 8);

    if (input.domain && input.domain !== existing.domain) {
      const duplicate = this.deps.repo.getByDomain(input.domain);
      if (duplicate && duplicate.id !== id) {
        throw new AppError('DOMAIN_DUPLICATE', `"${input.domain}" already exists.`);
      }
    }

    const merged: DomainConfig = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() || existing.name : existing.name,
      domain: input.domain ?? existing.domain,
      enabled: input.enabled ?? existing.enabled,
      frontend: frontendConfigSchema.parse({ ...existing.frontend, ...input.frontend }),
      target: input.target
        ? {
            protocol: input.target.protocol ?? existing.target.protocol,
            host: input.target.host ?? existing.target.host,
            port: input.target.port ?? existing.target.port,
            basePath: input.target.basePath,
            allowInvalidCertificate: input.target.allowInvalidCertificate,
          }
        : existing.target,
      proxy: proxyConfigSchema.parse({ ...existing.proxy, ...input.proxy }),
      healthCheck: healthCheckConfigSchema.parse({ ...existing.healthCheck, ...input.healthCheck }),
      inspectionEnabled: input.inspectionEnabled ?? existing.inspectionEnabled,
      updatedAt: new Date().toISOString(),
    };

    this.assertNotCircular(merged.domain, merged.target.host, merged.target.port);

    const warnings = await this.collectWarnings(merged);

    this.deps.repo.update(merged);
    try {
      const preview = await this.applyConfigs();
      this.deps.log.info('Domain updated', { operationId, domain: merged.domain });
      return { domain: merged, warnings: [...warnings, ...preview.warnings], preview };
    } catch (err) {
      try {
        this.deps.repo.update(existing);
      } catch {
        this.deps.log.error('Rollback after failed update also failed', { operationId });
      }
      throw err;
    }
  }

  async remove(id: string): Promise<{ preview: ConfigPreview }> {
    const existing = this.get(id);
    this.deps.repo.remove(id);
    try {
      const preview = await this.applyConfigs();
      this.deps.log.info('Domain removed', { domain: existing.domain });
      return { preview };
    } catch (err) {
      try {
        this.deps.repo.insert(existing);
      } catch {
        this.deps.log.error('Rollback after failed remove also failed', { domain: existing.domain });
      }
      throw err;
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<DomainCreateResult> {
    return this.update(id, { enabled });
  }

  /** URL a browser should use for this domain. */
  publicUrl(id: string): string {
    const domain = this.get(id);
    const settings = this.deps.settings.get();
    if (domain.frontend.protocol === 'https') {
      return settings.httpsPort === 443
        ? `https://${domain.domain}`
        : `https://${domain.domain}:${settings.httpsPort}`;
    }
    return settings.httpPort === 80
      ? `http://${domain.domain}`
      : `http://${domain.domain}:${settings.httpPort}`;
  }

  /**
   * Bring all managed state in line with the database: certificates,
   * hosts managed block, Caddyfile, and the running proxy.
   */
  async applyConfigs(): Promise<ConfigPreview> {
    const all = this.deps.repo.list();
    const enabledDomains = all.filter((d) => d.enabled).map((d) => d.domain);

    // 1. Certificates first - the Caddyfile references their file paths.
    try {
      await this.deps.certificates.ensure(all);
    } catch (err) {
      this.deps.log.warn('Certificate generation failed; https sites may be skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Hosts managed block (elevated write in real mode when needed).
    const { content } = await this.deps.hosts.apply(enabledDomains);

    // 3. Caddyfile.
    const { caddyfile, warnings } = this.renderCaddyfile(all);
    this.backupCaddyfile();
    fs.mkdirSync(path.dirname(this.deps.paths.caddyfile), { recursive: true });
    fs.writeFileSync(this.deps.paths.caddyfile, caddyfile, 'utf8');

    // 4. Proxy reload/start. A proxy problem must not roll back the
    // domain change - surface it as a warning instead.
    if (this.onConfigApplied) {
      try {
        await this.onConfigApplied();
      } catch (err) {
        warnings.push(
          `Proxy update failed: ${err instanceof AppError ? err.message : err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      hostsBlock: enabledDomains.length > 0 ? renderManagedBlock(enabledDomains) : '',
      hostsFile: content,
      caddyfile,
      hostsFilePath: this.deps.hosts.hostsPath,
      caddyfilePath: this.deps.paths.caddyfile,
      warnings,
    };
  }

  /** Read-only preview of the currently generated configuration. */
  preview(): ConfigPreview {
    const all = this.deps.repo.list();
    const enabledDomains = all.filter((d) => d.enabled).map((d) => d.domain);
    const { caddyfile, warnings } = this.renderCaddyfile(all);
    return {
      hostsBlock: enabledDomains.length > 0 ? renderManagedBlock(enabledDomains) : '',
      hostsFile: this.deps.hosts.read(),
      caddyfile,
      hostsFilePath: this.deps.hosts.hostsPath,
      caddyfilePath: this.deps.paths.caddyfile,
      warnings,
    };
  }

  /** Keep the previous Caddyfile around before overwriting it. */
  private backupCaddyfile(keep = 10): void {
    const caddyfile = this.deps.paths.caddyfile;
    if (!fs.existsSync(caddyfile)) return;
    const backupDir = path.join(this.deps.paths.caddyDir, 'config-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(caddyfile, path.join(backupDir, `Caddyfile-${stamp}`));
    try {
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith('Caddyfile-'))
        .sort();
      for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    } catch {
      // Pruning is best-effort.
    }
  }

  /**
   * Render the Caddyfile. HTTPS domains whose certificate is not usable
   * yet are excluded (Caddy refuses to load missing cert files) and
   * reported as warnings.
   */
  private renderCaddyfile(all: DomainConfig[]): { caddyfile: string; warnings: string[] } {
    const settings = this.deps.settings.get();
    const warnings: string[] = [];

    const groups = this.deps.certificates.groups(all);
    const groupByDomain = new Map<string, (typeof groups)[number]>();
    for (const group of groups) {
      for (const d of group.domains) groupByDomain.set(d, group);
    }

    const servable = all.filter((d) => {
      if (!d.enabled) return true; // generateCaddyfile filters disabled itself
      if (d.frontend.protocol !== 'https') return true;
      const group = groupByDomain.get(d.domain);
      if (group && this.deps.certificates.isUsable(group)) return true;
      warnings.push(
        `${d.domain}: certificate not available yet, site excluded from the proxy. Install the certificate authority on the Certificates page, then save any domain to retry.`,
      );
      return false;
    });

    const caddyfile = generateCaddyfile(servable, {
      httpPort: settings.httpPort,
      httpsPort: settings.httpsPort,
      accessLogPath: this.deps.paths.accessLogFile,
      adminEndpoint: this.deps.adminEndpoint ?? CADDY_ADMIN_ENDPOINT,
      resolveCertificate: (d) => {
        const group = groupByDomain.get(d.domain);
        if (!group) {
          throw new AppError('CERTIFICATE_GENERATION_FAILED', `No certificate group for ${d.domain}`);
        }
        return { certFile: group.certFile, keyFile: group.keyFile };
      },
    });

    return { caddyfile, warnings };
  }

  private assertNotCircular(domain: string, targetHost: string, targetPort: number): void {
    const settings = this.deps.settings.get();
    const managed = this.deps.repo
      .list()
      .map((d) => d.domain)
      .concat(domain);
    if (isCircularTarget(targetHost, targetPort, managed, [settings.httpPort, settings.httpsPort])) {
      throw new AppError('TARGET_CIRCULAR', 'The target would loop back into LocalBridge.', {
        details: `Target ${targetHost}:${targetPort} points at a LocalBridge domain or the proxy's own port.`,
        suggestion: 'Point the target at the actual development server port (e.g. 3000).',
      });
    }
  }

  private async collectWarnings(domain: DomainConfig): Promise<string[]> {
    const warnings: string[] = [];
    const settings = this.deps.settings.get();

    const target = await checkTcpReachable(domain.target.host, domain.target.port);
    if (!target.reachable) {
      warnings.push(
        `Target ${domain.target.host}:${domain.target.port} is not reachable right now (${target.error ?? 'offline'}). The domain was saved anyway.`,
      );
    }

    // Skip the port check while our own proxy holds the ports.
    if (!this.deps.isProxyRunning?.()) {
      for (const port of [settings.httpPort, settings.httpsPort]) {
        const available = await isPortAvailable(port);
        if (!available) {
          warnings.push(`Port ${port} is currently occupied. The proxy will need it when it starts.`);
        }
      }
    }

    try {
      const conflicts = findUnmanagedEntries(this.deps.hosts.read(), [domain.domain]);
      if (conflicts.length > 0) {
        warnings.push(
          `"${domain.domain}" already has a hosts-file entry outside the LocalBridge managed block.`,
        );
      }
    } catch {
      // Hosts file unreadable - the apply step will surface a real error.
    }

    return warnings;
  }
}
