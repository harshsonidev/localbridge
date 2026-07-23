import { shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { AppError } from '../../shared/errors';
import type { DomainService } from '../services/domain.service';
import { checkTcpReachable } from '../services/port.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerDomainIpc(ipc: IpcRegistrar, domains: DomainService): void {
  ipc.handle(IPC_CHANNELS.domains.list, () => domains.list());
  ipc.handle(IPC_CHANNELS.domains.get, ({ id }) => domains.get(id));
  ipc.handle(IPC_CHANNELS.domains.create, ({ input }) => domains.create(input));
  ipc.handle(IPC_CHANNELS.domains.update, ({ id, input }) => domains.update(id, input));
  ipc.handle(IPC_CHANNELS.domains.remove, ({ id }) => domains.remove(id));
  ipc.handle(IPC_CHANNELS.domains.enable, ({ id }) => domains.setEnabled(id, true));
  ipc.handle(IPC_CHANNELS.domains.disable, ({ id }) => domains.setEnabled(id, false));
  ipc.handle(IPC_CHANNELS.domains.checkTarget, ({ host, port }) => checkTcpReachable(host, port));

  ipc.handle(IPC_CHANNELS.domains.open, async ({ id }) => {
    const url = domains.publicUrl(id);
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new AppError('VALIDATION_FAILED', 'Refusing to open a non-http URL.');
    }
    await shell.openExternal(url);
    return { url };
  });
}
