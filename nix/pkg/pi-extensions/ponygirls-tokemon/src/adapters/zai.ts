/**
 * Z.AI GLM Coding Plan quota (`/api/monitor/usage/quota/limit`), ported from
 * tokemon.
 *
 * Auth quirk (from zai-org/zai-coding-plugins): the Authorization header
 * carries the bare token — no `Bearer` prefix. Error envelope observed live
 * (2026-09-29): `{code: 500, msg, success: false}` — e.g. an account without
 * a GLM Coding Plan reports `msg = "当前用户不存在coding plan"`; that is
 * account state, surfaced as a snapshot note.
 *
 * The official `query-usage.mjs` post-processor reads `data.limits[]` items by
 * `type` (TOKENS_LIMIT, TIME_LIMIT = monthly MCP) with `percentage`,
 * `currentValue` (used) and `usage` (the limit). The remaining fields are
 * taken from CodexBar's z.ai parser (steipete/CodexBar, Plugins/zai.js):
 * `remaining`; the window length as `number` × `unit` (1 = day, 3 = hour,
 * 5 = minute, 6 = week), which tells a plan's 5-hour token limit from its
 * weekly one; `nextResetTime` (epoch ms); and the CREDIT_LIMIT type of
 * credit-metered plans. `data.level` is the plan name (observed live
 * 2026-10-02, `"lite"`). The coding-plan key cannot read customer info, so
 * there is no login to show.
 */

import { getJson, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { epochMillis, humanizeSeconds, isObject, optionalInt, optionalNumber, optionalString, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const LIMIT_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const MCP_LIMIT_TYPE = "TIME_LIMIT";
const MCP_LIMIT_LABEL = "MCP (1mo)";
const LIMIT_LABELS = new Map([["TOKENS_LIMIT", "tokens"], ["CREDIT_LIMIT", "credits"]]);
const LIMIT_UNITS = new Map([["TOKENS_LIMIT", "tokens"], ["CREDIT_LIMIT", "credits"], [MCP_LIMIT_TYPE, "calls"]]);
const WINDOW_UNIT_SECONDS = new Map([[1, 86400], [3, 3600], [5, 60], [6, 604800]]);

function label(typeKey: string, entry: JsonObject): string {
  if (typeKey === MCP_LIMIT_TYPE) return MCP_LIMIT_LABEL;
  const name = LIMIT_LABELS.get(typeKey) ?? (typeKey || "quota");
  const number = optionalInt(entry["number"]);
  const unitSeconds = WINDOW_UNIT_SECONDS.get(optionalInt(entry["unit"]) ?? 0);
  return number && unitSeconds !== undefined ? `${name} (${humanizeSeconds(number * unitSeconds)})` : name;
}

function limitWindow(entry: JsonObject): QuotaWindow | null {
  const typeKey = typeof entry["type"] === "string" ? entry["type"] : "";
  const limit = optionalNumber(entry["usage"]);
  let used = optionalNumber(entry["currentValue"]);
  if (used === null && limit !== null) {
    const remaining = optionalNumber(entry["remaining"]);
    used = remaining !== null ? limit - remaining : null;
  }
  const resetsAt = epochMillis(entry["nextResetTime"]);
  if (used === null || limit === null) {
    const percentage = optionalNumber(entry["percentage"]);
    return percentage === null ? null : quotaWindow(label(typeKey, entry), percentage, 100, "%", resetsAt);
  }
  return quotaWindow(label(typeKey, entry), used, limit, LIMIT_UNITS.get(typeKey) ?? "units", resetsAt);
}

export class ZaiQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = { Authorization: credential.secret, "Accept-Language": "en-US,en", "Content-Type": "application/json" };
    const body = requireObject(await getJson(http, LIMIT_URL, headers), "zai quota/limit");
    if (body["success"] === false) {
      return { plan: null, identity: null, windows: [], note: optionalString(body["msg"]) ?? "account has no coding plan" };
    }
    const source = isObject(body["data"]) ? body["data"] : body;
    const limits = source["limits"];
    if (!Array.isArray(limits) || limits.length === 0) throw new QuotaFetchError(`zai quota/limit: no limits list (keys: ${topLevelKeys(source)})`);
    const windows = limits.filter(isObject).map(limitWindow).filter((w): w is QuotaWindow => w !== null);
    if (windows.length === 0) throw new QuotaFetchError(`zai quota/limit: no usable windows (keys: ${topLevelKeys(limits[0])})`);
    return { plan: optionalString(source["level"]), identity: null, windows, note: null };
  }
}
