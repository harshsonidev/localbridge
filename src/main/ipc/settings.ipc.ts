import { IPC_CHANNELS } from '../../shared/constants';
import type { SettingsService } from '../services/settings.service';
import type { DomainService } from '../services/domain.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerSettingsIpc(
  ipc: IpcRegistrar,
  settings: SettingsService,
  domains: DomainService,
): void {
  ipc.handle(IPC_CHANNELS.settings.get, () => settings.get());

  ipc.handle(IPC_CHANNELS.settings.update, async ({ patch }) => {
    const updated = settings.update(patch);
    // These settings change the generated configuration or its location.
    if (patch.httpPort !== undefined || patch.httpsPort !== undefined) {
      await domains.applyConfigs();
    }
    return updated;
  });
}
