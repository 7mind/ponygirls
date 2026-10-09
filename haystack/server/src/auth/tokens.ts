// Haystack auth: bearer token codec (normative: docs/auth.md §1).
// Tokens are 32 random bytes as canonical unpadded base64url (43 chars).
// Files hold exactly those bytes plus at most one final LF; HTTP/cookie
// values carry no terminator. Digests hash the exact ASCII token bytes.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const DIGEST_RE = /^[0-9a-f]{64}$/;

/** Canonical token: 43 base64url chars decoding to 32 bytes with identical re-encoding.
 *  Rejects non-canonical pad-bit aliases that pass the charset regex. */
export function isCanonicalToken(token: string): boolean {
  if (!TOKEN_RE.test(token)) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(token, "base64url");
  } catch {
    return false;
  }
  if (decoded.length !== 32) return false;
  return decoded.toString("base64url") === token;
}

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
  if (!isCanonicalToken(token)) throw new TokenFault();
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
  // Byte-level validation before any ascii decoding: Node ascii decoding
  // strips high bits (0xC1 -> 'A'), so raw-byte aliases must be rejected here.
  let body = raw;
  if (body[body.length - 1] === 10) body = body.subarray(0, body.length - 1);
  if (body.includes(10)) throw new TokenFault("multiline credential file");
  if (body.length !== 43) throw new TokenFault("malformed credential file");
  for (let i = 0; i < body.length; i++) {
    const b = body[i]!;
    const ok = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 45 || b === 95;
    if (!ok) throw new TokenFault("malformed credential file");
  }
  const text = body.toString("ascii");
  if (!isCanonicalToken(text)) throw new TokenFault("malformed credential file");
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
  if (raw.length === 0) throw new TokenFault("malformed digest file");
  // Byte-level validation before ascii decoding (high-bit aliases like 0xE6->'f' must be rejected).
  let body = raw;
  if (body[body.length - 1] === 10) body = body.subarray(0, body.length - 1);
  if (body.includes(10)) throw new TokenFault("malformed digest file");
  if (body.includes(0)) throw new TokenFault("malformed digest file");
  if (body.includes(13)) throw new TokenFault("malformed digest file");
  if (body.length !== 64) throw new TokenFault("malformed digest file");
  for (let i = 0; i < body.length; i++) {
    const b = body[i]!;
    const ok = (b >= 48 && b <= 57) || (b >= 97 && b <= 102);
    if (!ok) throw new TokenFault("malformed digest file");
  }
  return body.toString("ascii");
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
