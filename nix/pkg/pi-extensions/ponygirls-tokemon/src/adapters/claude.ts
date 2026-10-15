/** Claude personal OAuth quota/spend. API keys cannot query subscription usage. */
import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { isObject, optionalNumber, parseDate, requireObject, topLevelKeys } from "../values.ts";

const OAUTH_API = "https://api.anthropic.com/api/oauth";
const MINOR_UNITS_PER_DOLLAR = 100;
const LIMIT_LABELS: Readonly<Record<string, string>> = { session: "session (5h)", weekly_all: "weekly (7d)", weekly_scoped: "weekly (7d)" };
const LEGACY_LABELS: Readonly<Record<string, string>> = { five_hour: "session (5h)", seven_day: "weekly (7d)", seven_day_opus: "weekly (7d) Opus", seven_day_sonnet: "weekly (7d) Sonnet" };

interface Money { amount: number; currency: string }

function nonnegative(value: unknown): number | null {
  const number = optionalNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function money(node: unknown): Money | null {
  if (!isObject(node)) return null;
  const amount = nonnegative(node["amount_minor"]);
  const exponent = nonnegative(node["exponent"]);
  const currency = node["currency"];
  if (amount === null || exponent === null || !Number.isInteger(exponent) || typeof currency !== "string" || !currency) return null;
  const divisor = 10 ** exponent;
  if (!Number.isFinite(divisor)) return null;
  return { amount: amount / divisor, currency };
}

function limitWindow(node: unknown): QuotaWindow | null {
  if (!isObject(node)) return null;
  const percent = nonnegative(node["percent"]);
  const kind = node["kind"];
  if (percent === null || typeof kind !== "string") return null;
  let name = LIMIT_LABELS[kind] ?? kind;
  const scope = node["scope"];
  if (isObject(scope)) {
    const model = scope["model"];
    const label = isObject(model) && typeof model["display_name"] === "string" ? model["display_name"] : scope["surface"];
    if (typeof label === "string" && label) name += ` ${label}`;
  }
  return quotaWindow(name, percent, 100, "%", parseDate(node["resets_at"]));
}

function spendWindow(node: unknown): QuotaWindow | null {
  if (!isObject(node) || node["enabled"] !== true) return null;
  const used = money(node["used"]);
  if (used === null) return null;
  const limit = money(node["limit"]);
  return quotaWindow("extra usage", used.amount, limit !== null && limit.currency === used.currency ? limit.amount : null, used.currency, parseDate(node["resets_at"]));
}

function legacySpend(node: unknown): QuotaWindow | null {
  if (!isObject(node) || node["is_enabled"] !== true) return null;
  const used = nonnegative(node["used_credits"]);
  if (used === null) return null;
  const limit = nonnegative(node["monthly_limit"]);
  const currency = typeof node["currency"] === "string" && node["currency"] ? node["currency"] : "USD";
  return quotaWindow("extra usage", used / MINOR_UNITS_PER_DOLLAR, limit === null ? null : limit / MINOR_UNITS_PER_DOLLAR, currency, parseDate(node["resets_at"]));
}

export class ClaudeQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    if (credential.kind !== "oauth") return { plan: null, identity: null, windows: [], note: "API key: no plan quota endpoint" };
    const headers = bearer(credential.secret);
    const usage = requireObject(await getJson(http, `${OAUTH_API}/usage`, headers), "claude usage");
    const profile = requireObject(await getJson(http, `${OAUTH_API}/profile`, headers), "claude profile");
    const limits = usage["limits"];
    const windows = (Array.isArray(limits) ? limits.map(limitWindow) : []).filter((w): w is QuotaWindow => w !== null);
    if (windows.length === 0) {
      for (const [key, label] of Object.entries(LEGACY_LABELS)) {
        const node = usage[key];
        const percent = isObject(node) ? nonnegative(node["utilization"]) : null;
        if (isObject(node) && percent !== null) windows.push(quotaWindow(label, percent, 100, "%", parseDate(node["resets_at"])));
      }
    }
    const spend = spendWindow(usage["spend"]) ?? legacySpend(usage["extra_usage"]);
    if (spend !== null) windows.push(spend);
    const account = profile["account"];
    const organization = profile["organization"];
    const identity = isObject(account) && typeof account["email"] === "string" ? account["email"] : null;
    const plan = isObject(organization) && typeof organization["organization_type"] === "string" ? organization["organization_type"] : null;
    const enterprise = plan === "enterprise" || plan === "claude_enterprise";
    if (windows.length === 0 && !enterprise) throw new QuotaFetchError(`claude usage: no recognizable quota data (top-level keys: ${topLevelKeys(usage)})`);
    return { plan, identity, windows, note: enterprise && spend === null ? "enterprise spend unavailable through OAuth" : null };
  }
}
