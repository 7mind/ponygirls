import assert from "node:assert/strict";
import test from "node:test";
import { adapterFor, hasQuotaAdapter } from "../src/adapters/index.ts";
import { CodexQuota } from "../src/adapters/codex.ts";
import { QuotaFetchError, RateLimitedError, type QuotaSnapshot } from "../src/quota.ts";
import { QuotaService } from "../src/service.ts";
import { toolReport } from "../src/report.ts";
import { API_KEY, OAUTH, ScriptedHttp, json } from "./scripted-http.ts";

// Specified behavioral tests with synthetic public-schema inputs; no enterprise credentials.
const CODEX = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE = "https://api.anthropic.com/api/oauth";
const RESET = 1778137680;
const monthly = { limit: "25000", used: "8000", remaining: "17000", used_percent: 32, remaining_percent: 68, reset_at: RESET };
const codex = (body: unknown): Promise<QuotaSnapshot> => new CodexQuota().fetch(OAUTH, new ScriptedHttp([["GET", CODEX, json(200, body)]]));
const profile = (plan: string) => ({ account: { email: "member@example.invalid" }, organization: { organization_type: plan } });
const claude = (body: unknown, plan: string): Promise<QuotaSnapshot> => adapterFor("anthropic").fetch(OAUTH, new ScriptedHttp([
  ["GET", `${CLAUDE}/usage`, json(200, body)], ["GET", `${CLAUDE}/profile`, json(200, profile(plan))],
]));
const money = (amount: number) => ({ amount_minor: amount, currency: "USD", exponent: 2 });

// BA regression: credit availability can be exposed without any numeric quota.
test("codex business: available credits with undisclosed balance are not a fetch error", async () => {
  const s = await codex({ plan_type: "business", rate_limit: null, code_review_rate_limit: null, additional_rate_limits: null,
    credits: { has_credits: true, unlimited: false, overage_limit_reached: false, balance: null, approx_local_messages: null, approx_cloud_messages: null },
    spend_control: { reached: false, individual_limit: null } });
  assert.equal(s.plan, "business");
  assert.deepEqual(s.windows, []);
  assert.equal(s.note, "credits available (balance unavailable)");
  for (const has_credits of [null, "true", 1]) {
    await assert.rejects(codex({ credits: { has_credits, balance: null } }), QuotaFetchError);
  }
});

test("codex enterprise: monthly credit allowance without rolling windows", async () => {
  const http = new ScriptedHttp([["GET", CODEX, json(200, { plan_type: "enterprise", spend_control: { reached: false, individual_limit: monthly } })]]);
  const s = await new CodexQuota().fetch({ ...OAUTH, accountId: "workspace" }, http);
  assert.equal(s.plan, "enterprise");
  assert.equal(s.windows.length, 1);
  assert.deepEqual(s.windows[0], { name: "monthly credits", used: 8000, limit: 25000, unit: "credits", resetsAt: new Date(RESET * 1000), unlimited: false, exhausted: null });
  assert.equal(http.headers[0]!["ChatGPT-Account-Id"], "workspace");
});

test("codex enterprise: monthly cap, rolling quota and credit balance stay separate", async () => {
  const s = await codex({ spend_control: { reached: true, individual_limit: monthly }, rate_limit: { primary_window: { used_percent: 4 } }, credits: { balance: "120" } });
  assert.deepEqual(s.windows.map((w) => [w.name, w.used, w.limit]), [["primary", 4, 100], ["monthly credits", 8000, 25000], ["credits", null, 120]]);
  assert.equal(s.windows.find((w) => w.name === "monthly credits")!.exhausted, true);
  assert.equal(s.windows[0]!.exhausted, null);
});

test("codex enterprise: zero is reported, absent or malformed data is not zero/unlimited", async () => {
  const s = await codex({ spend_control: { individual_limit: { used: "0", limit: "0" } } });
  assert.deepEqual([s.windows[0]!.used, s.windows[0]!.limit, s.windows[0]!.unlimited], [0, 0, false]);
  for (const individual_limit of [null, {}, { limit: "25000" }, { used: false, limit: "NaN" }, { used: "5", limit: "garbage" }, { used: -1, limit: -5 }]) {
    await assert.rejects(codex({ plan_type: "enterprise", spend_control: { individual_limit } }), QuotaFetchError);
  }
  const partial = await codex({ spend_control: { individual_limit: { used: "8" } } });
  assert.deepEqual([partial.windows[0]!.used, partial.windows[0]!.limit, partial.windows[0]!.unlimited], [8, null, false]);
});

test("codex enterprise: invalid resets remain unknown and do not corrupt the report", async () => {
  for (const reset_at of ["NaN", "Infinity", -1, 1e100]) {
    const s = await codex({ spend_control: { individual_limit: { ...monthly, reset_at } } });
    assert.equal(s.windows[0]!.resetsAt, null);
  }
});

test("claude enterprise: adapter is registered and parses spend-only payload", async () => {
  assert.equal(hasQuotaAdapter("anthropic"), true);
  const s = await claude({ limits: [], spend: { enabled: true, used: money(5732), limit: money(150000), resets_at: "2026-11-01T00:00:00Z" } }, "enterprise");
  assert.deepEqual([s.plan, s.identity, s.note], ["enterprise", "member@example.invalid", null]);
  assert.deepEqual(s.windows.map((w) => [w.name, w.used, w.limit, w.unit, w.resetsAt?.toISOString(), w.unlimited]), [["extra usage", 57.32, 1500, "USD", "2026-11-01T00:00:00.000Z", false]]);
});

test("claude: modern limits preserve scope, and modern spend wins over legacy", async () => {
  const s = await claude({ limits: [{ kind: "weekly_scoped", percent: 42, scope: { model: { display_name: "Opus" } }, resets_at: "2026-11-01T00:00:00Z" }], spend: { enabled: true, used: money(0), limit: money(0) }, extra_usage: { is_enabled: true, used_credits: 8000, monthly_limit: 9000 } }, "enterprise");
  assert.deepEqual(s.windows.map((w) => [w.name, w.used, w.limit]), [["weekly (7d) Opus", 42, 100], ["extra usage", 0, 0]]);
});

test("claude enterprise: legacy extra_usage cents and unknown limit", async () => {
  const s = await claude({ extra_usage: { is_enabled: true, used_credits: 5732, monthly_limit: 150000 } }, "claude_enterprise");
  assert.deepEqual(s.windows.map((w) => [w.name, w.used, w.limit, w.unit]), [["extra usage", 57.32, 1500, "USD"]]);
  const partial = await claude({ spend: { enabled: true, used: money(0), limit: null } }, "enterprise");
  assert.deepEqual([partial.windows[0]!.used, partial.windows[0]!.limit, partial.windows[0]!.unlimited], [0, null, false]);
});

test("claude enterprise: unavailable spend is explicit, even with rolling windows", async () => {
  for (const spend of [null, { enabled: false, used: money(0), limit: null }, { enabled: true, used: { amount_minor: false, currency: "USD", exponent: 2 } }]) {
    const s = await claude({ spend }, "enterprise");
    assert.deepEqual(s.windows, []);
    assert.equal(s.note, "enterprise spend unavailable through OAuth");
  }
  const s = await claude({ limits: [{ kind: "session", percent: 5 }] }, "enterprise");
  assert.equal(s.windows.length, 1);
  assert.equal(s.note, "enterprise spend unavailable through OAuth");
  await assert.rejects(claude({}, "pro"), QuotaFetchError);
});

test("claude enterprise: legacy rolling windows are a fallback, not duplicates", async () => {
  const legacy = { five_hour: { utilization: 30 }, seven_day: { utilization: 42 } };
  const s = await claude(legacy, "enterprise");
  assert.deepEqual(s.windows.map((w) => [w.name, w.used]), [["session (5h)", 30], ["weekly (7d)", 42]]);
  const modern = await claude({ ...legacy, limits: [{ kind: "session", percent: 12 }] }, "enterprise");
  assert.deepEqual(modern.windows.map((w) => [w.name, w.used]), [["session (5h)", 12]]);
});

test("claude enterprise: currencies are not mixed and invalid amounts are not fabricated", async () => {
  const mixed = await claude({ spend: { enabled: true, used: money(100), limit: { ...money(900), currency: "EUR" } } }, "enterprise");
  assert.deepEqual([mixed.windows[0]!.used, mixed.windows[0]!.limit, mixed.windows[0]!.unit], [1, null, "USD"]);
  for (const amount of [false, "Infinity", -1, "garbage"]) {
    const s = await claude({ spend: { enabled: true, used: { ...money(1), amount_minor: amount } }, extra_usage: { is_enabled: true, used_credits: amount, monthly_limit: 150000 } }, "enterprise");
    assert.deepEqual(s.windows, []);
    assert.equal(s.note, "enterprise spend unavailable through OAuth");
  }
});

test("enterprise: pi resolves the current Claude OAuth token and reports monthly credits unchanged", async () => {
  const http = new ScriptedHttp([
    ["GET", `${CLAUDE}/usage`, json(200, { spend: { enabled: true, used: money(5732), limit: money(150000) } })],
    ["GET", `${CLAUDE}/profile`, json(200, profile("enterprise"))],
    ["GET", CODEX, json(200, { plan_type: "enterprise", spend_control: { reached: true, individual_limit: monthly } })],
  ]);
  const now = new Date("2026-05-01T00:00:00Z");
  const asked: string[] = [];
  const service = new QuotaService({
    discover: () => ["anthropic", "openai-codex"].map((provider) => ({ provider, origin: "auth.json" as const, label: "auth.json", credential: OAUTH, note: null })),
    http, now: () => now,
  });
  const report = await service.report({ apiKey: async (provider) => { asked.push(provider); return `fresh-${provider}`; } }, 0);
  assert.deepEqual(asked.sort(), ["anthropic", "openai-codex"]);
  assert.ok(report.results.every((r) => r.error === null));
  for (let i = 0; i < http.calls.length; i++) {
    assert.equal(http.headers[i]!["Authorization"], http.calls[i]![1].startsWith(CLAUDE) ? "Bearer fresh-anthropic" : "Bearer fresh-openai-codex");
  }
  const body = toolReport(report, now, { quotas: true, models: null, context: null });
  const monthlyRow = body.providers.find((p) => p.provider === "openai-codex")!.windows![0]!;
  assert.deepEqual([monthlyRow.name, monthlyRow.used, monthlyRow.limit, monthlyRow.state], ["monthly credits", 8000, 25000, "EXHAUSTED"]);
});

test("claude: API key never queries subscription endpoints; rejection and throttling propagate", async () => {
  const http = new ScriptedHttp([]);
  const s = await adapterFor("anthropic").fetch(API_KEY, http);
  assert.equal(s.note, "API key: no plan quota endpoint");
  assert.deepEqual(http.calls, []);
  for (const [status, error] of [[401, QuotaFetchError], [429, RateLimitedError]] as const) {
    await assert.rejects(adapterFor("anthropic").fetch(OAUTH, new ScriptedHttp([["GET", `${CLAUDE}/usage`, json(status, {}, "60")]])), error);
  }
});
