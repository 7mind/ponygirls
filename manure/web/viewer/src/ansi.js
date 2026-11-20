// ANSI escape sequences (ECMA-48) in text such as terminal and CI logs: SGR colours and weights become classes,
// every other sequence is removed from the rendered text.

const ESC = '\x1b';
// CSI: parameters 0x30–0x3F, intermediates 0x20–0x2F, final 0x40–0x7E. OSC: up to BEL or ST, never past its line.
// Other escapes: intermediates and one final byte. A lone ESC is removed.
const SEQUENCE = /\x1b(?:\[([0-?]*)([ -\/]*)([@-~])|\][^\x07\x1b\n]*(?:\x07|\x1b\\)?|[ -\/]*[0-~])?/g;
const BASIC_COLOURS = 8;
const PALETTE_COLOURS = 16;
const EXTENDED_COLOUR = { 5: 1, 2: 3 }; // 38;5;n and 38;2;r;g;b: the number of parameters after the selector

/** Whether the text contains escape sequences that the rendered view interprets or removes. */
export function hasAnsi(text) { return text.includes(ESC); }

function initial() { return { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null }; }
function classes(state) {
  return [state.bold && 'ansi-bold', state.dim && 'ansi-dim', state.italic && 'ansi-italic', state.underline && 'ansi-underline',
    state.fg !== null && `ansi-fg-${state.fg}`, state.bg !== null && `ansi-bg-${state.bg}`].filter(Boolean).join(' ');
}

/** Applies one SGR parameter list. Colours outside the 16-colour palette select the default colour. */
function applySgr(state, parameters) {
  const codes = parameters.split(';');
  for (let i = 0; i < codes.length; i++) {
    // An empty parameter is 0. Colon sub-parameters (38:2::r:g:b) are one extended-colour parameter.
    const extended = codes[i].includes(':');
    const code = extended ? Number(codes[i].split(':')[0]) : Number(codes[i] || 0);
    if (code === 0) Object.assign(state, initial());
    else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 22) state.bold = state.dim = false;
    else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code >= 30 && code <= 37) state.fg = code - 30;
    else if (code >= 90 && code <= 97) state.fg = code - 90 + BASIC_COLOURS;
    else if (code === 39) state.fg = null;
    else if (code >= 40 && code <= 47) state.bg = code - 40;
    else if (code >= 100 && code <= 107) state.bg = code - 100 + BASIC_COLOURS;
    else if (code === 49) state.bg = null;
    else if (code === 38 || code === 48) {
      let colour = null;
      if (!extended) {
        const selector = Number(codes[i + 1]);
        const operands = EXTENDED_COLOUR[selector];
        if (operands === undefined) return; // malformed: the rest of the list cannot be interpreted
        const index = Number(codes[i + 2]);
        if (selector === 5 && Number.isInteger(index) && index >= 0 && index < PALETTE_COLOURS) colour = index;
        i += 1 + operands;
      }
      if (code === 38) state.fg = colour; else state.bg = colour;
    }
  }
}

/** The text without escape sequences, as tokens carrying the classes of the SGR state in effect. */
export function ansiTokens(text) {
  const state = initial();
  const tokens = [];
  let at = 0;
  for (const found of text.matchAll(SEQUENCE)) {
    if (found.index > at) tokens.push({ cls: classes(state), text: text.slice(at, found.index) });
    at = found.index + found[0].length;
    if (found[3] === 'm' && found[2] === '' && /^[0-9;:]*$/.test(found[1])) applySgr(state, found[1]);
  }
  if (at < text.length) tokens.push({ cls: classes(state), text: text.slice(at) });
  return tokens;
}

/** The text unchanged, with every ESC as its own token so that the raw view can mark it. */
export function escapeTokens(text) {
  return text.split(ESC).flatMap((part, index) => [...(index ? [{ cls: 'ctl-esc', text: ESC }] : []), ...(part ? [{ cls: '', text: part }] : [])]);
}
