/**
 * ponygirls-tokemon — quota values as text (ported from tokemon's render.py):
 * amounts, used/limit, usage bars, reset countdowns, and window states.
 */

import type { QuotaWindow } from "./quota.ts";
import type { QueryResult } from "./service.ts";

/** At or above this share of a limit a window is "low". */
export const LOW_WATER_FRACTION = 0.9;
export const BAR_WIDTH = 10;
const CURRENCY_SYMBOLS = new Map([["USD", "$"], ["EUR", "€"], ["GBP", "£"]]);
const MAGNITUDES: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];

export type WindowState = "EXHAUSTED" | "unlimited" | "low" | "ok";

export function windowState(window: QuotaWindow): WindowState {
  let exhausted = window.exhausted === true;
  let fraction: number | null = null;
  if (window.used !== null && window.limit !== null && window.limit > 0) {
    fraction = window.used / window.limit;
    exhausted = exhausted || fraction >= 1;
  }
  if (exhausted) return "EXHAUSTED";
  if (window.unlimited) return "unlimited";
  return fraction !== null && fraction >= LOW_WATER_FRACTION ? "low" : "ok";
}

export function formatAmount(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  const symbol = CURRENCY_SYMBOLS.get(unit);
  if (symbol !== undefined) return `${symbol}${value.toFixed(2)}`;
  if (unit === "requests") return String(Math.trunc(value));
  if (unit === "credits") return String(Math.round(value));
  for (const [threshold, suffix] of MAGNITUDES) {
    if (Math.abs(value) >= threshold) return `${(value / threshold).toFixed(1)}${suffix}`;
  }
  return String(Math.trunc(value));
}

export function formatUsedLimit(window: QuotaWindow): string {
  if (window.unlimited) return "unlimited";
  if (window.used === null && window.limit === null) return "—";
  if (window.unit === "%" && window.used !== null) return `${window.used.toFixed(0)}%`;
  if (window.limit === null) return formatAmount(window.used, window.unit);
  if (window.used === null) return formatAmount(window.limit, window.unit);
  return `${formatAmount(window.used, window.unit)} / ${formatAmount(window.limit, window.unit)}`;
}

export function usageBar(window: QuotaWindow): string {
  if (window.unlimited || window.used === null || window.limit === null || window.limit <= 0) return "—";
  const filled = Math.max(0, Math.round(Math.min(window.used / window.limit, 1) * BAR_WIDTH));
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

export function formatResets(window: QuotaWindow, now: Date): string {
  if (window.resetsAt === null) return "—";
  const seconds = Math.trunc((window.resetsAt.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return "reset due";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function rateLimitedStatus(retryAt: Date | null, now: Date): string {
  if (retryAt === null) return "rate limited (429) · retry next refresh";
  const seconds = Math.trunc((retryAt.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return "rate limited (429) · retry due";
  return `rate limited (429) · retry in ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Rows with quota windows, and rate-limited rows (whose retry countdown matters), are shown by default. */
export function isShownByDefault(result: QueryResult): boolean {
  return result.rateLimited || (result.snapshot !== null && result.snapshot.windows.length > 0);
}

/** By (provider, login), then origin and location. */
export function sortResults(results: QueryResult[]): QueryResult[] {
  const key = (r: QueryResult): string[] => [r.target.provider, r.snapshot?.identity ?? "", r.target.origin, r.target.label].map((s) => s.toLowerCase());
  return [...results].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function hiddenCaption(hidden: QueryResult[]): string | null {
  if (hidden.length === 0) return null;
  const errors = hidden.filter((r) => r.error !== null).length;
  const parts = [];
  if (errors) parts.push(plural(errors, "error"));
  if (hidden.length - errors) parts.push(`${hidden.length - errors} without quota data`);
  return `${plural(hidden.length, "row")} hidden: ${parts.join(", ")}`;
}
