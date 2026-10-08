// Haystack query: recursive-descent parser → typed AST or diagnostics.
// NOT > AND > OR; juxtaposition is AND. Never falls back to text.
import {
  ATOM_MAX_WORDS,
  QUERY_MAX_DEPTH,
  QUERY_MAX_NODES,
  type AstNode,
  type CompareOp,
  type JsonLiteral,
  type Predicate,
  type QueryDiagnostic,
  type Span,
  InvalidQuery,
} from "./ast.js";
import type { Token } from "./lexer.js";
import { extractWords } from "./text.js";
import { decodeKey } from "../domain/qid.js";
import { parseRaw, isLosslessNumber } from "../domain/json.js";

const META_FIELDS = new Set(["type", "status", "importance", "human-attention", "created-by", "modified-by"]);
const TIME_FIELDS = new Set(["created-at", "modified-at"]);

export function parse(tokens: Token[], fullSpan: Span): AstNode {
  const p = new Parser(tokens, fullSpan);
  const node = p.parseExpression(0);
  if (p.peek() !== undefined) {
    const t = p.peek()!;
    p.fail(`unexpected ${t.raw}`, t.span);
  }
  p.raiseIfFailed();
  return node;
}

class Parser {
  private pos = 0;
  private nodes = 0;
  private readonly diagnostics: QueryDiagnostic[] = [];
  constructor(
    private readonly tokens: Token[],
    private readonly fullSpan: Span,
  ) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  fail(message: string, span: Span): void {
    this.diagnostics.push({ message, span });
  }

  raiseIfFailed(): void {
    if (this.diagnostics.length > 0) throw new InvalidQuery(this.diagnostics);
  }

  private count(span: Span): void {
    this.nodes += 1;
    if (this.nodes > QUERY_MAX_NODES) this.fail(`query exceeds ${QUERY_MAX_NODES} nodes`, span);
  }

  parseExpression(depth: number): AstNode {
    let left = this.parseConjunction(depth);
    for (;;) {
      const t = this.peek();
      if (t?.kind === "word" && t.value.toUpperCase() === "OR") {
        this.next();
        const right = this.parseConjunction(depth);
        this.count(t.span);
        left = { kind: "or", children: [left, right] };
        continue;
      }
      return left;
    }
  }

  private parseConjunction(depth: number): AstNode {
    const children: AstNode[] = [this.parseUnary(depth)];
    for (;;) {
      const t = this.peek();
      if (t === undefined || t.kind === "rparen") return children.length === 1 ? children[0]! : { kind: "and", children };
      if (t.kind === "word" && t.value.toUpperCase() === "OR") {
        return children.length === 1 ? children[0]! : { kind: "and", children };
      }
      if (t.kind === "word" && t.value.toUpperCase() === "AND") this.next();
      const before = this.pos;
      children.push(this.parseUnary(depth));
      if (this.pos === before) {
        // A fail-path that consumes nothing (e.g. depth guard) must still
        // terminate the loop: record and skip one token.
        this.fail("cannot parse here", this.peek()?.span ?? this.fullSpan);
        this.next();
      }
    }
  }

  private parseUnary(depth: number): AstNode {
    if (depth > QUERY_MAX_DEPTH) {
      const t = this.peek();
      this.fail(`query exceeds depth ${QUERY_MAX_DEPTH}`, t?.span ?? this.fullSpan);
      return { kind: "text", words: ["\0invalid\0"], span: this.fullSpan };
    }
    const t = this.peek();
    if (t === undefined) {
      this.fail("incomplete expression", this.fullSpan);
      return { kind: "text", words: ["\0invalid\0"], span: this.fullSpan };
    }
    if ((t.kind === "word" && t.value.toUpperCase() === "NOT") || t.kind === "minus") {
      this.next();
      const child = this.parseUnary(depth + 1);
      this.count(t.span);
      return { kind: "not", child };
    }
    if (t.kind === "lparen") {
      this.next();
      const inner = this.parseExpression(depth + 1);
      const close = this.next();
      if (close?.kind !== "rparen") this.fail("unclosed parenthesis", t.span);
      return inner;
    }
    return this.parseAtom(depth);
  }

  private parseAtom(depth: number): AstNode {
    void depth;
    const t = this.next()!;
    if (t.kind === "quoted") {
      const words = extractWords(t.value);
      if (words.length === 0) {
        this.fail("quoted text has no searchable words", t.span);
        return { kind: "text", words: ["\0invalid\0"], span: t.span };
      }
      if (words.length > ATOM_MAX_WORDS) this.fail(`atom exceeds ${ATOM_MAX_WORDS} words`, t.span);
      this.count(t.span);
      return { kind: "phrase", words, span: t.span };
    }
    if (t.kind !== "word") {
      this.fail(`unexpected ${t.raw}`, t.span);
      return { kind: "text", words: ["\0invalid\0"], span: t.span };
    }
    const upper = t.value.toUpperCase();
    if (upper === "AND" || upper === "OR") {
      this.fail(`unexpected ${t.value}`, t.span);
      return { kind: "text", words: ["\0invalid\0"], span: t.span };
    }
    const colon = t.value.indexOf(":");
    if (colon < 0) {
      const lower = t.value.toLowerCase();
      if (lower === "field" && this.peek()?.kind === "lbracket") {
        return this.parseFieldPredicate(t);
      }
      if (lower === "exists" && this.peek()?.kind === "lbracket") {
        return this.parseExists(t);
      }
      if (TIME_FIELDS.has(lower) && this.peek()?.kind === "op") {
        const op = this.next()!;
        return this.parseTimePred(lower, op.value, t.span);
      }
      const words = extractWords(t.value);
      if (words.length === 0) {
        this.fail("text has no searchable words", t.span);
        return { kind: "text", words: ["\0invalid\0"], span: t.span };
      }
      if (words.length > ATOM_MAX_WORDS) this.fail(`atom exceeds ${ATOM_MAX_WORDS} words`, t.span);
      this.count(t.span);
      return { kind: "text", words, span: t.span };
    }
    const name = t.value.slice(0, colon).toLowerCase();
    const headValue = t.value.slice(colon + 1);
    const span: Span = t.span;
    if (name === "link") return this.parseLink(t, headValue, span);
    if (name === "linked-to" || name === "linked-from") return this.parseLinked(t, name, headValue, span);
    const after = this.expectColon(t, span);
    if (after === null) return { kind: "text", words: ["\0invalid\0"], span };
    if (name === "project") return this.pred({ kind: "project", value: after.value, span }, span);
    if (name === "id") {
      if (after.kind !== "quoted") {
        this.fail("id value must be a quoted qualified key", after.span);
        return { kind: "text", words: ["\0invalid\0"], span };
      }
      this.checkQualified(after.value, after.span);
      return this.pred({ kind: "id", qualified: after.value, span }, span);
    }
    if (name === "archived") return this.parseArchived(after, span);
    if (META_FIELDS.has(name)) return this.pred({ kind: "meta", field: name, value: after.value, span }, span);
    if (TIME_FIELDS.has(name)) {
      // Colon form is equality: created-at:"…".
      if (after.kind !== "quoted") {
        this.fail("time value must be a quoted RFC3339 instant", after.span);
        return { kind: "text", words: ["\0invalid\0"], span };
      }
      return this.parseTimePred(name, "=", span, after);
    }
    this.fail(`unknown attribute '${name}'`, span);
    return { kind: "text", words: ["\0invalid\0"], span };
  }

  /** Value token(s) after `name:` — either the rest of the head word or the
   *  next quoted/word token. Returns null after recording a diagnostic. */
  private expectColon(head: Token, span: Span): Token | null {
    const headValue = head.value.slice(head.value.indexOf(":") + 1);
    if (headValue.length > 0) {
      return {
        kind: "word",
        raw: headValue,
        value: headValue,
        span: { start: span.start + head.value.indexOf(":") + 1, end: span.end },
      };
    }
    const next = this.peek();
    if (next?.kind === "quoted" || next?.kind === "word") {
      this.next();
      return next;
    }
    this.fail(`missing value for '${head.value}'`, span);
    return null;
  }

  private pred(pred: Predicate, span: Span): AstNode {
    this.count(span);
    return { kind: "pred", pred };
  }

  private checkQualified(value: string, span: Span): void {
    try {
      decodeKey(value);
    } catch {
      this.fail("malformed qualified key", span);
    }
  }

  private parseLink(head: Token, headValue: string, span: Span): AstNode {
    void headValue;
    // Forms: link:["type","target"] with real tokens, or link: fused in one
    // word when no quotes are involved (invalid — targets need quoting).
    const lb = headValue.length > 0 ? null : this.peek();
    if (headValue.length > 0 || lb?.kind !== "lbracket") {
      this.fail("link must be link:[\"type\",\"project:item\"]", span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    this.next(); // [
    const typeTok = this.next();
    const comma = this.next();
    const targetTok = this.next();
    const rb = this.next();
    if (
      typeTok?.kind !== "quoted" ||
      comma?.kind !== "comma" ||
      targetTok?.kind !== "quoted" ||
      rb?.kind !== "rbracket"
    ) {
      this.fail("link must be link:[\"type\",\"project:item\"]", span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    if (typeTok.value.length === 0 || typeTok.value.length > 128) {
      this.fail("link type must be a nonempty string ≤ 128 chars", typeTok.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    this.checkQualified(targetTok.value, targetTok.span);
    return this.pred({ kind: "link", linkType: typeTok.value, target: targetTok.value, span }, span);
  }

  private parseLinked(head: Token, name: string, headValue: string, span: Span): AstNode {
    void head;
    void headValue;
    // linked-to:"p:i" — target must be quoted (it contains a colon).
    const tok = this.next();
    if (tok?.kind !== "quoted") {
      this.fail(`${name} value must be a quoted qualified key`, span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    this.checkQualified(tok.value, tok.span);
    return this.pred(
      name === "linked-to"
        ? { kind: "linkedTo", target: tok.value, span }
        : { kind: "linkedFrom", source: tok.value, span },
      span,
    );
  }

  private parseArchived(after: Token, span: Span): AstNode {
    const v = after.value.toLowerCase();
    if (v !== "true" && v !== "false" && v !== "all") {
      this.fail("archived must be true, false, or all", after.span);
      return { kind: "text", words: ["\0invalid\0"], span };
    }
    return this.pred({ kind: "archived", mode: v === "true" ? "only" : v === "false" ? "exclude" : "all", span }, span);
  }

  private parseTimePred(field: string, opText: string, span: Span, valueTok?: Token): AstNode {
    const op = toCompareOp(opText);
    if (op === null) {
      this.fail(`bad comparison operator '${opText}'`, span);
      return { kind: "text", words: ["\0invalid\0"], span };
    }
    const value = valueTok ?? this.next();
    if (value?.kind !== "quoted" || !isUtcInstant(value.value)) {
      this.fail("time value must be a quoted UTC RFC3339 instant", value?.span ?? span);
      return { kind: "text", words: ["\0invalid\0"], span };
    }
    return this.pred({ kind: "time", field, op, instant: value.value, span }, span);
  }

  private parseFieldPredicate(head: Token): AstNode {
    this.next(); // [
    const arg = this.next();
    const rb = this.next();
    if (arg?.kind !== "quoted" || rb?.kind !== "rbracket") {
      this.fail("field must be field[\"/pointer\"] OP value", head.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    if (arg.value !== "" && !arg.value.startsWith("/")) {
      this.fail("pointer must be empty or start with /", arg.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    const opTok = this.next();
    const op = opTok?.kind === "op" ? toCompareOp(opTok.value) : null;
    if (op === null) {
      this.fail("field predicate needs a comparison operator", opTok?.span ?? head.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    const literal = this.parseJsonLiteral(head.span);
    if (literal === null) return { kind: "text", words: ["\0invalid\0"], span: head.span };
    return this.pred({ kind: "field", pointer: arg.value, op, value: literal, span: head.span }, head.span);
  }

  /** JSON literal in value position: quoted string, number word (optionally
   *  negative), true/false/null. Lossless-validated; anything else fails. */
  private parseJsonLiteral(span: Span): JsonLiteral | null {
    const tok = this.peek();
    if (tok?.kind === "quoted") {
      this.next();
      return { kind: "string", text: JSON.stringify(tok.value) };
    }
    let text: string | null = null;
    let valueSpan = span;
    if (tok?.kind === "minus") {
      this.next();
      const num = this.peek();
      if (num?.kind !== "word") {
        this.fail("expected a number after '-'", tok.span);
        return null;
      }
      this.next();
      text = `-${num.value}`;
      valueSpan = { start: tok.span.start, end: num.span.end };
    } else if (tok?.kind === "word") {
      this.next();
      text = tok.value;
      valueSpan = tok.span;
    } else {
      this.fail("expected a JSON value (string, number, true, false, null)", tok?.span ?? span);
      return null;
    }
    if (text === "true" || text === "false") return { kind: "boolean", text };
    if (text === "null") return { kind: "null", text };
    try {
      const parsed = parseRaw(text);
      if (typeof parsed !== "number" && !isLosslessNumber(parsed)) {
        this.fail(`not a JSON value: ${text}`, valueSpan);
        return null;
      }
      return { kind: "number", text };
    } catch {
      this.fail(`not a JSON value: ${text}`, valueSpan);
      return null;
    }
  }

  private parseExists(head: Token): AstNode {
    this.next(); // [
    const arg = this.next();
    const rb = this.next();
    if (arg?.kind !== "quoted" || rb?.kind !== "rbracket") {
      this.fail("exists must be exists[\"/pointer\"]", head.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    if (!arg.value.startsWith("/") && arg.value !== "") {
      this.fail("pointer must be empty or start with /", arg.span);
      return { kind: "text", words: ["\0invalid\0"], span: head.span };
    }
    this.count(head.span);
    return { kind: "pred", pred: { kind: "exists", pointer: arg.value, span: head.span } };
  }
}

function toCompareOp(text: string): CompareOp | null {
  if (text === "=" || text === "!=" || text === "<" || text === "<=" || text === ">" || text === ">=") {
    return text;
  }
  return null;
}

/** Validated UTC/RFC3339 instant: strict shape plus component round-trip,
 *  which rejects impossible dates (month 13, Feb 30) that Date.parse
 *  would silently roll over. */
export function isUtcInstant(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/.exec(text);
  if (!m) return false;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return false;
  const d = new Date(ms);
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5]) &&
    d.getUTCSeconds() === Number(m[6])
  );
}
