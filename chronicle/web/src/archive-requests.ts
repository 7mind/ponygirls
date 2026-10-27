import type { ArchiveResult } from './api.ts';

export class SupersededArchiveRead extends Error {
  constructor() { super('Archive request superseded.'); }
}
interface PendingArchiveRead {
  scope: symbol; epoch: number; current(): boolean; start(): Promise<ArchiveResult>;
  resolve(value: ArchiveResult): void; reject(cause: unknown): void;
}
export class ArchiveReadLane {
  private busy = false;
  private epoch = 0;
  private pending: PendingArchiveRead | null = null;

  request(scope: symbol, current: () => boolean, start: () => Promise<ArchiveResult>): Promise<ArchiveResult> {
    return new Promise((resolve, reject) => {
      if (this.pending !== null) this.pending.reject(new SupersededArchiveRead());
      this.pending = { scope, epoch: this.epoch, current, start, resolve, reject };
      this.pump();
    });
  }
  queued(scope: symbol): boolean {
    return this.pending !== null && this.pending.scope === scope && this.pending.epoch === this.epoch && this.pending.current();
  }
  cancel(scope: symbol): void {
    if (this.pending !== null && this.pending.scope === scope) {
      this.pending.reject(new SupersededArchiveRead()); this.pending = null;
    }
  }
  invalidate(): void {
    this.epoch++;
    if (this.pending !== null) { this.pending.reject(new SupersededArchiveRead()); this.pending = null; }
  }
  private pump(): void {
    if (this.busy || this.pending === null) return;
    const request = this.pending; this.pending = null;
    const current = () => request.epoch === this.epoch && request.current();
    if (!current()) { request.reject(new SupersededArchiveRead()); return; }
    this.busy = true;
    void Promise.resolve().then(() => {
      if (!current()) throw new SupersededArchiveRead();
      return request.start();
    }).then(value => { if (current()) request.resolve(value); else request.reject(new SupersededArchiveRead()); }, request.reject)
      .finally(() => { this.busy = false; this.pump(); });
  }
}
