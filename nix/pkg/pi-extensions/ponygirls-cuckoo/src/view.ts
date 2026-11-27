import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, Editor, matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { BORDER_ORDER, CustomViewToggle, HINT, KEY, borderBadge, borderBadgeCompact, fit, fitRight, frameRule, frameTitle, keyHints, PanelLayout, type BorderBadge, type FrameTitle, type KeyHint, type PanelParts, type UiTheme } from '@ponygirls/pi-ui';
import type { Checkpoint } from './report.ts';
import { checkpoints as collectCheckpoints, REPORT_TYPE } from './report.ts';
import { checkpointBlocks, currentBlocks, currentSummary, reportContent, historyContent, terminalText } from './presentation.ts';
import { EMPTY_SET, type CurrentSet } from './current.ts';
import { commentNodes, commentText, sameNode, type CommentDraft, type CommentNode, type SavedComment, type ShownComment } from './comments.ts';

const BADGE_GLYPH = '🐦';
export const REPORTS_SHORTCUT = { key: 'ctrl+alt+c', label: '⌃⌥C' } as const;
const PI_CHROME = 2;
const NODE_GUTTER = 2;
const MAX_EDITOR_ROWS = 6;
const MAX_INFO_ROWS = 2;
const UNRENDERED_WIDTH = 80;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export type CommentScope = 'branch' | 'session';
/** Why a panel closed: by the user, by the user requesting an inquiry (`i`), or because its session is ending. */
export type PanelClose = 'close' | 'inquire' | 'shutdown';
/** Where report comments are read from and persisted to; owned by the extension runtime. */
export interface CommentHost {
  /** Comments already saved in the given scope of the current session. */
  saved(ctx: ExtensionContext, scope: CommentScope): readonly SavedComment[];
  /** Persist comments made in a panel and hand them to the model; `reason` decides whether the model is also asked to respond. */
  save(ctx: ExtensionContext, comments: readonly CommentDraft[], reason: PanelClose): void;
}

interface LineRange { start: number; end: number }
/** The body lines on screen: `height` lines from line `top`. */
interface View { top: number; height: number }
interface Geometry { headerRows: number; footerRows: number; nodes: readonly LineRange[] }
interface EditorDraft { editor: Editor; requestId: string; node: CommentNode }
/** What the arrows act on: the checkpoint list, or the report of the selected checkpoint. */
type Focus = 'list' | 'report';
/** What a table row is called in titles: a checkpoint of this branch, or a saved answer of the session. */
type ItemNoun = 'checkpoint' | 'answer';
const ITEM_TITLE: Readonly<Record<ItemNoun, string>> = { checkpoint: 'Checkpoint', answer: 'Answer' };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface Column { header: string; width: number; align: 'left' | 'right' }

function buildColumns(totalWidth: number): Column[] {
  const idxCol: Column = { header: '#', width: 3, align: 'right' };
  const objCol: Column = { header: 'Objs', width: 4, align: 'right' };
  const statusCol: Column = { header: 'Status', width: 8, align: 'left' };
  const markerWidth = 2;
  const gapWidth = 3;
  const nGaps = 3;
  const fixed = markerWidth + idxCol.width + objCol.width + statusCol.width + nGaps * gapWidth;
  const reqWidth = Math.max(12, totalWidth - fixed);
  return [idxCol, { header: 'Request ID', width: reqWidth, align: 'left' }, objCol, statusCol];
}

function renderCell(text: string, width: number, align: 'left' | 'right'): string {
  return align === 'right' ? fitRight(text, width) : fit(text, width);
}

interface TableRow { cells: string[]; selected: boolean }

function tableLines(theme: UiTheme, columns: readonly Column[], rows: readonly TableRow[], width: number): string[] {
  const sep = ' │ ';
  const headerLine = theme.fg('dim', columns.map(c => renderCell(c.header, c.width, c.align)).join(sep));
  const ruleLine = theme.fg('dim', columns.map(c => '─'.repeat(c.width)).join('─┼─'));
  const dataLines = rows.map((row, ri) => {
    const line = columns.map((col, ci) => renderCell(row.cells[ci] ?? '', col.width, col.align)).join(sep);
    const marker = row.selected ? `${theme.fg('accent', '▌')} ` : '  ';
    let styled = `${marker}${line}`;
    styled = truncateToWidth(styled, width, '…');
    if (row.selected) {
      styled = theme.bg('selectedBg', theme.bold(styled));
    } else if (ri % 2 === 1) {
      styled = theme.bg('toolPendingBg', styled + ' '.repeat(Math.max(0, width - visibleWidth(styled))));
    }
    return styled;
  });
  return [`  ${headerLine}`, `  ${ruleLine}`, ...dataLines];
}

/**
 * The first of `candidates` that `width` shows whole; the last one, cut, when none fits. A title rule cuts what
 * does not fit with an ellipsis, so a candidate fits when its title and meta come out unchanged.
 */
function fittingTitle(theme: UiTheme, width: number, candidates: readonly FrameTitle[]): string {
  for (const candidate of candidates) {
    const line = frameTitle(theme, width, candidate, 'none').line;
    if (line.includes(candidate.title) && (candidate.meta === undefined || line.includes(candidate.meta))) return line;
  }
  return frameTitle(theme, width, candidates[candidates.length - 1], 'none').line;
}

/** Scroll position as the usage and model-stats panes word it; an arrow marks a side with hidden lines. */
function scrollPosition(lineCount: number, start: number, end: number): string {
  return `${start > 0 ? '↑ ' : ''}lines ${start + 1}–${end} of ${lineCount}${end < lineCount ? ' ↓' : ''}`;
}

interface CheckpointItem {
  kind: 'checkpoint';
  checkpoint: Checkpoint;
  id: string;
  meta: string;
  timestamp?: string;
  currentBranch?: boolean;
}
/** The first row of the report list once the branch has a current set: what its entries are now, not a saved answer. */
interface CurrentItem { kind: 'current'; set: CurrentSet }
type TableItem = CheckpointItem | CurrentItem;
const CURRENT_TITLE = 'Current set';
/** What the comment keys say on the row of the current set: comments belong to the saved report they were made on. */
const COMMENTS_ON_CHECKPOINTS = 'Comments are made on a saved checkpoint: select one in the list.';
const activeObjectives = (set: CurrentSet): number => set.objectives.filter(item => item.status === 'active').length;

export class CuckooView {
  private readonly pane = new CustomViewToggle();
  private active = true;
  private readonly inquire: (ctx: ExtensionContext) => void;
  private readonly comments: CommentHost;
  private readonly now: () => number;
  private lastReports: readonly Checkpoint[] = [];
  private lastCurrent: CurrentSet = EMPTY_SET;
  private lastFault: string | null = null;
  private lastEnabled = false;
  /** `now` is the clock the ages in the current set are counted from. */
  constructor(inquire: (ctx: ExtensionContext) => void, comments: CommentHost, now: () => number) { this.inquire = inquire; this.comments = comments; this.now = now; }

  /** `current` is the current set of the branch the reports are from; without numbered reports or edits it has no row. */
  async showReports(ctx: ExtensionContext, reports: readonly Checkpoint[], intro: string, current: CurrentSet): Promise<void> {
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify(terminalText(reportContent(reports, intro, this.comments.saved(ctx, 'branch'), current, this.now()).plain), 'info');
      return;
    }
    const items: TableItem[] = [...(current.events === 0 ? [] : [{ kind: 'current' as const, set: current }]), ...[...reports].reverse().map((r): TableItem => ({
      kind: 'checkpoint',
      checkpoint: r,
      id: terminalText(r.requestId),
      meta: r.report === null ? 'invalid' : `${r.report.objectives.length} objectives`,
    }))];
    await this.showTable(ctx, { title: 'Cuckoo objectives and progress', noun: 'checkpoint', items, intro, emptyMessage: 'No Cuckoo reports on this branch yet.', commentScope: 'branch' });
  }

  async showHistory(ctx: ExtensionContext, entries: readonly SessionEntry[], branch: readonly SessionEntry[]): Promise<void> {
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify(terminalText(historyContent(entries, branch).plain), 'info');
      return;
    }
    const current = new Set(branch.map(e => e.id));
    const answers = entries.filter(e => e.type === 'custom' && e.customType === REPORT_TYPE);
    const items: TableItem[] = [...answers].reverse().map(entry => {
      const cp = collectCheckpoints([entry])[0];
      return {
        kind: 'checkpoint',
        checkpoint: cp,
        id: terminalText(entry.id),
        meta: `${cp.report === null ? 'invalid' : `${cp.report.objectives.length} objectives`}`,
        timestamp: entry.timestamp,
        currentBranch: current.has(entry.id),
      };
    });
    await this.showTable(ctx, {
      title: 'Cuckoo answer history', noun: 'answer', items, intro: 'This session · all branches · newest first · saved answers, not live verification',
      emptyMessage: 'No Cuckoo answers in this session yet.', commentScope: 'session',
    });
  }

  private async showTable(
    ctx: ExtensionContext,
    opts: { title: string; noun: ItemNoun; items: readonly TableItem[]; intro: string; emptyMessage: string; commentScope: CommentScope },
  ): Promise<void> {
    if (!this.active) return;
    let requested = false;
    const host = this.comments;
    const now = this.now;
    const closeReason = (): PanelClose => !this.active ? 'shutdown' : requested ? 'inquire' : 'close';
    await this.pane.toggle(ctx.ui, (tui, theme, keys, done) => {
      const state = { selectedIndex: 0, topRow: 0, scrollOffset: 0, node: null as number | null, focus: 'list' as Focus };
      // Comments made in this panel; persisted together when it closes.
      const staged: CommentDraft[] = [];
      let saved: readonly SavedComment[] = [];
      let savedFault: string | null = null;
      try { saved = host.saved(ctx, opts.commentScope); }
      catch (error) { savedFault = `Error: saved comments are unreadable: ${String(error)}`; }
      let draft: EditorDraft | null = null;
      let notice = '';
      let pasting = false;
      let geometry: Geometry | null = null;
      let lastWidth = UNRENDERED_WIDTH;
      let lastView: View | null = null;
      /** Rows of the checkpoint table, as last derived from a pane height that had the table in it. */
      let tableRows: number | null = null;
      /** Whether the last layout pass drew the table, so that the pane height it left includes the table. */
      let heightHasTable = false;
      /** Where the list view stood when Enter focused the report. Escape returns there unless another input came in between. */
      let returnTop: number | null = null;
      /**
       * Set by the Escape that left the report. The view gets shorter only after the key was handled, so what the
       * list view should show is applied once, in the first frame whose view has another height than `height`, the
       * report's. `top` is the line to return to; without one, `hold` says that the selected item was on screen and
       * stays there. The next input ends it unapplied.
       */
      let leaving: { top: number | null; hold: boolean; height: number } | null = null;

      function maxTop(total: number, maxRows: number): number { return Math.max(0, total - maxRows); }
      function ensureVisible(total: number, maxRows: number): void {
        state.topRow = clamp(state.topRow, 0, maxTop(total, maxRows));
        if (state.selectedIndex < state.topRow) state.topRow = state.selectedIndex;
        if (state.selectedIndex >= state.topRow + maxRows) state.topRow = clamp(state.selectedIndex - maxRows + 1, 0, maxTop(total, maxRows));
      }
      function shown(): ShownComment[] {
        return [...saved.map(item => ({ requestId: item.requestId, target: item.target, text: item.text, createdAt: item.createdAt })),
          ...staged.map(item => ({ requestId: item.requestId, target: item.target, text: item.text, createdAt: null }))];
      }
      function stage(value: EditorDraft, raw: string): void {
        staged.push({ requestId: value.requestId, target: value.node.ref, subject: value.node.subject, text: commentText(raw) });
      }

      const panel = new (class extends PanelLayout implements Focusable {
        readonly capturesViewportInput = true;
        private hasFocus = false;
        constructor() {
          super((width) => {
            const parts = this.buildParts(width);
            const shown = this.tableShown();
            // The table is back with the row count kept from when it was last shown. The terminal may have changed
            // since: ask for the frame that counts again, which nothing else requests when the report fits.
            if (shown && !heightHasTable) tui.requestRender();
            // The layout takes the pane's chrome from these parts: the height it reports from now on is this frame's.
            heightHasTable = shown;
            return parts;
          });
        }
        override invalidate(): void {}

        get focused(): boolean { return this.hasFocus; }
        set focused(value: boolean) { this.hasFocus = value; if (draft !== null) draft.editor.focused = value; }

        override render(width: number): string[] {
          const parts = this.buildParts(width);
          const view = this.unallocatedView(parts.body.length, parts.header.length + parts.footer.length);
          lastView = view;
          // Like the layout engine's scroll view, keep the offset within the report it was drawn with.
          if (!this.hasAllocatedHeight) state.scrollOffset = view.top;
          return [...parts.header, ...parts.body.slice(view.top, view.top + view.height), ...parts.footer];
        }

        /** Without an allocated height the terminal bounds the pane: the rows its chrome leaves, at the kept scroll offset. */
        private unallocatedView(bodyRows: number, chromeRows: number): View {
          const height = Math.max(1, Math.min(bodyRows, Math.max(1, tui.terminal.rows - PI_CHROME - chromeRows)));
          return { top: Math.min(state.scrollOffset, Math.max(0, bodyRows - height)), height };
        }

        /** Every close path ends here: nothing typed in this panel is dropped silently. */
        dispose(): void {
          const open = draft;
          draft = null;
          if (open !== null) {
            const text = open.editor.getExpandedText();
            if (text.trim().length > 0) {
              try { stage(open, text); }
              catch (error) { ctx.ui.notify(terminalText(`Cuckoo: unfinished comment was not saved: ${String(error)}`), 'error'); }
            }
          }
          if (staged.length === 0) return;
          try { host.save(ctx, staged.splice(0), closeReason()); }
          catch (error) { ctx.ui.notify(terminalText(`Cuckoo: comments were not saved: ${String(error)}`), 'error'); }
        }

        /** The table is drawn while the list is focused and no comment is being written; otherwise the report has its rows. */
        private tableShown(): boolean { return opts.items.length > 0 && state.focus === 'list' && draft === null; }

        private maxTableRows(): number {
          // A host that sizes the pane to its content lays it out shorter while the table is hidden; that height does
          // not say how many rows the table has room for. Keep the count until a layout pass has drawn the table again.
          if (this.hasAllocatedHeight && !heightHasTable && tableRows !== null) return tableRows;
          const footerReserve = 2;
          const minBody = 4;
          // Pane title, column header, its rule and the report title.
          const headerChrome = 4;
          const total = this.hasAllocatedHeight ? this.height(24)
            : Math.max(10, tui.terminal.rows - PI_CHROME);
          const available = Math.max(1, total - footerReserve - minBody - headerChrome);
          tableRows = clamp(Math.min(3, available), 1, 3);
          return tableRows;
        }

        /** The items of the selected row that can be commented on: those of a saved report. */
        private selectedNodes(): CommentNode[] {
          const item = opts.items[state.selectedIndex];
          return item === undefined || item.kind !== 'checkpoint' ? [] : commentNodes(item.checkpoint);
        }
        /** Whether the selected row has items to walk: the entries of the current set, or what can be commented on. */
        private hasItems(): boolean {
          const item = opts.items[state.selectedIndex];
          return item !== undefined && item.kind === 'current' ? item.set.objectives.length + item.set.rules.length > 0 : this.selectedNodes().length > 0;
        }

        /** Node line ranges for the current state. Recomputed on demand: keys can arrive without a frame in between. */
        private currentNodes(): readonly LineRange[] { return this.compose(lastWidth).nodes; }

        private viewport(): View {
          if (this.hasAllocatedHeight) return { top: this.bodyScroll.scrollTop, height: Math.max(1, this.bodyScroll.viewportHeight) };
          // Without an allocated height the viewport exists only as the last frame; keys may have scrolled since.
          this.render(lastWidth);
          if (lastView === null) throw new Error('Cuckoo panel viewport is unavailable');
          return lastView;
        }

        private scrollBodyTo(top: number): void {
          state.scrollOffset = Math.max(0, top);
          if (this.hasAllocatedHeight) this.bodyScroll.scrollTo(state.scrollOffset);
        }

        /**
         * A resize changes the allocated viewport after the scroll position was chosen. While the editor is
         * open, re-anchor the commented node once the new viewport is known; the layout pass that changed it
         * already requests the frame in which this runs.
         */
        private keepCommentedNodeInView(nodes: readonly LineRange[]): void {
          if (draft === null || state.node === null || !this.hasAllocatedHeight) return;
          const range = nodes[state.node];
          const top = this.bodyScroll.scrollTop, height = this.bodyScroll.viewportHeight;
          if (range === undefined || height <= 0 || (range.start >= top && range.start < top + height)) return;
          this.scrollBodyTo(range.start);
          tui.requestRender();
        }

        private reveal(range: LineRange): void {
          const view = this.viewport();
          if (range.start < view.top) this.scrollBodyTo(range.start);
          else if (range.end > view.top + view.height) this.scrollBodyTo(Math.min(range.start, range.end - view.height));
        }

        /** The node cursor when it is on screen; otherwise the on-screen node nearest in the direction of travel. */
        private nodeFromView(direction: 1 | -1): number | null {
          const nodes = this.currentNodes();
          if (nodes.length === 0) return null;
          const view = this.viewport();
          const onScreen = (range: LineRange): boolean => range.end > view.top && range.start < view.top + view.height;
          if (state.node !== null && state.node < nodes.length && onScreen(nodes[state.node])) return state.node;
          const visible = nodes.flatMap((range, index) => onScreen(range) ? [index] : []);
          if (visible.length > 0) return direction > 0 ? visible[0] : visible[visible.length - 1];
          if (direction > 0) { const next = nodes.findIndex(range => range.start >= view.top); return next === -1 ? nodes.length - 1 : next; }
          const previous = nodes.findLastIndex(range => range.end <= view.top);
          return previous === -1 ? 0 : previous;
        }

        private moveNode(direction: 1 | -1): void {
          const nodes = this.currentNodes();
          const current = this.nodeFromView(direction);
          if (current === null) { notice = 'This checkpoint has no rule, objective or answer to select.'; return; }
          state.node = current === state.node ? clamp(current + direction, 0, nodes.length - 1) : current;
          this.reveal(nodes[state.node]);
        }

        private onScreen(range: LineRange, view: View): boolean { return range.end > view.top && range.start < view.top + view.height; }

        /** The cursor when it is on screen, else the item on screen nearest the edge the travel starts from; null when no item is on screen. */
        private nodeOnScreen(nodes: readonly LineRange[], view: View, direction: 1 | -1): number | null {
          const visible = nodes.flatMap((range, index) => this.onScreen(range, view) ? [index] : []);
          if (visible.length === 0) return null;
          if (state.node !== null && visible.includes(state.node)) return state.node;
          return direction > 0 ? visible[0] : visible[visible.length - 1];
        }

        /**
         * An arrow in the focused report. The cursor item is shown to its end first: at once when it fits the view, by
         * line when it is taller. Then the next item is taken and shown the same way. The view never moves by more than
         * its height, so no line is skipped, and the cursor never moves to an item that is not on screen.
         */
        private stepItem(direction: 1 | -1): void {
          const nodes = this.currentNodes();
          const view = this.viewport();
          const scrollBy = (lines: number): void => this.scrollBodyTo(view.top + lines);
          const current = this.nodeOnScreen(nodes, view, direction);
          if (current === null) { scrollBy(direction); return; }
          if (current !== state.node) { state.node = current; return; }
          // Lines of an item still hidden in the direction of travel, and how far the view can move before the item's near edge leaves it.
          const hidden = (range: LineRange): number => direction > 0 ? range.end - (view.top + view.height) : view.top - range.start;
          const room = (range: LineRange): number => direction > 0 ? range.start - view.top : view.top + view.height - range.end;
          const reveal = (range: LineRange): number => Math.min(view.height, room(range) > 0 ? Math.min(hidden(range), room(range)) : 1);
          if (hidden(nodes[current]) > 0) { scrollBy(direction * reveal(nodes[current])); return; }
          const target = current + direction;
          if (target < 0 || target >= nodes.length) { scrollBy(direction); return; }
          const next = nodes[target];
          if (hidden(next) > 0) {
            const top = view.top + direction * reveal(next);
            // The lines in between fill the view: read on by line; the item is taken once it is on screen.
            if (next.end <= top || next.start >= top + view.height) { scrollBy(direction); return; }
            scrollBy(direction * reveal(next));
          }
          state.node = target;
        }

        private focusReport(): void {
          if (opts.items.length === 0) return;
          // The item cursor starts on an item the user sees: "on screen" is the view the key was pressed in, before the table folds away.
          const view = this.viewport();
          const first = this.nodeOnScreen(this.currentNodes(), view, 1);
          state.focus = 'report';
          returnTop = view.top;
          if (first !== null) state.node = first;
        }

        /**
         * The view after the Escape that left the report, once the list view has its height. Nothing else was done in
         * the report: the view Enter was pressed in, which the taller view could not keep at the end of a report.
         * Otherwise a selected item that the shorter view puts off screen is brought back, whole when it fits, else
         * from its first line. Applied once, so that later scrolling is never undone.
         */
        private viewAfterLeaving(nodes: readonly LineRange[], view: View): View {
          if (leaving === null || view.height === leaving.height) return view;
          const { top: returnTo, hold } = leaving;
          leaving = null;
          let top = view.top;
          if (returnTo !== null) top = returnTo;
          else if (hold) {
            const range = state.node === null ? undefined : nodes[state.node];
            if (range !== undefined && !this.onScreen(range, view)) top = range.start < view.top ? range.start : Math.min(range.start, range.end - view.height);
          }
          if (top === view.top) return view;
          this.scrollBodyTo(top);
          return { top, height: view.height };
        }

        private startComment(): void {
          const item = opts.items[state.selectedIndex];
          if (item !== undefined && item.kind === 'current') { notice = COMMENTS_ON_CHECKPOINTS; return; }
          const index = this.nodeFromView(1);
          if (item === undefined || index === null) { notice = 'This checkpoint has no rule, objective or answer to comment on.'; return; }
          const node = this.selectedNodes()[index];
          if (node === undefined) throw new Error('Cuckoo panel node cursor is out of range');
          state.node = index;
          const editor = new Editor(tui, {
            borderColor: text => theme.fg('borderMuted', text),
            selectList: {
              selectedPrefix: text => theme.fg('accent', text), selectedText: text => theme.fg('accent', text),
              description: text => theme.fg('muted', text), scrollInfo: text => theme.fg('dim', text), noMatch: text => theme.fg('dim', text),
            },
          });
          const opened: EditorDraft = { editor, requestId: item.checkpoint.requestId, node };
          editor.focused = this.hasFocus;
          editor.onSubmit = text => {
            if (text.trim().length === 0) { notice = 'A comment cannot be empty; esc discards the draft.'; return; }
            try { stage(opened, text); }
            catch (error) { editor.setText(text); notice = terminalText(String(error)); return; }
            draft = null;
          };
          draft = opened;
          // The editor shrinks the body; keep the commented node at its top.
          this.scrollBodyTo(this.currentNodes()[index].start);
        }

        private removeStaged(): void {
          const item = opts.items[state.selectedIndex];
          if (item !== undefined && item.kind === 'current') { notice = COMMENTS_ON_CHECKPOINTS; return; }
          const node = state.node === null ? undefined : this.selectedNodes()[state.node];
          if (item === undefined || node === undefined) { notice = 'Select an item with tab first.'; return; }
          const index = staged.findLastIndex(value => value.requestId === item.checkpoint.requestId && sameNode(value.target, node.ref));
          if (index === -1) { notice = 'The selected item has no new comment to remove; saved comments are kept as history.'; return; }
          staged.splice(index, 1);
          notice = 'New comment removed.';
        }

        private footer(w: number): string[] {
          if (draft !== null) {
            const lines = draft.editor.render(w);
            const rows = Math.min(lines.length, MAX_EDITOR_ROWS);
            // Crop around the cursor so the hardware-cursor marker stays in the frame.
            const cursor = lines.findIndex(line => line.includes(CURSOR_MARKER));
            const start = Math.max(0, Math.min(Math.max(0, cursor - Math.floor(rows / 2)), lines.length - rows));
            return [
              frameRule(theme, w),
              truncateToWidth(`${theme.fg('accent', theme.bold('Comment on'))} ${terminalText(draft.node.subject)}`, w, '…'),
              ...lines.slice(start, start + rows),
              ...(notice === '' ? [] : wrapTextWithAnsi(theme.fg('warning', notice), w).slice(0, MAX_INFO_ROWS)),
              ...keyHints(theme, w, [
                { key: KEY.enter, action: 'add comment' },
                { key: `shift-${KEY.enter}`, action: 'newline' },
                { key: KEY.esc, action: 'discard draft' },
              ]).lines,
            ];
          }
          const count = staged.length === 0 ? [] : wrapTextWithAnsi(theme.fg('success',
            `${staged.length} new comment${staged.length === 1 ? '' : 's'}: saved to history and sent to the model when this panel closes`), w).slice(0, MAX_INFO_ROWS);
          if (notice === '') return [...count, ...keyHints(theme, w, this.hints()).lines];
          // A notice stands where the count of new comments was and keeps its rows: the key that clears the notice
          // may move the view in the same press, and the view must not lose a row under that step.
          const info = wrapTextWithAnsi(theme.fg('warning', notice), w).slice(0, MAX_INFO_ROWS);
          while (info.length < count.length) info.push('');
          return [...info, ...keyHints(theme, w, this.hints()).lines];
        }

        /** The keys that act in the current state. */
        private hints(): KeyHint[] {
          const inquire: KeyHint = { key: 'i', action: 'inquire now' };
          if (opts.items.length === 0) return [inquire, HINT.close];
          const hasItems = this.hasItems();
          // The comment keys act on the items of a saved report; the current set, whose entries can be walked, takes none.
          const selected = opts.items[state.selectedIndex];
          const comment: KeyHint[] = selected.kind === 'current' ? [] : [
            ...(hasItems ? [{ key: 'c', action: 'comment' }] : []),
            ...(staged.length === 0 ? [] : [{ key: 'x', action: 'remove new comment' }]),
          ];
          if (state.focus === 'report') return [hasItems ? { key: KEY.upDown, action: 'item' } : HINT.scroll, HINT.page, ...comment, inquire, HINT.back];
          return [
            HINT.select, { key: KEY.enter, action: 'detail' }, { key: KEY.page, action: 'scroll detail' },
            ...(hasItems ? [{ key: 'tab/shift-tab', action: 'item' }] : []), ...comment, inquire, HINT.close,
          ];
        }

        private buildParts(width: number): PanelParts {
          const { parts, titles, nodes } = this.compose(width);
          if (titles.length > 0) {
            // The report title closes the header; it shows where the body is scrolled.
            const chromeRows = parts.header.length + 1 + parts.footer.length;
            const view = this.viewAfterLeaving(nodes, this.hasAllocatedHeight ? { top: this.bodyScroll.scrollTop, height: Math.max(1, this.bodyScroll.viewportHeight) }
              : this.unallocatedView(parts.body.length, chromeRows));
            parts.header.push(this.reportTitle(titles, view, parts.body.length, Math.max(1, width)));
          }
          geometry = { headerRows: parts.header.length, footerRows: parts.footer.length, nodes };
          this.keepCommentedNodeInView(nodes);
          return parts;
        }

        /**
         * The report's title rule, with the scroll position when the report does not fit. `titles` go from the fullest
         * to the shortest: at narrow widths the title shortens before the position goes, and the position before the title is cut.
         */
        private reportTitle(titles: readonly string[], view: View, total: number, w: number): string {
          const top = clamp(view.top, 0, Math.max(0, total - view.height));
          const position = total > view.height ? theme.fg('dim', scrollPosition(total, top, Math.min(total, top + view.height))) : undefined;
          return fittingTitle(theme, w, [...(position === undefined ? [] : titles.map(title => ({ title, right: position }))), ...titles.map(title => ({ title }))]);
        }

        /** Header without the report title, body and footer; `titles` are the report's titles, none when there is no checkpoint. */
        private compose(width: number): { parts: PanelParts; titles: readonly string[]; nodes: readonly LineRange[] } {
          const w = Math.max(1, width);
          // Another width wraps the report anew: a remembered line is no longer the same place.
          if (w !== lastWidth) { returnTop = null; if (leaving !== null) leaving = { ...leaving, top: null }; }
          lastWidth = w;
          const total = opts.items.length;

          // Parse intro: separate errors from status lines
          const errorLines: string[] = savedFault === null ? [] : [theme.fg('error', terminalText(savedFault))];
          const statusLines: string[] = [];
          for (const line of opts.intro.split('\n')) {
            if (line.startsWith('Error: ')) {
              errorLines.push(theme.fg('error', terminalText(line)));
            } else {
              const colon = line.indexOf(':');
              statusLines.push(colon === -1 ? theme.fg('muted', terminalText(line)) :
                `${theme.fg('muted', terminalText(line.slice(0, colon + 1)))}${terminalText(line.slice(colon + 1))}`);
            }
          }

          const footer = this.footer(w);

          // Empty state: no table chrome
          if (total === 0) {
            const emptyLine = theme.fg('muted', opts.emptyMessage);
            const bodyLines: string[] = [];
            for (const line of errorLines) bodyLines.push(...wrapTextWithAnsi(line, w));
            bodyLines.push('', emptyLine);
            for (const line of statusLines) bodyLines.push(...wrapTextWithAnsi(line, w));
            return { parts: { header: [frameTitle(theme, w, { title: opts.title }, 'none').line], body: bodyLines, footer }, titles: [], nodes: [] };
          }

          // Table: shown while the list is focused and no comment is being written; otherwise the report has its rows.
          const maxRows = this.maxTableRows();
          ensureVisible(total, maxRows);
          const ordinal = total - state.selectedIndex;
          // The row of the current set is not a saved checkpoint: it has a name instead of a number and is not counted.
          const selectedItem = opts.items[state.selectedIndex];
          const savedCount = opts.items.filter(item => item.kind === 'checkpoint').length;
          const header: string[] = [];
          const titles: string[] = [];
          if (this.tableShown()) {
            const columns = buildColumns(w);
            const visibleEnd = Math.min(state.topRow + maxRows, total);
            const rows: TableRow[] = [];
            for (let i = state.topRow; i < visibleEnd && i < total; i++) {
              const item = opts.items[i];
              if (item.kind === 'current') {
                rows.push({ cells: ['now', 'objectives and rules as the model last stated them', String(activeObjectives(item.set)), 'current'], selected: i === state.selectedIndex });
                continue;
              }
              const objCount = item.checkpoint.report?.objectives.length ?? 0;
              rows.push({
                cells: [
                  String(total - i),
                  terminalText(item.checkpoint.requestId),
                  item.checkpoint.report === null ? '·' : String(objCount),
                  item.checkpoint.report === null ? 'invalid' : 'saved',
                ],
                selected: i === state.selectedIndex,
              });
            }
            // Which rows of a longer list are shown; the pane's name outlasts it at narrow widths.
            const shownRows = total > maxRows ? [{ title: opts.title, meta: `${state.topRow + 1}–${visibleEnd} of ${total}` }] : [];
            header.push(fittingTitle(theme, w, [...shownRows, { title: opts.title }]), ...tableLines(theme, columns, rows, w));
            titles.push(selectedItem.kind === 'current' ? CURRENT_TITLE : `${ITEM_TITLE[opts.noun]} ${ordinal}`);
          } else if (selectedItem.kind === 'current') {
            titles.push(`Cuckoo ${CURRENT_TITLE.toLowerCase()}`, CURRENT_TITLE);
          } else {
            // The table that numbers the rows is hidden, so the title says which one of how many this is.
            titles.push(`Cuckoo ${opts.noun} ${ordinal} of ${savedCount}`, `${ITEM_TITLE[opts.noun]} ${ordinal} of ${savedCount}`);
          }

          // Detail: one muted line about the selected row, then its blocks; `item` marks the lines of one selectable item.
          const blockWidth = Math.max(20, w - 2 * NODE_GUTTER);
          let lead: string;
          let blocks: readonly { readonly item: boolean; readonly lines: readonly string[] }[];
          if (selectedItem.kind === 'current') {
            const nowMs = now();
            lead = `${currentSummary(selectedItem.set, nowMs)} · the model's own account, not live verification`;
            blocks = currentBlocks(theme, selectedItem.set, blockWidth, nowMs).map(block => ({ item: block.entry !== null, lines: block.lines }));
          } else {
            const comments = shown();
            const commentCount = comments.filter(item => item.requestId === selectedItem.checkpoint.requestId).length;
            const metaParts: string[] = [terminalText(selectedItem.checkpoint.requestId)];
            if (selectedItem.timestamp) metaParts.push(terminalText(selectedItem.timestamp));
            if (selectedItem.currentBranch !== undefined) metaParts.push(selectedItem.currentBranch ? 'current branch' : 'other branch');
            if (selectedItem.id && selectedItem.id !== terminalText(selectedItem.checkpoint.requestId)) {
              metaParts.push(`entry ${selectedItem.id}`);
            }
            if (selectedItem.checkpoint.report !== null) {
              const count = selectedItem.checkpoint.report.objectives.length;
              metaParts.push(`${count} objective${count === 1 ? '' : 's'} · saved self-report, not live verification`);
            } else {
              metaParts.push('invalid · saved attempt');
            }
            if (commentCount > 0) metaParts.push(`${commentCount} comment${commentCount === 1 ? '' : 's'}`);
            lead = metaParts.join(' · ');
            blocks = checkpointBlocks(theme, selectedItem.checkpoint, blockWidth, comments).map(block => ({ item: block.node !== null, lines: block.lines }));
          }

          // Body: errors first, then the lead line and detail, then status
          const bodyLines: string[] = [];
          for (const line of errorLines) bodyLines.push(...wrapTextWithAnsi(line, w));
          if (errorLines.length > 0) bodyLines.push('');
          bodyLines.push(...wrapTextWithAnsi(theme.fg('muted', lead), w), '');
          const nodes: LineRange[] = [];
          const contentWidth = Math.max(1, w - NODE_GUTTER);
          for (const block of blocks) {
            const start = bodyLines.length;
            const selected = block.item && state.node === nodes.length;
            const gutter = selected ? `${theme.fg('accent', '▌')} ` : ' '.repeat(NODE_GUTTER);
            for (const line of block.lines) for (const piece of wrapTextWithAnsi(line, contentWidth)) bodyLines.push(w > NODE_GUTTER ? `${gutter}${piece}` : piece);
            if (block.item) nodes.push({ start, end: bodyLines.length });
          }
          bodyLines.push('');
          for (const line of statusLines) bodyLines.push(...wrapTextWithAnsi(line, w));

          return { parts: { header, body: bodyLines, footer }, titles, nodes };
        }

        private editorInput(data: string): void {
          const open = draft;
          if (open === null) return;
          // Pasted bytes are text, never panel keys, even when split across packets.
          const paste = pasting || data.includes(PASTE_START);
          if (data.includes(PASTE_START)) pasting = true;
          if (data.includes(PASTE_END)) pasting = false;
          if (!paste && keys.matches(data, 'tui.select.cancel')) { draft = null; notice = 'Comment draft discarded.'; return; }
          open.editor.handleInput(data);
        }

        handleInput(data: string): void {
          // An exception escaping here ends the Pi process without closing the panel, which would lose the comments made in it.
          try { this.onInput(data); }
          catch (error) { ctx.ui.notify(terminalText(`Cuckoo panel error: ${String(error)}`), 'error'); }
        }

        private onInput(data: string): void {
          notice = '';
          const enteredAt = returnTop;
          returnTop = null;
          leaving = null;
          if (draft !== null) { this.editorInput(data); tui.requestRender(); return; }
          if (data === 'i') { requested = true; done(); return; }
          if (keys.matches(data, 'tui.select.cancel') || data === 'q') {
            // One level back: from the report to the list, from the list out of the pane.
            if (state.focus === 'list') { done(); return; }
            // Judged before the table returns: an item the user scrolled away from in the report is not brought back.
            const selected = state.node === null ? undefined : this.currentNodes()[state.node];
            const view = this.viewport();
            state.focus = 'list';
            leaving = { top: enteredAt, hold: selected !== undefined && this.onScreen(selected, view), height: view.height };
            tui.requestRender();
            return;
          }

          const total = opts.items.length;
          const prev = state.selectedIndex;
          const up = matchesKey(data, Key.up) || data === 'k';
          const down = matchesKey(data, Key.down) || data === 'j';

          if (state.focus === 'report' && (up || down)) {
            this.stepItem(up ? -1 : 1);
            tui.requestRender();
            return;
          } else if (keys.matches(data, 'tui.select.confirm')) {
            if (state.focus === 'list') this.focusReport();
            tui.requestRender();
            return;
          } else if (up) {
            if (total > 0) state.selectedIndex = clamp(state.selectedIndex - 1, 0, total - 1);
          } else if (down) {
            if (total > 0) state.selectedIndex = clamp(state.selectedIndex + 1, 0, total - 1);
          } else if (matchesKey(data, Key.tab)) {
            this.moveNode(1);
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.shift('tab'))) {
            this.moveNode(-1);
            tui.requestRender();
            return;
          } else if (data === 'c') {
            this.startComment();
            tui.requestRender();
            return;
          } else if (data === 'x') {
            this.removeStaged();
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.ctrl('u')) || matchesKey(data, Key.pageUp)) {
            const page = Math.max(1, Math.floor(Math.max(1, this.bodyScroll.viewportHeight) / 2));
            if (this.hasAllocatedHeight) { this.bodyScroll.scrollBy(-page); state.scrollOffset = this.bodyScroll.scrollTop; }
            else state.scrollOffset = Math.max(0, state.scrollOffset - page);
            this.invalidate();
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.ctrl('d')) || matchesKey(data, Key.pageDown)) {
            const page = Math.max(1, Math.floor(Math.max(1, this.bodyScroll.viewportHeight) / 2));
            if (this.hasAllocatedHeight) { this.bodyScroll.scrollBy(page); state.scrollOffset = this.bodyScroll.scrollTop; }
            else state.scrollOffset = state.scrollOffset + page;
            this.invalidate();
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.home)) {
            state.scrollOffset = 0;
            this.bodyScroll.scrollToStart();
            this.invalidate();
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.end)) {
            state.scrollOffset = Number.MAX_SAFE_INTEGER;
            this.bodyScroll.scrollToEnd();
            this.invalidate();
            tui.requestRender();
            return;
          } else {
            return;
          }

          if (total > 0 && state.selectedIndex !== prev) {
            ensureVisible(total, this.maxTableRows());
            state.scrollOffset = 0;
            state.node = null;
            this.bodyScroll.scrollToStart();
            this.invalidate();
            tui.requestRender();
          }
        }

        handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout['handleMouse']> {
          const handled = (render: boolean): NonNullable<ReturnType<PanelLayout['handleMouse']>> =>
            ({ handled: true, render, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } });
          // Like a key, a press, a click or the wheel ends what the last focus change left pending.
          if (event.type !== 'move' && event.type !== 'release') { returnTop = null; leaving = null; }
          if (event.type === 'wheel' && event.wheelDelta) {
            if (this.hasAllocatedHeight) { this.bodyScroll.scrollBy(event.wheelDelta); state.scrollOffset = this.bodyScroll.scrollTop; }
            else state.scrollOffset = Math.max(0, state.scrollOffset + event.wheelDelta);
            this.invalidate();
            return handled(true);
          }
          if ((event.type !== 'press' && event.type !== 'click') || event.button !== 'left' || draft !== null || geometry === null) return undefined;
          if (event.y < geometry.headerRows || event.y >= event.height - geometry.footerRows) return undefined;
          const line = event.y - geometry.headerRows + this.viewport().top;
          const index = geometry.nodes.findIndex(range => line >= range.start && line < range.end);
          if (index === -1) return undefined;
          // The dispatcher synthesizes the click from this press target; only the click selects.
          if (event.type === 'press') return handled(false);
          state.node = index;
          this.invalidate();
          return handled(true);
        }
      })();

      return panel;
    });
    if (requested && this.active) this.inquire(ctx);
  }

  /** `current` is the current set of the branch the reports are from. */
  publish(ctx: ExtensionContext, reports: readonly Checkpoint[], current: CurrentSet, enabled: boolean, fault: string | null, repaint = false): void {
    this.lastReports = reports;
    this.lastCurrent = current;
    this.lastFault = fault;
    this.lastEnabled = enabled;
    if (!this.active) return;
    const showBadge = enabled || reports.length > 0 || current.events > 0 || fault !== null;
    if (!showBadge && !repaint) { ctx.ui.setWidget('cuckoo', undefined); return; }
    const latest = reports.at(-1);
    const valid = reports.findLast(value => value.report !== null);
    // The active objectives of the current set; for a branch without one, the objective count of the last valid report;
    // nothing before the first one.
    const count = current.events > 0 ? String(activeObjectives(current)) : valid === undefined || valid.report === null ? '' : String(valid.report.objectives.length);
    const warning = fault !== null || (latest !== undefined && latest.report === null);
    const compact = `${count}${warning ? '!' : ''}`;
    const badge: BorderBadge = {
      glyph: BADGE_GLYPH,
      state: warning ? 'attention' : 'settled',
      label: [count, warning ? '!' : '', enabled ? '' : 'off'].filter(part => part !== '').join(' '),
      compact,
      wideShortcut: REPORTS_SHORTCUT.label,
    };
    ctx.ui.setWidget('cuckoo', (tui, theme) => {
      if (repaint) tui.invalidate();
      return {
        render: width => [borderBadge(theme, badge, width)],
        renderCompact: width => borderBadgeCompact(theme, badge, width),
        invalidate() {},
        handleMouse: event => {
          if (!this.active || event.type !== 'click' || event.button !== 'left' || ctx.mode !== 'tui' || !ctx.hasUI) return undefined;
          const intro = this.lastFault !== null ? `Error: ${this.lastFault}` :
            this.lastEnabled ? 'Cuckoo: ON (badge)' : 'Cuckoo: OFF (badge)';
          void this.showReports(ctx, this.lastReports, intro, this.lastCurrent);
          return { handled: true };
        },
      };
    }, { placement: 'borderBottomLeft', order: BORDER_ORDER.cuckoo });
    if (!showBadge) ctx.ui.setWidget('cuckoo', undefined);
  }

  dispose(ctx: ExtensionContext): void { this.active = false; this.pane.dispose(); ctx.ui.setWidget('cuckoo', undefined); }
}