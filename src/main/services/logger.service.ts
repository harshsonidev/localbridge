import path from 'node:path';
import log from 'electron-log/main';

export type LogCategory =
  | 'app'
  | 'database'
  | 'domains'
  | 'hosts'
  | 'caddy'
  | 'certificates'
  | 'ipc'
  | 'privilege'
  | 'config'
  | 'system';

export interface CategoryLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Keys that must never appear in logs, even inside metadata objects. */
const REDACTED_KEYS = /authorization|cookie|set-cookie|password|secret|token|api[-_]?key|private[-_]?key/i;

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED_KEYS.test(key)) {
      clean[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeMeta(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export function initializeLogging(logsDir: string): void {
  log.initialize();
  log.transports.file.resolvePathFn = () => path.join(logsDir, 'localbridge.log');
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // {scope} renders as " (name)" with its own parentheses and padding.
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}';
}

export function createLogger(category: LogCategory): CategoryLogger {
  const scoped = log.scope(category);
  const emit =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, meta?: Record<string, unknown>): void => {
      if (meta && Object.keys(meta).length > 0) {
        scoped[level](message, JSON.stringify(sanitizeMeta(meta)));
      } else {
        scoped[level](message);
      }
    };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}
