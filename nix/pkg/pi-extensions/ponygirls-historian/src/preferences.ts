import { readJsonPreferences, writeJsonPreferences, sessionSetting, sessionEnabled } from '@ponygirls/pi-settings';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { object, text } from './model.ts';
import type { WorkerModel } from './worker.ts';
import { dirname, isAbsolute, join } from 'node:path';
import { acquireSessionLock } from './store.ts';

export const ENABLED_TYPE = 'historian.enabled';
export const MODEL_TYPE = 'historian.model';
export const CONSENT_TYPE = 'historian.consent';
export const FOCUS_TYPE = 'historian.focus';
export const DEFAULT_FOCUS = 'Significant research, experiments, external-system interactions, blockers and reusable discoveries.';
export interface ManagedPreferences { journalRoot: string | null; model: WorkerModel | null }
export interface Preferences { enabled: boolean; model: WorkerModel | null; focus: string; approvedModel: WorkerModel | null }
export interface StoredPreferences extends Preferences { enabledGeneration: number }
export type PreferenceField = 'enabled' | 'model' | 'focus';
export interface PreferenceOverrides { enabled?: boolean; model?: WorkerModel; focus?: string }
export interface StoredPreferenceOverrides extends PreferenceOverrides { enabledGeneration: number; approvedModel: WorkerModel | null }
export interface PreferenceOverrideUpdate { readonly set?: PreferenceOverrides; readonly unset?: readonly PreferenceField[] }
export interface DomainPreferenceMutation extends PreferenceOverrideUpdate { readonly approvedModel?: WorkerModel | null }
export interface ScopedPreferenceUpdate { readonly settings: PreferenceOverrideUpdate; readonly approvedModel: WorkerModel | null }
export interface UnmergedPreferenceSnapshot { local: StoredPreferenceOverrides | null; managed: ManagedPreferences | null }
export interface EffectivePreferences extends Preferences { enabledSource: 'session' | 'global'; modelSource: 'session' | 'global'; enabledGeneration: number | null; enabledRevision: number }
export function parseModel(value: unknown): WorkerModel {
  const model = object(value);
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(model.thinking))) throw new Error('Invalid Historian thinking level');
  return { provider: text(model.provider, 'provider', 200), id: text(model.id, 'model ID', 300), thinking: model.thinking as ThinkingLevel };
}
export function modelKey(model: WorkerModel | null): string { return JSON.stringify(model); }
const GLOBAL_PREFERENCE_FIELDS: readonly PreferenceField[] = Object.freeze(['enabled', 'model', 'focus']);
function preferenceKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown Historian preference field: ${key}`);
}
function preferenceBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Historian enabled must be a boolean');
  return value;
}
function preferenceModel(value: unknown): WorkerModel | null { return value === null ? null : parseModel(value); }
function synchronousPreferenceResult<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function') {
    void Promise.resolve(value).catch(() => undefined);
    throw new Error('Historian preference transactions require synchronous callbacks; any completed commit is not rolled back');
  }
  return value;
}
export function validatePreferenceOverrides(value: unknown): PreferenceOverrides {
  const data = object(value); preferenceKeys(data, GLOBAL_PREFERENCE_FIELDS);
  const result: PreferenceOverrides = {};
  if (Object.hasOwn(data, 'enabled')) result.enabled = preferenceBoolean(data.enabled);
  if (Object.hasOwn(data, 'model')) result.model = parseModel(data.model);
  if (Object.hasOwn(data, 'focus')) result.focus = text(data.focus, 'focus', 4000);
  return result;
}
function validatePreferenceOverrideUpdate(value: unknown): { set: PreferenceOverrides; unset: readonly PreferenceField[] } {
  const data = object(value); preferenceKeys(data, ['set', 'unset']);
  const set = Object.hasOwn(data, 'set') ? validatePreferenceOverrides(data.set) : {};
  const unset: PreferenceField[] = [];
  if (Object.hasOwn(data, 'unset')) {
    if (!Array.isArray(data.unset) || data.unset.length > GLOBAL_PREFERENCE_FIELDS.length) throw new Error('Invalid Historian unset operations');
    for (const field of data.unset) {
      if (field !== 'enabled' && field !== 'model' && field !== 'focus') throw new Error('Invalid Historian preference field');
      if (unset.includes(field)) throw new Error(`Duplicate Historian unset: ${field}`);
      if (Object.hasOwn(set, field)) throw new Error(`Historian preference cannot be set and unset: ${field}`);
      unset.push(field);
    }
  }
  return { set, unset };
}
function preferenceOverrides(local: StoredPreferenceOverrides): PreferenceOverrides {
  return validatePreferenceOverrides({
    ...(local.enabled === undefined ? {} : { enabled: local.enabled }),
    ...(local.model === undefined ? {} : { model: local.model }),
    ...(local.focus === undefined ? {} : { focus: local.focus }),
  });
}
function emptyPreferenceOverrides(): StoredPreferenceOverrides { return { enabledGeneration: 0, approvedModel: null }; }
function completePreferences(local: StoredPreferenceOverrides, managed: ManagedPreferences | null): StoredPreferences {
  return { enabled: local.enabled ?? false, enabledGeneration: local.enabledGeneration,
    model: local.model !== undefined ? parseModel(local.model) : managed === null || managed.model === null ? null : parseModel(managed.model),
    focus: local.focus ?? DEFAULT_FOCUS, approvedModel: preferenceModel(local.approvedModel) };
}
function localPreferenceDocument(raw: unknown): StoredPreferenceOverrides {
  const data = object(raw);
  if (data.version !== 1 && data.version !== 2) throw new Error('Invalid Historian defaults version');
  if (typeof data.enabledGeneration !== 'number' || !Number.isSafeInteger(data.enabledGeneration) || data.enabledGeneration < 0) throw new Error('Invalid Historian enablement generation');
  const enabledGeneration = data.enabledGeneration, approvedModel = preferenceModel(data.approvedModel);
  if (data.version === 1) return { enabled: preferenceBoolean(data.enabled), focus: text(data.focus, 'focus', 4000), enabledGeneration, approvedModel,
    ...(data.model === null ? {} : { model: parseModel(data.model) }) };
  preferenceKeys(data, ['version', 'enabled', 'model', 'focus', 'enabledGeneration', 'approvedModel']);
  const { version: _version, enabledGeneration: _generation, approvedModel: _approval, ...overrides } = data;
  if (overrides.model === null) delete overrides.model;
  return { ...validatePreferenceOverrides(overrides), enabledGeneration, approvedModel };
}
export class PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  private managed(): ManagedPreferences { return this.managedSnapshot() ?? { journalRoot: null, model: null }; }
  private managedSnapshot(): ManagedPreferences | null {
    return readJsonPreferences<ManagedPreferences | null>(join(dirname(this.path), 'historian-defaults.json'), () => null, raw => {
      const p = object(raw);
      if (p.version !== 1) throw new Error('Invalid Historian managed defaults version');
      const journalRoot = p.journalRoot === null ? null : text(p.journalRoot, 'journal root', 4096);
      if (journalRoot !== null && !isAbsolute(journalRoot)) throw new Error('Historian journal root must be absolute');
      return { journalRoot, model: p.model === null ? null : parseModel(p.model) };
    }, 'Historian managed defaults');
  }
  journalRoot(): string {
    return this.managed().journalRoot ?? join(dirname(this.path), 'historian');
  }
  read(): StoredPreferences {
    const snapshot = this.unmergedSnapshot();
    return completePreferences(snapshot.local ?? emptyPreferenceOverrides(), snapshot.managed);
  }
  readOverrides(): PreferenceOverrides { return preferenceOverrides(this.localSnapshot() ?? emptyPreferenceOverrides()); }
  unmergedSnapshot(): UnmergedPreferenceSnapshot { return { local: this.localSnapshot(), managed: this.managedSnapshot() }; }
  private localSnapshot(): StoredPreferenceOverrides | null {
    return readJsonPreferences<StoredPreferenceOverrides | null>(this.path, () => null, localPreferenceDocument, 'Historian defaults');
  }
  withDomainTransaction<T>(use: (current: StoredPreferences, overrides: Readonly<PreferenceOverrides>, commit: (mutation: DomainPreferenceMutation) => void) => T): T {
    const release = acquireSessionLock(join(dirname(this.path), 'historian'), 'global-preferences');
    let active = true, attempted = false;
    try {
      const files = this.unmergedSnapshot(), local = files.local ?? emptyPreferenceOverrides();
      const previous = completePreferences(local, files.managed), originalOverrides = preferenceOverrides(local);
      // Commit executes inside the caller's nested project lock, not after it returns.
      const commit = (raw: DomainPreferenceMutation): void => {
        if (!active) throw new Error('Historian preference commit is no longer active');
        if (attempted) throw new Error('Historian preference commit was already used');
        attempted = true;
        const data = object(raw); preferenceKeys(data, ['set', 'unset', 'approvedModel']);
        const mutation = validatePreferenceOverrideUpdate({
          ...(Object.hasOwn(data, 'set') ? { set: data.set } : {}), ...(Object.hasOwn(data, 'unset') ? { unset: data.unset } : {}),
        });
        const next = validatePreferenceOverrides({ ...originalOverrides, ...mutation.set });
        for (const field of mutation.unset) delete next[field];
        const enabledGeneration = local.enabledGeneration + ((next.enabled ?? false) === previous.enabled ? 0 : 1);
        if (!Number.isSafeInteger(enabledGeneration)) throw new Error('Historian enablement generation overflow');
        const approvedModel = Object.hasOwn(data, 'approvedModel') ? preferenceModel(data.approvedModel) : preferenceModel(local.approvedModel);
        writeJsonPreferences(this.path, { version: 2, ...next, enabledGeneration, approvedModel });
      };
      const result = use(completePreferences(local, files.managed), Object.freeze(preferenceOverrides(local)), commit);
      active = false;
      return synchronousPreferenceResult(result);
    } finally { active = false; release(); }
  }
  withSnapshot<T>(use: (current: StoredPreferences) => T): T { return this.withDomainTransaction(current => use(current)); }
  updateOverrides(change: (current: StoredPreferences, overrides: Readonly<PreferenceOverrides>) => PreferenceOverrideUpdate): void {
    this.withDomainTransaction((current, overrides, commit) => {
      const update = validatePreferenceOverrideUpdate(synchronousPreferenceResult(change(current, overrides)));
      commit(update);
    });
  }
  writeOverrides(value: PreferenceOverrides): void {
    const checked = validatePreferenceOverrides(value);
    this.updateOverrides(() => ({ set: checked, unset: GLOBAL_PREFERENCE_FIELDS.filter(field => !Object.hasOwn(checked, field)) }));
  }
  updateScoped(change: (current: StoredPreferences, overrides: Readonly<PreferenceOverrides>) => ScopedPreferenceUpdate): void {
    this.withDomainTransaction((current, overrides, commit) => {
      const plan = object(synchronousPreferenceResult(change(current, overrides))); preferenceKeys(plan, ['settings', 'approvedModel']);
      if (!Object.hasOwn(plan, 'settings') || !Object.hasOwn(plan, 'approvedModel')) throw new Error('Historian scoped domain update requires settings and approvedModel');
      const settings = validatePreferenceOverrideUpdate(plan.settings);
      commit({ ...settings, approvedModel: preferenceModel(plan.approvedModel) });
    });
  }
  write(value: Preferences): void { this.update(() => value); }
  update(change: (current: StoredPreferences) => Partial<Preferences>): void {
    this.withDomainTransaction((current, _overrides, commit) => {
      const generation = current.enabledGeneration;
      const patch = object(synchronousPreferenceResult(change(current))); preferenceKeys(patch, ['enabled', 'model', 'focus', 'approvedModel', 'enabledGeneration']);
      if (Object.hasOwn(patch, 'enabledGeneration') && patch.enabledGeneration !== generation) throw new Error('Historian enablement generation is read-only');
      const set: PreferenceOverrides = {}, unset: PreferenceField[] = [];
      if (Object.hasOwn(patch, 'enabled')) set.enabled = preferenceBoolean(patch.enabled);
      if (Object.hasOwn(patch, 'model')) { if (patch.model === null) unset.push('model'); else set.model = parseModel(patch.model); }
      if (Object.hasOwn(patch, 'focus')) set.focus = text(patch.focus, 'focus', 4000);
      commit({ set, unset, ...(Object.hasOwn(patch, 'approvedModel') ? { approvedModel: preferenceModel(patch.approvedModel) } : {}) });
    });
  }
}
export function effectivePreferences(defaults: StoredPreferences, entries: readonly SessionEntry[], sessionId: string): EffectivePreferences {
  const enabled = sessionEnabled(entries, sessionId, ENABLED_TYPE);
  const enabledRevision = sessionSetting(entries, sessionId, ENABLED_TYPE, value =>
    entries.findLastIndex(entry => entry.type === 'custom' && entry.customType === ENABLED_TYPE && entry.data === value) + 1);
  const model = sessionSetting(entries, sessionId, MODEL_TYPE, p => { const v = object(p); return v.model === null ? null : parseModel(v.model); });
  const focus = sessionSetting(entries, sessionId, FOCUS_TYPE, p => { const v = object(p); return v.focus === null ? null : text(v.focus, 'focus', 4000); });
  const consent = sessionSetting(entries, sessionId, CONSENT_TYPE, p => { const v = object(p); return { model: v.model === null ? null : parseModel(v.model) }; });
  return { enabled: enabled === null ? defaults.enabled : enabled, enabledSource: enabled === null ? 'global' : 'session', enabledGeneration: enabled === null ? defaults.enabledGeneration : null, enabledRevision: enabledRevision === null ? 0 : enabledRevision,
    model: model === null ? defaults.model : model, modelSource: model === null ? 'global' : 'session', focus: focus === null ? defaults.focus : focus,
    approvedModel: consent === null ? defaults.approvedModel : consent.model };
}
