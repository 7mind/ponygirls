/**
 * Number formats shared by the panes, independent of the process locale.
 */
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole number with thousands separators: 115173 → `115,173`. */
export function formatCount(value: number): string {
  return GROUPED.format(value);
}

const COMPACT_UNITS = [
  { divisor: 1e3, suffix: "k" },
  { divisor: 1e6, suffix: "M" },
  { divisor: 1e9, suffix: "B" },
] as const;

/**
 * At most three significant digits with a k/M/B suffix: 999 → `999`,
 * 1234 → `1.23k`, 12345 → `12.3k`, 999999 → `1M`, 1235000000 → `1.24B`.
 * Trailing zeros are dropped (`8.70M` → `8.7M`).
 */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 1000) return String(Math.round(value));
  const sign = value < 0 ? "-" : "";
  let scaled = 0;
  let suffix = "";
  for (const unit of COMPACT_UNITS) {
    scaled = Number((magnitude / unit.divisor).toPrecision(3));
    suffix = unit.suffix;
    // Rounding to three digits can reach the next unit (999,999 → 1M).
    if (scaled < 1000) break;
  }
  return `${sign}${scaled}${suffix}`;
}

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;

/** Binary size: `9 B`, `1.5 KiB`, `307 MiB` (one decimal below 10 of a unit). */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) return `${bytes} B`;
  let value = bytes / BYTES_PER_UNIT;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${SIZE_UNITS[unit]}`;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Age of an instant, two units at most: `just now`, `2m ago`, `3h 5m ago`,
 * `2d 4h ago`; an instant ahead of the clock reads `in 2m`.
 */
export function formatAgo(instantMs: number, nowMs: number): string {
  if (!Number.isFinite(instantMs) || !Number.isFinite(nowMs)) throw new RangeError("Invalid instant or clock");
  const elapsed = nowMs - instantMs;
  const duration = Math.abs(elapsed);
  if (duration < MINUTE_MS) return "just now";
  const units = duration >= DAY_MS ? [[DAY_MS, "d"], [HOUR_MS, "h"]] as const
    : duration >= HOUR_MS ? [[HOUR_MS, "h"], [MINUTE_MS, "m"]] as const
    : [[MINUTE_MS, "m"]] as const;
  let remainder = duration;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const count = Math.floor(remainder / size);
    if (count > 0) parts.push(`${count}${label}`);
    remainder %= size;
  }
  const text = parts.join(" ");
  return elapsed < 0 ? `in ${text}` : `${text} ago`;
}

/** A path under `home` as `~/…`; any other path unchanged. */
export function homeRelative(path: string, home: string): string {
  const root = home.endsWith("/") ? home.slice(0, -1) : home;
  if (root === "") return path;
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}

const SHORT_ID_LENGTH = 8;

/** The first eight characters of a long identifier, marked `…` when shortened. */
export function shortId(id: string): string {
  return id.length > SHORT_ID_LENGTH ? `${id.slice(0, SHORT_ID_LENGTH)}…` : id;
}
