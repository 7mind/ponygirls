// Haystack auth: static user/token configuration. The operator owns user
// and token lifecycle; this loader validates everything and fails closed.
// Removing a token/user plus restart/reload revokes it everywhere.
import { hashToken, matchDigest, readDigestFile, TOKEN_RE } from "./tokens.js";
import type { Principal, UserType } from "../domain/document.js";

export interface TokenConfig {
  readonly id: string;
  /** Runtime path to the SHA-256 hex digest file (systemd credential). */
  readonly hashFile: string;
}

export interface UserConfig {
  readonly id: string;
  readonly type: UserType;
  readonly displayName: string;
  readonly tokens: readonly TokenConfig[];
}

export interface HaystackConfig {
  readonly activityProjectId: string;
  readonly users: readonly UserConfig[];
  /** Require Secure cookies (production). Explicitly false for loopback dev. */
  readonly cookieSecure: boolean;
  /** Allowed Host header hostnames (port ignored). */
  readonly allowedHosts: readonly string[];
  /** Allowed Origin values for login + cookie-authenticated mutations. */
  readonly allowedOrigins: readonly string[];
  readonly rateLimit?: { readonly windowMs: number; readonly max: number };
}

export interface ResolvedAuth {
  readonly config: HaystackConfig;
  readonly activityProjectId: string;
  /** Look up the principal for a presented bearer/cookie token. */
  authenticate(token: string): Principal | null;
}

const USER_ID_RE = /^[^\s:]{1,128}$/;
const TOKEN_ID_RE = /^[^\s:]{1,64}$/;

/** Load and validate static configuration. Throws (fail closed) on any
 *  inconsistency — never starts anonymous or picks another identity. */
export async function loadAuth(config: HaystackConfig): Promise<ResolvedAuth> {
  if (!config.activityProjectId) throw new Error("activityProjectId is required");
  if (config.users.length === 0) throw new Error("at least one user is required");
  const seenUsers = new Set<string>();
  const digestToPrincipal = new Map<string, Principal>();
  for (const user of config.users) {
    if (!USER_ID_RE.test(user.id)) throw new Error(`invalid user id: ${user.id}`);
    if (seenUsers.has(user.id)) throw new Error(`duplicate user id: ${user.id}`);
    seenUsers.add(user.id);
    if (user.type !== "human" && user.type !== "agent") throw new Error(`invalid type for ${user.id}`);
    if (user.tokens.length === 0) throw new Error(`user ${user.id} has no tokens`);
    const seenTokens = new Set<string>();
    for (const token of user.tokens) {
      if (!TOKEN_ID_RE.test(token.id)) throw new Error(`invalid token id for ${user.id}`);
      if (seenTokens.has(token.id)) throw new Error(`duplicate token id ${token.id} for ${user.id}`);
      seenTokens.add(token.id);
      const digest = await readDigestFile(token.hashFile);
      const principal: Principal = { userId: user.id, type: user.type, tokenId: token.id };
      const clash = digestToPrincipal.get(digest);
      if (clash) {
        throw new Error(`digest assigned twice: ${clash.userId}/${clash.tokenId} and ${user.id}/${token.id}`);
      }
      digestToPrincipal.set(digest, principal);
    }
  }
  const digests = [...digestToPrincipal.keys()];
  return {
    config,
    activityProjectId: config.activityProjectId,
    authenticate(token: string): Principal | null {
      if (!TOKEN_RE.test(token)) return null;
      const matched = matchDigest(hashToken(token), digests);
      return matched === null ? null : (digestToPrincipal.get(matched) ?? null);
    },
  };
}
