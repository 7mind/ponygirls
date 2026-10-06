import assert from "node:assert/strict";
import test from "node:test";
import { quotaWindow } from "../src/quota.ts";
import type { QueryResult } from "../src/service.ts";
import { statusSummary } from "../src/status.ts";

const NOW = new Date("2026-10-06T12:00:00Z");

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

test("the status names the tightest window with its reset", () => {
  const text = statusSummary("zai", [
    result("zai", [quotaWindow("tokens (5h)", 10, 100, "%", null), quotaWindow("tokens (7d)", 95, 100, "%", new Date(NOW.getTime() + 2 * 3600_000 + 22 * 60_000))]),
  ], NOW);
  assert.equal(text, "zai tokens (7d) 95% · resets 2h 22m");
});

test("unlimited, errors, and unknown providers clear the status", () => {
  assert.equal(statusSummary("zai", [result("zai", [{ ...quotaWindow("chat", null, null, "requests", null), unlimited: true }])], NOW), "zai chat unlimited");
  assert.equal(statusSummary("zai", [result("zai", [], { snapshot: null, error: "QuotaFetchError: x" })], NOW), null);
  assert.equal(statusSummary("zai", [result("zai", [], { rateLimited: true, retryAt: null, error: "rate limited" })], NOW), null);
  assert.equal(statusSummary("anthropic", [result("zai", [quotaWindow("w", 1, 100, "%", null)])], NOW), null);
});

test("a window without a reset shows no resets suffix", () => {
  assert.equal(statusSummary("zai", [result("zai", [quotaWindow("credits", null, 2000, "credits", null)])], NOW), "zai credits 2000");
});
