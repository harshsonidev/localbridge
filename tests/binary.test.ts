import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBinaryPath, binaryFileName } from '../src/main/services/binary.service';

const base = {
  isPackaged: false,
  resourcesPath: 'C:\\Program Files\\LocalBridge\\resources',
  appRoot: 'D:\\dev\\localbridge',
};

describe('binaryFileName', () => {
  it('adds .exe only on Windows', () => {
    expect(binaryFileName('caddy', 'win32')).toBe('caddy.exe');
    expect(binaryFileName('caddy', 'darwin')).toBe('caddy');
    expect(binaryFileName('mkcert', 'linux')).toBe('mkcert');
  });
});

describe('resolveBinaryPath', () => {
  it('resolves development paths per platform', () => {
    expect(resolveBinaryPath('caddy', { ...base, platform: 'win32' })).toBe(
      path.join('D:\\dev\\localbridge', 'resources', 'windows', 'caddy.exe'),
    );
    expect(resolveBinaryPath('mkcert', { ...base, platform: 'darwin' })).toBe(
      path.join('D:\\dev\\localbridge', 'resources', 'macos', 'mkcert'),
    );
    expect(resolveBinaryPath('caddy', { ...base, platform: 'linux' })).toBe(
      path.join('D:\\dev\\localbridge', 'resources', 'linux', 'caddy'),
    );
  });

  it('resolves packaged paths under resourcesPath/binaries', () => {
    expect(resolveBinaryPath('caddy', { ...base, platform: 'win32', isPackaged: true })).toBe(
      path.join('C:\\Program Files\\LocalBridge\\resources', 'binaries', 'caddy.exe'),
    );
  });

  it('prefers a user override path', () => {
    expect(
      resolveBinaryPath('caddy', { ...base, platform: 'win32', overridePath: 'E:\\tools\\caddy.exe' }),
    ).toBe('E:\\tools\\caddy.exe');
  });

  it('throws for unsupported platforms in development', () => {
    expect(() => resolveBinaryPath('caddy', { ...base, platform: 'freebsd' })).toThrow();
  });
});
