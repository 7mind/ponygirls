import {
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type TuiMouseEvent,
} from '@earendil-works/pi-tui';

import type {
  ScopedSettingsAction,
  ScopedSettingsKeybindings,
  ScopedSettingsPort,
  ScopedSettingsScope,
  ScopedSettingsState,
} from '@ponygirls/pi-settings';

import {
  CustomViewToggle,
  type CustomViewUI,
} from './custom-view.ts';

import {
  frameTitle,
  hintAt,
  keyHints,
  type Span,
} from './frame.ts';

import {
  PanelLayout,
  type PanelParts,
} from './panel-layout.ts';

import { fit } from './rows.ts';
import type { UiTheme } from './theme.ts';

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

export interface ScopedSettingsPanelOptions {
  readonly title: string;
  readonly controller: ScopedSettingsPort;
  readonly theme: UiTheme;
  readonly keys: ScopedSettingsKeybindings;
  readonly requestRender: () => void;
  readonly cancel: () => void;

  /** Must close the settings pane before running the action. */
  readonly runAction: (action: ScopedSettingsAction) => void;
}

type PointerAction =
  | {
      readonly kind: 'scope';
      readonly scope: ScopedSettingsScope;
    }
  | {
      readonly kind: 'row';
      readonly index: number;
    }
  | {
      readonly kind: 'hint';
      readonly index: number;
    };

interface SettingsFrame {
  readonly width: number;
  readonly headerRows: number;
  readonly footerRows: number;
  readonly rowCount: number;
  readonly tabs: readonly Span[];
  readonly hints: readonly (readonly Span[])[];
}

export class ScopedSettingsPanel extends PanelLayout {
  readonly capturesViewportInput = true;

  private readonly options: ScopedSettingsPanelOptions;

  private readonly scopeOrder: readonly ScopedSettingsScope[] = [
    'session',
    'project',
    'global',
  ];

  private live = true;
  private revealSelection = true;
  private lastWidth = -1;
  private lastHeight = -1;
  private hitGeometry: SettingsFrame | null = null;

  constructor(options: ScopedSettingsPanelOptions) {
    super(width => this.buildParts(width));
    this.options = options;
  }

  private usable(): boolean {
    return this.live &&
      this.options.controller.active &&
      !this.options.controller.busy;
  }

  private changed(reveal: boolean): void {
    if (!this.usable()) return;
    this.revealSelection = reveal;
    this.invalidate();
    this.options.requestRender();
  }

  private requestEdit(): void {
    if (!this.usable()) return;

    const action = this.options.controller.beginEdit();
    if (action === null) {
      this.changed(false);
      return;
    }

    this.options.runAction(action);
  }

  private requestApply(): void {
    if (!this.usable()) return;

    const action = this.options.controller.beginApply();
    if (action === null) {
      this.changed(false);
      return;
    }

    this.options.runAction(action);
  }

  private activateSelected(): void {
    if (!this.usable()) return;

    const state = this.options.controller.state();
    const row = state.rows[state.selectedIndex];
    if (row === undefined) return;

    if (row.kind === 'value') {
      this.requestEdit();
      return;
    }

    this.options.controller.toggleSelected();
    this.changed(true);
  }

  private buildParts(width: number): PanelParts {
    const w = Math.max(1, Math.floor(width));
    const { controller, theme } = this.options;
    const state = controller.state();

    const title = frameTitle(
      theme,
      w,
      {
        title: plainText(this.options.title),
        tabs: {
          active: this.scopeOrder.indexOf(state.scope),
          labels: this.scopeOrder.map(scope => {
            const tab = state.scopes.find(item => item.scope === scope);
            return `${scope}${tab?.dirty === true ? '*' : ''}`;
          }),
        },
      },
      'none',
    );

    const header = [
      title.line,
      ...wrapTextWithAnsi(
        theme.fg(
          'muted',
          'Checkboxes show configuration intent, not permission or consent.',
        ),
        w,
      ),
      ...wrapTextWithAnsi(
        theme.fg(
          'dim',
          "Preview includes this tab's draft, not other tabs' unsaved edits.",
        ),
        w,
      ),
    ];

    const labelWidth = Math.max(4, Math.min(28, w - 42));

    const body = state.rows.map((row, index) => {
      const selected = index === state.selectedIndex;
      const marker = row.checked === null
        ? '[>]'
        : row.checked ? '[x]' : '[ ]';

      const local = row.localSet
        ? plainText(row.localText)
        : 'inherit';

      const status = plainText(row.inactive);
      let text: string;

      if (row.kind === 'value') {
        text =
          `${selected ? '>' : ' '} ${marker} ` +
          `${plainText(row.label)}: ${plainText(row.throughText)}` +
          ` · local ${local}` +
          ` · effective ${plainText(row.effectiveText)} (${row.origin})`;

        if (status !== '') text += ` · ${status}`;
      } else {
        text =
          `${selected ? '>' : ' '} ${marker} ` +
          `${fit(plainText(row.label), labelWidth)} ` +
          `${fit(local, 7)} ` +
          `${fit(
            `${plainText(row.effectiveText)}@${row.origin}`,
            18,
          )}`;

        if (status !== '') text += ` ${status}`;
      }

      const clipped = truncateToWidth(text, w, '…');
      return selected
        ? theme.bg('selectedBg', theme.fg('text', clipped))
        : theme.fg('text', clipped);
    });

    const selectedRow = state.rows[state.selectedIndex];
    const selectedScope = state.scopes.find(
      item => item.scope === state.scope,
    );

    const details: string[] = [];

    if (selectedRow !== undefined) {
      details.push(
        plainText(selectedRow.description),
        `Local ${state.scope}: ${
          selectedRow.localSet
            ? plainText(selectedRow.localText)
            : 'inherit'
        }; through this scope: ${plainText(selectedRow.throughText)}.`,
        `Effective: ${plainText(selectedRow.effectiveText)} ` +
          `(${selectedRow.origin}).`,
      );

      if (selectedRow.inactive !== '') {
        details.push(plainText(selectedRow.inactive));
      }

      details.push(
        selectedRow.kind === 'value'
          ? 'Enter or e edits the complete value; Apply saves it.'
          : 'Space or Enter changes configuration intent; Apply saves it.',
        'Inherit removes only this scope’s override. ' +
          'Global inheritance falls back to managed or builtin defaults.',
      );
    }

    if (selectedScope !== undefined) {
      details.push(
        `Scope target: ${plainText(selectedScope.target)}`,
      );
      if (selectedScope.reason !== '') {
        details.push(plainText(selectedScope.reason));
      }
    }

    if (!state.projectTrusted) {
      details.push(
        'Project settings are ignored because the project is not trusted.',
      );
    }

    body.push('');
    for (const detail of details) {
      body.push(
        ...wrapTextWithAnsi(
          theme.fg('muted', plainText(detail)),
          w,
        ),
      );
    }

    body.push(
      '',
      ...wrapTextWithAnsi(
        theme.fg('muted', plainText(state.notice)),
        w,
      ),
    );

    const hints = keyHints(theme, w, [
      { key: '↑↓', action: 'select' },
      { key: 'Tab', action: 'scope' },
      { key: 'Space', action: 'activate' },
      { key: 'r', action: 'inherit' },
      { key: 'e', action: 'edit value' },
      { key: 'Ctrl-S', action: 'apply scope' },
      { key: 'PgUp/Dn', action: 'scroll' },
      { key: 'l', action: 'reload' },
      { key: 'Esc', action: 'cancel drafts' },
    ]);

    const footer = [
      truncateToWidth(
        theme.fg('muted', plainText(state.notice)),
        w,
        '…',
      ),
      ...hints.lines,
    ];

    /*
     * PanelLayout measures natural content before allocating its children.
     * Measurement must not move selection, scroll the body or replace live
     * pointer geometry.
     */
    if (!this.isMeasuring) {
      if (this.hasAllocatedHeight) {
        const height = this.bodyScroll.viewportHeight;

        if (this.lastWidth !== w || this.lastHeight !== height) {
          this.revealSelection = true;
        }

        this.lastWidth = w;
        this.lastHeight = height;

        if (this.revealSelection && height > 0) {
          const selected = state.selectedIndex;
          const top = this.bodyScroll.scrollTop;

          if (selected < top) {
            this.bodyScroll.scrollTo(selected);
          } else if (selected >= top + height) {
            this.bodyScroll.scrollTo(selected - height + 1);
          }

          this.revealSelection = false;
        }
      }

      this.hitGeometry = {
        width: w,
        headerRows: header.length,
        footerRows: footer.length,
        rowCount: state.rows.length,
        tabs: title.tabSpans,
        hints: hints.spans,
      };
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

    const state = controller.state();

    if (keys.matches(data, 'tui.select.up')) {
      controller.select(state.selectedIndex - 1);
    } else if (keys.matches(data, 'tui.select.down')) {
      controller.select(state.selectedIndex + 1);
    } else if (matchesKey(data, Key.home)) {
      controller.select(0);
    } else if (matchesKey(data, Key.end)) {
      controller.select(state.rows.length - 1);
    } else if (
      matchesKey(data, Key.pageUp) ||
      matchesKey(data, Key.pageDown)
    ) {
      const direction = matchesKey(data, Key.pageUp) ? -1 : 1;
      this.bodyScroll.scrollBy(
        direction * Math.max(
          1,
          this.bodyScroll.viewportHeight - 1,
        ),
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
      controller.inheritSelected();
    } else if (data === 'e' || data === 'p') {
      this.requestEdit();
      return;
    } else if (matchesKey(data, Key.ctrl('s'))) {
      this.requestApply();
      return;
    } else if (data === 'l') {
      controller.reload();
    } else {
      return;
    }

    this.changed(true);
  }

  private runHint(index: number): void {
    if (!this.usable()) return;

    const controller = this.options.controller;
    const state = controller.state();

    if (index === 0) {
      controller.select(state.selectedIndex + 1);
    } else if (index === 1) {
      controller.cycleScope(1);
    } else if (index === 2) {
      this.activateSelected();
      return;
    } else if (index === 3) {
      controller.inheritSelected();
    } else if (index === 4) {
      this.requestEdit();
      return;
    } else if (index === 5) {
      this.requestApply();
      return;
    } else if (index === 6) {
      this.bodyScroll.scrollBy(
        Math.max(1, this.bodyScroll.viewportHeight - 1),
      );
      this.changed(false);
      return;
    } else if (index === 7) {
      controller.reload();
    } else if (index === 8) {
      this.options.cancel();
      return;
    } else {
      return;
    }

    this.changed(true);
  }

  private pointerAction(
    event: TuiMouseEvent,
  ): PointerAction | null {
    const frame = this.hitGeometry;

    if (
      frame === null ||
      frame.width !== event.width ||
      event.x < 0 ||
      event.x >= event.width ||
      event.y < 0 ||
      event.y >= event.height
    ) {
      return null;
    }

    if (event.y === 0) {
      const tab = frame.tabs.find(
        span => event.x >= span.start && event.x < span.end,
      );
      if (tab === undefined) return null;

      const scope = this.scopeOrder[tab.index];
      return scope === undefined
        ? null
        : { kind: 'scope', scope };
    }

    const bodyTop = frame.headerRows;
    const footerTop = event.height - frame.footerRows;
    if (footerTop < bodyTop) return null;

    if (event.y >= footerTop) {
      const footerRow = event.y - footerTop;
      if (footerRow <= 0 || footerRow >= frame.footerRows) {
        return null;
      }

      const index = hintAt(
        frame.hints[footerRow - 1],
        event.x,
      );

      return index === undefined
        ? null
        : { kind: 'hint', index };
    }

    if (event.y < bodyTop) return null;

    const index =
      event.y - bodyTop + this.bodyScroll.scrollTop;

    return index >= 0 && index < frame.rowCount
      ? { kind: 'row', index }
      : null;
  }

  override handleMouse(
    event: TuiMouseEvent,
  ): ReturnType<PanelLayout['handleMouse']> {
    if (!this.usable()) return undefined;

    const handled = (
      render: boolean,
    ): NonNullable<ReturnType<PanelLayout['handleMouse']>> => ({
      handled: true,
      focus: true,
      render,
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
      return handled(true);
    }

    if (
      (event.type !== 'press' && event.type !== 'click') ||
      event.button !== 'left'
    ) {
      return undefined;
    }

    const action = this.pointerAction(event);
    if (action === null) return undefined;

    /*
     * The terminal dispatcher needs the real press target to synthesize click
     * on release. A neutral press must neither activate nor invalidate that
     * target through a redraw.
     */
    if (event.type === 'press') return handled(false);

    if (action.kind === 'scope') {
      this.options.controller.selectScope(action.scope);
      this.changed(true);
    } else if (action.kind === 'hint') {
      this.runHint(action.index);
    } else {
      this.options.controller.select(action.index);
      this.activateSelected();
    }

    return handled(true);
  }

  dispose(): void {
    this.live = false;
    this.hitGeometry = null;
  }
}

export interface ScopedSettingsViewContext {
  readonly mode: string;
  readonly hasUI: boolean;
  readonly ui:
    CustomViewUI<UiTheme, ScopedSettingsKeybindings> & {
      notify(
        message: string,
        level: 'info' | 'error',
      ): void;
    };
}

export interface ScopedSettingsViewOptions {
  readonly title: string;
}

interface SettingsInteraction {
  readonly abort: AbortController;
  readonly pane: CustomViewToggle;
  controller: ScopedSettingsPort | null;
  closed: boolean;
}

type ActionWaitOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'aborted' }
  | {
      readonly kind: 'failed';
      readonly message: string;
    };

/**
 * Stop waiting when the interaction closes, even if an owner callback ignores
 * AbortSignal. Both promise branches remain observed, so a late rejection
 * cannot become unhandled.
 *
 * This does not cancel or roll back external effects. The owner's callback
 * must honor signal and perform final authorization checks.
 */
function waitForAction(
  action: ScopedSettingsAction,
  signal: AbortSignal,
): Promise<ActionWaitOutcome> {
  return new Promise<ActionWaitOutcome>(resolve => {
    let settled = false;

    const finish = (outcome: ActionWaitOutcome): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      resolve(outcome);
    };

    const aborted = (): void => {
      finish({ kind: 'aborted' });
    };

    if (signal.aborted) {
      finish({ kind: 'aborted' });
      return;
    }

    signal.addEventListener('abort', aborted, { once: true });

    const running = Promise.resolve().then(() => {
      if (signal.aborted) return;
      return action.run(signal);
    });

    void running.then(
      () => finish({ kind: 'done' }),
      error => finish({
        kind: 'failed',
        message: errorText(error),
      }),
    );
  });
}

export class ScopedSettingsView {
  private interaction: SettingsInteraction | null = null;
  private disposed = false;

  private close(interaction: SettingsInteraction): void {
    if (interaction.closed) return;
    interaction.closed = true;

    try {
      if (interaction.controller !== null) interaction.controller.dispose();
    } finally {
      try { interaction.abort.abort(); }
      finally { interaction.pane.dispose(); }
    }
  }

  /**
   * The factory is called only when opening an interactive settings dialog.
   * Repeat-open closes the existing interaction instead.
   */
  async show(
    context: ScopedSettingsViewContext,
    createController: () => ScopedSettingsPort,
    options: ScopedSettingsViewOptions,
  ): Promise<void> {
    if (this.disposed) return;

    if (context.mode !== 'tui' || !context.hasUI) {
      context.ui.notify(
        `${plainText(options.title)} requires interactive TUI mode.`,
        'info',
      );
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
      closed: false,
    };

    this.interaction = interaction;

    try {
      const controller = createController();
      interaction.controller = controller;
      if (interaction.closed || this.disposed || interaction.abort.signal.aborted) {
        controller.dispose();
        return;
      }

      while (
        !interaction.abort.signal.aborted &&
        controller.active
      ) {
        const selected: {
          action: ScopedSettingsAction | null;
        } = { action: null };

        await interaction.pane.open(
          context.ui,
          (tui, theme, keys, done) =>
            new ScopedSettingsPanel({
              title: options.title,
              controller,
              theme,
              keys,
              requestRender: () => tui.requestRender(),
              cancel: () => this.close(interaction),
              runAction: action => {
                if (
                  interaction.closed ||
                  interaction.abort.signal.aborted ||
                  !controller.active ||
                  selected.action !== null
                ) {
                  return;
                }

                selected.action = action;

                /*
                 * CustomViewToggle closes and disposes the current panel.
                 * The controller remains alive for the external action.
                 */
                done();
              },
            }),
        );

        if (
          interaction.closed ||
          interaction.abort.signal.aborted ||
          !controller.active
        ) {
          break;
        }

        const action = selected.action;
        if (action === null) break;

        /*
         * Both editors and apply/consent run outside the settings pane.
         * No second pane is mounted while the action is awaiting.
         */
        const outcome = await waitForAction(
          action,
          interaction.abort.signal,
        );

        if (
          outcome.kind === 'aborted' ||
          interaction.closed ||
          interaction.abort.signal.aborted ||
          !controller.active
        ) {
          break;
        }

        if (outcome.kind === 'failed') {
          controller.setNotice(
            action.kind === 'apply'
              ? (
                  `Apply action failed: ${outcome.message}. ` +
                  'Storage may already have changed; reload and review.'
                )
              : `Editor action failed: ${outcome.message}`,
          );
        }

        // Reopen the same controller, preserving selection and other drafts.
      }
    } catch (error) {
      if (
        !interaction.closed &&
        !interaction.abort.signal.aborted
      ) {
        context.ui.notify(
          `${plainText(options.title)}: ${errorText(error)}`,
          'error',
        );
      }
    } finally {
      this.close(interaction);
      if (this.interaction === interaction) {
        this.interaction = null;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.interaction !== null) {
      this.close(this.interaction);
    }
  }
}
