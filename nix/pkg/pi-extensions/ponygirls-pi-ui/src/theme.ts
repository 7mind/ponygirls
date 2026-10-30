/**
 * The part of pi's Theme the kit styles with, plus the shared state palette.
 * Only theme tokens are used, so custom and light themes keep working.
 */

/** Foreground tokens the kit and its callers use. */
export type UiFg =
  | "text"
  | "muted"
  | "dim"
  | "accent"
  | "border"
  | "borderMuted"
  | "success"
  | "warning"
  | "error"
  | "thinkingOff"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh"
  | "thinkingXhigh"
  | "thinkingMax";

/** Background tokens the kit uses. */
export type UiBg = "selectedBg" | "toolPendingBg";

export interface UiTheme {
  fg(color: UiFg, text: string): string;
  bg(color: UiBg, text: string): string;
  bold(text: string): string;
}

const same = (text: string): string => text;

/** No styling: headless output and tests. */
export const PLAIN_THEME: UiTheme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: same };

/**
 * What a status means to the user; colour follows meaning, not the extension.
 * ok/idle → success, running → accent, attention (needs the user) → warning,
 * error → error, settled (finished, nothing to do) → muted.
 */
export type UiState = "ok" | "running" | "attention" | "error" | "settled";

const STATE_COLOR: Readonly<Record<UiState, UiFg>> = {
  ok: "success",
  running: "accent",
  attention: "warning",
  error: "error",
  settled: "muted",
};

export function stateColor(state: UiState): UiFg {
  return STATE_COLOR[state];
}
