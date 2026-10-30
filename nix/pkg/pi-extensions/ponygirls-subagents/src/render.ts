/**
 * ponygirls-subagents — transcript renderers for subagent notices and
 * spawn_agent. Collapsed, each is one line; expanded (pi's global toggle),
 * each shows exactly what pi's default rendering shows. Only the display
 * changes: the persisted and model-visible content stays the same.
 */

import { Box, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { AGENT_GLYPH, OUTCOME_GLYPH, outcomeTone, sanitizeDisplay } from "./display.ts";

/** The part of pi's theme these renderers use. */
export interface RenderTheme {
  fg(color: "text" | "muted" | "success" | "warning" | "error" | "toolTitle" | "toolOutput" | "customMessageLabel" | "customMessageText", text: string): string;
  bg(color: "customMessageBg", text: string): string;
  bold(text: string): string;
}

const NOTICE_HEADER = "[subagents]";
const SEPARATOR = " · ";
/** Characters of free text (details, messages) kept in a collapsed line before the width cut. */
const SNIPPET_CHARS = 160;

/** One line, cut to the width it is given. */
class OneLine implements Component {
  private readonly line: () => string;

  constructor(line: () => string) {
    this.line = line;
  }

  render(width: number): string[] {
    return [truncateToWidth(this.line(), Math.max(1, width), "…")];
  }

  invalidate(): void {}
}

/** Renders nothing: the collapsed spawn_agent result lives on the call line. */
class Nothing implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

// ── subagent notices ────────────────────────────────────────────────────────

/** One notice from Supervisor.noticesSince, with any continuation lines of its free text. */
export type Notice =
  | { kind: "ended"; path: string; taskRunId: string; outcome: string; detail: string }
  | { kind: "quarantined"; path: string; reason: string }
  | { kind: "controller_failure"; error: string }
  | { kind: "message"; path: string; question: boolean; text: string }
  | { kind: "other"; text: string };

const ENDED = /^(\S+) task (\S+) ended (\w+)(?:: (.*))?$/;
const QUARANTINED = /^(\S+) quarantined: (.*)$/;
const CONTROLLER_FAILURE = /^controller failure: (.*)$/;
const MESSAGE = /^(question \S+|message) from (\S+) \(\S+\): (.*)$/;

function parseLine(line: string): Notice | null {
  let m = ENDED.exec(line);
  if (m) return { kind: "ended", path: m[1]!, taskRunId: m[2]!, outcome: m[3]!, detail: m[4] ?? "" };
  m = QUARANTINED.exec(line);
  if (m) return { kind: "quarantined", path: m[1]!, reason: m[2]! };
  m = CONTROLLER_FAILURE.exec(line);
  if (m) return { kind: "controller_failure", error: m[1]! };
  m = MESSAGE.exec(line);
  if (m) return { kind: "message", path: m[2]!, question: m[1]!.startsWith("question"), text: m[3]! };
  return null;
}

function appendText(notice: Notice, line: string): Notice {
  switch (notice.kind) {
    case "ended":
      return { ...notice, detail: `${notice.detail}\n${line}` };
    case "quarantined":
      return { ...notice, reason: `${notice.reason}\n${line}` };
    case "controller_failure":
      return { ...notice, error: `${notice.error}\n${line}` };
    case "message":
      return { ...notice, text: `${notice.text}\n${line}` };
    case "other":
      return { ...notice, text: `${notice.text}\n${line}` };
  }
}

/** Notices in a notice message's text; lines that start no notice continue the previous one's text. */
export function parseNotices(text: string): Notice[] {
  const body = text.startsWith(`${NOTICE_HEADER}\n`) ? text.slice(NOTICE_HEADER.length + 1) : text;
  const notices: Notice[] = [];
  for (const line of body.split("\n")) {
    const parsed = parseLine(line);
    if (parsed) notices.push(parsed);
    else if (notices.length > 0) notices[notices.length - 1] = appendText(notices[notices.length - 1]!, line);
    else if (line.trim() !== "") notices.push({ kind: "other", text: line });
  }
  return notices;
}

function snippet(text: string): string {
  return sanitizeDisplay(text.replace(/\s+/g, " ").trim(), SNIPPET_CHARS);
}

/** The notice's subject and status, styled; `full` adds its free text. */
function noticePart(theme: RenderTheme, notice: Notice, full: boolean): string {
  const text = (s: string): string => theme.fg("customMessageText", s);
  const extra = (s: string): string => (full && s.trim() !== "" ? text(`${SEPARATOR}${snippet(s)}`) : "");
  switch (notice.kind) {
    case "ended": {
      const tone = outcomeTone(notice.outcome);
      return `${text(sanitizeDisplay(notice.path))} ${theme.fg(tone, `${OUTCOME_GLYPH[tone]} ${sanitizeDisplay(notice.outcome)}`)}${extra(notice.detail)}`;
    }
    case "quarantined":
      return `${text(sanitizeDisplay(notice.path))} ${theme.fg("error", `${OUTCOME_GLYPH.error} quarantined`)}${extra(notice.reason)}`;
    case "controller_failure":
      return `${theme.fg("error", `${OUTCOME_GLYPH.error} controller failure`)}${extra(notice.error)}`;
    case "message":
      return `${text(sanitizeDisplay(notice.path))} ${notice.question ? theme.fg("warning", "? question") : text("message")}${extra(notice.text)}`;
    case "other":
      return text(snippet(notice.text));
  }
}

/**
 * `◈ agent /root/x ✓ succeeded · /agents` for one notice; several become
 * `◈ subagents · 3 notices · /root/a ✓ succeeded · /root/b ✖ failed · /agents`.
 */
export function noticeLine(theme: RenderTheme, text: string): string {
  const notices = parseNotices(text);
  const hint = theme.fg("customMessageText", `${SEPARATOR}/agents`);
  if (notices.length === 1) {
    const notice = notices[0]!;
    const label = notice.kind === "controller_failure" || notice.kind === "other" ? `${AGENT_GLYPH} subagents` : `${AGENT_GLYPH} agent`;
    return `${theme.fg("customMessageLabel", label)} ${noticePart(theme, notice, true)}${hint}`;
  }
  const parts = notices.map((notice) => noticePart(theme, notice, false)).join(theme.fg("customMessageText", SEPARATOR));
  return `${theme.fg("customMessageLabel", `${AGENT_GLYPH} subagents`)}${theme.fg("customMessageText", `${SEPARATOR}${notices.length} notices${SEPARATOR}`)}${parts}${hint}`;
}

/** Text of a custom message's content (string or text blocks), as pi's default renderer reads it. */
function messageText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

/**
 * Collapsed: one line on the custom-message background. Expanded: undefined,
 * so pi draws its default box with the full text.
 */
export function renderNotice(message: { content: string | ReadonlyArray<{ type: string; text?: string }> }, options: { expanded: boolean; outputPad: number }, theme: RenderTheme): Component | undefined {
  if (options.expanded) return undefined;
  const line = noticeLine(theme, messageText(message.content));
  const box = new Box(options.outputPad, 0, (s) => theme.bg("customMessageBg", s));
  box.addChild(new OneLine(() => line));
  return box;
}

// ── spawn_agent ─────────────────────────────────────────────────────────────

/** What the collapsed call line shows once the result arrived. */
export type SpawnOutcome =
  | { kind: "started"; path: string; generation: number; status: string; isolation: string }
  | { kind: "error"; message: string }
  | { kind: "unreadable"; text: string };

/** Renderer state shared between the call and result renders of one spawn_agent row. */
export interface SpawnRenderState {
  outcome?: SpawnOutcome;
}

interface ToolResultLike {
  content: ReadonlyArray<{ type: string; text?: string }>;
}

function resultText(result: ToolResultLike): string {
  return result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

export function spawnOutcome(result: ToolResultLike, isError: boolean): SpawnOutcome {
  const text = resultText(result);
  if (isError) return { kind: "error", message: text };
  try {
    const parsed = JSON.parse(text) as { path?: unknown; generation?: unknown; status?: unknown; isolation?: unknown };
    if (typeof parsed.path === "string" && typeof parsed.generation === "number" && typeof parsed.status === "string" && typeof parsed.isolation === "string") {
      return { kind: "started", path: parsed.path, generation: parsed.generation, status: parsed.status, isolation: parsed.isolation };
    }
  } catch {
    // Not a spawn result: shown as text below.
  }
  return { kind: "unreadable", text };
}

/** A non-empty string argument of a call, sanitized; null when absent (arguments may still be streaming). */
function argText(args: unknown, key: string): string | null {
  if (typeof args !== "object" || args === null) return null;
  const value: unknown = Reflect.get(args, key);
  return typeof value === "string" && value !== "" ? sanitizeDisplay(value) : null;
}

/** `spawn_agent audit-colors · reader · none → started /root/audit-colors (gen 1)` */
export function spawnLine(theme: RenderTheme, args: unknown, outcome: SpawnOutcome | undefined): string {
  const out = (s: string): string => theme.fg("toolOutput", s);
  const isolation = argText(args, "isolation") ?? (outcome?.kind === "started" ? sanitizeDisplay(outcome.isolation) : null);
  const facts = [argText(args, "task_name"), argText(args, "profile"), isolation].filter((f): f is string => f !== null);
  const head = `${theme.fg("toolTitle", theme.bold("spawn_agent"))}${facts.length > 0 ? out(` ${facts.join(SEPARATOR)}`) : ""}`;
  if (!outcome) return head;
  const arrow = out(" → ");
  switch (outcome.kind) {
    case "started":
      return `${head}${arrow}${theme.fg("text", outcome.status === "queued" ? "queued" : "started")}${out(` ${sanitizeDisplay(outcome.path)} (gen ${outcome.generation})`)}`;
    case "error":
      return `${head}${arrow}${theme.fg("error", `${OUTCOME_GLYPH.error} ${snippet(outcome.message)}`)}`;
    case "unreadable":
      return `${head}${arrow}${out(snippet(outcome.text))}`;
  }
}

// Expanded rendering mirrors pi's fallbacks for tools without renderers
// (ToolExecutionComponent.createCallFallback/createResultFallback with
// render-utils' formatToolCallWithArgs and getTextOutput), which pi does not
// export. tests/render.test.ts compares them with pi's own functions.

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

/** formatToolCallWithArgs(title, args, theme, true). */
export function expandedCallText(theme: RenderTheme, title: string, args: unknown): string {
  const header = theme.fg("toolTitle", theme.bold(title));
  if (args == null) return header;
  const entries = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args] as const];
  if (entries.length === 0) return header;
  const lines = entries.map(([key, value]) => {
    const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
    return `  ${key}: ${replaceTabs(text).replace(/\r/g, "").split("\n").join("\n    ")}`;
  });
  return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
}

// pi's stripAnsi (derived from chalk's ansi-regex) and sanitizeBinaryOutput.
const ANSI_ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
const ANSI_REGEX = new RegExp(`(?:\\u001B\\][\\s\\S]*?${ANSI_ST})|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]`, "g");
const BINARY_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g;

/** getTextOutput for text-only results (spawn_agent never returns images). */
export function expandedResultText(result: ToolResultLike): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => (c.text ?? "").replace(ANSI_REGEX, "").replace(BINARY_CHARS, "").replace(/\r/g, ""))
    .join("\n");
}

interface SpawnRenderContext {
  state: SpawnRenderState;
  isError: boolean;
}

/** Collapsed: the whole row on one line, completed by the result once it arrives. */
export function renderSpawnCall(args: unknown, theme: RenderTheme, context: SpawnRenderContext & { expanded: boolean }): Component {
  if (context.expanded) return new Text(expandedCallText(theme, "spawn_agent", args), 0, 0);
  // The result render of the same pass fills the state before this line is drawn.
  return new OneLine(() => spawnLine(theme, args, context.state.outcome));
}

export function renderSpawnResult(result: ToolResultLike, options: { expanded: boolean }, theme: RenderTheme, context: SpawnRenderContext): Component {
  context.state.outcome = spawnOutcome(result, context.isError);
  if (!options.expanded) return new Nothing();
  const output = expandedResultText(result);
  if (!output) return new Nothing();
  return new Text(output.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n"), 0, 0);
}
