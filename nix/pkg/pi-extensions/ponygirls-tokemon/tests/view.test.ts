import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { quotaWindow } from "../src/quota.ts";
import type { QueryResult, QuotaReport } from "../src/service.ts";
import { PLAIN_TABLE_STYLE } from "../src/table.ts";
import { TokemonView } from "../src/view.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const ESC = "\x1b";
const PAGE_DOWN = "\x1b[6~";

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
    models: () => new Map([["p00", ["model-a", "model-b"]]]),
    now: () => NOW,
    rows: () => rows,
    requestRender: () => {},
    close: () => { closed = true; },
    style: PLAIN_TABLE_STYLE,
    refreshEveryMs: 300_000,
  });
  return { v, asked, closed: () => closed };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("the pane shows the table with a refresh countdown and fits the terminal", async () => {
  const { v, asked } = view({ refreshedAt: NOW, results: results(3) });
  await settle();
  const lines = v.render(100);
  v.dispose();
  assert.equal(lines.length, 20);
  assert.ok(lines.every((l) => visibleWidth(l) <= 100));
  assert.match(lines[0]!, /tokemon — token quotas .* next refresh in 5:00/);
  assert.ok(lines.some((l) => l.includes("p02")));
  assert.deepEqual(asked, [300_000], "opening reuses a report younger than the refresh interval");
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
  assert.ok(v.render(80).some((l) => l.includes("model-a, model-b")));
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
    refreshEveryMs: 300_000,
  });
  await settle();
  assert.ok(v.render(80).some((l) => l.includes("quota refresh failed: auth.json: unreadable JSON")));
  v.dispose();
});
