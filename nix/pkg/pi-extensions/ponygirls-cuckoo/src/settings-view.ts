import type {
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';

import {
  ScopedSettingsController,
  scopedBooleanField,
  type ScopedSettingBooleanField,
  type ScopedSettingChange,
  type ScopedSettingEditResult,
  type ScopedSettingFields,
  type ScopedSettingKey,
  type ScopedSettingOverrides,
  type ScopedSettingsAdapter,
  type ScopedSettingsSnapshot,
} from '@ponygirls/pi-settings';

import {
  ScopedSettingsView,
} from '@ponygirls/pi-ui';

import {
  FEATURES,
  featureActivation,
  type FeatureId,
  type FeatureSwitches,
} from './features.ts';

import {
  DEFAULT_PREFERENCES,
  validateChanges,
  validateOverrides,
  type CuckooPreferences,
  type PreferenceChange,
  type PreferenceContext,
  type PreferenceOverrides,
  type PreferenceScope,
  type PreferenceSnapshot,
} from './preferences.ts';

import {
  policyText,
  validatePolicy,
  type GrowthPolicy,
} from './policy.ts';

export interface PolicyEditRequest {
  readonly scope: PreferenceScope;
  readonly value: GrowthPolicy;
}

/**
 * Return a complete policy, or undefined on cancellation.
 * Honor signal by closing any owned UI.
 * Editing must not persist settings or grant permission.
 */
export interface PolicyEditor {
  (
    request: PolicyEditRequest & {
      readonly signal: AbortSignal;
    },
  ): Promise<GrowthPolicy | undefined>;
}

export interface SettingsCallbacks {
  read(): PreferenceSnapshot;

  /**
   * The supplied target is the destination pinned by the settings controller.
   *
   * Any implementation that awaits must recheck signal, target and project
   * trust after awaiting and immediately before its authoritative mutation.
   * Rejection does not imply that storage was unchanged.
   */
  apply(
    scope: PreferenceScope,
    changes: readonly PreferenceChange[],
    signal: AbortSignal,
    expectedTarget: string,
  ): Promise<void> | void;

  applied(
    snapshot: PreferenceSnapshot,
    scope: PreferenceScope,
  ): void;

  readonly editPolicy: PolicyEditor;
}

export interface ScopeValues {
  enabled: boolean;
  policy: GrowthPolicy;
  evidence: boolean;
  corrections: boolean;
  verifiers: boolean;
  reader: boolean;
  transfer: boolean;
  vectors: boolean;
  critic: boolean;
}

function assertTarget(
  snapshot: PreferenceSnapshot,
  scope: PreferenceScope,
  expectedTarget: string,
): void {
  if (snapshot.paths[scope] !== expectedTarget) {
    throw new Error(`Cuckoo ${scope} settings target changed`);
  }

  if (scope === 'project' && !snapshot.projectTrusted) {
    throw new Error('Project settings require a trusted project');
  }
}

export function bindSettingsCallbacks(
  preferences: CuckooPreferences,
  context: PreferenceContext,
  editPolicy: PolicyEditor,
  applied: (
    snapshot: PreferenceSnapshot,
    scope: PreferenceScope,
  ) => void,
): SettingsCallbacks {
  return {
    read: () => preferences.read(context),

    apply(
      scope,
      changes,
      signal,
      expectedTarget,
    ): void {
      signal.throwIfAborted();

      const current = preferences.read(context);
      assertTarget(current, scope, expectedTarget);

      signal.throwIfAborted();
      preferences.apply(context, scope, changes, signal);
    },

    applied,
    editPolicy,
  };
}

function flattenOverrides(
  overrides: PreferenceOverrides,
): ScopedSettingOverrides<ScopeValues> {
  const checked = validateOverrides(overrides);
  const result: Partial<ScopeValues> = {};

  if (checked.enabled !== undefined) {
    result.enabled = checked.enabled;
  }

  if (checked.policy !== undefined) {
    result.policy = checked.policy;
  }

  if (checked.features !== undefined) {
    for (const feature of FEATURES) {
      const value = checked.features[feature.id];
      if (value !== undefined) {
        result[feature.id] = value;
      }
    }
  }

  return Object.freeze(result);
}

function defaultValues(): Readonly<ScopeValues> {
  return Object.freeze({
    enabled: DEFAULT_PREFERENCES.enabled,
    policy: validatePolicy(DEFAULT_PREFERENCES.policy),
    ...DEFAULT_PREFERENCES.features,
  });
}

function sharedSnapshot(
  snapshot: PreferenceSnapshot,
): ScopedSettingsSnapshot<ScopeValues> {
  return {
    defaults: defaultValues(),
    managed: {},
    global: flattenOverrides(snapshot.global),
    project: snapshot.projectTrusted
      ? flattenOverrides(snapshot.project)
      : {},
    session: flattenOverrides(snapshot.session),
    projectTrusted: snapshot.projectTrusted,
    targets: Object.freeze({
      session: snapshot.paths.session,
      project: snapshot.paths.project,
      global: snapshot.paths.global,
    }),
  };
}

function preferenceChange(
  change: ScopedSettingChange<ScopeValues>,
): PreferenceChange {
  if (change.key === 'enabled') {
    return {
      field: 'enabled',
      value: change.op === 'inherit' ? null : change.value,
    };
  }

  if (change.key === 'policy') {
    return {
      field: 'policy',
      value: change.op === 'inherit' ? null : change.value,
    };
  }

  return {
    field: 'feature',
    id: change.key,
    value: change.op === 'inherit' ? null : change.value,
  };
}

function decodePolicy(value: unknown): GrowthPolicy {
  // Reuse the owner's strict nested-policy codec, including its allowed keys.
  const checked = validateOverrides({ policy: value });
  if (checked.policy === undefined) {
    throw new Error('Missing Cuckoo growth policy');
  }
  return checked.policy;
}

function featureField(
  id: FeatureId,
): ScopedSettingBooleanField<boolean> {
  const definition = FEATURES.find(feature => feature.id === id);
  if (definition === undefined) {
    throw new Error(`Missing Cuckoo feature definition: ${id}`);
  }

  return scopedBooleanField(
    definition.label,
    definition.description,
  );
}

function fields(
  callbacks: SettingsCallbacks,
): ScopedSettingFields<ScopeValues> {
  return {
    enabled: scopedBooleanField(
      'Automatic mode (master)',
      'Controls automatic checkpoints and new features. Saved recall/history ' +
        'and explicitly requested manual inquiries remain available while off.',
    ),

    policy: {
      kind: 'value',
      label: 'Growth policy',
      description:
        'Kind and value are one setting. Enter or e opens the policy editor; ' +
        'the returned policy remains a draft until Apply.',

      decode: decodePolicy,

      equals(left, right): boolean {
        return left.kind === right.kind &&
          left.value === right.value;
      },

      format: policyText,

      async edit(
        request,
      ): Promise<ScopedSettingEditResult<GrowthPolicy>> {
        request.signal.throwIfAborted();
        assertTarget(
          callbacks.read(),
          request.scope,
          request.target,
        );
        request.signal.throwIfAborted();

        const result = await callbacks.editPolicy({
          scope: request.scope,
          value: decodePolicy(request.value),
          signal: request.signal,
        });

        // Never turn an aborted editor's late result into a staged setting.
        if (request.signal.aborted) {
          return { kind: 'cancel' };
        }

        assertTarget(
          callbacks.read(),
          request.scope,
          request.target,
        );

        if (request.signal.aborted) {
          return { kind: 'cancel' };
        }

        if (result === undefined) {
          return { kind: 'cancel' };
        }

        // Invalid/null results are errors, not inheritance or cancellation.
        return {
          kind: 'set',
          value: decodePolicy(result),
        };
      },
    },

    evidence: featureField('evidence'),
    corrections: featureField('corrections'),
    verifiers: featureField('verifiers'),
    reader: featureField('reader'),
    transfer: featureField('transfer'),
    vectors: featureField('vectors'),
    critic: featureField('critic'),
  };
}

function featureSwitches(
  values: Readonly<ScopeValues>,
): FeatureSwitches {
  return {
    evidence: values.evidence,
    corrections: values.corrections,
    verifiers: values.verifiers,
    reader: values.reader,
    transfer: values.transfer,
    vectors: values.vectors,
    critic: values.critic,
  };
}

function inactiveExplanation(
  key: ScopedSettingKey<ScopeValues>,
  effective: Readonly<ScopeValues>,
): string {
  if (key === 'policy') return '';

  if (key === 'enabled') {
    return effective.enabled
      ? 'automatic on'
      : (
          'automatic off; manual inquiry and passive recall/history ' +
          'remain available'
        );
  }

  const activation = featureActivation(
    effective.enabled,
    featureSwitches(effective),
    key,
  );

  return activation.activeBySettings
    ? 'ready by settings'
    : `inactive: ${activation.reasons.join(', ')}`;
}

class CuckooSettingsAdapter
  implements ScopedSettingsAdapter<ScopeValues> {
  private readonly callbacks: SettingsCallbacks;

  private lastTargets:
    Readonly<Record<PreferenceScope, string>> | null = null;

  constructor(callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;
  }

  read(): ScopedSettingsSnapshot<ScopeValues> {
    const snapshot = sharedSnapshot(this.callbacks.read());
    this.lastTargets = snapshot.targets;
    return snapshot;
  }

  apply(
    scope: PreferenceScope,
    changes: readonly ScopedSettingChange<ScopeValues>[],
    signal: AbortSignal,
  ): Promise<void> | void {
    signal.throwIfAborted();

    const targets = this.lastTargets;
    if (targets === null) {
      throw new Error('Cuckoo settings have not been read');
    }

    const expectedTarget = targets[scope];
    const translated = validateChanges(
      changes.map(preferenceChange),
    );

    assertTarget(
      this.callbacks.read(),
      scope,
      expectedTarget,
    );

    signal.throwIfAborted();

    // Return the result: do not detach a callback that returns a promise.
    return this.callbacks.apply(
      scope,
      translated,
      signal,
      expectedTarget,
    );
  }

  applied(
    snapshot: ScopedSettingsSnapshot<ScopeValues>,
    scope: PreferenceScope,
  ): void {
    const current = this.callbacks.read();
    assertTarget(current, scope, snapshot.targets[scope]);
    this.callbacks.applied(current, scope);
  }
}

export function createSettingsController(
  callbacks: SettingsCallbacks,
): ScopedSettingsController<ScopeValues> {
  const order: readonly ScopedSettingKey<ScopeValues>[] = [
    'enabled',
    ...FEATURES.map(feature => feature.id),
    'policy',
  ];

  return new ScopedSettingsController<ScopeValues>({
    fields: fields(callbacks),
    order,
    adapter: new CuckooSettingsAdapter(callbacks),
    inactive: inactiveExplanation,
  });
}

export class CuckooSettingsView {
  private readonly view = new ScopedSettingsView();

  show(
    context: ExtensionContext,
    callbacks: SettingsCallbacks,
  ): Promise<void> {
    return this.view.show(
      context,
      () => createSettingsController(callbacks),
      { title: 'Cuckoo settings' },
    );
  }

  dispose(): void {
    this.view.dispose();
  }
}
