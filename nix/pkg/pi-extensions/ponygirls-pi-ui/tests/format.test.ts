import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BORDER_ORDER, HINT, KEY, PLAIN_THEME, borderBadge, borderBadgeCompact, ctrlKey, formatAgo, formatBytes, formatCompact, formatCount, frameTitle, homeRelative, keyHints, shortId, type UiTheme } from "../src/index.ts";

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

test("border badges: glyph alone when quiet, label coloured by state, compact form unpadded", () => {
  const tagged: UiTheme = { fg: (color, text) => `<${color}>${text}</>`, bg: (_color, text) => text, bold: (text) => text };
  const quiet = { glyph: "🗃️", state: "settled", label: "", compact: "" } as const;
  assert.equal(borderBadge(tagged, quiet, 40), " 🗃️ ");
  assert.equal(borderBadgeCompact(tagged, quiet, 40), "🗃️");
  const busy = { glyph: "👥", state: "running", label: "3 ▸2", compact: "3" } as const;
  assert.equal(borderBadge(tagged, busy, 40), " 👥 <accent>3 ▸2</> ");
  assert.equal(borderBadgeCompact(tagged, busy, 40), "👥<accent>3</>");
  const asking = { glyph: "📥", state: "attention", label: "2", compact: "2" } as const;
  assert.equal(borderBadge(PLAIN_THEME, asking, 40), " 📥 2 ");
  const clipped = borderBadge(PLAIN_THEME, asking, 3);
  assert.ok(clipped.startsWith(" 📥"));
  assert.equal(visibleWidth(clipped), 3);
});

test("wide badges use a padded chip and wide-only details; the narrower forms stay unchanged", () => {
  const tagged: UiTheme = {
    fg: (color, text) => `<${color}>${text}</>`,
    bg: (color, text) => `[${color}]${text}[/]`,
    bold: (text) => text,
  };
  const badge = { glyph: "📥", state: "attention", label: "5", compact: "5", wideLabel: "2+3", wideShortcut: "⌃⌥D" } as const;
  assert.equal(borderBadge(tagged, badge, 119), " 📥 <warning>5</> ");
  assert.equal(borderBadge(tagged, badge, 120), "[customMessageBg] 📥 <warning>2+3</><muted> · ⌃⌥D</> [/]");
  assert.equal(borderBadgeCompact(tagged, badge, 120), "📥<warning>5</>");
  const quiet = { glyph: "🗃️", state: "settled", label: "", compact: "" } as const;
  assert.equal(borderBadge(tagged, quiet, 120), "[toolPendingBg] 🗃️ [/]");
});

test("a wide badge that exceeds the whole render width falls back without clipping the hint", () => {
  const badge = { glyph: "📥", state: "attention", label: "5", compact: "5", wideLabel: "x".repeat(122), wideShortcut: "⌃⌥D" } as const;
  assert.equal(borderBadge(PLAIN_THEME, badge, 120), "📥5");
});

test("formatBytes uses binary units with one decimal below ten", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, "0 B"], [9, "9 B"], [1023, "1023 B"], [1024, "1 KiB"], [1536, "1.5 KiB"], [10 * 1024, "10 KiB"],
    [321822720, "307 MiB"], [5 * 1024 ** 3 + 1, "5 GiB"], [3 * 1024 ** 4, "3 TiB"], [5000 * 1024 ** 4, "5000 TiB"],
  ];
  for (const [bytes, expected] of cases) assert.equal(formatBytes(bytes), expected, String(bytes));
});

test("formatAgo shows at most two units and marks future instants", () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);
  const minute = 60_000;
  assert.equal(formatAgo(now - 59_000, now), "just now");
  assert.equal(formatAgo(now - 2 * minute, now), "2m ago");
  assert.equal(formatAgo(now - 185 * minute, now), "3h 5m ago");
  assert.equal(formatAgo(now - 3 * 60 * minute, now), "3h ago");
  assert.equal(formatAgo(now - (2 * 24 * 60 + 4 * 60 + 30) * minute, now), "2d 4h ago");
  assert.equal(formatAgo(now + 2 * minute, now), "in 2m");
  assert.throws(() => formatAgo(Number.NaN, now), RangeError);
});

test("homeRelative shortens only paths under the home directory; shortId marks what it cut", () => {
  assert.equal(homeRelative("/home/u/.pi/agent/cuckoo.json", "/home/u"), "~/.pi/agent/cuckoo.json");
  assert.equal(homeRelative("/home/u", "/home/u/"), "~");
  assert.equal(homeRelative("/home/user2/x", "/home/u"), "/home/user2/x");
  assert.equal(homeRelative("/etc/x", ""), "/etc/x");
  assert.equal(shortId("7c1d4e9a-2b6f-4a35-8e0c-1f9b3d5a7e24"), "7c1d4e9a…");
  assert.equal(shortId("dbd0"), "dbd0");
});

test("frameTitle keeps the active tab when the tabs do not all fit, marking the hidden side", () => {
  const labels = ["Today", "This Week", "Last Week", "Last 30 Days", "All Time"];
  const title = (active: number, width: number) =>
    frameTitle(PLAIN_THEME, width, { title: "Usage", tabs: { labels, active }, right: "lines 1–9 of 20 ↓" }, "none");
  // Regression: at 80 columns the last tab, the active one, was cut away.
  const last = title(4, 80);
  assert.equal(visibleWidth(last.line), 80);
  assert.match(last.line, /‹ .* All Time /);
  assert.doesNotMatch(last.line, /Today/);
  const first = title(0, 80);
  assert.match(first.line, / Today .* ›/);
  assert.doesNotMatch(first.line, /All Time/);
  // Spans keep their tab index and point at their own label.
  for (const rendered of [last, first, title(2, 70)]) {
    assert.ok(rendered.tabSpans.length > 0);
    for (const span of rendered.tabSpans) assert.equal(rendered.line.slice(span.start, span.end), ` ${labels[span.index]} `);
  }
  assert.ok(title(2, 70).tabSpans.some(span => span.index === 2));
  // Everything fits: unchanged, no markers.
  const wide = title(4, 120);
  assert.equal(wide.tabSpans.length, labels.length);
  assert.doesNotMatch(wide.line, /[‹›]/);
});

test("frameTitle shows every tab when they fill the title exactly", () => {
  // Regression: the tab window kept one column in reserve and hid a tab that fitted.
  const labels = ["Web stats", "Paper stats", "Fetchers", "Test web", "Test papers"];
  const rendered = frameTitle(PLAIN_THEME, 80, { title: "Web search", tabs: { labels, active: 0 } }, "none");
  assert.equal(rendered.line, `── Web search   Web stats   Paper stats   Fetchers   Test web   Test papers  ───`);
  assert.equal(rendered.tabSpans.length, labels.length);
  const narrower = frameTitle(PLAIN_THEME, 79, { title: "Web search", tabs: { labels, active: 0 } }, "none");
  assert.equal(visibleWidth(narrower.line), 79);
  assert.match(narrower.line, /Test web  ›/);
});
