import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { PanelLayout, frameTitle, keyHints, type PanelParts, type UiTheme } from '@ponygirls/pi-ui';

function live(signal: AbortSignal): void { if (signal.aborted) throw new Error('Operator review cancelled'); }

export function requireOperatorUI(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== 'tui') {
    throw new Error('Operator approval requires an interactive TUI');
  }
}

/** Reversible JSON-string representation; whitespace and non-ASCII units are visible escapes. */
export function operatorDisplay(text: string): string {
  return JSON.stringify(text).replace(/[^\x21-\x7e]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

type TextPurpose = 'preview' | 'approval';
interface TransferKeys {
  matches(data: string, action: 'tui.select.confirm' | 'tui.select.cancel'): boolean;
}

class TransferTextPanel extends PanelLayout {
  readonly capturesViewportInput = true;
  private readonly title: string;
  private readonly display: string;
  private readonly purpose: TextPurpose;
  private readonly signal: AbortSignal;
  private readonly theme: UiTheme;
  private readonly keys: TransferKeys;
  private readonly repaint: () => void;
  private readonly finish: (accepted: boolean) => void;
  private active = true;
  private approveSelected = false;
  private cachedWidth = 0;
  private lines: string[] = [];

  constructor(title: string, text: string, purpose: TextPurpose, signal: AbortSignal, theme: UiTheme, keys: TransferKeys, repaint: () => void, finish: (accepted: boolean) => void) {
    super(width => this.partsFor(width));
    this.title = title; this.display = operatorDisplay(text); this.purpose = purpose;
    this.signal = signal; this.theme = theme; this.keys = keys; this.repaint = repaint; this.finish = finish;
  }

  private partsFor(width: number): PanelParts {
    const w = Math.max(1, Math.floor(width));
    if (this.cachedWidth !== w) {
      this.cachedWidth = w; this.lines = [];
      for (let start = 0; start < this.display.length; start += w) this.lines.push(this.display.slice(start, start + w));
    }
    const hints = keyHints(this.theme, w, [
      { key: 'j/k ↑↓', action: 'scroll' }, { key: 'Ctrl-U/D', action: 'page' }, { key: 'Home/End', action: 'bounds' },
      ...(this.purpose === 'approval' ? [{ key: '←/→', action: 'choose' }] : []),
      { key: 'Enter', action: this.purpose === 'approval' ? 'confirm choice' : 'close preview' }, { key: 'Esc', action: 'cancel' },
    ]);
    const top = this.bodyScroll.scrollTop;
    const bottom = Math.min(this.lines.length, top + this.bodyHeight(this.lines.length));
    const footer = [truncateToWidth(`Lines ${top + 1}-${bottom}/${this.lines.length}`, w, '')];
    if (this.purpose === 'approval') footer.push(truncateToWidth(this.approveSelected ? '  Cancel    [Approve]' : '[Cancel]     Approve', w, ''));
    return {
      header: [frameTitle(this.theme, w, { title: this.title }, 'none').line,
        truncateToWidth('Read-only escaped text; whitespace is explicit. No hidden omissions.', w, '')],
      body: this.lines,
      footer: [...footer, ...hints.lines],
    };
  }

  close(accepted: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.finish(accepted && !this.signal.aborted);
  }

  handleInput(data: string): void {
    if (!this.active) return;
    if (this.signal.aborted || this.keys.matches(data, 'tui.select.cancel')) { this.close(false); return; }
    if (this.keys.matches(data, 'tui.select.confirm')) { this.close(this.purpose === 'preview' || this.approveSelected); return; }
    if (this.purpose === 'approval' && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
      this.approveSelected = matchesKey(data, Key.right);
    } else if (matchesKey(data, Key.down) || data === 'j') this.bodyScroll.scrollBy(1);
    else if (matchesKey(data, Key.up) || data === 'k') this.bodyScroll.scrollBy(-1);
    else if (matchesKey(data, Key.ctrl('d')) || matchesKey(data, Key.pageDown)) this.bodyScroll.scrollBy(Math.max(1, this.bodyScroll.viewportHeight));
    else if (matchesKey(data, Key.ctrl('u')) || matchesKey(data, Key.pageUp)) this.bodyScroll.scrollBy(-Math.max(1, this.bodyScroll.viewportHeight));
    else if (matchesKey(data, Key.home)) this.bodyScroll.scrollToStart();
    else if (matchesKey(data, Key.end)) this.bodyScroll.scrollToEnd();
    else return;
    this.invalidate(); this.repaint();
  }

  dispose(): void { this.active = false; }
}

async function showTransferText(ctx: ExtensionContext, title: string, text: string, signal: AbortSignal, purpose: TextPurpose): Promise<boolean> {
  requireOperatorUI(ctx); live(signal);
  let panel: TransferTextPanel | null = null;
  const abort = (): void => { if (panel !== null) panel.close(false); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const result = await ctx.ui.custom<boolean>((tui, theme, keys, done) => {
      panel = new TransferTextPanel(title, text, purpose, signal, theme, keys, () => tui.requestRender(), done);
      if (signal.aborted) queueMicrotask(abort);
      return panel;
    }, { retainEditorBorders: true, blocked: { kind: purpose === 'approval' ? 'permission' : 'question', message: title } });
    return result === true && !signal.aborted;
  } finally {
    signal.removeEventListener('abort', abort);
    if (panel !== null) (panel as TransferTextPanel).dispose();
  }
}

/** Complete immutable preview; closing it does not approve anything. */
export function previewOperatorText(ctx: ExtensionContext, title: string, exactText: string, signal: AbortSignal): Promise<boolean> {
  return showTransferText(ctx, title, exactText, signal, 'preview');
}

/** Separate scope confirmation with an explicit Cancel default. */
export function confirmOperatorAction(ctx: ExtensionContext, title: string, details: string, signal: AbortSignal): Promise<boolean> {
  return showTransferText(ctx, title, details, signal, 'approval');
}
