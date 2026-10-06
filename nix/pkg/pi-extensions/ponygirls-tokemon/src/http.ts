/**
 * ponygirls-tokemon — HTTP boundary. Production uses fetch; tests inject a
 * scripted Http.
 */

import { QuotaFetchError, RateLimitedError } from "./quota.ts";

export const USER_AGENT = "ponygirls-tokemon/0.1";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
export const HTTP_TOO_MANY_REQUESTS = 429;

export interface HttpResponse {
  status: number;
  body: string;
  /** Raw Retry-After header, if the server sent one. */
  retryAfter: string | null;
}

export type HttpMethod = "GET" | "POST";

export interface Http {
  request(method: HttpMethod, url: string, headers: Record<string, string>, body: string | null): Promise<HttpResponse>;
}

/** The request could not be completed at the transport level. */
export class TransportError extends Error {
  override name = "TransportError";
}

export class FetchHttp implements Http {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  async request(method: HttpMethod, url: string, headers: Record<string, string>, body: string | null): Promise<HttpResponse> {
    try {
      const response = await fetch(url, { method, headers: { "User-Agent": USER_AGENT, ...headers }, body, signal: AbortSignal.timeout(this.timeoutMs) });
      return { status: response.status, body: await response.text(), retryAfter: response.headers.get("Retry-After") };
    } catch (e) {
      throw new TransportError(`${method} ${url}: ${(e as Error).message}`);
    }
  }
}

export function parseJson(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.body);
  } catch (e) {
    throw new TransportError(`response is not valid JSON: ${(e as Error).message}`);
  }
}

/** Retry-After is delay-seconds or an HTTP-date (RFC 9110 §10.2.3); absent or unparseable names no time. */
export function parseRetryAfter(value: string | null, now: Date): Date | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return new Date(now.getTime() + Number(trimmed) * 1000);
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** GET a JSON body; 429 is a RateLimitedError, an auth refusal or other non-200 a QuotaFetchError. */
export async function getJson(http: Http, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await http.request("GET", url, headers, null);
  if (response.status === HTTP_TOO_MANY_REQUESTS) throw new RateLimitedError(url, response.retryAfter);
  if (response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN) {
    throw new QuotaFetchError(`auth rejected (HTTP ${response.status}) — credential expired or revoked?`);
  }
  if (response.status !== HTTP_OK) throw new QuotaFetchError(`HTTP ${response.status} from ${url}`);
  return parseJson(response);
}

export function bearer(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}
