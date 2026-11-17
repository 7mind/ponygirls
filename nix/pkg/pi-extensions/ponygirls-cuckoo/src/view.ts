import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, Editor, matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Focusable, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { CustomViewToggle, fit, fitRight, frameRule, frameTitle, keyHints, PanelLayout, type KeyHint, type PanelParts, type UiTheme } from '@ponygirls/pi-ui';
import type { Checkpoint } from './report.ts';
import { checkpoints as collectCheckpoints, REPORT_TYPE } from './report.ts';
import { checkpointBlocks, reportContent, historyContent, terminalText } from './presentation.ts';
import { commentNodes, commentText, sameNode, type CommentDraft, type CommentNode, type SavedComment, type ShownComment } from './comments.ts';

const BADGE_GLYPH = '🐦';
const PI_CHROME = 2;
const NODE_GUTTER = 2;
const MAX_EDITOR_ROWS = 6;
const MAX_INFO_ROWS = 2;
const UNRENDERED_WIDTH = 80;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export type CommentScope = 'branch' | 'session';
/** Where report comments are read from and persisted to; owned by the extension runtime. */
export interface CommentHost {
  /** Comments already saved in the given scope of the current session. */
  saved(ctx: ExtensionContext, scope: CommentScope): readonly SavedComment[];
  /** Persist comments made in a panel and hand them to the model at the next safe point. */
  save(ctx: ExtensionContext, comments: readonly CommentDraft[]): void;
}

interface LineRange { start: number; end: number }
interface Geometry { headerRows: number; footerRows: number; nodes: readonly LineRange[] }
interface EditorDraft { editor: Editor; requestId: string; node: CommentNode }

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

function detailTitleLine(theme: UiTheme, text: string, meta: string): string {
  return `${theme.fg('accent', theme.bold(`── ${text}`))}${meta ? theme.fg('muted', ` · ${meta}`) : ''}`;
}

interface TableItem {
  checkpoint: Checkpoint;
  label: string;
  id: string;
  meta: string;
  timestamp?: string;
  currentBranch?: boolean;
}

export class CuckooView {
  private readonly pane = new CustomViewToggle();
  private active = true;
  private readonly inquire: (ctx: ExtensionContext) => void;
  private readonly comments: CommentHost;
  private lastReports: readonly Checkpoint[] = [];
  private lastFault: string | null = null;
  private lastEnabled = false;
  constructor(inquire: (ctx: ExtensionContext) => void, comments: CommentHost) { this.inquire = inquire; this.comments = comments; }

  async showReports(ctx: ExtensionContext, reports: readonly Checkpoint[], intro: string): Promise<void> {
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify(terminalText(reportContent(reports, intro, this.comments.saved(ctx, 'branch')).plain), 'info');
      return;
    }
    const items: TableItem[] = [...reports].reverse().map((r, i) => ({
      checkpoint: r,
      label: `Checkpoint ${reports.length - i}`,
      id: terminalText(r.requestId),
      meta: r.report === null ? 'invalid' : `${r.report.objectives.length} objectives`,
    }));
    await this.showTable(ctx, { title: 'Cuckoo objectives and progress', items, intro, emptyMessage: 'No Cuckoo reports on this branch yet.', commentScope: 'branch' });
  }

  async showHistory(ctx: ExtensionContext, entries: readonly SessionEntry[], branch: readonly SessionEntry[]): Promise<void> {
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify(terminalText(historyContent(entries, branch).plain), 'info');
      return;
    }
    const current = new Set(branch.map(e => e.id));
    const answers = entries.filter(e => e.type === 'custom' && e.customType === REPORT_TYPE);
    const items: TableItem[] = [...answers].reverse().map((entry, i) => {
      const cp = collectCheckpoints([entry])[0];
      return {
        checkpoint: cp,
        label: `Answer ${answers.length - i}`,
        id: terminalText(entry.id),
        meta: `${cp.report === null ? 'invalid' : `${cp.report.objectives.length} objectives`}`,
        timestamp: entry.timestamp,
        currentBranch: current.has(entry.id),
      };
    });
    await this.showTable(ctx, {
      title: 'Cuckoo answer history', items, intro: 'This session · all branches · newest first · saved answers, not live verification',
      emptyMessage: 'No Cuckoo answers in this session yet.', commentScope: 'session',
    });
  }

  private async showTable(
    ctx: ExtensionContext,
    opts: { title: string; items: readonly TableItem[]; intro: string; emptyMessage: string; commentScope: CommentScope },
  ): Promise<void> {
    if (!this.active) return;
    let requested = false;
    const host = this.comments;
    await this.pane.toggle(ctx.ui, (tui, theme, keys, done) => {
      const state = { selectedIndex: 0, topRow: 0, scrollOffset: 0, node: null as number | null };
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
      let lastView: { top: number; height: number } | null = null;

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
        private hasFocus = false;
        constructor() { super((width) => this.buildParts(width)); }
        override invalidate(): void {}

        get focused(): boolean { return this.hasFocus; }
        set focused(value: boolean) { this.hasFocus = value; if (draft !== null) draft.editor.focused = value; }

        override render(width: number): string[] {
          const parts = this.buildParts(width);
          const totalBody = parts.body.length;
          const available = Math.max(1, tui.terminal.rows - PI_CHROME - parts.header.length - parts.footer.length);
          const viewLines = Math.max(1, Math.min(totalBody, available));
          const maxScroll = Math.max(0, totalBody - viewLines);
          const start = Math.min(state.scrollOffset, maxScroll);
          lastView = { top: start, height: viewLines };
          const visible = parts.body.slice(start, start + viewLines);
          return [...parts.header, ...visible, ...parts.footer];
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
          try { host.save(ctx, staged.splice(0)); }
          catch (error) { ctx.ui.notify(terminalText(`Cuckoo: comments were not saved: ${String(error)}`), 'error'); }
        }

        private maxTableRows(): number {
          const footerReserve = 2;
          const minBody = 4;
          const headerChrome = 5;
          const total = this.hasAllocatedHeight ? this.height(24)
            : Math.max(10, tui.terminal.rows - PI_CHROME);
          const available = Math.max(1, total - footerReserve - minBody - headerChrome);
          return clamp(Math.min(3, available), 1, 3);
        }

        private selectedNodes(): CommentNode[] {
          const item = opts.items[state.selectedIndex];
          return item === undefined ? [] : commentNodes(item.checkpoint);
        }

        /** Node line ranges for the current state. Recomputed on demand: keys can arrive without a frame in between. */
        private currentNodes(): readonly LineRange[] { return this.compose(lastWidth).nodes; }

        private viewport(): { top: number; height: number } {
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

        private startComment(): void {
          const item = opts.items[state.selectedIndex];
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
                { key: 'enter', action: 'add comment' },
                { key: 'shift-enter', action: 'newline' },
                { key: 'esc', action: 'discard draft' },
              ]).lines,
            ];
          }
          const hints: KeyHint[] = [
            { key: '↑↓/j k', action: 'select' },
            { key: 'ctrl-u/d', action: 'detail ↥↧' },
            { key: 'Home End', action: 'detail ↥↧' },
            { key: 'tab/shift-tab', action: 'item' },
            { key: 'c', action: 'comment' },
            ...(staged.length === 0 ? [] : [{ key: 'x', action: 'remove new comment' }]),
            { key: 'i', action: 'inquire now' },
            { key: 'esc/q', action: 'close' },
          ];
          const info = notice !== '' ? theme.fg('warning', notice) : staged.length === 0 ? '' :
            theme.fg('success', `${staged.length} new comment${staged.length === 1 ? '' : 's'}: saved to history and sent to the model when this panel closes`);
          return [...(info === '' ? [] : wrapTextWithAnsi(info, w).slice(0, MAX_INFO_ROWS)), ...keyHints(theme, w, hints).lines];
        }

        private buildParts(width: number): PanelParts {
          const { parts, nodes } = this.compose(width);
          geometry = { headerRows: parts.header.length, footerRows: parts.footer.length, nodes };
          this.keepCommentedNodeInView(nodes);
          return parts;
        }

        private compose(width: number): { parts: PanelParts; nodes: readonly LineRange[] } {
          const w = Math.max(1, width);
          lastWidth = w;
          const total = opts.items.length;
          const titleLine = frameTitle(theme, w, { title: opts.title }, 'none').line;

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
            return { parts: { header: [titleLine], body: bodyLines, footer }, nodes: [] };
          }

          // Table
          const maxRows = this.maxTableRows();
          ensureVisible(total, maxRows);
          const columns = buildColumns(w);
          const visibleEnd = Math.min(state.topRow + maxRows, total);
          const rows: TableRow[] = [];
          for (let i = state.topRow; i < visibleEnd && i < total; i++) {
            const item = opts.items[i];
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
          const tblLines = tableLines(theme, columns, rows, w);
          const navHint = total > maxRows
            ? theme.fg('muted', `  ${state.topRow + 1}–${visibleEnd} of ${total}`)
            : '';

          // Detail
          const selectedItem = opts.items[state.selectedIndex];
          const comments = shown();
          const commentCount = comments.filter(item => item.requestId === selectedItem.checkpoint.requestId).length;
          const metaParts: string[] = [];
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
          const detailHdr = detailTitleLine(theme, `${selectedItem.label} (${terminalText(selectedItem.checkpoint.requestId)})`, metaParts.join(' · '));

          // Body: errors first, then detail header + detail, then status
          const bodyLines: string[] = [];
          for (const line of errorLines) bodyLines.push(...wrapTextWithAnsi(line, w));
          bodyLines.push('', ...wrapTextWithAnsi(detailHdr, w), '');
          const nodes: LineRange[] = [];
          const contentWidth = Math.max(1, w - NODE_GUTTER);
          for (const block of checkpointBlocks(theme, selectedItem.checkpoint, Math.max(20, w - 2 * NODE_GUTTER), comments)) {
            const start = bodyLines.length;
            const selected = block.node !== null && state.node === nodes.length;
            const gutter = selected ? `${theme.fg('accent', '▌')} ` : ' '.repeat(NODE_GUTTER);
            for (const line of block.lines) for (const piece of wrapTextWithAnsi(line, contentWidth)) bodyLines.push(w > NODE_GUTTER ? `${gutter}${piece}` : piece);
            if (block.node !== null) nodes.push({ start, end: bodyLines.length });
          }
          bodyLines.push('');
          for (const line of statusLines) bodyLines.push(...wrapTextWithAnsi(line, w));

          return { parts: { header: [titleLine, '', ...tblLines, navHint], body: bodyLines, footer }, nodes };
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
          if (draft !== null) { this.editorInput(data); tui.requestRender(); return; }
          if (data === 'i') { requested = true; done(); return; }
          if (keys.matches(data, 'tui.select.cancel') || data === 'q') { done(); return; }

          const total = opts.items.length;
          const prev = state.selectedIndex;

          if (matchesKey(data, Key.up) || data === 'k') {
            if (total > 0) state.selectedIndex = clamp(state.selectedIndex - 1, 0, total - 1);
          } else if (matchesKey(data, Key.down) || data === 'j') {
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
          } else if (matchesKey(data, Key.ctrl('u'))) {
            const page = Math.max(1, Math.floor(Math.max(1, this.bodyScroll.viewportHeight) / 2));
            if (this.hasAllocatedHeight) { this.bodyScroll.scrollBy(-page); state.scrollOffset = this.bodyScroll.scrollTop; }
            else state.scrollOffset = Math.max(0, state.scrollOffset - page);
            this.invalidate();
            tui.requestRender();
            return;
          } else if (matchesKey(data, Key.ctrl('d'))) {
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

  publish(ctx: ExtensionContext, reports: readonly Checkpoint[], enabled: boolean, fault: string | null): void {
    this.lastReports = reports;
    this.lastFault = fault;
    this.lastEnabled = enabled;
    if (!this.active) return;
    if (!enabled && reports.length === 0 && fault === null) { ctx.ui.setWidget('cuckoo', undefined); return; }
    const latest = reports.at(-1);
    const valid = reports.findLast(value => value.report !== null);
    const count = valid === undefined || valid.report === null ? '?' : String(valid.report.objectives.length);
    const warning = fault !== null || (latest !== undefined && latest.report === null);
    const label = `${BADGE_GLYPH} ${count}${warning ? ' !' : ''}${enabled ? '' : ' off'}`;
    ctx.ui.setWidget('cuckoo', (_tui, theme) => ({
      render: width => [truncateToWidth(theme.fg(warning ? 'warning' : 'accent', ` ${label} `), width)],
      renderCompact: width => truncateToWidth(theme.fg(warning ? 'warning' : 'accent', ` ${BADGE_GLYPH} ${count}${warning ? '!' : ''} `), width),
      invalidate() {},
      handleMouse: event => {
        if (!this.active || event.type !== 'click' || event.button !== 'left' || ctx.mode !== 'tui' || !ctx.hasUI) return undefined;
        const intro = this.lastFault !== null ? `Error: ${this.lastFault}` :
          this.lastEnabled ? 'Cuckoo: ON (badge)' : 'Cuckoo: OFF (badge)';
        void this.showReports(ctx, this.lastReports, intro);
        return { handled: true };
      },
    }), { placement: 'borderBottomLeft' });
  }

  dispose(ctx: ExtensionContext): void { this.active = false; this.pane.dispose(); ctx.ui.setWidget('cuckoo', undefined); }
}