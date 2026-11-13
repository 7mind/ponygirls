import type {
  ScopedSettingChange,
  ScopedSettingsScope,
  ScopedSettingsSnapshot,
} from '@ponygirls/pi-settings';
import {
  resolveScopedSetting,
  sessionEnabled,
  sessionSetting,
} from '@ponygirls/pi-settings';
import {
  DEFAULT_FOCUS,
  ENABLED_TYPE,
  FOCUS_TYPE,
  MODEL_TYPE,
  parseModel,
  type PreferenceField,
  type PreferenceOverrides,
  type UnmergedPreferenceSnapshot,
} from './preferences.ts';
import { object, text } from './model.ts';
import {
  projectOverrides,
  validateProjectChanges,
  type ConfigurationContext,
  type ProjectChange,
  type ScopedConfiguration,
} from './project-config.ts';
import type { WorkerModel } from './worker.ts';

export interface HistorianValues {
  enabled: boolean;
  model: WorkerModel | null;
  focus: string;
}

export const HISTORIAN_SETTINGS_ORDER:
  readonly ['enabled', 'model', 'focus'] =
  ['enabled', 'model', 'focus'];

export interface HistorianSettingsSnapshot
  extends ScopedSettingsSnapshot<HistorianValues> {
  readonly runtimeRequested: boolean;
  readonly runtimeApproved: boolean;
  readonly runtimeSource: 'global' | 'project' | 'session';
  readonly managedJournalRoot: string | null;
  readonly configuredJournalRoot: string;
  readonly boundaryKey: string;
}

export function checkedHistorianChanges(
  raw: unknown,
): readonly ProjectChange[] {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'key' in item &&
        item.key === 'model' &&
        'op' in item &&
        item.op === 'set' &&
        'value' in item &&
        item.value === null
      ) {
        throw new Error(
          'Historian model set requires a complete model; use inherit to reset',
        );
      }
    }
  }
  return validateProjectChanges(raw);
}

export function sessionHistorianOverrides(
  ctx: ConfigurationContext,
): PreferenceOverrides {
  const entries = ctx.sessionManager.getEntries();
  const sessionId = ctx.sessionManager.getSessionId();
  const result: PreferenceOverrides = {};

  const enabled = sessionEnabled(entries, sessionId, ENABLED_TYPE);
  if (enabled !== null) result.enabled = enabled;

  const model = sessionSetting(
    entries,
    sessionId,
    MODEL_TYPE,
    raw => {
      const value = object(raw);
      return value.model === null ? null : parseModel(value.model);
    },
  );
  if (model !== null) result.model = model;

  const focus = sessionSetting(
    entries,
    sessionId,
    FOCUS_TYPE,
    raw => {
      const value = object(raw);
      return value.focus === null
        ? null
        : text(value.focus, 'focus', 4000);
    },
  );
  if (focus !== null) result.focus = focus;

  return result;
}

export function copyHistorianOverrides(
  original: Readonly<PreferenceOverrides>,
): PreferenceOverrides {
  const result: PreferenceOverrides = {};
  if (original.enabled !== undefined) {
    result.enabled = original.enabled;
  }
  if (original.model !== undefined) {
    result.model = parseModel(original.model);
  }
  if (original.focus !== undefined) {
    result.focus = text(original.focus, 'focus', 4000);
  }
  return result;
}

export function changedHistorianOverrides(
  original: Readonly<PreferenceOverrides>,
  changes: readonly ProjectChange[],
): PreferenceOverrides {
  const next = copyHistorianOverrides(original);
  for (const change of changes) {
    if (change.op === 'inherit') {
      delete next[change.key];
    } else if (change.key === 'enabled') {
      next.enabled = change.value;
    } else if (change.key === 'model') {
      next.model = parseModel(change.value);
    } else {
      next.focus = change.value;
    }
  }
  return next;
}

export function historianSparseMutation(
  changes: readonly ProjectChange[],
): {
  set?: PreferenceOverrides;
  unset?: readonly PreferenceField[];
} {
  const set: PreferenceOverrides = {};
  const unset: PreferenceField[] = [];

  for (const change of changes) {
    if (change.op === 'inherit') {
      unset.push(change.key);
    } else if (change.key === 'enabled') {
      set.enabled = change.value;
    } else if (change.key === 'model') {
      set.model = parseModel(change.value);
    } else {
      set.focus = change.value;
    }
  }

  return {
    ...(Object.keys(set).length === 0 ? {} : { set }),
    ...(unset.length === 0 ? {} : { unset }),
  };
}

export function historianSettingsSnapshot(
  ctx: ConfigurationContext,
  configuration: ScopedConfiguration,
  files: UnmergedPreferenceSnapshot,
  global: Readonly<PreferenceOverrides>,
  globalTarget: string,
  configuredJournalRoot: string,
): HistorianSettingsSnapshot {
  const managed: PreferenceOverrides = {};
  if (files.managed?.model != null) {
    managed.model = parseModel(files.managed.model);
  }

  return {
    defaults: {
      enabled: false,
      model: null,
      focus: DEFAULT_FOCUS,
    },
    managed,
    global: copyHistorianOverrides(global),
    project: configuration.projectSnapshot.trusted
      ? projectOverrides(configuration.projectSnapshot.document)
      : {},
    session: sessionHistorianOverrides(ctx),
    projectTrusted: configuration.projectSnapshot.trusted,
    targets: {
      global: globalTarget,
      project: JSON.stringify([
        configuration.projectSnapshot.project,
        configuration.projectSnapshot.target,
      ]),
      session: ctx.sessionManager.getSessionId(),
    },
    runtimeRequested: configuration.enabled,
    runtimeApproved: configuration.disclosureApproved,
    runtimeSource: configuration.enabledSource,
    managedJournalRoot: files.managed?.journalRoot ?? null,
    configuredJournalRoot,
    boundaryKey: configuration.boundaryKey,
  };
}

export function previewHistorianSettings(
  snapshot: HistorianSettingsSnapshot,
  scope: ScopedSettingsScope,
  changes: readonly ProjectChange[],
): HistorianSettingsSnapshot {
  const next = changedHistorianOverrides(
    snapshot[scope] as Readonly<PreferenceOverrides>,
    changes,
  );
  return { ...snapshot, [scope]: next };
}

export function candidateHistorianModel(
  snapshot: HistorianSettingsSnapshot,
  scope: 'global' | 'session',
): WorkerModel | null {
  return resolveScopedSetting(
    snapshot,
    'model',
    scope === 'global' ? 'global' : 'effective',
  ).value;
}

export function assertHistorianTarget(
  snapshot: HistorianSettingsSnapshot,
  scope: ScopedSettingsScope,
  expectedTarget: string,
): void {
  if (snapshot.targets[scope] !== expectedTarget) {
    throw new Error(`Historian ${scope} settings target changed`);
  }
  if (scope === 'project' && !snapshot.projectTrusted) {
    throw new Error('Historian project settings require trust');
  }
}

export type HistorianSettingChange =
  ScopedSettingChange<HistorianValues>;
