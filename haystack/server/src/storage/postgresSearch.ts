// Haystack storage: AST → SQL compiler. Fixed operator/column templates;
// arbitrary paths, link types, and values travel as bound parameters only.
// Item alias is always `i` (items), projection alias `s` (item_search LEFT
// JOINed), links correlated as `l`. Semantics mirror query/evaluate.ts.
//
// Parameter discipline: `push(value)` appends and returns its $n index.
// Indices are sequential from the caller's `next` start.
import type { AstNode, CompareOp, JsonLiteral, Predicate } from "../query/ast.js";
import { splitPointer } from "../query/pointer.js";
import { decodeKey } from "../domain/qid.js";

export interface CompiledWhere {
  sql: string;
  params: unknown[];
}

class Ctx {
  readonly params: unknown[] = [];
  constructor(private next: number) {}
  push(value: unknown): string {
    this.params.push(value);
    this.next += 1;
    return `$${this.next}`;
  }
}

/** Compile a WHERE fragment. `next` is the highest $n already used. */
export function compileWhere(ast: AstNode | null, next = 0): CompiledWhere {
  const ctx = new Ctx(next);
  const sql = ast === null ? "TRUE" : compileNode(ast, ctx);
  return { sql, params: ctx.params };
}

function compileNode(node: AstNode, ctx: Ctx): string {
  switch (node.kind) {
    case "and":
      return node.children.length === 1
        ? compileNode(node.children[0]!, ctx)
        : `(${node.children.map((c) => compileNode(c, ctx)).join(" AND ")})`;
    case "or":
      return `(${node.children.map((c) => compileNode(c, ctx)).join(" OR ")})`;
    case "not":
      return `(NOT (${compileNode(node.child, ctx)}))`;
    case "text": {
      const p = ctx.push(node.words);
      return `(s.words @> ${p}::text[])`;
    }
    case "phrase": {
      // Words contain only L/N/M chars (no LIKE metacharacters) by construction.
      const p = ctx.push(node.words.join(" "));
      return (
        `(EXISTS (SELECT 1 FROM unnest(s.segments) seg ` +
        `WHERE (' ' || seg || ' ') LIKE ('% ' || ${p} || ' %')))`
      );
    }
    case "pred":
      return compilePred(node.pred, ctx);
  }
}

function compilePred(pred: Predicate, ctx: Ctx): string {
  switch (pred.kind) {
    case "project": {
      const p = ctx.push(pred.value);
      return `(i.project_id = ${p})`;
    }
    case "id": {
      const key = decodeKey(pred.qualified);
      const a = ctx.push(key.project);
      const b = ctx.push(key.item);
      return `(i.project_id = ${a} AND i.item_id = ${b})`;
    }
    case "meta": {
      const p = ctx.push(pred.value);
      if (pred.field === "created-by") return `(i.created_by = ${p})`;
      if (pred.field === "modified-by") return `(i.modified_by = ${p})`;
      return `(i.document ->> '${metaColumn(pred.field)}' = ${p})`;
    }
    case "time": {
      const p = ctx.push(pred.instant);
      const col = pred.field === "created-at" ? "i.created_at" : "i.modified_at";
      return `(${col} ${pred.op} ${p}::timestamptz)`;
    }
    case "archived":
      if (pred.mode === "all") return "(TRUE)";
      return pred.mode === "only"
        ? `((i.document ->> 'status') = 'archived')`
        : `((i.document ->> 'status') <> 'archived')`;
    case "exists": {
      const p = ctx.push(splitPointer(pred.pointer));
      return `(haystack_exists((i.document -> 'fields'), ${p}::text[]))`;
    }
    case "field":
      return compileField(pred.pointer, pred.op, pred.value, ctx);
    case "link": {
      const key = decodeKey(pred.target);
      const t = ctx.push(pred.linkType);
      const a = ctx.push(key.project);
      const b = ctx.push(key.item);
      return (
        `(EXISTS (SELECT 1 FROM item_links l WHERE l.source_project_id = i.project_id ` +
        `AND l.source_item_id = i.item_id AND l.link_type = ${t} ` +
        `AND l.target_project_id = ${a} AND l.target_item_id = ${b}))`
      );
    }
    case "linkedTo": {
      const key = decodeKey(pred.target);
      const a = ctx.push(key.project);
      const b = ctx.push(key.item);
      return (
        `(EXISTS (SELECT 1 FROM item_links l WHERE l.source_project_id = i.project_id ` +
        `AND l.source_item_id = i.item_id AND l.target_project_id = ${a} AND l.target_item_id = ${b}))`
      );
    }
    case "linkedFrom": {
      const key = decodeKey(pred.source);
      const a = ctx.push(key.project);
      const b = ctx.push(key.item);
      return (
        `(EXISTS (SELECT 1 FROM item_links l WHERE l.target_project_id = i.project_id ` +
        `AND l.target_item_id = i.item_id AND l.source_project_id = ${a} AND l.source_item_id = ${b}))`
      );
    }
    case "tag": {
      const p = ctx.push(pred.value);
      // Missing tags (NULL) must be FALSE so NOT tag:x includes untagged
      // items (three-valued logic would otherwise exclude them).
      return `(COALESCE((i.document -> 'tags'), '[]'::jsonb) ? ${p})`;
    }
  }
}

/** Document-backed metadata columns. created-by/modified-by are handled
 *  above (SQL columns). Field names come from the closed parser vocabulary,
 *  never user text — the switch is exhaustive by construction. */
function metaColumn(field: string): string {
  switch (field) {
    case "type":
    case "status":
    case "importance":
    case "human-attention":
      return field;
    default:
      throw new Error(`metadata field is not document-backed: ${field}`);
  }
}

function compileField(pointer: string, op: CompareOp, literal: JsonLiteral, ctx: Ctx): string {
  const path = ctx.push(splitPointer(pointer));
  const value = `haystack_resolve((i.document -> 'fields'), ${path}::text[])`;
  const exists = `haystack_exists((i.document -> 'fields'), ${path}::text[])`;
  if (literal.kind === "number") {
    const lit = ctx.push(literal.text);
    // Wrong-type numerics are false (no casts); missing is false (exists).
    return `(${exists} AND jsonb_typeof(${value}) = 'number' AND (${value} ${op} ${lit}::jsonb))`;
  }
  if (literal.kind === "string" || literal.kind === "boolean") {
    const lit = ctx.push(literal.text);
    if (op === "=" || op === "!=") {
      const eq = `(${exists} AND ${value} = ${lit}::jsonb)`;
      return op === "=" ? eq : `(${exists} AND NOT (${value} = ${lit}::jsonb))`;
    }
    return "(FALSE)";
  }
  // null literal: = / != only; missing is false for both.
  if (op === "=") return `(${exists} AND ${value} = 'null'::jsonb)`;
  if (op === "!=") return `(${exists} AND ${value} <> 'null'::jsonb)`;
  return "(FALSE)";
}
