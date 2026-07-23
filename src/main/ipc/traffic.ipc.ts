import { IPC_CHANNELS } from '../../shared/constants';
import type { TrafficService } from '../services/traffic.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerTrafficIpc(ipc: IpcRegistrar, traffic: TrafficService): void {
  ipc.handle(IPC_CHANNELS.traffic.list, (payload) => traffic.list(payload?.limit));

  ipc.handle(IPC_CHANNELS.traffic.clear, () => {
    traffic.clear();
    return { cleared: true };
  });
}
