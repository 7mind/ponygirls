/**
 * ponygirls-tokemon — the quota snapshot contract every provider adapter
 * fills in (ported from tokemon's quota.py).
 */

import type { Http } from "./http.ts";

export type CredentialKind = "oauth" | "api_key";

/** What an adapter queries with: the current secret and, for OAuth logins, the stored refresh token. */
export interface Credential {
  kind: CredentialKind;
  secret: string;
  refreshToken: string | null;
}

export interface QuotaWindow {
  name: string;
  used: number | null;
  limit: number | null;
  /** "%", a currency code ("USD"), or a count unit ("tokens", "requests", "credits", "calls", "units"). */
  unit: string;
  resetsAt: Date | null;
  unlimited: boolean;
  /** Set when the provider says so itself; otherwise derived from used/limit. */
  exhausted: boolean | null;
}

export interface QuotaSnapshot {
  plan: string | null;
  identity: string | null;
  windows: QuotaWindow[];
  note: string | null;
}

/** The quota query completed but could not be interpreted. */
export class QuotaFetchError extends Error {
  override name = "QuotaFetchError";
}

/** The endpoint answered HTTP 429; `retryAfter` is its raw Retry-After header, if sent. */
export class RateLimitedError extends QuotaFetchError {
  override name = "RateLimitedError";
  readonly retryAfter: string | null;

  constructor(url: string, retryAfter: string | null) {
    super(`rate limited (HTTP 429) by ${url}`);
    this.retryAfter = retryAfter;
  }
}

export interface QuotaAdapter {
  fetch(credential: Credential, http: Http): Promise<QuotaSnapshot>;
  /**
   * Whether the query needs the current access token (resolved through pi,
   * which refreshes an expired login). Adapters that query with the stored
   * refresh token (Copilot's GitHub token, Meta's identity token) do not.
   */
  readonly usesAccessToken: boolean;
}

/** A window with no provider-reported unlimited/exhausted flag. */
export function quotaWindow(name: string, used: number | null, limit: number | null, unit: string, resetsAt: Date | null): QuotaWindow {
  return { name, used, limit, unit, resetsAt, unlimited: false, exhausted: null };
}

/** Fallback for providers with no known quota surface (e.g. Xiaomi token plans). */
export class NoQuotaEndpoint implements QuotaAdapter {
  readonly usesAccessToken = false;

  async fetch(): Promise<QuotaSnapshot> {
    return { plan: null, identity: null, windows: [], note: "no quota endpoint" };
  }
}
