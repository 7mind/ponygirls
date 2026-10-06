/**
 * ponygirls-tokemon — tolerant readers for provider JSON (ported from
 * tokemon's adapters/common.py). Provider payloads are untrusted input:
 * every field is checked before use.
 */

import { QuotaFetchError } from "./quota.ts";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(payload: unknown, context: string): JsonObject {
  if (!isObject(payload)) throw new QuotaFetchError(`${context}: expected a JSON object, got ${Array.isArray(payload) ? "list" : payload === null ? "null" : typeof payload}`);
  return payload;
}

/** A number, or a numeric string; booleans and anything else are null. */
export function optionalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function optionalInt(value: unknown): number | null {
  const parsed = optionalNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** ISO date or datetime strings; a datetime without a zone is UTC (as tokemon reads it). */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const zoned = /T\d/.test(value) && !/(Z|[+-]\d\d:?\d\d)$/i.test(value) ? `${value}Z` : value;
  const ms = Date.parse(zoned);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function epochSeconds(value: unknown): Date | null {
  const seconds = optionalNumber(value);
  return seconds === null || seconds <= 0 ? null : new Date(seconds * 1000);
}

export function epochMillis(value: unknown): Date | null {
  const millis = optionalNumber(value);
  return millis === null || millis <= 0 ? null : new Date(millis);
}

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;

/** A window length as "7d", "5h", or "30m". */
export function humanizeSeconds(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds % SECONDS_PER_DAY === 0) return `${Math.trunc(seconds / SECONDS_PER_DAY)}d`;
  if (seconds % SECONDS_PER_HOUR === 0) return `${Math.trunc(seconds / SECONDS_PER_HOUR)}h`;
  return `${Math.trunc(seconds / 60)}m`;
}

export function topLevelKeys(payload: unknown): string {
  if (isObject(payload)) return Object.keys(payload).sort().join(", ");
  return Array.isArray(payload) ? "list" : payload === null ? "null" : typeof payload;
}
