/**
 * Kimi For Coding plan usage, ported from tokemon.
 *
 * Checked against a live account (2026-10-02) and the response handling of
 * kimi-cli's `/usage` command (MoonshotAI/kimi-cli, ui/shell/usage.py). The
 * cloud endpoint returns both shapes; either may be absent:
 *
 *     GET /usages
 *         usage: {limit, used | remaining, resetTime, name?}        # weekly summary
 *         limits: [{window: {duration, timeUnit: "TIME_UNIT_MINUTE" | ...},
 *                   detail: {limit, used | remaining, resetTime, name?}}, ...]
 *         usages: {limit_5h, limit_7d, limit_month_code, limit_month_total:
 *                  {used_ratio: 0..1, reset_time}, ...}
 *
 * `used_ratio` is a fraction (kimi-code `parseQuotaEntry`). Absolute `usage` /
 * `limits` rows win over a same-duration ratio: Moonshot has shipped
 * responses where `used_ratio` stays 0 while that window is exhausted
 * (MoonshotAI/kimi-code#3951). Counts in the absolute rows carry no unit.
 * Login and plan come from `GET /me`; its failure never hides the usage.
 */

import { bearer, getJson, TransportError, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { humanizeSeconds, isObject, optionalNumber, optionalString, parseDate, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const KIMI_API = "https://api.kimi.com/coding/v1";
const SUMMARY_LABEL = "weekly";
const WEEKLY_DURATION = "7d";
const RESET_TIME_KEYS = ["resetTime", "reset_time", "resetAt", "reset_at"];
const PERCENT_SCALE = 100;
const SECONDS_PER_TIME_UNIT = new Map([["TIME_UNIT_MINUTE", 60], ["TIME_UNIT_HOUR", 3600], ["TIME_UNIT_DAY", 86400]]);

/** Response keys (snake_case from api.kimi.com, camelCase from the daemon schema), label, duration an absolute row covers. */
const RATIO_WINDOWS: Array<{ keys: string[]; label: string; duration: string | null }> = [
  { keys: ["limit_5h", "limit5h"], label: "5h", duration: "5h" },
  { keys: ["limit_7d", "limit7d"], label: "weekly (7d)", duration: WEEKLY_DURATION },
  { keys: ["limit_month_code", "month_code", "monthCode"], label: "monthly (code)", duration: null },
  { keys: ["limit_month_total", "month_total", "monthTotal"], label: "monthly (membership)", duration: null },
];

function resetOf(entry: JsonObject): Date | null {
  for (const key of RESET_TIME_KEYS) {
    const reset = parseDate(entry[key]);
    if (reset) return reset;
  }
  return null;
}

function absoluteWindow(name: string, detail: JsonObject): QuotaWindow | null {
  const limit = optionalNumber(detail["limit"]);
  let used = optionalNumber(detail["used"]);
  if (used === null) {
    const remaining = optionalNumber(detail["remaining"]);
    if (remaining !== null && limit !== null) used = limit - remaining;
  }
  if (used === null && limit === null) return null;
  return quotaWindow(name, used, limit, "units", resetOf(detail));
}

function limitDuration(item: JsonObject): string | null {
  const window = item["window"];
  if (!isObject(window)) return null;
  const duration = optionalNumber(window["duration"]);
  const unitSeconds = SECONDS_PER_TIME_UNIT.get(String(window["timeUnit"]));
  if (!duration || unitSeconds === undefined) return null;
  return humanizeSeconds(duration * unitSeconds) || null;
}

function ratioWindow(name: string, entry: JsonObject): QuotaWindow | null {
  const ratio = optionalNumber(entry["used_ratio"]) ?? optionalNumber(entry["usedRatio"]);
  return ratio === null ? null : quotaWindow(name, ratio * PERCENT_SCALE, PERCENT_SCALE, "%", resetOf(entry));
}

function ratioWindows(usages: JsonObject, covered: Set<string>): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  const consumed = new Set<string>();
  for (const { keys, label, duration } of RATIO_WINDOWS) {
    for (const key of keys) consumed.add(key);
    if (duration !== null && covered.has(duration)) continue;
    const entry = keys.map((key) => usages[key]).find(isObject);
    const window = entry ? ratioWindow(label, entry) : null;
    if (window) windows.push(window);
  }
  for (const key of Object.keys(usages).sort()) {
    if (consumed.has(key)) continue;
    const entry = usages[key];
    const window = isObject(entry) ? ratioWindow(key.replaceAll("_", " "), entry) : null;
    if (window) windows.push(window);
  }
  return windows;
}

async function account(credential: Credential, http: Http): Promise<{ identity: string | null; plan: string | null }> {
  let payload: unknown;
  try {
    payload = await getJson(http, `${KIMI_API}/me`, bearer(credential.secret));
  } catch (e) {
    if (e instanceof QuotaFetchError || e instanceof TransportError) return { identity: null, plan: null };
    throw e;
  }
  if (!isObject(payload)) return { identity: null, plan: null };
  return { identity: optionalString(payload["email"]) ?? optionalString(payload["nickname"]), plan: optionalString(payload["user_level_name"]) };
}

export class KimiQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const body = requireObject(await getJson(http, `${KIMI_API}/usages`, bearer(credential.secret)), "kimi usages");
    const windows: QuotaWindow[] = [];
    const covered = new Set<string>();
    if (isObject(body["usage"])) {
      const summary = absoluteWindow(SUMMARY_LABEL, body["usage"]);
      if (summary) {
        windows.push(summary);
        covered.add(WEEKLY_DURATION);
      }
    }
    if (Array.isArray(body["limits"])) {
      for (const [index, item] of body["limits"].entries()) {
        if (!isObject(item)) continue;
        const duration = limitDuration(item);
        const window = absoluteWindow(duration ? `limit (${duration})` : `limit #${index + 1}`, isObject(item["detail"]) ? item["detail"] : item);
        if (!window) continue;
        windows.push(window);
        if (duration) covered.add(duration);
      }
    }
    if (isObject(body["usages"])) windows.push(...ratioWindows(body["usages"], covered));
    if (windows.length === 0) throw new QuotaFetchError(`kimi usages: no recognizable quota data (top-level keys: ${topLevelKeys(body)})`);
    const { identity, plan } = await account(credential, http);
    return { plan, identity, windows, note: null };
  }
}
