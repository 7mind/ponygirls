/**
 * pi-subagents — display primitives shared by the TUI views.
 *
 * Child content is untrusted display input: terminal sequences and control
 * characters are stripped before anything is styled or rendered.
 */

/** Strip ANSI CSI/OSC sequences and control characters for safe display. */
export function sanitizeDisplay(input: string, maxLength = 4000): string {
  let out = input.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return out.length > maxLength ? `${out.slice(0, maxLength)}…[truncated]` : out;
}

/** Semantic styles the views apply; each wraps already-sanitized text. */
export interface UiStyle {
  text(s: string): string;
  muted(s: string): string;
  dim(s: string): string;
  accent(s: string): string;
  success(s: string): string;
  error(s: string): string;
  warning(s: string): string;
  thinking(s: string): string;
  bold(s: string): string;
  /** Highlight for a selected row (already padded to the row width). */
  selected(s: string): string;
}

const same = (s: string): string => s;

/** No styling: headless output and tests. */
export const PLAIN_STYLE: UiStyle = { text: same, muted: same, dim: same, accent: same, success: same, error: same, warning: same, thinking: same, bold: same, selected: same };

/** The part of pi's theme the views use. */
export interface ThemeLike {
  fg(color: "text" | "muted" | "dim" | "accent" | "success" | "error" | "warning" | "thinkingText", text: string): string;
  bg(color: "selectedBg", text: string): string;
  bold(text: string): string;
}

export function themeStyle(theme: ThemeLike): UiStyle {
  return {
    text: (s) => theme.fg("text", s),
    muted: (s) => theme.fg("muted", s),
    dim: (s) => theme.fg("dim", s),
    accent: (s) => theme.fg("accent", s),
    success: (s) => theme.fg("success", s),
    error: (s) => theme.fg("error", s),
    warning: (s) => theme.fg("warning", s),
    thinking: (s) => theme.fg("thinkingText", s),
    bold: (s) => theme.bold(s),
    selected: (s) => theme.bg("selectedBg", s),
  };
}
