import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { quotaWindow } from "../src/quota.ts";
import type { QueryResult } from "../src/service.ts";
import { quotaLine } from "../src/status.ts";
import { PLAIN_TABLE_STYLE, type TableStyle } from "../src/table.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const hour = 3600_000;
const plainLine = (...args: Parameters<typeof quotaLine>): string | null => quotaLine(...args)?.(PLAIN_TABLE_STYLE) ?? null;

function result(provider: string, windows: ReturnType<typeof quotaWindow>[], extra: Partial<QueryResult> = {}): QueryResult {
  return {
    target: { provider, origin: "auth.json", label: "~/.pi/agent/auth.json", credential: null, note: null },
    snapshot: { plan: "pro", identity: "user@example.test", windows, note: null },
    error: null,
    fetchedAt: NOW,
    rateLimited: false,
    retryAt: null,
    ...extra,
  };
}

test("the quota line shows every limited window with a short bar", () => {
  const text = plainLine("zai", [
    result("zai", [
      quotaWindow("primary (5h)", 30, 100, "%", new Date(NOW.getTime() + 90 * 60_000)),
      quotaWindow("weekly (7d)", 10, 100, "%", new Date(NOW.getTime() + 3 * 24 * hour + 5 * hour + 40 * 60_000)),
    ]),
  ], NOW);
  assert.equal(text, "zai {5h/1:30 [██░░░ 30%]} {7d/3d:05:40 [█░░░░ 10%]}");
});

test("windows without a reset or fraction still read compactly", () => {
  assert.equal(
    plainLine("zai", [result("zai", [quotaWindow("5h", 30, 100, "%", null)])], NOW),
    "zai {5h [██░░░ 30%]}",
  );
  assert.equal(
    plainLine("zai", [result("zai", [quotaWindow("credits", null, 2000, "credits", null)])], NOW),
    "zai {credits/2000}",
  );
});

test("unlimited, errors, and unknown providers clear the status", () => {
  assert.equal(plainLine("zai", [result("zai", [{ ...quotaWindow("chat", null, null, "requests", null), unlimited: true }])], NOW), "zai unlimited");
  assert.equal(plainLine("zai", [result("zai", [], { snapshot: null, error: "QuotaFetchError: x" })], NOW), null);
  assert.equal(plainLine("zai", [result("zai", [], { rateLimited: true, retryAt: null, error: "rate limited" })], NOW), null);
  assert.equal(plainLine("zai", [result("zai", [])], NOW), null);
  assert.equal(plainLine("anthropic", [result("zai", [quotaWindow("w", 1, 100, "%", null)])], NOW), null);
});

const TAG_STYLE: TableStyle = {
  provider: (p, s) => `<${p}>${s}</${p}>`,
  bold: (s) => `<b>${s}</b>`,
  dim: (s) => `<dim>${s}</dim>`,
  success: (s) => `<success>${s}</success>`,
  warning: (s) => `<warning>${s}</warning>`,
  error: (s) => `<error>${s}</error>`,
};

test("border bars take their window state's colour; the empty run is dim and the text is unchanged", () => {
  const results = [result("zai", [
    quotaWindow("primary (5h)", 38, 100, "%", new Date(NOW.getTime() + 90 * 60_000)),
    quotaWindow("weekly (7d)", 93, 100, "%", null),
    quotaWindow("monthly (1mo)", 100, 100, "%", null),
  ])];
  assert.equal(
    quotaLine("zai", results, NOW)!(TAG_STYLE),
    "zai {5h/1:30 [<success>██</success><dim>░░░</dim> 38%]} {7d [<warning>█████</warning> 93%]} {1mo [<error>█████</error> 100%]}",
  );
  assert.equal(plainLine("zai", results, NOW), "zai {5h/1:30 [██░░░ 38%]} {7d [█████ 93%]} {1mo [█████ 100%]}");
});

test("the stale marker keeps its text when coloured", () => {
  const stale = result("zai", [quotaWindow("5h", 0, 100, "%", null)], { quotaCache: { fetchedAt: new Date(NOW.getTime() - 10 * 60_000), retryAt: NOW } });
  const coloured = quotaLine("zai", [stale], NOW)!(TAG_STYLE);
  assert.equal(coloured.replace(/<\/?[a-z]+>/g, ""), plainLine("zai", [stale], NOW));
  assert.match(coloured, / ⚠ stale 10m$/);
  assert.match(coloured, /<dim>░░░░░<\/dim>/);
});
