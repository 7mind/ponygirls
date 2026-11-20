import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { tintBadge, type BadgeTheme } from "./badge-palette.ts";
import { stateColor, type UiState, type UiTheme } from "./theme.ts";

const WIDE_BADGE_MIN_COLUMNS = 120;
const RESET_BACKGROUND = "\x1b[49m";

export interface BorderBadge {
  /** Identity glyph; an emoji keeps its own colours. */
  glyph: string;
  /** What the label reports; it colours the label. */
  state: UiState;
  /** Short facts after the glyph (`3 ▸2`, `indexing`); empty for a quiet badge. */
  label: string;
  /** The label for narrow borders (`3`, `▸`); empty for a quiet badge. */
  compact: string;
  /** Optional replacement for the label on a wide editor border. */
  wideLabel?: string;
  /** Optional hint for an existing binding, only shown on the wide chip. */
  wideShortcut?: string;
}

function painted(theme: UiTheme, state: UiState, text: string): string {
  return text === "" ? "" : theme.fg(stateColor(state), text);
}

/** Padded form, with a state tint and more detail on wide editor borders. */
export function borderBadge(theme: BadgeTheme, badge: BorderBadge, width: number): string {
  const wide = width >= WIDE_BADGE_MIN_COLUMNS;
  const text = wide ? (badge.wideLabel ?? badge.label) : badge.label;
  const hint = wide && badge.wideShortcut !== undefined ? ` · ${badge.wideShortcut}` : "";
  if (wide) {
    // Pi measures the whole chip against the slot's share and calls renderCompact
    // if it won't fit. Don't hide the true width by truncating the wide details.
    const label = text === "" ? "" : ` ${text}`;
    if (visibleWidth(` ${badge.glyph}${label}${hint} `) > width) return borderBadgeCompact(theme, badge, width);
    const tinted = tintBadge(theme, badge.state, badge.glyph, text, hint);
    if (tinted !== undefined) return tinted;
  }
  const styledLabel = text === "" ? "" : ` ${painted(theme, badge.state, text)}`;
  const styledHint = hint === "" ? "" : theme.fg("muted", hint);
  const line = ` ${badge.glyph}${styledLabel}${styledHint} `;
  if (!wide) return truncateToWidth(line, width, "");
  // Pi trims trailing whitespace before measuring widgets. Keep the wide hit span
  // even when a theme only exposes terminal-defined palette indices.
  return theme.getColorMode === undefined ? line : line + RESET_BACKGROUND;
}

/** Unpadded fallback for a crowded border, even at a wide terminal size. */
export function borderBadgeCompact(theme: UiTheme, badge: BorderBadge, width: number): string {
  return truncateToWidth(`${badge.glyph}${painted(theme, badge.state, badge.compact)}`, width, "");
}
