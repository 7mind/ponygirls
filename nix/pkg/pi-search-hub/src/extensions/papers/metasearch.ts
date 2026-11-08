import { SharedRuntime, boundedOperation, TimeoutError } from "../engine/runtime.js";
import { DEFAULT_CONCURRENCY, resolveProfile, resolveTimeouts } from "../engine/policy.js";
import { candidateCount, sourcePolicy, validateAlwaysInclude } from "../engine/profiles.js";
import type { EngineSource, ResolvedProfile, SearchTimeouts } from "../engine/types.js";
import { rankPapers } from "./ranking.js";
import { PAPER_PROVIDERS, type PaperConfig, type PaperProvider, type PaperProviderName, type PaperRecord, type PaperSearchRequest, type PaperSearchResult } from "./types.js";

export { TimeoutError as PaperTimeoutError };
export function boundedPaperOperation<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal: AbortSignal | undefined): Promise<T> {
  return boundedOperation(run, timeoutMs, signal, 0);
}
export function validatePaperConfig(settings: PaperConfig): void {
  const resolved = resolveProfile(undefined, settings);
  for (const name of [...Object.keys(resolved.sources), ...Object.keys(resolved.alwaysInclude)]) {
    if (!PAPER_PROVIDERS.includes(name as PaperProviderName)) throw new Error("Unknown paper source policy");
  }
}

/** Paper adaptation only; execution and ranking mechanics live in the shared engine. */
export async function runPaperMetasearch(providers: PaperProvider[], settings: PaperConfig, request: PaperSearchRequest,
  signal: AbortSignal | undefined, shared?: SharedRuntime, budgets?: SearchTimeouts, resolved?: ResolvedProfile): Promise<PaperSearchResult> {
  validatePaperConfig(settings);
  const timeouts = budgets ?? resolveTimeouts(undefined);
  const runtime = shared ?? new SharedRuntime(DEFAULT_CONCURRENCY);
  const profile = resolved ?? resolveProfile({ sources: { searxng: { redundantWith: ["*"] } },
    alwaysInclude: settings.alwaysInclude === undefined ? Object.fromEntries(providers.filter(provider => provider.name === "searxng" || provider.name === "arxiv").map(provider => [provider.name, {}])) : {} }, settings);
  validateAlwaysInclude(profile, providers.map(provider => provider.name));
  const sources: EngineSource<PaperRecord>[] = providers.filter(provider => sourcePolicy(profile, provider.name).enabled !== false).map(provider => {
    const policy = sourcePolicy(profile, provider.name);
    const tier = provider.name in profile.alwaysInclude ? "alwaysInclude" : "main";
    return { id: provider.name, provider: provider.name, tier, timeoutMs: policy.timeoutMs ?? (tier === "alwaysInclude" ? timeouts.alwaysIncludeMs : timeouts.sourceMs),
      maxResults: policy.maxResults ?? candidateCount(profile, request.numResults), weight: policy.boost ?? 1, redundantWith: policy.redundantWith ?? [], settlementGraceMs: 0,
      run: (query, count, childSignal) => provider.search({ query, numResults: count }, childSignal) };
  });
  const response = await runtime.search(sources, { query: request.query, numResults: request.numResults, mode: profile.mode,
    targetUsableSources: profile.targetUsableSources, overallTimeoutMs: timeouts.overallMs, signal });
  return { results: rankPapers(response.lists, request.query, request.numResults, profile.ranking), providers: response.stats.map(stat => ({
    provider: stat.source as PaperProviderName, tier: stat.tier, status: stat.status, count: stat.count, reason: stat.reason, error: stat.error })),
    cancelled: response.cancelled, timedOut: response.timedOut };
}
