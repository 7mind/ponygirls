import type { ConcurrencyLimits, EngineSearchRequest, EngineSearchResult, EngineSource, RankedList, SourceStats } from './types.js';
import { resolveConcurrency, validateTimeout } from './policy.js';

export class TimeoutError extends Error {
  constructor() { super('Operation deadline exceeded'); this.name = 'TimeoutError'; }
}
class CancelledError extends Error {
  constructor() { super('Operation cancelled'); this.name = 'AbortError'; }
}
/** Bounds logical waiting, not the lifetime of an uncooperative underlying operation. */
export function boundedOperation<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, settlementGraceMs: number): Promise<T> {
  validateTimeout(timeoutMs); validateTimeout(settlementGraceMs, true);
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new CancelledError());
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let done = false;
    let failure: Error | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); if (grace !== undefined) clearTimeout(grace); signal?.removeEventListener('abort', onAbort); };
    const finish = (value: T | undefined, error?: unknown) => {
      if (done) return;
      done = true; cleanup();
      if (failure) reject(failure); else if (error !== undefined) reject(error); else resolve(value as T);
    };
    const stop = (error: Error) => {
      if (done || failure) return;
      failure = error;
      // Install the bound before notifying adapters; abort handlers may settle synchronously.
      if (settlementGraceMs > 0) grace = setTimeout(() => finish(undefined), settlementGraceMs);
      controller.abort(error);
      if (settlementGraceMs === 0) finish(undefined);
    };
    const onAbort = () => stop(signal?.reason instanceof Error ? signal.reason : new CancelledError());
    const timer = setTimeout(() => stop(new TimeoutError()), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    // Always observe both settlements, including after the logical deadline.
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return run(controller.signal);
    }).then(value => {
      if (!failure && performance.now() >= deadline) stop(new TimeoutError());
      finish(value);
    }, error => {
      if (!failure && performance.now() >= deadline) stop(new TimeoutError());
      // A promise can reject with undefined: preserve rejection rather than resolve it.
      finish(undefined, error ?? new Error('Operation failed'));
    });
  });
}
interface QueueEntry {
  provider: string;
  signal: AbortSignal;
  start(): void;
  cancel(): void;
}
/** A session-owned pool shared by web, papers, readers and credential operations. */
export class SharedRuntime {
  private limits: ConcurrencyLimits;
  private active = 0;
  private providers = new Map<string, number>();
  private queue: QueueEntry[] = [];
  constructor(limits: ConcurrencyLimits) { this.limits = resolveConcurrency(limits); }
  configure(limits: ConcurrencyLimits): void { this.limits = resolveConcurrency(limits); this.drain(); }
  private drain(): void {
    for (let i = 0; i < this.queue.length && this.active < this.limits.maxConcurrent;) {
      const entry = this.queue[i];
      if ((this.providers.get(entry.provider) ?? 0) >= this.limits.perProvider) { i++; continue; }
      this.queue.splice(i, 1); entry.start();
    }
  }
  private pooled<T>(provider: string, signal: AbortSignal, deadline: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const entry: QueueEntry = {
        provider, signal,
        cancel: () => { const index = this.queue.indexOf(entry); if (index >= 0) this.queue.splice(index, 1); signal.removeEventListener('abort', entry.cancel); reject(signal.reason ?? new CancelledError()); },
        start: () => {
          signal.removeEventListener('abort', entry.cancel);
          if (signal.aborted) { reject(signal.reason ?? new CancelledError()); return; }
          if (performance.now() >= deadline) { reject(new TimeoutError()); return; }
          this.active++; this.providers.set(provider, (this.providers.get(provider) ?? 0) + 1);
          let physical: Promise<T>;
          try { physical = Promise.resolve(run(signal)); } catch (error) { physical = Promise.reject(error); }
          const release = () => { this.active--; const remaining = (this.providers.get(provider) ?? 1) - 1; if (remaining) this.providers.set(provider, remaining); else this.providers.delete(provider); this.drain(); };
          physical.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
        },
      };
      if (signal.aborted) { reject(signal.reason ?? new CancelledError()); return; }
      signal.addEventListener('abort', entry.cancel, { once: true });
      this.queue.push(entry); this.drain();
    });
  }
  operation<T>(provider: string, timeoutMs: number, signal: AbortSignal | undefined, settlementGraceMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (typeof provider !== 'string' || !provider.trim()) throw new Error('Invalid provider');
    const deadline = performance.now() + timeoutMs;
    return boundedOperation(inner => this.pooled(provider, inner, deadline, run), timeoutMs, signal, settlementGraceMs);
  }
  async search<T>(sources: EngineSource<T>[], request: EngineSearchRequest): Promise<EngineSearchResult<T>> {
    validateTimeout(request.overallTimeoutMs);
    if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 2000 || !['first', 'targeted', 'all'].includes(request.mode) || !Number.isInteger(request.numResults) || request.numResults < 1 || request.numResults > 20 || !Number.isInteger(request.targetUsableSources) || request.targetUsableSources < 1) throw new Error('Invalid search request');
    const ids = new Set<string>();
    for (const source of sources) {
      if (typeof source.id !== 'string' || !source.id.trim() || ids.has(source.id)) throw new Error('Invalid or duplicate source id');
      ids.add(source.id);
      if (typeof source.provider !== 'string' || !source.provider.trim() || !['main', 'alwaysInclude', 'native'].includes(source.tier) || !Number.isFinite(source.weight) || source.weight <= 0 || !Number.isInteger(source.maxResults) || source.maxResults < 1 || source.maxResults > 50 || !Array.isArray(source.redundantWith) || source.redundantWith.some(x => typeof x !== 'string') || typeof source.run !== 'function') throw new Error('Invalid source');
      validateTimeout(source.timeoutMs); validateTimeout(source.settlementGraceMs, true);
    }
    const controller = new AbortController();
    const deadline = performance.now() + request.overallTimeoutMs;
    let timedOut = false, cancelled = false;
    class OverallDeadline extends Error {}
    class CallerCancelled extends Error {}
    const overall = () => { if (!controller.signal.aborted) { timedOut = true; controller.abort(new OverallDeadline()); } };
    const onAbort = () => { if (!controller.signal.aborted) { cancelled = true; controller.abort(new CallerCancelled()); } };
    const timer = setTimeout(overall, request.overallTimeoutMs);
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    const stats: (SourceStats | undefined)[] = sources.map(() => undefined);
    const lists: (RankedList<T> | undefined)[] = sources.map(() => undefined);
    let activeMain = 0, usable = 0, pending = 0, settled = false;
    const main = sources.map((s, i) => s.tier === 'main' ? i : -1).filter(i => i >= 0);
    let next = 0;
    const target = request.mode === 'first' ? 1 : request.mode === 'all' ? main.length : request.targetUsableSources;
    return await new Promise<EngineSearchResult<T>>(resolve => {
      const finish = () => {
        if (settled || pending !== 0) return;
        settled = true; clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort);
        for (let i = 0; i < sources.length; i++) stats[i] ??= { source: sources[i].id, tier: sources[i].tier, status: 'not-started', count: 0, reason: cancelled ? 'caller-cancelled' : timedOut ? 'overall-deadline' : 'target-satisfied' };
        resolve({ lists: lists.filter((x): x is RankedList<T> => x !== undefined), stats: stats as SourceStats[], cancelled, timedOut });
      };
      const topUp = () => {
        if (performance.now() >= deadline) overall();
        while (!controller.signal.aborted && next < main.length && usable + activeMain < target) launch(main[next++]);
        finish();
      };
      const launch = (index: number) => {
        const source = sources[index];
        pending++; if (source.tier === 'main') activeMain++;
        let dispatched = false;
        this.operation(source.provider, source.timeoutMs, controller.signal, source.settlementGraceMs, signal => {
          dispatched = true; return source.run(request.query, source.maxResults, signal);
        }).then(results => {
          if (performance.now() >= deadline) overall();
          if (controller.signal.aborted) {
            stats[index] = { source: source.id, tier: source.tier, status: dispatched ? (cancelled ? 'cancelled' : 'timeout') : 'not-started', count: 0, reason: cancelled ? 'caller-cancelled' : 'overall-deadline' }; return;
          }
          if (!Array.isArray(results)) throw new Error('Invalid source results');
          const admitted = results.slice(0, source.maxResults);
          stats[index] = { source: source.id, tier: source.tier, status: admitted.length ? 'success' : 'empty', count: admitted.length };
          if (admitted.length) { lists[index] = { source: source.id, weight: source.weight, redundantWith: source.redundantWith, results: admitted }; if (source.tier === 'main') usable++; }
        }).catch(error => {
          const reason = error instanceof OverallDeadline ? 'overall-deadline' : error instanceof CallerCancelled ? 'caller-cancelled' : error instanceof TimeoutError ? 'source-deadline' : undefined;
          stats[index] = { source: source.id, tier: source.tier, status: !dispatched ? 'not-started' : reason === 'caller-cancelled' ? 'cancelled' : reason ? 'timeout' : 'failed', count: 0, ...(reason ? { reason } : { error: 'Source failed' }) };
        }).finally(() => { pending--; if (source.tier === 'main') activeMain--; topUp(); });
      };
      // Auxiliary sources compete fairly with the initial main wave and are never gated by its target.
      for (let i = 0; i < sources.length; i++) if (sources[i].tier !== 'main' && !controller.signal.aborted) launch(i);
      topUp();
    });
  }
}
