import { compactChip, type UiState, type UiTheme } from "@ponygirls/pi-ui";
import type { State } from "./runtime.ts";

const DETAILS_HINT = "/cg status for details";
const EMPTY_NOTICE = `Codegraph: nothing indexed in this checkout yet · ${DETAILS_HINT}`;
const ERROR_PREFIX = /^(?:Error: )+/;
const COMPACT_LABEL = "cg";

export interface StateNotice {
  text: string;
  level: "info" | "error";
}

/**
 * One line per state change that needs the user's attention; the full detail
 * (status JSON, CLI output) stays in the state and is shown by /cg status.
 */
export function stateNotice(state: State): StateNotice | null {
  if (state.phase === "empty") return { text: EMPTY_NOTICE, level: "info" };
  if (state.phase !== "error") return null;
  const first = state.detail.split("\n").map((line) => line.replace(ERROR_PREFIX, "").trim()).find((line) => line !== "");
  const summary = first === undefined ? "failed" : first.replace(/:$/, "");
  return { text: `Codegraph: ${summary} · ${DETAILS_HINT}`, level: "error" };
}

interface CompactBadge {
  glyph: string;
  state: UiState;
}

function compactBadge(phase: State["phase"], querying: boolean): CompactBadge {
  if (querying || phase === "working") return { glyph: "⚙", state: "running" };
  if (phase === "ready") return { glyph: "◇", state: "ok" };
  if (phase === "error") return { glyph: "✖", state: "error" };
  return { glyph: "◇", state: "settled" };
}

/** The short border form: neutral chip, glyph coloured by state. */
export function renderCompactBadge(theme: UiTheme, phase: State["phase"], querying: boolean): string {
  const badge = compactBadge(phase, querying);
  return compactChip(theme, badge.glyph, badge.state, COMPACT_LABEL);
}
