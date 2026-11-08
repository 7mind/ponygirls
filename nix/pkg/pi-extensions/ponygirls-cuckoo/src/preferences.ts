import { readJsonPreferences, writeJsonPreferences, sessionEnabled, sessionSetting } from '@ponygirls/pi-settings';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const ENABLED_TYPE = 'cuckoo.enabled';
export const THRESHOLD_TYPE = 'cuckoo.threshold';
export interface Preferences { enabled: boolean; thresholdPercent: number }
export interface EffectivePreferences extends Preferences { enabledSource: 'session' | 'global'; thresholdSource: 'session' | 'global' }
export const DEFAULT_PREFERENCES: Readonly<Preferences> = { enabled: false, thresholdPercent: 15 };
export interface PreferenceStore { readonly path: string; read(): Preferences; write(value: Preferences): void }

export function validateThresholdPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) throw new Error('Cuckoo threshold must be a finite percentage greater than 0 and at most 100');
  return value;
}
function validatePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('enabled' in value) || typeof value.enabled !== 'boolean' || !('thresholdPercent' in value)) throw new Error('Invalid Cuckoo defaults');
  return { enabled: value.enabled, thresholdPercent: validateThresholdPercent(value.thresholdPercent) };
}
export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): Preferences { return readJsonPreferences(this.path, () => ({ ...DEFAULT_PREFERENCES }), validatePreferences, 'Cuckoo defaults'); }
  write(value: Preferences): void { writeJsonPreferences(this.path, { version: 1, ...validatePreferences({ ...value, version: 1 }) }); }
}
export function effectivePreferences(defaults: Preferences, entries: readonly SessionEntry[], sessionId: string): EffectivePreferences {
  const enabled = sessionEnabled(entries, sessionId, ENABLED_TYPE);
  const threshold = sessionSetting(entries, sessionId, THRESHOLD_TYPE, value => {
    if (!('thresholdPercent' in value)) throw new Error('Invalid Cuckoo session threshold');
    return value.thresholdPercent === null ? null : validateThresholdPercent(value.thresholdPercent);
  });
  return { enabled: enabled === null ? defaults.enabled : enabled, thresholdPercent: threshold === null ? defaults.thresholdPercent : threshold,
    enabledSource: enabled === null ? 'global' : 'session', thresholdSource: threshold === null ? 'global' : 'session' };
}
