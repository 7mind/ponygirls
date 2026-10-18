import type { IncomingHttpHeaders } from "node:http";
import type { HaystackConfig } from "../auth/config.js";

// Haystack HTTP: session cookie codec. Cookie value is the raw token (no
// terminator); tokens never appear in URLs, logs, or tracing.
// The __Host- prefix requires Secure + HTTPS. Explicit HTTP opt-ins and the
// global development override use the separate legacy plain name haystack-dev
// (browsers reject Secure-less __Host- cookies outright).
export const COOKIE_NAME_SECURE = "__Host-haystack";
export const COOKIE_NAME_DEV = "haystack-dev";
export const COOKIE_MAX_AGE = 15552000; // 180 days, renewed on activity

export function cookieName(secure: boolean): string {
  return secure ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV;
}

/** Extract the session token from a Cookie header (exact name match). */
export function parseSessionCookie(header: string | string[] | undefined, name: string): string | null {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Serialize Set-Cookie for login (renewed lifetime) or logout (cleared). */
export function serializeSessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${cookieName(secure)}=${token ?? ""}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  parts.push(`Max-Age=${token === null ? 0 : COOKIE_MAX_AGE}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Only configured public authorities select an insecure cookie. Never trust
 * client-supplied forwarding headers or infer policy from the backend socket
 * (both public transports may terminate at a reverse proxy).
 */
export function requestCookieSecure(config: HaystackConfig, headers: IncomingHttpHeaders): boolean {
  return config.cookieSecure && insecureRequestOrigin(config, headers) === undefined;
}

function insecureRequestOrigin(config: HaystackConfig, headers: IncomingHttpHeaders): string | undefined {
  const host = headers.host;
  if (!host || /[\s/@?#\\]/.test(host)) return undefined;
  let authority: string;
  try { authority = new URL(`http://${host}`).host; }
  catch { return undefined; }
  return config.insecureHttpOrigins?.find((origin) => new URL(origin).host === authority);
}

/** Preserve legacy origin policy unless an opted-in authority is involved.
 * An allowed HTTPS Origin must not authorize an HTTP-cookie request, nor may
 * an HTTP Origin select a plain cookie on a different Host/port.
 */
export function cookieOriginMatches(config: HaystackConfig, headers: IncomingHttpHeaders): boolean {
  if (headers.origin === undefined) return true;
  const selected = insecureRequestOrigin(config, headers);
  if (selected !== undefined) return headers.origin === selected;
  return !config.insecureHttpOrigins?.includes(headers.origin);
}
