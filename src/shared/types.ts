import type { AppErrorShape, IpcResult } from './errors';

export type FrontendProtocol = 'http' | 'https';
export type TargetProtocol = 'http' | 'https';

export interface DomainFrontendConfig {
  protocol: FrontendProtocol;
  redirectHttpToHttps: boolean;
}

export interface DomainTargetConfig {
  protocol: TargetProtocol;
  host: string;
  port: number;
  basePath?: string;
  allowInvalidCertificate?: boolean;
}

export interface DomainProxyConfig {
  preserveHost: boolean;
  rewriteHost?: string;
  websockets: boolean;
  http2: boolean;
  stripPrefix?: string;
  addPrefix?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestTimeoutMs: number;
  responseTimeoutMs: number;
}

export interface DomainHealthCheckConfig {
  enabled: boolean;
  path: string;
  intervalSeconds: number;
}

export interface DomainConfig {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  frontend: DomainFrontendConfig;
  target: DomainTargetConfig;
  proxy: DomainProxyConfig;
  healthCheck: DomainHealthCheckConfig;
  inspectionEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  httpPort: number;
  httpsPort: number;
  theme: 'system' | 'light' | 'dark';
  flushDnsAfterHostsChange: boolean;
  removeHostsEntryOnDisable: boolean;
  /** Start the proxy automatically when configuration changes require it. */
  autoStartProxy: boolean;
}

export interface AppPaths {
  userData: string;
  database: string;
  certificatesDir: string;
  caddyDir: string;
  caddyfile: string;
  /** The system hosts file. */
  hostsFile: string;
  hostsBackupDir: string;
  /** Staging area for the elevated hosts write. */
  stagingDir: string;
  logsDir: string;
  logFile: string;
  accessLogFile: string;
}

export interface ConfigPreview {
  /** The managed block LocalBridge places in the hosts file. */
  hostsBlock: string;
  /** Full contents of the hosts file after applying the block. */
  hostsFile: string;
  /** The generated Caddyfile. */
  caddyfile: string;
  hostsFilePath: string;
  caddyfilePath: string;
  /** Non-blocking issues, e.g. https domains skipped for missing certs. */
  warnings: string[];
}

export type ProxyState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'reloading'
  | 'stopping'
  | 'error'
  | 'port-conflict'
  | 'invalid-config';

export interface ProxyStatus {
  state: ProxyState;
  pid?: number;
  startedAt?: string;
  version?: string;
  httpPort: number;
  httpsPort: number;
  lastError?: string;
  restartCount: number;
}

export interface CaStatus {
  mkcertAvailable: boolean;
  caRootDir?: string;
  /** CA key material exists on disk. */
  created: boolean;
  /** CA is present in the current user's trust store. */
  trusted: boolean;
}

export type CertificateState = 'valid' | 'expiring-soon' | 'expired' | 'missing' | 'domain-mismatch';

export interface CertificateInfo {
  /** Certificate base name (the domain it covers). */
  name: string;
  certFile: string;
  keyFile: string;
  /** Domains this certificate should cover. */
  domains: string[];
  /** SANs actually present in the certificate file. */
  coveredDomains: string[];
  issuedAt?: string;
  expiresAt?: string;
  status: CertificateState;
}

/** Subset of process.platform values, kept renderer-safe (no Node types). */
export type PlatformName =
  | 'win32'
  | 'darwin'
  | 'linux'
  | 'aix'
  | 'freebsd'
  | 'openbsd'
  | 'sunos'
  | 'android'
  | 'haiku'
  | 'cygwin'
  | 'netbsd';

export interface PlatformStatus {
  platform: PlatformName;
  arch: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  storageEngine: 'sqlite' | 'json';
  caddyBinary: BinaryStatus;
  mkcertBinary: BinaryStatus;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
}

export interface TrafficRecord {
  id: number;
  timestamp: string;
  host: string;
  method: string;
  path: string;
  query?: string;
  protocol: string;
  status: number;
  durationMs: number;
  requestSize: number;
  responseSize: number;
  clientIp: string;
  userAgent?: string;
  referer?: string;
  /** Redacted request headers (Authorization, Cookie, ... masked). */
  requestHeaders: Record<string, string>;
  /** Redacted response headers. */
  responseHeaders: Record<string, string>;
}

export interface BinaryStatus {
  tool: 'caddy' | 'mkcert';
  path: string;
  exists: boolean;
}

export interface PortStatus {
  port: number;
  available: boolean;
  /** Owner process info when the port is occupied and discoverable. */
  ownerPid?: number;
  ownerName?: string;
}

export interface TargetCheckResult {
  reachable: boolean;
  durationMs?: number;
  error?: string;
}

/** Input accepted by domains.create — the pre-normalization form payload. */
export interface DomainCreateInput {
  name?: string;
  domain: string;
  enabled?: boolean;
  frontend?: Partial<DomainFrontendConfig>;
  target: {
    protocol?: TargetProtocol;
    host: string;
    port: number;
    basePath?: string;
    allowInvalidCertificate?: boolean;
  };
  proxy?: Partial<DomainProxyConfig>;
  healthCheck?: Partial<DomainHealthCheckConfig>;
  inspectionEnabled?: boolean;
}

export type DomainUpdateInput = Partial<Omit<DomainCreateInput, 'domain'>> & {
  domain?: string;
};

export interface DomainCreateResult {
  domain: DomainConfig;
  /** Warnings that did not block creation (target offline, port busy...). */
  warnings: string[];
  preview: ConfigPreview;
}

/** Typed API exposed on window.localBridge by the preload script. */
export interface LocalBridgeApi {
  domains: {
    list(): Promise<IpcResult<DomainConfig[]>>;
    get(id: string): Promise<IpcResult<DomainConfig>>;
    create(input: DomainCreateInput): Promise<IpcResult<DomainCreateResult>>;
    update(id: string, input: DomainUpdateInput): Promise<IpcResult<DomainCreateResult>>;
    remove(id: string): Promise<IpcResult<{ preview: ConfigPreview }>>;
    enable(id: string): Promise<IpcResult<DomainCreateResult>>;
    disable(id: string): Promise<IpcResult<DomainCreateResult>>;
    open(id: string): Promise<IpcResult<{ url: string }>>;
    checkTarget(host: string, port: number): Promise<IpcResult<TargetCheckResult>>;
  };
  config: {
    preview(): Promise<IpcResult<ConfigPreview>>;
    paths(): Promise<IpcResult<AppPaths>>;
  };
  proxy: {
    start(): Promise<IpcResult<ProxyStatus>>;
    stop(): Promise<IpcResult<ProxyStatus>>;
    restart(): Promise<IpcResult<ProxyStatus>>;
    status(): Promise<IpcResult<ProxyStatus>>;
  };
  certificates: {
    installAuthority(): Promise<IpcResult<CaStatus>>;
    authorityStatus(): Promise<IpcResult<CaStatus>>;
    list(): Promise<IpcResult<CertificateInfo[]>>;
    regenerate(): Promise<IpcResult<CertificateInfo[]>>;
  };
  settings: {
    get(): Promise<IpcResult<AppSettings>>;
    update(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;
  };
  logs: {
    list(limit?: number): Promise<IpcResult<LogEntry[]>>;
    clear(): Promise<IpcResult<{ cleared: boolean }>>;
    openDirectory(): Promise<IpcResult<{ opened: boolean }>>;
  };
  traffic: {
    list(limit?: number): Promise<IpcResult<TrafficRecord[]>>;
    clear(): Promise<IpcResult<{ cleared: boolean }>>;
  };
  system: {
    platformStatus(): Promise<IpcResult<PlatformStatus>>;
    checkPort(port: number): Promise<IpcResult<PortStatus>>;
  };
}

export type { AppErrorShape, IpcResult };
