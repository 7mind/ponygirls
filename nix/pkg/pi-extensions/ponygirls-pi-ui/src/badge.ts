/**
 * One look for every border badge: the identity glyph, then a short label
 * coloured by state. A badge with nothing to report is its glyph alone.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import { stateColor, type UiState, type UiTheme } from "./theme.ts";

export interface BorderBadge {
  /** Identity glyph; an emoji keeps its own colours. */
  glyph: string;
  /** What the label reports; it colours the label. */
  state: UiState;
  /** Short facts after the glyph (`3 ▸2`, `indexing`); empty for a quiet badge. */
  label: string;
  /** The label for narrow borders (`3`, `▸`); empty for a quiet badge. */
  compact: string;
}

function painted(theme: UiTheme, state: UiState, text: string): string {
  return text === "" ? "" : theme.fg(stateColor(state), text);
}

/** Full border form, padded: ` 👥 3 ▸2 `. */
export function borderBadge(theme: UiTheme, badge: BorderBadge, width: number): string {
  const label = badge.label === "" ? "" : ` ${painted(theme, badge.state, badge.label)}`;
  return truncateToWidth(` ${badge.glyph}${label} `, width, "");
}

/** Narrow border form, unpadded: `👥3`. */
export function borderBadgeCompact(theme: UiTheme, badge: BorderBadge, width: number): string {
  return truncateToWidth(`${badge.glyph}${painted(theme, badge.state, badge.compact)}`, width, "");
}
