/**
 * Wrapper around the bundled mkcert binary. All invocations use execFile
 * with fixed argument arrays - never a shell. Domains passed to mkcert
 * are already validated by the shared domain schema.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import { validateDomainName } from '../../shared/validation';
import type { CaStatus } from '../../shared/types';
import type { CategoryLogger } from './logger.service';

export interface MkcertServiceOptions {
  /** Resolve the mkcert binary path at call time (settings may override). */
  getBinaryPath(): string;
  /** Override the CA root directory (used by tests); default: mkcert's own. */
  caRootOverride?: string;
}

export class MkcertService {
  constructor(
    private readonly options: MkcertServiceOptions,
    private readonly log: CategoryLogger,
  ) {}

  isAvailable(): boolean {
    try {
      return fs.statSync(this.options.getBinaryPath()).isFile();
    } catch {
      return false;
    }
  }

  private exec(args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
    const binary = this.options.getBinaryPath();
    if (!this.isAvailable()) {
      throw new AppError('MKCERT_BINARY_MISSING', 'The mkcert binary is missing.', {
        details: `Expected at: ${binary}`,
        suggestion: 'Run "npm run download-binaries" (development) or reinstall LocalBridge.',
      });
    }
    const env = this.options.caRootOverride
      ? { ...process.env, CAROOT: this.options.caRootOverride }
      : process.env;

    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, windowsHide: true, env },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new AppError('MKCERT_INSTALL_FAILED', 'mkcert failed.', {
                details: `${err.message}\n${stderr}`.trim(),
                retryable: true,
                cause: err,
              }),
            );
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
    });
  }

  async caRoot(): Promise<string> {
    const { stdout } = await this.exec(['-CAROOT'], 15_000);
    return stdout.trim();
  }

  /** CA key material exists (mkcert creates it lazily on first use). */
  async caCreated(): Promise<boolean> {
    try {
      const root = await this.caRoot();
      return fs.existsSync(path.join(root, 'rootCA.pem'));
    } catch {
      return false;
    }
  }

  /** Check whether the mkcert root CA is present in the OS trust store. */
  async caTrusted(): Promise<boolean> {
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "if (Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -like '*mkcert*' }) { 'yes' } else { 'no' }",
          ],
          { timeout: 20_000, windowsHide: true },
          (err, stdout) => resolve(!err && stdout.trim() === 'yes'),
        );
      });
    }
    if (process.platform === 'darwin') {
      // mkcert -install adds the root to the System keychain trust store.
      return new Promise((resolve) => {
        execFile(
          'security',
          ['find-certificate', '-a', '-c', 'mkcert', '/Library/Keychains/System.keychain'],
          { timeout: 20_000 },
          (err, stdout) => resolve(!err && /mkcert/i.test(stdout)),
        );
      });
    }
    // Linux trust stores vary by distro; fall back to "created" as the
    // best available signal rather than reporting a false negative.
    return this.caCreated();
  }

  async status(): Promise<CaStatus> {
    if (!this.isAvailable()) {
      return { mkcertAvailable: false, created: false, trusted: false };
    }
    let caRootDir: string | undefined;
    let created = false;
    try {
      caRootDir = await this.caRoot();
      created = fs.existsSync(path.join(caRootDir, 'rootCA.pem'));
    } catch {
      // Leave as not-created; status stays truthful.
    }
    const trusted = created ? await this.caTrusted() : false;
    return { mkcertAvailable: true, caRootDir, created, trusted };
  }

  /**
   * Create (if needed) and trust the local CA. On Windows this pops the
   * system's "install root certificate?" confirmation dialog once.
   */
  async installAuthority(): Promise<CaStatus> {
    this.log.info('Installing mkcert certificate authority');
    await this.exec(['-install'], 120_000);
    const status = await this.status();
    if (!status.trusted) {
      throw new AppError('CERTIFICATE_NOT_TRUSTED', 'The certificate authority is not trusted.', {
        suggestion:
          'Accept the system security dialog when it appears, then try "Repair trust" again.',
        retryable: true,
      });
    }
    this.log.info('mkcert CA installed and trusted');
    return status;
  }

  /** Generate a certificate covering the given domains. */
  async generate(certFile: string, keyFile: string, domains: string[]): Promise<void> {
    if (domains.length === 0) {
      throw new AppError('CERTIFICATE_GENERATION_FAILED', 'No domains to certify.');
    }
    for (const domain of domains) {
      if (!validateDomainName(domain).valid) {
        throw new AppError('CERTIFICATE_GENERATION_FAILED', `Invalid domain: ${domain}`);
      }
    }
    fs.mkdirSync(path.dirname(certFile), { recursive: true });
    await this.exec(['-cert-file', certFile, '-key-file', keyFile, ...domains], 120_000);
    this.log.info('Certificate generated', { certFile, domains: domains.join(',') });
  }
}
