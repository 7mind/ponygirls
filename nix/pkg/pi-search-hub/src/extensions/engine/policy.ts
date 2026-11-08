import type { CandidatePolicy, ConcurrencyLimits, RankingPolicy, ResolvedProfile, SearchProfileConfig, SearchTimeouts, SourcePolicy } from './types.js';

export const DEFAULT_TIMEOUTS: Readonly<SearchTimeouts> = Object.freeze({ overallMs: 60000, sourceMs: 30000, alwaysIncludeMs: 8000, nativeMs: 45000, nativeGraceMs: 1000, discoveryMs: 10000, readerMs: 30000, credentialMs: 5000 });
export const DEFAULT_CONCURRENCY: Readonly<ConcurrencyLimits> = Object.freeze({ maxConcurrent: 6, perProvider: 2 });
export const DEFAULT_RANKING: Readonly<RankingPolicy> = Object.freeze({ rankConstant: 60, rerank: 'rrf', titleWeight: .2, bodyWeight: .1, exactTitle: true });
export const DEFAULT_CANDIDATES: Readonly<CandidatePolicy> = Object.freeze({ multiplier: 2, minimum: 10, maximum: 40 });
const MAX_TIMER = 2147483647;
function object(value: unknown, label: string): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`); }
function keys(value: object, allowed: string[], label: string) { object(value, label); for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} key: ${key}`); }
function integer(value: number, label: string, min = 1, max = MAX_TIMER) { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`); }
function positive(value: number, label: string, zero = false) { if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new Error(`Invalid ${label}`); }
export function validateTimeout(value: number, grace = false): void { integer(value, 'timeout', grace ? 0 : 1); }
export function resolveTimeouts(config?: Partial<SearchTimeouts>): SearchTimeouts {
  if (config !== undefined) keys(config, Object.keys(DEFAULT_TIMEOUTS), 'timeouts');
  const result = { ...DEFAULT_TIMEOUTS, ...config };
  for (const [key, value] of Object.entries(result)) validateTimeout(value, key === 'nativeGraceMs');
  return result;
}
export function resolveConcurrency(config?: Partial<ConcurrencyLimits>): ConcurrencyLimits {
  if (config !== undefined) keys(config, Object.keys(DEFAULT_CONCURRENCY), 'concurrency');
  const result = { ...DEFAULT_CONCURRENCY, ...config };
  integer(result.maxConcurrent, 'maxConcurrent'); integer(result.perProvider, 'perProvider'); return result;
}
function policies(base: Record<string, SourcePolicy> = {}, override: Record<string, SourcePolicy> = {}): Record<string, SourcePolicy> {
  object(base, 'sources'); object(override, 'sources');
  const result: Record<string, SourcePolicy> = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(override)])) {
    if (!id.trim()) throw new Error('Invalid source id');
    for (const p of [base[id], override[id]]) if (p !== undefined) keys(p, ['enabled', 'timeoutMs', 'maxResults', 'boost', 'redundantWith'], 'source');
    const p = { ...base[id], ...override[id] };
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw new Error('Invalid enabled');
    if (p.timeoutMs !== undefined) validateTimeout(p.timeoutMs);
    if (p.maxResults !== undefined) integer(p.maxResults, 'maxResults', 1, 50);
    if (p.boost !== undefined) positive(p.boost, 'boost');
    if (p.redundantWith !== undefined && (!Array.isArray(p.redundantWith) || p.redundantWith.some(x => typeof x !== 'string' || !x.trim()))) throw new Error('Invalid redundantWith');
    result[id] = { ...p, ...(p.redundantWith ? { redundantWith: [...p.redundantWith] } : {}) };
  }
  return result;
}
export function resolveProfile(base?: SearchProfileConfig, override?: SearchProfileConfig): ResolvedProfile {
  for (const p of [base, override]) if (p !== undefined) {
    keys(p, ['mode', 'targetUsableSources', 'candidates', 'ranking', 'sources', 'alwaysInclude'], 'profile');
    if (p.mode !== undefined && !['first', 'targeted', 'all'].includes(p.mode)) throw new Error('Invalid mode');
    if (p.targetUsableSources !== undefined) integer(p.targetUsableSources, 'targetUsableSources');
    if (p.candidates !== undefined) keys(p.candidates, Object.keys(DEFAULT_CANDIDATES), 'candidates');
    if (p.ranking !== undefined) keys(p.ranking, Object.keys(DEFAULT_RANKING), 'ranking');
  }
  const candidates = { ...DEFAULT_CANDIDATES, ...base?.candidates, ...override?.candidates };
  positive(candidates.multiplier, 'multiplier'); integer(candidates.minimum, 'minimum'); integer(candidates.maximum, 'maximum');
  if (candidates.minimum > candidates.maximum) throw new Error('Invalid candidate range');
  const ranking = { ...DEFAULT_RANKING, ...base?.ranking, ...override?.ranking };
  positive(ranking.rankConstant, 'rankConstant'); positive(ranking.titleWeight, 'titleWeight', true); positive(ranking.bodyWeight, 'bodyWeight', true);
  if (!['rrf', 'lexical'].includes(ranking.rerank) || typeof ranking.exactTitle !== 'boolean') throw new Error('Invalid ranking');
  return { mode: override?.mode ?? base?.mode ?? 'targeted', targetUsableSources: override?.targetUsableSources ?? base?.targetUsableSources ?? 3, candidates, ranking, sources: policies(base?.sources, override?.sources), alwaysInclude: policies(base?.alwaysInclude, override?.alwaysInclude) };
}
