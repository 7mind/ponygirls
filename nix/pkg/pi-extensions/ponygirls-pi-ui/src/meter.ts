/**
 * Usage bars coloured by state.
 */
import { stateColor, type UiState, type UiTheme } from "./theme.ts";

/** Fraction at which a quota/budget needs attention (tokemon's "low"). */
export const ATTENTION_FRACTION = 0.9;

/** ok below 90 %, attention from 90 %, error at 100 % or more. */
export function fractionState(fraction: number): UiState {
  if (fraction >= 1) return "error";
  if (fraction >= ATTENTION_FRACTION) return "attention";
  return "ok";
}

/** `width` cells: filled `█` in the state colour, empty `░` dim. */
export function usageBar(theme: UiTheme, fraction: number, width: number, state: UiState): string {
  const cells = Math.max(0, Math.floor(width));
  const filled = Math.max(0, Math.min(cells, Math.round(Math.min(Math.max(fraction, 0), 1) * cells)));
  const full = "█".repeat(filled);
  const empty = "░".repeat(cells - filled);
  return (full ? theme.fg(stateColor(state), full) : "") + (empty ? theme.fg("dim", empty) : "");
}
