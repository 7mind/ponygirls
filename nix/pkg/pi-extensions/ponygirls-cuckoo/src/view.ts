import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { CustomViewToggle, StatusView } from '@ponygirls/pi-ui';
import type { Checkpoint } from './report.ts';
import { reportContent, terminalText, type CuckooContent } from './presentation.ts';

const BADGE_GLYPH = '🐦';

export class CuckooView {
  private readonly pane = new CustomViewToggle();
  private active = true;
  private readonly inquire: (ctx: ExtensionContext) => void;
  constructor(inquire: (ctx: ExtensionContext) => void) { this.inquire = inquire; }
  async show(ctx: ExtensionContext, content: CuckooContent): Promise<void> {
    if (!this.active) return;
    const safe = terminalText(content.plain);
    if (ctx.mode !== 'tui' || !ctx.hasUI) { ctx.ui.notify(safe, 'info'); return; }
    let requested = false;
    await this.pane.toggle(ctx.ui, (tui, theme, keys, done) => new class extends StatusView {
      override handleInput(data: string): void {
        if (data === 'i') { requested = true; done(); return; }
        super.handleInput(data);
      }
    }({
      title: content.title, text: () => `${theme.fg('dim', 'i: inquire now')}\n\n${content.render(theme)}`, theme, keys,
      rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done,
    }));
    if (requested && this.active) this.inquire(ctx);
  }
  publish(ctx: ExtensionContext, reports: readonly Checkpoint[], enabled: boolean, fault: string | null): void {
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
        void this.show(ctx, reportContent(reports, fault === null ? '' : `Error: ${fault}`)).catch((error: unknown) => ctx.ui.notify(terminalText(`Cuckoo: ${String(error)}`), 'error'));
        return { handled: true };
      },
    }), { placement: 'borderBottomLeft' });
  }
  dispose(ctx: ExtensionContext): void { this.active = false; this.pane.dispose(); ctx.ui.setWidget('cuckoo', undefined); }
}
