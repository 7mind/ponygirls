import { fusePapers } from "./ranking.js";
import { PAPER_PROVIDERS, type PaperConfig, type PaperProvider, type PaperProviderName, type PaperProviderStats, type PaperRecord, type PaperSearchRequest, type PaperSearchResult } from "./types.js";

export class PaperTimeoutError extends Error {
  constructor() { super("Paper provider timed out"); this.name = "PaperTimeoutError"; }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Validate JSON runtime inputs, not just TypeScript callers. */
export function validatePaperConfig(settings: PaperConfig): void {
  if (!object(settings) || Object.keys(settings).some(key => !["mode", "rerank", "sources"].includes(key))) throw new Error("Invalid paper configuration");
  if (settings.mode !== undefined && settings.mode !== "first" && settings.mode !== "targeted" && settings.mode !== "all") throw new Error("Invalid paper mode");
  if (settings.rerank !== undefined && settings.rerank !== "rrf" && settings.rerank !== "lexical") throw new Error("Invalid paper rerank");
  if (settings.sources === undefined) return;
  if (!object(settings.sources)) throw new Error("Invalid paper sources");
  for (const [name, source] of Object.entries(settings.sources)) {
    if (!PAPER_PROVIDERS.includes(name as PaperProviderName) || !object(source) || Object.keys(source).some(key => !["enabled", "tier", "timeoutMs", "maxResults", "boost"].includes(key))) throw new Error("Invalid paper source configuration");
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error("Invalid paper source enabled flag");
    if (source.tier !== undefined && source.tier !== "main" && source.tier !== "fallback") throw new Error("Invalid paper source tier");
    if (source.timeoutMs !== undefined && !(typeof source.timeoutMs === "number" && Number.isFinite(source.timeoutMs) && source.timeoutMs > 0 && source.timeoutMs <= 60000)) throw new Error("Invalid paper source timeout");
    if (source.maxResults !== undefined && !integer(source.maxResults, 1, 50)) throw new Error("Invalid paper source result limit");
    if (source.boost !== undefined && !(typeof source.boost === "number" && Number.isFinite(source.boost) && source.boost > 0 && source.boost <= 4)) throw new Error("Invalid paper source boost");
  }
}

/** Bound even transports which ignore cancellation. Always remove owned resources. */
export async function boundedPaperOperation<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal: AbortSignal | undefined): Promise<T> {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000)) throw new Error("Invalid paper operation timeout");
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => { const reason = signal!.reason; reject(reason); controller.abort(reason); };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => { const error = new PaperTimeoutError(); reject(error); controller.abort(error); }, timeoutMs);
      Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }).then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export async function runPaperMetasearch(providers: PaperProvider[], settings: PaperConfig, request: PaperSearchRequest, signal: AbortSignal | undefined): Promise<PaperSearchResult> {
  validatePaperConfig(settings);
  if (!object(request) || typeof request.query !== "string" || !request.query.trim() || request.query.length > 2000 || !integer(request.numResults, 1, 20)) throw new Error("Invalid paper search request");
  const names = new Set<PaperProviderName>();
  for (const provider of providers) {
    if (!PAPER_PROVIDERS.includes(provider.name) || names.has(provider.name)) throw new Error("Invalid or duplicate paper provider");
    names.add(provider.name);
  }
  signal?.throwIfAborted();
  const active = providers.filter(provider => settings.sources?.[provider.name]?.enabled !== false);
  const tier = (name: PaperProviderName) => settings.sources?.[name]?.tier ?? (name === "firecrawl" || name === "exa" ? "main" : "fallback");
  const stats = new Map<PaperProviderName, PaperProviderStats>();
  const run = async (provider: PaperProvider) => {
    signal?.throwIfAborted();
    const source = settings.sources?.[provider.name];
    const maxResults = source?.maxResults ?? Math.min(40, Math.max(10, 2 * request.numResults));
    let results: PaperRecord[] = [];
    try {
      results = await boundedPaperOperation(childSignal => provider.search({ query: request.query, numResults: maxResults }, childSignal), source?.timeoutMs ?? (tier(provider.name) === "main" ? 15000 : 8000), signal);
      signal?.throwIfAborted();
      if (!Array.isArray(results)) throw new Error("Invalid provider result");
      results = results.slice(0, maxResults);
      stats.set(provider.name, { provider: provider.name, tier: tier(provider.name), status: results.length ? "success" : "empty", count: results.length });
    } catch (error) {
      signal?.throwIfAborted();
      const timeout = error instanceof PaperTimeoutError;
      stats.set(provider.name, { provider: provider.name, tier: tier(provider.name), status: timeout ? "timeout" : "failed", count: 0, error: timeout ? "Paper provider timed out" : "Paper provider failed" });
      results = [];
    }
    return { provider: provider.name, weight: source?.boost ?? 1, results };
  };
  const mains = active.filter(provider => tier(provider.name) === "main");
  const main = async () => {
    if (settings.mode === "all") return Promise.all(mains.map(run));
    const lists: Awaited<ReturnType<typeof run>>[] = [];
    const limit = settings.mode === "first" ? 1 : 2;
    // Start the targeted pair together, then fill vacancies from the remaining
    // ordered engines. Empty successful responses do not consume usable slots.
    let index = 0;
    if (limit === 2) {
      const initial = mains.slice(0, 2);
      lists.push(...await Promise.all(initial.map(run)));
      index = initial.length;
    }
    while (index < mains.length && lists.filter(list => list.results.length > 0).length < limit) lists.push(await run(mains[index++]));
    return lists;
  };
  const [mainLists, fallbackLists] = await Promise.all([main(), Promise.all(active.filter(provider => tier(provider.name) === "fallback").map(run))]);
  signal?.throwIfAborted();
  return {
    results: fusePapers([...mainLists, ...fallbackLists], request.query, request.numResults, settings.rerank ?? "lexical"),
    providers: active.flatMap(provider => { const stat = stats.get(provider.name); return stat ? [stat] : []; }),
  };
}
