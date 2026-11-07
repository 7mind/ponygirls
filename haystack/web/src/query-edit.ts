// Conservative UI edits for the documented Haystack Boolean/JSON-string dialect.
const FIELDS = new Set(["project", "id", "type", "status", "importance", "human-attention", "tag", "created-by", "modified-by", "archived"]);
const MAX_QUERY = 4096;

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
