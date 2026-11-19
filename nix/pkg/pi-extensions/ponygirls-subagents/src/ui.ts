/**
 * ponygirls-subagents — governing-session observation and the /agents screen.
 *
 * One event model, several views: list_agents, read_agent, wait_agent, the
 * border badge, and the /agents screen project the same journal-backed
 * state. The screen lists the tree with the selected agent's details and
 * opens any agent's transcript, whose chat line messages that agent.
 * Actions use the same supervisor API as tools and record human origin.
 *
 * Child content is untrusted display input: ANSI/OSC sequences are
 * sanitized before rendering. Headless output contains no terminal escapes.
 * Escape leaves a view; it never terminates children.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { VStack, Input, Key, matchesKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { HINT, KEY, MARKER_WIDTH, PLAIN_THEME, PanelLayout, type PanelParts, columnCells, columnHeader, formatCompact, formatCount, frameRule, frameTitle, keyHints, listRow, stateColor, type BorderBadge, type Column, type KeyHint, type UiFg, type UiTheme } from "@ponygirls/pi-ui";
import { thinkingColor } from "../../ponygirls-model-picker-view.ts";
import { AGENT_GLYPH, OUTCOME_GLYPH, PHASE_GLYPH, PLAIN_STYLE, homeRelative, outcomeTone, sanitizeDisplay, type AgentPhase, type UiStyle } from "./display.ts";
import type { AgentView, TranscriptSource } from "./supervisor.ts";
import { parseTranscript, renderConversation, type ReviewBlock, type TranscriptItem } from "./transcript.ts";

export { sanitizeDisplay } from "./display.ts";

export type InspectorAction =
  | { kind: "transcript"; agentId: string }
  | { kind: "message"; agentId: string }
  | { kind: "task"; agentId: string }
  | { kind: "interrupt"; agentId: string }
  | { kind: "close"; agentId: string }
  | { kind: "answer"; agentId: string }
  | { kind: "retry_review"; agentId: string };

export interface TreeCounts {
  running: number;
  queued: number;
  parked: number;
  questions: number;
}

export function countTree(views: AgentView[]): TreeCounts {
  const counts: TreeCounts = { running: 0, queued: 0, parked: 0, questions: 0 };
  for (const v of views) {
    if (v.observed === "running" || v.observed === "starting") counts.running++;
    else if (v.observed === "queued") counts.queued++;
    else counts.parked++;
    if (v.pendingIntent === "awaiting parent reply") counts.questions++;
  }
  return counts;
}

/** Headless summary line: the total, plus whatever is running, queued, or waiting on a reply. */
export function widgetLine(views: AgentView[]): string {
  const c = countTree(views);
  const parts = [`agents ${views.length}`];
  if (c.running > 0) parts.push(`running ${c.running}`);
  if (c.queued > 0) parts.push(`queued ${c.queued}`);
  if (c.questions > 0) parts.push(`questions ${c.questions}`);
  return parts.join(" · ");
}

/** Headless projection: structured text, no terminal escapes. */
export function renderHeadless(views: AgentView[]): string {
  if (views.length === 0) return "No subagents.";
  return views
    .map(
      (v) =>
        `${sanitizeDisplay(v.path)} [${v.profile}, ${v.isolation}] ${v.observed}${v.pendingIntent !== v.observed ? ` (${sanitizeDisplay(v.pendingIntent)})` : ""} gen=${v.generation} model=${sanitizeDisplay(v.model)}${v.taskOutcome ? ` outcome=${v.taskOutcome}` : ""} workdir=${sanitizeDisplay(v.workdir)}`,
    )
    .join("\n");
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, width, "…");
}

/** The more specific of observed state and pending intent ("awaiting parent reply" over "awaiting_parent"). */
function stateText(v: AgentView): string {
  return v.pendingIntent || v.observed;
}

/** Glyph and outcome in the outcome's colour (classified on the raw outcome, before any padding). */
export function outcomeLabel(theme: UiTheme, outcome: string): string {
  const tone = outcomeTone(outcome);
  return theme.fg(tone, `${OUTCOME_GLYPH[tone]} ${sanitizeDisplay(outcome)}`);
}

/** A question waiting on someone wins over running; other states stay uncoloured. */
function stateTone(v: AgentView): UiFg | null {
  if (v.openQuestion) return "warning";
  return v.observed === "running" ? "accent" : null;
}

function stateLabel(theme: UiTheme, v: AgentView): string {
  const text = sanitizeDisplay(stateText(v));
  const color = stateTone(v);
  return color ? theme.fg(color, text) : text;
}

function kindText(v: AgentView): string {
  return v.managedGateFor ? "gate reviewer" : `${v.profile} · ${v.isolation}`;
}

/** Selected agent's result and open question for the detail panel. */
export interface AgentDetails {
  result: string | null;
  question: string | null;
}

export interface InspectorDeps {
  refresh(): AgentView[];
  describe(agentId: string): AgentDetails;
  onAction(action: InspectorAction): void;
  onClose(): void;
  /** Terminal height, for sizing the list. */
  rows(): number;
  theme: UiTheme;
  /** Home directory, for showing paths as `~/…`. */
  home: string;
}

const DETAIL_RESULT_LINES = 6;
/** Columns between a detail key and its value. */
const DETAIL_GAP = 2;
/** Lines the inspector needs besides the list: title, column header, rules, detail panel, status, hints. */
const INSPECTOR_CHROME = 20;
/** First list row in the inspector's rendered lines (after the title and the column header). */
const LIST_TOP = 2;
const COLUMN_GAP = 2;
const PATH_WIDTH = { min: 8, preferred: 24 };
/** Longest state text a list cell shows (after its glyph). */
const STATE_TEXT_MAX = 24;
const MAX_INDENT = 4;
const INDENT_STEP = 2;
const ELLIPSIS = "…";
const TITLE = "Subagents";
/** A table cell without a value (conventions: zeros stay quiet). */
const NO_VALUE = "·";

/** Phases with work under way, in the order the badge and the title count them. */
const LIVE_PHASES: readonly AgentPhase[] = ["running", "queued", "asking"];
/** Order of the title's counts. */
const PHASES: readonly AgentPhase[] = [...LIVE_PHASES, "settled"];
/** Identity glyph of the border badge. */
const BADGE_GLYPH = "👥";
const PHASE_TONE: Readonly<Record<AgentPhase, UiFg>> = { running: stateColor("running"), queued: "muted", asking: stateColor("attention"), settled: stateColor("settled") };
/** The state text an outcome stands in for. */
const SETTLED = "settled";

/** A question waiting on someone wins over running; an agent that neither runs nor waits is settled. */
export function phaseOf(v: AgentView): AgentPhase {
  if (v.openQuestion !== null || v.observed === "awaiting_parent") return "asking";
  if (v.observed === "running" || v.observed === "starting") return "running";
  if (v.observed === "queued") return "queued";
  return "settled";
}

/** The non-zero agent counts of `phases`, in their order. */
function phaseCounts(views: AgentView[], phases: readonly AgentPhase[]): Array<{ phase: AgentPhase; count: number }> {
  return phases.map((phase) => ({ phase, count: views.filter((v) => phaseOf(v) === phase).length })).filter(({ count }) => count > 0);
}

/**
 * Border badge: the number of agents, then the live ones by phase behind the
 * list's glyphs (`4 ●1 ○2 ?1`). An asking agent needs the user; otherwise
 * live work runs, or the tree is settled. The narrow form keeps the number
 * and marks a waiting question (`3?`).
 */
export function agentsBadge(views: AgentView[]): BorderBadge {
  const live = phaseCounts(views, LIVE_PHASES);
  const asking = live.some(({ phase }) => phase === "asking");
  return {
    glyph: BADGE_GLYPH,
    state: asking ? "attention" : live.length > 0 ? "running" : "settled",
    label: [String(views.length), ...live.map(({ phase, count }) => `${PHASE_GLYPH[phase]}${count}`)].join(" "),
    compact: `${views.length}${asking ? PHASE_GLYPH.asking : ""}`,
  };
}

/** A settled agent's state is its outcome. */
function showsOutcome(v: AgentView): boolean {
  return phaseOf(v) === "settled" && Boolean(v.taskOutcome);
}

/** Open agents other than gate reviewers take notes and tasks (the rule of the transcript's chat line). */
function acceptsMessages(v: AgentView): boolean {
  return v.desiredLifecycle !== "closed" && v.managedGateFor === null;
}

/**
 * The state as a list cell words it: the whole text when short, else its
 * leading clause, else the observed state. The details spell out the rest.
 */
function briefState(v: AgentView): string {
  const full = sanitizeDisplay(stateText(v));
  if (visibleWidth(full) <= STATE_TEXT_MAX) return full;
  const clause = full.split(/[:;]/, 1)[0]!.trim();
  return clause !== "" && visibleWidth(clause) <= STATE_TEXT_MAX ? clause : v.observed;
}

/** The one STATE cell: the outcome of a settled agent, else a glyph and the state in the phase's colour. */
function stateCell(theme: UiTheme, v: AgentView): string {
  if (showsOutcome(v)) return outcomeLabel(theme, v.taskOutcome!);
  const phase = phaseOf(v);
  return theme.fg(PHASE_TONE[phase], `${PHASE_GLYPH[phase]} ${briefState(v)}`);
}

/** `8.8k in · 5 out`; null while the agent has reported no tokens. */
function tokensText(v: AgentView): string | null {
  const { inputTokens, outputTokens } = v.usage;
  return inputTokens === 0 && outputTokens === 0 ? null : `${formatCompact(inputTokens)} in · ${formatCompact(outputTokens)} out`;
}

/** Secondary text is muted; a missing value is dim except on the selection (dim lacks contrast on selectedBg). */
function tokensCell(theme: UiTheme, v: AgentView, selected: boolean): string {
  const tokens = tokensText(v);
  return tokens === null ? theme.fg(selected ? "muted" : "dim", NO_VALUE) : theme.fg("muted", tokens);
}

function modelLabel(theme: UiTheme, v: AgentView): string {
  const model = `${sanitizeDisplay(v.model)}:`;
  const level = v.thinkingLevel;
  return level === "unresolved"
    ? theme.fg("muted", `${model}${level}`)
    : theme.fg("muted", model) + theme.fg(thinkingColor(level), level);
}

/** `text` cut to `width` columns by replacing its middle with `…`; head and tail stay. */
function shortenMiddle(text: string, width: number): string {
  const total = visibleWidth(text);
  if (total <= width) return text;
  if (width <= 0) return "";
  const kept = width - visibleWidth(ELLIPSIS);
  const tail = Math.floor(kept / 2);
  return `${sliceByColumn(text, 0, kept - tail, true)}${ELLIPSIS}${sliceByColumn(text, total - tail, tail, true)}`;
}

type ColumnId = "agent" | "kind" | "state" | "model" | "tokens";

/** A list column: its header and how it renders an agent into `width` columns. */
interface ColumnSpec {
  id: ColumnId;
  header: string;
  cell(theme: UiTheme, v: AgentView, width: number, selected: boolean): string;
}

function indentOf(v: AgentView): number {
  return Math.min(MAX_INDENT, v.depth - 1) * INDENT_STEP;
}

/** The path under its nesting indent; a column too narrow for both gives up the indent, then the path's middle. */
function agentCell(v: AgentView, width: number): string {
  const path = sanitizeDisplay(v.path);
  const indent = Math.min(indentOf(v), Math.max(0, width - visibleWidth(path)));
  return `${" ".repeat(indent)}${shortenMiddle(path, width)}`;
}

/** Rows keep their state colour when selected; secondary text is muted on every row. */
const COLUMNS: readonly ColumnSpec[] = [
  { id: "agent", header: "AGENT", cell: (_theme, v, width) => agentCell(v, width) },
  { id: "kind", header: "KIND", cell: (theme, v) => theme.fg("muted", kindText(v)) },
  { id: "state", header: "STATE", cell: (theme, v) => stateCell(theme, v) },
  { id: "model", header: "MODEL", cell: modelLabel },
  { id: "tokens", header: "TOKENS", cell: (theme, v, _width, selected) => tokensCell(theme, v, selected) },
];
/** Secondary columns in the order narrowing drops them; AGENT and STATE always stay. */
const DROP_ORDER: readonly ColumnId[] = ["tokens", "model", "kind"];

interface ListColumn extends Column {
  spec: ColumnSpec;
}

interface ListLayout {
  columns: ListColumn[];
  /** Columns dropped at this width, in display order. */
  hidden: ListColumn[];
}

function rowWidth(columns: readonly Column[]): number {
  return MARKER_WIDTH + columns.reduce((sum, column) => sum + column.width, 0) + COLUMN_GAP * Math.max(0, columns.length - 1);
}

/**
 * Admit whole secondary columns against a readable AGENT width. Drop
 * TOKENS, then MODEL, then KIND only when they cannot fit alongside it.
 * AGENT then takes the remaining room, up to its widest path.
 */
function listLayout(theme: UiTheme, views: AgentView[], width: number): ListLayout {
  const widest = (spec: ColumnSpec): number => Math.max(visibleWidth(spec.header), ...views.map((v) => visibleWidth(spec.cell(theme, v, Number.MAX_SAFE_INTEGER, false))));
  const all = COLUMNS.map((spec): ListColumn => ({ spec, header: spec.header, width: spec.id === "agent" ? Math.min(PATH_WIDTH.preferred, Math.max(PATH_WIDTH.min, widest(spec))) : widest(spec), align: "left" }));
  let columns = all;
  for (const id of DROP_ORDER) {
    if (rowWidth(columns) <= width) break;
    columns = columns.filter((column) => column.spec.id !== id);
  }
  const spare = width - rowWidth(columns);
  columns = columns.map((column) => (column.spec.id === "agent" ? { ...column, width: Math.max(PATH_WIDTH.min, Math.min(widest(column.spec), column.width + spare)) } : column));
  return { columns, hidden: all.filter((column) => !columns.some((shown) => shown.spec.id === column.spec.id)) };
}

/** One line of the detail area: a key and its wrapped value. */
interface DetailField {
  key: string;
  keyTone: UiFg;
  /** Sanitized plain text; newlines separate paragraphs. */
  text: string;
  /** Colour of the value; null leaves the terminal's text colour. */
  tone: UiFg | null;
  /** Wrapped lines shown before the rest is counted; null shows all. */
  maxLines: number | null;
}

/** A field in the plain style: muted key, uncoloured value, shown whole. */
function detail(key: string, text: string): DetailField {
  return { key, keyTone: "muted", text, tone: null, maxLines: null };
}

/** Display text for a wrapped value: no terminal sequences, tabs as spaces, no carriage returns. */
function valueText(text: string): string {
  return sanitizeDisplay(text).replace(/\t/g, "  ").replace(/\r/g, "");
}

/**
 * The agent tree: canonical path (nested agents indented), kind, state,
 * model, and tokens per row, with the selected agent's details below.
 */
export class AgentInspector extends PanelLayout {
  private views: AgentView[];
  private allViews: AgentView[];
  private showClosed = false;
  private selected = 0;
  private scrollTop = 0;
  private statusLine = "";
  private deps: InspectorDeps;

  constructor(initial: AgentView[], deps: InspectorDeps) {
    super((width) => this.renderParts(width));
    this.deps = deps;
    this.allViews = initial;
    this.views = initial.filter((v) => v.desiredLifecycle !== "closed");
  }

  notice(text: string): void {
    this.statusLine = sanitizeDisplay(text, 200);
  }

  refreshViews(views: AgentView[]): void {
    const current = this.views[this.selected]?.id;
    this.allViews = views;
    this.views = this.showClosed ? views : views.filter((v) => v.desiredLifecycle !== "closed");
    const kept = current ? this.views.findIndex((v) => v.id === current) : -1;
    this.selected = kept >= 0 ? kept : Math.min(this.selected, Math.max(0, this.views.length - 1));
    if (this.views.length === 0) this.scrollTop = 0;
  }

  selectedId(): string | null {
    return this.views[this.selected]?.id ?? null;
  }

  /** Wheel moves the selection; a click selects a row, a double click opens its transcript. */
  handleMouse(event: TuiMouseEvent): ReturnType<VStack["handleMouse"]> {
    if (event.type === "wheel" && event.wheelDelta) {
      this.selected = Math.min(Math.max(0, this.selected + Math.sign(event.wheelDelta)), Math.max(0, this.views.length - 1));
      return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
    }
    if (event.type !== "click") return undefined;
    const index = this.scrollTop + event.y - LIST_TOP;
    if (event.y < LIST_TOP || index >= this.views.length || index >= this.scrollTop + this.listHeight()) return undefined;
    this.selected = index;
    if ((event.clickCount ?? 1) >= 2) this.deps.onAction({ kind: "transcript", agentId: this.views[index]!.id });
    return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }

  invalidate(): void { super.invalidate(); }

  private listHeight(): number {
    return Math.max(1, this.height(this.deps.rows()) - INSPECTOR_CHROME);
  }

  private renderParts(width: number): PanelParts {
    const t = this.deps.theme;
    const w = Math.max(40, width);
    const lines: string[] = [];
    const height = this.listHeight();
    if (!this.isMeasuring) this.clampScroll(height);
    const shownEnd = Math.min(this.views.length, this.scrollTop + height);
    const total = formatCount(this.views.length);
    // An overflowing list names the rows it shows in place of the bare total.
    lines.push(this.titleLine(w, this.views.length > height ? `${this.scrollTop + 1}–${shownEnd} of ${total}` : total));
    const layout = listLayout(t, this.views, w);
    const gutter = " ".repeat(MARKER_WIDTH);
    if (this.views.length === 0) {
      // Agents exist but none is listed only while the closed ones are hidden.
      const empty = this.allViews.length > 0 ? "No active subagents. f shows the closed ones." : "No subagents yet. The model starts them with spawn_agent.";
      lines.push(...wrapTextWithAnsi(empty, w - MARKER_WIDTH).map((l) => t.fg("muted", `${gutter}${l}`)));
    } else {
      lines.push(fit(columnHeader(t, layout.columns, COLUMN_GAP), w));
      for (let i = this.scrollTop; i < shownEnd; i++) lines.push(this.rowLine(this.views[i]!, i === this.selected, layout.columns, w));
      if (layout.hidden.length > 0) {
        const hidden = `hidden at this width: ${layout.hidden.map((column) => column.header).join(", ")}`;
        lines.push(...wrapTextWithAnsi(hidden, w - MARKER_WIDTH).map((l) => t.fg("dim", `${gutter}${l}`)));
      }
    }
    const current = this.views[this.selected];
    // Fixed chrome stays outside the allocated scrolling body.
    const footer = [fit(this.statusLine ? t.fg("warning", this.statusLine) : "", w), frameRule(t, w), ...keyHints(t, w, this.hints(current)).lines];
    const rows = this.height(this.deps.rows());
    const bodyEnd = Math.max(1, rows - footer.length);
    if (current) {
      lines.push(frameRule(t, w));
      lines.push(...this.detailLines(current, layout, w, bodyEnd - lines.length));
    }
    while (lines.length + footer.length < rows) lines.push("");
    return { header: lines.slice(0, 1), body: lines.slice(1, bodyEnd), footer };
  }

  /**
   * `Subagents · N` and, on the right, the non-zero counts by phase, each in
   * its phase's colour: `2 running · 1 asking · 3 settled`. The name and the
   * total outrank the counts: frameTitle truncates the left side first, so at
   * a width too narrow for all of them the last counts are left off instead.
   */
  private titleLine(width: number, meta: string): string {
    const counts = phaseCounts(this.views, PHASES);
    const title = (theme: UiTheme, shown: number): string => {
      const right = counts.slice(0, shown).map(({ phase, count }) => theme.fg(PHASE_TONE[phase], `${formatCount(count)} ${phase}`)).join(theme.fg("dim", " · "));
      return frameTitle(theme, width, shown > 0 ? { title: TITLE, meta, right } : { title: TITLE, meta }, "none").line;
    };
    let shown = counts.length;
    // Measured on the unstyled line: the left side is whole while it still ends with the total.
    while (shown > 0 && !title(PLAIN_THEME, shown).includes(`${TITLE} · ${meta} `)) shown--;
    return title(this.deps.theme, shown);
  }

  /**
   * Only the keys that act on the selected agent in its state. The keys left
   * out stay bound; so does `r` (refresh), which the caller's poll makes redundant.
   */
  private hints(current: AgentView | undefined): KeyHint[] {
    const toggle: KeyHint = { key: "f", action: this.showClosed ? "hide closed" : "show closed" };
    if (!current) return this.allViews.length > 0 ? [toggle, HINT.close] : [HINT.close];
    const open = current.desiredLifecycle !== "closed";
    const hints: KeyHint[] = [HINT.select, { key: KEY.enter, action: "transcript" }];
    if (current.openQuestion !== null) hints.push({ key: "a", action: "answer" });
    if (open && phaseOf(current) !== "settled") hints.push({ key: "i", action: "interrupt" });
    if (acceptsMessages(current)) hints.push({ key: "t", action: "new task" }, { key: "m", action: "note" });
    if (current.managedGateFor !== null || current.gateTaskRunId !== null) hints.push({ key: "g", action: "gate" });
    if (open) hints.push({ key: "c", action: "close agent" });
    hints.push(toggle, HINT.close);
    return hints;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.deps.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selected = Math.min(Math.max(0, this.views.length - 1), this.selected + 1);
      return;
    }
    if (data === "f") {
      this.showClosed = !this.showClosed;
      this.refreshViews(this.allViews);
      return;
    }
    if (data === "r") {
      this.refreshViews(this.deps.refresh());
      return;
    }
    const current = this.views[this.selected];
    if (!current) return;
    if (matchesKey(data, Key.enter)) this.deps.onAction({ kind: "transcript", agentId: current.id });
    else if (data === "m") this.deps.onAction({ kind: "message", agentId: current.id });
    else if (data === "t") this.deps.onAction({ kind: "task", agentId: current.id });
    else if (data === "i") this.deps.onAction({ kind: "interrupt", agentId: current.id });
    else if (data === "c") this.deps.onAction({ kind: "close", agentId: current.id });
    else if (data === "a") this.deps.onAction({ kind: "answer", agentId: current.id });
    else if (data === "g") this.deps.onAction({ kind: "retry_review", agentId: current.id });
  }

  private clampScroll(height: number): void {
    if (this.selected < this.scrollTop) this.scrollTop = this.selected;
    if (this.selected >= this.scrollTop + height) this.scrollTop = this.selected - height + 1;
  }

  private rowLine(v: AgentView, selected: boolean, columns: ListColumn[], width: number): string {
    const t = this.deps.theme;
    const cells = columns.map((column) => column.spec.cell(t, v, column.width, selected));
    return listRow(t, width, columnCells(columns, cells, COLUMN_GAP), selected);
  }

  /**
   * What the selected row does not show: identity and place first, then
   * whatever its cells abbreviate, replace, or lost to a dropped column,
   * then the question and the result.
   */
  private detailFields(v: AgentView, layout: ListLayout): DetailField[] {
    const details = this.deps.describe(v.id);
    const fields: DetailField[] = [];
    const hidden = (id: ColumnId): boolean => layout.hidden.some((column) => column.spec.id === id);
    const path = sanitizeDisplay(v.path);
    if (visibleWidth(path) > layout.columns.find((column) => column.spec.id === "agent")!.width) fields.push(detail("path", path));
    fields.push(detail("id", `${v.id} · generation ${v.generation}`));
    fields.push(detail("workdir", homeRelative(sanitizeDisplay(v.workdir), this.deps.home)));
    const phase = phaseOf(v);
    const state = sanitizeDisplay(stateText(v));
    // The cell holds the state unless it abbreviates it or shows the outcome instead; a bare "settled" adds nothing to an outcome.
    if (showsOutcome(v) ? state !== SETTLED : state !== briefState(v)) fields.push({ ...detail("state", state), tone: phase === "settled" ? null : PHASE_TONE[phase] });
    if (v.taskOutcome && !showsOutcome(v)) fields.push({ ...detail("outcome", `${OUTCOME_GLYPH[outcomeTone(v.taskOutcome)]} ${sanitizeDisplay(v.taskOutcome)}`), tone: outcomeTone(v.taskOutcome) });
    if (hidden("kind")) fields.push(detail("kind", kindText(v)));
    if (hidden("model")) fields.push(detail("model", modelLabel(this.deps.theme, v)));
    const tokens = tokensText(v);
    if (hidden("tokens") && tokens !== null) fields.push(detail("tokens", tokens));
    if (v.usage.cost !== null) fields.push(detail("cost", `$${v.usage.cost.toFixed(4)}`));
    else if (v.usage.unknown) fields.push(detail("cost", "unknown"));
    if (v.managedGateFor) fields.push(detail("gate", `reviews task ${v.managedGateFor}`));
    if (v.gateTaskRunId) fields.push(detail("gate", `task ${v.gateTaskRunId}`));
    if (details.question) fields.push({ ...detail("question", valueText(details.question)), keyTone: "warning" });
    if (details.result) fields.push({ ...detail("result", valueText(details.result)), maxLines: DETAIL_RESULT_LINES });
    return fields;
  }

  /** Aligned key/value lines; values wrap to the width instead of being cut. */
  private detailLines(v: AgentView, layout: ListLayout, width: number, rowBudget: number): string[] {
    const t = this.deps.theme;
    const fields = this.detailFields(v, layout);
    const keyWidth = Math.max(...fields.map((field) => visibleWidth(field.key)));
    const valueWidth = Math.max(1, width - MARKER_WIDTH - keyWidth - DETAIL_GAP);
    const gutter = " ".repeat(MARKER_WIDTH);
    const continuation = " ".repeat(MARKER_WIDTH + keyWidth + DETAIL_GAP);
    const wrap = (text: string): string[] => text.split("\n").flatMap((l) => (l === "" ? [""] : wrapTextWithAnsi(l, valueWidth)));
    const lines: string[] = [];
    for (const field of fields) {
      const full = wrap(field.text);
      const remaining = rowBudget - lines.length;
      const wrapped = field.key === "model" && remaining > 0 && full.length > remaining ? [shortenMiddle(field.text, valueWidth)] : full;
      const shown = field.maxLines !== null && wrapped.length > field.maxLines ? wrapped.slice(0, field.maxLines) : wrapped;
      const more = wrapped.length - shown.length;
      const values = [...shown.map((l) => (field.tone ? t.fg(field.tone, l) : l)), ...(more > 0 ? wrap(`… ${more} more lines (⏎ transcript)`).map((l) => t.fg("muted", l)) : [])];
      values.forEach((value, i) => {
        const lead = i === 0 ? `${gutter}${t.fg(field.keyTone, field.key.padEnd(keyWidth))}${" ".repeat(DETAIL_GAP)}` : continuation;
        lines.push(`${lead}${value}`.trimEnd());
      });
    }
    return lines;
  }
}

/** How the transcript's chat line delivers a message to the agent. */
export type ChatMode =
  | { kind: "answer"; replyTo: string }
  | { kind: "steer" }
  | { kind: "task" }
  | { kind: "unavailable"; reason: string };

/**
 * An open question gets the answer; a running generation is steered;
 * otherwise the message starts a new task run.
 */
export function chatModeFor(view: AgentView, question: { messageId: string } | null): ChatMode {
  if (view.pendingIntent === "closed") return { kind: "unavailable", reason: "the agent is closed" };
  if (view.managedGateFor) return { kind: "unavailable", reason: "gate reviewers are driven by the gate controller" };
  if (question) return { kind: "answer", replyTo: question.messageId };
  if (view.observed === "running" || view.observed === "starting" || view.observed === "awaiting_parent") return { kind: "steer" };
  return { kind: "task" };
}

function chatHint(mode: ChatMode): KeyHint {
  switch (mode.kind) {
    case "answer":
      return { key: KEY.enter, action: "answer its question" };
    case "steer":
      return { key: KEY.enter, action: "steer the running task" };
    case "task":
      return { key: KEY.enter, action: "send task" };
    case "unavailable":
      return { key: KEY.enter, action: `unavailable: ${mode.reason}` };
  }
}

/** Reads session files: a cheap version (size and mtime) and the text. */
export interface SessionReader {
  version(path: string): string | null;
  read(path: string): string;
}

export const fileSessionReader: SessionReader = {
  version(path) {
    try {
      const st = statSync(path);
      return `${st.size}:${st.mtimeMs}`;
    } catch {
      return null;
    }
  },
  read(path) {
    return readFileSync(path, "utf8");
  },
};

export interface TranscriptDeps {
  view(): AgentView | null;
  source(): TranscriptSource;
  question(): { messageId: string; text: string } | null;
  /** Delivers a chat message; resolves to a notice for the user. */
  send(text: string, mode: ChatMode): Promise<string>;
  back(): void;
  requestRender(): void;
  rows(): number;
  reader: SessionReader;
  style: UiStyle;
  theme: UiTheme;
}

/** What the screen hosting a transcript knows and the transcript's own data source does not. */
export interface TranscriptHost {
  /** Home directory, for showing paths as `~/…`. */
  home: string;
  /** Rows of the pane the transcript opens in, until its own first layout. */
  paneRows(): number;
}

const TRANSCRIPT_HINTS: readonly KeyHint[] = [HINT.scroll, HINT.page, HINT.back];
/** Body of a live agent's transcript whose session file is named but not written yet. */
const TRANSCRIPT_LOADING = "loading transcript…";

/** Lines the transcript view needs besides its viewport and hints: title, workdir, rules, notice, input. */
const TRANSCRIPT_CHROME = 6;

/**
 * One agent's conversation, read from its native session, live while it
 * runs, with a chat line that messages the agent.
 */
export class TranscriptView extends PanelLayout implements Component, Focusable {
  private deps: TranscriptDeps;
  private host: TranscriptHost;
  private input: Input;
  private items: TranscriptItem[] = [];
  private version: string | null = null;
  /** Parsed gate evaluations by session file. */
  private reviewItems = new Map<string, { version: string; items: TranscriptItem[] }>();
  private source: TranscriptSource;
  private snapshot: AgentView | null;
  private scrollFromBottom = 0;
  /** Streamed text kept until the session file shows the completed message (no flicker between them). */
  private lastStream: { text: string; version: string | null } | null = null;
  private notice = "";
  /** Hint lines at the last render (they wrap on narrow terminals). */
  private hintLines = 1;
  private sending = false;
  private _focused = false;

  constructor(deps: TranscriptDeps, host: TranscriptHost) {
    super((width) => this.renderParts(width));
    this.deps = deps;
    this.host = host;
    this.input = new Input({ prompt: "› " });
    this.input.onSubmit = (value) => this.submit(value);
    this.source = deps.source();
    this.snapshot = deps.view();
    this.reload();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  invalidate(): void {
    this.input.invalidate();
    super.invalidate();
  }

  /** Re-read state and session; true when anything visible changed. */
  refresh(): boolean {
    const before = this.stateKey();
    this.source = this.deps.source();
    this.snapshot = this.deps.view();
    this.reload();
    if (this.source.streaming) this.lastStream = { text: this.source.streaming, version: this.version };
    else if (this.lastStream && this.lastStream.version !== this.version) this.lastStream = null;
    return this.stateKey() !== before;
  }

  private stateKey(): string {
    return JSON.stringify([this.snapshot, this.source.streaming, this.source.sessionFile, this.version, this.source.reviews, [...this.reviewItems.values()].map((r) => r.version)]);
  }

  private reload(): void {
    for (const review of this.source.reviews) {
      const version = this.deps.reader.version(review.sessionFile);
      if (version !== null && version !== this.reviewItems.get(review.sessionFile)?.version) {
        this.reviewItems.set(review.sessionFile, { version, items: parseTranscript(this.deps.reader.read(review.sessionFile)) });
      }
    }
    const file = this.source.sessionFile;
    if (!file) {
      this.items = [];
      this.version = null;
      return;
    }
    const version = this.deps.reader.version(file);
    if (version === null || version === this.version) return;
    this.items = parseTranscript(this.deps.reader.read(file));
    this.version = version;
  }

  handleMouse(event: TuiMouseEvent): ReturnType<VStack["handleMouse"]> {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollFromBottom = Math.max(0, this.scrollFromBottom - event.wheelDelta);
    return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }

  handleInput(data: string): void {
    const page = Math.max(1, this.viewportHeight() - 1);
    if (matchesKey(data, Key.escape)) this.deps.back();
    else if (matchesKey(data, Key.up)) this.scrollFromBottom += 1;
    else if (matchesKey(data, Key.down)) this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 1);
    else if (matchesKey(data, Key.pageUp)) this.scrollFromBottom += page;
    else if (matchesKey(data, Key.pageDown)) this.scrollFromBottom = Math.max(0, this.scrollFromBottom - page);
    else this.input.handleInput(data);
    this.deps.requestRender();
  }

  private submit(value: string): void {
    const text = value.trim();
    const view = this.snapshot;
    if (!text || !view || this.sending) return;
    const mode = chatModeFor(view, this.deps.question());
    if (mode.kind === "unavailable") {
      this.notice = `not sent: ${mode.reason}`;
      this.deps.requestRender();
      return;
    }
    this.sending = true;
    this.notice = "sending…";
    this.deps.send(text, mode).then(
      (notice) => {
        this.notice = notice;
        this.input.setValue("");
        this.scrollFromBottom = 0;
      },
      (e: Error) => {
        this.notice = `not sent: ${e.message}`;
      },
    ).finally(() => {
      this.sending = false;
      this.refresh();
      this.deps.requestRender();
    });
    this.deps.requestRender();
  }

  /**
   * Rows the body is sized from while the layout has not allocated them. The
   * terminal's rows are the natural height once laid out (the pane may grow
   * back to them). Before the first layout they over-estimate the pane: a
   * body that tall is cut at the pane's bottom, and with it a short
   * conversation, which is anchored there. The host knows the pane's height.
   */
  private fallbackRows(): number {
    return this.hasAllocatedHeight ? this.deps.rows() : this.host.paneRows();
  }

  private viewportHeight(): number {
    return Math.max(1, this.bodyHeight(this.fallbackRows() - TRANSCRIPT_CHROME - this.hintLines));
  }

  private bodyLines(width: number): string[] {
    const s = this.deps.style;
    const view = this.snapshot;
    const reviews: ReviewBlock[] = this.source.reviews.map((r) => ({
      label: `gate ${r.reviewId} · ${r.candidateId} · ${r.model}`,
      at: r.at,
      items: this.reviewItems.get(r.sessionFile)?.items ?? [],
      active: r.active,
      streaming: r.streaming,
    }));
    if (!this.source.sessionFile && reviews.length === 0) {
      return [s.muted(view?.managedGateFor ? "No reviews yet." : "No conversation yet: the agent has not started.")];
    }
    const lines = renderConversation(this.items, reviews, width, s, this.source.messages);
    const streaming = this.source.streaming ?? this.lastStream?.text ?? null;
    if (!this.source.sessionFile) {
      // A reviewer: its live state is shown inside the review being executed.
    } else if (streaming) {
      lines.push("", ...sanitizeDisplay(streaming).split("\n").flatMap((l) => (l === "" ? [""] : wrapTextWithAnsi(l, width))));
      lines[lines.length - 1] = `${lines[lines.length - 1]}${s.accent("▍")}`;
    } else if (view && this.version === null && phaseOf(view) !== "settled") {
      // A worker names its session file before its first write: the conversation is still to come.
      lines.push(s.muted(TRANSCRIPT_LOADING));
    } else if (view && (view.observed === "running" || view.observed === "starting")) {
      lines.push(s.accent(`… ${sanitizeDisplay(view.pendingIntent)}`));
    }
    return lines.length > 0 ? lines : [s.muted("(empty conversation)")];
  }

  private renderParts(width: number): PanelParts {
    const s = this.deps.style;
    const t = this.deps.theme;
    const w = Math.max(40, width);
    const view = this.snapshot;
    const question = this.deps.question();
    const mode = view ? chatModeFor(view, question) : ({ kind: "unavailable", reason: "agent no longer exists" } as ChatMode);
    const hints = keyHints(t, w, [chatHint(mode), ...TRANSCRIPT_HINTS]).lines;
    if (!this.isMeasuring) this.hintLines = hints.length;
    const out: string[] = [];
    if (view) {
      const outcome = view.taskOutcome ? ` · ${outcomeLabel(t, view.taskOutcome)}` : "";
      out.push(frameTitle(t, w, { title: sanitizeDisplay(view.path), meta: `${kindText(view)} · ${sanitizeDisplay(view.model)}`, right: `${stateLabel(t, view)}${outcome}` }, "none").line);
      out.push(fit(`${t.fg("muted", "workdir")} ${homeRelative(sanitizeDisplay(view.workdir), this.host.home)}`, w));
    } else {
      out.push(frameTitle(t, w, { title: "Subagent", right: t.fg("error", "agent no longer exists") }, "none").line, "");
    }
    const body = this.bodyLines(w).map((l) => fit(l, w));
    const height = Math.max(1, this.bodyHeight(this.fallbackRows() - TRANSCRIPT_CHROME - hints.length));
    const maxScroll = Math.max(0, body.length - height);
    const scrollFromBottom = Math.min(this.scrollFromBottom, maxScroll);
    if (!this.isMeasuring) this.scrollFromBottom = scrollFromBottom;
    const end = body.length - scrollFromBottom;
    const visible = body.slice(Math.max(0, end - height), end);
    out.push(frameRule(t, w));
    const header = [...out];
    out.length = 0;
    for (let i = visible.length; i < height; i++) out.push("");
    out.push(...visible);
    const viewportBody = [...out];
    out.length = 0;
    out.push(this.scrollFromBottom > 0 ? fit(`${t.fg("border", "── ")}${t.fg("muted", `${this.scrollFromBottom} more below (↓/PgDn)`)}${t.fg("border", ` ${"─".repeat(w)}`)}`, w) : frameRule(t, w));
    out.push(fit(this.notice ? s.warning(this.notice) : question ? s.warning(`? ${sanitizeDisplay(question.text, 500).replace(/\s+/g, " ")}`) : "", w));
    out.push(...this.input.render(w));
    out.push(...hints);
    return { header, body: viewportBody, footer: out };
  }
}

export interface AgentsScreenDeps {
  list(): AgentView[];
  describe(agentId: string): AgentDetails;
  transcript(agentId: string, back: () => void): TranscriptDeps;
  /** Every action except opening a transcript. */
  onAction(action: InspectorAction): void;
  onClose(): void;
  requestRender(): void;
  rows(): number;
  theme: UiTheme;
}

/** The /agents screen: the agent list, or one agent's transcript. */
export class AgentsScreen extends VStack implements Component, Focusable {
  private deps: AgentsScreenDeps;
  readonly inspector: AgentInspector;
  private transcriptView: TranscriptView | null = null;
  private _focused = false;
  /** Read once where the views are composed; they take it as a dependency. */
  private readonly home = homedir();

  constructor(deps: AgentsScreenDeps) {
    super();
    this.deps = deps;
    this.inspector = new AgentInspector(deps.list(), {
      refresh: deps.list,
      describe: deps.describe,
      rows: deps.rows,
      theme: deps.theme,
      home: this.home,
      onClose: deps.onClose,
      onAction: (action) => (action.kind === "transcript" ? this.openTranscript(action.agentId) : deps.onAction(action)),
    });
    this.addChild(this.inspector, { grow: 1, minSize: 0 });
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.transcriptView) this.transcriptView.focused = value;
  }

  get transcript(): TranscriptView | null {
    return this.transcriptView;
  }

  openTranscript(agentId: string): void {
    // The transcript takes the list's place: the height the list was laid out with is the pane's.
    this.transcriptView = new TranscriptView(this.deps.transcript(agentId, () => this.closeTranscript()), { home: this.home, paneRows: () => this.inspector.height(this.deps.rows()) });
    this.transcriptView.focused = this._focused;
    this.clear();
    this.addChild(this.transcriptView, { grow: 1, minSize: 0 });
  }

  private closeTranscript(): void {
    if (this.transcriptView) this.transcriptView.focused = false;
    this.transcriptView = null;
    this.clear();
    this.addChild(this.inspector, { grow: 1, minSize: 0 });
    this.inspector.refreshViews(this.deps.list());
  }

  /** Poll: refresh the list and an open transcript. */
  refresh(): void {
    this.inspector.refreshViews(this.deps.list());
    this.transcriptView?.refresh();
  }

  invalidate(): void {
    this.transcriptView?.invalidate();
  }

  render(width: number): string[] {
    return this.transcriptView ? this.transcriptView.render(width) : this.inspector.render(width);
  }

  handleMouse(event: TuiMouseEvent): ReturnType<VStack["handleMouse"]> {
    return this.transcriptView ? this.transcriptView.handleMouse(event) : this.inspector.handleMouse(event);
  }

  handleInput(data: string): void {
    if (this.transcriptView) this.transcriptView.handleInput(data);
    else this.inspector.handleInput(data);
    this.deps.requestRender();
  }
}

export { PLAIN_STYLE };
