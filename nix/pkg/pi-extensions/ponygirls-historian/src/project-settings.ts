import { dirname, join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  sessionEnabledData,
  writeJsonPreferences,
} from '@ponygirls/pi-settings';
import {
  CONSENT_TYPE,
  ENABLED_TYPE,
  MODEL_TYPE,
  FOCUS_TYPE,
  modelKey,
  parseModel,
  type PreferenceStore,
  type StoredPreferences,
} from './preferences.ts';
import {
  PROJECT_CONSENT_TYPE,
  changedProject,
  checkProjectDirectory,
  nextProjectToken,
  projectConsent,
  projectLocation,
  readProjectAt,
  scopedConfiguration,
  validateProjectChanges,
  type ConfigurationContext,
  type ProjectClock,
  type ProjectSnapshot,
  type ScopedConfiguration,
} from './project-config.ts';
import { acquireSessionLock } from './store.ts';
import type { WorkerModel } from './worker.ts';
import type { ScopedSettingsScope } from '@ponygirls/pi-settings';
import { assertHistorianTarget, candidateHistorianModel, checkedHistorianChanges, historianSettingsSnapshot,
  historianSparseMutation, previewHistorianSettings, type HistorianSettingsSnapshot } from './scoped-values.ts';

export type ConfirmDisclosure = (
  prompt: string,
  signal: AbortSignal,
) => Promise<boolean>;

export interface ProjectApplyResult {
  status: 'applied' | 'cancelled' | 'unchanged';
  approvalIssued: boolean;
}

interface LiveProjectGrant {
  activationId: string;
  configurationKey: string;
  model: WorkerModel;
}

export function acquireProjectTargetLock(
  target: string,
): () => void {
  checkProjectDirectory(target);
  const release = acquireSessionLock(
    join(dirname(target), '.historian-settings-lock'),
    target,
  );
  try {
    checkProjectDirectory(target);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Historian settings operation cancelled');
  }
}

function disclosurePrompt(
  scope: 'global' | 'project' | 'session',
  target: string,
  model: WorkerModel,
): string {
  return [
    `Approve Historian disclosure for ${scope} ON?`,
    `Target: ${target}`,
    `Provider/model: ${model.provider}/${model.id}`,
    `Thinking: ${model.thinking}`,
    '',
    'The configured provider receives eligible sanitized evidence from this session family and recent shared published project episodes.',
    'Redaction is best effort.',
    scope === 'project'
      ? 'Project approval lasts only in this runtime and is revoked by observed configuration/trust changes or read failures.'
      : 'This is the existing explicit global/session ON approval.',
  ].join('\n');
}

export class ProjectSettings {
  private readonly pi: Pick<ExtensionAPI, 'appendEntry'>;
  private readonly preferences: PreferenceStore;
  private readonly project: string;
  private readonly isCurrent: (
    ctx: ConfigurationContext,
  ) => boolean;
  private readonly clock: ProjectClock;

  private activeGrant: LiveProjectGrant | null = null;
  private observedConfiguration: string | null = null;
  private epoch: string;
  private retired = false;

  constructor(
    pi: Pick<ExtensionAPI, 'appendEntry'>,
    preferences: PreferenceStore,
    project: string,
    isCurrent: (ctx: ConfigurationContext) => boolean,
    clock: ProjectClock,
  ) {
    this.pi = pi;
    this.preferences = preferences;
    this.project = project;
    this.isCurrent = isCurrent;
    this.clock = clock;
    this.epoch = nextProjectToken(clock);
  }

  private revoke(): void {
    // Clear authority before invoking even the token generator.
    this.activeGrant = null;
    this.epoch = nextProjectToken(this.clock);
  }

  private invalidate(): void {
    this.activeGrant = null;
    this.observedConfiguration = null;
    this.epoch = nextProjectToken(this.clock);
  }

  dispose(): void {
    this.retired = true;
    this.invalidate();
  }

  private guard(
    ctx: ConfigurationContext,
    signal: AbortSignal,
  ): void {
    checkSignal(signal);
    this.assertCurrent(ctx);
    checkSignal(signal);
  }

  private assertCurrent(ctx: ConfigurationContext): void {
    if (this.retired || !this.isCurrent(ctx)) {
      this.invalidate();
      throw new Error('Historian settings context is stale');
    }
  }

  private observe(
    base: ScopedConfiguration,
  ): ScopedConfiguration {
    if (
      this.observedConfiguration !== base.configurationKey
    ) {
      this.revoke();
      this.observedConfiguration = base.configurationKey;
    }

    const grant = this.activeGrant;
    const projectApproved =
      base.enabled &&
      base.enabledSource === 'project' &&
      base.projectSnapshot.trusted &&
      base.projectSnapshot.document?.enabled === true &&
      base.model !== null &&
      grant !== null &&
      grant.configurationKey === base.configurationKey &&
      modelKey(grant.model) === modelKey(base.model);

    return {
      ...base,
      disclosureApproved:
        base.enabledSource === 'project'
          ? projectApproved
          : base.disclosureApproved,
      boundaryKey: JSON.stringify([
        base.configurationKey,
        this.epoch,
        grant?.activationId ?? null,
      ]),
      snapshotToken: JSON.stringify([
        base.snapshotToken,
        this.epoch,
      ]),
    };
  }

  private readAt(
    ctx: ConfigurationContext,
    location: ProjectSnapshot,
    defaults: StoredPreferences,
  ): ScopedConfiguration {
    this.assertCurrent(ctx);
    const project = readProjectAt(location);
    const files = this.preferences.unmergedSnapshot();
    const base = scopedConfiguration(
      ctx,
      project,
      defaults,
      files,
    );
    this.assertCurrent(ctx);
    return this.observe(base);
  }

  read(
    ctx: ConfigurationContext,
    defaults: StoredPreferences | null,
  ): ScopedConfiguration {
    try {
      const selected = defaults ?? this.preferences.read();
      const location = projectLocation(ctx, this.project);
      return this.readAt(ctx, location, selected);
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  private underProjectLock<T>(
    ctx: ConfigurationContext,
    defaults: StoredPreferences,
    use: (
      config: ScopedConfiguration,
      defaults: StoredPreferences,
    ) => T,
  ): T {
    try {
      const location = projectLocation(ctx, this.project);
      if (!location.trusted) {
        return use(
          this.readAt(ctx, location, defaults),
          defaults,
        );
      }

      const release = acquireProjectTargetLock(
        location.target,
      );
      try {
        return use(
          this.readAt(ctx, location, defaults),
          defaults,
        );
      } finally {
        release();
      }
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  withSnapshot<T>(
    ctx: ConfigurationContext,
    use: (
      config: ScopedConfiguration,
      defaults: StoredPreferences,
    ) => T,
  ): T {
    try {
      // Fixed ordering: agent-global lock, then common target lock.
      return this.preferences.withSnapshot(defaults =>
        this.underProjectLock(ctx, defaults, use),
      );
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  async apply(
    ctx: ConfigurationContext,
    rawChanges: unknown,
    signal: AbortSignal,
    confirm: ConfirmDisclosure,
  ): Promise<ProjectApplyResult> {
    this.guard(ctx, signal);
    const changes = validateProjectChanges(rawChanges);
    if (changes.length === 0) {
      return { status: 'unchanged', approvalIssued: false };
    }

    const prepared = this.withSnapshot(
      ctx,
      (before, defaults) => {
        this.guard(ctx, signal);
        const proposed = changedProject(
          before.projectSnapshot,
          changes,
          this.clock,
        );
        const next = scopedConfiguration(
          ctx,
          proposed,
          defaults,
          this.preferences.unmergedSnapshot(),
        );
        return { before, proposed, next };
      },
    );

    const requestsOn = changes.some(
      change =>
        change.key === 'enabled' &&
        change.op === 'set' &&
        change.value,
    );

    if (requestsOn && prepared.next.model === null) {
      throw new Error(
        'Configure a Historian model before requesting project ON',
      );
    }

    const approvalModel =
      requestsOn &&
      prepared.next.enabled &&
      prepared.next.enabledSource === 'project' &&
      prepared.next.model !== null
        ? parseModel(prepared.next.model)
        : null;

    if (approvalModel !== null) {
      this.guard(ctx, signal);
      const accepted = await confirm(
        disclosurePrompt(
          'project',
          prepared.proposed.target,
          approvalModel,
        ),
        signal,
      );
      this.guard(ctx, signal);

      if (!accepted) {
        // Observe changes made while confirmation was open.
        this.withSnapshot(ctx, () => undefined);
        return {
          status: 'cancelled',
          approvalIssued: false,
        };
      }
    }

    this.guard(ctx, signal);

    return this.withSnapshot(ctx, (fresh, defaults) => {
      this.guard(ctx, signal);

      if (
        fresh.snapshotToken !== prepared.before.snapshotToken
      ) {
        throw new Error(
          'Historian settings changed during confirmation; review and apply again',
        );
      }

      const candidate = scopedConfiguration(
        ctx,
        prepared.proposed,
        defaults,
        this.preferences.unmergedSnapshot(),
      );

      if (
        approvalModel !== null &&
        (
          !candidate.enabled ||
          candidate.enabledSource !== 'project' ||
          !candidate.projectSnapshot.trusted ||
          modelKey(candidate.model) !== modelKey(approvalModel)
        )
      ) {
        throw new Error(
          'Historian disclosure target changed; no grant was issued',
        );
      }

      const fileChanged =
        prepared.proposed.document !==
        prepared.before.projectSnapshot.document;

      if (!fileChanged && approvalModel === null) {
        return {
          status: 'unchanged',
          approvalIssued: false,
        };
      }

      // No callback or write below can observe the old grant.
      this.revoke();
      this.guard(ctx, signal);

      if (fileChanged) {
        if (prepared.proposed.document === null) {
          throw new Error(
            'Historian project mutation lost its revision document',
          );
        }
        const location = projectLocation(ctx, this.project);
        checkSignal(signal);
        if (!location.trusted || location.target !== prepared.proposed.target || location.project !== prepared.proposed.project) {
          throw new Error('Historian project trust or settings target changed before write');
        }
        checkProjectDirectory(location.target);
        writeJsonPreferences(
          prepared.proposed.target,
          prepared.proposed.document,
        );
      }

      if (approvalModel === null) {
        this.read(ctx, null);
        this.guard(ctx, signal);
        return {
          status: 'applied',
          approvalIssued: false,
        };
      }

      const written = this.read(ctx, null);
      this.guard(ctx, signal);
      if (
        written.enabledSource !== 'project' ||
        !written.enabled ||
        modelKey(written.model) !== modelKey(approvalModel) ||
        JSON.stringify(written.projectSnapshot) !==
          JSON.stringify(prepared.proposed)
      ) {
        throw new Error(
          'Historian project changed before approval; no grant was issued',
        );
      }

      // Receipt construction calls the token source; recheck before appending.
      const receipt = projectConsent(ctx.sessionManager.getSessionId(), written.projectSnapshot, approvalModel, this.clock);
      const beforeAudit = this.read(ctx, null);
      this.guard(ctx, signal);
      if (beforeAudit.snapshotToken !== written.snapshotToken) throw new Error('Historian configuration changed before recording approval');
      this.pi.appendEntry(PROJECT_CONSENT_TYPE, receipt);

      const activationId = nextProjectToken(this.clock);
      const afterAudit = this.read(ctx, null);
      this.guard(ctx, signal);
      if (
        afterAudit.snapshotToken !== written.snapshotToken ||
        afterAudit.configurationKey !==
          written.configurationKey ||
        afterAudit.enabledSource !== 'project' ||
        !afterAudit.enabled ||
        modelKey(afterAudit.model) !== modelKey(approvalModel)
      ) {
        throw new Error(
          'Historian configuration changed while recording approval; no live grant was issued',
        );
      }

      this.activeGrant = {
        activationId,
        configurationKey: afterAudit.configurationKey,
        model: parseModel(approvalModel),
      };

      return {
        status: 'applied',
        approvalIssued: true,
      };
    });
  }

  private scopedSnapshotAt(ctx: ConfigurationContext, configuration: ScopedConfiguration): HistorianSettingsSnapshot {
    this.assertCurrent(ctx);
    const snapshot = historianSettingsSnapshot(ctx, configuration, this.preferences.unmergedSnapshot(),
      this.preferences.readOverrides(), this.preferences.path, this.preferences.journalRoot());
    this.assertCurrent(ctx);
    return snapshot;
  }

  settingsSnapshot(ctx: ConfigurationContext): HistorianSettingsSnapshot {
    return this.withSnapshot(ctx, configuration => this.scopedSnapshotAt(ctx, configuration));
  }

  async applyScoped(ctx: ConfigurationContext, scope: ScopedSettingsScope, rawChanges: unknown,
    signal: AbortSignal, expectedTarget: string, confirm: ConfirmDisclosure): Promise<void> {
    this.guard(ctx, signal);
    const changes = checkedHistorianChanges(rawChanges);
    if (scope !== 'global' && scope !== 'session' && scope !== 'project') throw new Error('Invalid Historian settings scope');
    if (changes.length === 0) return;
    if (scope === 'project') {
      assertHistorianTarget(this.settingsSnapshot(ctx), scope, expectedTarget);
      this.guard(ctx, signal);
      const result = await this.apply(ctx, changes, signal, confirm);
      this.guard(ctx, signal);
      if (result.status === 'cancelled') throw new Error('Historian disclosure approval cancelled; settings were not applied');
      return;
    }
    const requestsOn = changes.some(change => change.key === 'enabled' && change.op === 'set' && change.value);
    const prepared = this.withSnapshot(ctx, before => {
      this.guard(ctx, signal);
      const snapshot = this.scopedSnapshotAt(ctx, before);
      assertHistorianTarget(snapshot, scope, expectedTarget);
      const model = candidateHistorianModel(previewHistorianSettings(snapshot, scope, changes), scope);
      if (requestsOn && model === null) throw new Error('Configure a Historian model before enabling');
      return { before, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, model: model === null ? null : parseModel(model) };
    });
    const boundary = (): void => {
      this.guard(ctx, signal);
      if (ctx.cwd !== prepared.cwd || ctx.sessionManager.getSessionId() !== prepared.sessionId) throw new Error('Historian settings context changed');
      this.guard(ctx, signal);
    };
    boundary();
    if (requestsOn) {
      if (prepared.model === null) throw new Error('Historian approval model is missing');
      const accepted = await confirm(disclosurePrompt(scope, expectedTarget, prepared.model), signal);
      boundary();
      if (!accepted) {
        this.withSnapshot(ctx, () => undefined);
        throw new Error('Historian disclosure approval cancelled; settings were not applied');
      }
    }
    const verify = (fresh: ScopedConfiguration): void => {
      boundary();
      const snapshot = this.scopedSnapshotAt(ctx, fresh);
      assertHistorianTarget(snapshot, scope, expectedTarget);
      if (fresh.snapshotToken !== prepared.before.snapshotToken) throw new Error('Historian settings changed during confirmation; review and apply again');
      const model = candidateHistorianModel(previewHistorianSettings(snapshot, scope, changes), scope);
      if (modelKey(model) !== modelKey(prepared.model)) throw new Error('Historian candidate model changed; no approval was issued');
      boundary();
    };
    if (scope === 'global') {
      try {
        this.preferences.withDomainTransaction((defaults, _overrides, commit) => this.underProjectLock(ctx, defaults, fresh => {
          verify(fresh);
          this.revoke(); boundary();
          const mutation = historianSparseMutation(changes); boundary();
          commit({ ...mutation, ...(requestsOn ? { approvedModel: prepared.model } : {}) });
          this.read(ctx, null); boundary();
        }));
      } catch (error) { this.invalidate(); throw error; }
      return;
    }
    this.withSnapshot(ctx, fresh => {
      verify(fresh);
      this.revoke(); boundary();
      // Native logging may leave a prefix on failure; it is not a transaction.
      for (const change of changes) {
        if (change.key === 'enabled') continue;
        boundary();
        if (change.key === 'model') {
          const model = change.op === 'inherit' ? null : parseModel(change.value); boundary();
          this.pi.appendEntry(MODEL_TYPE, { version: 1, sessionId: prepared.sessionId, model });
        } else {
          const focus = change.op === 'inherit' ? null : change.value; boundary();
          this.pi.appendEntry(FOCUS_TYPE, { version: 1, sessionId: prepared.sessionId, focus });
        }
        boundary();
      }
      if (requestsOn) {
        const actual = this.read(ctx, null); boundary();
        if (prepared.model === null || modelKey(actual.model) !== modelKey(prepared.model)) throw new Error('Historian model changed while applying settings; no consent was issued');
        const consent = { version: 1, sessionId: prepared.sessionId, model: parseModel(prepared.model) }; boundary();
        this.pi.appendEntry(CONSENT_TYPE, consent); boundary();
      }
      for (const change of changes) {
        if (change.key !== 'enabled') continue;
        if (requestsOn) {
          const actual = this.read(ctx, null); boundary();
          if (modelKey(actual.model) !== modelKey(prepared.model)) throw new Error('Historian model changed before enablement');
        }
        const data = sessionEnabledData(prepared.sessionId, change.op === 'inherit' ? null : change.value); boundary();
        this.pi.appendEntry(ENABLED_TYPE, data); boundary();
      }
      this.read(ctx, null); boundary();
    });
  }

}
