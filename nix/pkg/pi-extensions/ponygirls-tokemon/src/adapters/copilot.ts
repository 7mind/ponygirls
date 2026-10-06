/**
 * GitHub Copilot premium-request quota via `/copilot_internal/user`, ported
 * from tokemon.
 *
 * Auth quirk (verified live, 2026-09-29): this endpoint authenticates with
 * the GitHub OAuth token (pi `auth.json` entry `refresh`) — NOT the exchanged
 * Copilot session token in `access`, which it rejects with 401 even when
 * freshly minted. Response schema pinned against the live payload:
 *
 *     {copilot_plan, access_type_sku, quota_reset_date, quota_reset_date_utc,
 *      quota_snapshots: {<scope>: {entitlement, remaining, credits_used,
 *                                  percent_remaining, unlimited, has_quota,
 *                                  quota_reset_at, overage_count,
 *                                  token_based_billing, ...}}}
 *
 * Since GitHub's move to usage-based billing (2026-06-01) the premium quota
 * of a `token_based_billing` account counts GitHub AI Credits, not premium
 * requests.
 */

import { getJson, type Http } from "../http.ts";
import { QuotaFetchError, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { isObject, optionalNumber, optionalString, parseDate, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const USER_URL = "https://api.github.com/copilot_internal/user";
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};
const PREMIUM_SCOPE = "premium_interactions";
const SCOPE_LABELS = new Map([[PREMIUM_SCOPE, "premium requests"], ["chat", "chat"], ["completions", "completions"]]);

function bodyReset(body: JsonObject): Date | null {
  return parseDate(body["quota_reset_date_utc"]) ?? parseDate(body["quota_reset_date"]);
}

function scopeWindow(scope: string, detail: JsonObject, fallbackReset: Date | null): QuotaWindow {
  const entitlement = optionalNumber(detail["entitlement"]);
  const remaining = optionalNumber(detail["remaining"]);
  const resetEpoch = optionalNumber(detail["quota_reset_at"]);
  const premiumCredits = scope === PREMIUM_SCOPE && detail["token_based_billing"] === true;
  return {
    name: premiumCredits ? "AI credits" : (SCOPE_LABELS.get(scope) ?? scope),
    used: entitlement !== null && remaining !== null ? entitlement - remaining : null,
    limit: entitlement,
    unit: premiumCredits ? "credits" : "requests",
    resetsAt: resetEpoch !== null && resetEpoch > 0 ? new Date(resetEpoch * 1000) : fallbackReset,
    unlimited: detail["unlimited"] === true,
    exhausted: null,
  };
}

export class CopilotQuota implements QuotaAdapter {
  readonly usesAccessToken = false;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = { Authorization: `Bearer ${credential.refreshToken ?? credential.secret}`, Accept: "application/json", ...COPILOT_HEADERS };
    const body = requireObject(await getJson(http, USER_URL, headers), "copilot /user");
    const snapshots = body["quota_snapshots"];
    if (!isObject(snapshots) || Object.keys(snapshots).length === 0) throw new QuotaFetchError(`copilot /user: no quota_snapshots (keys: ${topLevelKeys(body)})`);
    const fallback = bodyReset(body);
    const windows = Object.keys(snapshots).sort().flatMap((scope) => {
      const detail = snapshots[scope];
      return isObject(detail) ? [scopeWindow(scope, detail, fallback)] : [];
    });
    return { plan: optionalString(body["copilot_plan"]), identity: optionalString(body["login"]), windows, note: optionalString(body["access_type_sku"]) };
  }
}
