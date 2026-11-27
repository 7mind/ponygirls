/**
 * A readable outline of a tool's parameters: one row per top-level property
 * with a short type. It is a summary; the complete JSON Schema is shown next
 * to it, so anything the outline cannot express is reported as `opaque`
 * instead of being guessed. A schema is untrusted and can be built to expand
 * (a union that names one large shape thousands of times), so the outline
 * shows a bounded number of shapes and rows and says how many there are.
 */
import type { JsonSchema } from "./registry.ts";

export interface ParameterRow {
  name: string;
  required: boolean;
  type: string;
  description: string | null;
}

/** The parameters of one object shape. */
export interface ParameterList {
  /** The first parameters in declaration order, as far as the outline's row budget reaches. */
  rows: readonly ParameterRow[];
  /** How many parameters the shape has, shown or not. */
  total: number;
  /** How many of them are required. */
  required: number;
}

/** One alternative of parameters that are a union of object shapes. */
export interface ParameterShape extends ParameterList {
  /** The constant that selects the shape, such as `action "read"`, or its position. */
  label: string;
}

export type ParameterOutline =
  | { kind: "none" }
  | ({ kind: "object" } & ParameterList)
  | {
    kind: "union";
    /** The first shapes, as far as the budgets reach. */
    shapes: readonly ParameterShape[];
    /** How many shapes the union has, shown or not. */
    total: number;
    /** Distinct parameter names over the shapes shown. */
    parameters: number;
  }
  | { kind: "opaque" };

type SchemaNode = Readonly<Record<string, unknown>>;

/**
 * Rows of one outline, over all its shapes: several times the parameters of the largest tool seen (32).
 * What does not fit is counted and left to the JSON.
 */
export const MAX_OUTLINE_ROWS = 120;
export const MAX_OUTLINE_SHAPES = 24;

/** Nesting shown in a type before it is cut with `…`. */
const MAX_TYPE_DEPTH = 3;
/** Enum values, union members or type names shown in one type; the largest union in a real tool seen had 6. */
const MAX_ALTERNATIVES = 6;
const MAX_OBJECT_KEYS = 4;
const ELLIPSIS = "…";
const ANY_TYPE = "any";
const UNION = " | ";
const INTERSECTION = " & ";
const UNION_KEYWORDS = ["anyOf", "oneOf"] as const;
/**
 * Keywords that add parameters, or make them depend on one another, in ways a list of rows cannot show.
 * `if` is not among them: without `then` or `else` it constrains nothing.
 */
const UNLISTABLE_KEYWORDS = [
  "allOf", "not", "then", "else", "dependentRequired", "dependentSchemas", "dependencies", "patternProperties", "propertyNames",
  "$dynamicRef", "$recursiveRef",
] as const;
/** Keywords that, with a schema as their value, admit parameters that are not named. */
const OPEN_KEYWORDS = ["additionalProperties", "unevaluatedProperties"] as const;
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

/** The first `limit` of the values, each named once, and how many more there are. Only the ones shown are read. */
function firstOf<T>(values: readonly T[], limit: number, render: (value: T) => string): string[] {
  const shown = [...new Set(values.slice(0, limit).map(render))];
  return values.length <= limit ? shown : [...shown, `${ELLIPSIS} +${values.length - limit}`];
}

function grouped(type: string): string {
  return type.includes(UNION) || type.includes(INTERSECTION) ? `(${type})` : type;
}

function objectType(node: SchemaNode): string {
  if (!isNode(node.properties)) return "object";
  const keys = Object.keys(node.properties);
  return keys.length === 0 ? "object" : `{${firstOf(keys, MAX_OBJECT_KEYS, (key) => key).join(", ")}}`;
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
  if ("const" in schema) return JSON.stringify(schema.const) ?? ANY_TYPE;
  if (Array.isArray(schema.enum)) return firstOf(schema.enum, MAX_ALTERNATIVES, (value) => JSON.stringify(value) ?? ANY_TYPE).join(UNION);
  for (const keyword of UNION_KEYWORDS) {
    const variants = nodesOf(schema[keyword]);
    if (variants !== null) return firstOf(variants, MAX_ALTERNATIVES, (variant) => describeType(variant, root, depth + 1)).join(UNION);
  }
  const parts = nodesOf(schema.allOf);
  if (parts !== null) return firstOf(parts, MAX_ALTERNATIVES, (part) => describeType(part, root, depth + 1)).join(INTERSECTION);
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type): type is string => typeof type === "string");
    return firstOf(types, MAX_ALTERNATIVES, (type) => namedType(schema, type, root, depth)).join(UNION);
  }
  if (typeof schema.type === "string") return namedType(schema, schema.type, root, depth);
  return isNode(schema.properties) ? objectType(schema) : ANY_TYPE;
}

function requiredNames(shape: SchemaNode): Set<string> {
  return new Set(Array.isArray(shape.required) ? shape.required.filter((name): name is string => typeof name === "string") : []);
}

function listOf(shape: SchemaNode, root: SchemaNode, budget: number): ParameterList {
  if (!isNode(shape.properties)) return { rows: [], total: 0, required: 0 };
  const required = requiredNames(shape);
  const names = Object.keys(shape.properties);
  const properties = shape.properties;
  return {
    rows: names.slice(0, budget).map((name) => {
      const property = properties[name];
      return {
        name,
        required: required.has(name),
        type: describeType(property, root, 0),
        description: isNode(property) && typeof property.description === "string" ? property.description : null,
      };
    }),
    total: names.length,
    required: names.filter((name) => required.has(name)).length,
  };
}

/** The first constant property of a shape, which tells it from its siblings. */
function discriminatorOf(shape: SchemaNode): string | null {
  if (!isNode(shape.properties)) return null;
  for (const [name, property] of Object.entries(shape.properties)) {
    if (isNode(property) && "const" in property) return `${name} ${JSON.stringify(property.const)}`;
  }
  return null;
}

function hasUnion(node: SchemaNode): boolean {
  return UNION_KEYWORDS.some((keyword) => keyword in node);
}

/** More than `properties` and `required` say: parameters by pattern or of any name, or conditions between parameters. */
function isUnlistable(node: SchemaNode): boolean {
  return UNLISTABLE_KEYWORDS.some((keyword) => keyword in node) || OPEN_KEYWORDS.some((keyword) => {
    const value = node[keyword];
    return isNode(value) && Object.keys(value).length > 0;
  });
}

/** Parameters or requirements the node states itself. */
function hasOwnParameters(node: SchemaNode): boolean {
  return (isNode(node.properties) && Object.keys(node.properties).length > 0) || requiredNames(node).size > 0;
}

/** An object whose parameters are exactly its `properties`. */
function isPlainShape(node: SchemaNode): boolean {
  return (node.type === "object" || isNode(node.properties)) && !("$ref" in node) && !hasUnion(node) && !isUnlistable(node);
}

/**
 * The node a local `$ref` stands for, or the node itself without one. `null` when the reference cannot be
 * followed or when something beside it changes what it means; a reference to a reference is not followed.
 */
function dereferenced(node: SchemaNode, root: SchemaNode): SchemaNode | null {
  if (!("$ref" in node)) return node;
  if (typeof node.$ref !== "string" || hasOwnParameters(node) || hasUnion(node) || isUnlistable(node)) return null;
  return resolveRef(node.$ref, root);
}

function unionOutline(variants: readonly SchemaNode[], schema: SchemaNode): ParameterOutline {
  const shapes: SchemaNode[] = [];
  for (const variant of variants) {
    const shape = dereferenced(variant, schema);
    if (shape === null || !isPlainShape(shape)) return { kind: "opaque" };
    shapes.push(shape);
  }
  // Shapes are shown in order while the row budget lasts; the one that uses it up is cut, the rest are counted.
  const shown: ParameterShape[] = [];
  const names = new Set<string>();
  let budget = MAX_OUTLINE_ROWS;
  for (const shape of shapes.slice(0, MAX_OUTLINE_SHAPES)) {
    if (budget === 0) break;
    const list = listOf(shape, schema, budget);
    budget -= list.rows.length;
    shown.push({ label: discriminatorOf(shape) ?? `shape ${shown.length + 1}`, ...list });
    if (isNode(shape.properties)) for (const name of Object.keys(shape.properties)) names.add(name);
  }
  return { kind: "union", shapes: shown, total: shapes.length, parameters: names.size };
}

export function outlineParameters(schema: JsonSchema): ParameterOutline {
  const root = dereferenced(schema, schema);
  if (root === null) return { kind: "opaque" };
  const unions = UNION_KEYWORDS.filter((keyword) => keyword in root);
  if (unions.length > 0) {
    // One union of plain shapes and nothing beside it; two unions at once multiply.
    const variants = unions.length === 1 ? nodesOf(root[unions[0]!]) : null;
    if (variants === null || "$ref" in root || hasOwnParameters(root) || isUnlistable(root)) return { kind: "opaque" };
    return unionOutline(variants, schema);
  }
  if (!isPlainShape(root)) return { kind: "opaque" };
  const list = listOf(root, schema, MAX_OUTLINE_ROWS);
  return list.total === 0 ? { kind: "none" } : { kind: "object", ...list };
}
