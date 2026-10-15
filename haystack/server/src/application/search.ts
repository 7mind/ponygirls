// Haystack application: search entry — parse, archive transform, keyset
// cursors bound to (query, scope, limit, sort). Paging is a live view.
import { createHash } from "node:crypto";
import { BadEnvelope } from "../domain/json.js";
import { encodeComponent } from "../domain/qid.js";
import { TITLE_MAX, META_VALUE_MAX } from "../domain/document.js";
import { lex } from "../query/lexer.js";
import { parse, isUtcInstant } from "../query/parser.js";
import {
  InvalidQuery,
  type AstNode,
  type QueryDiagnostic,
} from "../query/ast.js";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_SORT_FIELDS,
  SEARCH_SORT_DEFAULT,
  searchPosition,
  type SearchSort,
  type SearchPosition,
  type SearchableRepository,
  type SearchPage,
  type SearchSummary,
} from "../storage/search.js";

export interface SearchInput {
  query: string;
  project?: string;
  limit?: number;
  cursor?: string;
  sort?: SearchSort;
}

export interface SearchResult {
  items: SearchSummary[];
  cursor?: string;
}

/** Quote a tag value for completion output when it is not a bare word. */
function quoteTagValue(value: string): string {
  if (/^[A-Za-z0-9._~\-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export class InvalidCursor extends Error {
  readonly code = "invalid-cursor";
  constructor(message = "malformed or mismatched cursor") {
    super(message);
    this.name = "InvalidCursor";
  }
}

/** Parse and validate a query string. Empty/whitespace → null (browse). */
export function parseQuery(query: string): AstNode | null {
  if (query.trim() === "") return null;
  const { tokens, diagnostics } = lex(query);
  if (diagnostics.length > 0) throw new InvalidQuery(diagnostics);
  return parse(tokens, { start: 0, end: query.length });
}

/** True when the AST already decides archiving (explicit selector anywhere,
// including under NOT/OR, or a status:archived predicate). */
export function hasArchiveSelector(ast: AstNode): boolean {
  switch (ast.kind) {
    case "and":
    case "or":
      return ast.children.some(hasArchiveSelector);
    case "not":
      return hasArchiveSelector(ast.child);
    case "pred":
      if (ast.pred.kind === "archived") return true;
      return ast.pred.kind === "meta" && ast.pred.field === "status" && ast.pred.value === "archived";
    default:
      return false;
  }
}

/** Apply the implicit archive default around the whole expression.
 *  Browsing (null ast) still excludes archived items. */
export function applyArchiveDefault(ast: AstNode | null): AstNode {
  const span = { start: 0, end: 0 };
  const notArchived: AstNode = {
    kind: "not",
    child: { kind: "pred", pred: { kind: "meta", field: "status", value: "archived", span } },
  };
  if (ast === null) return notArchived;
  if (hasArchiveSelector(ast)) return ast;
  return { kind: "and", children: [ast, notArchived] };
}

/** Validate transport input before any sort field reaches a repository. */
export function parseSearchSort(value: unknown): SearchSort {
  if (value === undefined) return SEARCH_SORT_DEFAULT;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadEnvelope("sort must be an object");
  }
  const sort = value as Record<string, unknown>;
  if (Object.keys(sort).length !== 2 || !Object.hasOwn(sort, "field") || !Object.hasOwn(sort, "direction") ||
      !SEARCH_SORT_FIELDS.some((field) => field === sort.field) || (sort.direction !== "asc" && sort.direction !== "desc")) {
    throw new BadEnvelope("invalid sort field or direction");
  }
  return { field: sort.field as SearchSort["field"], direction: sort.direction };
}

function fingerprint(query: string, scope: string | undefined, limit: number, sort: SearchSort): string {
  return createHash("sha256").update(JSON.stringify(["haystack-search-v2", query, scope ?? null, limit, sort.field, sort.direction]), "utf-8").digest("hex");
}

const CURSOR_VERSION = 2;
export const SEARCH_CURSOR_MAX_CHARS = 16 * 1024;

export function encodeCursor(fp: string, last: SearchPosition): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, fp, last }), "utf-8").toString("base64url");
}

function cursorText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0") && !/\p{Surrogate}/u.test(value);
}

export function decodeCursor(cursor: unknown, fp: string, sort: SearchSort): SearchPosition {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > SEARCH_CURSOR_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidCursor();
  }
  let parsed: unknown;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    const text = bytes.toString("utf8");
    if (bytes.toString("base64url") !== cursor || !bytes.equals(Buffer.from(text, "utf8"))) throw new InvalidCursor();
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidCursor();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new InvalidCursor();
  const envelope = parsed as Record<string, unknown>;
  if (Object.keys(envelope).length !== 3 || envelope.v !== CURSOR_VERSION || envelope.fp !== fp ||
      typeof envelope.last !== "object" || envelope.last === null || Array.isArray(envelope.last)) throw new InvalidCursor();
  const last = envelope.last as Record<string, unknown>;
  if (Object.keys(last).length !== 3 || typeof last.project !== "string" || typeof last.item !== "string" ||
      /\p{Surrogate}/u.test(last.project) || /\p{Surrogate}/u.test(last.item)) throw new InvalidCursor();
  try {
    encodeComponent(last.project);
    encodeComponent(last.item);
  } catch {
    throw new InvalidCursor();
  }
  const value = last.value;
  switch (sort.field) {
    case "revision":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidCursor();
      break;
    case "modified-at":
      if (typeof value !== "string" || !isUtcInstant(value) || value.startsWith("0000-") || new Date(value).toISOString() !== value) throw new InvalidCursor();
      break;
    case "key":
    case "project":
      if (value !== last.project) throw new InvalidCursor();
      break;
    case "human-attention":
      if (value !== "required" && value !== "cleared") throw new InvalidCursor();
      break;
    default:
      if (!cursorText(value, sort.field === "title" ? TITLE_MAX : META_VALUE_MAX)) throw new InvalidCursor();
  }
  return { project: last.project, item: last.item, value: value as string | number };
}

const BUILTINS = [
  "project:",
  "id:",
  "type:",
  "status:",
  "importance:",
  "human-attention:",
  "created-by:",
  "modified-by:",
  "created-at",
  "modified-at",
  "archived:",
  "tag:",
  "tags:",
  "link:",
  "linked-to:",
  "linked-from:",
  "exists",
  "field",
  "AND",
  "OR",
  "NOT",
];

export class SearchService {
  constructor(private readonly repo: SearchableRepository) {}

  async search(input: SearchInput): Promise<SearchResult> {
    if (typeof input.query !== "string") throw new BadEnvelope("query must be a string");
    if (input.project !== undefined && typeof input.project !== "string") throw new BadEnvelope("project must be a string");
    const sort = parseSearchSort(input.sort);
    const limit = input.limit === undefined ? SEARCH_LIMIT_DEFAULT : input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
      throw new InvalidQuery([{ message: `limit must be 1–${SEARCH_LIMIT_MAX}`, span: { start: 0, end: 0 } }]);
    }
    const ast = applyArchiveDefault(parseQuery(input.query));
    const fp = fingerprint(input.query, input.project, limit, sort);
    const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor, fp, sort);
    const page: SearchPage = await this.repo.search({ ast, scope: input.project, limit: limit + 1, sort, after });
    const items = page.items.slice(0, limit);
    const hasMore = page.items.length > limit;
    const last = hasMore ? searchPosition(items[items.length - 1]!, sort) : undefined;
    return {
      items,
      cursor: last === undefined ? undefined : encodeCursor(fp, last),
    };
  }

  /** Bounded query analysis for the browser UI (same parser, no scan). */
  analyze(query: string): { diagnostics: QueryDiagnostic[] } {
    try {
      parseQuery(query);
      return { diagnostics: [] };
    } catch (err) {
      if (err instanceof InvalidQuery) return { diagnostics: [...err.diagnostics] };
      throw err;
    }
  }

  /** Bounded completion: built-ins, observed values, tag values, id suggestions. */
  async complete(fragment: string, limit = 20): Promise<string[]> {
    const out: string[] = [];
    const push = (s: string) => {
      if (out.length < limit && !out.includes(s)) out.push(s);
    };
    const low = fragment.toLowerCase();
    for (const b of BUILTINS) if (b.toLowerCase().startsWith(low)) push(b);
    if (/^(type|status|importance):/i.test(fragment)) {
      const field = fragment.split(":")[0]!.toLowerCase() as "type" | "status" | "importance";
      for (const v of await this.repo.observedValues(field)) push(`${field}:${v}`);
    }
    if (/^tags?:/i.test(fragment)) {
      const prefix = fragment.split(":")[0]!;
      const partial = fragment.slice(prefix.length + 1).toLowerCase();
      for (const v of await this.repo.observedValues("tags")) {
        if (!v.toLowerCase().startsWith(partial)) continue;
        push(`${prefix}:${quoteTagValue(v)}`);
      }
    }
    if (fragment.length >= 2) {
      for (const id of await this.repo.suggestIds(fragment, limit)) push(`id:"${id}"`);
    }
    return out;
  }
}
