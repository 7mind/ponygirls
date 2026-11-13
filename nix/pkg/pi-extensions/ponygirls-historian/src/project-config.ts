import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import {
  sessionEnabled,
  sessionSetting,
} from '@ponygirls/pi-settings';
import { object, text } from './model.ts';
import {
  CONSENT_TYPE,
  ENABLED_TYPE,
  FOCUS_TYPE,
  MODEL_TYPE,
  effectivePreferences,
  modelKey,
  parseModel,
  type EffectivePreferences,
  type StoredPreferences,
  type UnmergedPreferenceSnapshot,
} from './preferences.ts';
import type { WorkerModel } from './worker.ts';

export const PROJECT_CONSENT_TYPE = 'historian.project-consent';

export interface ProjectClock {
  token(): string;
}

export type ConfigurationContext = Pick<
  ExtensionContext,
  'cwd' | 'isProjectTrusted' | 'sessionManager'
>;

export type ConfigurationSource =
  | 'default'
  | 'managed'
  | 'global'
  | 'project'
  | 'session';

export interface ProjectOverrides {
  enabled?: boolean;
  model?: WorkerModel;
  focus?: string;
}

export interface ProjectDocument extends ProjectOverrides {
  version: 1;
  enabledGeneration: string;
  revision: string;
}

export interface ProjectSnapshot {
  project: string;
  target: string;
  trusted: boolean;
  document: ProjectDocument | null;
}

export type ProjectChange =
  | { key: 'enabled'; op: 'set'; value: boolean }
  | { key: 'model'; op: 'set'; value: WorkerModel }
  | { key: 'focus'; op: 'set'; value: string }
  | {
      key: 'enabled' | 'model' | 'focus';
      op: 'inherit';
    };

export interface ProjectConsent {
  version: 1;
  sessionId: string;
  receiptId: string;
  project: string;
  target: string;
  enabledGeneration: string;
  model: WorkerModel;
}

export interface ScopedConfiguration
  extends Omit<
    EffectivePreferences,
    'enabledSource' | 'modelSource'
  > {
  enabledSource: 'global' | 'project' | 'session';
  modelSource: 'global' | 'project' | 'session';
  modelOrigin: ConfigurationSource;
  focusSource: ConfigurationSource;
  projectSnapshot: ProjectSnapshot;
  disclosureApproved: boolean;
  configurationKey: string;
  boundaryKey: string;
  snapshotToken: string;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown Historian project setting: ${key}`);
    }
  }
}

function token(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('Invalid Historian project revision');
  }
  return value;
}

export function nextProjectToken(clock: ProjectClock): string {
  return token(clock.token());
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('Historian enabled must be boolean');
  }
  return value;
}

export function validateProjectDocument(
  raw: unknown,
): ProjectDocument {
  const value = object(raw);
  keys(value, [
    'version',
    'enabled',
    'model',
    'focus',
    'enabledGeneration',
    'revision',
  ]);
  if (value.version !== 1) {
    throw new Error('Invalid Historian project settings version');
  }

  const result: ProjectDocument = {
    version: 1,
    enabledGeneration: token(value.enabledGeneration),
    revision: token(value.revision),
  };
  if (Object.hasOwn(value, 'enabled')) {
    result.enabled = boolean(value.enabled);
  }
  if (Object.hasOwn(value, 'model')) {
    result.model = parseModel(value.model);
  }
  if (Object.hasOwn(value, 'focus')) {
    result.focus = text(value.focus, 'focus', 4000);
  }
  return result;
}

export function validateProjectChanges(
  raw: unknown,
): readonly ProjectChange[] {
  if (!Array.isArray(raw) || raw.length > 3) {
    throw new Error('Invalid Historian project changes');
  }

  const seen = new Set<string>();
  return raw.map((item): ProjectChange => {
    const value = object(item);
    if (
      value.key !== 'enabled' &&
      value.key !== 'model' &&
      value.key !== 'focus'
    ) {
      throw new Error('Invalid Historian project field');
    }
    if (seen.has(value.key)) {
      throw new Error('Duplicate Historian project field');
    }
    seen.add(value.key);

    if (value.op === 'inherit') {
      keys(value, ['key', 'op']);
      return { key: value.key, op: 'inherit' };
    }
    if (value.op !== 'set') {
      throw new Error('Invalid Historian project operation');
    }
    keys(value, ['key', 'op', 'value']);

    if (value.key === 'enabled') {
      return {
        key: 'enabled',
        op: 'set',
        value: boolean(value.value),
      };
    }
    if (value.key === 'model') {
      return {
        key: 'model',
        op: 'set',
        value: parseModel(value.value),
      };
    }
    return {
      key: 'focus',
      op: 'set',
      value: text(value.value, 'focus', 4000),
    };
  });
}

export function projectOverrides(
  document: ProjectDocument | null,
): ProjectOverrides {
  const result: ProjectOverrides = {};
  if (document?.enabled !== undefined) {
    result.enabled = document.enabled;
  }
  if (document?.model !== undefined) {
    result.model = document.model;
  }
  if (document?.focus !== undefined) {
    result.focus = document.focus;
  }
  return result;
}

export function changedProject(
  snapshot: ProjectSnapshot,
  rawChanges: unknown,
  clock: ProjectClock,
): ProjectSnapshot {
  if (!snapshot.trusted) {
    throw new Error(
      'Historian project settings require a trusted project',
    );
  }

  const changes = validateProjectChanges(rawChanges);
  const before = projectOverrides(snapshot.document);
  const after: ProjectOverrides = { ...before };

  for (const change of changes) {
    if (change.op === 'inherit') {
      delete after[change.key];
    } else if (change.key === 'enabled') {
      after.enabled = change.value;
    } else if (change.key === 'model') {
      after.model = change.value;
    } else {
      after.focus = change.value;
    }
  }

  if (JSON.stringify(before) === JSON.stringify(after)) {
    return snapshot;
  }

  return {
    ...snapshot,
    document: validateProjectDocument({
      version: 1,
      ...after,
      enabledGeneration:
        snapshot.document !== null &&
        before.enabled === after.enabled
          ? snapshot.document.enabledGeneration
          : nextProjectToken(clock),
      revision: nextProjectToken(clock),
    }),
  };
}

export function projectLocation(
  ctx: ConfigurationContext,
  project: string,
): ProjectSnapshot {
  const trusted: unknown = ctx.isProjectTrusted();
  if (typeof trusted !== 'boolean') {
    throw new Error('Historian project trust is unknown');
  }
  return {
    project,
    target: join(
      realpathSync(ctx.cwd),
      CONFIG_DIR_NAME,
      'historian.json',
    ),
    trusted,
    document: null,
  };
}

export function checkProjectDirectory(target: string): void {
  try {
    const directory = lstatSync(dirname(target));
    if (
      directory.isSymbolicLink() ||
      !directory.isDirectory()
    ) {
      throw new Error(
        'Historian project configuration directory must be a real directory',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export function readProjectAt(
  location: ProjectSnapshot,
): ProjectSnapshot {
  if (!location.trusted) return location;
  checkProjectDirectory(location.target);

  let fd: number;
  try {
    fd = openSync(
      location.target,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return location;
    }
    throw error;
  }

  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error(
        'Historian project settings must be a regular file',
      );
    }
    return {
      ...location,
      document: validateProjectDocument(
        JSON.parse(readFileSync(fd, 'utf8')),
      ),
    };
  } catch (error) {
    throw new Error(
      `Cannot read valid Historian project settings at ${location.target}`,
      { cause: error },
    );
  } finally {
    closeSync(fd);
  }
}

export function readProject(
  ctx: ConfigurationContext,
  project: string,
): ProjectSnapshot {
  return readProjectAt(projectLocation(ctx, project));
}

// Audit codec only. No configuration resolver or authorizer calls it.
export function readProjectConsent(
  entries: readonly SessionEntry[],
  sessionId: string,
): ProjectConsent | null {
  return sessionSetting<ProjectConsent>(
    entries,
    sessionId,
    PROJECT_CONSENT_TYPE,
    raw => {
      const value = object(raw);
      keys(value, [
        'version',
        'sessionId',
        'receiptId',
        'project',
        'target',
        'enabledGeneration',
        'model',
      ]);
      return {
        version: 1,
        sessionId,
        receiptId: token(value.receiptId),
        project: text(value.project, 'project identity', 4096),
        target: text(value.target, 'project settings target', 4096),
        enabledGeneration: token(value.enabledGeneration),
        model: parseModel(value.model),
      };
    },
  );
}

export function projectConsent(
  sessionId: string,
  snapshot: ProjectSnapshot,
  model: WorkerModel,
  clock: ProjectClock,
): ProjectConsent {
  if (
    !snapshot.trusted ||
    snapshot.document?.enabled !== true
  ) {
    throw new Error(
      'Cannot record approval for inactive Historian project enablement',
    );
  }
  return {
    version: 1,
    sessionId,
    receiptId: nextProjectToken(clock),
    project: snapshot.project,
    target: snapshot.target,
    enabledGeneration: snapshot.document.enabledGeneration,
    model: parseModel(model),
  };
}

function settingRevisions(
  entries: readonly SessionEntry[],
  sessionId: string,
): readonly [string, number][] {
  const relevant = new Set([
    ENABLED_TYPE,
    MODEL_TYPE,
    FOCUS_TYPE,
    CONSENT_TYPE,
  ]);
  const revisions = new Map<string, number>();

  entries.forEach((entry, index) => {
    if (
      entry.type !== 'custom' ||
      !relevant.has(entry.customType)
    ) {
      return;
    }
    const data: unknown = entry.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'sessionId' in data &&
      data.sessionId === sessionId
    ) {
      revisions.set(entry.customType, index + 1);
    }
  });

  return [...revisions].sort(([a], [b]) =>
    a.localeCompare(b),
  );
}

export function scopedConfiguration(
  ctx: ConfigurationContext,
  projectSnapshot: ProjectSnapshot,
  defaults: StoredPreferences,
  files: UnmergedPreferenceSnapshot,
): ScopedConfiguration {
  const entries = ctx.sessionManager.getEntries();
  const sessionId = ctx.sessionManager.getSessionId();
  const legacy = effectivePreferences(
    defaults,
    entries,
    sessionId,
  );

  const localEnabled = sessionEnabled(
    entries,
    sessionId,
    ENABLED_TYPE,
  );
  const localModel = sessionSetting(
    entries,
    sessionId,
    MODEL_TYPE,
    raw => {
      const p = object(raw);
      return p.model === null ? null : parseModel(p.model);
    },
  );
  const localFocus = sessionSetting(
    entries,
    sessionId,
    FOCUS_TYPE,
    raw => {
      const p = object(raw);
      return p.focus === null
        ? null
        : text(p.focus, 'focus', 4000);
    },
  );

  const project = projectSnapshot.trusted
    ? projectOverrides(projectSnapshot.document)
    : {};

  const enabledSource =
    localEnabled !== null
      ? 'session'
      : project.enabled !== undefined
        ? 'project'
        : 'global';

  const modelSource =
    localModel !== null
      ? 'session'
      : project.model !== undefined
        ? 'project'
        : 'global';

  const modelOrigin: ConfigurationSource =
    modelSource !== 'global'
      ? modelSource
      : files.local?.model != null
        ? 'global'
        : files.managed?.model != null
          ? 'managed'
          : 'default';

  const focusSource: ConfigurationSource =
    localFocus !== null
      ? 'session'
      : project.focus !== undefined
        ? 'project'
        : files.local?.focus !== undefined
          ? 'global'
          : 'default';

  const enabled =
    localEnabled ?? project.enabled ?? defaults.enabled;
  const model =
    localModel ?? project.model ?? defaults.model;
  const focus =
    localFocus ?? project.focus ?? defaults.focus;

  // Project authority is deliberately absent from this pure resolver.
  const disclosureApproved =
    enabledSource !== 'project' &&
    model !== null &&
    modelKey(legacy.approvedModel) === modelKey(model);

  const enabledGeneration =
    enabledSource === 'global'
      ? defaults.enabledGeneration
      : null;

  const revisions = settingRevisions(entries, sessionId);

  const configurationKey = JSON.stringify([
    sessionId,
    enabled,
    enabledSource,
    enabledGeneration,
    legacy.enabledRevision,
    model,
    modelOrigin,
    focus,
    focusSource,
    disclosureApproved,
    projectSnapshot,
    revisions,
    enabledSource === 'project'
      ? null
      : legacy.approvedModel,
  ]);

  return {
    ...legacy,
    enabled,
    model,
    focus,
    enabledSource,
    modelSource,
    enabledGeneration,
    modelOrigin,
    focusSource,
    projectSnapshot,
    disclosureApproved,
    configurationKey,
    boundaryKey: configurationKey,
    snapshotToken: JSON.stringify([
      sessionId,
      defaults,
      files,
      projectSnapshot,
      revisions,
    ]),
  };
}
