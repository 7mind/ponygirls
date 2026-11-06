import { readJsonPreferences, writeJsonPreferences, sessionSetting, sessionEnabled } from '@ponygirls/pi-settings';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import { object, text } from './model.ts';
import type { WorkerModel } from './worker.ts';
import { dirname, join } from 'node:path';
import { acquireSessionLock } from './store.ts';

export const ENABLED_TYPE = 'historian.enabled';
export const MODEL_TYPE = 'historian.model';
export const CONSENT_TYPE = 'historian.consent';
export const FOCUS_TYPE = 'historian.focus';
export const DEFAULT_FOCUS = 'Significant research, experiments, external-system interactions, blockers and reusable discoveries.';
export interface Preferences { enabled: boolean; model: WorkerModel | null; focus: string; approvedModel: WorkerModel | null }
export interface StoredPreferences extends Preferences { enabledGeneration: number }
export interface EffectivePreferences extends Preferences { enabledSource: 'session' | 'global'; modelSource: 'session' | 'global'; enabledGeneration: number | null; enabledRevision: number }
export function parseModel(value: unknown): WorkerModel {
  const model = object(value);
  if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(model.thinking))) throw new Error('Invalid Historian thinking level');
  return { provider: text(model.provider, 'provider', 200), id: text(model.id, 'model ID', 300), thinking: model.thinking as ThinkingLevel };
}
export function modelKey(model: WorkerModel | null): string { return JSON.stringify(model); }
export class PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): StoredPreferences {
    return readJsonPreferences(this.path, () => ({ enabled: false, enabledGeneration: 0, model: null, focus: DEFAULT_FOCUS, approvedModel: null }), raw => {
      const p = object(raw);
      if (p.version !== 1 || typeof p.enabled !== 'boolean' || !Number.isSafeInteger(p.enabledGeneration) || (p.enabledGeneration as number) < 0) throw new Error('Invalid Historian defaults version/enabled/generation');
      return { enabled: p.enabled, enabledGeneration: p.enabledGeneration as number, model: p.model === null ? null : parseModel(p.model), focus: text(p.focus, 'focus', 4000),
        approvedModel: p.approvedModel === null ? null : parseModel(p.approvedModel) };
    }, 'Historian defaults');
  }
  write(value: Preferences): void { this.update(() => value); }
  withSnapshot<T>(use: (current: StoredPreferences) => T): T {
    const release = acquireSessionLock(join(dirname(this.path), 'historian'), 'global-preferences');
    try { return use(this.read()); } finally { release(); }
  }
  update(change: (current: StoredPreferences) => Preferences): void {
    this.withSnapshot(previous => {
      const value = change(previous);
      const enabledGeneration = previous.enabledGeneration + (value.enabled === previous.enabled ? 0 : 1);
      if (!Number.isSafeInteger(enabledGeneration)) throw new Error('Historian enablement generation overflow');
      writeJsonPreferences(this.path, { version: 1, ...value, enabledGeneration });
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
