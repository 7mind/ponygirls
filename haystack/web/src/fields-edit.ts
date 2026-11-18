// Typed field rows of the record editor (spec §3.2 Edit). The model lives beside fields.ts, which reads fields for
// display: rows can hold text that is not valid yet (a number being typed), and serializing them reports problems
// per row instead of throwing. Numbers are LosslessNumber end to end, so big integers and long decimals survive.
import { LosslessNumber, stringify } from "lossless-json";
import { parseFields, type FieldValue, type TypedContent } from "./fields.ts";
import { isLosslessNumber, parseRaw, type JsonValue } from "./lossless-json.ts";

export type FieldKind = "md" | "text" | "code" | "string" | "number" | "boolean" | "null" | "json";
export type RowValue =
  | { kind: "md" | "text"; content: string }
  | { kind: "code"; content: string; language: string }
  | { kind: "string" | "number" | "json"; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };
export interface FieldRow { id: number; name: string; value: RowValue }
/**
 * The typed editor's view of a fields document: named rows (an object), one typed node at the root, or a document the
 * typed editor does not edit (an array or a scalar at the root: raw JSON only).
 */
export type FieldsEditing =
  | { shape: "rows"; rows: FieldRow[] }
  | { shape: "root"; value: TypedContent }
  | { shape: "raw-only" };
/** `target`: the control that holds the mistake, the field name or its value. */
export interface RowProblem { rowId: number; target: "name" | "value"; message: string }
export type Serialized = { ok: true; raw: string } | { ok: false; problems: RowProblem[] };

export const DEFAULT_CODE_LANGUAGE = "bash";
const DEFAULT_FIELD_NAME = "field";
const WHOLE_FIELDS = "fields";
const INDENT = 2;
const PARSE_PREFIX = /^unparseable JSON: /;

/** The editing model of `raw`; null when it is not valid JSON. */
export function editingOf(raw: string, nextId: () => number): FieldsEditing | null {
  let fields;
  try { fields = parseFields(raw); } catch { return null; }
  const first = fields[0];
  if (first !== undefined && first.name === null) {
    const value = first.value;
    return value.kind === "md" || value.kind === "text" || value.kind === "code" ? { shape: "root", value } : { shape: "raw-only" };
  }
  return { shape: "rows", rows: fields.map((field) => ({ id: nextId(), name: field.name!, value: rowValue(field.value) })) };
}

/** Objects and arrays whose compact JSON is at most this long are edited on one line (the limit of the record page's rows). */
const INLINE_JSON_MAX_CHARS = 80;

function rowValue(value: FieldValue): RowValue {
  switch (value.kind) {
    case "md": case "text": return { kind: value.kind, content: value.content };
    case "code": return { kind: "code", content: value.content, language: value.language };
    case "string": case "number": return { kind: value.kind, text: value.text };
    case "boolean": return { kind: "boolean", value: value.value };
    case "null": return { kind: "null" };
    case "json": {
      const compact = value.notice === null ? stringify(parseRaw(value.text)) : undefined;
      return { kind: "json", text: compact !== undefined && compact.length <= INLINE_JSON_MAX_CHARS ? compact : value.text };
    }
  }
}

function typedNode(value: Extract<RowValue, { content: string }>): JsonValue {
  return value.kind === "code" ? { type: "code", language: value.language, content: value.content } : { type: value.kind, content: value.content };
}

function jsonValue(value: RowValue): JsonValue {
  switch (value.kind) {
    case "md": case "text": case "code": return typedNode(value);
    case "string": return value.text;
    case "number": return new LosslessNumber(value.text.trim());
    case "boolean": return value.value;
    case "null": return null;
    case "json": return parseRaw(value.text);
  }
}

function problemsOf(row: FieldRow, duplicate: boolean): Array<Omit<RowProblem, "rowId">> {
  const problems: Array<Omit<RowProblem, "rowId">> = [];
  if (duplicate) problems.push({ target: "name", message: "Another field has this name" });
  const value = row.value;
  if (value.kind === "number") {
    let parsed: JsonValue | undefined;
    try { parsed = parseRaw(value.text.trim()); } catch { parsed = undefined; }
    if (parsed === undefined || !isLosslessNumber(parsed)) problems.push({ target: "value", message: "Not a JSON number: use digits such as 42, -0.5 or 1.5e3" });
  } else if (value.kind === "json") {
    try { parseRaw(value.text); } catch (error) { problems.push({ target: "value", message: `Not valid JSON: ${(error as Error).message.replace(PARSE_PREFIX, "")}` }); }
  } else if (value.kind === "code" && value.language.trim() === "") problems.push({ target: "value", message: "Choose a language" });
  return problems;
}

/** The fields object for `rows` as indented JSON, or every problem found. */
export function serializeRows(rows: readonly FieldRow[]): Serialized {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  const problems = rows.flatMap((row) => problemsOf(row, counts.get(row.name)! > 1).map((problem) => ({ rowId: row.id, ...problem })));
  if (problems.length > 0) return { ok: false, problems };
  const object: { [key: string]: JsonValue } = {};
  // defineProperty: a field named __proto__ must be an own property, not the prototype.
  for (const row of rows) Object.defineProperty(object, row.name, { value: jsonValue(row.value), enumerable: true, writable: true, configurable: true });
  const raw = stringify(object, null, INDENT);
  if (raw === undefined) throw new Error("Fields serialization returned no value");
  return { ok: true, raw };
}

const contentOf = (value: RowValue): string => {
  switch (value.kind) {
    case "md": case "text": case "code": return value.content;
    case "string": case "number": case "json": return value.text;
    case "boolean": return String(value.value);
    case "null": return "";
  }
};

/** `value` as another kind, keeping its content where the kinds share one and carrying other values as JSON text. */
export function retype(value: RowValue, kind: FieldKind): RowValue {
  if (value.kind === kind) return value;
  switch (kind) {
    case "md": case "text": return { kind, content: contentOf(value) };
    case "code": return { kind, content: contentOf(value), language: DEFAULT_CODE_LANGUAGE };
    case "string": return { kind, text: contentOf(value) };
    case "number": return { kind, text: value.kind === "string" || value.kind === "json" ? value.text : "0" };
    case "boolean": return { kind, value: value.kind === "string" || value.kind === "json" ? value.text.trim() === "true" : false };
    case "null": return { kind };
    case "json": return { kind, text: jsonTextOf(value) };
  }
}

function jsonTextOf(value: RowValue): string {
  switch (value.kind) {
    case "string": return JSON.stringify(value.text);
    case "number": case "json": return value.text;
    case "boolean": return String(value.value);
    case "null": return "null";
    case "md": case "text": case "code": {
      const text = stringify(typedNode(value), null, INDENT);
      if (text === undefined) throw new Error("JSON serialization returned no value");
      return text;
    }
  }
}

/** A name for a new field that no row has. */
export function newFieldName(rows: readonly FieldRow[]): string {
  const taken = new Set(rows.map((row) => row.name));
  let name = DEFAULT_FIELD_NAME;
  for (let n = 2; taken.has(name); n++) name = `${DEFAULT_FIELD_NAME}-${n}`;
  return name;
}

/** Names of the fields that differ between two fields documents; the whole document when either is not an object of fields. */
export function changedFields(base: string, current: string): string[] {
  let before, after;
  try { before = parseFields(base); after = parseFields(current); } catch { return [WHOLE_FIELDS]; }
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (same) return [];
  if (before.some((field) => field.name === null) || after.some((field) => field.name === null)) return [WHOLE_FIELDS];
  const of = (fields: typeof before) => new Map(fields.map((field) => [field.name!, JSON.stringify(field.value)]));
  const was = of(before), now = of(after);
  const names = [...was.keys()].filter((name) => was.get(name) !== now.get(name)).concat([...now.keys()].filter((name) => !was.has(name)));
  return names.length === 0 ? [WHOLE_FIELDS] : names;
}
