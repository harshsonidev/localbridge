export const APP_NAME = 'LocalBridge';

/** Markers delimiting the hosts-file block that LocalBridge owns. */
export const MANAGED_BLOCK_BEGIN = '# BEGIN LOCALBRIDGE MANAGED DOMAINS';
export const MANAGED_BLOCK_END = '# END LOCALBRIDGE MANAGED DOMAINS';

export const LOOPBACK_IPV4 = '127.0.0.1';

export const DEFAULT_HTTP_PORT = 80;
export const DEFAULT_HTTPS_PORT = 443;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
export const DEFAULT_HEALTH_CHECK_INTERVAL_S = 10;
export const DEFAULT_HEALTH_CHECK_PATH = '/';

export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/**
 * Every IPC channel the preload bridge may invoke. The main process refuses
 * to register a handler for a channel that is not in this list, and the
 * preload script only exposes these exact channels.
 */
export const IPC_CHANNELS = {
  domains: {
    list: 'domains:list',
    get: 'domains:get',
    create: 'domains:create',
    update: 'domains:update',
    remove: 'domains:remove',
    enable: 'domains:enable',
    disable: 'domains:disable',
    open: 'domains:open',
    checkTarget: 'domains:check-target',
  },
  config: {
    preview: 'config:preview',
    paths: 'config:paths',
  },
  proxy: {
    start: 'proxy:start',
    stop: 'proxy:stop',
    restart: 'proxy:restart',
    status: 'proxy:status',
  },
  certificates: {
    installAuthority: 'certificates:install-authority',
    authorityStatus: 'certificates:authority-status',
    list: 'certificates:list',
    regenerate: 'certificates:regenerate',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
  },
  logs: {
    list: 'logs:list',
    clear: 'logs:clear',
    openDirectory: 'logs:open-directory',
  },
  traffic: {
    list: 'traffic:list',
    clear: 'traffic:clear',
  },
  system: {
    platformStatus: 'system:platform-status',
    checkPort: 'system:check-port',
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];

/** Flat allowlist used by preload and by the IPC security layer. */
export const ALL_IPC_CHANNELS: readonly string[] = Object.freeze(
  Object.values(IPC_CHANNELS).flatMap((group) => Object.values(group)),
);

export type IpcChannel = Leaves<typeof IPC_CHANNELS>;
