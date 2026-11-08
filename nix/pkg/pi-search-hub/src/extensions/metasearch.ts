import type { SearchResult, SearchResultWithBackend } from "./types.js";
import type { AlwaysIncludeEntry, BackendStats } from "./dispatch.js";
import { SharedRuntime } from "./engine/runtime.js";
import { DEFAULT_CONCURRENCY, resolveProfile, resolveTimeouts } from "./engine/policy.js";
import { candidateCount, sourcePolicy, validateAlwaysInclude } from "./engine/profiles.js";
import { rankDocuments } from "./engine/ranking.js";
import { WEB_DOCUMENT_ADAPTER } from "./engine/documents.js";
import type { EngineSource, ResolvedProfile, SearchMode, SearchTimeouts, SourceStats } from "./engine/types.js";

type SearchRunner = (backend: string, query: string, count: number, signal?: AbortSignal) => Promise<SearchResult[]>;
export interface MetasearchRequest {
  mode: SearchMode;
  orderedBackends: string[];
  fallback: AlwaysIncludeEntry[];
  native: AlwaysIncludeEntry[];
  query: string;
  numResults: number;
  signal?: AbortSignal;
  runBackend: SearchRunner;
  runtime?: SharedRuntime;
  profile?: ResolvedProfile;
  timeouts?: SearchTimeouts;
  overallTimeoutMs?: number;
  onOutcome?: (stats: SourceStats) => void;
}

/** Web adaptation only: scheduling, deadlines and document ranking are shared with papers. */
export async function runMetasearch(request: MetasearchRequest) {
  const timeouts = request.timeouts ?? resolveTimeouts(undefined);
  const runtime = request.runtime ?? new SharedRuntime(DEFAULT_CONCURRENCY);
  const profile = request.profile ?? resolveProfile({ mode: request.mode,
    alwaysInclude: Object.fromEntries(request.fallback.map(entry => [entry.backend, { timeoutMs: entry.timeoutMs, maxResults: entry.maxResults }])) }, undefined);
  const native = new Map(request.native.map(entry => [entry.backend, entry]));
  const names = [...new Set([...request.orderedBackends, ...request.fallback.map(entry => entry.backend), ...native.keys()])];
  validateAlwaysInclude(profile, names);
  const sources: EngineSource<SearchResult>[] = names.filter(name => sourcePolicy(profile, name).enabled !== false).map(name => {
    const policy = sourcePolicy(profile, name);
    const nativeEntry = native.get(name);
    const tier = nativeEntry !== undefined ? "native" : name in profile.alwaysInclude ? "alwaysInclude" : "main";
    return { id: name, provider: name.replace(/^native:/, ""), tier,
      timeoutMs: policy.timeoutMs ?? nativeEntry?.timeoutMs ?? (tier === "alwaysInclude" ? timeouts.alwaysIncludeMs : timeouts.sourceMs),
      settlementGraceMs: tier === "native" ? timeouts.nativeGraceMs : 0,
      maxResults: policy.maxResults ?? nativeEntry?.maxResults ?? candidateCount(profile, request.numResults), weight: policy.boost ?? 1,
      redundantWith: policy.redundantWith ?? [], onOutcome: request.onOutcome,
      run: (query, count, signal) => request.runBackend(name, query, count, signal) };
  });
  const response = await runtime.search(sources, { query: request.query, numResults: request.numResults, mode: request.mode,
    targetUsableSources: profile.targetUsableSources, overallTimeoutMs: request.overallTimeoutMs ?? timeouts.overallMs, signal: request.signal });
  const results: SearchResultWithBackend[] = rankDocuments(response.lists, request.query, request.numResults, profile.ranking, WEB_DOCUMENT_ADAPTER).map(({ document, ranking }) => ({ ...document,
    backend: ranking.sources[0], sources: ranking.sources, ranking }));
  const backendStats = new Map<string, BackendStats>(response.stats.map(stat => [stat.source, {
    success: stat.status === "success" || stat.status === "empty", count: stat.count, status: stat.status, reason: stat.reason, tier: stat.tier,
    ...(stat.error === undefined ? {} : { error: stat.error }) }]));
  return { results, backendStats, usableBackendCount: response.lists.filter(list => list.results.length > 0).length,
    cancelled: response.cancelled, timedOut: response.timedOut };
}
