/**
 * xAI quota: Grok subscription pool (OAuth) and developer-platform prepaid
 * credit, ported from tokemon.
 *
 * xAI has three credential kinds with disjoint quota surfaces:
 *
 * - OAuth (SuperGrok / X Premium login; pi provider `xai`): the Grok CLI's
 *   billing proxy. Undocumented; schema from the CLI's own serde model
 *   (xai-org/grok-build, extensions/billing.rs), checked against a live
 *   unified-billing response (2026-10-01):
 *
 *       GET cli-chat-proxy.grok.com/v1/billing?format=credits
 *           config: {creditUsagePercent, currentPeriod: {type, start, end},
 *                    onDemandCap: {val}, onDemandUsed: {val}, prepaidBalance: {val},
 *                    monthlyLimit: {val}, used: {val}, billingPeriodEnd,  # deprecated
 *                    history: [...]} | absent
 *
 *   `val` is USD cents. The response is proto3 JSON, which omits zero-valued
 *   scalars: a zero amount arrives as `{}` and an untouched pool carries no
 *   `creditUsagePercent`. `prepaidBalance` is stored as negative cents (the
 *   CLI displays its absolute value) and is shown whenever reported, zero
 *   included; on-demand spend is shown only under a non-zero cap.
 *
 *   The pool is consumer billing. A team seat (SuperGrok Business) never
 *   uses it: on a live seat (2026-10-01) every route billed the team's
 *   invoice while the pool stayed at 0%, so a team account is reported with
 *   a pointer to the team's credits. Team membership comes from
 *   `GET /v1/user?include=subscription` (xai-grok-login UserInfo).
 *
 * - Inference API key (`XAI_API_KEY`): api.x.ai has no quota endpoint;
 *   `GET api.x.ai/v1/api-key` reports only the key's name and blocked state.
 *
 * - Management key (`XAI_MANAGEMENT_API_KEY`): the documented Management
 *   API. The prepaid ledger is inverted (a $10 top-up is `"-1000"`), so the
 *   balance is the negated total. The invoice preview's `totalWithCorr` is
 *   the cycle's usage and `defaultCredits` its included allotment (observed
 *   live on a SuperGrok Business team, 2026-10-01; xAI documents neither),
 *   renewed with the calendar-month `billingCycle`.
 */

import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type CredentialKind, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { isObject, optionalInt, optionalNumber, optionalString, parseDate, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const GROK_CLI_PROXY_API = "https://cli-chat-proxy.grok.com/v1";
// Static client marker and version the Grok CLI sends with the OAuth bearer token
// (the version is the proxy's own minimum, its /settings min_client_version, 2026-10-01).
const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
const GROK_CLI_VERSION = "1.0.13";
const XAI_API = "https://api.x.ai/v1";
const XAI_MANAGEMENT_API = "https://management-api.x.ai";
const MANAGEMENT_KEY_ENV = "XAI_MANAGEMENT_API_KEY";
const TEAM_SCOPE = "SCOPE_TEAM";
const CENTS_PER_USD = 100;
const MONTHS_PER_YEAR = 12;
const USAGE_PERIOD_LABELS = new Map([["USAGE_PERIOD_TYPE_WEEKLY", "weekly"], ["USAGE_PERIOD_TYPE_MONTHLY", "monthly"]]);
const API_KEY_BLOCK_FLAGS: Array<[string, string]> = [["team_blocked", "team blocked"], ["api_key_blocked", "key blocked"], ["api_key_disabled", "key disabled"]];

/** A proto3 `Cent` message as USD; null when the message is absent. */
function usd(node: unknown): number | null {
  if (!isObject(node)) return null;
  return (optionalNumber(node["val"]) ?? 0) / CENTS_PER_USD;
}

function poolWindow(config: JsonObject): QuotaWindow | null {
  const period = config["currentPeriod"];
  if (isObject(period)) {
    return quotaWindow(USAGE_PERIOD_LABELS.get(String(period["type"])) ?? "usage", optionalNumber(config["creditUsagePercent"]) ?? 0, 100, "%", parseDate(period["end"]));
  }
  const monthlyLimit = usd(config["monthlyLimit"]);
  if (monthlyLimit === null) return null;
  return quotaWindow("monthly credits", usd(config["used"]) ?? 0, monthlyLimit, "USD", parseDate(config["billingPeriodEnd"]));
}

class GrokSubscriptionQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = { ...bearer(credential.secret), "X-XAI-Token-Auth": GROK_CLI_TOKEN_AUTH, "x-grok-client-version": GROK_CLI_VERSION };
    const user = requireObject(await getJson(http, `${GROK_CLI_PROXY_API}/user?include=subscription`, headers), "grok user");
    const identity = optionalString(user["email"]);
    const plan = optionalString(user["subscriptionTier"]);
    if (optionalString(user["teamName"])) {
      return { plan, identity, windows: [], note: `team seat: usage bills the team's credits (see ${MANAGEMENT_KEY_ENV})` };
    }
    const body = requireObject(await getJson(http, `${GROK_CLI_PROXY_API}/billing?format=credits`, headers), "grok billing");
    const config = body["config"];
    if (!isObject(config) || Object.keys(config).length === 0) return { plan, identity, windows: [], note: "no Grok subscription billing config" };
    const pool = poolWindow(config);
    if (!pool) throw new QuotaFetchError(`grok billing: no recognizable quota data (config keys: ${topLevelKeys(config)})`);
    const windows = [pool];
    const onDemandCap = usd(config["onDemandCap"]);
    if (onDemandCap !== null && onDemandCap > 0) windows.push(quotaWindow("on-demand", usd(config["onDemandUsed"]) ?? 0, onDemandCap, "USD", null));
    const prepaid = usd(config["prepaidBalance"]);
    if (prepaid !== null) windows.push(quotaWindow("prepaid", null, Math.abs(prepaid), "USD", null));
    return { plan, identity, windows, note: null };
  }
}

class XaiInferenceKeyStatus implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const body = requireObject(await getJson(http, `${XAI_API}/api-key`, bearer(credential.secret)), "xai api-key");
    const notes = API_KEY_BLOCK_FLAGS.filter(([flag]) => body[flag] === true).map(([, label]) => label);
    notes.push(`API key: no quota endpoint (prepaid balance needs ${MANAGEMENT_KEY_ENV})`);
    return { plan: null, identity: optionalString(body["name"]), windows: [], note: notes.join(" · ") };
  }
}

/** pi stores either credential kind under the one `xai` provider id. */
export class XaiQuota implements QuotaAdapter {
  readonly usesAccessToken = true;
  private readonly byKind = new Map<CredentialKind, QuotaAdapter>([["oauth", new GrokSubscriptionQuota()], ["api_key", new XaiInferenceKeyStatus()]]);

  fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    return this.byKind.get(credential.kind)!.fetch(credential, http);
  }
}

/** The current billing cycle's usage against the team's included credits. */
function cycleWindows(preview: JsonObject): QuotaWindow[] {
  const invoice = preview["coreInvoice"];
  const used = isObject(invoice) ? usd(invoice["totalWithCorr"]) : null;
  if (used === null) return [];
  const includedCents = optionalNumber(preview["defaultCredits"]);
  const cycle = preview["billingCycle"];
  const year = isObject(cycle) ? optionalInt(cycle["year"]) : null;
  const month = isObject(cycle) ? optionalInt(cycle["month"]) : null;
  const nextCycle = year && month && month >= 1 && month <= MONTHS_PER_YEAR ? new Date(Date.UTC(year + Math.trunc(month / MONTHS_PER_YEAR), month % MONTHS_PER_YEAR, 1)) : null;
  return [quotaWindow("credits (1mo)", used, includedCents ? includedCents / CENTS_PER_USD : null, "USD", nextCycle)];
}

export class XaiManagementQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = bearer(credential.secret);
    const key = requireObject(await getJson(http, `${XAI_MANAGEMENT_API}/auth/management-keys/validation`, headers), "xai management key");
    const teamId = optionalString(key["teamId"]) ?? (key["scope"] === TEAM_SCOPE ? optionalString(key["scopeId"]) : null);
    if (!teamId) throw new QuotaFetchError(`xai management key: not scoped to a team (scope: ${JSON.stringify(key["scope"] ?? null)})`);
    const balance = requireObject(await getJson(http, `${XAI_MANAGEMENT_API}/v1/billing/teams/${teamId}/prepaid/balance`, headers), "xai prepaid balance");
    const total = balance["total"];
    const ledgerCents = isObject(total) ? optionalNumber(total["val"]) : null;
    if (ledgerCents === null) throw new QuotaFetchError(`xai prepaid balance: no total (top-level keys: ${topLevelKeys(balance)})`);
    // 0 - x rather than -x: an empty ledger must not become a negative zero.
    const prepaid = quotaWindow("prepaid", null, 0 - ledgerCents / CENTS_PER_USD, "USD", null);
    const preview = requireObject(await getJson(http, `${XAI_MANAGEMENT_API}/v1/billing/teams/${teamId}/postpaid/invoice/preview`, headers), "xai invoice preview");
    return { plan: null, identity: optionalString(key["name"]), windows: [...cycleWindows(preview), prepaid], note: null };
  }
}
