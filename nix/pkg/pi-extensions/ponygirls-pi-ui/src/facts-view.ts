import { matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { frameRule, frameTitle, keyHints, type KeyHint } from "./frame.ts";
import { HINT } from "./keys.ts";
import type { PanelParts } from "./panel-layout.ts";
import { ReadOnlyBodyPager, type BodyPagerHost } from "./read-only-body-pager.ts";
import { MARKER_WIDTH } from "./rows.ts";
import { stateColor, type UiState, type UiTheme } from "./theme.ts";

/** One part of a fact's value. `state` colours it; without one it is plain text. */
export interface FactSegment {
  text: string;
  state?: UiState;
}

/** A label and its value; the value's segments are joined with ` · `. */
export interface Fact {
  label: string;
  value: readonly FactSegment[];
}

/** Facts shown together; a blank line separates groups. */
export type FactGroup = readonly Fact[];

/** The short state on the right of the title, coloured by `state`. */
export interface FactsState {
  text: string;
  state: UiState;
}

export interface FactsViewOptions extends BodyPagerHost {
  /** The thing's name, without "status". */
  title: string;
  state: FactsState;
  /** Read with the pane width, again after a resize or `invalidate()`. */
  facts(width: number): readonly FactGroup[];
  /** Complete text behind `d`, read like `facts`; `null` when there is nothing more to show. */
  details: ((width: number) => string) | null;
  theme: UiTheme;
}

const DETAILS_KEY = "d";
const SHOW_DETAILS: KeyHint = { key: DETAILS_KEY, action: "details" };
const SHOW_FACTS: KeyHint = { key: DETAILS_KEY, action: "facts" };
/** Columns between the label column and the values. */
const LABEL_GAP = 2;
const SEPARATOR = " · ";
/** Leads a segment that wrapped onto its own line. */
const CONTINUATION = "· ";
/** A narrower value column moves each value under its label instead of clipping it. */
const MIN_VALUE_WIDTH = 16;
/** Where a value starts when it is under its label. */
const STACKED_INDENT = MARKER_WIDTH * 2;

/** Break plain text to `width`: between words, a longer path after a `/`, anything longer anywhere. */
function breakText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  const place = (piece: string, glue: string): void => {
    if (line !== "" && visibleWidth(line) + glue.length + visibleWidth(piece) <= width) {
      line += glue + piece;
      return;
    }
    if (line !== "") lines.push(line);
    const broken = wrapTextWithAnsi(piece, width);
    lines.push(...broken.slice(0, -1));
    line = broken[broken.length - 1];
  };
  for (const word of text.split(" ")) {
    const pieces = visibleWidth(word) > width ? word.split(/(?<=\/)/) : [word];
    pieces.forEach((piece, index) => place(piece, index === 0 ? " " : ""));
  }
  lines.push(line);
  return lines;
}

/** Segments fill each line whole; one wider than a line is broken and hangs under its own text. */
function wrapValue(theme: UiTheme, value: readonly FactSegment[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let used = 0;
  value.forEach((segment, index) => {
    const style = (text: string): string => theme.fg(segment.state === undefined ? "text" : stateColor(segment.state), text);
    const size = visibleWidth(segment.text);
    if (index > 0 && used + SEPARATOR.length + size <= width) {
      line += theme.fg("dim", SEPARATOR) + style(segment.text);
      used += SEPARATOR.length + size;
      return;
    }
    const continued = index > 0;
    if (continued) lines.push(line);
    const lead = continued ? theme.fg("dim", CONTINUATION) : "";
    const hang = continued ? CONTINUATION.length : 0;
    const broken = breakText(segment.text, Math.max(1, width - hang));
    const rows = broken.map((text, row) => `${row === 0 ? lead : " ".repeat(hang)}${style(text)}`);
    lines.push(...rows.slice(0, -1));
    line = rows[rows.length - 1];
    used = hang + visibleWidth(broken[broken.length - 1]);
  });
  lines.push(line);
  return lines;
}

function renderFacts(theme: UiTheme, width: number, groups: readonly FactGroup[]): string[] {
  const shown = groups.filter((group) => group.length > 0);
  const labelWidth = Math.max(0, ...shown.flatMap((group) => group.map((fact) => visibleWidth(fact.label))));
  const valueColumn = MARKER_WIDTH + labelWidth + LABEL_GAP;
  const stacked = width - valueColumn < MIN_VALUE_WIDTH;
  const gutter = " ".repeat(MARKER_WIDTH);
  const valueIndent = " ".repeat(stacked ? STACKED_INDENT : valueColumn);
  const valueWidth = Math.max(1, width - valueIndent.length);
  const lines: string[] = [];
  shown.forEach((group, index) => {
    if (index > 0) lines.push("");
    for (const fact of group) {
      const label = theme.fg("dim", fact.label);
      const value = wrapValue(theme, fact.value, valueWidth);
      if (stacked) {
        lines.push(`${gutter}${label}`, ...value.map((line) => `${valueIndent}${line}`));
        continue;
      }
      const pad = " ".repeat(labelWidth - visibleWidth(fact.label) + LABEL_GAP);
      value.forEach((line, row) => lines.push(row === 0 ? `${gutter}${label}${pad}${line}` : `${valueIndent}${line}`));
    }
  });
  // Indents alone can exceed a terminal a few columns wide.
  return lines.map((line) => truncateToWidth(line, width, ""));
}

interface Content {
  width: number;
  facts: string[] | null;
  details: string[] | null;
}

/**
 * Read-only state-first snapshot: the name and state in the title, labelled
 * facts below, and optionally the complete text behind `d`. Scrolls and closes
 * like `StatusView`.
 */
export class FactsView extends ReadOnlyBodyPager<FactsViewOptions> {
  private readonly detailsText = new Text("", 0, 0);
  private content: Content | null = null;
  private showingDetails = false;

  override invalidate(): void { this.content = null; this.detailsText.invalidate(); }

  private body(width: number): string[] {
    const { theme, facts, details } = this.options;
    if (this.content === null || this.content.width !== width) this.content = { width, facts: null, details: null };
    const content = this.content;
    if (this.showingDetails && details !== null) {
      if (content.details === null) {
        this.detailsText.setText(details(width));
        content.details = this.detailsText.render(width);
      }
      return content.details;
    }
    if (content.facts === null) content.facts = renderFacts(theme, width, facts(width));
    return content.facts;
  }

  protected override renderParts(width: number): PanelParts {
    const { theme, title, state, details } = this.options;
    const toggle = details === null ? [] : [this.showingDetails ? SHOW_FACTS : SHOW_DETAILS];
    return {
      header: [frameTitle(theme, width, { title, right: theme.fg(stateColor(state.state), state.text) }, "none").line],
      body: this.body(width),
      footer: [frameRule(theme, width), ...keyHints(theme, width, [HINT.scroll, ...toggle, HINT.close]).lines],
    };
  }

  protected override handleBodyInput(data: string): void {
    if (matchesKey(data, DETAILS_KEY)) {
      if (this.options.details === null) return;
      this.showingDetails = !this.showingDetails;
      this.scroll.scrollToStart();
      return;
    }
    super.handleBodyInput(data);
  }
}
