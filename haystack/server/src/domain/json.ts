// Haystack domain: the single lossless JSON codec (decisions.md #4).
// Every JSON number is a LosslessNumber; plain JS numbers never represent
// stored data. Raw text crosses transports; numeric source tokens are
// materialized into LosslessNumber instances here.
import {
  parse as llParse,
  stringify as llStringify,
  isLosslessNumber,
  LosslessNumber,
} from "lossless-json";

export type { LosslessNumber };
export { isLosslessNumber };

export type JsonValue =
  | null
  | boolean
  | string
  | LosslessNumber
  | JsonValue[]
  | { [key: string]: JsonValue };

export class BadEnvelope extends Error {
  readonly code = "bad-envelope";
  constructor(message: string) {
    super(message);
    this.name = "BadEnvelope";
  }
}

interface JsonSourceContext { source?: string }
type SourceReviver = (key: string, value: unknown, context: JsonSourceContext) => unknown;

/** Parse raw JSON text. Rejects syntax errors, trailing commas,
 *  duplicate keys, and anything outside the JSON domain. */
export function parseRaw(text: string): JsonValue {
  let value: JsonValue;
  try {
    // Retain the codec's duplicate-key validation, but materialize objects
    // with native JSON semantics: lossless-json assigns __proto__ as a setter.
    llParse(text);
    const parseWithSource = JSON.parse as (raw: string, reviver: SourceReviver) => JsonValue;
    value = parseWithSource(text, (_key, parsed, context) => {
      if (typeof parsed !== "number") return parsed;
      if (context === undefined || typeof context.source !== "string") {
        throw new Error("This runtime must support JSON.parse source context for exact numbers");
      }
      return new LosslessNumber(context.source);
    });
  } catch (err) {
    throw new BadEnvelope(`unparseable JSON: ${(err as Error).message}`);
  }
  checkNumberRanges(value);
  return value;
}

/** Enforce the disclosed exponent bound on every number in one walk, so no
 *  path (storage, query literals, digests) can smuggle an absurd exponent
 *  into exact decimal comparison. */
function checkNumberRanges(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(checkNumberRanges);
    return;
  }
  if (value !== null && typeof value === "object") {
    if (isLosslessNumber(value)) {
      splitDecimal(value.toString()); // throws BadEnvelope when out of range
      return;
    }
    Object.values(value).forEach(checkNumberRanges);
  }
}

/** Canonical form: object keys sorted recursively, array order kept,
 *  numbers in lossless decimal form. */
export function canonicalize(value: JsonValue): string {
  return llStringify(canonicalValue(value))!;
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    if (isLosslessNumber(value)) return value;
    const out: { [key: string]: JsonValue } = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]!);
    return out;
  }
  return value;
}

/** Parse raw text straight to canonical form (single parse). */
export function canonicalizeRaw(text: string): string {
  return canonicalize(parseRaw(text));
}

/** Compare two JSON numbers exactly (no binary FP). Returns -1/0/1. */
export function compareNumbers(a: LosslessNumber, b: LosslessNumber): number {
  const [ai, af, ae] = splitDecimal(a.toString());
  const [bi, bf, be] = splitDecimal(b.toString());
  // Normalize to (sign, integer digits, scale, exponent).
  const an = normalize(ai, af, ae);
  const bn = normalize(bi, bf, be);
  if (an.sign !== bn.sign) return an.sign < bn.sign ? -1 : 1;
  const mag = compareMagnitude(an.digits, an.scale, bn.digits, bn.scale);
  return an.sign < 0 ? -mag : mag;
}

interface Normalized {
  sign: number;
  digits: string; // no leading zeros (except "0")
  scale: number; // digits after the decimal point
}

function splitDecimal(s: string): [string, string, number] {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) throw new BadEnvelope(`not a JSON number: ${s}`);
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  // Disclosed bound (rejection, never rounding): exponents beyond ±999999
  // would materialize millions of digits in exact comparison.
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 999999) {
    throw new BadEnvelope(`number exponent out of range: ${s}`);
  }
  return [m[1]! + m[2]!, m[3] ?? "", exp];
}

function normalize(intPart: string, fracPart: string, exp: number): Normalized {
  const sign = intPart.startsWith("-") ? -1 : 1;
  let digits = (intPart.replace(/^-/, "") + fracPart).replace(/^0+/, "");
  let scale = fracPart.length - exp;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (digits === "") digits = "0";
  return { sign: digits === "0" ? 0 : sign, digits, scale };
}

function compareMagnitude(a: string, aScale: number, b: string, bScale: number): number {
  const scale = Math.max(aScale, bScale);
  const ai = a + "0".repeat(scale - aScale);
  const bi = b + "0".repeat(scale - bScale);
  const ni = ai.replace(/^0+/, "") || "0";
  const mi = bi.replace(/^0+/, "") || "0";
  if (ni.length !== mi.length) return ni.length < mi.length ? -1 : 1;
  return ni < mi ? -1 : ni > mi ? 1 : 0;
}
