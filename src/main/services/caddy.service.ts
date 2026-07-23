/**
 * CaddyProcessManager: owns the embedded Caddy process lifecycle.
 * All executions use spawn/execFile with fixed argument arrays.
 * Config changes go through validate -> reload (via the localhost-only
 * admin endpoint); unexpected exits restart with capped exponential
 * backoff (max 5 failures per 60s window).
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import type { ProxyState, ProxyStatus } from '../../shared/types';
import { isPortAvailable, checkPort } from './port.service';
import type { CategoryLogger } from './logger.service';

export interface CaddyManagerOptions {
  getBinaryPath(): string;
  caddyfilePath: string;
  /** Runtime dir for logs and Caddy's isolated data directory. */
  caddyDir: string;
  getPorts(): { httpPort: number; httpsPort: number };
  log: CategoryLogger;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000, 10000];
const MAX_FAILURES_PER_MINUTE = 5;

export class CaddyProcessManager {
  private state: ProxyState = 'stopped';
  private child: ChildProcess | null = null;
  private startedAt: string | undefined;
  private lastError: string | undefined;
  private restartCount = 0;
  private failureTimestamps: number[] = [];
  private expectedExit = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedVersion: string | undefined;
  private recentOutput: string[] = [];

  constructor(private readonly options: CaddyManagerOptions) {}

  get currentState(): ProxyState {
    return this.state;
  }

  private get env(): NodeJS.ProcessEnv {
    // Isolate Caddy's own storage inside the app data directory. Caddy
    // resolves its data/config dir from APPDATA on Windows and from the
    // XDG variables (falling back to HOME) on macOS/Linux, so set all of
    // them at the same isolated location.
    const dataDir = path.join(this.options.caddyDir, 'data');
    return {
      ...process.env,
      APPDATA: dataDir,
      XDG_DATA_HOME: dataDir,
      XDG_CONFIG_HOME: dataDir,
    };
  }

  isAvailable(): boolean {
    try {
      return fs.statSync(this.options.getBinaryPath()).isFile();
    } catch {
      return false;
    }
  }

  private assertBinary(): string {
    const binary = this.options.getBinaryPath();
    if (!this.isAvailable()) {
      throw new AppError('CADDY_BINARY_MISSING', 'The Caddy binary is missing.', {
        details: `Expected at: ${binary}`,
        suggestion: 'Run "npm run download-binaries" (development) or reinstall LocalBridge.',
      });
    }
    return binary;
  }

  private execCaddy(args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
    const binary = this.assertBinary();
    return new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, windowsHide: true, env: this.env, cwd: this.options.caddyDir },
        (err, stdout, stderr) => {
          if (err) reject(Object.assign(err, { stdout, stderr }));
          else resolve({ stdout, stderr });
        },
      );
    });
  }

  async version(): Promise<string | undefined> {
    if (this.cachedVersion) return this.cachedVersion;
    if (!this.isAvailable()) return undefined;
    try {
      const { stdout } = await this.execCaddy(['version'], 10_000);
      this.cachedVersion = stdout.trim().split(/\s+/)[0];
    } catch {
      this.cachedVersion = undefined;
    }
    return this.cachedVersion;
  }

  async validate(): Promise<{ ok: boolean; output: string }> {
    try {
      const { stdout, stderr } = await this.execCaddy([
        'validate',
        '--config',
        this.options.caddyfilePath,
        '--adapter',
        'caddyfile',
      ]);
      return { ok: true, output: `${stdout}\n${stderr}`.trim() };
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stderr ?? ''}\n${e.stdout ?? ''}`.trim() || e.message };
    }
  }

  async status(): Promise<ProxyStatus> {
    const ports = this.options.getPorts();
    return {
      state: this.state,
      pid: this.child?.pid,
      startedAt: this.startedAt,
      version: await this.version(),
      httpPort: ports.httpPort,
      httpsPort: ports.httpsPort,
      lastError: this.lastError,
      restartCount: this.restartCount,
    };
  }

  async start(): Promise<ProxyStatus> {
    if (this.state === 'running' || this.state === 'starting' || this.state === 'reloading') {
      return this.status();
    }
    this.clearRestartTimer();
    this.assertBinary();
    this.state = 'starting';
    this.lastError = undefined;

    const validation = await this.validate();
    if (!validation.ok) {
      this.state = 'invalid-config';
      this.lastError = validation.output;
      throw new AppError('CADDY_CONFIG_INVALID', 'The generated Caddy configuration is invalid.', {
        details: validation.output,
      });
    }

    const ports = this.options.getPorts();
    for (const port of [ports.httpPort, ports.httpsPort]) {
      if (!(await isPortAvailable(port))) {
        const owner = await checkPort(port);
        this.state = 'port-conflict';
        this.lastError = `Port ${port} is in use${owner.ownerName ? ` by ${owner.ownerName} (PID ${owner.ownerPid})` : ''}.`;
        throw new AppError('CADDY_PORT_CONFLICT', this.lastError, {
          suggestion: 'Stop the conflicting process or change the LocalBridge ports in Settings.',
          retryable: true,
        });
      }
    }

    await this.spawnProcess();
    return this.status();
  }

  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const binary = this.assertBinary();
      this.expectedExit = false;

      const child = spawn(
        binary,
        ['run', '--config', this.options.caddyfilePath, '--adapter', 'caddyfile'],
        { cwd: this.options.caddyDir, env: this.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child = child;

      const logStream = fs.createWriteStream(path.join(this.options.caddyDir, 'caddy.log'), {
        flags: 'a',
      });
      const capture = (chunk: Buffer): void => {
        const text = chunk.toString();
        logStream.write(text);
        this.recentOutput.push(...text.split('\n').filter(Boolean));
        if (this.recentOutput.length > 100) {
          this.recentOutput = this.recentOutput.slice(-100);
        }
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);

      let settled = false;

      child.once('error', (err) => {
        this.state = 'error';
        this.lastError = err.message;
        this.child = null;
        logStream.end();
        if (!settled) {
          settled = true;
          reject(
            new AppError('CADDY_START_FAILED', 'Failed to start the Caddy process.', {
              details: err.message,
              retryable: true,
              cause: err,
            }),
          );
        }
      });

      child.on('exit', (code) => {
        logStream.end();
        this.child = null;
        if (this.expectedExit) {
          this.state = 'stopped';
          this.startedAt = undefined;
          this.options.log.info('Caddy stopped', { code: code ?? 0 });
          return;
        }
        const tail = this.recentOutput.slice(-5).join('\n');
        this.lastError = `Caddy exited unexpectedly (code ${code ?? 'unknown'}). ${tail}`;
        this.options.log.error('Caddy exited unexpectedly', { code: code ?? -1 });
        if (!settled) {
          // Died during startup - treat as start failure, no auto-restart.
          settled = true;
          this.state = 'error';
          reject(
            new AppError('CADDY_START_FAILED', 'Caddy exited during startup.', {
              details: this.lastError,
              retryable: true,
            }),
          );
          return;
        }
        this.scheduleRestart();
      });

      // Consider the start successful once the process survives briefly.
      setTimeout(() => {
        if (!settled && this.child === child && child.exitCode === null) {
          settled = true;
          this.state = 'running';
          this.startedAt = new Date().toISOString();
          this.options.log.info('Caddy running', { pid: child.pid ?? -1 });
          resolve();
        }
      }, 1200);
    });
  }

  private scheduleRestart(): void {
    const now = Date.now();
    this.failureTimestamps = this.failureTimestamps.filter((t) => now - t < 60_000);
    this.failureTimestamps.push(now);

    if (this.failureTimestamps.length >= MAX_FAILURES_PER_MINUTE) {
      this.state = 'error';
      this.lastError = `${this.lastError ?? ''}\nGiving up after ${MAX_FAILURES_PER_MINUTE} failures within a minute.`.trim();
      this.options.log.error('Caddy restart limit reached; giving up');
      return;
    }

    const delay = BACKOFF_MS[Math.min(this.failureTimestamps.length - 1, BACKOFF_MS.length - 1)];
    this.state = 'starting';
    this.options.log.warn(`Restarting Caddy in ${delay}ms`, { attempt: this.failureTimestamps.length });
    this.restartTimer = setTimeout(() => {
      this.restartCount += 1;
      this.spawnProcess().catch((err) => {
        this.options.log.error('Caddy restart failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  async stop(): Promise<ProxyStatus> {
    this.clearRestartTimer();
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
      return this.status();
    }
    this.state = 'stopping';
    this.expectedExit = true;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process already gone.
        }
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill();
    });
    this.state = 'stopped';
    this.startedAt = undefined;
    return this.status();
  }

  async restart(): Promise<ProxyStatus> {
    await this.stop();
    return this.start();
  }

  /** Graceful reload through the localhost admin endpoint. */
  async reload(): Promise<ProxyStatus> {
    if (this.state !== 'running') {
      return this.start();
    }
    const validation = await this.validate();
    if (!validation.ok) {
      this.lastError = validation.output;
      throw new AppError('CADDY_CONFIG_INVALID', 'The new Caddy configuration is invalid.', {
        details: validation.output,
      });
    }
    this.state = 'reloading';
    try {
      await this.execCaddy(['reload', '--config', this.options.caddyfilePath, '--adapter', 'caddyfile']);
      this.state = 'running';
      this.options.log.info('Caddy configuration reloaded');
    } catch (err) {
      const e = err as Error & { stderr?: string };
      this.options.log.warn('Caddy reload failed; falling back to restart', {
        error: e.stderr ?? e.message,
      });
      await this.restart();
    }
    return this.status();
  }

  /**
   * Bring the process in line with the current configuration:
   * reload when running, optionally start when stopped.
   */
  async syncConfig(autoStart: boolean, hasEnabledDomains: boolean): Promise<void> {
    if (this.state === 'running' || this.state === 'reloading') {
      await this.reload();
      return;
    }
    if (autoStart && hasEnabledDomains && this.isAvailable() && this.state !== 'starting') {
      await this.start();
    }
  }
}
