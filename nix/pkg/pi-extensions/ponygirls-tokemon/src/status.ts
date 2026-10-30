/**
 * ponygirls-tokemon — one-line quota summary for the editor's top-right
 * border: the current provider's limited windows with short bars. Published
 * through setWidget under the "tokemon" key (borderTopRight, one line).
 * Last known shared quota values remain visible with an explicit stale age.
 * Bars take their window state's colour, as in the /tokemon table.
 */

import { formatUsedLimit, sortResults, windowState } from "./format.ts";
import { staleLabel } from "./freshness.ts";
import type { QuotaWindow } from "./quota.ts";
import type { QueryResult } from "./service.ts";
import { styleBar, type TableStyle } from "./table.ts";

const BAR_WIDTH = 5;

function fraction(used: number | null, limit: number | null): number | null {
  if (used === null || limit === null || limit <= 0) return null;
  return used / limit;
}

/** A window's short name: the trailing duration ("primary (5h)" to "5h"), else the full name. */
function shortName(name: string): string {
  return /\(([^()]*)\)\s*$/.exec(name)?.[1] ?? name;
}

/** Compact reset countdown ("1:30", "5d:09:57"), or null when there is none to show. */
function countdown(resetsAt: Date | null, now: Date): string | null {
  if (resetsAt === null) return null;
  const seconds = Math.trunc((resetsAt.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  if (hours >= 24) return `${Math.floor(hours / 24)}d:${String(hours % 24).padStart(2, "0")}:${mm}`;
  if (hours > 0) return `${hours}:${mm}`;
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The line in a style; its text does not depend on the style. */
export type QuotaLine = (style: TableStyle) => string;

function windowSegment(window: QuotaWindow, now: Date, style: TableStyle): string | null {
  if (window.unlimited) return null;
  const used = fraction(window.used, window.limit);
  if (used === null) return `{${shortName(window.name)}/${formatUsedLimit(window)}}`;
  const filled = Math.round(Math.min(used, 1) * BAR_WIDTH);
  const bar = styleBar(style, windowState(window), "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled));
  const resets = countdown(window.resetsAt, now);
  return `{${shortName(window.name)}${resets === null ? "" : `/${resets}`} [${bar} ${Math.round(used * 100)}%]}`;
}

export function quotaLine(provider: string, results: QueryResult[], now: Date): QuotaLine | null {
  const row = sortResults(results).find((r) => r.target.provider === provider);
  if (!row || row.rateLimited || row.error !== null) return null;
  const windows = row.snapshot?.windows ?? [];
  if (windows.length === 0) return null;
  const stale = staleLabel(row, now);
  const suffix = stale === null ? "" : ` ⚠ ${stale}`;
  return (style) => {
    const segments = windows.map((w) => windowSegment(w, now, style)).filter((s): s is string => s !== null);
    if (segments.length === 0) return `${provider} unlimited${suffix}`;
    return `${provider} ${segments.join(" ")}${suffix}`;
  };
}
