/**
 * Transcript rows of the goal tools. Collapsed, a call and its outcome share
 * one line (`get_goal → active · 0 tokens · 0s`); an error, and the expanded
 * form, show the full text as pi's generic tool rendering does. Only drawing:
 * the result content the model receives is not touched.
 */
import { type Component, Container, sliceByColumn, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatCompact, stateColor, type UiFg } from "@ponygirls/pi-ui";
import { GOAL_STATUSES, type GoalStatus } from "./goal.ts";
import { formatDuration, GOAL_STATUS_LOOK } from "./presentation.ts";
import type { MODEL_TOOL_NAMES } from "./tools.ts";

export type GoalToolName = (typeof MODEL_TOOL_NAMES)[number];

/** The part of pi's Theme the tool rows use. */
export interface ToolRowTheme {
  fg(color: UiFg | "toolTitle" | "toolOutput", text: string): string;
  bold(text: string): string;
}

/** The part of pi's tool render context the rows read. */
export interface ToolRowContext {
  args: unknown;
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
}

export interface ResultContent {
  type: string;
  text?: string;
}

/** What get_goal reported about a goal. */
export interface GoalReading {
  status: GoalStatus;
  tokensUsed: number;
  tokenBudget: number | null;
  timeUsedSeconds: number;
}

/** How both of get_goal's texts for a session without a goal start. */
const NO_GOAL_PREFIX = "No current goal";
/** `Goal <id>: status <status>. Objective: <objective>. Used <n>[ of <cap>] tokens in <seconds>s.` */
const GOAL_STATE_TEXT = /^Goal \S+: status (\w+)\. Objective: [\s\S]*\. Used (\d+)(?: of (\d+))? tokens in (\d+(?:\.\d+)?)s\.$/;

/**
 * Reads get_goal's model-facing text back, since a result renderer receives
 * nothing else: the goal's facts, "none" without a goal, or null for text
 * this version does not produce.
 */
export function readGoalState(text: string): GoalReading | "none" | null {
  if (text.startsWith(NO_GOAL_PREFIX)) return "none";
  const match = GOAL_STATE_TEXT.exec(text);
  if (match === null) return null;
  const status = GOAL_STATUSES.find((known) => known === match[1]);
  if (status === undefined) return null;
  return {
    status,
    tokensUsed: Number(match[2]),
    tokenBudget: match[3] === undefined ? null : Number(match[3]),
    timeUsedSeconds: Number(match[4]),
  };
}

/** One collapsed row: styled text shown whole, then optional quoted free text that takes the rest of the width. */
export interface RowLine {
  head: string;
  tail: { joint: string; quoted: string } | null;
}

const QUOTES_WIDTH = 2;
/** Below this many columns a quotation says nothing; the row ends before it. */
const MIN_QUOTED_WIDTH = 4;
const ELLIPSIS = "…";

/**
 * Unstyled text cut to `width` columns. truncateToWidth ends its cut with a
 * style reset, which would also end the row's background inside pi's tool box.
 */
function cut(plain: string, width: number): string {
  if (visibleWidth(plain) <= width) return plain;
  return `${sliceByColumn(plain, 0, width - visibleWidth(ELLIPSIS), true)}${ELLIPSIS}`;
}

/** A row that is never wrapped: quoted text is cut with an ellipsis and keeps its closing quote. */
class Row implements Component {
  private readonly line: RowLine;
  private readonly theme: ToolRowTheme;

  constructor(line: RowLine, theme: ToolRowTheme) {
    this.line = line;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const w = Math.max(1, Math.floor(width));
    const { head, tail } = this.line;
    if (tail !== null) {
      const room = w - visibleWidth(head) - visibleWidth(tail.joint) - QUOTES_WIDTH;
      if (room >= MIN_QUOTED_WIDTH) return [`${head}${tail.joint}${this.theme.fg("toolOutput", `“${cut(tail.quoted, room)}”`)}`];
    }
    return [truncateToWidth(head, w, ELLIPSIS)];
  }
}

function field(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>)[key] : undefined;
}

/** Free text on one line: whitespace runs collapsed, control characters shown as escapes instead of reaching the terminal. */
function flat(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (control) => `\\x${control.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function title(tool: GoalToolName, theme: ToolRowTheme): string {
  return theme.fg("toolTitle", theme.bold(tool));
}

/** `cap 40k` when the call sets a token budget. */
function capFact(args: unknown): string[] {
  const budget = field(args, "token_budget");
  return typeof budget === "number" && Number.isFinite(budget) ? [`cap ${formatCompact(budget)}`] : [];
}

function objectiveTail(args: unknown, joint: string): RowLine["tail"] {
  const objective = flat(field(args, "objective"));
  return objective === "" ? null : { joint, quoted: objective };
}

/**
 * The call alone, shown until its outcome is known and above an error:
 * `get_goal`, `update_goal complete`, `create_goal cap 40k · “objective…”`.
 * Arguments may be partial while the call streams.
 */
export function collapsedCall(tool: GoalToolName, args: unknown, theme: ToolRowTheme): RowLine {
  const out = (text: string): string => theme.fg("toolOutput", text);
  const name = title(tool, theme);
  switch (tool) {
    case "get_goal":
      return { head: name, tail: null };
    case "update_goal": {
      const status = flat(field(args, "status"));
      return { head: status === "" ? name : `${name} ${out(status)}`, tail: null };
    }
    case "create_goal": {
      const cap = capFact(args);
      return cap.length === 0
        ? { head: name, tail: objectiveTail(args, " ") }
        : { head: `${name} ${out(cap.join(" · "))}`, tail: objectiveTail(args, out(" · ")) };
    }
  }
}

/**
 * A successful call and its outcome on one line, or null when the result
 * text has no short form: `get_goal → active · 1.2k/500k tokens · 6s`,
 * `get_goal → no goal`, `create_goal → set · “objective…”`, `update_goal complete`.
 */
export function collapsedOutcome(tool: GoalToolName, args: unknown, output: string, theme: ToolRowTheme): RowLine | null {
  const out = (text: string): string => theme.fg("toolOutput", text);
  const arrow = out(" → ");
  const name = title(tool, theme);
  switch (tool) {
    case "get_goal": {
      const reading = readGoalState(output);
      if (reading === null) return null;
      if (reading === "none") return { head: `${name}${arrow}${out("no goal")}`, tail: null };
      const used = formatCompact(reading.tokensUsed);
      const tokens = reading.tokenBudget === null ? used : `${used}/${formatCompact(reading.tokenBudget)}`;
      const status = theme.fg(stateColor(GOAL_STATUS_LOOK[reading.status].state), reading.status);
      return { head: `${name}${arrow}${status}${out(` · ${tokens} tokens · ${formatDuration(reading.timeUsedSeconds)}`)}`, tail: null };
    }
    case "create_goal": {
      const facts = capFact(args).map((fact) => out(` · ${fact}`)).join("");
      return { head: `${name}${arrow}${theme.fg("text", "set")}${facts}`, tail: objectiveTail(args, out(" · ")) };
    }
    case "update_goal": {
      const status = GOAL_STATUSES.find((known) => known === field(args, "status"));
      if (status === undefined) return collapsedCall(tool, args, theme);
      return { head: `${name} ${theme.fg(stateColor(GOAL_STATUS_LOOK[status].state), status)}`, tail: null };
    }
  }
}

// Mirrors of pi's generic tool rendering (formatToolCallWithArgs and the result
// fallback of its tool row), which pi does not export; the tests compare them with pi's.

const EXPANDED_TAB = "   ";
// ANSI escape sequences (CSI, OSC and other ESC forms), removed like pi's stripAnsi.
const ANSI_SEQUENCE = /[\u001b\u009b](?:\][\s\S]*?(?:\u0007|\u001b\\|\u009c)|\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g;
const BINARY_CONTROLS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g;

/** pi's expanded generic call header: the title, then one `key: value` line per argument. */
export function expandedCall(tool: GoalToolName, args: unknown, theme: ToolRowTheme): string {
  const header = title(tool, theme);
  if (args == null) return header;
  const entries: Array<[string, unknown]> = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
  if (entries.length === 0) return header;
  const lines = entries.map(([key, value]) => {
    const body = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
    return `  ${key}: ${body.replace(/\t/g, EXPANDED_TAB).replace(/\r/g, "").split("\n").join("\n    ")}`;
  });
  return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
}

/** pi's text output of a tool result (text blocks only; the goal tools return no images). */
export function resultText(content: readonly ResultContent[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => (part.text || "").replace(ANSI_SEQUENCE, "").replace(BINARY_CONTROLS, "").replace(/\r/g, ""))
    .join("\n");
}

/** pi's expanded result fallback: every output line in the tool output colour. */
function fullResult(output: string, theme: ToolRowTheme): Component {
  if (!output) return new Container();
  return new Text(output.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
}

/** The call's part of a tool row. Collapsed, a successful outcome takes the row over. */
export function renderGoalCall(tool: GoalToolName, args: unknown, theme: ToolRowTheme, context: ToolRowContext): Component {
  if (context.expanded) return new Text(expandedCall(tool, args, theme), 0, 0);
  if (!context.isPartial && !context.isError) return new Container();
  return new Row(collapsedCall(tool, args, theme), theme);
}

/** The result's part of a tool row: one line for a successful outcome while collapsed, otherwise the full text. */
export function renderGoalResult(
  tool: GoalToolName,
  result: { content: readonly ResultContent[] },
  options: { expanded: boolean },
  theme: ToolRowTheme,
  context: ToolRowContext,
): Component {
  const output = resultText(result.content);
  if (options.expanded || context.isPartial || context.isError) return fullResult(output, theme);
  const line = collapsedOutcome(tool, context.args, output, theme);
  if (line !== null) return new Row(line, theme);
  // The call's part is empty here, so the tool is named above text that has no short form.
  const named = new Container();
  named.addChild(new Row(collapsedCall(tool, context.args, theme), theme));
  named.addChild(fullResult(output, theme));
  return named;
}
