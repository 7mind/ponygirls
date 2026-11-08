/** Web-facing adapters around the shared scheduler and ranker. */
import type { AlwaysIncludeBackendConfig, SearchResult, SearchResultWithBackend } from "./types.js";
import type { SourceStatus, SourceTier, SourceStats, EngineSource } from "./engine/types.js";
import { config, roundRobinIndex, incrementRoundRobin } from "./config.js";
import { scoreBackends } from "./scoring.js";
import { DEFAULT_CONCURRENCY, DEFAULT_RANKING, resolveProfile, resolveTimeouts } from "./engine/policy.js";
import { SharedRuntime } from "./engine/runtime.js";
import { rankDocuments } from "./engine/ranking.js";
import { WEB_DOCUMENT_ADAPTER } from "./engine/documents.js";
import { candidateCount } from "./engine/profiles.js";

export type BackendStats = { success: boolean; count: number; error?: string; status?: SourceStatus; reason?: SourceStats["reason"]; tier?: SourceTier };
export interface RankedBackendList { backend: string; results: SearchResultWithBackend[] }
export const TARGETED_MAIN_ENGINE_COUNT = resolveProfile(undefined, undefined).targetUsableSources;
export const RRF_K = DEFAULT_RANKING.rankConstant;
export interface AlwaysIncludeEntry { backend: string; timeoutMs: number; maxResults?: number }
type Runner = (backend: string, query: string, numResults: number, signal?: AbortSignal) => Promise<SearchResult[]>;

export function selectBackendsForFallback(strategy: "sequential" | "random" | "round-robin" | "best-latency", activeBackends: string[]): string[] {
  const backends = [...activeBackends];
  switch (strategy) {
    case "random":
      for (let i = backends.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [backends[i], backends[j]] = [backends[j], backends[i]]; }
      return backends;
    case "round-robin": {
      if (!backends.length) return [];
      const index = roundRobinIndex % backends.length; incrementRoundRobin();
      return [backends[index], ...backends.filter((_, i) => i !== index)];
    }
    case "best-latency": return scoreBackends(backends).map(score => score.backend);
    case "sequential": return backends;
    default: throw new Error("Invalid selection strategy");
  }
}
export function resolveAlwaysInclude(alwaysInclude: Record<string, AlwaysIncludeBackendConfig> | undefined, activeBackends: string[]): AlwaysIncludeEntry[] {
  const profile = resolveProfile({ alwaysInclude }, undefined);
  const timeouts = resolveTimeouts(config.timeouts);
  return Object.entries(profile.alwaysInclude).filter(([, policy]) => policy.enabled !== false).map(([backend, policy]) => {
    if (!activeBackends.includes(backend)) throw new Error("alwaysInclude source is not enabled");
    return { backend, timeoutMs: policy.timeoutMs ?? timeouts.alwaysIncludeMs, maxResults: policy.maxResults };
  });
}
export function reciprocalRankFusion(lists: RankedBackendList[], maxResults: number): SearchResultWithBackend[] {
  return rankDocuments(lists.map(list => ({ source: list.backend, weight: 1, redundantWith: [], results: list.results.map(result => ({ ...result, backend: list.backend })) })),
    "", maxResults, { ...DEFAULT_RANKING, exactTitle: false, rerank: "rrf" }, WEB_DOCUMENT_ADAPTER).map(({ document, ranking }) => {
    const richer = document as SearchResultWithBackend;
    const primary = richer.backend ?? ranking.sources[0];
    return { ...richer, backend: primary, sources: [primary, ...ranking.sources.filter(source => source !== primary)] };
  });
}
function backendStats(stats: SourceStats[]): Map<string, BackendStats> {
  return new Map(stats.map(stat => [stat.source, { success: stat.status === "success" || stat.status === "empty", count: stat.count,
    status: stat.status, reason: stat.reason, tier: stat.tier,
    ...(stat.error === undefined ? {} : { error: stat.error }) }]));
}
export async function runTargetedCombine(request: { orderedBackends: string[]; query: string; numResults: number; signal?: AbortSignal; targetUsableBackends?: number; runBackend: Runner }) {
  return runTieredTargetedCombine({ ...request, alwaysInclude: [] });
}
export async function runAlwaysInclude(request: { entries: AlwaysIncludeEntry[]; query: string; numResults: number; signal?: AbortSignal; runBackend: Runner }) {
  const response = await runTieredTargetedCombine({ orderedBackends: [], alwaysInclude: request.entries, query: request.query,
    numResults: request.numResults, signal: request.signal, runBackend: request.runBackend });
  return { lists: response.usableLists, stats: response.backendStats };
}
export async function runTieredTargetedCombine(request: { orderedBackends: string[]; alwaysInclude: AlwaysIncludeEntry[]; query: string; numResults: number; signal?: AbortSignal; targetUsableBackends?: number; runBackend: Runner }) {
  const profile = resolveProfile({ mode: "targeted", targetUsableSources: request.targetUsableBackends ?? TARGETED_MAIN_ENGINE_COUNT }, undefined);
  const timeouts = resolveTimeouts(config.timeouts);
  const extras = new Map(request.alwaysInclude.map(entry => [entry.backend, entry]));
  const names = [...new Set([...request.orderedBackends, ...extras.keys()])];
  const sources: EngineSource<SearchResult>[] = names.map(id => ({ id, provider: id, tier: extras.has(id) ? "alwaysInclude" : "main",
    timeoutMs: extras.get(id)?.timeoutMs ?? timeouts.sourceMs, maxResults: extras.get(id)?.maxResults ?? candidateCount(profile, request.numResults),
    weight: 1, redundantWith: [], settlementGraceMs: 0, run: (query, count, signal) => request.runBackend(id, query, count, signal) }));
  const response = await new SharedRuntime(DEFAULT_CONCURRENCY).search(sources, { query: request.query, numResults: request.numResults,
    mode: "targeted", targetUsableSources: profile.targetUsableSources, overallTimeoutMs: timeouts.overallMs, signal: request.signal });
  if (response.cancelled) throw request.signal?.reason ?? new Error("Search cancelled");
  const usableLists = response.lists.map(list => ({ backend: list.source, results: list.results.map(result => ({ ...result, backend: list.source })) }));
  const qualityUsableCount = usableLists.filter(list => !extras.has(list.backend)).length;
  return { results: reciprocalRankFusion(usableLists, request.numResults), backendStats: backendStats(response.stats), usableBackendCount: usableLists.length,
    qualityUsableCount, freeUsableCount: usableLists.length - qualityUsableCount, usableLists };
}
