import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { consumableLength, decodeAndSanitize, DISPLAY_BOUNDARY_CONTEXT, recordBreaks } from "./terminal-text.ts";

export const VIEW_WINDOW_BYTES = 131072;

type ReadRange = (from: number, to: number) => Promise<Uint8Array>;
interface RecordView {
  from: number;
  to: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  text: string;
  rows: string[];
}

function rowStarts(text: string, rows: readonly string[]): number[] {
  let after = 0;
  return rows.map(row => {
    const start = text.indexOf(row, after);
    if (start < 0) throw new Error("wrapped row not present in log record");
    after = start + row.length;
    return start;
  });
}

export class LogSnapshot {
  private from = 0;
  private bytes: Uint8Array = new Uint8Array();
  private breaks: number[] = [];
  private firstTerminator = -1;
  private records: RecordView[] = [];
  private top = 0;
  private stride = 0;
  private width = 0;
  private height = 0;

  readonly eof: number;
  readonly final: boolean;
  private readonly read: ReadRange;

  constructor(eof: number, final: boolean, read: ReadRange) {
    this.eof = eof;
    this.final = final;
    this.read = read;
  }

  get loadedBytes(): number { return this.bytes.length; }

  fits(width: number, height: number): boolean { return this.width === width && this.height === height; }

  get visible(): string[] { return this.records.flatMap(r => r.rows).slice(this.top, this.top + this.height); }

  measure(width: number, maximum: number): number {
    if (!this.records.length) return 0;
    if (this.records[0]!.from > 0 || this.records.at(-1)!.to < this.eof) return maximum;
    return Math.min(maximum, this.records.reduce((n, r) => n + (width === this.width || !r.rows.length ? r.rows.length : wrapTextWithAnsi(r.text, width).length), 0));
  }

  private async load(from: number, to: number): Promise<void> {
    this.bytes = await this.read(from, to);
    this.from = from;
    const { ends, firstTerminator } = recordBreaks(this.bytes);
    this.breaks = ends.map(i => i + from);
    this.firstTerminator = firstTerminator < 0 ? -1 : from + firstTerminator;
  }

  private boundary(offset: number, forward: boolean): number | undefined {
    let lo = 0, hi = this.breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.breaks[mid]! < offset || (forward && this.breaks[mid] === offset)) lo = mid + 1;
      else hi = mid;
    }
    return this.breaks[forward ? lo : lo - 1];
  }

  private async fragmentCut(offset: number, end: number): Promise<number> {
    const forward = offset < end;
    const first = Math.floor(offset / this.stride);
    for (let i = first + 1; i > 0; i += forward ? 1 : -1) {
      const grid = i * this.stride;
      if (forward ? grid >= end + DISPLAY_BOUNDARY_CONTEXT : grid <= end) break;
      if (grid >= this.eof || grid - DISPLAY_BOUNDARY_CONTEXT >= Math.max(end, offset)) continue;
      const from = Math.max(0, grid - DISPLAY_BOUNDARY_CONTEXT);
      const context = from >= this.from && grid <= this.from + this.bytes.length
        ? this.bytes.subarray(from - this.from, grid - this.from) : await this.read(from, grid);
      const cut = from + consumableLength(context, false);
      if (cut > Math.min(end, offset) && cut < Math.max(end, offset)) return cut;
    }
    return end;
  }

  private async adjacent(offset: number, forward: boolean, continuation: boolean, width: number): Promise<RecordView> {
    const edge = forward ? this.eof : 0;
    const limit = forward ? Math.min(edge, offset + VIEW_WINDOW_BYTES) : Math.max(edge, offset - VIEW_WINDOW_BYTES);
    const cachedEnd = this.from + this.bytes.length;
    let delimiter = offset >= this.from && offset <= cachedEnd ? this.boundary(offset, forward) : undefined;
    const uncertain = !forward && this.from > limit && delimiter !== undefined && delimiter <= this.firstTerminator && this.firstTerminator < offset;
    const cachedToEdge = forward ? cachedEnd === edge && offset >= this.from : this.from === edge && offset <= cachedEnd;
    if (uncertain || (delimiter === undefined && !cachedToEdge)) {
      await this.load(Math.min(offset, limit), Math.max(offset, limit));
      delimiter = this.boundary(offset, forward);
    }
    const end = delimiter ?? limit;
    const bound = continuation || Math.abs(end - offset) === VIEW_WINDOW_BYTES ? await this.fragmentCut(offset, end) : end;
    const from = Math.min(offset, bound), to = Math.max(offset, bound);
    if (from === to) throw new Error("log record did not advance");
    const bytes = this.bytes.subarray(from - this.from, to - this.from);
    const n = consumableLength(bytes, this.final && to === this.eof);
    const decoded = decodeAndSanitize(bytes.subarray(0, n));
    const text = decoded.replace(/\n$/, "");
    const rows = to === this.eof && !decoded ? [] : wrapTextWithAnsi(text, width);
    return { from, to, text, rows, continuesBefore: forward ? continuation : bound !== end, continuesAfter: forward ? bound !== end : continuation };
  }

  async move(width: number, height: number, delta: number): Promise<void> {
    if (!this.stride) this.stride = Math.max(width, Math.floor(VIEW_WINDOW_BYTES / 2 / width) * width);
    const records = this.records.slice();
    let top = this.top;
    if (width !== this.width) {
      for (const [i, r] of records.entries()) {
        if (!r.rows.length) continue;
        const rows = wrapTextWithAnsi(r.text, width);
        if (i === 0 && top > 0) {
          const anchor = rowStarts(r.text, r.rows)[top]!;
          top = Math.max(0, rowStarts(r.text, rows).findLastIndex(start => start <= anchor));
        }
        records[i] = { ...r, rows };
      }
    }
    let count = records.reduce((n, r) => n + r.rows.length, 0);
    const prepend = async () => {
      const r = await this.adjacent(records[0]?.from ?? this.eof, false, records[0]?.continuesBefore ?? false, width);
      records.unshift(r);
      count += r.rows.length;
      top += r.rows.length;
    };
    if (records.length === 0) {
      while (count < height && (records[0]?.from ?? this.eof) > 0) await prepend();
      top = Math.max(0, count - height);
    }
    top += delta;
    while (top < 0 && records[0] && records[0].from > 0) await prepend();
    top = Math.max(0, top);
    while (top + height > count && records.length && records.at(-1)!.to < this.eof) {
      const r = await this.adjacent(records.at(-1)!.to, true, records.at(-1)!.continuesAfter, width);
      records.push(r);
      count += r.rows.length;
    }
    top = Math.min(top, Math.max(0, count - height));
    while (count < height && records[0] && records[0].from > 0) await prepend();
    top = Math.min(top, Math.max(0, count - height));
    while (records[0] && top >= records[0].rows.length) top -= records.shift()!.rows.length;
    let kept = 0;
    this.records = records.filter(r => { const keep = kept < top + height; kept += r.rows.length; return keep; });
    this.top = top;
    this.width = width;
    this.height = height;
  }
}
