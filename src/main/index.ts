import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { buildAppPaths, ensureAppDirectories } from './services/paths.service';
import { createLogger, initializeLogging } from './services/logger.service';
import { createStorage } from './repositories/storage';
import { SettingsService } from './services/settings.service';
import { HostsService } from './services/hosts.service';
import { DomainService } from './services/domain.service';
import { PrivilegeService } from './services/privilege.service';
import { MkcertService } from './services/mkcert.service';
import { CertificateService } from './services/certificate.service';
import { CaddyProcessManager } from './services/caddy.service';
import { resolveBinaryPath, type BinaryResolutionContext } from './services/binary.service';
import { IpcRegistrar } from './security/ipc-security';
import { registerDomainIpc } from './ipc/domain.ipc';
import { registerConfigIpc } from './ipc/config.ipc';
import { registerSettingsIpc } from './ipc/settings.ipc';
import { registerSystemIpc } from './ipc/system.ipc';
import { registerProxyIpc } from './ipc/proxy.ipc';
import { registerCertificateIpc } from './ipc/certificate.ipc';
import { registerLogsIpc } from './ipc/logs.ipc';
import { registerTrafficIpc } from './ipc/traffic.ipc';
import { LogsService } from './services/logs.service';
import { TrafficService } from './services/traffic.service';
import { createMainWindow } from './window';

let mainWindow: BrowserWindow | null = null;
let caddyManager: CaddyProcessManager | null = null;
let shutdownStorage: (() => void) | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(bootstrap);
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');

  initializeLogging(path.join(userData, 'logs'));
  const appLog = createLogger('app');
  appLog.info(`LocalBridge starting (v${app.getVersion()}, electron ${process.versions.electron})`);

  // Last-resort safety net: log instead of showing Electron's crash
  // dialog. Every expected error path is already handled and surfaced
  // through structured IPC errors.
  process.on('uncaughtException', (err) => {
    appLog.error('Uncaught exception', { error: `${err.name}: ${err.message}`, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    appLog.error('Unhandled rejection', {
      error: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    });
  });

  try {
    const storage = await createStorage(path.join(userData, 'data'), {
      info: (m) => appLog.info(m),
      warn: (m) => appLog.warn(m),
    });

    const settings = new SettingsService(storage.settings, createLogger('config'));
    const paths = buildAppPaths(userData);
    ensureAppDirectories(paths);

    const binaryCtx: BinaryResolutionContext = {
      platform: process.platform,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
    };

    const privilege = new PrivilegeService(createLogger('privilege'));

    const hosts = new HostsService(
      {
        hostsPath: paths.hostsFile,
        backupDir: paths.hostsBackupDir,
        stagingDir: paths.stagingDir,
        shouldFlushDns: () => settings.get().flushDnsAfterHostsChange,
      },
      privilege,
      createLogger('hosts'),
    );

    const mkcert = new MkcertService(
      { getBinaryPath: () => resolveBinaryPath('mkcert', binaryCtx) },
      createLogger('certificates'),
    );

    const certificates = new CertificateService({
      mkcert,
      certificatesDir: paths.certificatesDir,
      log: createLogger('certificates'),
    });

    caddyManager = new CaddyProcessManager({
      getBinaryPath: () => resolveBinaryPath('caddy', binaryCtx),
      caddyfilePath: paths.caddyfile,
      caddyDir: paths.caddyDir,
      getPorts: () => {
        const s = settings.get();
        return { httpPort: s.httpPort, httpsPort: s.httpsPort };
      },
      log: createLogger('caddy'),
    });
    const caddy = caddyManager;

    const domains = new DomainService({
      repo: storage.domains,
      hosts,
      settings,
      certificates,
      paths,
      log: createLogger('domains'),
      isProxyRunning: () => caddy.currentState === 'running' || caddy.currentState === 'reloading',
    });

    domains.setOnConfigApplied(async () => {
      const hasEnabled = domains.list().some((d) => d.enabled);
      await caddy.syncConfig(settings.get().autoStartProxy, hasEnabled);
    });

    // Regenerate configuration files from the database on startup so the
    // on-disk state always matches what is stored. Skipped silently when
    // e.g. the user declines the elevation prompt at startup.
    try {
      await domains.applyConfigs();
    } catch (err) {
      appLog.error('Failed to regenerate configuration at startup', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const ipc = new IpcRegistrar(createLogger('ipc'), (sender) => {
      return mainWindow !== null && sender.id === mainWindow.webContents.id;
    });

    const logsService = new LogsService(paths.logFile);
    const trafficService = new TrafficService(paths.accessLogFile, createLogger('system'));

    registerDomainIpc(ipc, domains);
    registerConfigIpc(ipc, domains, paths);
    registerSettingsIpc(ipc, settings, domains);
    registerSystemIpc(ipc, storage.engine, binaryCtx);
    registerProxyIpc(ipc, caddy);
    registerCertificateIpc(ipc, mkcert, certificates, domains);
    registerLogsIpc(ipc, logsService, paths.logsDir);
    registerTrafficIpc(ipc, trafficService);

    applyContentSecurityPolicy();

    mainWindow = createMainWindow(createLogger('app'));
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(createLogger('app'));
        mainWindow.on('closed', () => {
          mainWindow = null;
        });
      }
    });

    shutdownStorage = () => storage.close();
  } catch (err) {
    appLog.error('Fatal startup error', {
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    app.quit();
  }
}

/**
 * Strict CSP for the packaged app; the dev server needs inline scripts
 * (React refresh preamble) and websocket connections for HMR.
 */
function applyContentSecurityPolicy(): void {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

app.on('window-all-closed', () => {
  // Tray/minimize-to-tray arrives in a later phase; stop the proxy and
  // quit when the window closes (macOS keeps the app alive by convention).
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Single, idempotent shutdown path: stop Caddy (never orphan it), then
// close storage, then let the quit proceed.
let quitCleanupDone = false;
app.on('will-quit', (event) => {
  if (quitCleanupDone) return;
  quitCleanupDone = true;

  const closeStorage = (): void => {
    try {
      shutdownStorage?.();
    } catch {
      // Already closed or never opened - nothing to release.
    }
    shutdownStorage = null;
  };

  if (!caddyManager) {
    closeStorage();
    return;
  }

  event.preventDefault();
  void caddyManager
    .stop()
    .catch(() => undefined)
    .then(() => {
      closeStorage();
      app.quit();
    });
});
