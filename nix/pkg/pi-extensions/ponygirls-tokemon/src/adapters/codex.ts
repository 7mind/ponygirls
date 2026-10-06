/**
 * OpenAI Codex (ChatGPT plan) quota, ported from tokemon's CodexQuota.
 *
 * Schema pinned against a live `GET /wham/usage` response (2026-09-29); see
 * tokemon's adapters/codex.py for the field inventory (`rate_limit`,
 * `code_review_rate_limit`, `additional_rate_limits`, `credits`, spend
 * control, `rate_limit_reset_credits`, and the `chatpass` quota).
 */

import { bearer, getJson, type Http } from "../http.ts";
import { QuotaFetchError, type Credential, type QuotaAdapter, type QuotaSnapshot, type QuotaWindow } from "../quota.ts";
import { epochSeconds, humanizeSeconds, isObject, optionalInt, optionalNumber, requireObject, topLevelKeys } from "../values.ts";

const CHATGPT_BACKEND_API = "https://chatgpt.com/backend-api";
const USAGE_PATH = "/wham/usage";

function rateWindow(name: string, node: unknown, exhausted: boolean | null): QuotaWindow | null {
  if (!isObject(node)) return null;
  const used = optionalNumber(node["used_percent"]);
  if (used === null) return null;
  const windowSeconds = optionalNumber(node["limit_window_seconds"]);
  const label = windowSeconds !== null ? `${name} (${humanizeSeconds(windowSeconds)})` : name;
  return { name: label, used, limit: 100, unit: "%", resetsAt: epochSeconds(node["reset_at"]), unlimited: false, exhausted };
}

/** The windows of one rate-limit status ({limit_reached, primary_window, secondary_window}). */
function statusWindows(primaryName: string, secondaryName: string, status: unknown): QuotaWindow[] {
  if (!isObject(status)) return [];
  const reached = status["limit_reached"] === true;
  return [
    rateWindow(primaryName, status["primary_window"], reached ? true : null),
    rateWindow(secondaryName, status["secondary_window"], null),
  ].filter((w): w is QuotaWindow => w !== null);
}

export class CodexQuota implements QuotaAdapter {
  readonly usesAccessToken = true;

  async fetch(credential: Credential, http: Http): Promise<QuotaSnapshot> {
    const headers = bearer(credential.secret);
    if (credential.accountId !== null) headers["ChatGPT-Account-Id"] = credential.accountId;
    const payload = requireObject(await getJson(http, `${CHATGPT_BACKEND_API}${USAGE_PATH}`, headers), "codex usage");

    const windows: QuotaWindow[] = [];
    const notes: string[] = [];

    const rateLimit = payload["rate_limit"];
    if (isObject(rateLimit) && rateLimit["allowed"] === false) notes.push("not allowed");
    windows.push(...statusWindows("primary", "secondary", rateLimit));
    windows.push(...statusWindows("code review", "code review", payload["code_review_rate_limit"]));
    const chatpass = payload["chatpass"];
    if (isObject(chatpass) && Array.isArray(chatpass["windows"])) {
      for (const node of chatpass["windows"]) {
        const window = rateWindow("chatpass", node, null);
        if (window !== null) windows.push(window);
      }
    }
    const additional = payload["additional_rate_limits"];
    if (Array.isArray(additional)) {
      for (const details of additional) {
        if (!isObject(details)) continue;
        const limitName = details["limit_name"];
        const name = typeof limitName === "string" && limitName ? limitName : "additional";
        windows.push(...statusWindows(name, name, details["rate_limit"]));
      }
    }

    const credits = payload["credits"];
    if (isObject(credits)) {
      const balance = optionalNumber(credits["balance"]);
      const unlimited = credits["unlimited"] === true;
      if (balance !== null || unlimited) {
        windows.push({ name: "credits", used: null, limit: balance, unit: "credits", resetsAt: null, unlimited, exhausted: null });
      }
    }

    const resetCredits = payload["rate_limit_reset_credits"];
    if (isObject(resetCredits)) {
      const available = optionalInt(resetCredits["available_count"]);
      if (available !== null) notes.push(`resets: ${available}`);
    }

    if (windows.length === 0) throw new QuotaFetchError(`codex usage: no recognizable quota data (top-level keys: ${topLevelKeys(payload)})`);

    const plan = payload["plan_type"];
    const email = payload["email"];
    return {
      plan: typeof plan === "string" ? plan : null,
      identity: typeof email === "string" ? email : null,
      windows,
      note: notes.length > 0 ? notes.join(" \u00b7 ") : null,
    };
  }
}
