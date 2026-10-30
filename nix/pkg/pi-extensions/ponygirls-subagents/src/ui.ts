/**
 * ponygirls-subagents — governing-session observation and the /agents screen.
 *
 * One event model, several views: list_agents, read_agent, wait_agent, the
 * footer status, and the /agents screen project the same journal-backed
 * state. The screen lists the tree with the selected agent's details and
 * opens any agent's transcript, whose chat line messages that agent.
 * Actions use the same supervisor API as tools and record human origin.
 *
 * Child content is untrusted display input: ANSI/OSC sequences are
 * sanitized before rendering. Headless output contains no terminal escapes.
 * Escape leaves a view; it never terminates children.
 */

import { readFileSync, statSync } from "node:fs";
import { Input, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { columnCells, columnHeader, compactChip, frameRule, frameTitle, keyHints, listRow, type Column, type KeyHint, type UiFg, type UiState, type UiTheme } from "@ponygirls/pi-ui";
import { AGENT_GLYPH, OUTCOME_GLYPH, PLAIN_STYLE, outcomeTone, sanitizeDisplay, type UiStyle } from "./display.ts";
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

/** Compact badge text: the total, plus whatever is running, queued, or waiting on a reply. */
export function widgetLine(views: AgentView[]): string {
  const c = countTree(views);
  const parts = [`agents ${views.length}`];
  if (c.running > 0) parts.push(`running ${c.running}`);
  if (c.queued > 0) parts.push(`queued ${c.queued}`);
  if (c.questions > 0) parts.push(`questions ${c.questions}`);
  return parts.join(" · ");
}

/** Border short form state: a question needs the user, live work runs, otherwise settled. */
export function badgeState(views: AgentView[]): UiState {
  if (views.some((v) => v.openQuestion !== null)) return "attention";
  const c = countTree(views);
  return c.running + c.queued > 0 ? "running" : "settled";
}

/** Border short form: the agent glyph in the tree's state colour and the total. */
export function compactBadge(theme: UiTheme, views: AgentView[]): string {
  return compactChip(theme, AGENT_GLYPH, badgeState(views), String(views.length));
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

function shortTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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
}

const DETAIL_RESULT_LINES = 6;
/** Lines the inspector needs besides the list: title, column header, rules, detail panel, status, hints. */
const INSPECTOR_CHROME = 20;
/** First list row in the inspector's rendered lines (after the title and the column header). */
const LIST_TOP = 2;
const COLUMN_GAP = 2;
const PATH_WIDTH = { min: 8, max: 40 };
const KIND_WIDTH_MAX = 18;
const STATE_WIDTH_MAX = 26;
const OUTCOME_WIDTH_MAX = 24;
const MAX_INDENT = 4;
const NO_OUTCOME = "—";

const INSPECTOR_HINTS: readonly KeyHint[] = [
  { key: "↑↓", action: "select" },
  { key: "⏎", action: "transcript" },
  { key: "m", action: "note" },
  { key: "t", action: "task" },
  { key: "i", action: "interrupt" },
  { key: "c", action: "close" },
  { key: "a", action: "answer" },
  { key: "g", action: "gate" },
  { key: "r", action: "refresh" },
  { key: "esc", action: "close" },
];

function indentedPath(v: AgentView): string {
  return `${"  ".repeat(Math.min(MAX_INDENT, v.depth - 1))}${sanitizeDisplay(v.path)}`;
}

function columnWidth(header: string, cells: string[], max: number): number {
  return Math.min(max, Math.max(header.length, ...cells.map((c) => visibleWidth(c))));
}

/** Aligned columns sized to the current rows; the model takes what is left. */
function inspectorColumns(views: AgentView[]): Column[] {
  const outcomes = views.map((v) => (v.taskOutcome ? `${OUTCOME_GLYPH[outcomeTone(v.taskOutcome)]} ${sanitizeDisplay(v.taskOutcome)}` : NO_OUTCOME));
  return [
    { header: "AGENT", width: Math.max(PATH_WIDTH.min, columnWidth("AGENT", views.map(indentedPath), PATH_WIDTH.max)), align: "left" },
    { header: "KIND", width: columnWidth("KIND", views.map(kindText), KIND_WIDTH_MAX), align: "left" },
    { header: "STATE", width: columnWidth("STATE", views.map((v) => sanitizeDisplay(stateText(v))), STATE_WIDTH_MAX), align: "left" },
    { header: "OUTCOME", width: columnWidth("OUTCOME", outcomes, OUTCOME_WIDTH_MAX), align: "left" },
    { header: "MODEL", width: columnWidth("MODEL", views.map((v) => sanitizeDisplay(v.model)), Number.MAX_SAFE_INTEGER), align: "left" },
  ];
}

/**
 * The agent tree: canonical path (nested agents indented), kind, state,
 * outcome, and model per row, with the selected agent's details below.
 */
export class AgentInspector {
  private views: AgentView[];
  private selected = 0;
  private scrollTop = 0;
  private statusLine = "";
  private deps: InspectorDeps;

  constructor(initial: AgentView[], deps: InspectorDeps) {
    this.deps = deps;
    this.views = initial;
  }

  notice(text: string): void {
    this.statusLine = sanitizeDisplay(text, 200);
  }

  refreshViews(views: AgentView[]): void {
    const current = this.views[this.selected]?.id;
    this.views = views;
    const kept = current ? views.findIndex((v) => v.id === current) : -1;
    this.selected = kept >= 0 ? kept : Math.min(this.selected, Math.max(0, views.length - 1));
  }

  selectedId(): string | null {
    return this.views[this.selected]?.id ?? null;
  }

  /** Wheel moves the selection; a click selects a row, a double click opens its transcript. */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel" && event.wheelDelta) {
      this.selected = Math.min(Math.max(0, this.selected + Math.sign(event.wheelDelta)), Math.max(0, this.views.length - 1));
      return { handled: true };
    }
    if (event.type !== "click") return undefined;
    const index = this.scrollTop + event.y - LIST_TOP;
    if (event.y < LIST_TOP || index >= this.views.length || index >= this.scrollTop + this.listHeight()) return undefined;
    this.selected = index;
    if ((event.clickCount ?? 1) >= 2) this.deps.onAction({ kind: "transcript", agentId: this.views[index]!.id });
    return { handled: true };
  }

  private listHeight(): number {
    return Math.max(3, this.deps.rows() - INSPECTOR_CHROME);
  }

  render(width: number): string[] {
    const t = this.deps.theme;
    const w = Math.max(40, width);
    const lines: string[] = [];
    const height = this.listHeight();
    this.clampScroll(height);
    const shownEnd = Math.min(this.views.length, this.scrollTop + height);
    const position = this.views.length > height ? t.fg("dim", `${this.scrollTop + 1}–${shownEnd} of ${this.views.length}`) : undefined;
    lines.push(frameTitle(t, w, { title: "Subagents", meta: widgetLine(this.views), right: position }, "none").line);
    if (this.views.length === 0) lines.push(t.fg("muted", "  No subagents yet."));
    else {
      const columns = inspectorColumns(this.views);
      lines.push(fit(columnHeader(t, columns, COLUMN_GAP), w));
      for (let i = this.scrollTop; i < shownEnd; i++) lines.push(this.rowLine(this.views[i]!, i === this.selected, columns, w));
    }
    const current = this.views[this.selected];
    if (current) {
      lines.push(frameRule(t, w));
      lines.push(...this.detailLines(current, w));
    }
    // The screen covers the terminal: hints sit on its last lines.
    const footer = [fit(this.statusLine ? t.fg("warning", this.statusLine) : "", w), frameRule(t, w), ...keyHints(t, w, INSPECTOR_HINTS).lines];
    const rows = this.deps.rows();
    while (lines.length + footer.length < rows) lines.push("");
    return [...lines.slice(0, Math.max(0, rows - footer.length)), ...footer];
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
      this.selected = Math.min(this.views.length - 1, this.selected + 1);
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

  /** Selected rows keep state and outcome colours; secondary text is muted there (dim lacks contrast on selectedBg). */
  private rowLine(v: AgentView, selected: boolean, columns: Column[], width: number): string {
    const t = this.deps.theme;
    const cells = [
      indentedPath(v),
      t.fg("muted", kindText(v)),
      stateLabel(t, v),
      v.taskOutcome ? outcomeLabel(t, v.taskOutcome) : t.fg(selected ? "muted" : "dim", NO_OUTCOME),
      t.fg("muted", sanitizeDisplay(v.model)),
    ];
    return listRow(t, width, columnCells(columns, cells, COLUMN_GAP), selected);
  }

  private detailLines(v: AgentView, width: number): string[] {
    const t = this.deps.theme;
    const label = (text: string): string => t.fg("muted", text);
    const details = this.deps.describe(v.id);
    const cost = v.usage.cost !== null ? ` $${v.usage.cost.toFixed(4)}` : v.usage.unknown ? " cost unknown" : "";
    const outcome = v.taskOutcome ? outcomeLabel(t, v.taskOutcome) : t.fg("muted", "no outcome yet");
    const lines = [
      fit(`${t.bold(sanitizeDisplay(v.path))}  ${t.fg("dim", v.id)}`, width),
      fit(`${label("kind")} ${kindText(v)}  ${label("model")} ${sanitizeDisplay(v.model)}  ${label("state")} ${stateLabel(t, v)}  ${label("outcome")} ${outcome}  ${label("gen")} ${v.generation}  ${label("usage")} in ${shortTokens(v.usage.inputTokens)} out ${shortTokens(v.usage.outputTokens)}${cost}`, width),
      fit(`${label("workdir")} ${sanitizeDisplay(v.workdir)}`, width),
    ];
    if (v.managedGateFor) lines.push(fit(`${label("reviews gated task")} ${v.managedGateFor}`, width));
    if (v.gateTaskRunId) lines.push(fit(`${label("gated task")} ${v.gateTaskRunId}`, width));
    if (details.question) lines.push(fit(`${t.fg("warning", "question:")} ${sanitizeDisplay(details.question, 300)}`, width));
    if (details.result) {
      const wrapped = sanitizeDisplay(details.result).split("\n").flatMap((l) => (l === "" ? [""] : wrapTextWithAnsi(l, width - 2)));
      lines.push(label("result:"));
      for (const l of wrapped.slice(0, DETAIL_RESULT_LINES)) lines.push(fit(`  ${l}`, width));
      if (wrapped.length > DETAIL_RESULT_LINES) lines.push(fit(label(`  … ${wrapped.length - DETAIL_RESULT_LINES} more lines (⏎ transcript)`), width));
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
      return { key: "⏎", action: "answer its question" };
    case "steer":
      return { key: "⏎", action: "steer the running task" };
    case "task":
      return { key: "⏎", action: "send a new task" };
    case "unavailable":
      return { key: "⏎", action: `unavailable: ${mode.reason}` };
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

const TRANSCRIPT_HINTS: readonly KeyHint[] = [
  { key: "↑↓ PgUp PgDn", action: "scroll" },
  { key: "esc", action: "back to the list" },
];

/** Lines the transcript view needs besides its viewport and hints: title, workdir, rules, notice, input. */
const TRANSCRIPT_CHROME = 6;

/**
 * One agent's conversation, read from its native session, live while it
 * runs, with a chat line that messages the agent.
 */
export class TranscriptView implements Component, Focusable {
  private deps: TranscriptDeps;
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

  constructor(deps: TranscriptDeps) {
    this.deps = deps;
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

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollFromBottom = Math.max(0, this.scrollFromBottom - event.wheelDelta);
    return { handled: true };
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

  private viewportHeight(): number {
    return Math.max(5, this.deps.rows() - TRANSCRIPT_CHROME - this.hintLines);
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
    } else if (view && (view.observed === "running" || view.observed === "starting")) {
      lines.push(s.accent(`… ${sanitizeDisplay(view.pendingIntent)}`));
    }
    return lines.length > 0 ? lines : [s.muted("(empty conversation)")];
  }

  render(width: number): string[] {
    const s = this.deps.style;
    const t = this.deps.theme;
    const w = Math.max(40, width);
    const view = this.snapshot;
    const question = this.deps.question();
    const mode = view ? chatModeFor(view, question) : ({ kind: "unavailable", reason: "agent no longer exists" } as ChatMode);
    const hints = keyHints(t, w, [chatHint(mode), ...TRANSCRIPT_HINTS]).lines;
    this.hintLines = hints.length;
    const out: string[] = [];
    if (view) {
      const outcome = view.taskOutcome ? ` · ${outcomeLabel(t, view.taskOutcome)}` : "";
      out.push(frameTitle(t, w, { title: sanitizeDisplay(view.path), meta: `${kindText(view)} · ${sanitizeDisplay(view.model)}`, right: `${stateLabel(t, view)}${outcome}` }, "none").line);
      out.push(fit(`${t.fg("muted", "workdir")} ${sanitizeDisplay(view.workdir)}`, w));
    } else {
      out.push(frameTitle(t, w, { title: "Subagent", right: t.fg("error", "agent no longer exists") }, "none").line, "");
    }
    const body = this.bodyLines(w).map((l) => fit(l, w));
    const height = this.viewportHeight();
    const maxScroll = Math.max(0, body.length - height);
    this.scrollFromBottom = Math.min(this.scrollFromBottom, maxScroll);
    const end = body.length - this.scrollFromBottom;
    const visible = body.slice(Math.max(0, end - height), end);
    out.push(frameRule(t, w));
    for (let i = visible.length; i < height; i++) out.push("");
    out.push(...visible);
    out.push(this.scrollFromBottom > 0 ? fit(`${t.fg("border", "── ")}${t.fg("muted", `${this.scrollFromBottom} more below (↓/PgDn)`)}${t.fg("border", ` ${"─".repeat(w)}`)}`, w) : frameRule(t, w));
    out.push(fit(this.notice ? s.warning(this.notice) : question ? s.warning(`? ${sanitizeDisplay(question.text, 500).replace(/\s+/g, " ")}`) : "", w));
    out.push(...this.input.render(w));
    out.push(...hints);
    return out;
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
export class AgentsScreen implements Component, Focusable {
  private deps: AgentsScreenDeps;
  readonly inspector: AgentInspector;
  private transcriptView: TranscriptView | null = null;
  private _focused = false;

  constructor(deps: AgentsScreenDeps) {
    this.deps = deps;
    this.inspector = new AgentInspector(deps.list(), {
      refresh: deps.list,
      describe: deps.describe,
      rows: deps.rows,
      theme: deps.theme,
      onClose: deps.onClose,
      onAction: (action) => (action.kind === "transcript" ? this.openTranscript(action.agentId) : deps.onAction(action)),
    });
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
    this.transcriptView = new TranscriptView(this.deps.transcript(agentId, () => this.closeTranscript()));
    this.transcriptView.focused = this._focused;
  }

  private closeTranscript(): void {
    if (this.transcriptView) this.transcriptView.focused = false;
    this.transcriptView = null;
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

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.transcriptView ? this.transcriptView.handleMouse(event) : this.inspector.handleMouse(event);
  }

  handleInput(data: string): void {
    if (this.transcriptView) this.transcriptView.handleInput(data);
    else this.inspector.handleInput(data);
    this.deps.requestRender();
  }
}

export { PLAIN_STYLE };
