import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { quotaWindow } from "../src/quota.ts";
import type { QueryResult } from "../src/service.ts";
import { widgetBorderLine, widgetLine } from "../src/status.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const hour = 3600_000;

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

test("the widget shows every limited window with a short bar", () => {
  const text = widgetLine("zai", [
    result("zai", [
      quotaWindow("primary (5h)", 30, 100, "%", new Date(NOW.getTime() + 90 * 60_000)),
      quotaWindow("weekly (7d)", 10, 100, "%", new Date(NOW.getTime() + 3 * 24 * hour + 5 * hour + 40 * 60_000)),
    ]),
  ], NOW);
  assert.equal(text, "zai {5h/1:30 [██░░░ 30%]} {7d/3d:05:40 [█░░░░ 10%]}");
});

test("windows without a reset or fraction still read compactly", () => {
  assert.equal(
    widgetLine("zai", [result("zai", [quotaWindow("5h", 30, 100, "%", null)])], NOW),
    "zai {5h [██░░░ 30%]}",
  );
  assert.equal(
    widgetLine("zai", [result("zai", [quotaWindow("credits", null, 2000, "credits", null)])], NOW),
    "zai {credits/2000}",
  );
});

test("the border line pads the quota text with dashes to full width", () => {
  const plain = { border: (s: string) => s };
  const D = "─";
  assert.equal(widgetBorderLine("ab", 12, plain), `${D}${D} ab ${D.repeat(6)}`);
  const full = widgetBorderLine("openai-codex {7d/5d:21:46 [██░░░ 2%]}", 46, plain);
  assert.equal([...full].length, 46);
  assert.ok(full.startsWith(`${D}${D} openai-codex`));
});

test("the border line truncates rather than overflow", () => {
  // truncateToWidth wraps the ellipsis in resets, so measure cells, not chars.
  const out = widgetBorderLine("abcdefghij", 8, { border: (s: string) => s });
  assert.equal(visibleWidth(out), 8);
  assert.ok(out.includes("…"));
});

test("unlimited, errors, and unknown providers clear the widget", () => {
  assert.equal(widgetLine("zai", [result("zai", [{ ...quotaWindow("chat", null, null, "requests", null), unlimited: true }])], NOW), "zai unlimited");
  assert.equal(widgetLine("zai", [result("zai", [], { snapshot: null, error: "QuotaFetchError: x" })], NOW), null);
  assert.equal(widgetLine("zai", [result("zai", [], { rateLimited: true, retryAt: null, error: "rate limited" })], NOW), null);
  assert.equal(widgetLine("zai", [result("zai", [])], NOW), null);
  assert.equal(widgetLine("anthropic", [result("zai", [quotaWindow("w", 1, 100, "%", null)])], NOW), null);
});
