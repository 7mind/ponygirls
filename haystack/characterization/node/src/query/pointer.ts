// Haystack query: RFC6901 pointer resolution rooted at `fields`.
// Exact contract (docs/query.md §4): ~0/~1 decoded once; arrays accept only
// canonical non-negative indexes without leading zeros; negative indexes and
// `-` never select array elements; unresolved traversal is missing (distinct
// from JSON null).
import type { JsonValue } from "../domain/json.js";
import { isLosslessNumber } from "../domain/json.js";

export interface Resolved {
  readonly found: boolean;
  readonly value?: JsonValue;
}

/** Split a pointer into segments ("" selects the whole object). */
export function splitPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error("pointer must be empty or start with /");
  return pointer.slice(1).split("/").map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const CANON_INDEX = /^(0|[1-9][0-9]*)$/;

export function resolvePointer(fields: JsonValue, pointer: string): Resolved {
  let node: JsonValue = fields;
  for (const seg of splitPointer(pointer)) {
    if (Array.isArray(node)) {
      if (!CANON_INDEX.test(seg)) return { found: false };
      const idx = Number(seg);
      if (idx >= node.length) return { found: false };
      node = node[idx] as JsonValue;
    } else if (node !== null && typeof node === "object" && !isLosslessNumber(node)) {
      const obj = node as { [key: string]: JsonValue };
      if (!Object.prototype.hasOwnProperty.call(obj, seg)) return { found: false };
      node = obj[seg] as JsonValue;
    } else {
      return { found: false };
    }
  }
  return { found: true, value: node };
}
