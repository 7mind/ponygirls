/**
 * ponygirls-tokemon — one-line quota summary for a widget above the editor
 * (on the text input border): the current provider's limited windows with
 * short bars. Replacing the footer is not an option (the model picker owns
 * it), and footer statuses land in the left block, away from the model
 * indicator. Errors, rate limits, and providers without quota rows clear
 * the widget instead of parking stale or noisy text above the input.
 */

import { formatUsedLimit, sortResults } from "./format.ts";
import type { QuotaWindow } from "./quota.ts";
import type { QueryResult } from "./service.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

function windowSegment(window: QuotaWindow, now: Date): string | null {
  if (window.unlimited) return null;
  const used = fraction(window.used, window.limit);
  if (used === null) return `{${shortName(window.name)}/${formatUsedLimit(window)}}`;
  const filled = Math.round(Math.min(used, 1) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const resets = countdown(window.resetsAt, now);
  return `{${shortName(window.name)}${resets === null ? "" : `/${resets}`} [${bar} ${Math.round(used * 100)}%]}`;
}

export function widgetLine(provider: string, results: QueryResult[], now: Date): string | null {
  const row = sortResults(results).find((r) => r.target.provider === provider);
  if (!row || row.rateLimited || row.error !== null) return null;
  const windows = row.snapshot?.windows ?? [];
  if (windows.length === 0) return null;
  const segments = windows.map((w) => windowSegment(w, now)).filter((s): s is string => s !== null);
  if (segments.length === 0) return `${provider} unlimited`;
  return `${provider} ${segments.join(" ")}`;
}

export interface BorderStyle {
  border(s: string): string;
}

/**
 * The quota line framed as editor border chrome: dashes around the text,
 * padded to full width, so the widget reads as part of the input border
 * rather than a floating text row.
 */
export function widgetBorderLine(line: string, width: number, style: BorderStyle): string {
  const label = ` ${line} `;
  if (2 + visibleWidth(label) > width) return truncateToWidth(label, width, "\u2026");
  return `${style.border("\u2500\u2500")}${label}${style.border("\u2500".repeat(width - 2 - visibleWidth(label)))}`;
}
