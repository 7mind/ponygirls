/** @typedef {{cls:string, text:string}} Token  A run of text with the CSS classes of its span ('' for none). */

const LINE = /[^\n]*\n|[^\n]+$/g;

/** Lines of a text, each with its line feed; joined, they are the text. */
export function textLines(text) { return text.match(LINE) || []; }

/** Splits a token stream at line feeds: one token list per line, every line keeping its line feed. */
export function tokenLines(tokens) {
  const lines = [];
  let line = [];
  for (const { cls, text } of tokens) {
    for (const piece of text.match(LINE) || []) {
      line.push({ cls, text: piece });
      if (piece.endsWith('\n')) { lines.push(line); line = []; }
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
