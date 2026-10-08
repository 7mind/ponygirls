// Haystack application: search entry — parse, archive transform, keyset
// cursors bound to (query, scope, limit). Paging is a live view.
import { createHash } from "node:crypto";
import { lex } from "../query/lexer.js";
import { parse } from "../query/parser.js";
import {
  InvalidQuery,
  type AstNode,
  type QueryDiagnostic,
} from "../query/ast.js";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  type SearchableRepository,
  type SearchPage,
  type SearchSummary,
} from "../storage/search.js";

export interface SearchInput {
  query: string;
  project?: string;
  limit?: number;
  cursor?: string;
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

function fingerprint(query: string, scope: string | undefined, limit: number): string {
  return createHash("sha256").update(`haystack-search-v1\0${query}\0${scope ?? ""}\0${limit}`, "utf-8").digest("hex");
}

export function encodeCursor(fp: string, last: { project: string; item: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, fp, last }), "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string, fp: string): { project: string; item: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    throw new InvalidCursor();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    (parsed as { fp?: unknown }).fp !== fp
  ) {
    throw new InvalidCursor();
  }
  const last = (parsed as { last?: unknown }).last as { project?: unknown; item?: unknown } | undefined;
  if (typeof last?.project !== "string" || typeof last?.item !== "string" || !last.project || !last.item) {
    throw new InvalidCursor();
  }
  return { project: last.project, item: last.item };
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
    const limit = input.limit ?? SEARCH_LIMIT_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
      throw new InvalidQuery([{ message: `limit must be 1–${SEARCH_LIMIT_MAX}`, span: { start: 0, end: 0 } }]);
    }
    const ast = applyArchiveDefault(parseQuery(input.query));
    const fp = fingerprint(input.query, input.project, limit);
    const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor, fp);
    const page: SearchPage = await this.repo.search({ ast, scope: input.project, limit: limit + 1, after });
    const items = page.items.slice(0, limit);
    const hasMore = page.items.length > limit;
    const last = hasMore ? items[items.length - 1]! : page.next;
    return {
      items,
      cursor: last === undefined ? undefined : encodeCursor(fp, { project: last.project, item: last.item }),
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
