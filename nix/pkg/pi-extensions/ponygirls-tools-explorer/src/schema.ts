/**
 * A readable outline of a tool's parameters: one row per top-level property
 * with a short type. It is a summary; the complete JSON Schema is shown next
 * to it, so anything the outline cannot express is reported as `opaque`
 * instead of being guessed.
 */
import type { JsonSchema } from "./registry.ts";

export interface ParameterRow {
  name: string;
  required: boolean;
  type: string;
  description: string | null;
}

/** One alternative of parameters that are a union of object shapes. */
export interface ParameterShape {
  /** The constant that selects the shape, such as `action "read"`, or its position. */
  label: string;
  rows: readonly ParameterRow[];
}

export type ParameterOutline =
  | { kind: "none" }
  | { kind: "object"; rows: readonly ParameterRow[] }
  | { kind: "union"; shapes: readonly ParameterShape[] }
  | { kind: "opaque" };

type SchemaNode = Readonly<Record<string, unknown>>;

/** Nesting shown in a type before it is cut with `…`. */
const MAX_TYPE_DEPTH = 3;
const MAX_ENUM_VALUES = 6;
const MAX_OBJECT_KEYS = 4;
const ELLIPSIS = "…";
const ANY_TYPE = "any";
const UNION = " | ";
const INTERSECTION = " & ";
const UNION_KEYWORDS = ["anyOf", "oneOf"] as const;
const LOCAL_REF_PREFIX = "#/";

function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodesOf(value: unknown): SchemaNode[] | null {
  return Array.isArray(value) && value.length > 0 && value.every(isNode) ? value : null;
}

/** Follow a local `$ref` (`#/$defs/Name`); anything else resolves to nothing. */
function resolveRef(ref: string, root: SchemaNode): SchemaNode | null {
  if (!ref.startsWith(LOCAL_REF_PREFIX)) return null;
  let node: unknown = root;
  for (const key of ref.slice(LOCAL_REF_PREFIX.length).split("/")) {
    if (!isNode(node)) return null;
    node = node[key.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isNode(node) ? node : null;
}

function refName(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1]!;
}

function limited(values: readonly string[], limit: number): string[] {
  return values.length <= limit ? [...values] : [...values.slice(0, limit), `${ELLIPSIS} +${values.length - limit}`];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function grouped(type: string): string {
  return type.includes(UNION) || type.includes(INTERSECTION) ? `(${type})` : type;
}

function objectType(node: SchemaNode): string {
  if (!isNode(node.properties)) return "object";
  const keys = Object.keys(node.properties);
  return keys.length === 0 ? "object" : `{${limited(keys, MAX_OBJECT_KEYS).join(", ")}}`;
}

function namedType(node: SchemaNode, type: string, root: SchemaNode, depth: number): string {
  if (type === "array") return `${grouped(describeType(node.items, root, depth + 1))}[]`;
  if (type === "object") return objectType(node);
  return type === "string" && typeof node.format === "string" ? `string (${node.format})` : type;
}

/** A short type for one schema node, such as `string[]`, `"a" | "b"` or `{url, title}[]`. */
export function describeType(schema: unknown, root: JsonSchema, depth: number): string {
  if (!isNode(schema)) return ANY_TYPE;
  if (depth > MAX_TYPE_DEPTH) return ELLIPSIS;
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return limited(schema.enum.map((value) => JSON.stringify(value)), MAX_ENUM_VALUES).join(UNION);
  for (const keyword of UNION_KEYWORDS) {
    const variants = nodesOf(schema[keyword]);
    if (variants !== null) return unique(variants.map((variant) => describeType(variant, root, depth + 1))).join(UNION);
  }
  const parts = nodesOf(schema.allOf);
  if (parts !== null) return unique(parts.map((part) => describeType(part, root, depth + 1))).join(INTERSECTION);
  if (Array.isArray(schema.type)) {
    return unique(schema.type.filter((type): type is string => typeof type === "string").map((type) => namedType(schema, type, root, depth))).join(UNION);
  }
  if (typeof schema.type === "string") return namedType(schema, schema.type, root, depth);
  return isNode(schema.properties) ? objectType(schema) : ANY_TYPE;
}

function rowsOf(shape: SchemaNode, root: SchemaNode): ParameterRow[] {
  if (!isNode(shape.properties)) return [];
  const required = new Set(Array.isArray(shape.required) ? shape.required.filter((name): name is string => typeof name === "string") : []);
  return Object.entries(shape.properties).map(([name, property]) => ({
    name,
    required: required.has(name),
    type: describeType(property, root, 0),
    description: isNode(property) && typeof property.description === "string" ? property.description : null,
  }));
}

/** The first constant property of a shape, which tells it from its siblings. */
function discriminatorOf(shape: SchemaNode): string | null {
  if (!isNode(shape.properties)) return null;
  for (const [name, property] of Object.entries(shape.properties)) {
    if (isNode(property) && "const" in property) return `${name} ${JSON.stringify(property.const)}`;
  }
  return null;
}

function isObjectShape(node: SchemaNode): boolean {
  return node.type === "object" || isNode(node.properties);
}

export function outlineParameters(schema: JsonSchema): ParameterOutline {
  const root = typeof schema.$ref === "string" ? resolveRef(schema.$ref, schema) : schema;
  if (root === null) return { kind: "opaque" };
  for (const keyword of UNION_KEYWORDS) {
    const variants = nodesOf(root[keyword]);
    if (variants === null) continue;
    const shapes: ParameterShape[] = [];
    for (const variant of variants) {
      const shape = typeof variant.$ref === "string" ? resolveRef(variant.$ref, schema) : variant;
      if (shape === null || !isObjectShape(shape)) return { kind: "opaque" };
      shapes.push({ label: discriminatorOf(shape) ?? `shape ${shapes.length + 1}`, rows: rowsOf(shape, schema) });
    }
    return { kind: "union", shapes };
  }
  if (!isObjectShape(root) || "allOf" in root) return { kind: "opaque" };
  const rows = rowsOf(root, schema);
  return rows.length === 0 ? { kind: "none" } : { kind: "object", rows };
}

export function parameterCount(outline: ParameterOutline): number {
  if (outline.kind === "object") return outline.rows.length;
  if (outline.kind === "union") return new Set(outline.shapes.flatMap((shape) => shape.rows.map((row) => row.name))).size;
  return 0;
}
