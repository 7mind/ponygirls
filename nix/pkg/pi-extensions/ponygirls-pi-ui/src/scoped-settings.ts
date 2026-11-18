import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
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
  frameRule,
  frameTitle,
  hintAt,
  keyHints,
  type KeyHint,
  type Span,
} from './frame.ts';

import { HINT, KEY, ctrlKey } from './keys.ts';

import {
  PanelLayout,
  type PanelParts,
} from './panel-layout.ts';

import { MARKER_WIDTH, fit, listRow } from './rows.ts';
import type { UiFg, UiTheme } from './theme.ts';

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

/** What a footer hint does when clicked; the same action as its key. */
type HintAction =
  | 'select'
  | 'scope'
  | 'activate'
  | 'inherit'
  | 'apply'
  | 'cancel';

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
      readonly action: HintAction;
    };

interface SettingsFrame {
  readonly width: number;
  readonly headerRows: number;
  readonly footerRows: number;

  /** Footer rows above the hint lines (the notice, when there is one). */
  readonly noticeRows: number;
  readonly rowCount: number;
  readonly tabs: readonly Span[];
  readonly hints: readonly (readonly Span[])[];
  readonly hintActions: readonly HintAction[];
}

/** Marker cell before a row's label: a checkbox, or a pencil for a value. */
const BOX_WIDTH = 3;
const COLUMN_GAP = 2;
const LABEL_MIN = 12;
const LABEL_MAX = 34;
const LOCAL_MIN = 7;
const LOCAL_MAX = 16;
const EFFECTIVE_MIN = 12;
const INHERIT = 'inherit';
const STAGED_MARK = ' •';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
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

    const selectedRow = state.rows[state.selectedIndex];
    const selectedScope = state.scopes.find(
      item => item.scope === state.scope,
    );

    // Column widths follow the content; Effective takes what is left.
    const localCell = (row: ScopedSettingsState['rows'][number]): string =>
      (row.localSet ? plainText(row.localText) : INHERIT) +
      (row.staged ? STAGED_MARK : '');
    const widest = (texts: readonly string[]): number =>
      texts.reduce((max, text) => Math.max(max, visibleWidth(text)), 0);
    const fixed = MARKER_WIDTH + BOX_WIDTH + 1 + 2 * COLUMN_GAP;
    const localWidth = Math.max(
      LOCAL_MIN,
      Math.min(LOCAL_MAX, widest(state.rows.map(localCell))),
    );
    const labelWidth = Math.max(
      LABEL_MIN,
      Math.min(
        LABEL_MAX,
        widest(state.rows.map(row => plainText(row.label))),
        w - fixed - localWidth - EFFECTIVE_MIN,
      ),
    );
    const gap = ' '.repeat(COLUMN_GAP);

    const header = [
      title.line,
      truncateToWidth(
        theme.fg(
          'dim',
          `${' '.repeat(MARKER_WIDTH + BOX_WIDTH + 1)}` +
            `${fit('SETTING', labelWidth)}${gap}` +
            `${fit('HERE', localWidth)}${gap}EFFECTIVE`,
        ),
        w,
        '',
      ),
    ];

    const body = state.rows.map((row, index) => {
      const selected = index === state.selectedIndex;
      const on = row.checked === true;
      const note = plainText(row.inactive);
      // A switched-off setting with an unmet prerequisite recedes; `dim`
      // is unreadable on the selection band, so the selected row uses muted.
      const receded: UiFg = selected ? 'muted' : 'dim';
      const quiet = row.checked === false && note !== '';
      const box = row.kind === 'value'
        ? ' ✎ '
        : on ? '[x]' : '[ ]';
      const overridden = row.throughText !== row.effectiveText;

      const local = row.localSet
        ? theme.fg('text', plainText(row.localText))
        : theme.fg(quiet ? receded : 'muted', INHERIT);
      const localText =
        local + (row.staged ? theme.fg('warning', STAGED_MARK) : '');
      const effective =
        `${plainText(row.effectiveText)} · ${row.origin}`;

      let content =
        `${theme.fg(quiet ? receded : 'text', `${box} ${fit(plainText(row.label), labelWidth)}`)}` +
        `${gap}${fit(localText, localWidth)}${gap}` +
        theme.fg(overridden ? 'warning' : quiet ? receded : 'muted', effective);

      if (note !== '') {
        content += gap + theme.fg(on ? 'warning' : receded, note);
      }

      return listRow(theme, w, content, selected);
    });

    const details: { text: string; color: UiFg }[] = [];

    if (selectedRow !== undefined) {
      details.push({
        text: plainText(selectedRow.description),
        color: 'muted',
      });

      if (selectedRow.kind === 'value') {
        details.push({
          text:
            `Now: ${plainText(selectedRow.effectiveText)} ` +
            `(${selectedRow.origin})`,
          color: 'text',
        });
      }

      if (selectedRow.throughText !== selectedRow.effectiveText) {
        details.push({
          text:
            `A ${selectedRow.origin} setting overrides this scope ` +
            `(${plainText(selectedRow.throughText)} here).`,
          color: 'warning',
        });
      }

      if (selectedRow.inactive !== '') {
        details.push({
          text: plainText(selectedRow.inactive),
          color: selectedRow.checked === true ? 'warning' : 'muted',
        });
      }
    }

    if (selectedScope !== undefined) {
      details.push({
        text: selectedScope.scope === 'session'
          ? 'Applies to this session only.'
          : `Saved to ${plainText(selectedScope.target)}`,
        color: 'dim',
      });

      if (selectedScope.reason !== '') {
        details.push({
          text: plainText(selectedScope.reason),
          color: 'warning',
        });
      }
    }

    if (!state.projectTrusted) {
      details.push({
        text:
          'Project settings are ignored because the project is not trusted.',
        color: 'warning',
      });
    }

    body.push(frameRule(theme, w));
    for (const detail of details) {
      body.push(
        ...wrapTextWithAnsi(theme.fg(detail.color, detail.text), w),
      );
    }

    // The footer shows the notice on one line; only a notice it has to
    // truncate is repeated here, wrapped and complete.
    const notice = plainText(state.notice);
    if (visibleWidth(notice) > w) {
      body.push(
        '',
        ...wrapTextWithAnsi(theme.fg('muted', notice), w),
      );
    }

    const unsaved = state.scopes.filter(scope => scope.changes > 0);
    const anyUnsaved = unsaved.length > 0;
    const currentUnsaved = selectedScope !== undefined &&
      selectedScope.changes > 0;

    const hintList: { hint: KeyHint; action: HintAction }[] = [
      { hint: HINT.select, action: 'select' },
      { hint: { key: KEY.tab, action: 'scope' }, action: 'scope' },
    ];
    if (selectedRow !== undefined) {
      hintList.push({
        hint: selectedRow.kind === 'value'
          ? { key: KEY.enter, action: 'edit' }
          : { key: KEY.space, action: 'toggle' },
        action: 'activate',
      });
      if (selectedRow.localSet) {
        hintList.push({
          hint: { key: 'r', action: INHERIT },
          action: 'inherit',
        });
      }
    }
    if (currentUnsaved) {
      hintList.push({
        hint: { key: ctrlKey('s'), action: 'save' },
        action: 'apply',
      });
    }
    hintList.push({
      hint: anyUnsaved
        ? { key: KEY.esc, action: 'discard and close' }
        : HINT.close,
      action: 'cancel',
    });

    const hints = keyHints(theme, w, hintList.map(item => item.hint));

    // A controller message outranks the unsaved summary; with neither, the
    // footer is the hint line alone.
    const noticeLine = notice !== ''
      ? truncateToWidth(theme.fg('muted', notice), w, '…')
      : anyUnsaved
        ? truncateToWidth(
            theme.fg(
              'warning',
              unsaved
                .map((scope, index) =>
                  index === 0
                    ? `${plural(scope.changes, 'unsaved change')} in ${scope.scope}`
                    : `${scope.changes} in ${scope.scope}`)
                .join(', '),
            ),
            w,
            '…',
          )
        : null;

    const footer = [
      ...(noticeLine === null ? [] : [noticeLine]),
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
        noticeRows: noticeLine === null ? 0 : 1,
        rowCount: state.rows.length,
        tabs: title.tabSpans,
        hints: hints.spans,
        hintActions: hintList.map(item => item.action),
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

  private runHint(action: HintAction): void {
    if (!this.usable()) return;

    const controller = this.options.controller;

    if (action === 'select') {
      controller.select(controller.state().selectedIndex + 1);
    } else if (action === 'scope') {
      controller.cycleScope(1);
    } else if (action === 'activate') {
      this.activateSelected();
      return;
    } else if (action === 'inherit') {
      controller.inheritSelected();
    } else if (action === 'apply') {
      this.requestApply();
      return;
    } else {
      this.options.cancel();
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
      const hintRow = event.y - footerTop - frame.noticeRows;
      if (hintRow < 0 || hintRow >= frame.hints.length) {
        return null;
      }

      const index = hintAt(frame.hints[hintRow], event.x);
      const action = index === undefined
        ? undefined
        : frame.hintActions[index];

      return action === undefined
        ? null
        : { kind: 'hint', action };
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
      this.runHint(action.action);
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
