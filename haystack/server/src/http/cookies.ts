// Haystack HTTP: session cookie codec. Cookie value is the raw token (no
// terminator); tokens never appear in URLs, logs, or tracing.
// The __Host- prefix requires Secure + HTTPS, so it is production-only:
// loopback development uses an explicit separate plain name (browsers reject
// Secure-less __Host- cookies outright, which browser tests proved).
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
