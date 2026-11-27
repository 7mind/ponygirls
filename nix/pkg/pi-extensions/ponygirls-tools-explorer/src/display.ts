/**
 * Tool definitions are untrusted text: MCP servers and extensions write them,
 * and the model reads every character of them. Before any of it is drawn,
 * each character that would act on the terminal, reorder what is shown or be
 * drawn as nothing becomes a visible escape: nothing runs, and the reader sees
 * what the model gets.
 */

const TAB = " ".repeat(4);
/**
 * Controls other than the line feed, format characters (bidi controls, Unicode tags, zero-width characters),
 * line and paragraph separators, lone surrogates, and what Unicode draws as nothing by default (variation
 * selectors, fillers).
 */
const HIDDEN = String.raw`(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}]`;
/**
 * Emoji are built with two of those characters: a selector after a pictograph, and joiners between
 * pictographs. A whole emoji is kept as written. Keycaps are a digit, a selector and the keycap mark.
 */
const PICTOGRAPH = String.raw`\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?`;
const EMOJI = String.raw`${PICTOGRAPH}(?:\u200D${PICTOGRAPH})*|[0-9#*]\uFE0F\u20E3`;
const EMOJI_OR_HIDDEN = new RegExp(`(${EMOJI})|${HIDDEN}`, "gu");
const HEX = 16;
const UNIT_DIGITS = 4;
const LAST_UNIT = 0xffff;

function unitEscape(unit: number): string {
  return `\\u${unit.toString(HEX).padStart(UNIT_DIGITS, "0")}`;
}

/** `\u202e`, and `\u{e0041}` beyond the 16-bit range. */
function readableEscape(character: string): string {
  const codePoint = character.codePointAt(0)!;
  return codePoint > LAST_UNIT ? `\\u{${codePoint.toString(HEX)}}` : unitEscape(codePoint);
}

/** The escape JSON has for the character: one `\uXXXX` per UTF-16 unit. */
function jsonEscape(character: string): string {
  return Array.from({ length: character.length }, (_unused, index) => unitEscape(character.charCodeAt(index))).join("");
}

function reveal(text: string, escape: (character: string) => string): string {
  return text.replace(EMOJI_OR_HIDDEN, (match: string, emoji: string | undefined) => (emoji === undefined ? escape(match) : match));
}

/** Multi-line text, safe to draw. */
export function displayText(text: string): string {
  return reveal(text.replace(/\r\n?/g, "\n").replace(/\t/g, TAB), readableEscape);
}

/** The same on one line: every run of whitespace becomes one space. */
export function displayLine(text: string): string {
  return displayText(text).replace(/\s+/g, " ").trim();
}

/**
 * JSON text as `JSON.stringify` wrote it, safe to draw and still JSON for the same value: what stringify
 * left unescaped is escaped the way JSON escapes it.
 */
export function displayJson(json: string): string {
  return reveal(json, jsonEscape);
}
