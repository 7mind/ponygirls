/**
 * Meta Muse subscription quota via the Muse Code key-mint endpoint, ported
 * from tokemon.
 *
 * pi's `meta` provider logs in with an RFC 8628 device-code flow; the
 * resulting identity token (`dca:...`, stored as `refresh`) is exchanged for a
 * Model API key via the key-mint endpoint (pi-ai auth/oauth/meta.ts):
 *
 *     POST https://api.meta.ai/muse-code/key
 *         Authorization: Bearer <dca: identity token>, x-api-version: 1.0.0, body {}
 *         {api_key, base_url, require_payment?, is_subs_active?, subs_usage?,
 *          user_email?, user_full_name?, subs_tier_id?, subs_tier_name?, ...}
 *
 * The same response carries the subscription quota, read the way the
 * @ikuma.cloud/pix-usage pi extension's `parseMuseUsage` reads it:
 *
 *     subs_usage: {window: {window_duration_mins, used_percent, resets_at},
 *                  weekly: {used_percent, resets_at}}
 *
 * `resets_at` is epoch seconds. `subs_usage` may be absent while the rolling
 * window is idle. `require_payment` means no payment method; a missing
 * `is_subs_active` means no active Muse subscription. The identity token is
 * not renewable, so a 401/403 means the user must sign in again (`/login
 * meta`). The check mints as a side effect, so it is one POST with no retry:
 * the endpoint is aggressively rate-limited and pi re-mints on expiry itself.
 * API keys (`META_API_KEY`) are pay-as-you-go with no quota surface.
 */

import { HTTP_TOO_MANY_REQUESTS, parseJson, TransportError, type Http } from "../http.ts";
import { QuotaFetchError, RateLimitedError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { epochSeconds, humanizeSeconds, isObject, optionalNumber, optionalString, requireObject, topLevelKeys } from "../values.ts";

export const MUSE_KEY_URL = "https://api.meta.ai/muse-code/key";
const API_VERSION = "1.0.0";
/** Device-code identity tokens look like `dca:<opaque>` (cf. pix-usage's museAuthorization check). */
const IDENTITY_PATTERN = /^dca:\S+$/;

function usageWindow(name: string, node: unknown, context: string): QuotaWindow {
  if (!isObject(node)) throw new QuotaFetchError(`meta ${context}: ${name} is not an object (keys: ${topLevelKeys(node)})`);
  const used = optionalNumber(node["used_percent"]);
  if (used === null) throw new QuotaFetchError(`meta ${context}: ${name} has no used_percent (keys: ${topLevelKeys(node)})`);
  return quotaWindow(name, used, 100, "%", epochSeconds(node["resets_at"]));
}

export class MetaQuota implements QuotaAdapter {
  readonly usesAccessToken = false;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    if (credential.kind !== "oauth") return { plan: null, identity: null, windows: [], note: "API key: no plan quota endpoint" };
    const identityToken = credential.refreshToken;
    if (identityToken === null || !IDENTITY_PATTERN.test(identityToken)) {
      throw new QuotaFetchError("meta usage needs Pi's device-code OAuth login (dca: identity) — run /login meta");
    }
    const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${identityToken}`, "x-api-version": API_VERSION };
    const response = await http.request("POST", MUSE_KEY_URL, headers, "{}");
    if (response.status === HTTP_TOO_MANY_REQUESTS) throw new RateLimitedError(MUSE_KEY_URL, response.retryAfter);
    if (response.status === 401 || response.status === 403) throw new QuotaFetchError(`meta session expired (HTTP ${response.status}) — run /login meta to sign in again`);
    if (response.status !== 200) throw new QuotaFetchError(`HTTP ${response.status} from ${MUSE_KEY_URL}`);
    let payload: unknown;
    try {
      payload = parseJson(response);
    } catch (e) {
      if (e instanceof TransportError) payload = null;
      else throw e;
    }
    const body = requireObject(payload, "meta muse-code/key");
    if (body["require_payment"] === true) throw new QuotaFetchError("meta Muse requires a payment method; finish setup at dev.meta.ai");
    if (body["is_subs_active"] !== true) throw new QuotaFetchError("meta Muse: no active subscription for this login");
    const subs = body["subs_usage"];
    if (subs === null || subs === undefined) return { plan: null, identity: null, windows: [], note: "subscription usage not reported yet" };
    if (!isObject(subs)) throw new QuotaFetchError(`meta muse-code/key: subs_usage is not an object (keys: ${topLevelKeys(body)})`);
    const primary = subs["window"];
    const weekly = subs["weekly"];
    if (!isObject(primary) || !isObject(weekly)) throw new QuotaFetchError(`meta muse-code/key: subs_usage has no window/weekly pair (keys: ${topLevelKeys(subs)})`);
    const minutes = optionalNumber(primary["window_duration_mins"]);
    return {
      plan: optionalString(body["subs_tier_name"]),
      identity: optionalString(body["user_email"]) ?? optionalString(body["user_full_name"]),
      windows: [
        usageWindow(minutes !== null && minutes > 0 ? `primary (${humanizeSeconds(minutes * 60)})` : "primary", primary, "subs_usage.window"),
        usageWindow("weekly (7d)", weekly, "subs_usage.weekly"),
      ],
      note: null,
    };
  }
}
