import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type {
  AppSettings,
  DomainCreateInput,
  DomainUpdateInput,
  LocalBridgeApi,
} from '../shared/types';

/**
 * The renderer only ever sees this object. Channels are fixed constants —
 * nothing here forwards arbitrary channel names or arguments, and the main
 * process re-validates every payload with Zod.
 */

const invoke = (channel: string, payload?: unknown): Promise<never> =>
  ipcRenderer.invoke(channel, payload) as Promise<never>;

export function buildApi(): LocalBridgeApi {
  return {
    domains: {
      list: () => invoke(IPC_CHANNELS.domains.list),
      get: (id: string) => invoke(IPC_CHANNELS.domains.get, { id }),
      create: (input: DomainCreateInput) => invoke(IPC_CHANNELS.domains.create, { input }),
      update: (id: string, input: DomainUpdateInput) =>
        invoke(IPC_CHANNELS.domains.update, { id, input }),
      remove: (id: string) => invoke(IPC_CHANNELS.domains.remove, { id }),
      enable: (id: string) => invoke(IPC_CHANNELS.domains.enable, { id }),
      disable: (id: string) => invoke(IPC_CHANNELS.domains.disable, { id }),
      open: (id: string) => invoke(IPC_CHANNELS.domains.open, { id }),
      checkTarget: (host: string, port: number) =>
        invoke(IPC_CHANNELS.domains.checkTarget, { host, port }),
    },
    config: {
      preview: () => invoke(IPC_CHANNELS.config.preview),
      paths: () => invoke(IPC_CHANNELS.config.paths),
    },
    proxy: {
      start: () => invoke(IPC_CHANNELS.proxy.start),
      stop: () => invoke(IPC_CHANNELS.proxy.stop),
      restart: () => invoke(IPC_CHANNELS.proxy.restart),
      status: () => invoke(IPC_CHANNELS.proxy.status),
    },
    certificates: {
      installAuthority: () => invoke(IPC_CHANNELS.certificates.installAuthority),
      authorityStatus: () => invoke(IPC_CHANNELS.certificates.authorityStatus),
      list: () => invoke(IPC_CHANNELS.certificates.list),
      regenerate: () => invoke(IPC_CHANNELS.certificates.regenerate),
    },
    settings: {
      get: () => invoke(IPC_CHANNELS.settings.get),
      update: (patch: Partial<AppSettings>) => invoke(IPC_CHANNELS.settings.update, { patch }),
    },
    logs: {
      list: (limit?: number) =>
        invoke(IPC_CHANNELS.logs.list, limit !== undefined ? { limit } : undefined),
      clear: () => invoke(IPC_CHANNELS.logs.clear),
      openDirectory: () => invoke(IPC_CHANNELS.logs.openDirectory),
    },
    traffic: {
      list: (limit?: number) =>
        invoke(IPC_CHANNELS.traffic.list, limit !== undefined ? { limit } : undefined),
      clear: () => invoke(IPC_CHANNELS.traffic.clear),
    },
    system: {
      platformStatus: () => invoke(IPC_CHANNELS.system.platformStatus),
      checkPort: (port: number) => invoke(IPC_CHANNELS.system.checkPort, { port }),
    },
  };
}
