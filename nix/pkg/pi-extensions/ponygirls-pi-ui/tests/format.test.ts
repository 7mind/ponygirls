import assert from "node:assert/strict";
import { test } from "node:test";
import { BORDER_ORDER, HINT, KEY, PLAIN_THEME, ctrlKey, formatCompact, formatCount, keyHints } from "../src/index.ts";

test("formatCount groups thousands independently of the process locale", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(115173), "115,173");
  assert.equal(formatCount(142375000), "142,375,000");
});

test("formatCompact keeps three significant digits and drops trailing zeros", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, "0"], [36, "36"], [999, "999"], [1000, "1k"], [1234, "1.23k"], [12345, "12.3k"], [124000, "124k"],
    [999499, "999k"], [999999, "1M"], [8700000, "8.7M"], [115000000, "115M"], [1235000000, "1.24B"],
    [37516000000, "37.5B"], [2500000000000, "2500B"], [-12345, "-12.3k"],
  ];
  for (const [value, expected] of cases) assert.equal(formatCompact(value), expected, String(value));
});

test("key vocabulary renders through keyHints in one spelling", () => {
  assert.equal(ctrlKey("s"), "^S");
  const { lines } = keyHints(PLAIN_THEME, 80, [HINT.select, { key: KEY.tab, action: "scope" }, { key: ctrlKey("s"), action: "save" }, HINT.close]);
  assert.deepEqual(lines, ["↑↓ select  tab scope  ^S save  esc close"]);
});

test("badge positions are distinct and ascending in declaration order", () => {
  const positions = Object.values(BORDER_ORDER);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal(new Set(positions).size, positions.length);
});
