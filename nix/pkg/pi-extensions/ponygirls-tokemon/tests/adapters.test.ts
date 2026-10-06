/**
 * Adapter tests over a scripted Http, ported from tokemon's test_adapters.py
 * (fixture origins are documented there; the fixtures are copied unchanged).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CodexQuota } from "../src/adapters/codex.ts";
import { CopilotQuota } from "../src/adapters/copilot.ts";
import { KimiQuota } from "../src/adapters/kimi.ts";
import { MetaQuota, MUSE_KEY_URL } from "../src/adapters/meta.ts";
import { MinimaxQuota } from "../src/adapters/minimax.ts";
import { OpenRouterQuota } from "../src/adapters/openrouter.ts";
import { VercelGatewayQuota } from "../src/adapters/vercel.ts";
import { XaiManagementQuota, XaiQuota } from "../src/adapters/xai.ts";
import { ZaiQuota } from "../src/adapters/zai.ts";
import { QuotaFetchError, RateLimitedError, type QuotaSnapshot, type QuotaWindow } from "../src/quota.ts";
import { API_KEY, META_OAUTH, OAUTH, ScriptedHttp, at, fixture, json, type Route } from "./scripted-http.ts";

const rows = (s: QuotaSnapshot): Array<[string, number | null, number | null, string]> => s.windows.map((w) => [w.name, w.used, w.limit, w.unit]);
const byName = (s: QuotaSnapshot): Map<string, QuotaWindow> => new Map(s.windows.map((w) => [w.name, w]));

// -- Codex -----------------------------------------------------------------------------------

const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const codex = (payload: unknown): Promise<QuotaSnapshot> => new CodexQuota().fetch(OAUTH, new ScriptedHttp([["GET", CODEX_URL, json(200, payload)]]));

test("codex: the observed schema", async () => {
  const s = await codex(fixture("codex_wham_usage.json"));
  assert.deepEqual([s.plan, s.identity, s.note], ["pro", "<email>", "resets: 0"]);
  assert.deepEqual(rows(s), [["primary (7d)", 91, 100, "%"], ["credits", null, 0, "credits"]]);
  assert.equal(byName(s).get("primary (7d)")!.resetsAt?.toISOString(), at(1791104309));
});

test("codex: null windows are skipped; the account id goes in a header when known", async () => {
  const payload = fixture("codex_wham_usage.json");
  payload["rate_limit"]["primary_window"] = null;
  payload["rate_limit"]["secondary_window"] = null;
  assert.deepEqual(rows(await codex(payload)).map(([name]) => name), ["credits"]);
  const http = new ScriptedHttp([["GET", CODEX_URL, json(200, fixture("codex_wham_usage.json"))]]);
  await new CodexQuota().fetch({ ...OAUTH, accountId: "acc-1" }, http);
  assert.deepEqual([http.headers[0]!["Authorization"], http.headers[0]!["ChatGPT-Account-Id"]], ["Bearer test-access", "acc-1"]);
  const bare = new ScriptedHttp([["GET", CODEX_URL, json(200, fixture("codex_wham_usage.json"))]]);
  await new CodexQuota().fetch(OAUTH, bare);
  assert.equal(bare.headers[0]!["ChatGPT-Account-Id"], undefined);
});

test("codex: chatpass, code review, and additional rate limits are windows", async () => {
  const payload = fixture("codex_wham_usage.json");
  payload["chatpass"] = { windows: [{ used_percent: 7, limit_window_seconds: 604800, reset_after_seconds: 604800, reset_at: 1791458686 }] };
  payload["code_review_rate_limit"] = { allowed: true, limit_reached: false, primary_window: { used_percent: 33, limit_window_seconds: 604800, reset_at: 1791104309 }, secondary_window: null };
  payload["additional_rate_limits"] = [{ limit_name: "codex_other", metered_feature: "codex_other", rate_limit: { allowed: true, limit_reached: true, primary_window: { used_percent: 100, limit_window_seconds: 900, reset_at: 1791104309 }, secondary_window: { used_percent: 84, limit_window_seconds: 3600, reset_at: 1791104309 } } }];
  const windows = byName(await codex(payload));
  assert.deepEqual([windows.get("chatpass (7d)")!.used, windows.get("code review (7d)")!.used], [7, 33]);
  assert.equal(windows.get("codex_other (15m)")!.exhausted, true);
  assert.equal(windows.get("codex_other (1h)")!.used, 84);
});

test("codex: no quota data and auth rejection raise", async () => {
  await assert.rejects(codex({ plan_type: "pro" }), QuotaFetchError);
  await assert.rejects(new CodexQuota().fetch(OAUTH, new ScriptedHttp([["GET", CODEX_URL, json(401, { detail: "expired" })]])), QuotaFetchError);
});

// -- Copilot -------------------------------------------------------------------------------

const COPILOT_URL = "https://api.github.com/copilot_internal/user";
const copilot = (payload: unknown): Promise<QuotaSnapshot> => new CopilotQuota().fetch(OAUTH, new ScriptedHttp([["GET", COPILOT_URL, json(200, payload)]]));

test("copilot: the observed schema", async () => {
  const payload = fixture("copilot_user.json");
  const s = await copilot(payload);
  assert.deepEqual([s.plan, s.identity, s.note], ["individual", payload["login"], "free_engaged_oss_quota"]);
  const premium = byName(s).get("AI credits")!;
  assert.deepEqual([premium.used, premium.limit, premium.unit, premium.resetsAt?.toISOString()], [1350, 1500, "credits", "2026-10-01T00:00:00.000Z"]);
  assert.equal(byName(s).get("chat")!.unlimited, true);
  assert.equal(byName(s).get("completions")!.unlimited, true);
});

test("copilot: request-based billing keeps premium requests; quota_reset_at wins over the body date", async () => {
  const payload = fixture("copilot_user.json");
  payload["quota_snapshots"]["premium_interactions"]["token_based_billing"] = false;
  assert.equal(byName(await copilot(payload)).get("premium requests")!.unit, "requests");
  const reset = fixture("copilot_user.json");
  reset["quota_snapshots"]["premium_interactions"]["quota_reset_at"] = 1791104309;
  assert.equal(byName(await copilot(reset)).get("AI credits")!.resetsAt?.toISOString(), at(1791104309));
});

test("copilot: authenticates with the GitHub OAuth token (refresh), not the session token", async () => {
  const http = new ScriptedHttp([["GET", COPILOT_URL, json(200, fixture("copilot_user.json"))]]);
  await new CopilotQuota().fetch(OAUTH, http);
  assert.equal(http.headers[0]!["Authorization"], "Bearer test-refresh");
});

// -- Z.ai ----------------------------------------------------------------------------------

const ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const zai = (payload: unknown): Promise<QuotaSnapshot> => new ZaiQuota().fetch(API_KEY, new ScriptedHttp([["GET", ZAI_URL, json(200, payload)]]));

test("zai: an account without a plan is a note", async () => {
  const s = await zai(fixture("zai_no_coding_plan.json"));
  assert.deepEqual([s.windows, s.note], [[], "当前用户不存在coding plan"]);
});

test("zai: the limits list, with the 5h and weekly token limits kept apart", async () => {
  const s = await zai(fixture("zai_limits.json"));
  const tokens = byName(s).get("tokens (5h)")!;
  assert.deepEqual([tokens.used, tokens.limit, tokens.unit, tokens.resetsAt?.toISOString()], [12500000, 40000000, "tokens", at(1790866800)]);
  const weekly = byName(s).get("tokens (7d)")!;
  assert.deepEqual([weekly.used, weekly.limit, weekly.unit], [12, 100, "%"]);
  assert.equal(byName(s).get("MCP (1mo)")!.unit, "calls");
  assert.deepEqual([s.windows.length, s.plan], [3, null]);
});

test("zai: plan level shown; used derived from remaining; credit limits named; bare token sent", async () => {
  const payload = fixture("zai_limits.json");
  payload["data"]["level"] = "lite";
  const s = await zai(payload);
  assert.deepEqual([s.plan, s.identity], ["lite", null]);
  const credit = fixture("zai_limits.json");
  delete credit["data"]["limits"][0]["currentValue"];
  credit["data"]["limits"][0]["type"] = "CREDIT_LIMIT";
  assert.deepEqual(rows(await zai(credit))[0], ["credits (5h)", 12500000, 40000000, "credits"]);
  const http = new ScriptedHttp([["GET", ZAI_URL, json(200, fixture("zai_no_coding_plan.json"))]]);
  await new ZaiQuota().fetch(API_KEY, http);
  assert.equal(http.headers[0]!["Authorization"], "test-key");
});

// -- MiniMax -------------------------------------------------------------------------------

const MINIMAX_URL = "https://api.minimax.io/v1/token_plan/remains";
const minimax = (payload: unknown): Promise<QuotaSnapshot> => new MinimaxQuota().fetch(OAUTH, new ScriptedHttp([["GET", MINIMAX_URL, json(200, payload)]]));

test("minimax: null model_remains is a note; usage_count is the REMAINING quota", async () => {
  assert.equal((await minimax(fixture("minimax_remains_null.json"))).note, "no active token plan");
  const s = await minimax(fixture("minimax_remains_plan.json"));
  assert.deepEqual(rows(s), [["MiniMax-M2 (5h)", 500, 4500, "requests"], ["MiniMax-M2 (7d)", 15000, 45000, "requests"]]);
  assert.deepEqual(s.windows.map((w) => w.resetsAt?.toISOString()), [at(1790866800), at(1791158400)]);
});

test("minimax: a percent-only lane is shown as a percentage", async () => {
  const payload = fixture("minimax_remains_plan.json");
  payload["model_remains"][1]["current_interval_status"] = 1;
  payload["model_remains"][1]["current_interval_remaining_percent"] = 75;
  const video = byName(await minimax(payload)).get("video (5h)")!;
  assert.deepEqual([video.used, video.limit, video.unit], [25, 100, "%"]);
});

// -- OpenRouter ----------------------------------------------------------------------------

const OR_KEY = "https://openrouter.ai/api/v1/key";
const OR_CREDITS = "https://openrouter.ai/api/v1/credits";
const CREDITS = { data: { total_credits: 25, total_usage: 3.5 } };
const openrouter = (key: unknown, credits: Route): Promise<QuotaSnapshot> => new OpenRouterQuota().fetch(API_KEY, new ScriptedHttp([["GET", OR_KEY, json(200, key)], ["GET", OR_CREDITS, credits]]));

test("openrouter: credits are the account balance; the key limit is its own row; refused credits are noted", async () => {
  const s = await openrouter(fixture("openrouter_key.json"), json(200, CREDITS));
  assert.equal(s.identity, "sk-or-v1-abc...123");
  assert.deepEqual(rows(s), [["credits", 3.5, 25, "USD"], ["free models (1d)", 0, 50, "requests"]]);
  assert.equal(s.note, null);
  const key = fixture("openrouter_key.json");
  Object.assign(key["data"], { limit: 10, usage: 1.25, limit_remaining: 8.75, limit_reset: "monthly" });
  const limit = byName(await openrouter(key, json(200, CREDITS))).get("key limit (monthly)")!;
  assert.deepEqual([limit.used, limit.limit, limit.unit], [1.25, 10, "USD"]);
  const refused = await openrouter(fixture("openrouter_key.json"), json(403, { error: { code: 403 } }));
  assert.deepEqual(refused.windows.map((w) => w.name), ["free models (1d)"]);
  assert.match(refused.note ?? "", /account credits unavailable/);
});

// -- Vercel --------------------------------------------------------------------------------

const VERCEL_URL = "https://ai-gateway.vercel.sh/v1/credits";
const vercel = (payload: unknown): Promise<QuotaSnapshot> => new VercelGatewayQuota().fetch(API_KEY, new ScriptedHttp([["GET", VERCEL_URL, json(200, payload)]]));

test("vercel: spend against spend plus balance; a missing balance raises", async () => {
  assert.deepEqual(rows(await vercel(fixture("vercel_credits.json"))), [["credits", 0, 0, "USD"]]);
  assert.deepEqual(rows(await vercel({ balance: "21.50", total_used: "3.50" })), [["credits", 3.5, 25, "USD"]]);
  await assert.rejects(() => vercel({ total_used: "3.50" }), QuotaFetchError);
});

// -- xAI -----------------------------------------------------------------------------------

const XAI_USER = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const XAI_BILLING = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const PERSONAL = { userId: "u-1", email: "user@example.test", subscriptionTier: "SuperGrok" };
async function grok(payload: unknown, user: unknown = PERSONAL): Promise<{ s: QuotaSnapshot; http: ScriptedHttp }> {
  const http = new ScriptedHttp([["GET", XAI_USER, json(200, user)], ["GET", XAI_BILLING, json(200, payload)]]);
  return { s: await new XaiQuota().fetch(OAUTH, http), http };
}

test("xai: a team seat points to the team's credits and skips the consumer pool", async () => {
  const { s, http } = await grok(fixture("grok_billing_unified_live.json"), fixture("xai_user_team.json"));
  assert.deepEqual([s.windows, s.identity, s.plan], [[], "user@example.test", "GrokPro"]);
  assert.match(s.note ?? "", /team's credits.*XAI_MANAGEMENT_API_KEY/);
  assert.deepEqual(http.calls, [["GET", XAI_USER]]);
});

test("xai: the credits config, the observed unified schema, and the Grok CLI marker", async () => {
  const { s, http } = await grok(fixture("grok_billing_credits.json"));
  assert.deepEqual([s.identity, s.plan, s.note], ["user@example.test", "SuperGrok", null]);
  assert.deepEqual(rows(s), [["weekly", 42.5, 100, "%"], ["on-demand", 1.25, 5, "USD"], ["prepaid", null, 86.66, "USD"]]);
  assert.equal(s.windows[0]!.resetsAt?.toISOString(), "2026-10-05T10:13:12.000Z");
  for (const h of http.headers) assert.deepEqual([h["Authorization"], h["X-XAI-Token-Auth"]], ["Bearer test-access", "xai-grok-cli"]);
  const live = (await grok(fixture("grok_billing_unified_live.json"))).s;
  assert.deepEqual(rows(live), [["weekly", 0, 100, "%"], ["prepaid", null, 0, "USD"]]);
  assert.equal(live.windows[0]!.resetsAt?.toISOString(), "2026-10-06T17:10:14.416Z");
});

test("xai: proto3 omissions, the inverted prepaid ledger, the legacy shape, and missing config", async () => {
  const omitted = fixture("grok_billing_credits.json");
  delete omitted["config"]["creditUsagePercent"];
  assert.deepEqual(rows((await grok(omitted)).s)[0], ["weekly", 0, 100, "%"]);
  const negative = fixture("grok_billing_credits.json");
  negative["config"]["prepaidBalance"] = { val: -500 };
  assert.deepEqual(rows((await grok(negative)).s).find((r) => r[0] === "prepaid"), ["prepaid", null, 5, "USD"]);
  const zeroCap = fixture("grok_billing_credits.json");
  delete zeroCap["config"]["prepaidBalance"];
  zeroCap["config"]["onDemandCap"] = {};
  assert.deepEqual((await grok(zeroCap)).s.windows.map((w) => w.name), ["weekly"]);
  const legacy = (await grok(fixture("grok_billing_legacy.json"))).s;
  assert.deepEqual(rows(legacy), [["monthly credits", 12.34, 20, "USD"]]);
  assert.equal(legacy.windows[0]!.resetsAt?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.match((await grok({})).s.note ?? "", /no Grok subscription/);
  await assert.rejects(() => grok({ config: { history: [] } }), QuotaFetchError);
  await assert.rejects(() => new XaiQuota().fetch(OAUTH, new ScriptedHttp([["GET", XAI_USER, json(401, { error: "expired" })]])), QuotaFetchError);
});

test("xai: an inference key reports its name, blocked flags, and no quota", async () => {
  const keyUrl = "https://api.x.ai/v1/api-key";
  const s = await new XaiQuota().fetch(API_KEY, new ScriptedHttp([["GET", keyUrl, json(200, fixture("xai_api_key.json"))]]));
  assert.deepEqual([s.identity, s.windows], ["My API Key", []]);
  assert.match(s.note ?? "", /XAI_MANAGEMENT_API_KEY/);
  const blocked = fixture("xai_api_key.json");
  Object.assign(blocked, { team_blocked: true, api_key_disabled: true });
  const note = (await new XaiQuota().fetch(API_KEY, new ScriptedHttp([["GET", keyUrl, json(200, blocked)]]))).note ?? "";
  assert.ok(note.includes("team blocked") && note.includes("key disabled") && !note.includes("key blocked"));
});

const TEAM = "65c1e471-205f-4566-9c5a-07198badf4ce";
const MGMT_VALIDATION = "https://management-api.x.ai/auth/management-keys/validation";
const MGMT_BALANCE = `https://management-api.x.ai/v1/billing/teams/${TEAM}/prepaid/balance`;
const MGMT_PREVIEW = `https://management-api.x.ai/v1/billing/teams/${TEAM}/postpaid/invoice/preview`;
const EMPTY_BALANCE = { changes: [], total: { val: "0" } };
const management = (validation: unknown, balance: unknown, preview: unknown = fixture("xai_invoice_preview.json")): Promise<QuotaSnapshot> =>
  new XaiManagementQuota().fetch(API_KEY, new ScriptedHttp([["GET", MGMT_VALIDATION, json(200, validation)], ["GET", MGMT_BALANCE, json(200, balance)], ["GET", MGMT_PREVIEW, json(200, preview)]]));

test("xai management: cycle usage against included credits, renewing next month (December -> January)", async () => {
  const s = await management(fixture("xai_management_key_validation.json"), EMPTY_BALANCE);
  assert.deepEqual(rows(s), [["credits (1mo)", 1.18, 148.19, "USD"], ["prepaid", null, 0, "USD"]]);
  assert.equal(s.windows[0]!.resetsAt?.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.ok(!Object.is(s.windows[1]!.limit, -0), "an empty ledger is not a negative zero");
  const december = fixture("xai_invoice_preview.json");
  december["billingCycle"] = { year: 2026, month: 12 };
  assert.equal((await management(fixture("xai_management_key_validation.json"), EMPTY_BALANCE, december)).windows[0]!.resetsAt?.toISOString(), "2027-01-01T00:00:00.000Z");
  const noCredits = fixture("xai_invoice_preview.json");
  noCredits["defaultCredits"] = "0";
  const w = (await management(fixture("xai_management_key_validation.json"), EMPTY_BALANCE, noCredits)).windows[0]!;
  assert.deepEqual([w.used, w.limit], [1.18, null]);
});

test("xai management: the negated ledger total; a missing total or a non-team key raises", async () => {
  const s = await management(fixture("xai_management_key_validation.json"), fixture("xai_prepaid_balance.json"));
  assert.equal(s.identity, "test key");
  assert.deepEqual(rows(s).at(-1), ["prepaid", null, 10, "USD"]);
  await assert.rejects(() => management(fixture("xai_management_key_validation.json"), { changes: [] }), QuotaFetchError);
  const org = fixture("xai_management_key_validation.json");
  delete org["teamId"];
  org["scope"] = "SCOPE_ORGANIZATION";
  await assert.rejects(() => management(org, fixture("xai_prepaid_balance.json")), QuotaFetchError);
});

// -- Kimi ----------------------------------------------------------------------------------

const KIMI_USAGES = "https://api.kimi.com/coding/v1/usages";
const KIMI_ME = "https://api.kimi.com/coding/v1/me";
const kimi = (payload: unknown, me: Route | null = null): Promise<QuotaSnapshot> =>
  new KimiQuota().fetch(OAUTH, new ScriptedHttp([["GET", KIMI_USAGES, json(200, payload)], ...(me ? [["GET", KIMI_ME, me] as ["GET", string, Route]] : [])]));

test("kimi: the weekly summary and windowed limits", async () => {
  const s = await kimi(fixture("kimi_usages.json"));
  assert.deepEqual(s.windows.map((w) => [w.name, w.used, w.limit]), [["weekly", 37, 100], ["limit (5h)", 12, 100]]);
  assert.equal(s.windows[0]!.resetsAt?.toISOString(), "2026-10-05T05:24:18.443Z");
});

test("kimi: ratio usages add monthly windows without duplicating covered durations", async () => {
  const s = await kimi(fixture("kimi_usages_ratio.json"));
  assert.deepEqual(rows(s), [["limit (5h)", 0, 100, "units"], ["monthly (code)", 18, 100, "%"], ["monthly (membership)", 0, 100, "%"]]);
  assert.equal(s.windows[1]!.resetsAt?.toISOString(), "2026-11-03T00:00:00.000Z");
  const ratioOnly = await kimi({ usages: { limit_7d: { used_ratio: "0.1", reset_time: "2026-10-08T00:00:00Z" }, monthCode: { usedRatio: 0.18, resetAt: "2026-11-03T00:00:00Z" }, limit_custom: { used_ratio: 0.5, reset_time: "2026-12-01T00:00:00Z" } } });
  assert.deepEqual(ratioOnly.windows.map((w) => [w.name, w.used, w.unit]), [["weekly (7d)", 10, "%"], ["monthly (code)", 18, "%"], ["limit custom", 50, "%"]]);
  const summary = fixture("kimi_usages.json");
  summary["usages"] = { limit_7d: { used_ratio: 0.99, reset_time: "2026-10-05T05:24:18Z" }, limit_month_total: { used_ratio: 0.25, reset_time: "2026-11-01T00:00:00Z" } };
  const merged = await kimi(summary);
  assert.deepEqual(merged.windows.map((w) => w.name), ["weekly", "limit (5h)", "monthly (membership)"]);
  assert.equal(merged.windows.at(-1)!.used, 25);
});

test("kimi: /me supplies login and plan, and a missing /me does not hide usage", async () => {
  const s = await kimi(fixture("kimi_usages.json"), json(200, { email: "user@example.test", nickname: "Nick", user_level_name: "Plus" }));
  assert.deepEqual([s.identity, s.plan], ["user@example.test", "Plus"]);
  const usageOnly = await kimi(fixture("kimi_usages.json"));
  assert.deepEqual([usageOnly.identity, usageOnly.plan, usageOnly.windows.length > 0], [null, null, true]);
  await assert.rejects(() => kimi({ usages: [] }), QuotaFetchError);
});

// -- Meta ----------------------------------------------------------------------------------

async function meta(payload: unknown, credential = META_OAUTH, status = 200): Promise<{ s: QuotaSnapshot; http: ScriptedHttp }> {
  const http = new ScriptedHttp([["POST", MUSE_KEY_URL, json(status, payload)]]);
  return { s: await new MetaQuota().fetch(credential, http), http };
}

test("meta: subscription windows from one key-mint POST with the identity token", async () => {
  const { s, http } = await meta(fixture("meta_muse_key.json"));
  assert.deepEqual(rows(s), [["primary (5h)", 12.5, 100, "%"], ["weekly (7d)", 34, 100, "%"]]);
  assert.deepEqual(s.windows.map((w) => w.resetsAt?.toISOString()), [at(1791144000), at(1791547200)]);
  assert.deepEqual([s.identity, s.plan, s.note], ["user@example.test", "Muse Code High Usage", null]);
  assert.deepEqual(http.calls, [["POST", MUSE_KEY_URL]]);
  assert.deepEqual([http.headers[0]!["Authorization"], http.headers[0]!["x-api-version"], http.bodies[0]], ["Bearer dca:test-identity", "1.0.0", "{}"]);
});

test("meta: idle usage is a note; login falls back to the full name", async () => {
  const idle = (await meta({ is_subs_active: true })).s;
  assert.deepEqual([idle.windows, idle.note !== null], [[], true]);
  const payload = fixture("meta_muse_key.json");
  delete payload["user_email"];
  delete payload["subs_tier_name"];
  const s = (await meta(payload)).s;
  assert.deepEqual([s.identity, s.plan, s.windows.length > 0], ["Test User", null, true]);
});

test("meta: refusals raise; an API key is a note without network; 429 carries Retry-After", async () => {
  await assert.rejects(() => meta({ is_subs_active: true, subs_usage: { window: {} } }), QuotaFetchError);
  await assert.rejects(() => meta({ require_payment: true, is_subs_active: true }), QuotaFetchError);
  await assert.rejects(() => meta({ is_subs_active: false }), QuotaFetchError);
  await assert.rejects(() => meta({}), QuotaFetchError);
  await assert.rejects(() => meta({}, OAUTH), /device-code OAuth login/);
  await assert.rejects(() => meta({ title: "restricted" }, META_OAUTH, 401), /session expired/);
  const key = await meta({}, API_KEY);
  assert.deepEqual([key.http.calls, key.s.windows], [[], []]);
  assert.match(key.s.note ?? "", /API key/);
  const http = new ScriptedHttp([["POST", MUSE_KEY_URL, json(429, {}, "60")]]);
  await assert.rejects(() => new MetaQuota().fetch(META_OAUTH, http), (e: unknown) => e instanceof RateLimitedError && e.retryAfter === "60");
});
