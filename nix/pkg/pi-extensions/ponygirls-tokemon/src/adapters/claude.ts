/** Claude personal OAuth quota/spend. API keys cannot query subscription usage. */
import { bearer, getJson, TransportError, type Http } from "../http.ts";
import { QuotaFetchError, RateLimitedError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow, type ResetBalance } from "../quota.ts";
import { isObject, optionalNumber, parseDate, requireObject, topLevelKeys } from "../values.ts";

export const CLAUDE_OAUTH_PREFIX = "https://api.anthropic.com/api/oauth/";
const USAGE_URL = `${CLAUDE_OAUTH_PREFIX}usage`;
const RESET_USAGE_URL = `${USAGE_URL}?cedar_ember=1`;
const CLAUDE_CLI_USER_AGENT = "claude-cli/2.1.322 (external, cli)";
const RESET_USAGE_HEADERS = {
  "User-Agent": CLAUDE_CLI_USER_AGENT,
  "anthropic-beta": "oauth-2025-04-20",
  Accept: "application/json",
  "Content-Type": "application/json",
};

export function canonicalClaudeUsageUrl(url: string): string | null {
  return url === USAGE_URL || url === RESET_USAGE_URL ? USAGE_URL : null;
}

const RESET_CACHE_KEY = "tokemon_reset_counts_v1";
type ResetInventory = Record<"general" | "fable", ResetBalance[]>;

function resetDate(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const day = value.slice(0, 10);
  if (parseDate(day)?.toISOString().slice(0, 10) !== day) return undefined;
  return parseDate(value)?.getTime();
}

const RESET_BUCKETS = new Set(["five_hour", "seven_day", "seven_day_overage_included"]);

function resetInventory(node: unknown, now: Date): ResetInventory | undefined {
  if (!isObject(node) || node["eligible"] !== true || !Array.isArray(node["grants"])) return undefined;
  const byScope = { general: new Map<string, ResetBalance>(), fable: new Map<string, ResetBalance>() };
  const totals = { general: 0, fable: 0 };
  const nowMs = now.getTime();
  for (const grant of node["grants"]) {
    if (!isObject(grant)) return undefined;
    const count = grant["resets_left"], fable = grant["gives_back_weekly"], paused = grant["paused"], clears = grant["clears"];
    const startsAt = resetDate(grant["starts_at"]), expiresAt = resetDate(grant["ends_at"]);
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || typeof fable !== "boolean" || typeof paused !== "boolean" ||
      !Array.isArray(clears) || clears.length === 0 || clears.some((bucket) => typeof bucket !== "string" || !bucket) ||
      startsAt === undefined || expiresAt === undefined || (startsAt !== null && expiresAt !== null && startsAt >= expiresAt)) return undefined;
    if (paused || count === 0 || (expiresAt !== null && expiresAt <= nowMs)) continue;
    if (clears.some((bucket) => !RESET_BUCKETS.has(bucket))) return undefined;
    const clearsGeneral = clears.includes("seven_day");
    const clearsFable = clears.includes("seven_day_overage_included");
    if (fable && (!clearsFable || clearsGeneral)) return undefined;
    if (!fable && clearsFable && !clearsGeneral) return undefined;
    if (!clearsGeneral && !clearsFable) continue;
    const scope = fable ? "fable" : "general";
    totals[scope] += count;
    if (!Number.isSafeInteger(totals[scope])) return undefined;
    const bands = byScope[scope];
    const start = startsAt !== null && startsAt > nowMs ? startsAt : null;
    const key = `${start}/${expiresAt}`;
    bands.set(key, { startsAt: start, expiresAt, count: (bands.get(key)?.count ?? 0) + count });
  }
  return { general: [...byScope.general.values()], fable: [...byScope.fable.values()] };
}

export function cacheClaudeUsageBody(body: string, now: Date): string {
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new TransportError("claude usage: response is not valid JSON"); }
  const usage = requireObject(payload, "claude usage");
  if (!("cedar_ember" in usage) && !(RESET_CACHE_KEY in usage)) return body;
  const inventory = resetInventory(usage["cedar_ember"], now);
  delete usage["cedar_ember"];
  delete usage[RESET_CACHE_KEY];
  if (inventory !== undefined) usage[RESET_CACHE_KEY] = inventory;
  return JSON.stringify(usage);
}

function isTimeBound(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

function cachedBalance(value: unknown): ResetBalance[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const balances: ResetBalance[] = [];
  let sum = 0;
  for (const band of value) {
    if (!isObject(band)) return undefined;
    const { startsAt, expiresAt, count } = band;
    if (!isTimeBound(startsAt) || !isTimeBound(expiresAt) || (startsAt !== null && expiresAt !== null && startsAt >= expiresAt) ||
      typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return undefined;
    sum += count;
    if (!Number.isSafeInteger(sum)) return undefined;
    balances.push({ startsAt, expiresAt, count });
  }
  return balances;
}

function usageResetInventory(usage: Record<string, unknown>, now: Date): ResetInventory | undefined {
  const cached = usage[RESET_CACHE_KEY];
  if (!isObject(cached)) return resetInventory(usage["cedar_ember"], now);
  const general = cachedBalance(cached["general"]);
  const fable = cachedBalance(cached["fable"]);
  return general !== undefined && fable !== undefined ? { general, fable } : undefined;
}

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

function limitWindow(node: unknown, resets: ResetInventory | undefined): QuotaWindow | null {
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
  const window = quotaWindow(name, percent, 100, "%", parseDate(node["resets_at"]));
  if (resets !== undefined) {
    if (kind === "weekly_all" && scope == null) window.resetBalances = resets.general;
    if (kind === "weekly_scoped" && isObject(scope) && scope["surface"] == null && isObject(scope["model"]) && scope["model"]["display_name"] === "Fable") {
      window.resetBalances = resets.fable;
    }
  }
  return window;
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

  private readonly mode: "plain" | "cli";

  constructor(mode: "plain" | "cli") {
    this.mode = mode;
  }

  async fetch(credential: Credential, http: Http, now = new Date()): Promise<QuotaSnapshot> {
    if (credential.kind !== "oauth") return { plan: null, identity: null, windows: [], note: "API key: no plan quota endpoint" };
    const headers = bearer(credential.secret);
    const enriched = this.mode === "cli";
    const usage = requireObject(await getJson(http, enriched ? RESET_USAGE_URL : USAGE_URL, enriched ? { ...headers, ...RESET_USAGE_HEADERS } : headers), "claude usage");
    const resets = enriched ? usageResetInventory(usage, now) : undefined;
    let profile: Record<string, unknown> = {};
    let profileNote: string | null = null;
    try {
      profile = requireObject(await getJson(http, `${CLAUDE_OAUTH_PREFIX}profile`, headers), "claude profile");
    } catch (error) {
      if (!(error instanceof QuotaFetchError || error instanceof RateLimitedError || error instanceof TransportError)) throw error;
      profileNote = `profile unavailable: ${error.message}`;
    }
    const limits = usage["limits"];
    const windows = (Array.isArray(limits) ? limits.map((limit) => limitWindow(limit, resets)) : []).filter((w): w is QuotaWindow => w !== null);
    if (windows.length === 0) {
      for (const [key, label] of Object.entries(LEGACY_LABELS)) {
        const node = usage[key];
        const percent = isObject(node) ? nonnegative(node["utilization"]) : null;
        if (isObject(node) && percent !== null) {
          const window = quotaWindow(label, percent, 100, "%", parseDate(node["resets_at"]));
          if (key === "seven_day" && resets !== undefined) window.resetBalances = resets.general;
          windows.push(window);
        }
      }
    }
    const spend = spendWindow(usage["spend"]) ?? legacySpend(usage["extra_usage"]);
    if (spend !== null) windows.push(spend);
    const account = profile["account"];
    const organization = profile["organization"];
    const identity = isObject(account) && typeof account["email"] === "string" ? account["email"] : null;
    const plan = isObject(organization) && typeof organization["organization_type"] === "string" ? organization["organization_type"] : null;
    const enterprise = plan === "enterprise" || plan === "claude_enterprise";
    if (windows.length === 0 && !enterprise) {
      const { cedar_ember: _raw, [RESET_CACHE_KEY]: _cached, ...quota } = usage;
      throw new QuotaFetchError(`claude usage: no recognizable quota data (top-level keys: ${topLevelKeys(quota)})`);
    }
    const note = [profileNote, enterprise && spend === null ? "enterprise spend unavailable through OAuth" : null].filter((value) => value !== null).join(" · ") || null;
    return { plan, identity, windows, note };
  }
}
