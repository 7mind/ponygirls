/**
 * ponygirls-tokemon — one-line quota summary for pi's footer status bar
 * (near the model indicator): the current provider's tightest window.
 * Errors, rate limits, and providers without quota rows clear the status
 * instead of parking stale or noisy text in the footer.
 */

import { formatResets, formatUsedLimit, sortResults } from "./format.ts";
import type { QueryResult } from "./service.ts";

function fraction(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null;
  return used / limit;
}

export function statusSummary(provider: string, results: QueryResult[], now: Date): string | null {
  const row = sortResults(results).find((r) => r.target.provider === provider);
  if (!row || row.rateLimited || row.error !== null) return null;
  const windows = row.snapshot?.windows ?? [];
  if (windows.length === 0) return null;
  let tightest = windows[0]!;
  for (const window of windows) {
    const was = window.unlimited ? -1 : (fraction(window.used, window.limit) ?? -1);
    const is = tightest.unlimited ? -1 : (fraction(tightest.used, tightest.limit) ?? -1);
    if (was > is) tightest = window;
  }
  if (tightest.unlimited) return `${provider} ${tightest.name} unlimited`;
  const resets = formatResets(tightest, now);
  return resets === "—"
    ? `${provider} ${tightest.name} ${formatUsedLimit(tightest)}`
    : `${provider} ${tightest.name} ${formatUsedLimit(tightest)} · resets ${resets}`;
}
