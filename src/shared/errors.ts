/** Structured application errors shared between main and renderer. */

export const ERROR_CODES = [
  'HOSTS_PERMISSION_DENIED',
  'HOSTS_WRITE_FAILED',
  'HOSTS_CONFLICT',
  'CADDY_BINARY_MISSING',
  'CADDY_START_FAILED',
  'CADDY_CONFIG_INVALID',
  'CADDY_RELOAD_FAILED',
  'CADDY_PORT_CONFLICT',
  'MKCERT_BINARY_MISSING',
  'MKCERT_INSTALL_FAILED',
  'CERTIFICATE_GENERATION_FAILED',
  'CERTIFICATE_NOT_TRUSTED',
  'DOMAIN_INVALID',
  'DOMAIN_DUPLICATE',
  'DOMAIN_NOT_FOUND',
  'TARGET_UNREACHABLE',
  'TARGET_CIRCULAR',
  'DATABASE_ERROR',
  'PRIVILEGE_REQUIRED',
  'IPC_INVALID_PAYLOAD',
  'IPC_CHANNEL_DENIED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Serializable shape sent over IPC. Never contains a raw stack trace. */
export interface AppErrorShape {
  code: ErrorCode;
  /** User-friendly message, safe to display directly. */
  message: string;
  /** Expandable technical details for the "show details" UI. */
  details?: string;
  /** What the user can do about it. */
  suggestion?: string;
  /** Whether retrying the same action may succeed. */
  retryable: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;
  readonly suggestion?: string;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: string;
      suggestion?: string;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.suggestion = options.suggestion;
    this.retryable = options.retryable ?? false;
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      suggestion: this.suggestion,
      retryable: this.retryable,
    };
  }
}

/** Convert any thrown value into a safe serializable error shape. */
export function toErrorShape(err: unknown): AppErrorShape {
  if (err instanceof AppError) return err.toShape();
  if (err instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: `${err.name}: ${err.message}`,
      retryable: false,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    details: String(err),
    retryable: false,
  };
}

/** Result envelope returned by every IPC handler. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(err: unknown): IpcResult<T> {
  return { ok: false, error: toErrorShape(err) };
}
