import { SettingsPatchSchema, SettingsSchema, type Settings } from '@shared/schemas/settings';
import { AppError } from '@shared/errors';
import type { Db } from '../connection';

/** Settings are stored as one validated JSON document. Invalid stored values fall back to defaults field-by-field. */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(): Settings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key='app'`).get() as { value: string } | undefined;
    if (!row) return SettingsSchema.parse({});
    let raw: unknown;
    try { raw = JSON.parse(row.value); } catch { return SettingsSchema.parse({}); }
    const full = SettingsSchema.safeParse(raw);
    if (full.success) return full.data;
    // Keep every individually-valid field; drop only the broken ones.
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (SettingsPatchSchema.safeParse({ [k]: v }).success) kept[k] = v;
    return SettingsSchema.parse(kept);
  }

  update(patch: unknown, now = Date.now()): Settings {
    const parsed = SettingsPatchSchema.safeParse(patch);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', `Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const next = SettingsSchema.parse({ ...this.get(), ...parsed.data });
    this.db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES ('app',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(JSON.stringify(next), now);
    return next;
  }
}
