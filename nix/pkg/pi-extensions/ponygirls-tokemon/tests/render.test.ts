import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatAmount, formatResets, formatUsedLimit, usageBar, windowState } from "../src/format.ts";
import { quotaWindow, type QuotaWindow } from "../src/quota.ts";
import { toolReport } from "../src/report.ts";
import type { QueryResult } from "../src/service.ts";
import { buildTable, PLAIN_TABLE_STYLE } from "../src/table.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const win = (name: string, used: number | null, limit: number | null, unit: string, resetsAt: Date | null = null): QuotaWindow => quotaWindow(name, used, limit, unit, resetsAt);

function result(provider: string, windows: QuotaWindow[], over: Partial<QueryResult> = {}, identity: string | null = null): QueryResult {
  return {
    target: { provider, origin: "auth.json", label: "~/.pi/agent/auth.json", credential: null, note: null },
    snapshot: { plan: "lite", identity, windows, note: null },
    error: null,
    fetchedAt: NOW,
    rateLimited: false,
    retryAt: null,
    ...over,
  };
}

test("amounts, used/limit, bars, and resets read like tokemon's", () => {
  assert.deepEqual([formatAmount(12500000, "tokens"), formatAmount(3.5, "USD"), formatAmount(42.25, "%"), formatAmount(12.9, "requests"), formatAmount(null, "USD")], ["12.5M", "$3.50", "42.3%", "12", "—"]);
  assert.deepEqual([formatUsedLimit(win("w", 12.4, 100, "%")), formatUsedLimit(win("w", 3.5, 25, "USD")), formatUsedLimit(win("w", null, 10, "USD")), formatUsedLimit({ ...win("w", null, null, "requests"), unlimited: true })], ["12%", "$3.50 / $25.00", "$10.00", "unlimited"]);
  assert.deepEqual([usageBar(win("w", 50, 100, "%")), usageBar(win("w", 150, 100, "%")), usageBar(win("w", -5, 100, "%")), usageBar(win("w", null, 100, "%"))], ["█████░░░░░", "██████████", "░░░░░░░░░░", "—"]);
  const inHours = new Date(NOW.getTime() + (2 * 3600 + 5 * 60) * 1000);
  const inDays = new Date(NOW.getTime() + (3 * 86400 + 4 * 3600) * 1000);
  assert.deepEqual([formatResets(win("w", 1, 2, "%", inHours), NOW), formatResets(win("w", 1, 2, "%", inDays), NOW), formatResets(win("w", 1, 2, "%", NOW), NOW)], ["2h 05m", "3d 4h", "reset due"]);
  assert.deepEqual([windowState(win("w", 95, 100, "%")), windowState(win("w", 100, 100, "%")), windowState(win("w", 10, 100, "%")), windowState({ ...win("w", null, null, "%"), unlimited: true })], ["low", "EXHAUSTED", "ok", "unlimited"]);
});

test("the table stacks windows per account, sorts by provider, and hides rows without quota data", () => {
  const results = [
    result("zai", [win("tokens (5h)", 12, 100, "%"), win("MCP (1mo)", 10, 100, "calls")]),
    result("kimi-coding", [win("weekly", 37, 100, "units")], {}, "me@example.test"),
    result("xiaomi", [], { snapshot: { plan: null, identity: null, windows: [], note: "no quota endpoint" } }),
    result("minimax", [], { snapshot: null, error: "QuotaFetchError: HTTP 500" }),
  ];
  const table = buildTable(results, NOW, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE);
  const text = table.lines.join("\n");
  assert.ok(text.indexOf("kimi-coding") < text.indexOf("zai") && !text.includes("xiaomi") && !text.includes("minimax"), text);
  assert.ok(text.includes("tokens (5h)") && text.includes("MCP (1mo)") && text.includes("me@example.test"));
  assert.equal(table.caption, "2 rows hidden: 1 error, 1 without quota data");
  const all = buildTable(results, NOW, { showInvalid: true, width: null }, PLAIN_TABLE_STYLE);
  assert.ok(all.lines.join("\n").includes("QuotaFetchError: HTTP 500") && all.caption === null);
});

test("a narrow terminal hides locations, then Plan and Provider, and fits every line", () => {
  const results = [result("zai", [win("tokens (5h)", 12, 100, "%")], { snapshot: { plan: "lite", identity: null, windows: [win("tokens (5h)", 12, 100, "%")], note: "a long provider note that makes the status column wide" } })];
  const wide = buildTable(results, NOW, { showInvalid: false, width: null }, PLAIN_TABLE_STYLE);
  assert.ok(wide.lines.some((l) => l.includes("~/.pi/agent/auth.json")));
  for (const width of [110, 80, 60]) {
    const t = buildTable(results, NOW, { showInvalid: false, width }, PLAIN_TABLE_STYLE);
    assert.ok(t.lines.every((l) => visibleWidth(l) <= width), `${width}:\n${t.lines.join("\n")}`);
    assert.ok(!t.lines.some((l) => l.includes("~/.pi/agent/auth.json")));
  }
  assert.match(buildTable(results, NOW, { showInvalid: false, width: 60 }, PLAIN_TABLE_STYLE).caption ?? "", /columns hidden: Plan, Provider/);
});

test("a long status wraps beside its own window before any column is hidden", () => {
  const note = "team seat: usage bills the team's credits (see the management key)";
  const results = [result("xai", [], { snapshot: { plan: "lite", identity: null, windows: [win("primary", 10, 100, "%"), win("weekly", 95, 100, "%")], note } })];
  const t = buildTable(results, NOW, { showInvalid: false, width: 100 }, PLAIN_TABLE_STYLE);
  const text = t.lines.join("\n");
  assert.equal(t.caption, "provider locations hidden");
  assert.ok(t.lines.every((l) => visibleWidth(l) <= 100), text);
  assert.ok(text.includes("xai") && text.includes("lite") && text.includes("management key)") && !text.includes("…"), text);
  assert.match(t.lines.find((l) => l.includes("weekly")) ?? "", /\blow$/, text);
});

test("Status wraps between words: Plan is hidden rather than splitting a word", () => {
  const results = [result("zai", [], { snapshot: { plan: "Muse Code High Usage", identity: null, windows: [win("chat", 10, 100, "%")], note: "free_engaged_oss_quota" } })];
  const t = buildTable(results, NOW, { showInvalid: false, width: 110 }, PLAIN_TABLE_STYLE);
  assert.ok(t.lines.some((l) => l.endsWith("ok · free_engaged_oss_quota")), t.lines.join("\n"));
  assert.equal(t.caption, "provider locations hidden · columns hidden: Plan");
});

test("the tool report lists every provider with window states, errors, and optional models", () => {
  const reset = new Date(NOW.getTime() + 3600_000);
  const report = toolReport(
    { refreshedAt: NOW, results: [result("zai", [win("tokens (5h)", 95, 100, "%", reset)]), result("meta", [], { snapshot: null, rateLimited: true, retryAt: new Date(NOW.getTime() + 90_000), error: "rate limited" })] },
    NOW,
    { models: new Map([["zai", [{ id: "glm-5.3", efforts: ["off"] }, { id: "glm-4.6", efforts: ["low", "high"] }]]]), quotas: true, context: null },
  );
  assert.deepEqual(report.providers.map((p) => [p.provider, p.windows.map((w) => [w.name, w.state, w.resetsIn]), p.error, p.rateLimited]), [
    ["meta", [], "rate limited (429) · retry in 1m 30s", true],
    ["zai", [["tokens (5h)", "low", "1h 00m"]], null, false],
  ]);
  assert.deepEqual(report.models, { zai: [{ id: "glm-4.6", efforts: ["low", "high"] }, { id: "glm-5.3", efforts: ["off"] }] });
  assert.equal(toolReport({ refreshedAt: NOW, results: [] }, NOW, { models: null, quotas: true, context: null }).models, undefined);
});
