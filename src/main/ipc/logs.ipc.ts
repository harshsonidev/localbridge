import { shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LogsService } from '../services/logs.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerLogsIpc(ipc: IpcRegistrar, logs: LogsService, logsDir: string): void {
  ipc.handle(IPC_CHANNELS.logs.list, (payload) => logs.list(payload?.limit));

  ipc.handle(IPC_CHANNELS.logs.clear, () => {
    logs.clear();
    return { cleared: true };
  });

  ipc.handle(IPC_CHANNELS.logs.openDirectory, async () => {
    // Fixed app-owned path - never influenced by renderer input.
    const error = await shell.openPath(logsDir);
    return { opened: error === '' };
  });
}
