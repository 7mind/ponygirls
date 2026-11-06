const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function relativeTime(timestamp: string, now: number): string {
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant) || !Number.isFinite(now)) throw new RangeError("Invalid decision timestamp or clock");
  const elapsed = now - instant;
  const duration = Math.abs(elapsed);
  if (duration < MINUTE_MS) return "just now";
  const units = duration >= DAY_MS ? [[DAY_MS, "d"], [HOUR_MS, "h"]] as const
    : duration >= HOUR_MS ? [[HOUR_MS, "h"], [MINUTE_MS, "m"]] as const
    : [[MINUTE_MS, "m"]] as const;
  let remainder = duration;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const count = Math.floor(remainder / size);
    if (count) parts.push(`${count}${label}`);
    remainder %= size;
  }
  const text = parts.join(" ");
  return elapsed < 0 ? `in ${text}` : `${text} ago`;
}
