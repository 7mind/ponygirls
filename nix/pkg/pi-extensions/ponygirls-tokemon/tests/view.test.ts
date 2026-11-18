import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { quotaWindow } from "../src/quota.ts";
import type { QueryResult, QuotaReport } from "../src/service.ts";
import { PLAIN_TABLE_STYLE } from "../src/table.ts";
import { TokemonView } from "../src/view.ts";
import { PLAIN_THEME } from "@ponygirls/pi-ui";

const NOW = new Date("2026-10-06T12:00:00Z");
const ESC = "\x1b";
const PAGE_DOWN = "\x1b[6~";
const PAGE_UP = "\x1b[5~";

function results(count: number): QueryResult[] {
  return Array.from({ length: count }, (_, i) => ({
    target: { provider: `p${String(i).padStart(2, "0")}`, origin: "env" as const, label: `KEY_${i}`, credential: null, note: null },
    snapshot: { plan: null, identity: null, windows: [quotaWindow("w", i, 100, "%", null)], note: null },
    error: null,
    fetchedAt: NOW,
    rateLimited: false,
    retryAt: null,
  }));
}

function view(report: QuotaReport, rows = 20): { v: TokemonView; asked: number[]; closed: () => boolean } {
  const asked: number[] = [];
  let closed = false;
  const v = new TokemonView({
    report: async (maxAgeMs) => {
      asked.push(maxAgeMs);
      return report;
    },
    models: () => new Map([["p00", [{ id: "model-a", efforts: ["off"] }, { id: "model-b", efforts: ["low", "high"] }]]]),
    now: () => NOW,
    rows: () => rows,
    requestRender: () => {},
    close: () => { closed = true; },
    style: PLAIN_TABLE_STYLE,
    theme: PLAIN_THEME,
    refreshEveryMs: 300_000,
  });
  return { v, asked, closed: () => closed };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The two rows of the captured pane: a rate-limited login, an unlimited enterprise one, and a provider without a quota endpoint. */
function captured(): QueryResult[] {
  const target = (provider: string) => ({ provider, origin: "auth.json" as const, label: "~/.pi/agent/auth.json", credential: null, note: null });
  const base = { error: null, fetchedAt: NOW, rateLimited: false, retryAt: null };
  return [
    { ...base, target: target("anthropic"), snapshot: null, error: "rate limited (HTTP 429) by https://api.anthropic.com/api/oauth/usage", rateLimited: true, retryAt: new Date(NOW.getTime() + (55 * 60 + 28) * 1000) },
    { ...base, target: target("openai-codex"), snapshot: { plan: "teams", identity: "someone@example.com", windows: [{ ...quotaWindow("credits", null, null, "credits", null), unlimited: true }], note: "resets: 0" } },
    { ...base, target: target("xiaomi"), snapshot: { plan: null, identity: null, windows: [], note: "no quota endpoint" } },
  ];
}

test("the 80-column pane: Provider and Status stay, one line per row, hidden columns named", async (t) => {
  const { v } = view({ refreshedAt: NOW, results: captured() });
  t.after(() => v.dispose());
  await settle();
  const lines = v.render(80);
  assert.match(lines[0]!, /^── tokemon ─+ updated \d\d:\d\d · refresh in 5:00 ──$/);
  assert.equal(visibleWidth(lines[0]!), 80);
  assert.deepEqual(lines.slice(1), [
    "Provider      Window   Used / limit  Usage  Resets  Status",
    "anthropic     —                   —  —           —  rate limited · retry 55m",
    "openai-codex  credits     unlimited  —           —  unlimited · resets: 0",
    "1 row hidden: 1 without quota data · hidden at this width: Src, Login, Plan",
    "─".repeat(80),
    "r refresh  i show invalid  m show models  ↑↓ scroll  esc close",
  ]);
  v.handleInput("i");
  // The view of invalid rows gives up columns to show each status whole.
  assert.deepEqual(v.render(80).slice(1, -2), [
    "Provider      Window   Used / limit  Status",
    "anthropic     —                   —  rate limited (429) · retry in 55m 28s",
    "openai-codex  credits     unlimited  unlimited · resets: 0",
    "xiaomi        —                   —  no quota endpoint",
    "hidden at this width: Src, Login, Plan, Usage, Resets",
  ]);
});

test("notes under the table go one per line when they do not fit on one", async (t) => {
  const failed: QueryResult = { target: { provider: "minimax", origin: "env", label: "MINIMAX_API_KEY", credential: null, note: null }, snapshot: null, error: "QuotaFetchError: HTTP 500", fetchedAt: NOW, rateLimited: false, retryAt: null };
  const { v } = view({ refreshedAt: NOW, results: [...captured(), failed] });
  t.after(() => v.dispose());
  await settle();
  assert.deepEqual(v.render(100).slice(-3), [
    "2 rows hidden: 1 error, 1 without quota data · hidden at this width: Src, Plan",
    "─".repeat(100),
    "r refresh  i show invalid  m show models  ↑↓ scroll  esc close",
  ]);
  assert.deepEqual(v.render(80).slice(-4), [
    "2 rows hidden: 1 error, 1 without quota data",
    "hidden at this width: Src, Login, Plan",
    "─".repeat(80),
    "r refresh  i show invalid  m show models  ↑↓ scroll  esc close",
  ]);
});

test("a scrolled pane stays within its row budget with the position among the notes", async (t) => {
  const rows = 12;
  const { v } = view({ refreshedAt: NOW, results: results(30) }, rows);
  t.after(() => v.dispose());
  await settle();
  for (const width of [48, 60, 80, 120]) {
    for (const key of ["", PAGE_DOWN, "G", "g"]) {
      if (key !== "") v.handleInput(key);
      const lines = v.render(width);
      assert.ok(lines.length <= rows, `${width}: ${lines.length} lines for ${rows} rows\n${lines.join("\n")}`);
      assert.ok(lines.some((l) => /lines \d+-\d+ of \d+/.test(l)), `${width}:\n${lines.join("\n")}`);
      assert.ok(lines.every((l) => !l.includes("…") && visibleWidth(l) <= width), `${width}:\n${lines.join("\n")}`);
    }
  }
  // A note longer than the pane wraps; nothing of it is cut.
  assert.match(v.render(48).join(" "), /hidden at this width: Src, Login, Plan, Usage, Resets lines 1-\d+ of 31/);
});

test("every pane line fits 60, 80, 100, 120 and 170 columns, in every view", async (t) => {
  const { v } = view({ refreshedAt: NOW, results: [...captured(), ...results(3)] });
  t.after(() => v.dispose());
  await settle();
  for (const keys of ["", "i", "m"]) {
    for (const key of keys) v.handleInput(key);
    for (const width of [60, 80, 100, 120, 170]) {
      const lines = v.render(width);
      assert.ok(lines.every((l) => visibleWidth(l) <= width), `${width}:\n${lines.join("\n")}`);
      assert.equal(visibleWidth(lines[0]!), width);
      assert.match(lines[1]!, /^Provider .* Status$/, `${width}: ${lines[1]}`);
      assert.ok(lines.some((l) => /^anthropic .* rate limited/.test(l)), `${width}:\n${lines.join("\n")}`);
    }
  }
});

test("the unadvertised paging keys stay bound", async (t) => {
  const { v } = view({ refreshedAt: NOW, results: results(30) }, 12);
  t.after(() => v.dispose());
  await settle();
  const body = (): string => v.render(80).slice(1, 9).join("\n");
  const top = body();
  v.handleInput(PAGE_DOWN);
  assert.notEqual(body(), top, "PgDn pages");
  v.handleInput(PAGE_UP);
  assert.equal(body(), top, "PgUp pages back");
  assert.ok(!v.render(80).join("\n").includes("PgUp"), "paging is not advertised");
});

test("the pane shows the table with a refresh countdown and is sized to its content", async () => {
  const { v, asked } = view({ refreshedAt: NOW, results: results(3) });
  await settle();
  const lines = v.render(100);
  assert.ok(lines.length < 20, `the pane must not pad to full height: ${lines.length} lines`);
  assert.ok(lines.every((l) => visibleWidth(l) <= 100));
  assert.match(lines[0]!, /── tokemon ─.* refresh in 5:00/);
  assert.ok(lines.some((l) => l.includes("p02")));
  assert.deepEqual(asked, [300_000], "opening reuses a report younger than the refresh interval");
  v.dispose();
});

test("keys refresh, toggle models, scroll, and close", async () => {
  const { v, asked, closed } = view({ refreshedAt: NOW, results: results(30) }, 12);
  await settle();
  const first = v.render(80).slice(1, 9).join("\n");
  v.handleInput(PAGE_DOWN);
  assert.notEqual(v.render(80).slice(1, 9).join("\n"), first, "PgDn scrolled");
  v.handleInput("G");
  assert.ok(v.render(80).some((l) => l.includes("p29")));
  v.handleInput("m");
  v.handleInput("G");
  assert.ok(v.render(80).some((l) => l.includes("model-a, model-b [low, high]")));
  v.handleInput("r");
  await settle();
  assert.deepEqual(asked, [300_000, 0], "r forces a refresh");
  v.handleInput(ESC);
  assert.equal(closed(), true);
  v.dispose();
});

test("a failed refresh is shown, not swallowed", async () => {
  const v = new TokemonView({
    report: async () => {
      throw new Error("auth.json: unreadable JSON");
    },
    models: () => new Map(),
    now: () => NOW,
    rows: () => 10,
    requestRender: () => {},
    close: () => {},
    style: PLAIN_TABLE_STYLE,
    theme: PLAIN_THEME,
    refreshEveryMs: 300_000,
  });
  await settle();
  assert.ok(v.render(80).some((l) => l.includes("quota refresh failed: auth.json: unreadable JSON")));
  v.dispose();
});

test("the pane is framed: title rule with the refresh status, rule, and key hints", async () => {
  const { v } = view({ refreshedAt: NOW, results: results(2) });
  await settle();
  const lines = v.render(100);
  assert.match(lines[0]!, /^── tokemon ─+ updated \d\d:\d\d · refresh in 5:00 ──$/);
  assert.equal(visibleWidth(lines[0]!), 100);
  assert.equal(lines.at(-2), "─".repeat(100));
  assert.equal(lines.at(-1), "r refresh  i show invalid  m show models  ↑↓ scroll  esc close");
  v.handleInput("i");
  v.handleInput("m");
  assert.equal(v.render(100).at(-1), "r refresh  i hide invalid  m hide models  ↑↓ scroll  esc close");
  v.dispose();
});

test("wrapped key hints on a narrow terminal still fit the row budget", async () => {
  const rows = 12;
  const { v } = view({ refreshedAt: NOW, results: results(30) }, rows);
  await settle();
  const lines = v.render(50);
  assert.ok(lines.length <= rows, `${lines.length} lines for ${rows} rows`);
  assert.ok(lines.every((l) => visibleWidth(l) <= 50));
  assert.deepEqual(lines.slice(-2), ["r refresh  i show invalid  m show models", "↑↓ scroll  esc close"]);
  assert.equal(lines.at(-3), "─".repeat(50));
  v.dispose();
});

test("allocated fullscreen height preserves quota hints and uses the body's real viewport", async (t) => {
  const { VStack, Text } = await import("@earendil-works/pi-tui");
  const { renderLayoutFrame } = await import("@earendil-works/pi-tui/dist/layout.js");
  const { v } = view({ refreshedAt: NOW, results: results(30) }, 30);
  t.after(() => v.dispose());
  await settle();
  const root = new VStack([
    { component: new Text("transcript", 0, 0), shrink: 0 },
    { component: new Text("top badge", 0, 0), shrink: 0 },
    { component: v, shrink: 1 },
    { component: new Text("bottom badge\nPi status", 0, 0), shrink: 0 },
  ]);
  const frame = () => renderLayoutFrame(root, 48, 18, () => {}).lines;
  assert.match(frame().join("\n"), /esc close/, "actual allocation must keep the close hints visible");
  v.handleInput("G");
  assert.match(frame().join("\n"), /29%/, "End reaches the real last quota row");
  assert.equal(frame().at(-1)!.trimEnd(), "Pi status");
  v.handleInput("m");
  frame();
  v.handleInput("G");
  assert.match(frame().join("\n"), /model-a, model-b/);
  assert.match(renderLayoutFrame(root, 80, 30, () => {}).lines.join("\n"), /esc close/);
  renderLayoutFrame(root, 48, 12, () => {});
  v.handleInput("G");
  const shrunk = renderLayoutFrame(root, 48, 12, () => {}).lines.join("\n");
  assert.match(shrunk, /model-a, model-b/);
  assert.match(shrunk, /esc close/);
});
