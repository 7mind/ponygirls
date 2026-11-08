import { readJsonPreferences, writeJsonPreferences, sessionEnabled, sessionSetting } from '@ponygirls/pi-settings';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { DEFAULT_POLICY, validatePolicy, type GrowthPolicy } from './policy.ts';

export const ENABLED_TYPE = 'cuckoo.enabled';
export const THRESHOLD_TYPE = 'cuckoo.threshold';
export const POLICY_TYPE = 'cuckoo.policy';
export interface Preferences { enabled: boolean; policy: GrowthPolicy }
export interface EffectivePreferences extends Preferences { enabledSource: 'session' | 'global'; policySource: 'session' | 'global' }
export const DEFAULT_PREFERENCES: Readonly<Preferences> = { enabled: false, policy: DEFAULT_POLICY };
export interface PreferenceStore { readonly path: string; read(): Preferences; write(value: Preferences): void }

function validatePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null || !('version' in value) || !('enabled' in value) || typeof value.enabled !== 'boolean') throw new Error('Invalid Cuckoo defaults');
  if (value.version === 1 && 'thresholdPercent' in value) return { enabled: value.enabled, policy: validatePolicy({ kind: 'relative', value: value.thresholdPercent }) };
  if (value.version !== 2 || !('policy' in value)) throw new Error('Invalid Cuckoo defaults version/policy');
  return { enabled: value.enabled, policy: validatePolicy(value.policy) };
}
export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): Preferences { return readJsonPreferences(this.path, () => ({ ...DEFAULT_PREFERENCES, policy: { ...DEFAULT_POLICY } }), validatePreferences, 'Cuckoo defaults'); }
  write(value: Preferences): void { writeJsonPreferences(this.path, { version: 2, ...validatePreferences({ ...value, version: 2 }) }); }
}
export function effectivePreferences(defaults: Preferences, entries: readonly SessionEntry[], sessionId: string): EffectivePreferences {
  const enabled = sessionEnabled(entries, sessionId, ENABLED_TYPE);
  const policyEntries = entries.map(entry => {
    if (entry.type !== 'custom' || entry.customType !== THRESHOLD_TYPE) return entry;
    const data: unknown = entry.data;
    const migrated = typeof data === 'object' && data !== null && 'thresholdPercent' in data
      ? { ...data, policy: data.thresholdPercent === null ? null : { kind: 'relative', value: data.thresholdPercent } } : data;
    return { ...entry, customType: POLICY_TYPE, data: migrated };
  });
  const policy = sessionSetting(policyEntries, sessionId, POLICY_TYPE, value => {
    if (!('policy' in value)) throw new Error('Invalid Cuckoo session policy');
    return value.policy === null ? null : validatePolicy(value.policy);
  });
  return { enabled: enabled === null ? defaults.enabled : enabled, policy: policy === null ? defaults.policy : policy,
    enabledSource: enabled === null ? 'global' : 'session', policySource: policy === null ? 'global' : 'session' };
}
