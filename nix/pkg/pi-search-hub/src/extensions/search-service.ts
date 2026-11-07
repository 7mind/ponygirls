import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { config, refreshConfig, getActiveBackends, recordLatency } from "./config.js";
import { BACKEND_DEFS, runBackend } from "./backends/registry.js";
import { resolveAlwaysInclude, selectBackendsForFallback, TARGETED_MAIN_ENGINE_COUNT, RRF_K, type AlwaysIncludeEntry } from "./dispatch.js";
import { runMetasearch } from "./metasearch.js";
import { discoverNativeEngines, NativeSearchError, NativeUsageUnavailableError, NATIVE_REQUEST_TIMEOUT_MS, NATIVE_ABORT_SETTLEMENT_GRACE_MS, type NativeEngine } from "./native.js";
import { SearchMonitor, type EngineDescriptor } from "./search-monitor.js";
import { formatCombinedResults, formatCombinedResultsCompact } from "./formatters.js";
import type { SearchResult, SearchConfig } from "./types.js";
import type { SearchPolicy } from "./search-policy.js";

const DEFAULT_RESULT_COUNT = 10;
const MAXIMUM_RESULT_COUNT = 20;
export interface SearchParams { query: string; numResults?: number; backend?: string; combine?: boolean; compact?: boolean }

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

function describePolicy(settings: SearchConfig, active: string[], fallback: AlwaysIncludeEntry[], nativeCount: number): SearchPolicy {
  const combineMode = settings.combineMode === undefined ? "all"
    : settings.combineMode === "all" || settings.combineMode === "targeted" ? settings.combineMode : "invalid";
  const mode = combineMode === "invalid" ? "invalid" : settings.combine === true ? combineMode : "first";
  const fallbackNames = new Set(fallback.map(entry => entry.backend));
  const engineOrder = active.filter(name => name !== "openai-codex" && !fallbackNames.has(name));
  const configuredStrategy = settings.selectionStrategy ?? "sequential";
  const selectionStrategy = configuredStrategy === "sequential" || configuredStrategy === "random"
    || configuredStrategy === "round-robin" || configuredStrategy === "best-latency" ? configuredStrategy : "unrecognized";
  return {
    defaultResultCount: DEFAULT_RESULT_COUNT, maximumResultCount: MAXIMUM_RESULT_COUNT,
    main: { mode, combineForced: settings.combine === true, combineMode, selectionStrategy, engineOrder,
      targetUsableEngines: TARGETED_MAIN_ENGINE_COUNT,
      requestedPerEngine: mode === "invalid" || engineOrder.length === 0 ? null
        : mode === "first" ? DEFAULT_RESULT_COUNT
        : Math.max(1, Math.ceil(DEFAULT_RESULT_COUNT / (mode === "targeted" ? TARGETED_MAIN_ENGINE_COUNT : engineOrder.length))) },
    fallback: fallback.map(entry => ({ backend: entry.backend, timeoutMs: entry.timeoutMs, maxResults: entry.maxResults ?? DEFAULT_RESULT_COUNT })),
    native: { engineCount: nativeCount, timeoutMs: NATIVE_REQUEST_TIMEOUT_MS, settlementGraceMs: NATIVE_ABORT_SETTLEMENT_GRACE_MS },
    fusion: { rankConstant: RRF_K },
  };
}

/** Session-owned discovery and counters shared by the tool and the interactive test pane. */
export class SearchService {
  readonly monitor = new SearchMonitor();
  private native: NativeEngine[] = [];
  private descriptors: EngineDescriptor[] = [];
  private policySnapshot: SearchPolicy | null = null;

  engines(): readonly EngineDescriptor[] { return this.descriptors; }
  policy(): SearchPolicy {
    if (this.policySnapshot === null) throw new Error("Search policy is unavailable before discovery");
    return structuredClone(this.policySnapshot);
  }

  async refresh(ctx: ExtensionContext, signal: AbortSignal | undefined): Promise<void> {
    refreshConfig(ctx.cwd);
    this.native = await discoverNativeEngines(ctx, signal);
    const active = getActiveBackends();
    const fallbackEntries = resolveAlwaysInclude(config.alwaysInclude, active);
    const fallback = new Set(fallbackEntries.map(entry => entry.backend));
    this.policySnapshot = describePolicy(config, active, fallbackEntries, this.native.length);
    this.descriptors = [
      ...active.filter(name => name !== "openai-codex").map(name => ({ name,
        label: BACKEND_DEFS[name]?.label ?? name, tier: fallback.has(name) ? "fallback" as const : "main" as const,
        availability: "configured" as const })),
      ...this.native.map(engine => ({ name: `native:${engine.id}`, label: engine.label, tier: "native" as const, availability: "configured" as const })),
      ...[...new Set([config.reader ?? "jina", ...(config.readerFallback ?? ["jina", "sofya", "firecrawl", "exa", "exa_mcp"])])]
        .map(name => ({ name: `reader:${name}`, label: name, tier: "reader" as const, availability: "configured" as const })),
    ];
  }

  async search(params: SearchParams, signal: AbortSignal | undefined, ctx: ExtensionContext) {
    if (params.query.trim().length === 0) throw new Error("Search query must not be empty");
    if (params.numResults !== undefined && (!Number.isFinite(params.numResults) || !Number.isInteger(params.numResults))) {
      throw new Error("numResults must be an integer");
    }
    await this.refresh(ctx, signal);
    const native = new Map(this.native.map(engine => [`native:${engine.id}`, engine]));
    const numResults = Math.max(1, Math.min(params.numResults ?? DEFAULT_RESULT_COUNT, MAXIMUM_RESULT_COUNT));
    const compact = params.compact ?? config.compact ?? false;
    const usages: Usage[] = [];
    const usageUnavailableEngines = new Set<string>();
    const withUsageNote = (text: string): string => usageUnavailableEngines.size === 0 ? text
      : `${text}\n\nNested model usage unavailable for: ${[...usageUnavailableEngines].join(", ")} (stream did not settle after cancellation).`;
    const run = async (name: string, query: string, count: number, operationSignal?: AbortSignal): Promise<SearchResult[]> => {
      operationSignal?.throwIfAborted();
      const descriptor = this.descriptors.find(engine => engine.name === name);
      if (descriptor === undefined) throw new Error(`Search engine is not configured: ${name}`);
      const finish = this.monitor.begin(descriptor);
      const started = Date.now();
      try {
        const engine = native.get(name);
        let results: SearchResult[];
        if (engine !== undefined) {
          const response = await engine.search(query, count, operationSignal);
          if (response.usage !== undefined) usages.push(response.usage);
          results = response.results;
        } else results = await runBackend(name, query, count, operationSignal);
        operationSignal?.throwIfAborted();
        recordLatency(name, Date.now() - started);
        finish({ status: results.length === 0 ? "empty" : "success", resultCount: results.length });
        return results;
      } catch (error) {
        if (error instanceof NativeSearchError && error.usage !== undefined) usages.push(error.usage);
        if (error instanceof NativeUsageUnavailableError) usageUnavailableEngines.add(name);
        finish({ status: operationSignal?.aborted ? "cancelled" : "failed" });
        throw new Error(`${name}: ${operationSignal?.aborted ? "request cancelled" : "request failed"}`);
      }
    };
    const requested = params.backend === "openai-codex" ? "native:openai-codex" : params.backend ?? "auto";
    let results; let backendStats;
    if (requested !== "auto") {
      let hits: SearchResult[];
      try { hits = await run(requested, params.query, numResults, signal); }
      catch (error) {
        return { content: [{ type: "text" as const, text: withUsageNote((error as Error).message) }],
          details: { backend: requested, resultCount: 0, backendStats: { [requested]: { success: false, count: 0 } }, usageUnavailableEngines: [...usageUnavailableEngines] },
          isError: true, usage: sumUsage(usages) };
      }
      results = hits.map(result => ({ ...result, backend: requested, sources: [requested] }));
      backendStats = new Map([[requested, { success: true, count: hits.length }]]);
    } else {
      const combine = config.combine === true || params.combine === true;
      if (config.combineMode !== undefined && config.combineMode !== "all" && config.combineMode !== "targeted") {
        throw new Error(`Invalid combineMode: ${config.combineMode}`);
      }
      let result: Awaited<ReturnType<typeof runMetasearch>>;
      try { result = await runMetasearch({
        mode: combine ? config.combineMode ?? "all" : "first",
        orderedBackends: selectBackendsForFallback(config.selectionStrategy ?? "sequential", getActiveBackends().filter(name => name !== "openai-codex")),
        fallback: resolveAlwaysInclude(config.alwaysInclude, getActiveBackends()),
        native: [...native.keys()].map(backend => ({ backend, timeoutMs: NATIVE_REQUEST_TIMEOUT_MS })),
        query: params.query, numResults, signal, runBackend: run,
      }); } catch {
        return { content: [{ type: "text" as const, text: withUsageNote(signal?.aborted ? "Search cancelled" : "Metasearch failed") }],
          details: { backend: "metasearch", resultCount: 0, backendStats: {}, usageUnavailableEngines: [...usageUnavailableEngines] }, isError: true, usage: sumUsage(usages) };
      }
      results = result.results; backendStats = result.backendStats;
      if (results.length === 0) {
        const errors = [...backendStats].map(([name, stats]) => `${name}: ${stats.success ? "0 results" : stats.error}`);
        return { content: [{ type: "text" as const, text: withUsageNote(`No usable search results: ${errors.join("; ")}`) }],
          details: { backend: "metasearch", resultCount: 0, backendStats: Object.fromEntries(backendStats), usageUnavailableEngines: [...usageUnavailableEngines] },
          isError: true, usage: sumUsage(usages) };
      }
    }
    return { content: [{ type: "text" as const, text: withUsageNote(compact ? formatCombinedResultsCompact(results)
      : formatCombinedResults(params.query, results, backendStats, BACKEND_DEFS)) }],
      details: { backend: requested === "auto" ? "metasearch" : requested, resultCount: results.length, backendStats: Object.fromEntries(backendStats), usageUnavailableEngines: [...usageUnavailableEngines] },
      usage: sumUsage(usages) };
  }
}
