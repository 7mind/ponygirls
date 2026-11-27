/** IDs of the entries Cuckoo numbers: objectives (`AO1`, …) and session-local rules (`AR1`, …). */
export type EntryKind = 'objective' | 'rule';
export const ENTRY_KINDS: readonly EntryKind[] = ['objective', 'rule'];
export const ID_PREFIX: Readonly<Record<EntryKind, string>> = { objective: 'AO', rule: 'AR' };
/** The next number of each kind; one counter per kind and session. */
export type NextNumbers = Readonly<Record<EntryKind, number>>;
const MAX_ID_DIGITS = 9;
const ID_PATTERN = new RegExp(`^(${ID_PREFIX.objective}|${ID_PREFIX.rule})([1-9][0-9]{0,${MAX_ID_DIGITS - 1}})$`);

export function entryId(kind: EntryKind, number: number): string {
  if (!Number.isSafeInteger(number) || number < 1 || String(number).length > MAX_ID_DIGITS) throw new Error(`Cuckoo ${kind} numbers are exhausted or invalid`);
  return `${ID_PREFIX[kind]}${number}`;
}

/** Kind and number of a well-formed ID; null for anything else. */
export function parseEntryId(value: unknown): { kind: EntryKind; number: number } | null {
  if (typeof value !== 'string') return null;
  const match = ID_PATTERN.exec(value);
  if (match === null) return null;
  return { kind: match[1] === ID_PREFIX.objective ? 'objective' : 'rule', number: Number(match[2]) };
}

/** A well-formed ID of the given kind, as saved data must hold it. */
export function savedEntryId(value: unknown, kind: EntryKind): string {
  const parsed = parseEntryId(value);
  if (parsed === null || parsed.kind !== kind) throw new Error(`Invalid saved Cuckoo ${kind} id`);
  return value as string;
}
