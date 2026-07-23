import { IPC_CHANNELS } from '../../shared/constants';
import type { CaddyProcessManager } from '../services/caddy.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerProxyIpc(ipc: IpcRegistrar, caddy: CaddyProcessManager): void {
  ipc.handle(IPC_CHANNELS.proxy.start, () => caddy.start());
  ipc.handle(IPC_CHANNELS.proxy.stop, () => caddy.stop());
  ipc.handle(IPC_CHANNELS.proxy.restart, () => caddy.restart());
  ipc.handle(IPC_CHANNELS.proxy.status, () => caddy.status());
}
