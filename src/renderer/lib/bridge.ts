import type { AppErrorShape, IpcResult } from '../../shared/errors';

/** Error carrying the structured shape produced by the main process. */
export class BridgeError extends Error {
  constructor(readonly shape: AppErrorShape) {
    super(shape.message);
    this.name = 'BridgeError';
  }
}

/** Unwrap an IpcResult, throwing a BridgeError on failure. */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new BridgeError(result.error);
  return result.data;
}

export function errorMessage(err: unknown): string {
  if (err instanceof BridgeError) return err.shape.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function errorDetails(err: unknown): string | undefined {
  if (err instanceof BridgeError) {
    const parts = [err.shape.details, err.shape.suggestion].filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  return undefined;
}
