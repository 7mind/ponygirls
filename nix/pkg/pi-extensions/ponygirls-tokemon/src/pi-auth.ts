/**
 * ponygirls-tokemon — the secret inside pi's resolved request auth. Most
 * providers resolve to an `apiKey`; some OAuth logins (kimi-coding) resolve to
 * request headers only, with the access token as `Authorization: Bearer …`.
 */

/** The parts of pi-ai's ModelAuth this reads. */
export interface ResolvedAuth {
  apiKey?: string;
  headers?: Record<string, string | null>;
}

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export function secretOf(auth: ResolvedAuth): string | null {
  if (auth.apiKey) return auth.apiKey;
  for (const [name, value] of Object.entries(auth.headers ?? {})) {
    if (name.toLowerCase() !== "authorization" || value === null) continue;
    const match = BEARER_PATTERN.exec(value.trim());
    if (match) return match[1]!;
  }
  return null;
}
