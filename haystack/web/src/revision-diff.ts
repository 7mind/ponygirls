import type { Item } from "./api.ts";
import { parseFields, type FieldValue } from "./fields.ts";

/** Character range [start, end) of the words that differ from the paired line of the other revision. */
export interface Mark { readonly start: number; readonly end: number }
export type DiffLine =
  | { readonly kind: "same" | "add" | "del"; readonly text: string; readonly mark: Mark | null }
  | { readonly kind: "skip"; readonly count: number };
export type TextDiff =
  | { readonly kind: "lines"; readonly lines: readonly DiffLine[]; readonly added: number; readonly removed: number }
  | { readonly kind: "too-large"; readonly beforeLines: number; readonly afterLines: number };

/** Largest changed region (lines before × lines after) compared line by line; larger regions are reported, not computed. */
export const DIFF_CELL_LIMIT = 4_000_000;
/** Unchanged lines kept around a change; longer unchanged runs fold into a skip line. */
const CONTEXT_LINES = 3;
const WORDS = /(\s+)/;

type Change = { kind: "same" | "add" | "del"; text: string };

/** Longest-common-subsequence edit script of two line lists; deletions precede insertions within a change. */
function editScript(a: readonly string[], b: readonly string[]): Change[] {
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  const script: Change[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { script.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (j < b.length && (i === a.length || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)) { script.push({ kind: "add", text: b[j]! }); j++; }
    else { script.push({ kind: "del", text: a[i]! }); i++; }
  }
  return script;
}

/**
 * Marks of a replaced line pair: the words between their common leading and trailing words; a pair of single words
 * (a date, a number, an identifier) is compared by characters.
 */
function marks(before: string, after: string): [Mark | null, Mark | null] {
  const single = !WORDS.test(before) && !WORDS.test(after);
  const a = single ? [...before] : before.split(WORDS), b = single ? [...after] : after.split(WORDS);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const length = (tokens: string[], from: number, to: number) => tokens.slice(from, to).join("").length;
  const mark = (tokens: string[], text: string): Mark | null => {
    const start = length(tokens, 0, prefix), end = text.length - length(tokens, tokens.length - suffix, tokens.length);
    return start === 0 && end === text.length ? null : { start, end };
  };
  return [mark(a, before), mark(b, after)];
}

/** Groups each change block as deletions then insertions, pairs them for word marks and folds long unchanged runs. */
function present(script: readonly Change[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let index = 0;
  while (index < script.length) {
    if (script[index]!.kind === "same") {
      const start = index;
      while (index < script.length && script[index]!.kind === "same") index++;
      const run = script.slice(start, index).map((change): DiffLine => ({ kind: "same", text: change.text, mark: null }));
      const head = start === 0 ? 0 : CONTEXT_LINES, tail = index === script.length ? 0 : CONTEXT_LINES;
      if (run.length > head + tail + 1) lines.push(...run.slice(0, head), { kind: "skip", count: run.length - head - tail }, ...run.slice(run.length - tail));
      else lines.push(...run);
      continue;
    }
    const removed: string[] = [], added: string[] = [];
    while (index < script.length && script[index]!.kind !== "same") {
      const change = script[index++]!;
      (change.kind === "del" ? removed : added).push(change.text);
    }
    const pairs = removed.map((text, i) => i < added.length ? marks(text, added[i]!) : [null, null] as const);
    lines.push(...removed.map((text, i): DiffLine => ({ kind: "del", text, mark: pairs[i]![0] })));
    lines.push(...added.map((text, i): DiffLine => ({ kind: "add", text, mark: i < pairs.length ? pairs[i]![1] : null })));
  }
  return lines;
}

/** What a diff compares: lines (field content) or paragraphs separated by blank lines (prose). */
export type DiffUnit = "lines" | "paragraphs";
const UNIT_SEPARATORS: Readonly<Record<DiffUnit, RegExp>> = { lines: /\n/, paragraphs: /\n\s*\n/ };

/** Diff of two texts (older first) by `unit`. */
export function diffText(before: string, after: string, unit: DiffUnit): TextDiff {
  const a = before === "" ? [] : before.split(UNIT_SEPARATORS[unit]), b = after === "" ? [] : after.split(UNIT_SEPARATORS[unit]);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const middleA = a.slice(start, a.length - end), middleB = b.slice(start, b.length - end);
  if (middleA.length * middleB.length > DIFF_CELL_LIMIT) return { kind: "too-large", beforeLines: a.length, afterLines: b.length };
  const same = (lines: readonly string[]): Change[] => lines.map((text) => ({ kind: "same", text }));
  const script = [...same(a.slice(0, start)), ...editScript(middleA, middleB), ...same(a.slice(a.length - end))];
  return { kind: "lines", lines: present(script), added: script.filter((c) => c.kind === "add").length, removed: script.filter((c) => c.kind === "del").length };
}

/** The chip label of a field value: its typed-content type, code language or JSON type. */
export function fieldLabel(value: FieldValue): string {
  switch (value.kind) {
    case "md": return "Markdown";
    case "code": return `code · ${value.language}`;
    case "json": return value.jsonType;
    default: return value.kind;
  }
}

/** The text a field value is compared by: typed content verbatim, scalars as written, objects and arrays pretty-printed. */
export function fieldText(value: FieldValue): string {
  switch (value.kind) {
    case "md": case "text": case "code": return value.content;
    case "string": case "number": return value.text;
    case "boolean": return String(value.value);
    case "null": return "null";
    case "json": return value.text;
  }
}

export interface ValueChange { readonly name: string; readonly before: string; readonly after: string }
export interface FieldChange {
  readonly name: string;
  readonly state: "changed" | "added" | "removed";
  /** Type label; "old → new" when the type changed. */
  readonly label: string;
  readonly diff: TextDiff;
}
export interface Comparison {
  /** null when unchanged. */
  readonly description: TextDiff | null;
  readonly metadata: readonly ValueChange[];
  readonly links: TextDiff | null;
  readonly fields: readonly FieldChange[];
  /** Names of the compared parts that are equal in both revisions. */
  readonly unchanged: readonly string[];
}

const fieldName = (name: string | null) => name === null ? "Value" : name;
const linkLines = (item: Item) => item.document.links.map(([relation, target]) => `${relation} ${target}`).join("\n");

/** Differences from the older to the newer revision of one record. */
export function compareRevisions(older: Item, newer: Item): Comparison {
  const unchanged: string[] = [];
  const metadata: ValueChange[] = [];
  const scalar = (item: Item): ReadonlyArray<[string, string]> => [
    ["title", item.document.title], ["type", item.document.type], ["status", item.document.status],
    ["importance", item.document.importance], ["human-attention", item.document.humanAttention], ["tags", item.document.tags.join(", ")],
  ];
  const after = scalar(newer);
  scalar(older).forEach(([name, before], index) => {
    const value = after[index]![1];
    if (before === value) unchanged.push(name);
    else metadata.push({ name, before, after: value });
  });
  const description = older.document.description === newer.document.description ? null : diffText(older.document.description, newer.document.description, "paragraphs");
  if (description === null) unchanged.push("description");
  const links = linkLines(older) === linkLines(newer) ? null : diffText(linkLines(older), linkLines(newer), "lines");
  if (links === null) unchanged.push("links");
  const beforeFields = new Map(parseFields(older.document.fieldsJson).map((field) => [fieldName(field.name), field.value]));
  const afterFields = new Map(parseFields(newer.document.fieldsJson).map((field) => [fieldName(field.name), field.value]));
  const fields: FieldChange[] = [];
  for (const name of new Set([...afterFields.keys(), ...beforeFields.keys()])) {
    const before = beforeFields.get(name), value = afterFields.get(name);
    const text = (field: FieldValue | undefined) => field === undefined ? "" : fieldText(field);
    const label = before === undefined ? fieldLabel(value!) : value === undefined || fieldLabel(before) === fieldLabel(value) ? fieldLabel(before) : `${fieldLabel(before)} → ${fieldLabel(value)}`;
    if (before !== undefined && value !== undefined && fieldLabel(before) === fieldLabel(value) && fieldText(before) === fieldText(value)) { unchanged.push(name); continue; }
    fields.push({ name, label, state: before === undefined ? "added" : value === undefined ? "removed" : "changed", diff: diffText(text(before), text(value), "lines") });
  }
  return { description, metadata, links, fields, unchanged };
}

/** Names of the parts that differ, in page order (description, metadata, links, fields). */
export function changedParts(comparison: Comparison): string[] {
  return [
    ...(comparison.description === null ? [] : ["description"]),
    ...comparison.metadata.map((change) => change.name),
    ...(comparison.links === null ? [] : ["links"]),
    ...comparison.fields.map((field) => field.name),
  ];
}
