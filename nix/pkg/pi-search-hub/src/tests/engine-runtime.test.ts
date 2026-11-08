import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedOperation, SharedRuntime, TimeoutError } from '../extensions/engine/runtime.js';
import type { EngineSearchRequest, EngineSource } from '../extensions/engine/types.js';
function deferred<T>() { let resolve!: (x: T) => void, reject!: (x: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const req = (extra: Partial<EngineSearchRequest> = {}): EngineSearchRequest => ({ query: 'q', numResults: 10, mode: 'targeted', targetUsableSources: 3, overallTimeoutMs: 1000, signal: undefined, ...extra });
function source(id: string, run: EngineSource<string>['run'], extra: Partial<EngineSource<string>> = {}): EngineSource<string> { return { id, provider: id, tier: 'main', timeoutMs: 100, maxResults: 10, weight: 1, redundantWith: [], settlementGraceMs: 0, run, ...extra }; }
// Specified BA: controllable promises stand in for adapters; no network or internal state assertions.
describe('session scheduler', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); vi.setSystemTime(0); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  // Regression: candidate request budgets must not collapse to the final presentation limit.
  it('requests the resolved candidate budget rather than the final result count', async () => {
    let count = 0;
    const result = await new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }).search([
      source('candidates', async (_query, requested) => { count = requested; return Array.from({ length: requested }, (_, i) => String(i)); }, { maxResults: 20 }),
    ], req({ numResults: 2 }));
    expect(count).toBe(20); expect(result.lists[0].results).toHaveLength(20);
  });
  // Regression: a wall-clock correction is not elapsed monotonic time.
  it('admits completion after a wall-clock jump when no deadline has elapsed', async () => {
    const hold = deferred<string[]>();
    const pending = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }).search([source('clock', () => hold.promise)], req());
    await flush(); vi.setSystemTime(1000000); hold.resolve(['valid']);
    const result = await pending;
    expect(result.timedOut).toBe(false); expect(result.stats[0].status).toBe('success'); expect(result.lists[0].results).toEqual(['valid']);
  });
  it.each([{ query: '' }, { query: '   ' }, { query: 'x'.repeat(2001) }, { query: null }, { numResults: 21 }, { numResults: 0 }])('rejects invalid common query/count boundaries: %j', async invalid => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
    await expect(runtime.search([source('a', async () => [])], req(invalid as Partial<EngineSearchRequest>))).rejects.toThrow();
  });
  it('accepts inclusive common query/count and source candidate boundaries', async () => {
    let count = 0;
    const result = await new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }).search([
      source('max', async (_query, requested) => { count = requested; return ['valid']; }, { maxResults: 50 }),
    ], req({ query: 'x'.repeat(2000), numResults: 20 }));
    expect(count).toBe(50); expect(result.stats[0].status).toBe('success');
  });
  it('does not expire queued work merely because the wall clock jumps', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const hold = deferred<string>();
    const first = runtime.operation('a', 100, undefined, 0, () => hold.promise);
    const queued = runtime.operation('b', 100, undefined, 0, async () => 'queued result');
    await flush(); vi.setSystemTime(1000000); hold.resolve('first result');
    expect(await first).toBe('first result'); expect(await queued).toBe('queued result');
  });
  it('tops up empty/failed slots without waiting for slow peers and never overfills target', async () => {
    const slow = deferred<string[]>(), started: string[] = [];
    const run = (id: string, result: string[]) => async () => { started.push(id); return result; };
    const runtime = new SharedRuntime({ maxConcurrent: 6, perProvider: 2 });
    const result = runtime.search([source('slow', () => slow.promise), source('empty', run('empty', [])), source('bad', async () => { throw new Error('SECRET'); }), source('four', run('four', ['4'])), source('five', run('five', ['5'])), source('six', run('six', ['6']))], req());
    await flush(); expect(started).toEqual(['empty', 'four', 'five']);
    slow.resolve(['1']); const r = await result;
    expect(r.lists.map(x => x.source)).toEqual(['slow', 'four', 'five']);
    expect(r.stats[2].error).toBe('Source failed'); expect(r.stats[5]).toMatchObject({ status: 'not-started', reason: 'target-satisfied' });
  });
  it('first skips empty results but always runs native and alwaysInclude', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 6, perProvider: 2 });
    const r = await runtime.search([source('a', async () => []), source('b', async () => ['b']), source('c', async () => ['c']), source('extra', async () => ['e'], { tier: 'alwaysInclude' }), source('native', async () => ['n'], { tier: 'native' })], req({ mode: 'first' }));
    expect(r.lists.map(x => x.source)).toEqual(['b', 'extra', 'native']); expect(r.stats[2].reason).toBe('target-satisfied');
  });
  it('all runs every source, including after errors', async () => {
    const r = await new SharedRuntime({ maxConcurrent: 2, perProvider: 1 }).search([source('a', async () => ['a']), source('b', async () => { throw new Error('private'); }), source('c', async () => ['c'])], req({ mode: 'all' }));
    expect(r.stats.map(x => x.status)).toEqual(['success', 'failed', 'success']);
  });
  it('shares physical and provider caps across searches and operations', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 2, perProvider: 1 });
    const a = deferred<string[]>(), b = deferred<string[]>(), c = deferred<string[]>(); const starts: string[] = [];
    const one = runtime.search([source('web', () => { starts.push('web'); return a.promise; }, { provider: 'shared' })], req());
    const two = runtime.search([source('paper', () => { starts.push('paper'); return b.promise; }, { provider: 'shared' })], req());
    const three = runtime.operation('other', 100, undefined, 0, () => { starts.push('reader'); return c.promise; });
    await flush(); expect(starts).toEqual(['web', 'reader']);
    a.resolve(['a']); await flush(); expect(starts).toEqual(['web', 'reader', 'paper']); b.resolve(['b']); c.resolve([]); await Promise.all([one, two, three]);
  });
  it('retains physical slots after timeout and expires queued tasks without dispatch', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const hold = deferred<string[]>(); let starts = 0;
    const r = runtime.search([source('hold', () => hold.promise, { timeoutMs: 10 }), source('queued', async () => { starts++; return ['late']; }, { timeoutMs: 20 })], req({ mode: 'all' }));
    await vi.advanceTimersByTimeAsync(20); expect((await r).stats).toMatchObject([{ status: 'timeout', reason: 'source-deadline' }, { status: 'not-started', reason: 'source-deadline' }]); expect(starts).toBe(0);
    const later = runtime.operation('different', 50, undefined, 0, async () => { starts++; return 'ok'; }); await flush(); expect(starts).toBe(0);
    hold.resolve(['ignored']); await flush(); expect(await later).toBe('ok'); expect(starts).toBe(1);
  });
  it('returns partial results on overall deadline and cancels only in-flight/queued work', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 2, perProvider: 1 });
    const hold = deferred<string[]>();
    const pending = runtime.search([source('fast', async () => ['ok']), source('slow', () => hold.promise), source('queued', () => hold.promise, { provider: 'slow' })], req({ mode: 'all', overallTimeoutMs: 20 }));
    await vi.advanceTimersByTimeAsync(20); const r = await pending;
    expect(r.timedOut).toBe(true); expect(r.cancelled).toBe(false); expect(r.lists.map(x => x.source)).toEqual(['fast']); expect(r.stats.map(x => x.status)).toEqual(['success', 'timeout', 'not-started']);
    hold.reject(new Error('late rejection consumed')); await flush();
  });
  it('caller cancellation is distinct from deadlines, including pre-abort', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const caller = new AbortController(); const hold = deferred<string[]>();
    const pending = runtime.search([source('a', () => hold.promise), source('b', () => hold.promise)], req({ mode: 'all', signal: caller.signal }));
    await flush(); caller.abort(); const r = await pending;
    expect(r.cancelled).toBe(true); expect(r.stats.map(x => x.status)).toEqual(['cancelled', 'not-started']); expect(r.stats.every(x => x.reason === 'caller-cancelled')).toBe(true);
    const pre = await runtime.search([source('pre', async () => ['no'])], req({ signal: caller.signal })); expect(pre.stats[0].status).toBe('not-started'); hold.resolve([]);
  });
  it('native grace allows usage accounting to settle but never admits aborted results', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); let usage = 0, aborted = false;
    const r = runtime.search([source('native', (_q, _n, signal) => new Promise(resolve => { signal.addEventListener('abort', () => { aborted = true; setTimeout(() => { usage++; resolve(['late']); }, 5); }); }), { tier: 'native', timeoutMs: 10, settlementGraceMs: 10 })], req());
    await vi.advanceTimersByTimeAsync(10); expect(aborted).toBe(true); expect(usage).toBe(0);
    await vi.advanceTimersByTimeAsync(5); expect(usage).toBe(1); expect((await r).lists).toEqual([]); expect((await r).stats[0].status).toBe('timeout');
  });
  it.each(['caller', 'overall'] as const)('preserves native usage during %s cancellation grace', async kind => {
    const caller = new AbortController(); let usage = 0;
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
    const pending = runtime.search([source('native', (_q, _n, signal) => new Promise(resolve => {
      signal.addEventListener('abort', () => { setTimeout(() => { usage++; resolve(['not admitted']); }, 4); });
    }), { tier: 'native', timeoutMs: 100, settlementGraceMs: 8 })], req({ overallTimeoutMs: 20, signal: caller.signal }));
    await flush();
    if (kind === 'caller') caller.abort(); else await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(4);
    const r = await pending; expect(usage).toBe(1); expect(r.lists).toEqual([]);
    expect(r.stats[0]).toMatchObject({ status: kind === 'caller' ? 'cancelled' : 'timeout', reason: kind === 'caller' ? 'caller-cancelled' : 'overall-deadline' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('enforces the global cap across independent providers and searches', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 2, perProvider: 2 });
    const gates = [deferred<string[]>(), deferred<string[]>(), deferred<string[]>()]; let active = 0, peak = 0;
    const requests = gates.map((gate, i) => runtime.search([source(String(i), async () => {
      active++; peak = Math.max(peak, active); try { return await gate.promise; } finally { active--; }
    })], req()));
    await flush(); expect(active).toBe(2); gates[0].resolve(['0']); await flush(); expect(active).toBe(2);
    gates[1].resolve(['1']); gates[2].resolve(['2']); await Promise.all(requests); expect(peak).toBe(2); expect(active).toBe(0);
  });
  it('accepts source deadlines longer than sixty seconds without an outer cap', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const hold = deferred<string[]>();
    const pending = runtime.search([source('long', () => hold.promise, { timeoutMs: 90000 })], req({ overallTimeoutMs: 120000 }));
    await vi.advanceTimersByTimeAsync(80000); hold.resolve(['late but valid']); expect((await pending).stats[0].status).toBe('success');
  });
  it('bounds uncooperative native grace and preserves physical ownership', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const hold = deferred<string[]>();
    const r = runtime.search([source('native', () => hold.promise, { tier: 'native', timeoutMs: 10, settlementGraceMs: 5 })], req());
    await vi.advanceTimersByTimeAsync(15); expect((await r).stats[0].status).toBe('timeout'); hold.resolve([]); await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reconfiguration drains safely without interrupting existing requests', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const hold = deferred<string>(); let started = false;
    const a = runtime.operation('p', 100, undefined, 0, () => hold.promise);
    const b = runtime.operation('p', 100, undefined, 0, async () => { started = true; return 'b'; }); await flush(); expect(started).toBe(false);
    runtime.configure({ maxConcurrent: 2, perProvider: 2 }); await flush(); expect(started).toBe(true); expect(await b).toBe('b'); runtime.configure({ maxConcurrent: 1, perProvider: 1 }); hold.resolve('a'); expect(await a).toBe('a');
  });
  it('treats an exact deadline settlement as timeout', async () => {
    const hold = deferred<string>(); const r = boundedOperation(() => hold.promise, 10, undefined, 0); const assertion = expect(r).rejects.toBeInstanceOf(TimeoutError);
    await flush(); vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10); hold.resolve('late'); await assertion; expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects duplicate ids, tiers and invalid timers before dispatch', async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 }); const s = source('a', async () => []);
    await expect(runtime.search([s, s], req())).rejects.toThrow(); await expect(runtime.search([{ ...s, tier: 'invalid' } as never], req())).rejects.toThrow(); await expect(runtime.search([{ ...s, timeoutMs: 2147483648 }], req())).rejects.toThrow();
  });
});
