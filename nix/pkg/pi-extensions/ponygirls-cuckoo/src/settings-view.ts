import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type TuiMouseEvent,
} from '@earendil-works/pi-tui';
import {
  CustomViewToggle,
  PanelLayout,
  fit,
  frameTitle,
  hintAt,
  keyHints,
  type PanelParts,
  type Span,
  type UiTheme,
} from '@ponygirls/pi-ui';
import { FEATURES, featureActivation, type FeatureId } from './features.ts';
import {
  applyPreferenceChanges,
  changeKey,
  resolvePreferences,
  throughScope,
  type CuckooPreferences,
  type EffectivePreferences,
  type PreferenceChange,
  type PreferenceContext,
  type PreferenceOverrides,
  type PreferenceScope,
  type PreferenceSnapshot,
  type PreferenceSource,
} from './preferences.ts';
import { policyText, type GrowthPolicy } from './policy.ts';
import { terminalText } from './presentation.ts';

const SCOPES: readonly PreferenceScope[] = Object.freeze([
  'session', 'project', 'global',
]);

export interface PolicyEditRequest {
  readonly scope: PreferenceScope;
  readonly value: GrowthPolicy;
}

/**
 * The editor returns a complete policy, or undefined on cancellation.
 * It must honor signal by closing any UI it owns.
 * Returning a policy stages it; it does not save it.
 */
export interface PolicyEditor {
  (request: PolicyEditRequest & { readonly signal: AbortSignal }):
    Promise<GrowthPolicy | undefined>;
}

export interface SettingsCallbacks {
  read(): PreferenceSnapshot;
  apply(scope: PreferenceScope, changes: readonly PreferenceChange[]): void;
  applied(snapshot: PreferenceSnapshot, scope: PreferenceScope): void;
  editPolicy: PolicyEditor;
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
    apply: (scope, changes) => preferences.apply(context, scope, changes),
    applied,
    editPolicy,
  };
}

export type SettingsRow =
  | {
      readonly field: 'enabled';
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly field: 'feature';
      readonly id: FeatureId;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly field: 'policy';
      readonly label: string;
      readonly description: string;
    };

function errorText(error: unknown): string {
  return terminalText(String(error)).slice(0, 2000);
}

function resetChange(row: SettingsRow): PreferenceChange {
  if (row.field === 'feature') {
    return { field: 'feature', id: row.id, value: null };
  }
  if (row.field === 'policy') return { field: 'policy', value: null };
  return { field: 'enabled', value: null };
}

function localValue(
  overrides: PreferenceOverrides,
  row: SettingsRow,
): boolean | GrowthPolicy | undefined {
  if (row.field === 'enabled') return overrides.enabled;
  if (row.field === 'policy') return overrides.policy;
  return overrides.features === undefined
    ? undefined
    : overrides.features[row.id];
}

function resolvedValue(
  preferences: EffectivePreferences,
  row: SettingsRow,
): boolean | GrowthPolicy {
  if (row.field === 'enabled') return preferences.enabled;
  if (row.field === 'policy') return preferences.policy;
  return preferences.features[row.id];
}

function sourceOf(
  preferences: EffectivePreferences,
  row: SettingsRow,
): PreferenceSource {
  if (row.field === 'enabled') return preferences.enabledSource;
  if (row.field === 'policy') return preferences.policySource;
  return preferences.featureSources[row.id];
}

function valueText(value: boolean | GrowthPolicy | undefined): string {
  if (value === undefined) return 'inherit';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return policyText(value);
}

function sameValue(
  original: boolean | GrowthPolicy | undefined,
  next: boolean | GrowthPolicy | null,
): boolean {
  if (next === null) return original === undefined;
  if (typeof next === 'boolean') return original === next;
  return original !== undefined &&
    typeof original !== 'boolean' &&
    original.kind === next.kind &&
    original.value === next.value;
}

/** Public controller: no terminal or SDK-private state is needed to test it. */
export class SettingsController {
  readonly rows: readonly SettingsRow[];
  private readonly callbacks: SettingsCallbacks;
  private readonly drafts: Record<
    PreferenceScope,
    Map<string, PreferenceChange>
  > = {
    session: new Map(),
    project: new Map(),
    global: new Map(),
  };
  private snapshot: PreferenceSnapshot;
  private live = true;
  private selected = 0;
  private selectedScope: PreferenceScope = 'session';
  private message = 'Unsaved changes are discarded when this dialog closes.';

  constructor(callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;
    this.snapshot = callbacks.read();
    this.rows = [
      {
        field: 'enabled',
        label: 'Automatic mode (master)',
        description:
          'Controls automatic checkpoints and new features. Saved recall/history ' +
          'and explicitly requested manual inquiries remain available while off.',
      },
      ...FEATURES.map((feature): SettingsRow => ({
        field: 'feature',
        id: feature.id,
        label: feature.label,
        description: feature.description,
      })),
      {
        field: 'policy',
        label: 'Growth policy',
        description:
          'Kind and value are one setting. Enter or p opens the policy editor; ' +
          'the returned policy remains a draft until Apply.',
      },
    ];
  }

  get active(): boolean { return this.live; }
  get scope(): PreferenceScope { return this.selectedScope; }
  get selectedIndex(): number { return this.selected; }
  get notice(): string { return this.message; }

  currentRow(): SettingsRow {
    const row = this.rows[this.selected];
    if (row === undefined) throw new Error('Invalid Cuckoo settings selection');
    return row;
  }

  setNotice(message: string): void {
    if (this.live) this.message = terminalText(message);
  }

  select(index: number): void {
    if (!this.live) return;
    this.selected = Math.max(
      0,
      Math.min(this.rows.length - 1, Math.trunc(index)),
    );
  }

  selectScope(scope: PreferenceScope): void {
    if (!this.live) return;
    this.selectedScope = scope;
  }

  cycleScope(delta: number): void {
    if (!this.live) return;
    const index = SCOPES.indexOf(this.selectedScope);
    const next = (index + delta + SCOPES.length) % SCOPES.length;
    const scope = SCOPES[next];
    if (scope !== undefined) this.selectedScope = scope;
  }

  pending(scope: PreferenceScope): readonly PreferenceChange[] {
    return [...this.drafts[scope].values()];
  }

  dirty(scope: PreferenceScope): boolean {
    return this.drafts[scope].size > 0;
  }

  /**
   * Only the selected tab's draft participates in preview.
   * Unsaved changes in other tabs are retained, not treated as committed.
   */
  preview(): PreferenceSnapshot {
    const layers = {
      global: this.snapshot.global,
      project: this.snapshot.project,
      session: this.snapshot.session,
    };
    layers[this.selectedScope] = applyPreferenceChanges(
      layers[this.selectedScope],
      this.pending(this.selectedScope),
    );
    return {
      ...this.snapshot,
      ...layers,
      effective: resolvePreferences(layers),
    };
  }

  editable(scope: PreferenceScope): boolean {
    if (!this.live) return false;
    if (scope === 'project' && !this.snapshot.projectTrusted) {
      this.message = 'Project settings require a trusted project.';
      return false;
    }
    return true;
  }

  private stage(scope: PreferenceScope, change: PreferenceChange): void {
    if (!this.editable(scope)) return;
    // Validate before retaining a callback-provided policy.
    applyPreferenceChanges(this.snapshot[scope], [change]);
    const key = changeKey(change);
    let original: boolean | GrowthPolicy | undefined;
    if (change.field === 'enabled') {
      original = this.snapshot[scope].enabled;
    } else if (change.field === 'policy') {
      original = this.snapshot[scope].policy;
    } else {
      const features = this.snapshot[scope].features;
      original = features === undefined ? undefined : features[change.id];
    }
    if (sameValue(original, change.value)) this.drafts[scope].delete(key);
    else this.drafts[scope].set(key, change);
    this.message = `Draft changed in ${scope}; Apply saves only this scope.`;
  }

  toggleSelected(): void {
    if (!this.editable(this.selectedScope)) return;
    const row = this.currentRow();
    if (row.field === 'policy') {
      this.message = 'Use Enter or p to edit the complete growth policy.';
      return;
    }
    const scoped = throughScope(this.preview(), this.selectedScope);
    if (row.field === 'enabled') {
      this.stage(this.selectedScope, {
        field: 'enabled',
        value: !scoped.enabled,
      });
    } else {
      this.stage(this.selectedScope, {
        field: 'feature',
        id: row.id,
        value: !scoped.features[row.id],
      });
    }
  }

  resetSelected(): void {
    if (!this.live) return;
    this.stage(this.selectedScope, resetChange(this.currentRow()));
  }

  policyRequest(): PolicyEditRequest | undefined {
    if (!this.editable(this.selectedScope)) return undefined;
    const policy = throughScope(this.preview(), this.selectedScope).policy;
    return { scope: this.selectedScope, value: { ...policy } };
  }

  stagePolicy(scope: PreferenceScope, policy: GrowthPolicy): void {
    if (!this.live) return;
    this.stage(scope, { field: 'policy', value: { ...policy } });
  }

  reload(): boolean {
    if (!this.live) return false;
    try {
      this.snapshot = this.callbacks.read();
      this.message = 'Saved settings reloaded; unsaved drafts retained.';
      return true;
    } catch (error) {
      this.message = `Reload failed: ${errorText(error)}`;
      return false;
    }
  }

  applySelected(): void {
    if (!this.live) return;
    const scope = this.selectedScope;
    const changes = this.pending(scope);
    if (changes.length === 0) {
      this.message = `No unsaved changes in ${scope}.`;
      return;
    }
    // Refresh trust and external changes immediately before committing.
    if (!this.reload() || !this.editable(scope)) return;
    try {
      this.callbacks.apply(scope, changes);
    } catch (error) {
      this.message = `Save failed; draft retained: ${errorText(error)}`;
      return;
    }
    this.drafts[scope].clear();
    this.message = `Saved ${scope}; other scopes' drafts retained.`;
    try {
      this.snapshot = this.callbacks.read();
      this.callbacks.applied(this.snapshot, scope);
    } catch (error) {
      this.message = `Saved ${scope}, but refresh failed: ${errorText(error)}`;
    }
  }

  dispose(): void {
    this.live = false;
    for (const scope of SCOPES) this.drafts[scope].clear();
  }
}

export interface SettingsKeybindings {
  matches(
    data: string,
    action:
      | 'tui.select.up'
      | 'tui.select.down'
      | 'tui.select.confirm'
      | 'tui.select.cancel',
  ): boolean;
}

export interface SettingsPanelOptions {
  readonly controller: SettingsController;
  readonly theme: UiTheme;
  readonly keys: SettingsKeybindings;
  readonly requestRender: () => void;
  readonly cancel: () => void;
  readonly editPolicy: (request: PolicyEditRequest) => void;
}

type PointerAction = { kind: 'scope'; scope: PreferenceScope } | { kind: 'row' | 'hint'; index: number };

interface SettingsFrame {
  headerRows: number;
  footerRows: number;
  tabs: readonly Span[];
  hints: readonly (readonly Span[])[];
}

/** Uses structural allocation; it never subtracts terminal/footer rows itself. */
export class SettingsPanel extends PanelLayout {
  readonly capturesViewportInput = true;
  private readonly options: SettingsPanelOptions;
  private live = true;
  private revealSelection = true;
  private lastWidth = -1;
  private lastHeight = -1;
  private hitGeometry: SettingsFrame = {
    headerRows: 0,
    footerRows: 0,
    tabs: [],
    hints: [],
  };

  constructor(options: SettingsPanelOptions) {
    super(width => this.buildParts(width));
    this.options = options;
  }

  private usable(): boolean {
    return this.live && this.options.controller.active;
  }

  private changed(reveal: boolean): void {
    if (!this.usable()) return;
    this.revealSelection = reveal;
    this.invalidate();
    this.options.requestRender();
  }

  private editPolicy(): void {
    if (!this.usable()) return;
    const request = this.options.controller.policyRequest();
    if (request !== undefined) this.options.editPolicy(request);
    else this.changed(false);
  }

  private activateSelected(): void {
    if (!this.usable()) return;
    if (this.options.controller.currentRow().field === 'policy') {
      this.editPolicy();
    } else {
      this.options.controller.toggleSelected();
      this.changed(true);
    }
  }

  private featureStatus(
    preferences: EffectivePreferences,
    id: FeatureId,
  ): string {
    const activation = featureActivation(
      preferences.enabled,
      preferences.features,
      id,
    );
    return activation.activeBySettings
      ? 'ready by settings'
      : `inactive: ${activation.reasons.join(', ')}`;
  }

  private buildParts(width: number): PanelParts {
    const w = Math.max(1, Math.floor(width));
    const { controller, theme } = this.options;
    const snapshot = controller.preview();
    const scoped = throughScope(snapshot, controller.scope);
    const effective = snapshot.effective;
    const scopeIndex = SCOPES.indexOf(controller.scope);
    const title = frameTitle(theme, w, {
      title: 'Cuckoo settings',
      tabs: {
        active: scopeIndex,
        labels: SCOPES.map(scope =>
          `${scope}${controller.dirty(scope) ? '*' : ''}`),
      },
    }, 'none');

    const header = [
      title.line,
      ...wrapTextWithAnsi(
        theme.fg('muted',
          'Checkboxes are settings, not permission to transmit data.'),
        w,
      ),
      ...wrapTextWithAnsi(
        theme.fg('dim',
          "Preview includes this tab's draft, not other tabs' unsaved edits."),
        w,
      ),
    ];

    const labelWidth = Math.max(4, Math.min(28, w - 42));
    const body = controller.rows.map((row, index) => {
      const selected = index === controller.selectedIndex;
      const local = localValue(snapshot[controller.scope], row);
      const desired = resolvedValue(scoped, row);
      const actual = resolvedValue(effective, row);
      const source = sourceOf(effective, row);
      let line: string;
      if (row.field === 'policy') {
        line = `${selected ? '>' : ' '} [>] ${row.label}: ` +
          `${valueText(desired)} · local ${local === undefined ? 'inherit' : 'set'}` +
          ` · effective ${valueText(actual)} (${source})`;
      } else {
        const status = row.field === 'feature'
          ? this.featureStatus(effective, row.id)
          : effective.enabled ? 'automatic on' : 'automatic off';
        line = `${selected ? '>' : ' '} [${desired === true ? 'x' : ' '}] ` +
          `${fit(row.label, labelWidth)} ${fit(valueText(local), 7)} ` +
          `${fit(`${valueText(actual)}@${source}`, 18)} ${status}`;
      }
      const clipped = truncateToWidth(line, w, '…');
      return selected
        ? theme.bg('selectedBg', theme.fg('text', clipped))
        : theme.fg('text', clipped);
    });

    const row = controller.currentRow();
    const local = localValue(snapshot[controller.scope], row);
    const source = sourceOf(effective, row);
    const details = [
      row.description,
      `Local ${controller.scope}: ${valueText(local)}; through this scope: ` +
        `${valueText(resolvedValue(scoped, row))}.`,
      `Effective: ${valueText(resolvedValue(effective, row))} (${source}).`,
      row.field === 'feature'
        ? this.featureStatus(effective, row.id)
        : row.field === 'enabled'
          ? 'Manual inquiry and passive recall/history remain available while off.'
          : 'Use r to inherit the complete policy; p edits kind and value together.',
      `Scope target: ${terminalText(snapshot.paths[controller.scope])}`,
    ];
    if (!snapshot.projectTrusted) {
      details.push('Project settings are ignored: project is not trusted.');
    }
    body.push('');
    for (const detail of details) {
      body.push(...wrapTextWithAnsi(theme.fg('muted', detail), w));
    }
    body.push(
      '',
      ...wrapTextWithAnsi(theme.fg('muted', controller.notice), w),
    );

    const hints = keyHints(theme, w, [
      { key: '↑↓', action: 'select' },
      { key: 'Tab', action: 'scope' },
      { key: 'Space', action: 'toggle' },
      { key: 'r', action: 'inherit' },
      { key: 'p', action: 'policy' },
      { key: 'Ctrl-S', action: 'apply scope' },
      { key: 'PgUp/Dn', action: 'scroll' },
      { key: 'l', action: 'reload' },
      { key: 'Esc', action: 'cancel drafts' },
    ]);
    const footer = [
      truncateToWidth(theme.fg('muted', controller.notice), w, '…'),
      ...hints.lines,
    ];
    this.hitGeometry = {
      headerRows: header.length,
      footerRows: footer.length,
      tabs: title.tabSpans,
      hints: hints.spans,
    };

    if (!this.isMeasuring && this.hasAllocatedHeight) {
      const height = this.bodyScroll.viewportHeight;
      if (this.lastWidth !== w || this.lastHeight !== height) {
        this.revealSelection = true;
      }
      this.lastWidth = w;
      this.lastHeight = height;
      if (this.revealSelection && height > 0) {
        const selected = controller.selectedIndex;
        const top = this.bodyScroll.scrollTop;
        if (selected < top) this.bodyScroll.scrollTo(selected);
        else if (selected >= top + height) {
          this.bodyScroll.scrollTo(selected - height + 1);
        }
        this.revealSelection = false;
      }
    }
    return { header, body, footer };
  }

  handleInput(data: string): void {
    if (!this.usable()) return;
    const { controller, keys } = this.options;
    if (keys.matches(data, 'tui.select.cancel') || data === 'q') {
      this.options.cancel();
      return;
    }
    if (keys.matches(data, 'tui.select.up')) {
      controller.select(controller.selectedIndex - 1);
    } else if (keys.matches(data, 'tui.select.down')) {
      controller.select(controller.selectedIndex + 1);
    } else if (matchesKey(data, Key.home)) {
      controller.select(0);
    } else if (matchesKey(data, Key.end)) {
      controller.select(controller.rows.length - 1);
    } else if (
      matchesKey(data, Key.pageUp) ||
      matchesKey(data, Key.pageDown)
    ) {
      const direction = matchesKey(data, Key.pageUp) ? -1 : 1;
      this.bodyScroll.scrollBy(
        direction * Math.max(1, this.bodyScroll.viewportHeight - 1),
      );
      this.changed(false);
      return;
    } else if (
      matchesKey(data, Key.tab) ||
      matchesKey(data, Key.right)
    ) {
      controller.cycleScope(1);
    } else if (matchesKey(data, Key.left)) {
      controller.cycleScope(-1);
    } else if (
      data === ' ' ||
      keys.matches(data, 'tui.select.confirm')
    ) {
      this.activateSelected();
      return;
    } else if (data === 'r') {
      controller.resetSelected();
    } else if (data === 'p') {
      this.editPolicy();
      return;
    } else if (matchesKey(data, Key.ctrl('s'))) {
      controller.applySelected();
    } else if (data === 'l') {
      controller.reload();
    } else {
      return;
    }
    this.changed(true);
  }

  private runHint(index: number): void {
    const controller = this.options.controller;
    if (index === 0) controller.select(controller.selectedIndex + 1);
    else if (index === 1) controller.cycleScope(1);
    else if (index === 2) { this.activateSelected(); return; }
    else if (index === 3) controller.resetSelected();
    else if (index === 4) { this.editPolicy(); return; }
    else if (index === 5) controller.applySelected();
    else if (index === 6) {
      this.bodyScroll.scrollBy(Math.max(1, this.bodyScroll.viewportHeight - 1));
      this.changed(false);
      return;
    } else if (index === 7) controller.reload();
    else if (index === 8) { this.options.cancel(); return; }
    this.changed(true);
  }

  private pointerAction(event: TuiMouseEvent): PointerAction | null {
    if (event.x < 0 || event.x >= event.width || event.y < 0 || event.y >= event.height) return null;
    if (event.y === 0) {
      const tab = this.hitGeometry.tabs.find(span => event.x >= span.start && event.x < span.end);
      if (tab === undefined) return null;
      const scope = SCOPES[tab.index];
      return scope === undefined ? null : { kind: 'scope', scope };
    }
    const footerTop = event.height - this.hitGeometry.footerRows;
    if (event.y >= footerTop) {
      const index = hintAt(this.hitGeometry.hints[event.y - footerTop - 1], event.x);
      return index === undefined ? null : { kind: 'hint', index };
    }
    if (event.y < this.hitGeometry.headerRows) return null;
    const index = event.y - this.hitGeometry.headerRows + this.bodyScroll.scrollTop;
    return index < this.options.controller.rows.length ? { kind: 'row', index } : null;
  }

  override handleMouse(
    event: TuiMouseEvent,
  ): ReturnType<PanelLayout['handleMouse']> {
    if (!this.usable()) return undefined;
    const handled = (): NonNullable<ReturnType<PanelLayout['handleMouse']>> => ({
      handled: true,
      focus: true,
      render: true,
      target: {
        component: this,
        originX: event.screenX - event.x,
        originY: event.screenY - event.y,
        width: event.width,
        height: event.height,
      },
    });
    if (event.type === 'wheel' && event.wheelDelta) {
      this.bodyScroll.scrollBy(event.wheelDelta);
      this.changed(false);
      return handled();
    }
    if ((event.type !== 'press' && event.type !== 'click') || event.button !== 'left') return undefined;
    const action = this.pointerAction(event);
    if (action === null) return undefined;
    // Retain a gesture target without a redraw that would invalidate the press.
    if (event.type === 'press') return { ...handled(), render: false };
    if (action.kind === 'scope') {
      this.options.controller.selectScope(action.scope);
      this.changed(true);
    } else if (action.kind === 'hint') {
      this.runHint(action.index);
    } else {
      this.options.controller.select(action.index);
      this.activateSelected();
    }
    return handled();
  }

  dispose(): void {
    this.live = false;
  }
}

interface SettingsInteraction {
  readonly abort: AbortController;
  readonly pane: CustomViewToggle;
  controller: SettingsController | null;
}

export class CuckooSettingsView {
  private interaction: SettingsInteraction | null = null;
  private disposed = false;

  private close(interaction: SettingsInteraction): void {
    interaction.abort.abort();
    if (interaction.controller !== null) interaction.controller.dispose();
    interaction.pane.dispose();
  }

  async show(
    ctx: ExtensionContext,
    callbacks: SettingsCallbacks,
  ): Promise<void> {
    if (this.disposed) return;
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify('/cuckoo settings requires interactive TUI mode.', 'info');
      return;
    }
    if (this.interaction !== null) {
      this.close(this.interaction);
      return;
    }
    const interaction: SettingsInteraction = {
      abort: new AbortController(),
      pane: new CustomViewToggle(),
      controller: null,
    };
    this.interaction = interaction;
    try {
      const controller = new SettingsController(callbacks);
      interaction.controller = controller;
      while (!interaction.abort.signal.aborted) {
        const outcome: { policy: PolicyEditRequest | null } = { policy: null };
        await interaction.pane.open(ctx.ui, (tui, theme, keys, done) => {
          return new SettingsPanel({
            controller,
            theme,
            keys,
            requestRender: () => tui.requestRender(),
            cancel: () => {
              interaction.abort.abort();
              controller.dispose();
              done();
            },
            editPolicy: request => {
              if (interaction.abort.signal.aborted) return;
              outcome.policy = request;
              done();
            },
          });
        });
        if (interaction.abort.signal.aborted) break;
        const request = outcome.policy;
        if (request === null) break;
        try {
          const policy = await callbacks.editPolicy({
            ...request,
            signal: interaction.abort.signal,
          });
          if (interaction.abort.signal.aborted) break;
          controller.reload();
          if (policy !== undefined) {
            controller.stagePolicy(request.scope, policy);
          }
        } catch (error) {
          if (interaction.abort.signal.aborted) break;
          controller.setNotice(`Policy edit failed: ${errorText(error)}`);
        }
      }
    } catch (error) {
      if (!interaction.abort.signal.aborted) {
        ctx.ui.notify(`Cuckoo settings: ${errorText(error)}`, 'error');
      }
    } finally {
      this.close(interaction);
      if (this.interaction === interaction) this.interaction = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.interaction !== null) this.close(this.interaction);
  }
}
