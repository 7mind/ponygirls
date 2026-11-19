import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stateColor, type UiBg, type UiState, type UiTheme } from "./theme.ts";

const WIDE_BADGE_MIN_COLUMNS = 120;
const WIDE_BADGE_BG: Readonly<Record<UiState, UiBg>> = {
  ok: "toolSuccessBg",
  running: "toolPendingBg",
  attention: "customMessageBg",
  error: "toolErrorBg",
  settled: "toolPendingBg",
};

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

/** Padded form, with a themed background and more detail on wide editor borders. */
export function borderBadge(theme: UiTheme, badge: BorderBadge, width: number): string {
  const wide = width >= WIDE_BADGE_MIN_COLUMNS;
  const text = wide ? (badge.wideLabel ?? badge.label) : badge.label;
  const label = text === "" ? "" : ` ${painted(theme, badge.state, text)}`;
  const hint = wide && badge.wideShortcut !== undefined ? theme.fg("muted", ` · ${badge.wideShortcut}`) : "";
  const line = ` ${badge.glyph}${label}${hint} `;
  if (!wide) return truncateToWidth(line, width, "");
  // Pi measures the whole chip against the slot's share and calls renderCompact
  // if it won't fit. Don't hide the true width by truncating the wide details.
  return visibleWidth(line) <= width ? theme.bg(WIDE_BADGE_BG[badge.state], line) : borderBadgeCompact(theme, badge, width);
}

/** Unpadded fallback for a crowded border, even at a wide terminal size. */
export function borderBadgeCompact(theme: UiTheme, badge: BorderBadge, width: number): string {
  return truncateToWidth(`${badge.glyph}${painted(theme, badge.state, badge.compact)}`, width, "");
}
