import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { CustomViewToggle, fit, fitRight, frameTitle, keyHints, PanelLayout, type PanelParts, type UiTheme } from '@ponygirls/pi-ui';
import type { Checkpoint } from './report.ts';
import { checkpoints as collectCheckpoints, REPORT_TYPE } from './report.ts';
import { checkpointDetail, reportContent, historyContent, terminalText } from './presentation.ts';

const BADGE_GLYPH = '🐦';
const PI_CHROME = 2;

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
  private lastReports: readonly Checkpoint[] = [];
  private lastFault: string | null = null;
  private lastEnabled = false;
  constructor(inquire: (ctx: ExtensionContext) => void) { this.inquire = inquire; }

  async showReports(ctx: ExtensionContext, reports: readonly Checkpoint[], intro: string): Promise<void> {
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      ctx.ui.notify(terminalText(reportContent(reports, intro).plain), 'info');
      return;
    }
    const items: TableItem[] = [...reports].reverse().map((r, i) => ({
      checkpoint: r,
      label: `Checkpoint ${reports.length - i}`,
      id: terminalText(r.requestId),
      meta: r.report === null ? 'invalid' : `${r.report.objectives.length} objectives`,
    }));
    await this.showTable(ctx, { title: 'Cuckoo objectives and progress', items, intro, emptyMessage: 'No Cuckoo reports on this branch yet.' });
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
      emptyMessage: 'No Cuckoo answers in this session yet.',
    });
  }

  private async showTable(
    ctx: ExtensionContext,
    opts: { title: string; items: readonly TableItem[]; intro: string; emptyMessage: string },
  ): Promise<void> {
    if (!this.active) return;
    let requested = false;
    await this.pane.toggle(ctx.ui, (tui, theme, keys, done) => {
      const state = { selectedIndex: 0, topRow: 0, scrollOffset: 0 };

      function maxTop(total: number, maxRows: number): number { return Math.max(0, total - maxRows); }
      function ensureVisible(total: number, maxRows: number): void {
        state.topRow = clamp(state.topRow, 0, maxTop(total, maxRows));
        if (state.selectedIndex < state.topRow) state.topRow = state.selectedIndex;
        if (state.selectedIndex >= state.topRow + maxRows) state.topRow = clamp(state.selectedIndex - maxRows + 1, 0, maxTop(total, maxRows));
      }

      const panel = new (class extends PanelLayout {
        constructor() { super((width) => this.buildParts(width)); }
        override invalidate(): void {}

        override render(width: number): string[] {
          const parts = this.buildParts(width);
          const totalBody = parts.body.length;
          const available = Math.max(1, tui.terminal.rows - PI_CHROME - parts.header.length - parts.footer.length);
          const viewLines = Math.max(1, Math.min(totalBody, available));
          const maxScroll = Math.max(0, totalBody - viewLines);
          const start = Math.min(state.scrollOffset, maxScroll);
          const visible = parts.body.slice(start, start + viewLines);
          return [...parts.header, ...visible, ...parts.footer];
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

        private buildParts(width: number): PanelParts {
          const w = Math.max(1, width);
          const total = opts.items.length;
          const titleLine = frameTitle(theme, w, { title: opts.title }, 'none').line;

          // Parse intro: separate errors from status lines
          const errorLines: string[] = [];
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

          // Footer hints
          const footerHints = keyHints(theme, w, [
            { key: '↑↓/j k', action: 'select' },
            { key: 'ctrl-u/d', action: 'detail ↥↧' },
            { key: 'Home End', action: 'detail ↥↧' },
            { key: 'i', action: 'inquire now' },
            { key: 'esc/q', action: 'close' },
          ]);

          // Empty state: no table chrome
          if (total === 0) {
            const emptyLine = theme.fg('muted', opts.emptyMessage);
            const bodyLines: string[] = [];
            for (const line of errorLines) bodyLines.push(...wrapTextWithAnsi(line, w));
            bodyLines.push('', emptyLine);
            for (const line of statusLines) bodyLines.push(...wrapTextWithAnsi(line, w));
            return { header: [titleLine], body: bodyLines, footer: footerHints.lines };
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
          const detailHdr = detailTitleLine(theme, `${selectedItem.label} (${terminalText(selectedItem.checkpoint.requestId)})`, metaParts.join(' · '));
          const detailText = checkpointDetail(theme, selectedItem.checkpoint, Math.max(20, w - 4));
          const detailWrapped = detailText.split('\n').flatMap(line => wrapTextWithAnsi(line, w));

          // Body: errors first, then detail header + detail, then status
          const bodyLines: string[] = [];
          for (const line of errorLines) bodyLines.push(...wrapTextWithAnsi(line, w));
          bodyLines.push('', ...wrapTextWithAnsi(detailHdr, w), '');
          for (const line of detailWrapped) bodyLines.push(line);
          bodyLines.push('');
          for (const line of statusLines) bodyLines.push(...wrapTextWithAnsi(line, w));

          return {
            header: [titleLine, '', ...tblLines, navHint],
            body: bodyLines,
            footer: footerHints.lines,
          };
        }

        handleInput(data: string): void {
          if (data === 'i') { requested = true; done(); return; }
          if (keys.matches(data, 'tui.select.cancel') || data === 'q') { done(); return; }

          const total = opts.items.length;
          const prev = state.selectedIndex;

          if (matchesKey(data, Key.up) || data === 'k') {
            if (total > 0) state.selectedIndex = clamp(state.selectedIndex - 1, 0, total - 1);
          } else if (matchesKey(data, Key.down) || data === 'j') {
            if (total > 0) state.selectedIndex = clamp(state.selectedIndex + 1, 0, total - 1);
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
            this.bodyScroll.scrollToStart();
            this.invalidate();
            tui.requestRender();
          }
        }

        handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout['handleMouse']> {
          if (event.type !== 'wheel' || !event.wheelDelta) return undefined;
          if (this.hasAllocatedHeight) { this.bodyScroll.scrollBy(event.wheelDelta); state.scrollOffset = this.bodyScroll.scrollTop; }
          else state.scrollOffset = Math.max(0, state.scrollOffset + event.wheelDelta);
          this.invalidate();
          return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
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