/**
 * IPC hardening: every handler is registered through `IpcRegistrar`,
 * which enforces (1) the channel allowlist, (2) sender validation,
 * (3) Zod payload validation, and (4) a structured IpcResult envelope so
 * raw errors and stack traces never cross the bridge.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import { ALL_IPC_CHANNELS } from '../../shared/constants';
import { AppError, fail, ok, type IpcResult } from '../../shared/errors';
import { ipcPayloadSchemas, type IpcPayloadSchemas } from '../../shared/schemas';
import type { CategoryLogger } from '../services/logger.service';

type ChannelName = keyof IpcPayloadSchemas;
type PayloadOf<C extends ChannelName> = z.infer<IpcPayloadSchemas[C]>;

export class IpcRegistrar {
  private readonly registered = new Set<string>();

  constructor(
    private readonly log: CategoryLogger,
    private readonly isTrustedSender: (sender: WebContents) => boolean,
  ) {}

  handle<C extends ChannelName>(
    channel: C,
    handler: (payload: PayloadOf<C>) => Promise<unknown> | unknown,
  ): void {
    if (!ALL_IPC_CHANNELS.includes(channel)) {
      throw new Error(`Refusing to register non-allowlisted IPC channel: ${channel}`);
    }
    if (this.registered.has(channel)) {
      throw new Error(`IPC channel registered twice: ${channel}`);
    }
    this.registered.add(channel);

    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown): Promise<IpcResult<unknown>> => {
      if (!this.isTrustedSender(event.sender)) {
        this.log.warn('Rejected IPC call from untrusted sender', { channel });
        return fail(new AppError('IPC_CHANNEL_DENIED', 'Request rejected.'));
      }

      const schema = ipcPayloadSchemas[channel];
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        this.log.warn('Rejected invalid IPC payload', {
          channel,
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        return fail(
          new AppError('IPC_INVALID_PAYLOAD', 'Invalid request.', {
            details: parsed.error.issues
              .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('\n'),
          }),
        );
      }

      try {
        return ok(await handler(parsed.data as PayloadOf<C>));
      } catch (err) {
        if (err instanceof AppError) {
          this.log.warn(`IPC ${channel} failed: ${err.code}`, { message: err.message });
        } else {
          this.log.error(`IPC ${channel} crashed`, {
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          });
        }
        return fail(err);
      }
    });
  }
}
