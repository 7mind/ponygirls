import { backgroundAnsi, colorToOklch, colorToRgb, foregroundAnsi, indexedColor, mixColors, parseColor, styleTextWithAnsi, type Color, type TerminalColorMode } from "@earendil-works/pi-tui";
import { stateColor, type UiFg, type UiState, type UiTheme } from "./theme.ts";

type Appearance = "dark" | "light";

/** Pi exposes resolved colours; a headless or token-only theme need not. */
export type BadgeTheme = UiTheme & {
  readonly appearance?: Appearance;
  readonly colors?: Readonly<Partial<Record<UiFg, Color>>>;
  getColorMode?(): TerminalColorMode;
};

// The editor uses the terminal's default background, which Pi's Theme doesn't expose directly.
// Use the reference surfaces from the palette review, and set both the chip and its text colours.
const SURFACE = { dark: parseColor("#21252c"), light: parseColor("#f7f6f6") };
const TINT_WEIGHT = { settled: .20, running: .20, attention: .24, error: .27, ok: .21 } satisfies Record<UiState, number>;
const MIN_CONTRAST = 4.55; // 4.5:1 for small text, with a small margin.
const INK_STEPS = 100;
const FULL_TURN = 360;
const WHITE = parseColor("#fff");
const BLACK = parseColor("#000");
const ANSI_FG_PREFIX = "\x1b[38;5;";
const ANSI_BG_PREFIX = "\x1b[48;5;";

// Rounding a soft RGB tint to xterm's cube can turn several states the same gray.
// Use the closest hue among subdued xterm swatches (red → orange → green → blue → violet).
const INDEXED_TINTS = {
  dark: [95, 94, 22, 23, 24, 60, 96],
  light: [217, 222, 151, 152, 153, 189, 225],
};

function background(appearance: Appearance, mode: TerminalColorMode, hue: Color, weight: number): Color {
  const tint = mixColors(SURFACE[appearance], hue, weight, "srgb");
  if (mode === "truecolor") return tint;
  const source = colorToOklch(hue);
  if (source.c < 0.01) return tint; // Respect an intentionally monochrome theme.
  let closest = tint;
  let distance = Infinity;
  for (const index of INDEXED_TINTS[appearance]) {
    const choice = indexedColor(index);
    const gap = Math.abs(source.h - colorToOklch(choice).h);
    const delta = Math.min(gap, FULL_TURN - gap);
    if (delta < distance) { closest = choice; distance = delta; }
  }
  return closest;
}

function luminance(color: Color): number {
  const { r, g, b } = colorToRgb(color);
  const linear = (channel: number) => {
    const x = Math.round(channel) / 255; // Pi emits integer RGB channels.
    return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  };
  return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function indexedFromAnsi(ansi: string, prefix: string): Color {
  return indexedColor(Number(ansi.slice(prefix.length, -1)));
}

// ANSI slots 0–15 can be overridden by the terminal. Pi exposes the slot, not its RGB.
function hasKnownRgb(color: Color | undefined): color is Color {
  return color !== undefined && (color.kind !== "indexed" || color.index >= 16);
}

function readableForeground(text: string, ink: Color | undefined, bg: number, mode: TerminalColorMode): string | undefined {
  if (text === "") return text;
  if (!hasKnownRgb(ink)) return undefined;
  const extreme = contrast(1, bg) >= contrast(0, bg) ? WHITE : BLACK;
  for (let step = 0; step < INK_STEPS; step++) {
    const candidate = mixColors(ink, extreme, step / INK_STEPS, "srgb");
    const ansi = foregroundAnsi(candidate, mode);
    const emitted = mode === "256color" ? indexedFromAnsi(ansi, ANSI_FG_PREFIX) : candidate;
    if (contrast(luminance(emitted), bg) >= MIN_CONTRAST) return styleTextWithAnsi(text, ansi, undefined, {});
  }
  // The better of black and white clears 4.55:1 on any opaque sRGB background.
  return styleTextWithAnsi(text, foregroundAnsi(extreme, mode), undefined, {});
}

/** Uses the live theme colours each time the badge is drawn, not when it mounts. */
export function tintBadge(theme: BadgeTheme, state: UiState, glyph: string, label: string, hint: string): string | undefined {
  const appearance = theme.appearance;
  const mode = theme.getColorMode?.();
  const colors = theme.colors;
  if (appearance === undefined || mode === undefined || colors === undefined) return undefined;
  const ink = colors[stateColor(state)];
  const muted = colors.muted;
  const hue = state === "settled" ? colors.border : ink;
  if (!hasKnownRgb(hue)) return undefined;

  const bg = background(appearance, mode, hue, TINT_WEIGHT[state]);
  const ansi = backgroundAnsi(bg, mode);
  const lightness = luminance(mode === "256color" ? indexedFromAnsi(ansi, ANSI_BG_PREFIX) : bg);
  const styledLabel = readableForeground(label, ink, lightness, mode);
  const styledHint = readableForeground(hint, muted, lightness, mode);
  if (styledLabel === undefined || styledHint === undefined) return undefined;
  const text = ` ${glyph}${label === "" ? "" : ` ${styledLabel}`}${styledHint} `;
  return styleTextWithAnsi(text, undefined, ansi, {});
}
