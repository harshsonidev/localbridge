import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, shell } from 'electron';
import type { CategoryLogger } from './services/logger.service';

/**
 * Window/taskbar icon for development runs. Packaged builds use the
 * executable's embedded icon (assets/icon.ico via electron-builder).
 */
function devIconPath(): string | undefined {
  if (app.isPackaged) return undefined;
  const icon = path.join(app.getAppPath(), 'assets', 'icon.png');
  return fs.existsSync(icon) ? icon : undefined;
}

export function createMainWindow(log: CategoryLogger): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f17',
    title: 'LocalBridge',
    icon: devIconPath(),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // Block all in-window navigation except the dev server itself.
  window.webContents.on('will-navigate', (event, url) => {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL;
    if (devServerUrl && url.startsWith(devServerUrl)) return;
    log.warn('Blocked navigation attempt', { url });
    event.preventDefault();
  });

  // New windows are never allowed; validated external links only.
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(url);
      } else {
        log.warn('Blocked window.open with non-http URL', { url });
      }
    } catch {
      log.warn('Blocked window.open with invalid URL', { url });
    }
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }

  return window;
}
