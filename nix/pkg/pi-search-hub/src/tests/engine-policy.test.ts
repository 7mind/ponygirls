import { describe, expect, it } from 'vitest';
import { DEFAULT_CANDIDATES, DEFAULT_CONCURRENCY, DEFAULT_RANKING, DEFAULT_TIMEOUTS, resolveConcurrency, resolveProfile, resolveTimeouts } from '../extensions/engine/policy.js';
// Specified BA: validation and profile resolution through their public interface.
describe('engine policy', () => {
  it('centralizes defaults and returns independent resolved values', () => {
    expect(resolveTimeouts()).toEqual(DEFAULT_TIMEOUTS);
    expect(resolveConcurrency()).toEqual(DEFAULT_CONCURRENCY);
    expect(resolveProfile()).toEqual({ mode: 'targeted', targetUsableSources: 3, candidates: DEFAULT_CANDIDATES, ranking: DEFAULT_RANKING, sources: {}, alwaysInclude: {} });
    const p = resolveProfile(); p.candidates.minimum = 1; expect(resolveProfile().candidates.minimum).toBe(10);
  });
  it('merges nested source fields and allows long platform-safe deadlines', () => {
    const base = { sources: { a: { boost: 2, timeoutMs: 90000, redundantWith: ['b'] } }, alwaysInclude: { x: { enabled: true, maxResults: 3 } } };
    const p = resolveProfile(base, { sources: { a: { maxResults: 4 } }, alwaysInclude: { x: { enabled: false } } });
    expect(p.sources.a).toEqual({ boost: 2, timeoutMs: 90000, redundantWith: ['b'], maxResults: 4 });
    expect(p.alwaysInclude.x).toEqual({ enabled: false, maxResults: 3 });
    expect(resolveTimeouts({ sourceMs: 2147483647, nativeGraceMs: 0 }).sourceMs).toBe(2147483647);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])('rejects invalid deadlines %s', sourceMs => expect(() => resolveTimeouts({ sourceMs })).toThrow());
  it('rejects unknown keys, modes, caps, weights, lists and invalid policies', () => {
    for (const bad of [{ typo: 1 }, { mode: 'fast' }, { sources: { a: { boost: 0 } } }, { sources: { a: { maxResults: 51 } } }, { sources: { a: { redundantWith: [2] } } }, { ranking: { titleWeight: NaN } }, { candidates: { minimum: 12, maximum: 2 } }, { alwaysInclude: { a: { typo: true } } }]) expect(() => resolveProfile(bad as never)).toThrow();
    expect(() => resolveConcurrency({ perProvider: 0 })).toThrow();
    expect(() => resolveTimeouts({ typo: 1 } as never)).toThrow();
  });
});
