import type { ReindexStatusResult } from './api.ts';
export const REINDEX_STATUS_POLL_MS = 4_000;
export interface RebuildCohort { requestId: string; targetProfile: string; total: bigint }
export function validateReindexStatus(result: ReindexStatusResult, cohort: RebuildCohort): ReindexStatusResult {
  const counts = [result.total, result.complete, result.superseded, result.failed, result.pending];
  if (result.requestId !== cohort.requestId || result.targetProfile !== cohort.targetProfile || result.total !== cohort.total || counts.some(count => typeof count !== 'bigint' || count < 0n || count > cohort.total) || result.complete + result.superseded + result.failed + result.pending !== result.total) throw new Error('Unverified rebuild status identity, captured total or count partition.');
  return result;
}
export function rebuildConclusion(result: ReindexStatusResult): string {
  if (result.total === 0n) return 'No eligible HEADs were captured.';
  if (result.complete === result.total) return 'All captured HEADs complete.';
  if (result.pending === 0n) return 'Cohort settled with failures or superseded HEADs.';
  return 'Waiting for captured HEAD publications; acceptance is not completion.';
}
// Per-connection physical read ownership survives logical scope/view cleanup.
// No queue, replay or early release: only settlement releases a permit.
export class ReindexStatusReadPermit {
  private busy = false;
  private readonly listeners = new Set<() => void>();
  readonly getSnapshot = () => this.busy;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  acquire(): (() => void) | null {
    if (this.busy) return null;
    this.busy = true; for (const listener of this.listeners) listener();
    let released = false;
    return () => { if (released) return; released = true; this.busy = false; for (const listener of this.listeners) listener(); };
  }
}
