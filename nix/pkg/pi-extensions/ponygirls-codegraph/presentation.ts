import type { BorderBadge } from "@ponygirls/pi-ui";
import type { State } from "./runtime.ts";

const DETAILS_HINT = "/cg status for details";
const EMPTY_NOTICE = `Codegraph: nothing indexed in this checkout yet · ${DETAILS_HINT}`;
const ERROR_PREFIX = /^(?:Error: )+/;
export const BADGE_GLYPH = "🕸️";

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

/**
 * Border badge: the glyph alone while the index needs nothing; a word only for
 * work in progress, a state the user chose, and failure. `queries` is the
 * number of codegraph tool calls running now.
 */
export function codegraphBadge(phase: State["phase"], queries: number): BorderBadge {
  const glyph = BADGE_GLYPH;
  if (queries > 0) return { glyph, state: "running", label: queries > 1 ? `querying ${queries}` : "querying", compact: "▸" };
  switch (phase) {
    case "working": return { glyph, state: "running", label: "indexing", compact: "▸" };
    case "error": return { glyph, state: "error", label: "error", compact: "✖" };
    case "cancelled": return { glyph, state: "attention", label: "cancelled", compact: "!" };
    case "skipped": return { glyph, state: "settled", label: "off", compact: "" };
    case "empty": return { glyph, state: "settled", label: "empty", compact: "" };
    case "idle":
    case "ready": return { glyph, state: "settled", label: "", compact: "" };
  }
}
