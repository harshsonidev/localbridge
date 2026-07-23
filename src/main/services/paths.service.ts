import path from 'node:path';
import fs from 'node:fs';
import type { AppPaths } from '../../shared/types';

/** Central place for every filesystem location the app uses. */
export function buildAppPaths(userData: string): AppPaths {
  const hostsFile =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
      : '/etc/hosts';

  const caddyDir = path.join(userData, 'caddy');
  const logsDir = path.join(userData, 'logs');

  return {
    userData,
    database: path.join(userData, 'data'),
    certificatesDir: path.join(userData, 'certificates'),
    caddyDir,
    caddyfile: path.join(caddyDir, 'Caddyfile'),
    hostsFile,
    hostsBackupDir: path.join(userData, 'backups', 'hosts'),
    stagingDir: path.join(userData, 'staging'),
    logsDir,
    logFile: path.join(logsDir, 'localbridge.log'),
    accessLogFile: path.join(caddyDir, 'access.log'),
  };
}

export function ensureAppDirectories(paths: AppPaths): void {
  const dirs = [
    paths.database,
    paths.certificatesDir,
    paths.caddyDir,
    path.join(paths.caddyDir, 'data'),
    paths.hostsBackupDir,
    paths.stagingDir,
    paths.logsDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
