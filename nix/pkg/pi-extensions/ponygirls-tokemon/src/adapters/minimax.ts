/**
 * MiniMax token plan remaining quota (`/v1/token_plan/remains`), ported from
 * tokemon.
 *
 * Schema pinned against live responses (2026-09-29): `{model_remains: null,
 * base_resp: {status_code: 0, status_msg: "success"}}` — `model_remains` is
 * null when the account has no active token plan, surfaced as a note.
 *
 * The non-null shape is taken from CodexBar's parser (steipete/CodexBar,
 * MiniMaxModelRemains / MiniMaxUsageFetcher), one entry per model lane:
 *
 *     {model_name, start_time, end_time, remains_time,              # epoch ms
 *      current_interval_total_count, current_interval_usage_count,
 *      current_interval_remaining_percent, current_interval_status,
 *      current_weekly_total_count, current_weekly_usage_count,
 *      current_weekly_remaining_percent, current_weekly_status,
 *      weekly_start_time, weekly_end_time, weekly_remains_time}
 *
 * Despite the name, `*_usage_count` is the REMAINING quota. A lane the plan
 * does not include reports status 3 with zero counts and is omitted; a lane
 * with no counts but a remaining percentage is shown as a percentage.
 */

import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, quotaWindow, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { epochMillis, humanizeSeconds, isObject, optionalNumber, optionalString, requireObject, topLevelKeys, type JsonObject } from "../values.ts";

const REMAINS_URL = "https://api.minimax.io/v1/token_plan/remains";
const STATUS_NOT_IN_PLAN = 3;

function laneWindow(model: string, total: unknown, remaining: unknown, remainingPercent: unknown, status: unknown, start: unknown, end: unknown): QuotaWindow | null {
  const startsAt = epochMillis(start);
  const resetsAt = epochMillis(end);
  const name = startsAt && resetsAt ? `${model} (${humanizeSeconds((resetsAt.getTime() - startsAt.getTime()) / 1000)})` : model;
  const limit = optionalNumber(total);
  const left = optionalNumber(remaining);
  if (limit !== null && limit > 0 && left !== null) return quotaWindow(name, limit - left, limit, "requests", resetsAt);
  const percentLeft = optionalNumber(remainingPercent);
  if (percentLeft !== null && status !== STATUS_NOT_IN_PLAN) return quotaWindow(name, 100 - percentLeft, 100, "%", resetsAt);
  return null;
}

function modelWindows(entry: JsonObject): QuotaWindow[] {
  const name = optionalString(entry["model_name"]) ?? "token plan";
  return [
    laneWindow(name, entry["current_interval_total_count"], entry["current_interval_usage_count"], entry["current_interval_remaining_percent"], entry["current_interval_status"], entry["start_time"], entry["end_time"]),
    laneWindow(name, entry["current_weekly_total_count"], entry["current_weekly_usage_count"], entry["current_weekly_remaining_percent"], entry["current_weekly_status"], entry["weekly_start_time"], entry["weekly_end_time"]),
  ].filter((w): w is QuotaWindow => w !== null);
}

export class MinimaxQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const body = requireObject(await getJson(http, REMAINS_URL, bearer(credential.secret)), "minimax token_plan/remains");
    const baseResp = body["base_resp"];
    if (isObject(baseResp) && baseResp["status_code"] !== 0 && baseResp["status_code"] !== undefined && baseResp["status_code"] !== null) {
      throw new QuotaFetchError(`minimax token_plan/remains: ${String(baseResp["status_msg"])}`);
    }
    const remains = body["model_remains"];
    if (remains === null || remains === undefined) return { plan: null, identity: null, windows: [], note: "no active token plan" };
    if (!Array.isArray(remains)) throw new QuotaFetchError(`minimax token_plan/remains: unexpected model_remains type ${typeof remains}`);
    const windows = remains.filter(isObject).flatMap(modelWindows);
    if (windows.length === 0) throw new QuotaFetchError(`minimax token_plan/remains: entries carry no quota counts (keys: ${topLevelKeys(remains[0])})`);
    return { plan: null, identity: null, windows, note: null };
  }
}
