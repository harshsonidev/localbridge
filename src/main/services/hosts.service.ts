/**
 * Hosts-file managed-block generation and safe application.
 *
 * All parsing/rendering is done by pure functions (unit-testable without
 * touching the filesystem). HostsService applies the block to whichever
 * file it is configured with — in milestone 1 that is always the mock
 * hosts file inside the app data directory, never the system file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOOPBACK_IPV4, MANAGED_BLOCK_BEGIN, MANAGED_BLOCK_END } from '../../shared/constants';
import { AppError } from '../../shared/errors';
import type { CategoryLogger } from './logger.service';

/** Render the managed block for a set of domains: sorted, deduplicated. */
export function renderManagedBlock(domains: readonly string[]): string {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))].sort();
  const lines = [MANAGED_BLOCK_BEGIN, ...unique.map((d) => `${LOOPBACK_IPV4} ${d}`), MANAGED_BLOCK_END];
  return lines.join('\n');
}

/** Extract the domains currently listed inside the managed block. */
export function parseManagedBlock(content: string): string[] {
  const block = extractManagedBlock(content);
  if (block === null) return [];
  const domains: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === MANAGED_BLOCK_BEGIN || trimmed === MANAGED_BLOCK_END || trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) domains.push(parts[1].toLowerCase());
  }
  return domains;
}

function extractManagedBlock(content: string): string | null {
  const beginIndex = content.indexOf(MANAGED_BLOCK_BEGIN);
  if (beginIndex === -1) return null;
  const endIndex = content.indexOf(MANAGED_BLOCK_END, beginIndex);
  if (endIndex === -1) {
    throw new AppError('HOSTS_CONFLICT', 'The hosts file contains a broken LocalBridge block.', {
      details: 'Found the BEGIN marker but no END marker.',
      suggestion: 'Open the hosts file and remove the LocalBridge markers, then try again.',
    });
  }
  return content.slice(beginIndex, endIndex + MANAGED_BLOCK_END.length);
}

/**
 * Insert or replace the managed block in an existing hosts file,
 * preserving all other content and the file's line-ending style.
 * Passing an empty domain list removes the block entirely.
 */
export function applyManagedBlock(content: string, domains: readonly string[]): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const block = domains.length > 0 ? renderManagedBlock(domains).replace(/\n/g, eol) : null;

  const beginIndex = content.indexOf(MANAGED_BLOCK_BEGIN);
  if (beginIndex !== -1) {
    const existing = extractManagedBlock(content);
    if (existing !== null) {
      const after = content.slice(beginIndex + existing.length);
      if (block === null) {
        // Remove the block plus the newline that followed it.
        return content.slice(0, beginIndex) + after.replace(/^\r?\n/, '');
      }
      return content.slice(0, beginIndex) + block + after;
    }
  }

  if (block === null) return content;
  if (content.length === 0) return block + eol;

  const separator = content.endsWith(eol) ? '' : eol;
  return content + separator + block + eol;
}

/**
 * Domains that already resolve via hosts entries OUTSIDE the managed block.
 * Used to warn the user about conflicts with manual entries.
 */
export function findUnmanagedEntries(content: string, domains: readonly string[]): string[] {
  const wanted = new Set(domains.map((d) => d.toLowerCase()));
  const managed = new Set(parseManagedBlock(content).map((d) => d.toLowerCase()));

  const beginIndex = content.indexOf(MANAGED_BLOCK_BEGIN);
  const endIndex = content.indexOf(MANAGED_BLOCK_END);
  const conflicts = new Set<string>();

  const lines = content.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const insideBlock =
      beginIndex !== -1 && endIndex !== -1 && lineStart >= beginIndex && lineStart <= endIndex;
    if (insideBlock) continue;

    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    for (const hostname of parts.slice(1)) {
      const lower = hostname.toLowerCase();
      if (wanted.has(lower) && !managed.has(lower)) conflicts.add(lower);
    }
  }
  return [...conflicts].sort();
}

export interface ElevatedWriter {
  /**
   * Grant the current user permission to write the file, using a single
   * elevation prompt. Called only when the file is not already writable,
   * so after the first grant no further prompts occur for its lifetime.
   */
  grantFileWritable(filePath: string): Promise<void>;
  /** Fallback: replace the file's contents with elevation (prompts). */
  elevatedReplaceFile(sourceFile: string, destFile: string): Promise<void>;
  flushDns(): Promise<void>;
}

export interface HostsServiceOptions {
  /** The system hosts file (injectable for tests). */
  hostsPath: string;
  backupDir: string;
  /** Directory for the staged "pending hosts" file used by elevated writes. */
  stagingDir: string;
  shouldFlushDns(): boolean;
}

export class HostsService {
  constructor(
    private readonly options: HostsServiceOptions,
    private readonly privilege: ElevatedWriter,
    private readonly log: CategoryLogger,
  ) {}

  get hostsPath(): string {
    return this.options.hostsPath;
  }

  read(): string {
    try {
      return fs.readFileSync(this.hostsPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return '';
      if (code === 'EACCES' || code === 'EPERM') {
        throw new AppError('HOSTS_PERMISSION_DENIED', 'Cannot read the hosts file.', {
          details: `Access denied reading ${this.hostsPath}`,
          suggestion: 'LocalBridge needs elevated permissions to manage the hosts file.',
          retryable: true,
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * True when the current process can write the file without elevation.
   * Opens for read-write without truncating - a reliable probe on both
   * Windows and POSIX (unlike fs.access, which is unreliable on Windows).
   */
  private isWritable(target: string): boolean {
    try {
      const fd = fs.openSync(target, 'r+');
      fs.closeSync(fd);
      return true;
    } catch (err) {
      // A file that does not exist yet is "writable" if we can create it
      // in its directory - no permission grant is needed for that.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          fs.accessSync(path.dirname(target), fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  /**
   * Apply the managed block for the given domains. No-ops when the file
   * already matches (so no needless prompts).
   *
   * To avoid prompting on every change, LocalBridge asks for elevation
   * only once: the first time the hosts file is not writable it grants the
   * current user write permission, and every later write goes through
   * directly with no prompt. The file is backed up first and the backup is
   * restored if a direct write fails halfway.
   */
  async apply(domains: readonly string[]): Promise<{ content: string; changed: boolean }> {
    const target = this.hostsPath;
    const before = this.read();
    const after = applyManagedBlock(before, domains);

    if (after === before) {
      return { content: after, changed: false };
    }

    const backupPath = before.length > 0 ? this.backup(before) : null;

    // One-time elevation: make the file writable, then never prompt again.
    if (!this.isWritable(target)) {
      this.log.info('Hosts file is not writable; requesting one-time permission grant', {
        file: target,
      });
      try {
        await this.privilege.grantFileWritable(target);
      } catch (err) {
        // If the user declined, honor that. Any other failure falls through
        // to the elevated-copy fallback in the write step below.
        if (err instanceof AppError && err.code === 'PRIVILEGE_REQUIRED') {
          this.restoreBackup(backupPath, target);
          throw err;
        }
        this.log.warn('Permission grant failed; will attempt an elevated write', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, after, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
        // Rare fallback: the grant did not take effect (e.g. locked-down
        // machine). Stage the content and do an elevated copy this time.
        await this.elevatedWrite(target, after);
      } else {
        this.restoreBackup(backupPath, target);
        throw new AppError('HOSTS_WRITE_FAILED', 'Failed to update the hosts file.', {
          details: err instanceof Error ? err.message : String(err),
          retryable: true,
          cause: err,
        });
      }
    }

    const written = fs.readFileSync(target, 'utf8');
    if (written !== after) {
      throw new AppError('HOSTS_WRITE_FAILED', 'The hosts file content could not be verified.', {
        details: 'Content read back after writing did not match the expected result.',
        retryable: true,
      });
    }

    this.log.info('Hosts managed block updated', { file: target, domains: domains.length });

    if (this.options.shouldFlushDns()) {
      await this.privilege.flushDns();
    }

    return { content: after, changed: true };
  }

  private async elevatedWrite(target: string, content: string): Promise<void> {
    fs.mkdirSync(this.options.stagingDir, { recursive: true });
    const staged = path.join(this.options.stagingDir, 'pending-hosts.txt');
    fs.writeFileSync(staged, content, 'utf8');
    try {
      await this.privilege.elevatedReplaceFile(staged, target);
    } finally {
      try {
        fs.unlinkSync(staged);
      } catch {
        // Best-effort cleanup of the staging file.
      }
    }
  }

  private restoreBackup(backupPath: string | null, target: string): void {
    if (backupPath === null) return;
    try {
      fs.copyFileSync(backupPath, target);
      this.log.warn('Hosts write failed; restored backup', { backupPath });
    } catch {
      this.log.error('Hosts write failed AND restore failed', { backupPath });
    }
  }

  private backup(content: string): string {
    fs.mkdirSync(this.options.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.options.backupDir, `hosts-${stamp}.bak`);
    fs.writeFileSync(backupPath, content, 'utf8');
    this.prune();
    return backupPath;
  }

  private prune(keep = 20): void {
    try {
      const files = fs
        .readdirSync(this.options.backupDir)
        .filter((f) => f.startsWith('hosts-') && f.endsWith('.bak'))
        .sort();
      for (const file of files.slice(0, Math.max(0, files.length - keep))) {
        fs.unlinkSync(path.join(this.options.backupDir, file));
      }
    } catch {
      // Backup pruning is best-effort.
    }
  }

}
