import net from 'node:net';
import { execFile } from 'node:child_process';
import { isValidPort } from '../../shared/validation';
import type { PortStatus, TargetCheckResult } from '../../shared/types';

/** True when nothing is listening on the port (we can bind it). */
export function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** TCP reachability probe for target services. */
export function checkTcpReachable(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<TargetCheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    socket.unref();

    const finish = (result: TargetCheckResult): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true, durationMs: Date.now() - started }));
    socket.once('timeout', () => finish({ reachable: false, error: 'Connection timed out' }));
    socket.once('error', (err) => finish({ reachable: false, error: err.message }));
  });
}

/**
 * Windows-only owner lookup for an occupied port, via PowerShell with a
 * fixed argument array (no shell string interpolation; the port is a
 * validated integer).
 */
function findPortOwnerWindows(port: number): Promise<{ pid?: number; name?: string }> {
  return new Promise((resolve) => {
    const script =
      `$c = Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
      `if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; ` +
      `Write-Output ("{0}|{1}" -f $c.OwningProcess, $p.ProcessName) }`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve({});
        const [pidText, name] = stdout.trim().split('|');
        const pid = Number(pidText);
        resolve({ pid: Number.isInteger(pid) ? pid : undefined, name: name || undefined });
      },
    );
  });
}

export async function checkPort(port: number): Promise<PortStatus> {
  if (!isValidPort(port)) {
    return { port, available: false };
  }
  const available = await isPortAvailable(port);
  if (available) return { port, available: true };

  if (process.platform === 'win32') {
    const owner = await findPortOwnerWindows(port);
    return { port, available: false, ownerPid: owner.pid, ownerName: owner.name };
  }
  return { port, available: false };
}
