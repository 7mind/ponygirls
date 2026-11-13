/**
 * Generic scoped settings.
 *
 * Domain owners supply codecs, editors, persistence, authorization and runtime
 * activation. This module does not grant permission or interpret enablement as
 * consent.
 */

export type ScopedSettingsScope = 'session' | 'project' | 'global';

export type ScopedSettingsOrigin =
  | ScopedSettingsScope
  | 'managed'
  | 'default';

export type ScopedSettingsThrough =
  | ScopedSettingsScope
  | 'effective';

export type ScopedSettingKey<V extends object> =
  Extract<keyof V, string>;

export type ScopedSettingOverrides<V extends object> =
  Readonly<Partial<V>>;

export type ScopedSettingChangeFor<
  V extends object,
  K extends ScopedSettingKey<V>,
> =
  | {
      readonly key: K;
      readonly op: 'set';
      readonly value: V[K];
    }
  | {
      readonly key: K;
      readonly op: 'inherit';
    };

export type ScopedSettingChange<V extends object> = {
  [K in ScopedSettingKey<V>]: ScopedSettingChangeFor<V, K>;
}[ScopedSettingKey<V>];

export type ScopedSettingLocal<T> =
  | {
      readonly kind: 'inherit';
    }
  | {
      readonly kind: 'set';
      readonly value: T;
    };

export interface ScopedSettingResolved<T> {
  readonly value: T;
  readonly origin: ScopedSettingsOrigin;
}

export interface ScopedSettingsSnapshot<V extends object> {
  readonly defaults: Readonly<V>;
  readonly managed: ScopedSettingOverrides<V>;
  readonly global: ScopedSettingOverrides<V>;
  readonly project: ScopedSettingOverrides<V>;
  readonly session: ScopedSettingOverrides<V>;
  readonly projectTrusted: boolean;

  /**
   * Stable identities, not merely display labels.
   *
   * Include every context component that determines the destination. A session
   * target normally includes its session ID; a project target includes its
   * canonical project/settings location.
   */
  readonly targets: Readonly<Record<ScopedSettingsScope, string>>;
}

export interface ScopedSettingCodec<T> {
  /**
   * Validate and return a detached value.
   *
   * Undefined is reserved for absence and is not a supported stored value.
   * Nullable domain values are supported.
   */
  decode(value: unknown): T;

  /** Pure domain equality; do not mutate either argument. */
  equals(left: T, right: T): boolean;

  /** Pure, plain-text formatting. Do not return terminal styling. */
  format(value: T): string;
}

export interface ScopedSettingFieldBase<T>
  extends ScopedSettingCodec<T> {
  readonly label: string;
  readonly description: string;
}

export interface ScopedSettingBooleanField<T>
  extends ScopedSettingFieldBase<T> {
  readonly kind: 'boolean';
  checked(value: T): boolean;
  toggle(value: T): T;
}

export type ScopedSettingEditResult<T> =
  | {
      readonly kind: 'cancel';
    }
  | {
      readonly kind: 'set';
      readonly value: T;
    };

export interface ScopedSettingEditRequest<T> {
  readonly scope: ScopedSettingsScope;
  readonly target: string;
  readonly value: T;
  readonly signal: AbortSignal;
}

export interface ScopedSettingValueField<T>
  extends ScopedSettingFieldBase<T> {
  readonly kind: 'value';

  /**
   * Edit a detached complete value, without saving it.
   *
   * The editor must honor signal by closing UI it owns. The controller also
   * rejects late results after cancellation, disposal or target changes.
   */
  edit(
    request: ScopedSettingEditRequest<T>,
  ): Promise<ScopedSettingEditResult<T>>;
}

export type ScopedSettingField<T> =
  | ScopedSettingBooleanField<T>
  | ScopedSettingValueField<T>;

export type ScopedSettingFields<V extends object> = {
  readonly [K in ScopedSettingKey<V>]:
    | ScopedSettingValueField<V[K]>
    | (
        [V[K]] extends [boolean]
          ? ScopedSettingBooleanField<V[K]>
          : never
      );
};

export interface ScopedSettingsAdapter<V extends object> {
  /**
   * Read current authoritative layers and target identities.
   *
   * Owners must not read project configuration before establishing trust.
   * Return project:{} when untrusted.
   */
  read(): ScopedSettingsSnapshot<V>;

  /**
   * Apply the complete batch to this scope.
   *
   * Resolution means that the requested authoritative mutation completed.
   * Cancellation/declined authorization must not resolve as successful apply.
   *
   * This callback runs while the settings pane is closed. It may obtain
   * operator consent, but must never derive consent from a checkbox.
   *
   * The owner is responsible for:
   * - checking signal before mutations;
   * - pinning the destination across asynchronous consent;
   * - rereading storage and preserving unrelated changes;
   * - final trust/authorization checks immediately before mutation;
   * - atomic storage, locking, migrations and session-record semantics;
   * - domain generation/revision checks and permission bookkeeping.
   *
   * The controller cannot undo mutations made before a rejection or abort.
   */
  apply(
    scope: ScopedSettingsScope,
    changes: readonly ScopedSettingChange<V>[],
    signal: AbortSignal,
  ): Promise<void> | void;

  /**
   * Called only after successful apply and a matching authoritative reread.
   * This is a convenience notification, not an authorization boundary.
   */
  applied(
    snapshot: ScopedSettingsSnapshot<V>,
    scope: ScopedSettingsScope,
  ): void;
}

export interface ScopedSettingsControllerOptions<V extends object> {
  readonly fields: ScopedSettingFields<V>;

  /** Every field exactly once, in display order. */
  readonly order: readonly ScopedSettingKey<V>[];

  readonly adapter: ScopedSettingsAdapter<V>;

  /**
   * Required domain-owned explanation. Return '' when there is no explanation.
   * This callback must not mutate effective values.
   */
  inactive(
    key: ScopedSettingKey<V>,
    effective: Readonly<V>,
  ): string;
}

/** Presentation-only DTO: no heterogeneous values cross the UI boundary. */
export interface ScopedSettingsRow {
  readonly id: string;
  readonly kind: 'boolean' | 'value';
  readonly label: string;
  readonly description: string;

  /** Through-selected-scope intent, not permission or runtime authorization. */
  readonly checked: boolean | null;

  readonly localSet: boolean;
  readonly localText: string;
  readonly throughText: string;
  readonly effectiveText: string;
  readonly origin: ScopedSettingsOrigin;
  readonly inactive: string;
}

export interface ScopedSettingsScopeState {
  readonly scope: ScopedSettingsScope;
  readonly dirty: boolean;
  readonly editable: boolean;
  readonly reason: string;
  readonly target: string;
}

export interface ScopedSettingsState {
  readonly active: boolean;
  readonly busy: boolean;
  readonly scope: ScopedSettingsScope;
  readonly selectedIndex: number;
  readonly rows: readonly ScopedSettingsRow[];
  readonly scopes: readonly ScopedSettingsScopeState[];
  readonly projectTrusted: boolean;
  readonly notice: string;
}

export interface ScopedSettingsAction {
  readonly kind: 'apply' | 'edit';

  /**
   * One-shot action. Run only after closing the settings pane.
   * Repeated calls are harmless.
   */
  run(signal: AbortSignal): Promise<void>;
}

export interface ScopedSettingsKeybindings {
  matches(
    data: string,
    action:
      | 'tui.select.up'
      | 'tui.select.down'
      | 'tui.select.confirm'
      | 'tui.select.cancel',
  ): boolean;
}

/** Structural port consumed by pi-ui through type-only imports. */
export interface ScopedSettingsPort {
  readonly active: boolean;
  readonly busy: boolean;

  state(): ScopedSettingsState;

  select(index: number): void;
  selectScope(scope: ScopedSettingsScope): void;
  cycleScope(delta: number): void;

  toggleSelected(): void;
  inheritSelected(): void;

  reload(): boolean;

  beginEdit(): ScopedSettingsAction | null;
  beginApply(): ScopedSettingsAction | null;

  setNotice(message: string): void;
  dispose(): void;
}

export const SCOPED_SETTINGS_SCOPES:
  readonly ScopedSettingsScope[] = Object.freeze([
    'session',
    'project',
    'global',
  ]);

function plainText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .slice(0, 16000);
}

function errorText(error: unknown): string {
  try {
    return plainText(String(error)).slice(0, 2000);
  } catch {
    return 'Unprintable error';
  }
}

function fieldAt<
  V extends object,
  K extends ScopedSettingKey<V>,
>(
  fields: ScopedSettingFields<V>,
  key: K,
): ScopedSettingField<V[K]> {
  // The mapped registry restricts boolean fields further than this common
  // internal representation. Both alternatives retain exactly V[K].
  return fields[key] as ScopedSettingField<V[K]>;
}

function defineValue<
  V extends object,
  K extends ScopedSettingKey<V>,
>(
  target: Partial<V>,
  key: K,
  value: V[K],
): void {
  // defineProperty also handles a legitimate "__proto__" field safely.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function decodeValue<
  V extends object,
  K extends ScopedSettingKey<V>,
>(
  fields: ScopedSettingFields<V>,
  key: K,
  value: unknown,
): V[K] {
  if (value === undefined) {
    throw new Error(`Undefined is not a setting value: ${key}`);
  }
  const decoded = fieldAt(fields, key).decode(value);
  if (decoded === undefined) {
    throw new Error(`Codec returned undefined: ${key}`);
  }
  return decoded;
}

function checkLayerKeys<V extends object>(
  layer: object,
  order: readonly ScopedSettingKey<V>[],
): void {
  for (const name of Object.keys(layer)) {
    if (!order.some(key => key === name)) {
      throw new Error(`Unknown setting field: ${name}`);
    }
  }
}

function copyOverrides<V extends object>(
  fields: ScopedSettingFields<V>,
  order: readonly ScopedSettingKey<V>[],
  layer: ScopedSettingOverrides<V>,
): ScopedSettingOverrides<V> {
  checkLayerKeys(layer, order);
  const result: Partial<V> = {};
  for (const key of order) {
    if (!Object.hasOwn(layer, key)) continue;
    defineValue(result, key, decodeValue(fields, key, layer[key]));
  }
  return Object.freeze(result);
}

function copyDefaults<V extends object>(
  fields: ScopedSettingFields<V>,
  order: readonly ScopedSettingKey<V>[],
  defaults: Readonly<V>,
): Readonly<V> {
  checkLayerKeys(defaults, order);
  const result: Partial<V> = {};
  for (const key of order) {
    if (!Object.hasOwn(defaults, key)) {
      throw new Error(`Missing builtin default: ${key}`);
    }
    defineValue(result, key, decodeValue(fields, key, defaults[key]));
  }
  // Every registered key was populated and validated above.
  return Object.freeze(result as V);
}

export function scopedSettingLocal<
  V extends object,
  K extends ScopedSettingKey<V>,
>(
  layer: ScopedSettingOverrides<V>,
  key: K,
): ScopedSettingLocal<V[K]> {
  if (!Object.hasOwn(layer, key)) return { kind: 'inherit' };
  const value = layer[key];
  if (value === undefined) {
    throw new Error(`Undefined is not a setting value: ${key}`);
  }
  return { kind: 'set', value };
}

export function copyScopedSettingsSnapshot<V extends object>(
  fields: ScopedSettingFields<V>,
  order: readonly ScopedSettingKey<V>[],
  snapshot: ScopedSettingsSnapshot<V>,
): ScopedSettingsSnapshot<V> {
  if (typeof snapshot.projectTrusted !== 'boolean') {
    throw new Error('Invalid project trust state');
  }

  const targets: Record<ScopedSettingsScope, string> = {
    session: snapshot.targets.session,
    project: snapshot.targets.project,
    global: snapshot.targets.global,
  };

  for (const scope of SCOPED_SETTINGS_SCOPES) {
    const target = targets[scope];
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error(`Invalid ${scope} settings target`);
    }
  }

  return Object.freeze({
    defaults: copyDefaults(fields, order, snapshot.defaults),
    managed: copyOverrides(fields, order, snapshot.managed),
    global: copyOverrides(fields, order, snapshot.global),
    project: snapshot.projectTrusted
      ? copyOverrides(fields, order, snapshot.project)
      : Object.freeze({}),
    session: copyOverrides(fields, order, snapshot.session),
    projectTrusted: snapshot.projectTrusted,
    targets: Object.freeze(targets),
  });
}

export function resolveScopedSetting<
  V extends object,
  K extends ScopedSettingKey<V>,
>(
  snapshot: ScopedSettingsSnapshot<V>,
  key: K,
  through: ScopedSettingsThrough,
): ScopedSettingResolved<V[K]> {
  if (through === 'effective' || through === 'session') {
    const local = scopedSettingLocal(snapshot.session, key);
    if (local.kind === 'set') {
      return { value: local.value, origin: 'session' };
    }
  }

  if (
    snapshot.projectTrusted &&
    (
      through === 'effective' ||
      through === 'session' ||
      through === 'project'
    )
  ) {
    const local = scopedSettingLocal(snapshot.project, key);
    if (local.kind === 'set') {
      return { value: local.value, origin: 'project' };
    }
  }

  const global = scopedSettingLocal(snapshot.global, key);
  if (global.kind === 'set') {
    return { value: global.value, origin: 'global' };
  }

  const managed = scopedSettingLocal(snapshot.managed, key);
  if (managed.kind === 'set') {
    return { value: managed.value, origin: 'managed' };
  }

  return { value: snapshot.defaults[key], origin: 'default' };
}

export function resolveScopedSettingsValues<V extends object>(
  fields: ScopedSettingFields<V>,
  order: readonly ScopedSettingKey<V>[],
  snapshot: ScopedSettingsSnapshot<V>,
  through: ScopedSettingsThrough,
): Readonly<V> {
  const result: Partial<V> = {};
  for (const key of order) {
    const resolved = resolveScopedSetting(snapshot, key, through);
    defineValue(
      result,
      key,
      decodeValue(fields, key, resolved.value),
    );
  }
  return Object.freeze(result as V);
}

export function applyScopedSettingsChanges<V extends object>(
  fields: ScopedSettingFields<V>,
  order: readonly ScopedSettingKey<V>[],
  original: ScopedSettingOverrides<V>,
  changes: readonly ScopedSettingChange<V>[],
): ScopedSettingOverrides<V> {
  if (changes.length > order.length) {
    throw new Error('Too many setting changes');
  }

  const result: Partial<V> = {
    ...copyOverrides(fields, order, original),
  };
  const seen = new Set<ScopedSettingKey<V>>();

  for (const change of changes) {
    if (!order.includes(change.key)) {
      throw new Error(`Unknown setting field: ${change.key}`);
    }
    if (seen.has(change.key)) {
      throw new Error(`Duplicate setting change: ${change.key}`);
    }
    seen.add(change.key);

    if (change.op === 'inherit') {
      delete result[change.key];
    } else if (change.op === 'set') {
      defineValue(
        result,
        change.key,
        decodeValue(fields, change.key, change.value),
      );
    } else {
      throw new Error('Invalid setting change operation');
    }
  }

  return Object.freeze(result);
}

export function scopedBooleanField(
  label: string,
  description: string,
): ScopedSettingBooleanField<boolean> {
  return Object.freeze({
    kind: 'boolean',
    label,
    description,
    decode(value: unknown): boolean {
      if (typeof value !== 'boolean') {
        throw new Error('Expected a boolean setting');
      }
      return value;
    },
    equals(left: boolean, right: boolean): boolean {
      return left === right;
    },
    format(value: boolean): string {
      return value ? 'on' : 'off';
    },
    checked(value: boolean): boolean {
      return value;
    },
    toggle(value: boolean): boolean {
      return !value;
    },
  });
}

interface ControllerOperation {
  readonly generation: number;
  readonly kind: 'apply' | 'edit';
  readonly scope: ScopedSettingsScope;
  readonly target: string;
  started: boolean;
}

type RefreshOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed'; readonly message: string };

export class ScopedSettingsController<V extends object>
  implements ScopedSettingsPort {
  private readonly options: ScopedSettingsControllerOptions<V>;
  private readonly order: readonly ScopedSettingKey<V>[];

  private readonly drafts: Record<
    ScopedSettingsScope,
    Map<ScopedSettingKey<V>, ScopedSettingChange<V>>
  > = {
    session: new Map<ScopedSettingKey<V>, ScopedSettingChange<V>>(),
    project: new Map<ScopedSettingKey<V>, ScopedSettingChange<V>>(),
    global: new Map<ScopedSettingKey<V>, ScopedSettingChange<V>>(),
  };

  private readonly draftTargets:
    Record<ScopedSettingsScope, string | null> = {
      session: null,
      project: null,
      global: null,
    };

  private snapshot: ScopedSettingsSnapshot<V>;
  private live = true;
  private selected = 0;
  private selectedScope: ScopedSettingsScope = 'session';
  private generation = 0;
  private operation: ControllerOperation | null = null;
  private message =
    'Unsaved changes are discarded when this dialog closes.';

  constructor(options: ScopedSettingsControllerOptions<V>) {
    this.options = options;
    this.order = Object.freeze([...options.order]);

    if (this.order.length === 0) {
      throw new Error('Settings require at least one field');
    }

    if (new Set(this.order).size !== this.order.length) {
      throw new Error('Duplicate settings field in display order');
    }

    const registered = Object.keys(options.fields);
    if (
      registered.length !== this.order.length ||
      !registered.every(name => this.order.some(key => key === name))
    ) {
      throw new Error('Settings order must contain every field exactly once');
    }

    this.snapshot = this.readSnapshot();
  }

  get active(): boolean {
    return this.live;
  }

  get busy(): boolean {
    return this.live && this.operation !== null;
  }

  private ready(): boolean {
    return this.live && this.operation === null;
  }

  private readSnapshot(): ScopedSettingsSnapshot<V> {
    return copyScopedSettingsSnapshot(
      this.options.fields,
      this.order,
      this.options.adapter.read(),
    );
  }

  private currentKey(): ScopedSettingKey<V> {
    const key = this.order[this.selected];
    if (key === undefined) {
      throw new Error('Invalid settings selection');
    }
    return key;
  }

  private cloneChange(
    change: ScopedSettingChange<V>,
  ): ScopedSettingChange<V> {
    if (change.op === 'inherit') {
      return Object.freeze({
        key: change.key,
        op: 'inherit',
      }) as ScopedSettingChange<V>;
    }

    // The key and decoded value remain correlated. TypeScript loses that
    // mapped-union correlation while reconstructing a generic union member.
    return Object.freeze({
      key: change.key,
      op: 'set',
      value: decodeValue(
        this.options.fields,
        change.key,
        change.value,
      ),
    }) as ScopedSettingChange<V>;
  }

  pending(
    scope: ScopedSettingsScope,
  ): readonly ScopedSettingChange<V>[] {
    return Object.freeze(
      [...this.drafts[scope].values()].map(change =>
        this.cloneChange(change)),
    );
  }

  dirty(scope: ScopedSettingsScope): boolean {
    return this.drafts[scope].size > 0;
  }

  private scopeReason(scope: ScopedSettingsScope): string {
    if (!this.live) return 'Settings are closed.';

    if (scope === 'project' && !this.snapshot.projectTrusted) {
      return 'Project settings require a trusted project.';
    }

    const pinned = this.draftTargets[scope];
    if (
      this.dirty(scope) &&
      pinned !== null &&
      pinned !== this.snapshot.targets[scope]
    ) {
      return (
        'This draft belongs to another target. ' +
        'Close and reopen settings to discard it.'
      );
    }

    return '';
  }

  private canStage(scope: ScopedSettingsScope): boolean {
    const reason = this.scopeReason(scope);
    if (reason === '') return true;
    this.message = reason;
    return false;
  }

  private previewInternal(): ScopedSettingsSnapshot<V> {
    const scope = this.selectedScope;
    const target = this.draftTargets[scope];

    if (
      !this.dirty(scope) ||
      target !== this.snapshot.targets[scope] ||
      (scope === 'project' && !this.snapshot.projectTrusted)
    ) {
      return this.snapshot;
    }

    const layers: Record<
      ScopedSettingsScope,
      ScopedSettingOverrides<V>
    > = {
      session: this.snapshot.session,
      project: this.snapshot.project,
      global: this.snapshot.global,
    };

    layers[scope] = applyScopedSettingsChanges(
      this.options.fields,
      this.order,
      layers[scope],
      this.pending(scope),
    );

    return {
      ...this.snapshot,
      ...layers,
    };
  }

  preview(): ScopedSettingsSnapshot<V> {
    return copyScopedSettingsSnapshot(
      this.options.fields,
      this.order,
      this.previewInternal(),
    );
  }

  state(): ScopedSettingsState {
    const preview = this.previewInternal();
    const effective = resolveScopedSettingsValues(
      this.options.fields,
      this.order,
      preview,
      'effective',
    );

    const rows = this.order.map((key): ScopedSettingsRow => {
      const field = fieldAt(this.options.fields, key);
      const local = scopedSettingLocal(
        preview[this.selectedScope],
        key,
      );
      const through = resolveScopedSetting(
        preview,
        key,
        this.selectedScope,
      );
      const actual = resolveScopedSetting(
        preview,
        key,
        'effective',
      );

      return Object.freeze({
        id: key,
        kind: field.kind,
        label: plainText(field.label),
        description: plainText(field.description),
        checked: field.kind === 'boolean'
          ? field.checked(through.value)
          : null,
        localSet: local.kind === 'set',
        localText: local.kind === 'set'
          ? plainText(field.format(local.value))
          : 'inherit',
        throughText: plainText(field.format(through.value)),
        effectiveText: plainText(field.format(actual.value)),
        origin: actual.origin,
        inactive: plainText(this.options.inactive(key, effective)),
      });
    });

    const scopes = SCOPED_SETTINGS_SCOPES.map(
      (scope): ScopedSettingsScopeState => {
        const reason = this.scopeReason(scope);
        return Object.freeze({
          scope,
          dirty: this.dirty(scope),
          editable: reason === '' && !this.busy,
          reason: plainText(reason),
          target: plainText(this.snapshot.targets[scope]),
        });
      },
    );

    return Object.freeze({
      active: this.live,
      busy: this.busy,
      scope: this.selectedScope,
      selectedIndex: this.selected,
      rows: Object.freeze(rows),
      scopes: Object.freeze(scopes),
      projectTrusted: preview.projectTrusted,
      notice: plainText(this.message),
    });
  }

  setNotice(message: string): void {
    if (this.live) this.message = plainText(message).slice(0, 2000);
  }

  select(index: number): void {
    if (!this.ready() || !Number.isFinite(index)) return;
    this.selected = Math.max(
      0,
      Math.min(this.order.length - 1, Math.trunc(index)),
    );
  }

  selectScope(scope: ScopedSettingsScope): void {
    if (!this.ready()) return;
    if (!SCOPED_SETTINGS_SCOPES.includes(scope)) return;
    this.selectedScope = scope;
  }

  cycleScope(delta: number): void {
    if (!this.ready() || !Number.isFinite(delta)) return;
    const count = SCOPED_SETTINGS_SCOPES.length;
    const current = SCOPED_SETTINGS_SCOPES.indexOf(this.selectedScope);
    const index = (
      ((current + Math.trunc(delta)) % count) + count
    ) % count;
    const next = SCOPED_SETTINGS_SCOPES[index];
    if (next !== undefined) this.selectedScope = next;
  }

  private stage<K extends ScopedSettingKey<V>>(
    scope: ScopedSettingsScope,
    key: K,
    change: ScopedSettingLocal<V[K]>,
  ): void {
    if (!this.live || !this.canStage(scope)) return;

    const field = fieldAt(this.options.fields, key);
    const original = scopedSettingLocal(this.snapshot[scope], key);

    const next: ScopedSettingLocal<V[K]> =
      change.kind === 'inherit'
        ? { kind: 'inherit' }
        : {
            kind: 'set',
            value: decodeValue(
              this.options.fields,
              key,
              change.value,
            ),
          };

    const unchanged =
      next.kind === 'inherit'
        ? original.kind === 'inherit'
        : original.kind === 'set' &&
          field.equals(original.value, next.value);

    if (unchanged) {
      this.drafts[scope].delete(key);
    } else {
      const retained = next.kind === 'inherit'
        ? { key, op: 'inherit' as const }
        : { key, op: 'set' as const, value: next.value };

      // key and next.value are correlated by this generic method.
      this.drafts[scope].set(
        key,
        Object.freeze(retained) as ScopedSettingChange<V>,
      );
    }

    this.draftTargets[scope] = this.dirty(scope)
      ? this.snapshot.targets[scope]
      : null;

    this.message =
      `Draft changed in ${scope}; Apply saves only this scope.`;
  }

  toggleSelected(): void {
    if (!this.ready() || !this.canStage(this.selectedScope)) return;

    try {
      const key = this.currentKey();
      const field = fieldAt(this.options.fields, key);

      if (field.kind !== 'boolean') {
        this.message = 'Use Enter or e to edit this complete value.';
        return;
      }

      const through = resolveScopedSetting(
        this.previewInternal(),
        key,
        this.selectedScope,
      );

      this.stage(this.selectedScope, key, {
        kind: 'set',
        value: field.toggle(through.value),
      });
    } catch (error) {
      this.message = `Draft unchanged: ${errorText(error)}`;
    }
  }

  inheritSelected(): void {
    if (!this.ready() || !this.canStage(this.selectedScope)) return;
    try {
      this.stage(
        this.selectedScope,
        this.currentKey(),
        { kind: 'inherit' },
      );
    } catch (error) {
      this.message = `Draft unchanged: ${errorText(error)}`;
    }
  }

  reload(): boolean {
    if (!this.ready()) return false;

    try {
      const next = this.readSnapshot();
      if (!this.ready()) return false;
      this.snapshot = next;

      const moved = SCOPED_SETTINGS_SCOPES.some(scope => {
        const target = this.draftTargets[scope];
        return this.dirty(scope) &&
          target !== null &&
          target !== next.targets[scope];
      });

      this.message = moved
        ? (
            'Saved settings reloaded. A draft belongs to an old target; ' +
            'it will not be applied or previewed at the new target.'
          )
        : 'Saved settings reloaded; unsaved drafts retained.';
      return true;
    } catch (error) {
      this.message = `Reload failed: ${errorText(error)}`;
      return false;
    }
  }

  private isCurrent(operation: ControllerOperation): boolean {
    return this.live &&
      this.operation === operation &&
      this.generation === operation.generation;
  }

  private refreshOperation(
    operation: ControllerOperation,
  ): RefreshOutcome {
    try {
      const next = this.readSnapshot();
      if (!this.isCurrent(operation)) return { kind: 'stale' };
      this.snapshot = next;
      return { kind: 'ok' };
    } catch (error) {
      if (!this.isCurrent(operation)) return { kind: 'stale' };
      return { kind: 'failed', message: errorText(error) };
    }
  }

  private operationReason(operation: ControllerOperation): string {
    if (
      this.snapshot.targets[operation.scope] !== operation.target
    ) {
      return (
        `${operation.scope} target changed while the action was open.`
      );
    }

    if (
      operation.scope === 'project' &&
      !this.snapshot.projectTrusted
    ) {
      return 'The project is no longer trusted.';
    }

    return this.scopeReason(operation.scope);
  }

  private reserve(
    kind: 'apply' | 'edit',
    scope: ScopedSettingsScope,
    target: string,
    work: (
      operation: ControllerOperation,
      signal: AbortSignal,
    ) => Promise<void>,
  ): ScopedSettingsAction {
    this.generation += 1;

    const operation: ControllerOperation = {
      generation: this.generation,
      kind,
      scope,
      target,
      started: false,
    };

    this.operation = operation;

    return Object.freeze({
      kind,
      run: (signal: AbortSignal): Promise<void> =>
        this.runOperation(operation, signal, work),
    });
  }

  private async runOperation(
    operation: ControllerOperation,
    signal: AbortSignal,
    work: (
      operation: ControllerOperation,
      signal: AbortSignal,
    ) => Promise<void>,
  ): Promise<void> {
    if (!this.isCurrent(operation) || operation.started) return;
    operation.started = true;

    try {
      if (signal.aborted) {
        this.message = 'Action cancelled; drafts retained.';
        return;
      }

      await work(operation, signal);
    } catch (error) {
      if (!this.isCurrent(operation)) return;

      this.message = operation.kind === 'apply'
        ? (
            `Apply stopped: ${errorText(error)}. ` +
            'Storage may already have changed; draft retained. ' +
            'Reload and review before retrying.'
          )
        : `Edit failed; existing drafts retained: ${errorText(error)}`;
    } finally {
      if (this.isCurrent(operation)) this.operation = null;
    }
  }

  beginEdit(): ScopedSettingsAction | null {
    if (!this.ready() || !this.canStage(this.selectedScope)) {
      return null;
    }

    const key = this.currentKey();
    const field = fieldAt(this.options.fields, key);

    if (field.kind !== 'value') {
      this.message = 'Use Space or Enter to toggle this boolean.';
      return null;
    }

    const scope = this.selectedScope;
    return this.reserve(
      'edit',
      scope,
      this.snapshot.targets[scope],
      (operation, signal) =>
        this.performEdit(operation, key, signal),
    );
  }

  private async performEdit<K extends ScopedSettingKey<V>>(
    operation: ControllerOperation,
    key: K,
    signal: AbortSignal,
  ): Promise<void> {
    const before = this.refreshOperation(operation);
    if (before.kind === 'stale') return;
    if (before.kind === 'failed') {
      this.message = `Editor not opened: ${before.message}`;
      return;
    }

    const reason = this.operationReason(operation);
    if (reason !== '') {
      this.message = `${reason} Draft retained.`;
      return;
    }

    if (signal.aborted || !this.isCurrent(operation)) return;

    const field = fieldAt(this.options.fields, key);
    if (field.kind !== 'value') {
      this.message = 'This field does not have a value editor.';
      return;
    }

    const value = resolveScopedSetting(
      this.previewInternal(),
      key,
      operation.scope,
    ).value;

    const result = await field.edit({
      scope: operation.scope,
      target: operation.target,
      value: decodeValue(this.options.fields, key, value),
      signal,
    });

    if (!this.isCurrent(operation)) return;
    if (signal.aborted) {
      this.message = 'Edit cancelled; existing drafts retained.';
      return;
    }

    const after = this.refreshOperation(operation);
    if (after.kind === 'stale') return;
    if (after.kind === 'failed') {
      this.message =
        `Edited value not staged; refresh failed: ${after.message}`;
      return;
    }

    const afterReason = this.operationReason(operation);
    if (afterReason !== '') {
      this.message = `${afterReason} Edited value not staged.`;
      return;
    }

    if (!this.isCurrent(operation) || signal.aborted) return;

    if (result.kind === 'cancel') {
      this.message = 'Edit cancelled; existing drafts retained.';
      return;
    }

    if (result.kind !== 'set') {
      throw new Error('Invalid editor result');
    }

    this.stage(operation.scope, key, {
      kind: 'set',
      value: result.value,
    });
  }

  beginApply(): ScopedSettingsAction | null {
    if (!this.ready()) return null;

    const scope = this.selectedScope;
    if (!this.dirty(scope)) {
      this.message = `No unsaved changes in ${scope}.`;
      return null;
    }

    if (!this.canStage(scope)) return null;

    const target = this.draftTargets[scope];
    if (target === null) {
      this.message = 'Draft target is unavailable; close and reopen settings.';
      return null;
    }

    return this.reserve(
      'apply',
      scope,
      target,
      (operation, signal) =>
        this.performApply(operation, signal),
    );
  }

  private changesMatch(
    scope: ScopedSettingsScope,
    changes: readonly ScopedSettingChange<V>[],
  ): boolean {
    const layer = this.snapshot[scope];

    return changes.every(change => {
      const local = scopedSettingLocal(layer, change.key);
      if (change.op === 'inherit') return local.kind === 'inherit';
      if (local.kind !== 'set') return false;

      return fieldAt(this.options.fields, change.key).equals(
        local.value,
        change.value,
      );
    });
  }

  private async performApply(
    operation: ControllerOperation,
    signal: AbortSignal,
  ): Promise<void> {
    const before = this.refreshOperation(operation);
    if (before.kind === 'stale') return;
    if (before.kind === 'failed') {
      this.message =
        `Apply not started; refresh failed: ${before.message}. ` +
        'Draft retained.';
      return;
    }

    const reason = this.operationReason(operation);
    if (reason !== '') {
      this.message = `${reason} Apply not started; draft retained.`;
      return;
    }

    if (!this.isCurrent(operation)) return;

    if (signal.aborted) {
      this.message =
        'Apply cancelled before storage was called; draft retained.';
      return;
    }

    const submitted = this.pending(operation.scope);
    if (submitted.length === 0) {
      this.message = `No unsaved changes in ${operation.scope}.`;
      return;
    }

    let failed = false;
    let failureMessage = '';

    try {
      await this.options.adapter.apply(
        operation.scope,
        submitted,
        signal,
      );
    } catch (error) {
      failed = true;
      failureMessage = errorText(error);
    }

    // This check includes interaction generation and permanent disposal.
    // Even a misbehaving late adapter result cannot mutate this controller.
    if (!this.isCurrent(operation)) return;

    const after = this.refreshOperation(operation);
    if (after.kind === 'stale') return;

    if (failed) {
      const refreshMessage = after.kind === 'failed'
        ? ` Saved state could not be refreshed: ${after.message}.`
        : ' Saved state was refreshed.';

      this.message =
        `Apply did not complete: ${failureMessage}.` +
        refreshMessage +
        ' Storage may already have changed; draft retained. ' +
        'Review before retrying.';
      return;
    }

    if (after.kind === 'failed') {
      this.message =
        'Apply completed, but saved state could not be verified: ' +
        `${after.message}. Draft retained; do not retry blindly.`;
      return;
    }

    if (!this.isCurrent(operation)) return;

    if (signal.aborted) {
      this.message =
        'Apply returned after cancellation; saved state was refreshed. ' +
        'Draft retained; check storage before retrying.';
      return;
    }

    const afterReason = this.operationReason(operation);
    if (afterReason !== '') {
      this.message =
        `Apply completed, but ${afterReason} ` +
        'Changes may already have been saved; draft retained. ' +
        'Reopen and review the original target.';
      return;
    }

    if (!this.changesMatch(operation.scope, submitted)) {
      this.message =
        'Apply returned, but saved settings differ from the submitted draft. ' +
        'Draft retained; review saved settings before retrying.';
      return;
    }

    this.drafts[operation.scope].clear();
    this.draftTargets[operation.scope] = null;
    this.message =
      `Saved ${operation.scope}; other scopes' drafts retained.`;

    try {
      this.options.adapter.applied(
        copyScopedSettingsSnapshot(
          this.options.fields,
          this.order,
          this.snapshot,
        ),
        operation.scope,
      );
    } catch (error) {
      if (!this.isCurrent(operation)) return;
      this.message =
        `Saved ${operation.scope}, but post-save refresh failed: ` +
        errorText(error);
    }
  }

  dispose(): void {
    if (!this.live) return;

    this.live = false;
    this.generation += 1;
    this.operation = null;

    for (const scope of SCOPED_SETTINGS_SCOPES) {
      this.drafts[scope].clear();
      this.draftTargets[scope] = null;
    }
  }
}
