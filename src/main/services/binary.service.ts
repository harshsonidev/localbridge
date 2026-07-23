/**
 * Resolve the bundled Caddy / mkcert binaries for the current platform.
 * Pure resolution logic is separated from environment access for testing.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BinaryStatus } from '../../shared/types';

export type BundledTool = 'caddy' | 'mkcert';

export interface BinaryResolutionContext {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Electron process.resourcesPath (packaged builds). */
  resourcesPath: string;
  /** Repository/app root (development builds). */
  appRoot: string;
  /** Optional user override from settings. */
  overridePath?: string;
}

const PLATFORM_DIRS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

export function binaryFileName(tool: BundledTool, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${tool}.exe` : tool;
}

/**
 * Development: <appRoot>/resources/<platform>/<tool>[.exe]
 * Production:  <resourcesPath>/binaries/<tool>[.exe]
 */
export function resolveBinaryPath(tool: BundledTool, ctx: BinaryResolutionContext): string {
  if (ctx.overridePath) return ctx.overridePath;

  const fileName = binaryFileName(tool, ctx.platform);
  if (ctx.isPackaged) {
    return path.join(ctx.resourcesPath, 'binaries', fileName);
  }
  const platformDir = PLATFORM_DIRS[ctx.platform];
  if (!platformDir) {
    throw new Error(`Unsupported platform for bundled binaries: ${ctx.platform}`);
  }
  return path.join(ctx.appRoot, 'resources', platformDir, fileName);
}

export function checkBinary(tool: BundledTool, ctx: BinaryResolutionContext): BinaryStatus {
  const resolved = resolveBinaryPath(tool, ctx);
  let exists: boolean;
  try {
    exists = fs.statSync(resolved).isFile();
  } catch {
    exists = false;
  }
  return { tool, path: resolved, exists };
}
