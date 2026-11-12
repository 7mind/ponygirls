import { WorkerFailure } from './http.js';

export const MAX_EXPOSURE_RECEIPTS = 64;
export class ExposureLedger {
  private readonly entries = new Map<string, readonly string[]>();
  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new WorkerFailure('exposure-capacity', 'not-sent');
  }
  get size(): number { return this.entries.size; }
  get(entryId: string): readonly string[] { return this.entries.get(entryId) ?? []; }
  record(entryIds: readonly string[], receipts: readonly string[]): void {
    if (receipts.length === 0) return;
    if (entryIds.length > this.maxEntries || receipts.length > MAX_EXPOSURE_RECEIPTS) throw new WorkerFailure('exposure-capacity', 'not-sent');
    if (new Set(entryIds).size !== entryIds.length || new Set(receipts).size !== receipts.length ||
        entryIds.some(id => id.length === 0 || id.length > 1024)) throw new WorkerFailure('exposure-identity', 'not-sent');
    const added = entryIds.filter(id => !this.entries.has(id));
    if (this.entries.size + added.length > this.maxEntries) throw new WorkerFailure('exposure-capacity', 'not-sent');
    for (const id of entryIds) {
      const previous = this.entries.get(id);
      if (previous !== undefined && (previous.length !== receipts.length || previous.some((value, index) => value !== receipts[index]))) {
        throw new WorkerFailure('exposure-conflict', 'not-sent');
      }
    }
    for (const id of added) this.entries.set(id, [...receipts]);
  }
  clear(): void { this.entries.clear(); }
}
