/**
 * Elevated operations. LocalBridge only ever touches the system hosts
 * file, and it does so with a single elevation prompt in the app's
 * lifetime: the first time the hosts file is not writable it grants the
 * current user write permission (Windows ACL via icacls, macOS ACL via
 * chmod +a), after which every change is written directly with no prompt.
 * A per-write elevated copy remains as a fallback for locked-down machines.
 *
 * No user-controlled strings are ever interpolated into an elevated
 * command: only fixed app/OS paths and the current account name, each
 * validated against quote, backslash and control characters.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { AppError } from '../../shared/errors';
import type { CategoryLogger } from './logger.service';

/**
 * True when a path contains characters that could break out of the quoted
 * path in the elevated command. Windows paths legitimately contain
 * backslashes and are wrapped in single quotes in PowerShell (where `\` is
 * literal), so backslash is only unsafe for the macOS AppleScript string.
 */
export function pathHasUnsafeChars(p: string, platform: NodeJS.Platform = process.platform): boolean {
  const dangerous = platform === 'darwin' ? /["'\\\r\n\0`$]/ : /["'\r\n\0`$]/;
  return dangerous.test(p);
}

function assertSafePath(p: string): void {
  if (pathHasUnsafeChars(p)) {
    throw new AppError('VALIDATION_FAILED', 'Unsafe characters in file path.', {
      details: `Rejected path: ${JSON.stringify(p)}`,
    });
  }
}

/** Current account name, validated so it is safe to place in a command. */
function currentUser(): string {
  const name = os.userInfo().username;
  if (!/^[A-Za-z0-9 ._\\-]{1,256}$/.test(name)) {
    throw new AppError('PRIVILEGE_REQUIRED', 'Could not determine a safe account name.', {
      details: `Rejected username: ${JSON.stringify(name)}`,
    });
  }
  return name;
}

function mapElevationError(err: Error, cancelPattern: RegExp): AppError {
  const message = err.message ?? String(err);
  if (cancelPattern.test(message)) {
    return new AppError('PRIVILEGE_REQUIRED', 'Administrator permission was declined.', {
      suggestion: 'Accept the permission prompt so LocalBridge can manage the hosts file.',
      retryable: true,
      cause: err,
    });
  }
  return new AppError('HOSTS_WRITE_FAILED', 'The elevated operation failed.', {
    details: message,
    retryable: true,
    cause: err,
  });
}

export class PrivilegeService {
  constructor(private readonly log: CategoryLogger) {}

  /**
   * Grant the current user write permission on `filePath` using one
   * elevation prompt. HostsService calls this only when the file is not
   * already writable, so it happens at most once per machine lifetime.
   */
  async grantFileWritable(filePath: string): Promise<void> {
    assertSafePath(filePath);
    const user = currentUser();
    this.log.info('Requesting one-time permission grant', { file: filePath });

    if (process.platform === 'win32') {
      await this.runElevatedWindows(`icacls '${filePath}' /grant '${user}:(M)'`);
    } else if (process.platform === 'darwin') {
      await this.runElevatedMac(
        `/bin/chmod +a '${user} allow write,append,writeattr,writeextattr,delete' '${filePath}'`,
      );
    } else {
      throw new AppError('PRIVILEGE_REQUIRED', 'Hosts-file permission is not implemented on Linux yet.', {
        suggestion: 'Run LocalBridge with permission to edit /etc/hosts, or add a Linux helper.',
      });
    }
    this.log.info('Permission grant completed', { file: filePath });
  }

  /**
   * Fallback: copy `sourceFile` over `destFile` with one elevation prompt.
   * Used only when a direct write still fails after granting permission.
   */
  async elevatedReplaceFile(sourceFile: string, destFile: string): Promise<void> {
    assertSafePath(sourceFile);
    assertSafePath(destFile);
    if (!fs.existsSync(sourceFile)) {
      throw new AppError('HOSTS_WRITE_FAILED', 'Prepared hosts content is missing.', {
        details: `Source file not found: ${sourceFile}`,
      });
    }
    this.log.info('Requesting elevation to replace file', { dest: destFile });

    if (process.platform === 'win32') {
      await this.runElevatedWindows(`Copy-Item -LiteralPath '${sourceFile}' -Destination '${destFile}' -Force`);
    } else if (process.platform === 'darwin') {
      await this.runElevatedMac(`/bin/cp -f '${sourceFile}' '${destFile}'`);
    } else {
      throw new AppError('PRIVILEGE_REQUIRED', 'Elevated writes are not implemented on Linux yet.', {
        suggestion: 'Run LocalBridge with permission to edit /etc/hosts, or add a Linux helper.',
      });
    }
    this.log.info('Elevated file replace completed', { dest: destFile });
  }

  /** Launch an elevated PowerShell command via a single UAC prompt. */
  private runElevatedWindows(inner: string): Promise<void> {
    const script =
      `$p = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList '-NoProfile','-NonInteractive','-Command',"${inner}" ` +
      `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    return new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 120_000, windowsHide: true },
        (err) => (err ? reject(mapElevationError(err, /canceled|cancelled|abgebrochen|1223/i)) : resolve()),
      );
    });
  }

  /** Run a shell command with one macOS authorization dialog. */
  private runElevatedMac(shell: string): Promise<void> {
    const appleScript = `do shell script "${shell}" with administrator privileges`;
    return new Promise<void>((resolve, reject) => {
      execFile('osascript', ['-e', appleScript], { timeout: 120_000 }, (err) =>
        err ? reject(mapElevationError(err, /User canceled|-128/i)) : resolve(),
      );
    });
  }

  /**
   * Flush the DNS resolver cache. Needs no elevation on either platform:
   * Windows uses ipconfig; macOS flushes the user-visible cache with
   * dscacheutil (hosts-file entries are honored immediately regardless).
   */
  async flushDns(): Promise<void> {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        execFile('ipconfig', ['/flushdns'], { timeout: 15_000, windowsHide: true }, (err) => {
          if (err) this.log.warn('DNS flush failed', { error: err.message });
          else this.log.info('DNS cache flushed');
          resolve();
        });
      });
    } else if (process.platform === 'darwin') {
      await new Promise<void>((resolve) => {
        execFile('dscacheutil', ['-flushcache'], { timeout: 15_000 }, (err) => {
          if (err) this.log.warn('DNS flush failed', { error: err.message });
          else this.log.info('DNS cache flushed');
          resolve();
        });
      });
    }
  }
}
