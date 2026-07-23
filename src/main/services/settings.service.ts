import { appSettingsSchema } from '../../shared/schemas';
import { AppError } from '../../shared/errors';
import type { AppSettings } from '../../shared/types';
import type { SettingsRepository } from '../repositories/settings.repository';
import type { CategoryLogger } from './logger.service';

const SETTINGS_KEY = 'app';

export class SettingsService {
  private cache: AppSettings | null = null;

  constructor(
    private readonly repo: SettingsRepository,
    private readonly log: CategoryLogger,
  ) {}

  get(): AppSettings {
    if (this.cache) return this.cache;
    const stored = this.repo.getAll()[SETTINGS_KEY];
    const parsed = appSettingsSchema.safeParse(stored ?? {});
    if (!parsed.success) {
      this.log.warn('Stored settings invalid; using defaults', {
        issues: parsed.error.issues.map((i) => i.message).join('; '),
      });
      this.cache = appSettingsSchema.parse({});
    } else {
      this.cache = parsed.data;
    }
    return this.cache;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const merged = { ...this.get(), ...patch };
    const parsed = appSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid settings.', {
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    this.repo.set(SETTINGS_KEY, parsed.data);
    this.cache = parsed.data;
    this.log.info('Settings updated', { keys: Object.keys(patch).join(',') });
    return parsed.data;
  }
}
