/**
 * Token/time normalization and once-only checkpoints. Pure; no Pi imports.
 * Reference token calculation is uncached input plus output:
 * where Pi reports disjoint input/cacheWrite/output, count = input + cacheWrite + output.
 */

export interface UsageLike {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  reasoning?: unknown;
  totalTokens?: unknown;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Normalize one finalized usage observation to chargeable tokens.
 * - `input` is already uncached: do NOT subtract cacheRead.
 * - `cacheWrite` is disjoint: add it.
 * - `reasoning` is a subset of output: never add it separately.
 * Returns undefined when required fields are missing/unknown.
 */
export function normalizeTokens(usage: UsageLike): number | undefined {
  const input = toNonNegativeNumber(usage.input);
  const output = toNonNegativeNumber(usage.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheWrite = toNonNegativeNumber(usage.cacheWrite) ?? 0;
  const total = input + cacheWrite + output;
  if (!Number.isSafeInteger(Math.trunc(total))) {
    // Token counts beyond safe integer range are not chargeable precisely.
    return undefined;
  }
  return Math.trunc(total);
}

export interface ChargeResult {
  tokensUsed: number;
  /** True when usage fields were missing so the cap cannot be enforced. */
  unknownUsage: boolean;
}

export function chargeTokens(
  current: number,
  observations: readonly UsageLike[],
  seen: Set<string>,
  entryIds: readonly string[],
): ChargeResult {
  let tokens = current;
  let unknown = false;
  for (let i = 0; i < observations.length; i++) {
    const entryId = entryIds[i] ?? `obs-${i}`;
    if (seen.has(entryId)) continue;
    const normalized = normalizeTokens(observations[i]!);
    if (normalized === undefined) {
      unknown = true;
      continue;
    }
    tokens += normalized;
    seen.add(entryId);
  }
  return { tokensUsed: tokens, unknownUsage: unknown };
}

/** Elapsed active seconds between monotonic readings, preserving remainders. */
export function elapsedSeconds(
  startMs: number,
  endMs: number,
  carryRemainderMs: number,
): { seconds: number; remainderMs: number } {
  const delta = Math.max(0, endMs - startMs + carryRemainderMs);
  const seconds = Math.floor(delta / 1000);
  return { seconds, remainderMs: delta - seconds * 1000 };
}

export interface CheckpointState {
  /** Finalized entry ids already charged. */
  chargedEntryIds: Set<string>;
  /** Baseline entry count at goal creation; earlier conversation costs excluded. */
  baselineSet: boolean;
  /** Monotonic start of the current active span, or null when idle. */
  spanStartMs: number | null;
  remainderMs: number;
  unknownUsageSeen: boolean;
}

export function emptyCheckpoints(): CheckpointState {
  return { chargedEntryIds: new Set(), baselineSet: false, spanStartMs: null, remainderMs: 0, unknownUsageSeen: false };
}
