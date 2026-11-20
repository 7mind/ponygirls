// JSON (RFC 8259) validation and re-indentation without re-serialisation: every string and number is copied as
// written, so 12345678901234567890, 1.0 and "\u00e9" are shown as stored.

export const JSON_DEPTH_LIMIT = 256;
/** Indentation can multiply the size of deeply nested minified input; a larger result is refused, not cut. */
export const JSON_FORMAT_LIMIT = 8 * 1024 * 1024;
const INDENT = '  ';
const WHITESPACE = /[ \t\n\r]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LITERAL = /true|false|null/y;
const STRING_RUN = /[^"\\\u0000-\u001f]*/y;
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y;
const PUNCTUATION = '{}[]:,';

export class JsonSyntaxError extends Error {
  /** `line` and `column` are 1-based positions in the text given to the formatter. */
  constructor(message, line, column) { super(message); this.name = 'JsonSyntaxError'; this.line = line; this.column = column; }
}
export class JsonFormatLimitError extends Error {
  constructor(message) { super(message); this.name = 'JsonFormatLimitError'; }
}

function position(text, offset) {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) || []).length + 1;
  return [line, offset - (before.lastIndexOf('\n') + 1) + 1];
}
function shown(text, offset) {
  if (offset >= text.length) return 'end of text';
  const point = String.fromCodePoint(text.codePointAt(offset));
  return /[\u0000-\u001f\u007f]/.test(point) ? `control character U+${point.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : `"${point}"`;
}
function match(pattern, text, offset) { pattern.lastIndex = offset; return pattern.exec(text)[0].length; }

/** End offset of the token starting at `offset`, or -1 when no JSON token starts there. */
function tokenEnd(text, offset) {
  const c = text[offset];
  if (c === undefined) return -1;
  if (PUNCTUATION.includes(c)) return offset + 1;
  if (c === '"') {
    let at = offset + 1;
    for (;;) {
      at += match(STRING_RUN, text, at);
      if (text[at] === '"') return at + 1;
      ESCAPE.lastIndex = at;
      const escape = ESCAPE.exec(text);
      if (!escape) return -1;
      at += escape[0].length;
    }
  }
  for (const pattern of [NUMBER, LITERAL]) {
    pattern.lastIndex = offset;
    const found = pattern.exec(text);
    if (found) return offset + found[0].length;
  }
  return -1;
}

/** Offset of the character that ends a string token at `offset` illegally (for the error position). */
function stringFault(text, offset) {
  let at = offset + 1;
  for (;;) {
    at += match(STRING_RUN, text, at);
    ESCAPE.lastIndex = at;
    const escape = ESCAPE.exec(text);
    if (!escape) return at;
    at += escape[0].length;
  }
}

/**
 * Two-space re-indentation of one JSON value. Throws JsonSyntaxError with the position of the first fault, or
 * JsonFormatLimitError when the value nests deeper than JSON_DEPTH_LIMIT or the result exceeds JSON_FORMAT_LIMIT.
 */
export function formatJson(text) {
  const out = [];
  // One frame per open container: its closing bracket and whether it has members yet.
  const frames = [];
  let size = 0, at = 0;
  // What may come next: a value, a member name, ':', ',' (or the closer), or nothing.
  let expect = 'value';
  const emit = part => { out.push(part); size += part.length; if (size > JSON_FORMAT_LIMIT) throw new JsonFormatLimitError('The formatted text would exceed the 8 MiB preview limit.'); };
  const fault = (offset, wanted) => new JsonSyntaxError(`Unexpected ${shown(text, offset)}: ${wanted} was expected.`, ...position(text, offset));
  const newline = () => emit('\n' + INDENT.repeat(frames.length));
  const wanted = () => ({ value: 'a value', name: 'a member name', 'name-or-close': 'a member name or "}"', 'value-or-close': 'a value or "]"',
    colon: '":"', 'comma-or-close': `"," or "${frames.at(-1)?.close}"`, end: 'the end of the text' })[expect];
  const afterValue = () => { expect = frames.length ? 'comma-or-close' : 'end'; };
  const stringFaultAt = offset => { const stop = stringFault(text, offset); return fault(stop, text[stop] === '\\' ? 'a valid escape sequence' : 'the closing quote of the string'); };
  for (;;) {
    at += match(WHITESPACE, text, at);
    if (at >= text.length) break;
    const end = tokenEnd(text, at);
    if (end < 0) throw text[at] === '"' ? stringFaultAt(at) : fault(at, wanted());
    const token = text.slice(at, end);
    const first = token[0];
    const isValue = !PUNCTUATION.includes(first) || first === '{' || first === '[';
    if (expect === 'end') throw fault(at, wanted());
    if (expect === 'colon') { if (first !== ':') throw fault(at, wanted()); emit(': '); expect = 'value'; }
    else if (expect === 'comma-or-close') {
      const frame = frames.at(-1);
      if (first === ',') { emit(','); newline(); expect = frame.close === '}' ? 'name' : 'value'; }
      else if (first === frame.close) { frames.pop(); newline(); emit(first); afterValue(); }
      else throw fault(at, wanted());
    }
    else if ((expect === 'name-or-close' && first === '}') || (expect === 'value-or-close' && first === ']')) { frames.pop(); emit(first); afterValue(); }
    else if (expect === 'name' || expect === 'name-or-close') {
      if (first !== '"') throw fault(at, wanted());
      if (expect === 'name-or-close') newline();
      emit(token); expect = 'colon';
    }
    else {
      if (!isValue) throw fault(at, wanted());
      if (expect === 'value-or-close') newline();
      emit(token);
      if (first === '{' || first === '[') {
        if (frames.length === JSON_DEPTH_LIMIT) throw new JsonFormatLimitError(`The value nests deeper than ${JSON_DEPTH_LIMIT} levels.`);
        frames.push({ close: first === '{' ? '}' : ']' });
        expect = first === '{' ? 'name-or-close' : 'value-or-close';
      } else afterValue();
    }
    at = end;
  }
  if (expect !== 'end') throw fault(text.length, wanted());
  emit('\n');
  return out.join('');
}

/**
 * JSON Lines: every non-blank line formatted as its own value, in order. A fault is reported with the line number
 * of the whole text.
 */
export function formatJsonLines(text) {
  const out = [];
  let size = 0;
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let formatted;
    try { formatted = formatJson(line); }
    catch (error) { throw error instanceof JsonSyntaxError ? new JsonSyntaxError(error.message, index + 1, error.column) : error; }
    size += formatted.length;
    if (size > JSON_FORMAT_LIMIT) throw new JsonFormatLimitError('The formatted text would exceed the 8 MiB preview limit.');
    out.push(formatted);
  });
  return out.join('');
}
