import {
  constants, openSync, closeSync, fstatSync, readSync, writeSync,
  fsyncSync, realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { PanelLayout, frameTitle, keyHints, type PanelParts, type UiTheme } from '@ponygirls/pi-ui';
import { MAX_TRANSFER_MANIFEST_BYTES } from './experiments/session-transfer.ts';

export const MAX_TRANSFER_PATH_CHARS = 4096;

export interface TransferFiles {
  projectId(cwd: string): string;
  read(path: string, signal: AbortSignal): string;
  writeExclusive(
    path: string,
    text: string,
    assertCurrent: () => void,
  ): void;
}

function absolutePath(path: string): void {
  if (
    typeof path !== 'string' || path.length === 0 ||
    path.length > MAX_TRANSFER_PATH_CHARS ||
    path.includes('\0') || !isAbsolute(path)
  ) throw new Error('Transfer requires an explicit absolute file path');
}

function live(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Transfer cancelled');
}

function regularFile(fd: number): void {
  const stat = fstatSync(fd);
  if (!stat.isFile()) {
    throw new Error('Transfer requires a regular file');
  }
  if (stat.size > MAX_TRANSFER_MANIFEST_BYTES) {
    throw new Error('Transfer file exceeds its byte bound');
  }
}

/**
 * Explicit supplied paths only. No traversal, directory creation, session-file
 * loading, overwrite, cleanup deletion, credential access, or discovery.
 */
export class NativeTransferFiles implements TransferFiles {
  projectId(cwd: string): string {
    const canonical = realpathSync.native(cwd);
    return `cwd-sha256:${createHash('sha256')
      .update(canonical, 'utf8').digest('hex')}`;
  }

  read(path: string, signal: AbortSignal): string {
    absolutePath(path);
    live(signal);
    const fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      regularFile(fd);
      const buffer = Buffer.alloc(MAX_TRANSFER_MANIFEST_BYTES + 1);
      let size = 0;
      for (;;) {
        live(signal);
        if (size === buffer.length) {
          throw new Error('Transfer file exceeds its byte bound');
        }
        const count = readSync(
          fd, buffer, size, buffer.length - size, null,
        );
        if (count === 0) break;
        size += count;
      }
      if (size > MAX_TRANSFER_MANIFEST_BYTES) {
        throw new Error('Transfer file exceeds its byte bound');
      }
      live(signal);
      // Preserve a BOM so the exact canonical validator rejects it.
      return new TextDecoder('utf-8', {
        fatal: true, ignoreBOM: true,
      }).decode(buffer.subarray(0, size));
    } finally {
      closeSync(fd);
    }
  }

  writeExclusive(
    path: string,
    text: string,
    assertCurrent: () => void,
  ): void {
    absolutePath(path);
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > MAX_TRANSFER_MANIFEST_BYTES) {
      throw new Error('Transfer export exceeds its byte bound');
    }
    assertCurrent();
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      regularFile(fd);
      let offset = 0;
      while (offset < bytes.length) {
        assertCurrent();
        const count = writeSync(
          fd, bytes, offset, bytes.length - offset, null,
        );
        if (count <= 0) throw new Error('Transfer export made no progress');
        offset += count;
      }
      assertCurrent();
      fsyncSync(fd);
      assertCurrent();
    } finally {
      closeSync(fd);
    }
  }
}

export function requireTransferUI(ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== 'tui') {
    throw new Error('Transfer approval requires an interactive TUI');
  }
}

/** Reversible JSON-string representation; whitespace and non-ASCII units are visible escapes. */
export function transferDisplay(text: string): string {
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
    this.title = title; this.display = transferDisplay(text); this.purpose = purpose;
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
  requireTransferUI(ctx); live(signal);
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
export function previewTransfer(ctx: ExtensionContext, title: string, exactText: string, signal: AbortSignal): Promise<boolean> {
  return showTransferText(ctx, title, exactText, signal, 'preview');
}

/** Separate scope confirmation with an explicit Cancel default. */
export function confirmTransfer(ctx: ExtensionContext, title: string, details: string, signal: AbortSignal): Promise<boolean> {
  return showTransferText(ctx, title, details, signal, 'approval');
}
