/**
 * Raw PTY bytes → display/model text. The disk log keeps raw bytes; this
 * never replays terminal control sequences (OSC/DCS/CSI/...) into Pi's
 * terminal or the model context. It is a line viewer, not a terminal emulator.
 */

const ESC = 0x1b;
const BEL = 0x07;
const UTF8_MAX_SEQUENCE = 4;
/** An escape sequence longer than this at a window end is treated as garbage, not split. */
const MAX_PENDING_ESCAPE_BYTES = 256;

/** Number of trailing bytes that form an incomplete UTF-8 sequence. */
function incompleteUtf8Tail(bytes: Uint8Array): number {
  const end = bytes.length;
  for (let back = 1; back <= Math.min(UTF8_MAX_SEQUENCE, end); back++) {
    const b = bytes[end - back]!;
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return need > back ? back : 0;
  }
  return 0;
}

/** Start index of an escape sequence that is still unterminated at the end, or -1. */
function unterminatedEscape(bytes: Uint8Array): number {
  const from = Math.max(0, bytes.length - MAX_PENDING_ESCAPE_BYTES);
  let start = -1;
  for (let i = bytes.length - 1; i >= from; i--) {
    if (bytes[i] === ESC) {
      start = i;
      break;
    }
  }
  if (start < 0) return -1;
  const kind = bytes[start + 1];
  if (kind === undefined) return start;
  if (kind === 0x5b) {
    // CSI: parameters/intermediates then a final byte 0x40-0x7e.
    for (let i = start + 2; i < bytes.length; i++) if (bytes[i]! >= 0x40 && bytes[i]! <= 0x7e) return -1;
    return start;
  }
  if (kind === 0x5d || kind === 0x50 || kind === 0x58 || kind === 0x5e || kind === 0x5f) {
    // OSC/DCS/SOS/PM/APC: terminated by BEL (OSC) or ST (ESC \).
    for (let i = start + 2; i < bytes.length; i++) {
      if (bytes[i] === BEL && kind === 0x5d) return -1;
      if (bytes[i] === ESC && bytes[i + 1] === 0x5c) return -1;
    }
    return start;
  }
  // Two-byte or intermediate escape: ESC [ -/]* [0-~]
  for (let i = start + 1; i < bytes.length; i++) if (bytes[i]! >= 0x30 && bytes[i]! <= 0x7e) return -1;
  return start;
}

/**
 * Bytes of `bytes` that can be decoded now without splitting a UTF-8 sequence
 * or a terminal escape. At a finalized end of log, everything is consumed.
 */
export function consumableLength(bytes: Uint8Array, atFinalEnd: boolean): number {
  if (atFinalEnd) return bytes.length;
  let n = bytes.length - incompleteUtf8Tail(bytes);
  const esc = unterminatedEscape(bytes.subarray(0, n));
  if (esc >= 0) n = esc;
  return n;
}

/** Number of leading UTF-8 continuation bytes (a window that starts mid-character). */
export function leadingContinuationBytes(bytes: Uint8Array): number {
  let n = 0;
  while (n < Math.min(UTF8_MAX_SEQUENCE - 1, bytes.length) && (bytes[n]! & 0xc0) === 0x80) n++;
  return n;
}

// Patterns over decoded text. C1 forms (U+009B CSI etc.) are handled too.
const OSC_LIKE = /(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g;
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\x1b[ -/]*[0-~]?/g;
const STRAY_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f\x80-\x9f]/g;

/** Apply carriage returns and backspaces within one line, as a terminal would overwrite it. */
function overlayLine(line: string): string {
  if (!line.includes("\r") && !line.includes("\b")) return line;
  const cells: string[] = [];
  let col = 0;
  for (const ch of line) {
    if (ch === "\r") col = 0;
    else if (ch === "\b") col = Math.max(0, col - 1);
    else {
      cells[col] = ch;
      col++;
    }
  }
  return cells.map((c) => c ?? " ").join("");
}

/** Remove executable control sequences and normalize CR progress output. */
export function sanitizeTerminalText(text: string): string {
  const stripped = text.replace(OSC_LIKE, "").replace(CSI, "").replace(OTHER_ESCAPE, "");
  const lines = stripped.split("\n").map((line) => overlayLine(line.replace(/\r+$/, "")));
  return lines.join("\n").replace(STRAY_CONTROLS, "");
}

const decoder = new TextDecoder("utf-8", { fatal: false });

export function decodeAndSanitize(bytes: Uint8Array): string {
  return sanitizeTerminalText(decoder.decode(bytes));
}

/** Escape a short stored value (label, reason, path) for one-line display. */
export function displayValue(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function shorten(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}
