import { isLosslessNumber, stringify, type LosslessNumber } from "lossless-json";
import { parseRaw as parse } from "../../server/src/domain/json.ts";

type JsonValue = string | boolean | null | LosslessNumber | JsonValue[] | JsonObject;
interface JsonObject { [key: string]: JsonValue }
export type TypedContent = { kind: "md" | "text"; content: string } | { kind: "code"; content: string; language: string };
export type FieldValue = TypedContent | { kind: "string" | "number"; text: string } |
  { kind: "boolean"; value: boolean } | { kind: "null" } |
  { kind: "json"; jsonType: "object" | "array"; text: string; notice: string | null };
export interface FieldEntry { name: string | null; value: FieldValue }
export type FieldsInspection = { fields: FieldEntry[]; error: null } | { fields: null; error: string };

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isLosslessNumber(value);
}

function typedContent(value: JsonObject): TypedContent | null {
  if (typeof value.content !== "string") return null;
  const keys = Object.keys(value);
  if (keys.length === 2 && (value.type === "md" || value.type === "text")) {
    return { kind: value.type, content: value.content };
  }
  if (keys.length === 3 && value.type === "code" && typeof value.language === "string" && value.language.trim() !== "") {
    return { kind: "code", content: value.content, language: value.language };
  }
  return null;
}

function displayValue(value: JsonValue): FieldValue {
  if (value === null) return { kind: "null" };
  if (typeof value === "string") return { kind: "string", text: value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (isLosslessNumber(value)) return { kind: "number", text: value.toString() };
  let notice: string | null = null;
  if (isObject(value)) {
    const typed = typedContent(value);
    if (typed !== null) return typed;
    if (value.type === "md" || value.type === "code" || value.type === "text" ||
        (typeof value.type === "string" && Object.hasOwn(value, "content"))) {
      notice = "Unsupported typed node or additional metadata; displaying the complete JSON value.";
    }
  }
  const text = stringify(value, null, 2);
  if (text === undefined) throw new Error("JSON field serialization returned no value");
  return { kind: "json", jsonType: Array.isArray(value) ? "array" : "object", text, notice };
}

export function parseFields(raw: string): FieldEntry[] {
  const value = parse(raw) as JsonValue;
  if (isObject(value)) {
    const typed = typedContent(value);
    if (typed !== null) return [{ name: null, value: typed }];
    return Object.entries(value).map(([name, field]) => ({ name, value: displayValue(field) }));
  }
  return [{ name: null, value: displayValue(value) }];
}

export function inspectFields(raw: string): FieldsInspection {
  try {
    return { fields: parseFields(raw), error: null };
  } catch (error) {
    return { fields: null, error: `Invalid JSON: ${error instanceof Error ? error.message : "Unable to parse fields."}` };
  }
}

export function updateTypedField(raw: string, name: string | null, content: TypedContent): string {
  const value = parse(raw) as JsonValue;
  const target = name === null ? value : isObject(value) && Object.hasOwn(value, name) ? value[name]! : null;
  if (!isObject(target) || typedContent(target) === null) throw new Error("Expected an existing typed field");
  if (content.kind === "code" && content.language.trim() === "") throw new Error("Code language must not be empty");
  const replacement: JsonObject = content.kind === "code" ?
    { type: "code", language: content.language, content: content.content } : { type: content.kind, content: content.content };
  if (name !== null) {
    if (!isObject(value)) throw new Error("Expected a fields object");
    Object.defineProperty(value, name, { value: replacement, enumerable: true, writable: true, configurable: true });
  }
  const result = stringify(name === null ? replacement : value, null, 2);
  if (result === undefined) throw new Error("JSON field serialization returned no value");
  return result;
}
