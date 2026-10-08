// Haystack auth: bearer token codec (normative: docs/auth.md §1).
// Tokens are 32 random bytes as canonical unpadded base64url (43 chars).
// Files hold exactly those bytes plus at most one final LF; HTTP/cookie
// values carry no terminator. Digests hash the exact ASCII token bytes.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const DIGEST_RE = /^[0-9a-f]{64}$/;

export class TokenFault extends Error {
  readonly code = "unauthorized";
  constructor(message = "invalid credentials") {
    super(message);
    this.name = "TokenFault";
  }
}

/** Generate a fresh token (operator procedure; never logged). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of the exact ASCII token bytes. */
export function hashToken(token: string): string {
  if (!TOKEN_RE.test(token)) throw new TokenFault();
  return createHash("sha256").update(token, "ascii").digest("hex");
}

/** Read and validate a runtime token file: exactly the token plus at most
 *  one final LF. Rejects multiline, CRLF, NUL, and noncanonical encodings. */
export async function readTokenFile(path: string): Promise<string> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch {
    throw new TokenFault("unreadable credential file");
  }
  if (raw.length === 0) throw new TokenFault("empty credential file");
  if (raw.includes(0)) throw new TokenFault("NUL in credential file");
  if (raw.includes(13)) throw new TokenFault("CR in credential file");
  let text = raw.toString("ascii");
  if (/[^\x20-\x7e\n]/.test(text)) throw new TokenFault("non-ASCII in credential file");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  if (text.includes("\n")) throw new TokenFault("multiline credential file");
  if (!TOKEN_RE.test(text)) throw new TokenFault("malformed credential file");
  return text;
}

/** Read and validate a digest file: 64 lowercase hex plus at most one LF. */
export async function readDigestFile(path: string): Promise<string> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch {
    throw new TokenFault("unreadable digest file");
  }
  let text = raw.toString("ascii");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  if (!DIGEST_RE.test(text)) throw new TokenFault("malformed digest file");
  return text;
}

/** Constant-time digest comparison across all candidates (no early exit on
 *  the common prefix, no map-lookup timing signal). */
export function matchDigest(presentedHex: string, candidates: string[]): string | null {
  const presented = Buffer.from(presentedHex, "hex");
  let found: string | null = null;
  for (const candidate of candidates) {
    const buf = Buffer.from(candidate, "hex");
    if (presented.length === buf.length && timingSafeEqual(presented, buf)) found = candidate;
  }
  return found;
}
