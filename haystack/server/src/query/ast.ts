// Haystack query: typed AST (normative: haystack/docs/query.md §§1-2).
// Spans are half-open UTF-16 code-unit offsets into the query text.
export interface Span {
  readonly start: number;
  readonly end: number;
}

export type CompareOp = "=" | "!=" | "<" | "<=" | ">" | ">=";

export interface JsonLiteral {
  readonly kind: "string" | "number" | "boolean" | "null";
  /** Lossless source text (numbers keep their decimal form). */
  readonly text: string;
}

export type Predicate =
  | { readonly kind: "project"; readonly value: string; readonly span: Span }
  | { readonly kind: "id"; readonly qualified: string; readonly span: Span }
  | { readonly kind: "meta"; readonly field: string; readonly value: string; readonly span: Span }
  | { readonly kind: "time"; readonly field: string; readonly op: CompareOp; readonly instant: string; readonly span: Span }
  | { readonly kind: "archived"; readonly mode: "only" | "exclude" | "all"; readonly span: Span }
  | { readonly kind: "field"; readonly pointer: string; readonly op: CompareOp; readonly value: JsonLiteral; readonly span: Span }
  | { readonly kind: "exists"; readonly pointer: string; readonly span: Span }
  | { readonly kind: "link"; readonly linkType: string; readonly target: string; readonly span: Span }
  | { readonly kind: "linkedTo"; readonly target: string; readonly span: Span }
  | { readonly kind: "linkedFrom"; readonly source: string; readonly span: Span }
  | { readonly kind: "tag"; readonly value: string; readonly span: Span };

export type AstNode =
  | { readonly kind: "and"; readonly children: readonly AstNode[] }
  | { readonly kind: "or"; readonly children: readonly AstNode[] }
  | { readonly kind: "not"; readonly child: AstNode }
  | { readonly kind: "text"; readonly words: readonly string[]; readonly span: Span }
  | { readonly kind: "phrase"; readonly words: readonly string[]; readonly span: Span }
  | { readonly kind: "pred"; readonly pred: Predicate };

export interface QueryDiagnostic {
  readonly message: string;
  readonly span: Span;
}

export class InvalidQuery extends Error {
  readonly code = "invalid-query";
  readonly diagnostics: readonly QueryDiagnostic[];
  constructor(diagnostics: readonly QueryDiagnostic[]) {
    super(diagnostics.map((d) => `${d.message} [${d.span.start},${d.span.end})`).join("; "));
    this.name = "InvalidQuery";
    this.diagnostics = diagnostics;
  }
}

export const QUERY_MAX_CHARS = 4096;
export const QUERY_MAX_TOKENS = 512;
export const QUERY_MAX_NODES = 128;
export const QUERY_MAX_DEPTH = 16;
export const ATOM_MAX_WORDS = 64;
