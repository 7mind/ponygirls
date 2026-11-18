// Conservative UI edits for the documented Haystack Boolean/JSON-string dialect.
const FIELDS = new Set(["project", "id", "type", "status", "importance", "human-attention", "tag", "created-by", "modified-by", "archived"]);
const MAX_QUERY = 4096;
/** Values written without quotes, as the server spells them in completions. */
const BARE_VALUE = /^[A-Za-z0-9._~-]+$/;

function completeBody(query: string): boolean {
  let quoted = false, escaped = false, depth = 0, brackets = 0;
  let structure = "";
  for (const char of query) {
    if (escaped) { escaped = false; structure += "x"; continue; }
    if (quoted && char === "\\") { escaped = true; structure += "x"; continue; }
    if (char === '"') { quoted = !quoted; structure += "x"; continue; }
    if (quoted) { structure += "x"; continue; }
    structure += char;
    if (char === "(") depth++;
    if (char === ")" && --depth < 0) return false;
    if (char === "[") brackets++;
    if (char === "]" && --brackets < 0) return false;
  }
  if (quoted || escaped || depth !== 0 || brackets !== 0 || /\(\s*\)|\[\s*\]|(?:[:<>=!,])\s*\]|(?:[:<>=!,]|\b(?:AND|OR|NOT)|(?:^|[\s(])-)\s*\)|\(\s*(?:AND|OR)\b/i.test(structure)) return false;
  for (const link of structure.matchAll(/\blink:\s*\[([^\]]*)\]/gi)) {
    if (!/^\s*[^,\s][^,]*,\s*[^,\s][^,]*$/.test(link[1]!)) return false;
  }
  for (const field of structure.matchAll(/\bfield\s*\[[^\]]*\]/gi)) {
    if (!/^\s*(?:!=|<=|>=|=|<|>)/.test(structure.slice(field.index + field[0].length))) return false;
  }
  const tail = query.trimEnd();
  return tail === "" || !/(?:\b(?:AND|OR|NOT)\b|[-:(<>=!,])\s*$/i.test(tail);
}

export function appendFilter(query: string, field: string, value: string): string | null {
  if (!FIELDS.has(field) || !completeBody(query) ||
    (field === "tag" && (value.length === 0 || value.length > 128 || value.includes("\u0000"))) ||
    (field === "archived" && !["true", "false", "all"].includes(value.toLowerCase())) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return null;
  const body = query.trim();
  const next = `${body ? `(${body}) ` : ""}${field}:${JSON.stringify(value)}`;
  return next.length <= MAX_QUERY ? next : null;
}

/** `field:value` as one term; the value is quoted only when it has to be. */
export function filterTerm(field: string, value: string): string {
  return `${field}:${BARE_VALUE.test(value) ? value : JSON.stringify(value)}`;
}

/** Top-level terms of an expression: whitespace outside JSON strings, parentheses and brackets separates them. */
function topLevelTerms(query: string): string[] {
  const terms: string[] = [];
  let term = "", quoted = false, escaped = false, depth = 0;
  for (const char of query) {
    if (escaped) escaped = false;
    else if (quoted && char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "(" || char === "[")) depth++;
    else if (!quoted && (char === ")" || char === "]")) depth--;
    if (!quoted && depth === 0 && /\s/.test(char)) { if (term !== "") terms.push(term); term = ""; continue; }
    term += char;
  }
  if (term !== "") terms.push(term);
  return terms;
}

/** Negation of the following term: `NOT` or a standalone unary minus. */
const NEGATION = /^(?:NOT|-)$/i;
const COMPARISON = /^(?:!=|<=|>=|=|<|>)$/;

/** Index of `term` as an unnegated conjunct of a complete expression without a top-level OR, else -1. */
function conjunctIndex(terms: readonly string[], term: string): number {
  if (terms.some((candidate) => /^OR$/i.test(candidate))) return -1;
  return terms.findIndex((candidate, index) => candidate === term &&
    (index === 0 || !(NEGATION.test(terms[index - 1]!) || COMPARISON.test(terms[index - 1]!))) &&
    (index + 1 === terms.length || !COMPARISON.test(terms[index + 1]!)));
}

/** A filter shortcut is on when its exact term is a top-level conjunct of the expression. */
export function hasConjunct(query: string, term: string): boolean {
  return completeBody(query) && conjunctIndex(topLevelTerms(query), term) !== -1;
}

/**
 * Turns a filter shortcut on (conjoins its term with the whole expression) or off (removes that conjunct and its
 * adjacent AND). null when the expression is incomplete or the result would exceed the query limit.
 */
export function toggleConjunct(query: string, term: string): string | null {
  if (!completeBody(query)) return null;
  const terms = topLevelTerms(query);
  const index = conjunctIndex(terms, term);
  let next: string;
  if (index === -1) {
    const body = query.trim();
    next = body === "" ? term : terms.some((candidate) => /^OR$/i.test(candidate)) ? `(${body}) ${term}` : `${body} ${term}`;
  } else {
    const and = (at: number) => at >= 0 && at < terms.length && /^AND$/i.test(terms[at]!);
    const from = and(index - 1) ? index - 1 : index;
    const to = from === index && and(index + 1) ? index + 2 : index + 1;
    next = [...terms.slice(0, from), ...terms.slice(to)].join(" ");
  }
  return next.length <= MAX_QUERY ? next : null;
}

/** Appends a field prefix (`type:`) as the next term of the draft; null past the query limit. */
export function appendField(query: string, field: string): string | null {
  if (!FIELDS.has(field)) throw new Error(`unknown query field: ${field}`);
  const body = query.trimEnd();
  const next = `${body}${body === "" || body.endsWith("(") ? "" : " "}${field}:`;
  return next.length <= MAX_QUERY ? next : null;
}

/** The completion API accepts a fragment, not a replacement span. Never splice
 * inside quotes (including a closed quoted value) or a noncollapsed selection. */
export function completionRange(query: string, start: number, end: number): { start: number; end: number; fragment: string } | null {
  if (start !== end || start < 0 || start > query.length || start > 0 && /[\uD800-\uDBFF]/.test(query[start - 1]!) && /[\uDC00-\uDFFF]/.test(query[start]!)) return null;
  let left = start, right = start;
  // Syntax delimiters inside JSON literals must not be treated as boundaries.
  let quote = false, escape = false, tokenStart = 0;
  for (let i = 0; i < start; i++) {
    const c = query[i]!;
    if (escape) { escape = false; continue; }
    if (quote && c === "\\") { escape = true; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (!quote && /[\s()]/.test(c)) tokenStart = i + 1;
  }
  if (quote) return null;
  left = tokenStart;
  for (; right < query.length && !/[\s()]/.test(query[right]!); right++) { /* whole token */ }
  const token = query.slice(left, right);
  if (token.includes('"') || token.includes("[") || token.includes("]") || token.includes("\\")) return null;
  if (right < query.length && right > 0 && /[\uD800-\uDBFF]/.test(query[right - 1]!) && /[\uDC00-\uDFFF]/.test(query[right]!)) return null;
  return { start: left, end: right, fragment: query.slice(left, start) };
}

export function completionEdit(query: string, range: { start: number; end: number; fragment?: string }, suggestion: string): { query: string; caret: number } | null {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > query.length || range.start > range.end ||
    typeof suggestion !== "string" || suggestion.length === 0 ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(suggestion)) return null;
  const before = query.slice(0, range.start) + suggestion;
  const after = query.slice(range.end);
  const separator = !suggestion.endsWith(":") && !/^(field|exists)$/i.test(suggestion) && !/^[\s)]/.test(after) ? " " : "";
  const next = before + separator + after;
  return next.length <= MAX_QUERY ? { query: next, caret: before.length + separator.length } : null;
}
