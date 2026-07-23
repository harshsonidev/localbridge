import { IPC_CHANNELS } from '../../shared/constants';
import type { AppPaths } from '../../shared/types';
import type { DomainService } from '../services/domain.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerConfigIpc(ipc: IpcRegistrar, domains: DomainService, paths: AppPaths): void {
  ipc.handle(IPC_CHANNELS.config.preview, () => domains.preview());
  ipc.handle(IPC_CHANNELS.config.paths, () => paths);
}
