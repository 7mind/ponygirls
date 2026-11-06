import assert from "node:assert/strict";
import test from "node:test";
import { relativeTime } from "../src/time.ts";

// Behavioral-Active × Blackbox × Atomic (specified).
test("relative ages cover minute, hour and day boundaries without rounding up", () => {
  const instant = "2026-01-01T00:00:00Z";
  const start = Date.parse(instant);
  for (const [seconds, expected] of [
    [0, "just now"], [59, "just now"], [60, "1m ago"], [3599, "59m ago"],
    [3600, "1h ago"], [9000, "2h 30m ago"], [86399, "23h 59m ago"],
    [86400, "1d ago"], [183600, "2d 3h ago"],
    [-9000, "in 2h 30m"], [-30, "just now"],
  ] as const) assert.equal(relativeTime(instant, start + seconds * 1000), expected);
  assert.throws(() => relativeTime("invalid", start), RangeError);
  assert.throws(() => relativeTime(instant, NaN), RangeError);
});
