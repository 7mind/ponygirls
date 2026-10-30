/**
 * Transcript renderers: one-line collapsed forms for bg_task calls, completion
 * notices and status-backend notices. Expanded (ctrl+o) forms are exactly the
 * text pi showed before these renderers existed.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { UiFg } from "@ponygirls/pi-ui";
import type { BgTaskParamsSchema, CompletionDetails, CompletionEvent, TaskRecord, TaskState } from "./protocol.ts";
import { exitFailed, formatSize, informativeReason, shortTaskId, stateGlyph, taskStateColor } from "./present.ts";
import { displayValue } from "./terminal-text.ts";
import { elapsed, formatExit, stateLabel, type BgTaskDetails } from "./tool.ts";

export type TranscriptFg = UiFg | "toolTitle" | "toolOutput";

/** The part of pi's Theme the transcript renderers use. */
export interface TranscriptTheme {
  fg(color: TranscriptFg, text: string): string;
  bold(text: string): string;
}

const TOOL_NAME = "bg_task";
const BG_GLYPH = "⚙";
const INSPECT_HINT = "/bg to inspect";

/** A single line, truncated (never wrapped) to the width, recomputed on every render. */
export class OneLine implements Component {
  private readonly line: () => string;
  private readonly indent: number;

  constructor(line: () => string, indent: number) {
    this.line = line;
    this.indent = indent;
  }

  render(width: number): string[] {
    return [truncateToWidth(`${" ".repeat(this.indent)}${this.line()}`, Math.max(1, width))];
  }

  invalidate(): void {}
}

// ---- bg_task tool -------------------------------------------------------------------

/** Tool arguments as they may arrive: possibly partial while streaming, or from an older session. */
type LooseArgs = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One-line form of free text: whitespace runs collapsed, control characters escaped. */
function flat(value: string): string {
  return displayValue(value.replace(/\s+/g, " ").trim());
}

/** `spawn tests · make check`, `read c7c6…`, … */
export function callSummary(args: LooseArgs): string {
  const action = text(args.action);
  const id = text(args.id) ? shortTaskId(text(args.id)) : "";
  switch (action) {
    case "spawn":
      return [`spawn ${flat(text(args.label))}`.trimEnd(), flat(text(args.command))].filter(Boolean).join(" · ");
    case "signal":
      return `signal ${id} ${text(args.signal)}`.trimEnd();
    case "notify":
      return typeof args.enabled === "boolean" ? `notify ${id} ${args.enabled ? "on" : "off"}` : `notify ${id}`.trimEnd();
    case "read":
    case "terminate":
    case "clear":
      return `${action} ${id}`.trimEnd();
    default:
      return flat(action);
  }
}

function toolHeader(theme: TranscriptTheme): string {
  return theme.fg("toolTitle", theme.bold(TOOL_NAME));
}

export function collapsedCall(args: LooseArgs, theme: TranscriptTheme): string {
  const summary = callSummary(args);
  return summary ? `${toolHeader(theme)} ${theme.fg("toolOutput", summary)}` : toolHeader(theme);
}

/** What a successful call did, styled. */
function outcome(details: BgTaskDetails, theme: TranscriptTheme): string {
  const out = (s: string) => theme.fg("toolOutput", s);
  switch (details.action) {
    case "spawn":
      return `${theme.fg("text", "started")}${out(` ${shortTaskId(details.task.id)} (notice ${details.task.notify ? "on" : "off"})`)}`;
    case "list":
      return out(`${details.items.length} task(s)${details.nextCursor ? ", more history" : ""}`);
    case "read":
      return out(`bytes ${details.offset}–${details.nextOffset} of ${details.size}${details.eof ? " (end of log)" : ""}`);
    case "signal":
      return out(`${details.delivered ? "sent" : "not delivered"} · ${stateLabel(details.task)}`);
    case "terminate": {
      const task = details.task;
      return theme.fg(taskStateColor(task.state), `${stateGlyph(task.state)} ${task.state}`) + out(` · ${formatExit(task.exit)}`);
    }
    case "notify":
      return out(`notices ${details.task.notify ? "on" : "off"}`);
    case "clear":
      return out(`cleared ${formatSize(details.removedBytes)}`);
  }
}

function firstLine(content: readonly ResultContent[]): string {
  const all = content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("\n");
  return flat(all.split("\n").find((line) => line.trim() !== "") ?? "");
}

export interface ResultContent {
  type: string;
  text?: string;
}

export interface ToolResultView {
  content: readonly ResultContent[];
  details: BgTaskDetails | undefined;
}

export function collapsedResult(args: LooseArgs, result: ToolResultView, isError: boolean, theme: TranscriptTheme): string {
  const arrow = theme.fg("toolOutput", " → ");
  if (isError || !result.details) return `${collapsedCall(args, theme)}${arrow}${theme.fg("error", `✖ ${firstLine(result.content)}`)}`;
  return `${collapsedCall(args, theme)}${arrow}${outcome(result.details, theme)}`;
}

// Mirrors of pi's generic tool rendering (formatToolCallWithArgs and the result
// fallback in tool-execution), which are not exported; tests compare them with pi's.

const COLLAPSED_TAB = "   ";
// ANSI escape sequences (CSI, OSC and other ESC forms), removed like pi's stripAnsi.
const ANSI_SEQUENCE = /[\u001b\u009b](?:\][\s\S]*?(?:\u0007|\u001b\\|\u009c)|\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g;
const BINARY_CONTROLS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g;

/** pi's expanded generic call header: the title, then one `key: value` line per argument. */
export function expandedCall(args: unknown, theme: TranscriptTheme): string {
  const header = toolHeader(theme);
  if (args == null) return header;
  const entries: Array<[string, unknown]> = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
  if (entries.length === 0) return header;
  const lines = entries.map(([key, value]) => {
    const body = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
    return `  ${key}: ${body.replace(/\t/g, COLLAPSED_TAB).replace(/\r/g, "").split("\n").join("\n    ")}`;
  });
  return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
}

/** pi's text output of a tool result (text blocks only; bg_task returns no images). */
export function resultText(content: readonly ResultContent[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => (part.text || "").replace(ANSI_SEQUENCE, "").replace(BINARY_CONTROLS, "").replace(/\r/g, ""))
    .join("\n");
}

/** pi's expanded result fallback: every output line in the tool output colour. */
export function expandedResult(content: readonly ResultContent[], theme: TranscriptTheme): Component {
  const output = resultText(content);
  if (!output) return new Container();
  return new Text(output.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
}

type BgTaskRenderers = Pick<ToolDefinition<typeof BgTaskParamsSchema, BgTaskDetails>, "renderCall" | "renderResult">;

/**
 * Collapsed, the call and its outcome share one line: the call renders alone
 * only until the final result arrives.
 */
export const bgTaskRenderers: BgTaskRenderers = {
  renderCall: (args, theme, context) => {
    if (context.expanded) return new Text(expandedCall(args, theme), 0, 0);
    if (!context.isPartial) return new Container();
    return new OneLine(() => collapsedCall(args, theme), 0);
  },
  renderResult: (result, options, theme, context) => {
    if (options.expanded) return expandedResult(result.content, theme);
    return new OneLine(() => collapsedResult(context.args, result, context.isError, theme), 0);
  },
};

// ---- completion and status notices ------------------------------------------------------

/** A retained task record by id, if this activation has seen it. */
export type TaskLookup = (id: string) => TaskRecord | undefined;

const STATE_ORDER: readonly Exclude<TaskState, "running">[] = ["completed", "failed", "dead"];

function bgLabel(theme: TranscriptTheme): string {
  return theme.fg("accent", `${BG_GLYPH} bg`);
}

function eventLine(event: CompletionEvent, task: TaskRecord | undefined, now: number, theme: TranscriptTheme): string {
  const dim = (s: string) => theme.fg("dim", s);
  const outcomeParts = [`${stateGlyph(event.state)} ${event.state}`];
  if (!task) {
    if (event.reason !== "exit") outcomeParts.push(displayValue(event.reason));
    return `${bgLabel(theme)} ${theme.fg("text", shortTaskId(event.taskId))} ${theme.fg(taskStateColor(event.state), outcomeParts.join(" · "))}${dim(` · ${INSPECT_HINT}`)}`;
  }
  if (task.exit && exitFailed(task.exit)) outcomeParts.push(formatExit(task.exit));
  const reason = informativeReason(task.reason, task.exit);
  if (reason) outcomeParts.push(reason);
  const facts = [elapsed(task, now), `log ${formatSize(task.logBytes)}`, INSPECT_HINT];
  return `${bgLabel(theme)} ${theme.fg("text", displayValue(task.label))} ${theme.fg(taskStateColor(event.state), outcomeParts.join(" · "))}${dim(` · ${facts.join(" · ")}`)}`;
}

/**
 * `⚙ bg tests ✖ failed · exit 3 · 2s · log 30 B · /bg to inspect`; several
 * events are summarised by state. Task facts come from the retained record
 * when it is known, otherwise from the notice alone.
 */
export function completionLine(details: CompletionDetails, lookup: TaskLookup, now: number, theme: TranscriptTheme): string {
  const events = details.events;
  if (events.length === 1) return eventLine(events[0]!, lookup(events[0]!.taskId), now, theme);
  const counts = STATE_ORDER.map((state) => ({ state, count: events.filter((e) => e.state === state).length })).filter((c) => c.count > 0);
  const summary = counts.map((c) => theme.fg(taskStateColor(c.state), `${stateGlyph(c.state)} ${c.count} ${c.state}`)).join(theme.fg("dim", " · "));
  return `${bgLabel(theme)} ${theme.fg("text", `${events.length} tasks finished`)} ${summary}${theme.fg("dim", ` · ${INSPECT_HINT}`)}`;
}

export type StatusNoticeKind = "unavailable" | "recovered";

const STATUS_PREFIX = "bg-tasks: ";

/** `⚙ bg status backend unreachable (…); the badge keeps its last state.` */
export function statusLine(status: StatusNoticeKind, content: string, theme: TranscriptTheme): string {
  const body = flat(content.startsWith(STATUS_PREFIX) ? content.slice(STATUS_PREFIX.length) : content);
  return `${theme.fg(status === "unavailable" ? "warning" : "success", `${BG_GLYPH} bg`)} ${theme.fg("text", body)}`;
}
