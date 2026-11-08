import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { config, refreshConfig, getActiveBackends, recordLatency } from "./config.js";
import { BACKEND_DEFS, runBackend } from "./backends/registry.js";
import { selectBackendsForFallback, type AlwaysIncludeEntry } from "./dispatch.js";
import { runMetasearch } from "./metasearch.js";
import { discoverNativeEngines, NativeSearchError, NativeUsageUnavailableError, NATIVE_PROVIDERS, type NativeEngine } from "./native.js";
import { SearchMonitor, type EngineDescriptor } from "./search-monitor.js";
import { formatCombinedResults, formatCombinedResultsCompact } from "./formatters.js";
import { SharedRuntime, boundedOperation } from "./engine/runtime.js";
import { resolveConcurrency, resolveTimeouts, validateTimeout } from "./engine/policy.js";
import { candidateCount, sourcePolicy, validateAlwaysInclude, webProfile } from "./engine/profiles.js";
import type { ResolvedProfile, SourceStatus } from "./engine/types.js";
import type { SearchResult } from "./types.js";
import type { SearchPolicy } from "./search-policy.js";

const DEFAULT_RESULT_COUNT = 10;
const MAXIMUM_RESULT_COUNT = 20;
export interface SearchParams { query: string; numResults?: number; backend?: string; combine?: boolean; compact?: boolean; rerank?: "rrf" | "lexical" }
function sumUsage(usages: Usage[]): Usage | undefined {
  if (usages.length === 0) return undefined;
  const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (const usage of usages) {
    for (const field of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) total[field] += usage[field];
    for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[field] += usage.cost[field];
    if (usage.cacheWrite1h !== undefined) total.cacheWrite1h = (total.cacheWrite1h ?? 0) + usage.cacheWrite1h;
    if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
  }
  return total;
}

/** Both tools receive the same extension-owned runtime; inspection never schedules requests. */
export class SearchService {
  readonly monitor = new SearchMonitor();
  private native: NativeEngine[] = [];
  private descriptors: EngineDescriptor[] = [];
  private policySnapshot: SearchPolicy | null = null;
  private discoveryFailed = false;
  constructor(private readonly runtime: SharedRuntime) {}
  engines(): readonly EngineDescriptor[] { return this.descriptors; }
  policy(): SearchPolicy {
    if (this.policySnapshot === null) throw new Error("Search policy is unavailable before discovery");
    return structuredClone(this.policySnapshot);
  }
  async refresh(ctx: ExtensionContext, signal: AbortSignal | undefined, overallDeadline?: number): Promise<void> {
    refreshConfig(ctx.cwd);
    const timeouts = resolveTimeouts(config.timeouts);
    const limits = resolveConcurrency(config.concurrency);
    this.runtime.configure(limits);
    const profile = this.profile();
    const strategy = config.selectionStrategy ?? "sequential";
    if (!["sequential", "random", "round-robin", "best-latency"].includes(strategy)) throw new Error("Invalid selection strategy");
    this.discoveryFailed = false;
    const discoveryBudget = overallDeadline === undefined ? timeouts.discoveryMs : Math.min(timeouts.discoveryMs, Math.floor(overallDeadline - performance.now()));
    if (discoveryBudget <= 0) { this.native = []; this.discoveryFailed = true; }
    else {
      try { this.native = await boundedOperation(child => discoverNativeEngines(ctx, child, timeouts), discoveryBudget, signal, 0); }
      catch { signal?.throwIfAborted(); this.native = []; this.discoveryFailed = true; }
    }
    if (this.discoveryFailed) {
      for (const id of NATIVE_PROVIDERS) if (`native:${id}` in profile.alwaysInclude) {
        this.native.push({ id, label: `${id} (discovery unavailable; availability unknown)`,
          search: async () => { throw new NativeSearchError("Native discovery unavailable"); } });
      }
    }
    const active = getActiveBackends().filter(name => name !== "openai-codex" && sourcePolicy(profile, name).enabled !== false);
    validateAlwaysInclude(profile, [...active, ...this.native.map(engine => `native:${engine.id}`)]);
    const fallback = Object.keys(profile.alwaysInclude).filter(name => sourcePolicy(profile, name).enabled !== false);
    this.policySnapshot = {
      defaultResultCount: DEFAULT_RESULT_COUNT, maximumResultCount: MAXIMUM_RESULT_COUNT,
      main: { mode: profile.mode, combineForced: config.combine === true, combineMode: config.combineMode ?? "all", selectionStrategy: strategy,
        engineOrder: active.filter(name => !fallback.includes(name)), targetUsableEngines: profile.targetUsableSources,
        requestedPerEngine: candidateCount(profile, DEFAULT_RESULT_COUNT) },
      fallback: fallback.map(backend => ({ backend, timeoutMs: sourcePolicy(profile, backend).timeoutMs ?? timeouts.alwaysIncludeMs,
        maxResults: sourcePolicy(profile, backend).maxResults ?? candidateCount(profile, DEFAULT_RESULT_COUNT) })),
      native: { engineCount: this.native.filter(engine => sourcePolicy(profile, `native:${engine.id}`).enabled !== false).length, timeoutMs: timeouts.nativeMs, settlementGraceMs: timeouts.nativeGraceMs },
      fusion: { rankConstant: profile.ranking.rankConstant, rerank: profile.ranking.rerank, titleWeight: profile.ranking.titleWeight, bodyWeight: profile.ranking.bodyWeight, exactTitle: profile.ranking.exactTitle },
      execution: { ...limits, overallTimeoutMs: timeouts.overallMs, sourceTimeoutMs: timeouts.sourceMs, discoveryTimeoutMs: timeouts.discoveryMs },
    };
    this.descriptors = [
      ...active.map(name => ({ name, label: BACKEND_DEFS[name]?.label ?? name, tier: fallback.includes(name) ? "fallback" as const : "main" as const, availability: "configured" as const })),
      ...this.native.filter(engine => sourcePolicy(profile, `native:${engine.id}`).enabled !== false).map(engine => ({ name: `native:${engine.id}`, label: engine.label, tier: "native" as const, availability: this.discoveryFailed ? "unknown" as const : "configured" as const })),
      ...[...new Set([config.reader ?? "jina", ...(config.readerFallback ?? ["jina", "sofya", "firecrawl", "exa", "exa_mcp"])])]
        .map(name => ({ name: `reader:${name}`, label: name, tier: "reader" as const, availability: "configured" as const })),
    ];
  }
  private profile(): ResolvedProfile {
    const profile = webProfile(config);
    for (const [name, backend] of Object.entries(config.backends ?? {})) {
      if (backend?.timeout !== undefined && profile.sources[name]?.timeoutMs === undefined) {
        validateTimeout(backend.timeout);
        profile.sources[name] = { ...profile.sources[name], timeoutMs: backend.timeout };
      }
    }
    return profile;
  }
  async search(params: SearchParams, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    if (typeof params.query !== "string" || !params.query.trim() || params.query.length > 2000) throw new Error("Search query must contain 1–2000 characters");
    if (params.numResults !== undefined && (!Number.isInteger(params.numResults) || params.numResults < 1 || params.numResults > MAXIMUM_RESULT_COUNT)) throw new Error("numResults must be an integer from 1 to 20");
    if (params.rerank !== undefined && params.rerank !== "rrf" && params.rerank !== "lexical") throw new Error("Invalid rerank mode");
    refreshConfig(ctx.cwd);
    const started = performance.now();
    const timeouts = resolveTimeouts(config.timeouts);
    await this.refresh(ctx, signal, started + timeouts.overallMs);
    const native = new Map(this.native.map(engine => [`native:${engine.id}`, engine]));
    const profile = this.profile();
    if (params.combine === true) profile.mode = config.combineMode ?? "all";
    if (params.rerank !== undefined) profile.ranking.rerank = params.rerank;
    const numResults = params.numResults ?? DEFAULT_RESULT_COUNT;
    const usages: Usage[] = [];
    const usageUnavailable = new Set<string>();
    const settledNative = new Set<string>();
    const finalizers = new Map<string, ReturnType<SearchMonitor["begin"]>>();
    const run = async (name: string, query: string, count: number, child?: AbortSignal): Promise<SearchResult[]> => {
      child?.throwIfAborted();
      const descriptor = this.descriptors.find(engine => engine.name === name);
      if (descriptor === undefined) throw new Error("Search engine is not configured");
      const finish = this.monitor.begin(descriptor); finalizers.set(name, finish);
      const attempt = performance.now();
      try {
        const engine = native.get(name);
        let results: SearchResult[];
        if (engine !== undefined) {
          const response = await engine.search(query, count, child, { ...timeouts, nativeMs: sourcePolicy(profile, name).timeoutMs ?? timeouts.nativeMs, managedDeadline: true });
          if (response.usage !== undefined) usages.push(response.usage);
          results = response.results;
        } else results = await runBackend(name, query, count, child);
        child?.throwIfAborted(); recordLatency(name, performance.now() - attempt);
        finish({ status: results.length ? "success" : "empty", resultCount: results.length });
        return results;
      } catch (error) {
        if (error instanceof NativeSearchError && error.usage !== undefined) usages.push(error.usage);
        if (error instanceof NativeUsageUnavailableError) usageUnavailable.add(name);
        throw new Error("Search provider failed");
      } finally {
        if (native.has(name)) settledNative.add(name);
      }
    };
    const requested = params.backend === "openai-codex" ? "native:openai-codex" : params.backend ?? "auto";
    const remaining = Math.floor(timeouts.overallMs - (performance.now() - started));
    const undiscoveredNative = this.discoveryFailed && NATIVE_PROVIDERS.some(id => requested === `native:${id}`);
    if (requested !== "auto" && !undiscoveredNative && !this.descriptors.some(engine => engine.name === requested && engine.tier !== "reader")) throw new Error("Requested search engine is not configured");
    if (undiscoveredNative && remaining > 0 && !native.has(requested)) throw new Error("Native source availability is unknown because discovery did not complete");
    const active = selectBackendsForFallback(config.selectionStrategy ?? "sequential", getActiveBackends().filter(name => name !== "openai-codex"));
    const fallback: AlwaysIncludeEntry[] = Object.keys(profile.alwaysInclude).map(backend => ({ backend, timeoutMs: sourcePolicy(profile, backend).timeoutMs ?? timeouts.alwaysIncludeMs, maxResults: sourcePolicy(profile, backend).maxResults }));
    const result = remaining <= 0 ? {
      results: [], cancelled: false, timedOut: true,
      backendStats: new Map([...new Set(requested === "auto" ? [...active, ...native.keys()] : [requested])].filter(name => sourcePolicy(profile, name).enabled !== false).map(name => [name, {
        success: false, count: 0, status: "not-started" as const, reason: "overall-deadline" as const,
        tier: native.has(name) ? "native" as const : name in profile.alwaysInclude ? "alwaysInclude" as const : "main" as const,
      }])),
    } : await runMetasearch({ mode: requested === "auto" ? profile.mode : "first", orderedBackends: requested === "auto" ? active : [requested],
      fallback: requested === "auto" ? fallback : [], native: [...native.keys()].filter(name => requested === "auto" || name === requested).map(backend => ({ backend, timeoutMs: sourcePolicy(profile, backend).timeoutMs ?? timeouts.nativeMs })),
      query: params.query, numResults, signal, runBackend: run, runtime: this.runtime, timeouts, overallTimeoutMs: remaining,
      profile: requested === "auto" ? profile : { ...profile, alwaysInclude: {} } });
    for (const [name, stats] of result.backendStats) {
      const status: SourceStatus = stats.status ?? (stats.success ? stats.count ? "success" : "empty" : "failed");
      if (status !== "not-started") finalizers.get(name)?.({ status, resultCount: stats.count });
      if (native.has(name) && (status === "timeout" || status === "cancelled") && !settledNative.has(name)) usageUnavailable.add(name);
    }
    const notes = [this.discoveryFailed ? "Native discovery unavailable." : "", result.timedOut ? "Overall search deadline reached; only completed results are included." : "",
      usageUnavailable.size ? `Nested model usage unavailable for: ${[...usageUnavailable].join(", ")}.` : ""].filter(Boolean);
    const text = result.results.length ? (params.compact ?? config.compact ?? false) ? formatCombinedResultsCompact(result.results)
      : formatCombinedResults(params.query, result.results, result.backendStats, BACKEND_DEFS)
      : result.cancelled ? "Search cancelled" : "No usable search results";
    return { content: [{ type: "text" as const, text: [text, ...notes].join("\n\n") }],
      details: { backend: requested === "auto" ? "metasearch" : requested, resultCount: result.results.length, results: result.results,
        backendStats: Object.fromEntries(result.backendStats), usageUnavailableEngines: [...usageUnavailable], cancelled: result.cancelled, timedOut: result.timedOut },
      isError: result.cancelled || (result.results.length === 0 && [...result.backendStats.values()].every(stats => !stats.success)), usage: sumUsage(usages) };
  }
}
