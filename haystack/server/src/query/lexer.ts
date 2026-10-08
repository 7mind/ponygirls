// Haystack query: lexer. Tokens carry half-open UTF-16 spans. Keywords stay
// WORDs here; the parser classifies them (so `android` is text, not AND).
import { QUERY_MAX_CHARS, QUERY_MAX_TOKENS, type QueryDiagnostic, type Span } from "./ast.js";

export type TokenKind =
  | "word"
  | "quoted"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "colon"
  | "minus"
  | "op";

export interface Token {
  readonly kind: TokenKind;
  /** Raw source slice (for quoted: including quotes; .value is unescaped). */
  readonly raw: string;
  readonly value: string;
  readonly span: Span;
}

const WORD_END = new Set([" ", "\t", "\n", "\r", "(", ")", '"', "[", "]", ",", "=", "<", ">", "!"]);

export function lex(query: string): { tokens: Token[]; diagnostics: QueryDiagnostic[] } {
  const diagnostics: QueryDiagnostic[] = [];
  const tokens: Token[] = [];
  if (query.length > QUERY_MAX_CHARS) {
    diagnostics.push({ message: `query exceeds ${QUERY_MAX_CHARS} characters`, span: { start: 0, end: query.length } });
    return { tokens, diagnostics };
  }
  let i = 0;
  const push = (kind: TokenKind, raw: string, value: string, start: number, end: number) => {
    tokens.push({ kind, raw, value, span: { start, end } });
  };
  while (i < query.length) {
    const c = query[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const start = i;
    if (c === "(") {
      push("lparen", c, c, start, ++i);
      continue;
    }
    if (c === ")") {
      push("rparen", c, c, start, ++i);
      continue;
    }
    if (c === "[") {
      push("lbracket", c, c, start, ++i);
      continue;
    }
    if (c === "]") {
      push("rbracket", c, c, start, ++i);
      continue;
    }
    if (c === ",") {
      push("comma", c, c, start, ++i);
      continue;
    }
    if (c === ":") {
      push("colon", c, c, start, ++i);
      continue;
    }
    if (c === "-") {
      push("minus", c, c, start, ++i);
      continue;
    }
    if (c === "=" || c === "<" || c === ">" || c === "!") {
      const two = query.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "!=") {
        push("op", two, two, start, (i += 2));
        continue;
      }
      if (c === "=" || c === "<" || c === ">") {
        push("op", c, c, start, ++i);
        continue;
      }
      diagnostics.push({ message: `unexpected '${c}'`, span: { start, end: start + 1 } });
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < query.length) {
        const d = query[j]!;
        if (d === '"') {
          closed = true;
          break;
        }
        if (d === "\\") {
          const esc = query[j + 1];
          const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (esc !== undefined && esc in simple) {
            value += simple[esc]!;
            j += 2;
            continue;
          }
          if (esc === "u") {
            const hex = query.slice(j + 2, j + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              value += String.fromCharCode(parseInt(hex, 16));
              j += 6;
              continue;
            }
          }
          diagnostics.push({ message: "bad escape in quoted string", span: { start: j, end: j + 2 } });
          value += d;
          j += 2;
          continue;
        }
        value += d;
        j++;
      }
      if (!closed) {
        diagnostics.push({ message: "unterminated quoted string", span: { start, end: query.length } });
        push("quoted", query.slice(start), value, start, query.length);
        i = query.length;
        continue;
      }
      push("quoted", query.slice(start, j + 1), value, start, j + 1);
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < query.length && !WORD_END.has(query[j]!)) j++;
    push("word", query.slice(i, j), query.slice(i, j), i, j);
    i = j;
  }
  if (tokens.length > QUERY_MAX_TOKENS) {
    diagnostics.push({ message: `query exceeds ${QUERY_MAX_TOKENS} tokens`, span: { start: 0, end: query.length } });
    return { tokens: [], diagnostics };
  }
  return { tokens, diagnostics };
}
