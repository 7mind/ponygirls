import type { QueryResult } from "./service.ts";
import { CLAUDE_MIN_QUERY_MS } from "./pacing.ts";

export interface Freshness {
  fetchedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  nextRefreshAt: string | null;
}

export function freshness(result: QueryResult, now: Date): Freshness {
  const cache = result.quotaCache;
  const fetchedAt = cache === undefined ? result.fetchedAt : cache.fetchedAt;
  const ageMs = fetchedAt === null ? null : Math.max(0, now.getTime() - fetchedAt.getTime());
  return {
    fetchedAt: fetchedAt === null ? null : fetchedAt.toISOString(),
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    stale: cache !== undefined && (ageMs === null || ageMs >= CLAUDE_MIN_QUERY_MS),
    nextRefreshAt: cache === undefined ? null : cache.retryAt.toISOString(),
  };
}

export function staleLabel(result: QueryResult, now: Date): string | null {
  const state = freshness(result, now);
  if (!state.stale) return null;
  if (state.ageSeconds === null) return "stale (age unknown)";
  return `stale ${Math.floor(state.ageSeconds / 60)}m`;
}
