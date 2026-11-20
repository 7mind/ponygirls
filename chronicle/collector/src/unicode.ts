import { CollectorError, object } from './domain.ts';

/** Version of the collector's normalization of derived strings (append-only ingest spec §5). 1: none (earlier
 * releases); 2: unpaired UTF-16 surrogates in message text and readable metadata become U+FFFD. Message chain v1 covers
 * the normalized text, so a change here needs a new version: otherwise every append would become a replacement. */
export const NORMALIZATION_VERSION = 2;
/** An identifier (session, subagent, message or parent id, role) holds an unpaired surrogate: refused locally. */
export const IDENTIFIER_UNICODE = 'invalid-identifier-unicode';

/** The string with every unpaired UTF-16 surrogate replaced by U+FFFD, and how many were replaced. */
export function wellFormed(value: string): { value: string; replaced: number } {
  if (value.isWellFormed()) return { value, replaced: 0 };
  let replaced = 0;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
    else replaced++;
  }
  return { value: value.toWellFormed(), replaced };
}
/** Identifiers are never rewritten: one that is not scalar Unicode refuses the file. */
export function requireScalar(...identifiers: (string | null)[]): void {
  if (identifiers.some(identifier => identifier !== null && !identifier.isWellFormed())) throw new CollectorError(IDENTIFIER_UNICODE);
}
const wellFormedJson = (value: unknown): boolean => typeof value === 'string' ? value.isWellFormed()
  : Array.isArray(value) ? value.every(wellFormedJson) : object(value) ? Object.values(value).every(wellFormedJson) : true;
/** A queued whole payload built before this normalization that the server refuses as non-scalar: it must be rebuilt
 * from its file; resending its bytes cannot succeed, and the server never committed it. */
export function payloadPredatesNormalization(payload: string, normalization: number | undefined): boolean {
  if (normalization === NORMALIZATION_VERSION) return false;
  try { return !wellFormedJson(JSON.parse(payload) as unknown); } catch { return false; }
}
