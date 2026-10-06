/**
 * OpenRouter account credit and per-key limits, ported from tokemon.
 *
 * Schemas pinned against live responses (2026-10-01):
 *
 *     GET /key
 *         data: {label, limit, limit_remaining, limit_reset, usage, usage_daily, ...,
 *                is_free_tier, free_model_daily_requests: {used, limit, remaining},
 *                rate_limit: {requests: -1, ...}}        # deprecated, always -1
 *     GET /credits
 *         data: {total_credits, total_usage}
 *
 * `usage` is the key's own lifetime spend and `limit` its optional spending
 * cap, reset per `limit_reset` (a period name such as "monthly", not a time);
 * the account balance is `total_credits - total_usage`. The API reference
 * reserves `/credits` for management keys, though it answered a regular key;
 * a refusal is reported in the note and the key's own rows are kept.
 */

import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, RateLimitedError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { isObject, optionalNumber, optionalString, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

function creditsWindow(payload: unknown): QuotaWindow {
  const data = requireObject(requireObject(payload, "openrouter credits")["data"], "openrouter credits data");
  const totalCredits = optionalNumber(data["total_credits"]);
  const totalUsage = optionalNumber(data["total_usage"]);
  if (totalCredits === null || totalUsage === null) throw new QuotaFetchError(`openrouter credits: no totals (keys: ${topLevelKeys(data)})`);
  return quotaWindow("credits", totalUsage, totalCredits, "USD", null);
}

function keyWindows(data: JsonObject): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  const limit = optionalNumber(data["limit"]);
  if (limit !== null) {
    const reset = optionalString(data["limit_reset"]);
    windows.push(quotaWindow(reset ? `key limit (${reset})` : "key limit", optionalNumber(data["usage"]), limit, "USD", null));
  }
  const free = data["free_model_daily_requests"];
  if (isObject(free)) {
    const freeLimit = optionalNumber(free["limit"]);
    if (freeLimit !== null) windows.push(quotaWindow("free models (1d)", optionalNumber(free["used"]), freeLimit, "requests", null));
  }
  return windows;
}

export class OpenRouterQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = bearer(credential.secret);
    const data = requireObject(requireObject(await getJson(http, `${OPENROUTER_API}/key`, headers), "openrouter key")["data"], "openrouter key data");
    const windows: QuotaWindow[] = [];
    let note: string | null = null;
    try {
      windows.push(creditsWindow(await getJson(http, `${OPENROUTER_API}/credits`, headers)));
    } catch (e) {
      if (e instanceof RateLimitedError || !(e instanceof QuotaFetchError)) throw e;
      note = `account credits unavailable: ${e.message}`;
    }
    windows.push(...keyWindows(data));
    if (windows.length === 0) throw new QuotaFetchError(`openrouter key: no quota data (${note}; keys: ${topLevelKeys(data)})`);
    return { plan: null, identity: optionalString(data["label"]), windows, note };
  }
}
