import { join } from 'node:path';
import { readJsonPreferences, writeJsonPreferences } from '@ponygirls/pi-settings';
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { DEFAULT_POLICY, validatePolicy, type GrowthPolicy } from './policy.ts';
import { DEFAULT_FEATURES, FEATURES, featureId, type FeatureId, type FeatureSwitches } from './features.ts';

export const ENABLED_TYPE = 'cuckoo.enabled';
export const THRESHOLD_TYPE = 'cuckoo.threshold';
export const POLICY_TYPE = 'cuckoo.policy';
export const PREFERENCES_TYPE = 'cuckoo.preferences';
export const FEATURE_TYPE_PREFIX = 'cuckoo.feature.';
export type PreferenceSource = 'default' | 'global' | 'project' | 'session';
export type PreferenceScope = Exclude<PreferenceSource, 'default'>;
export interface Preferences { enabled: boolean; policy: GrowthPolicy; features: FeatureSwitches }
export interface PreferenceOverrides { enabled?: boolean; policy?: GrowthPolicy; features?: Partial<Record<FeatureId, boolean>> }
export interface EffectivePreferences extends Preferences {
  enabledSource: PreferenceSource;
  policySource: PreferenceSource;
  featureSources: Readonly<Record<FeatureId, PreferenceSource>>;
}
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({ enabled: false, policy: DEFAULT_POLICY, features: DEFAULT_FEATURES });
export interface PreferenceStore { readonly path: string; read(): PreferenceOverrides; write(value: PreferenceOverrides): void }
export type PreferenceChange =
  | { readonly field: 'enabled'; readonly value: boolean | null }
  | { readonly field: 'policy'; readonly value: GrowthPolicy | null }
  | { readonly field: 'feature'; readonly id: FeatureId; readonly value: boolean | null };
export type PreferenceContext = Pick<ExtensionContext, 'cwd' | 'isProjectTrusted' | 'sessionManager'>;
export interface PreferenceLayers {
  global: PreferenceOverrides;
  project: PreferenceOverrides;
  session: PreferenceOverrides;
}
export interface PreferenceSnapshot extends PreferenceLayers {
  effective: EffectivePreferences;
  projectTrusted: boolean;
  paths: Readonly<Record<PreferenceScope, string>>;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Cuckoo preference object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown Cuckoo preference field: ${key}`);
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Cuckoo switches must be booleans');
  return value;
}
function policy(value: unknown): GrowthPolicy {
  keys(object(value), ['kind', 'value']);
  return validatePolicy(value);
}

export function validateOverrides(value: unknown): PreferenceOverrides {
  const data = object(value); keys(data, ['enabled', 'policy', 'features']);
  const result: PreferenceOverrides = {};
  if ('enabled' in data) result.enabled = boolean(data.enabled);
  if ('policy' in data) result.policy = policy(data.policy);
  if ('features' in data) {
    const features = object(data.features);
    result.features = {};
    for (const [key, value] of Object.entries(features)) result.features[featureId(key)] = boolean(value);
  }
  return result;
}

function validateFile(value: unknown): PreferenceOverrides {
  const data = object(value);
  if (data.version === 1) {
    keys(data, ['version', 'enabled', 'thresholdPercent']);
    return { enabled: boolean(data.enabled), policy: validatePolicy({ kind: 'relative', value: data.thresholdPercent }) };
  }
  if (data.version === 2) {
    keys(data, ['version', 'enabled', 'policy']);
    return { enabled: boolean(data.enabled), policy: policy(data.policy) };
  }
  if (data.version !== 3) throw new Error('Invalid Cuckoo preferences version');
  const { version: _version, ...overrides } = data;
  return validateOverrides(overrides);
}

export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): PreferenceOverrides { return readJsonPreferences(this.path, () => ({}), validateFile, 'Cuckoo preferences'); }
  write(value: PreferenceOverrides): void { writeJsonPreferences(this.path, { version: 3, ...validateOverrides(value) }); }
}

export function changeKey(change: PreferenceChange): string { return change.field === 'feature' ? `feature:${change.id}` : change.field; }

export function validateChanges(value: unknown): readonly PreferenceChange[] {
  if (!Array.isArray(value) || value.length > FEATURES.length + 2) throw new Error('Invalid Cuckoo preference changes');
  const seen = new Set<string>();
  return value.map(raw => {
    const data = object(raw);
    let change: PreferenceChange;
    if (data.field === 'feature') {
      keys(data, ['field', 'id', 'value']);
      if (typeof data.id !== 'string') throw new Error('Invalid Cuckoo feature ID');
      change = { field: 'feature', id: featureId(data.id), value: data.value === null ? null : boolean(data.value) };
    } else if (data.field === 'enabled') {
      keys(data, ['field', 'value']);
      change = { field: 'enabled', value: data.value === null ? null : boolean(data.value) };
    } else if (data.field === 'policy') {
      keys(data, ['field', 'value']);
      change = { field: 'policy', value: data.value === null ? null : policy(data.value) };
    } else throw new Error('Invalid Cuckoo preference change');
    const key = changeKey(change);
    if (seen.has(key)) throw new Error('Duplicate Cuckoo preference change');
    seen.add(key);
    return change;
  });
}

export function applyPreferenceChanges(overrides: PreferenceOverrides, changes: readonly PreferenceChange[]): PreferenceOverrides {
  const result = validateOverrides(overrides);
  for (const change of validateChanges(changes)) {
    if (change.field === 'enabled') {
      if (change.value === null) delete result.enabled; else result.enabled = change.value;
    } else if (change.field === 'policy') {
      if (change.value === null) delete result.policy; else result.policy = change.value;
    } else {
      const features = { ...result.features };
      if (change.value === null) delete features[change.id]; else features[change.id] = change.value;
      if (Object.keys(features).length === 0) delete result.features; else result.features = features;
    }
  }
  return result;
}

export function sessionPreferences(entries: readonly SessionEntry[], sessionId: string): PreferenceOverrides {
  let result: PreferenceOverrides = {};
  const resolved = new Set<string>();
  function accept(raw: unknown, key: string): void {
    if (resolved.has(key)) return;
    result = applyPreferenceChanges(result, validateChanges([raw]));
    resolved.add(key);
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (resolved.size === FEATURES.length + 2) break;
    const entry = entries[i];
    if (entry.type !== 'custom' || !(entry.customType === ENABLED_TYPE || entry.customType === POLICY_TYPE ||
      entry.customType === THRESHOLD_TYPE || entry.customType === PREFERENCES_TYPE || entry.customType.startsWith(FEATURE_TYPE_PREFIX))) continue;
    const key = entry.customType === PREFERENCES_TYPE ? null : entry.customType === ENABLED_TYPE ? 'enabled' :
      entry.customType.startsWith(FEATURE_TYPE_PREFIX) ? `feature:${entry.customType.slice(FEATURE_TYPE_PREFIX.length)}` : 'policy';
    if (key !== null && resolved.has(key)) continue;
    const data = object(entry.data);
    if (typeof data.sessionId !== 'string') throw new Error('Invalid Cuckoo session setting: missing sessionId');
    if (data.sessionId !== sessionId) continue;
    if (data.version !== 1) throw new Error('Invalid Cuckoo session setting version');
    if (entry.customType === PREFERENCES_TYPE) {
      keys(data, ['version', 'sessionId', 'changes']);
      if (!Array.isArray(data.changes) || data.changes.length > FEATURES.length + 2) throw new Error('Invalid Cuckoo preference changes');
      const batch = new Set<string>();
      for (const raw of data.changes) {
        const change = object(raw);
        const key = change.field === 'enabled' || change.field === 'policy' ? change.field :
          change.field === 'feature' && typeof change.id === 'string' ? `feature:${featureId(change.id)}` : null;
        if (key === null || batch.has(key)) throw new Error('Invalid or duplicate Cuckoo preference change');
        batch.add(key); accept(raw, key);
      }
    } else if (entry.customType === ENABLED_TYPE) {
      accept({ field: 'enabled', value: data.enabled }, 'enabled');
    } else if (entry.customType.startsWith(FEATURE_TYPE_PREFIX)) {
      const id = featureId(entry.customType.slice(FEATURE_TYPE_PREFIX.length));
      accept({ field: 'feature', id, value: data.enabled }, `feature:${id}`);
    } else {
      const value = entry.customType === POLICY_TYPE ? data.policy : data.thresholdPercent === null ? null : { kind: 'relative', value: data.thresholdPercent };
      accept({ field: 'policy', value }, 'policy');
    }
  }
  return result;
}

function resolve<T>(fallback: T, global: T | undefined, project: T | undefined, session: T | undefined): { value: T; source: PreferenceSource } {
  if (session !== undefined) return { value: session, source: 'session' };
  if (project !== undefined) return { value: project, source: 'project' };
  if (global !== undefined) return { value: global, source: 'global' };
  return { value: fallback, source: 'default' };
}

export function resolvePreferences(layers: PreferenceLayers): EffectivePreferences {
  const global = validateOverrides(layers.global), project = validateOverrides(layers.project), session = validateOverrides(layers.session);
  const enabled = resolve(DEFAULT_PREFERENCES.enabled, global.enabled, project.enabled, session.enabled);
  const growth = resolve(DEFAULT_POLICY, global.policy, project.policy, session.policy);
  const features = { ...DEFAULT_FEATURES };
  const featureSources: Record<FeatureId, PreferenceSource> = { evidence: 'default', corrections: 'default', verifiers: 'default', reader: 'default', transfer: 'default', vectors: 'default', critic: 'default' };
  for (const { id } of FEATURES) {
    const setting = resolve(DEFAULT_FEATURES[id], global.features === undefined ? undefined : global.features[id],
      project.features === undefined ? undefined : project.features[id], session.features === undefined ? undefined : session.features[id]);
    features[id] = setting.value; featureSources[id] = setting.source;
  }
  return { enabled: enabled.value, policy: growth.value, features, enabledSource: enabled.source, policySource: growth.source, featureSources };
}

export function effectivePreferences(global: PreferenceOverrides, project: PreferenceOverrides, entries: readonly SessionEntry[], sessionId: string): EffectivePreferences {
  return resolvePreferences({ global, project, session: sessionPreferences(entries, sessionId) });
}

export function throughScope(layers: PreferenceLayers, scope: PreferenceScope): EffectivePreferences {
  return resolvePreferences({ global: layers.global, project: scope === 'global' ? {} : layers.project, session: scope === 'session' ? layers.session : {} });
}

export class CuckooPreferences {
  private readonly pi: Pick<ExtensionAPI, 'appendEntry'>;
  private readonly global: PreferenceStore;
  private readonly projectStore: (path: string) => PreferenceStore;
  constructor(pi: Pick<ExtensionAPI, 'appendEntry'>, global: PreferenceStore, projectStore: (path: string) => PreferenceStore) {
    this.pi = pi; this.global = global; this.projectStore = projectStore;
  }
  read(ctx: PreferenceContext): PreferenceSnapshot {
    const path = join(ctx.cwd, CONFIG_DIR_NAME, 'cuckoo.json');
    const projectTrusted = ctx.isProjectTrusted();
    const layers = { global: this.global.read(), project: projectTrusted ? this.projectStore(path).read() : {},
      session: sessionPreferences(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId()) };
    return { ...layers, effective: resolvePreferences(layers), projectTrusted,
      paths: { global: this.global.path, project: path, session: ctx.sessionManager.getSessionId() } };
  }
  apply(ctx: PreferenceContext, scope: PreferenceScope, changes: readonly PreferenceChange[], signal: AbortSignal): void {
    signal.throwIfAborted();
    const sessionId = ctx.sessionManager.getSessionId(), cwd = ctx.cwd;
    const current = () => {
      if (scope === 'project' && !ctx.isProjectTrusted()) throw new Error('Project settings require a trusted project');
      if (ctx.cwd !== cwd || ctx.sessionManager.getSessionId() !== sessionId) throw new Error('Cuckoo settings target changed');
      signal.throwIfAborted();
    };
    const checked = validateChanges(changes);
    if (checked.length === 0) return;
    if (scope === 'session') {
      current();
      this.pi.appendEntry(PREFERENCES_TYPE, { version: 1, sessionId, changes: checked });
    } else if (scope === 'global') {
      const next = applyPreferenceChanges(this.global.read(), checked);
      current();
      this.global.write(next);
    } else if (scope === 'project') {
      if (!ctx.isProjectTrusted()) throw new Error('Project settings require a trusted project');
      const store = this.projectStore(join(cwd, CONFIG_DIR_NAME, 'cuckoo.json'));
      const next = applyPreferenceChanges(store.read(), checked);
      current();
      store.write(next);
    } else throw new Error('Invalid Cuckoo preference scope');
  }
}
