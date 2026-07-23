import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { PlatformStatus } from '../../shared/types';
import { checkBinary, type BinaryResolutionContext } from '../services/binary.service';
import { checkPort } from '../services/port.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerSystemIpc(
  ipc: IpcRegistrar,
  storageEngine: 'sqlite' | 'json',
  binaryCtx: BinaryResolutionContext,
): void {
  ipc.handle(IPC_CHANNELS.system.platformStatus, (): PlatformStatus => {
    return {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      storageEngine,
      caddyBinary: checkBinary('caddy', binaryCtx),
      mkcertBinary: checkBinary('mkcert', binaryCtx),
    };
  });

  ipc.handle(IPC_CHANNELS.system.checkPort, ({ port }) => checkPort(port));
}
