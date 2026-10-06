import assert from "node:assert/strict";
import test from "node:test";
import type { Target } from "../src/discovery.ts";
import { QuotaService, type ProviderAuth } from "../src/service.ts";
import { ScriptedHttp, fixture, json } from "./scripted-http.ts";

const ZAI_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const COPILOT_URL = "https://api.github.com/copilot_internal/user";
const MINIMAX_URL = "https://api.minimax.io/v1/token_plan/remains";
const OR_KEY = "https://openrouter.ai/api/v1/key";
const OR_CREDITS = "https://openrouter.ai/api/v1/credits";

const target = (provider: string, origin: Target["origin"], credential: Target["credential"], label = `${origin}:${provider}`): Target => ({ provider, origin, label, credential, note: null });

class Clock {
  t = new Date("2026-10-06T12:00:00Z");
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

function auth(keys: Record<string, string>, asked: string[] = []): ProviderAuth {
  return {
    apiKey: async (provider) => {
      asked.push(provider);
      return keys[provider] ?? null;
    },
  };
}

test("auth.json targets query with pi's current token; Copilot uses its stored GitHub token; env keys as given", async () => {
  const http = new ScriptedHttp([
    ["GET", ZAI_URL, json(200, fixture("zai_limits.json"))],
    ["GET", COPILOT_URL, json(200, fixture("copilot_user.json"))],
    ["GET", OR_KEY, json(200, fixture("openrouter_key.json"))],
    ["GET", OR_CREDITS, json(200, { data: { total_credits: 1, total_usage: 0 } })],
  ]);
  const asked: string[] = [];
  const clock = new Clock();
  const service = new QuotaService({
    discover: () => [
      target("zai", "auth.json", { kind: "api_key", secret: "stored-stale", refreshToken: null }),
      target("github-copilot", "auth.json", { kind: "oauth", secret: "copilot-session", refreshToken: "gho_github" }),
      target("openrouter", "env", { kind: "api_key", secret: "or-env", refreshToken: null }),
    ],
    http,
    now: clock.now,
  });
  const report = await service.report(auth({ zai: "zai-current" }, asked), 0);
  assert.deepEqual(report.results.map((r) => [r.target.provider, r.error]), [["zai", null], ["github-copilot", null], ["openrouter", null]]);
  assert.deepEqual(asked, ["zai"], "only access-token adapters ask pi");
  const sent = new Map(http.calls.map(([, url], i) => [url, http.headers[i]!["Authorization"]]));
  assert.deepEqual([sent.get(ZAI_URL), sent.get(COPILOT_URL), sent.get(OR_KEY)], ["zai-current", "Bearer gho_github", "Bearer or-env"]);
});

test("one failing provider never hides the rest; missing credentials are explained", async () => {
  const http = new ScriptedHttp([["GET", ZAI_URL, json(500, {})], ["GET", MINIMAX_URL, json(200, fixture("minimax_remains_plan.json"))]]);
  const service = new QuotaService({
    discover: () => [
      target("zai", "env", { kind: "api_key", secret: "k", refreshToken: null }),
      target("minimax", "env", { kind: "api_key", secret: "m", refreshToken: null }),
      { provider: "broken", origin: "auth.json", label: "auth", credential: null, note: "pi credential broken: oauth entry has no access token" },
      target("kimi-coding", "auth.json", { kind: "oauth", secret: "s", refreshToken: "r" }),
      target("custom", "models.json", null),
      target("zai", "models.json", null, "models:zai"),
    ],
    http,
    now: new Clock().now,
  });
  const report = await service.report(auth({}), 0);
  assert.deepEqual(report.results.map((r) => [r.target.provider, r.error, r.snapshot?.note ?? null, r.snapshot?.windows.length ?? null]), [
    ["zai", "QuotaFetchError: HTTP 500 from https://api.z.ai/api/monitor/usage/quota/limit", null, null],
    ["minimax", null, null, 2],
    ["broken", "pi credential broken: oauth entry has no access token", null, null],
    ["kimi-coding", "pi has no usable credential for this provider (log in again?)", null, null],
    ["custom", null, "no quota endpoint", 0],
    ["zai", "models.json provider without a resolvable credential", null, null],
  ]);
});

test("a credential resolution failure is the provider's error, not a missing credential", async () => {
  class OAuthRefreshError extends Error {
    override name = "OAuthRefreshError";
  }
  const service = new QuotaService({
    discover: () => [target("kimi-coding", "auth.json", { kind: "oauth", secret: "s", refreshToken: "r" })],
    http: new ScriptedHttp([]),
    now: new Clock().now,
  });
  const failing: ProviderAuth = {
    apiKey: async () => {
      throw new OAuthRefreshError("refresh token revoked");
    },
  };
  const report = await service.report(failing, 0);
  assert.equal(report.results[0]!.error, "OAuthRefreshError: refresh token revoked");
});

test("answers are cached for maxAge, concurrent callers share one refresh, and a rate-limited target waits out Retry-After", async () => {
  const clock = new Clock();
  let calls = 0;
  const http = {
    async request() {
      calls++;
      return calls === 1 ? json(429, {}, "120") : json(200, fixture("zai_limits.json"));
    },
  };
  const service = new QuotaService({ discover: () => [target("zai", "env", { kind: "api_key", secret: "k", refreshToken: null })], http, now: clock.now });
  const [a, b] = await Promise.all([service.report(auth({}), 60_000), service.report(auth({}), 60_000)]);
  assert.equal(a, b);
  assert.deepEqual([calls, a.results[0]!.rateLimited, a.results[0]!.retryAt !== null], [1, true, true]);
  clock.advance(30_000);
  assert.equal(await service.report(auth({}), 60_000), a, "cached");
  clock.advance(40_000);
  const held = await service.report(auth({}), 0);
  assert.deepEqual([calls, held.results[0]!.rateLimited], [1, true], "inside Retry-After the 429 result is kept, not re-queried");
  clock.advance(120_000);
  const fresh = await service.report(auth({}), 0);
  assert.deepEqual([calls, fresh.results[0]!.rateLimited, fresh.results[0]!.snapshot?.windows.length], [2, false, 3]);
});

test("two credentials reporting the same account merge into one row", async () => {
  const me = { email: "same@example.test", user_level_name: "Plus" };
  const http = new ScriptedHttp([
    ["GET", "https://api.kimi.com/coding/v1/usages", json(200, fixture("kimi_usages.json"))],
    ["GET", "https://api.kimi.com/coding/v1/me", json(200, me)],
  ]);
  const service = new QuotaService({
    discover: () => [target("kimi-coding", "auth.json", { kind: "oauth", secret: "a", refreshToken: "r" }, "~/.pi/agent/auth.json"), target("kimi-coding", "env", { kind: "api_key", secret: "b", refreshToken: null }, "KIMI_API_KEY")],
    http,
    now: new Clock().now,
  });
  const report = await service.report(auth({ "kimi-coding": "a" }), 0);
  assert.deepEqual(report.results.map((r) => [r.target.label, r.snapshot?.identity]), [["~/.pi/agent/auth.json, KIMI_API_KEY", "same@example.test"]]);
});
