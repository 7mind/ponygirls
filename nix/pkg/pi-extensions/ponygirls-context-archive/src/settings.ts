import { join } from 'node:path';
import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ScopedSettingsController, scopedBooleanField, resolveScopedSetting, type ScopedSettingsScope, type ScopedSettingsOrigin, type ScopedSettingsSnapshot, type ScopedSettingChange } from '@ponygirls/pi-settings';
import { ScopedSettingsView } from '@ponygirls/pi-ui';
import { DEFAULT_PREFERENCES, validateThresholds, type PreferenceStore, type ArchiveProjectStore, type ArchiveValues } from './preferences.ts';
import { SESSION_PREFERENCES_TYPE, sessionOverrideFields, validateArchiveChanges, applyArchiveChanges } from './session-settings.ts';

type Context = Pick<ExtensionContext, 'cwd' | 'isProjectTrusted' | 'sessionManager'>;
export interface ArchiveSettingsSnapshot extends ScopedSettingsSnapshot<ArchiveValues> {
  readonly values: ArchiveValues;
  readonly sources: Readonly<Record<keyof ArchiveValues, ScopedSettingsOrigin>>;
}
export class ArchiveSettings {
  private readonly pi: Pick<ExtensionAPI, 'appendEntry'>;
  private readonly global: PreferenceStore;
  private readonly projects: (path: string) => ArchiveProjectStore;
  constructor(pi: Pick<ExtensionAPI, 'appendEntry'>, global: PreferenceStore, projects: (path: string) => ArchiveProjectStore) {
    this.pi = pi; this.global = global; this.projects = projects;
  }
  read(ctx: Context): ArchiveSettingsSnapshot {
    const path = join(ctx.cwd, CONFIG_DIR_NAME, 'context-archive.json');
    const projectTrusted = ctx.isProjectTrusted();
    if (typeof projectTrusted !== 'boolean') throw new Error('Project trust unavailable');
    const sessionId = ctx.sessionManager.getSessionId();
    const snapshot = { defaults: { enabled: DEFAULT_PREFERENCES.enabled, thresholds: validateThresholds(DEFAULT_PREFERENCES) }, managed: {},
      global: this.global.readOverrides(), project: projectTrusted ? this.projects(path).read() : {}, session: sessionOverrideFields(ctx.sessionManager.getEntries(), sessionId), projectTrusted,
      targets: { global: this.global.path, project: path, session: sessionId } };
    const enabled = resolveScopedSetting(snapshot, 'enabled', 'effective');
    const thresholds = resolveScopedSetting(snapshot, 'thresholds', 'effective');
    return { ...snapshot, values: { enabled: enabled.value, thresholds: thresholds.value }, sources: { enabled: enabled.origin, thresholds: thresholds.origin } };
  }
  apply(ctx: Context, scope: ScopedSettingsScope, changes: readonly ScopedSettingChange<ArchiveValues>[], signal: AbortSignal): void {
    signal.throwIfAborted();
    const checked = validateArchiveChanges(changes), sessionId = ctx.sessionManager.getSessionId(), cwd = ctx.cwd;
    const current = (): void => {
      signal.throwIfAborted();
      if (ctx.sessionManager.getSessionId() !== sessionId || ctx.cwd !== cwd) throw new Error('Archive settings target changed');
      if (scope === 'project' && ctx.isProjectTrusted() !== true) throw new Error('Project settings require a trusted project');
    };
    current(); if (checked.length === 0) return;
    if (scope === 'session') { this.pi.appendEntry(SESSION_PREFERENCES_TYPE, { version: 1, sessionId, changes: checked }); return; }
    if (scope === 'global') { const next = applyArchiveChanges(this.global.readOverrides(), checked); current(); this.global.writeOverrides(next); return; }
    if (scope !== 'project') throw new Error('Unknown settings scope');
    const store = this.projects(join(cwd, CONFIG_DIR_NAME, 'context-archive.json'));
    const next = applyArchiveChanges(store.read(), checked); current(); store.write(next);
  }
}

export function createArchiveSettingsController(configuration: ArchiveSettings, ctx: ExtensionContext, applied: () => void): ScopedSettingsController<ArchiveValues> {
  return new ScopedSettingsController<ArchiveValues>({
    fields: {
      enabled: scopedBooleanField('Automatic context archival', 'Selectively archive visible context at completed boundaries. Recall of retained history remains available while off.'),
      thresholds: {
        kind: 'value', label: 'Archive watermarks', description: 'High/low watermarks form one indivisible setting; percentages satisfy 0 <= low < high <= 100.',
        decode: validateThresholds,
        equals: (left, right) => left.highWatermark === right.highWatermark && left.lowWatermark === right.lowWatermark,
        format: value => `${value.highWatermark * 100}% high / ${value.lowWatermark * 100}% low`,
        async edit(request) {
          const value = await ctx.ui.input('Archive high and low percentages', `${request.value.highWatermark * 100} ${request.value.lowWatermark * 100}`, { signal: request.signal });
          if (value === undefined || request.signal.aborted) return { kind: 'cancel' };
          const words = value.trim().split(/\s+/);
          if (words.length !== 2 || !words.every(word => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(word))) throw new Error('Enter HIGH LOW percentages');
          return { kind: 'set', value: validateThresholds({ highWatermark: Number(words[0]) / 100, lowWatermark: Number(words[1]) / 100 }) };
        },
      },
    },
    order: ['enabled', 'thresholds'], inactive: () => '',
    adapter: { read: () => configuration.read(ctx), apply: (scope, changes, signal) => configuration.apply(ctx, scope, changes, signal), applied: () => applied() },
  });
}
export function newArchiveSettingsView(): ScopedSettingsView { return new ScopedSettingsView(); }
