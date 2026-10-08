// Haystack query: pure AST evaluator over materialized item views.
// Used by the dummy leg; the PG leg compiles the same semantics to SQL.
// Any divergence between the two is a defect in one leg, never a contract
// ambiguity — the shared suite decides.
import type { JsonValue } from "../domain/json.js";
import { isLosslessNumber } from "../domain/json.js";
import { compareNumbers } from "../domain/json.js";
import { parseRaw } from "../domain/json.js";
import type { AstNode, Predicate } from "./ast.js";
import { resolvePointer } from "./pointer.js";
import { decodeKey } from "../domain/qid.js";

export interface SearchCandidate {
  readonly project: string;
  readonly item: string;
  readonly title: string;
  readonly description: string;
  readonly fields: JsonValue;
  readonly type: string;
  readonly status: string;
  readonly importance: string;
  readonly humanAttention: string;
  readonly createdBy: string;
  readonly modifiedBy: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
  /** Outgoing links as [type, qualified-target] tuples. */
  readonly links: ReadonlyArray<readonly [string, string]>;
  /** Precomputed normalized word multiset and joined per-segment strings. */
  readonly words: readonly string[];
  readonly segments: readonly string[];
}

/** Reverse-link lookup for linked-from (dummy scans; PG uses its index). */
export type IncomingLinks = (targetProject: string, targetItem: string) => ReadonlyArray<{ project: string; item: string }>;

export function evaluate(ast: AstNode, candidate: SearchCandidate, incoming: IncomingLinks): boolean {
  switch (ast.kind) {
    case "and":
      return ast.children.every((c) => evaluate(c, candidate, incoming));
    case "or":
      return ast.children.some((c) => evaluate(c, candidate, incoming));
    case "not":
      return !evaluate(ast.child, candidate, incoming);
    case "text":
      return ast.words.every((w) => candidate.words.includes(w));
    case "phrase": {
      const phrase = ast.words.join(" ");
      return candidate.segments.some((seg) => (" " + seg + " ").includes(" " + phrase + " "));
    }
    case "pred":
      return evaluatePred(ast.pred, candidate, incoming);
  }
}

function evaluatePred(pred: Predicate, c: SearchCandidate, incoming: IncomingLinks): boolean {
  switch (pred.kind) {
    case "project":
      return c.project === pred.value;
    case "id": {
      const key = decodeKey(pred.qualified);
      return c.project === key.project && c.item === key.item;
    }
    case "meta":
      return metaField(c, pred.field) === pred.value;
    case "time": {
      const actual = Date.parse(pred.field === "created-at" ? c.createdAt : c.modifiedAt);
      const want = Date.parse(pred.instant);
      return compareTime(actual, want, pred.op);
    }
    case "archived":
      if (pred.mode === "all") return true;
      return pred.mode === "only" ? c.status === "archived" : c.status !== "archived";
    case "exists":
      return resolvePointer(c.fields, pred.pointer).found;
    case "field": {
      const r = resolvePointer(c.fields, pred.pointer);
      if (!r.found) return false;
      return compareJson(r.value as JsonValue, pred.op, pred.value.text, pred.value.kind);
    }
    case "link":
      return c.links.some(([t, target]) => t === pred.linkType && target === pred.target);
    case "linkedTo":
      return c.links.some(([, target]) => target === pred.target);
    case "linkedFrom": {
      const key = decodeKey(pred.source);
      return incoming(c.project, c.item).some((s) => s.project === key.project && s.item === key.item);
    }
  }
}

function metaField(c: SearchCandidate, field: string): string {
  switch (field) {
    case "type":
      return c.type;
    case "status":
      return c.status;
    case "importance":
      return c.importance;
    case "human-attention":
      return c.humanAttention;
    case "created-by":
      return c.createdBy;
    case "modified-by":
      return c.modifiedBy;
    default:
      return "";
  }
}

function compareTime(actual: number, want: number, op: string): boolean {
  switch (op) {
    case "=":
      return actual === want;
    case "!=":
      return actual !== want;
    case "<":
      return actual < want;
    case "<=":
      return actual <= want;
    case ">":
      return actual > want;
    case ">=":
      return actual >= want;
    default:
      return false;
  }
}

/** Logical JSON comparison. Missing is handled by the caller (always false,
// including !=). Wrong-type numerics are false, never casts. */
export function compareJson(actual: JsonValue, op: string, literalText: string, literalKind: string): boolean {
  if (literalKind === "number") {
    if (!isLosslessNumber(actual)) return false;
    const want = parseRaw(literalText);
    if (!isLosslessNumber(want)) return false;
    const cmp = compareNumbers(actual, want);
    return applyCmp(cmp, op);
  }
  if (literalKind === "string" || literalKind === "boolean") {
    const same =
      literalKind === "string"
        ? typeof actual === "string" && JSON.stringify(actual) === literalText
        : typeof actual === "boolean" && String(actual) === literalText;
    return op === "=" ? same : op === "!=" ? !same : false;
  }
  // null literal: only = / != are meaningful.
  if (literalKind === "null") {
    const same = actual === null;
    return op === "=" ? same : op === "!=" ? !same : false;
  }
  return false;
}

function applyCmp(cmp: number, op: string): boolean {
  switch (op) {
    case "=":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    default:
      return false;
  }
}
