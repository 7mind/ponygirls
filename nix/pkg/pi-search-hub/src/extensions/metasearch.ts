import type { SearchResult } from "./types.js";
import { reciprocalRankFusion, runAlwaysInclude, runTargetedCombine,
  type AlwaysIncludeEntry, type BackendStats, type RankedBackendList } from "./dispatch.js";

type SearchRunner = (backend: string, query: string, count: number, signal?: AbortSignal) => Promise<SearchResult[]>;

export interface MetasearchRequest {
  mode: "first" | "targeted" | "all";
  orderedBackends: string[];
  fallback: AlwaysIncludeEntry[];
  native: AlwaysIncludeEntry[];
  query: string;
  numResults: number;
  signal?: AbortSignal;
  runBackend: SearchRunner;
}

/** Each tier contributes original ranks, never ranks of an already fused/truncated page. */
export async function runMetasearch(request: MetasearchRequest) {
  const { query, numResults, signal } = request;
  signal?.throwIfAborted();
  const runBackend: SearchRunner = async (...args) => {
    signal?.throwIfAborted();
    const results = await request.runBackend(...args);
    signal?.throwIfAborted();
    return results;
  };
  const excluded = new Set([...request.fallback, ...request.native].map(entry => entry.backend));
  const main = request.orderedBackends.filter(backend => !excluded.has(backend));
  const mainSearch = async (): Promise<{ lists: RankedBackendList[]; stats: Map<string, BackendStats> }> => {
    if (request.mode === "targeted") {
      const result = await runTargetedCombine({ orderedBackends: main, query, numResults, signal, runBackend });
      return { lists: result.usableLists, stats: result.backendStats };
    }
    const stats = new Map<string, BackendStats>();
    const search = async (backend: string, count: number): Promise<RankedBackendList> => {
      try {
        const results = await runBackend(backend, query, count, signal);
        stats.set(backend, { success: true, count: results.length });
        return { backend, results: results.map(result => ({ ...result, backend })) };
      } catch (error) {
        signal?.throwIfAborted();
        stats.set(backend, { success: false, count: 0, error: (error as Error).message });
        return { backend, results: [] };
      }
    };
    if (request.mode === "all") {
      return { lists: await Promise.all(main.map(backend => search(backend, Math.max(1, Math.ceil(numResults / main.length))))), stats };
    }
    for (const backend of main) {
      const list = await search(backend, numResults);
      if (stats.get(backend)!.success) return { lists: [list], stats };
    }
    return { lists: [], stats };
  };

  // Native adapters bound their own abort settlement. An immediate deadline race
  // here would discard the terminal model usage while the transport is closing.
  const nativePromise = (async () => {
    const stats = new Map<string, BackendStats>();
    const lists = await Promise.all(request.native.map(async entry => {
      const deadline = AbortSignal.timeout(entry.timeoutMs);
      const nativeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      try {
        const results = await runBackend(entry.backend, query, entry.maxResults ?? numResults, nativeSignal);
        nativeSignal.throwIfAborted();
        const capped = results.slice(0, entry.maxResults ?? numResults);
        stats.set(entry.backend, { success: true, count: capped.length });
        return { backend: entry.backend, results: capped.map(result => ({ ...result, backend: entry.backend })) };
      } catch (error) {
        stats.set(entry.backend, { success: false, count: 0, error: deadline.aborted
          ? `timed out after ${entry.timeoutMs}ms` : (error as Error).message });
        return { backend: entry.backend, results: [] };
      }
    }));
    return { lists, stats };
  })();
  try {
    const [quality, fallback, native] = await Promise.all([
      mainSearch(),
      runAlwaysInclude({ entries: request.fallback, query, numResults, signal, runBackend }),
      nativePromise,
    ]);
    signal?.throwIfAborted();
    const backendStats = new Map([...quality.stats, ...fallback.stats, ...native.stats]);
    const lists = [...quality.lists, ...fallback.lists, ...native.lists].filter(list => list.results.length > 0);
    return { results: reciprocalRankFusion(lists, numResults), backendStats, usableBackendCount: lists.length };
  } catch (error) {
    await nativePromise;
    throw error;
  }
}
