/**
 * Tool definitions are untrusted text: MCP servers and extensions write them.
 * Before any of it is drawn, every character that could act on the terminal
 * or reorder what is shown becomes a visible escape, so nothing is hidden and
 * nothing runs.
 */

const TAB = " ".repeat(4);
/** C0 except line feed (tabs are expanded first), DEL, C1, bidi controls, line and paragraph separators, BOM. */
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
const HEX_DIGITS = 4;

function escapeOf(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(HEX_DIGITS, "0")}`;
}

/** Multi-line text, safe to draw. */
export function displayText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, TAB).replace(UNSAFE, escapeOf);
}

/** The same on one line: every run of whitespace becomes one space. */
export function displayLine(text: string): string {
  return displayText(text).replace(/\s+/g, " ").trim();
}
