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
