/**
 * ponygirls-subagents — a child's conversation as the transcript view shows it.
 *
 * The source is the child's native pi session file (JSONL, an entry tree).
 * Only the active branch is shown: the path from the last written entry to
 * the root. The file is appended while the child runs, so an incomplete
 * trailing line is skipped rather than reported. A gated agent's
 * transcript also shows each gate evaluation (the reviewer's own session)
 * where it happened, inside a gate gutter. Child content is untrusted
 * display input and is sanitized before rendering.
 */

import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeDisplay, type UiStyle } from "./display.ts";
import { REPAIR_PREFIX } from "./gate.ts";
import { TASK_HEADER_PATTERN } from "./protocol.ts";

type TranscriptContent =
  | { kind: "task"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  /** `verdict`: a gate decision's compact form (decision, candidate, blockers); null for other tools. */
  | { kind: "tool_call"; id: string | null; name: string; summary: string; verdict: string | null }
  | { kind: "tool_result"; callId: string | null; name: string; text: string; isError: boolean }
  | { kind: "message"; mode: string; messageId: string | null; text: string }
  | { kind: "compaction"; summary: string }
  | { kind: "error"; text: string };

/** One displayed part of a conversation, with its session entry's timestamp. */
export type TranscriptItem = TranscriptContent & { at: string };

/** A gate evaluation shown inside a gated agent's transcript. */
export interface ReviewBlock {
  label: string;
  at: string;
  items: TranscriptItem[];
  /** The reviewer is executing it now. */
  active: boolean;
  streaming: string | null;
}

export type MessageInfo = Map<string, { from: string; reply: boolean }>;

interface RenderOptions {
  taskLabel: string;
  /** Lines of task text shown, or null for all. */
  taskLines: number | null;
  /** Mark tasks that are the gate's repair requests. */
  labelRepairs: boolean;
}

const MAIN_OPTIONS: RenderOptions = { taskLabel: "task", taskLines: null, labelRepairs: true };
/** A review prompt is controller-written and long; its start is enough. */
const REVIEW_OPTIONS: RenderOptions = { taskLabel: "review prompt", taskLines: 4, labelRepairs: false };
const DECISION_TOOL = "submit_gate_decision";

interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
}

const TOOL_RESULT_LINES = 6;
const THINKING_LINES = 2;
const SUMMARY_MAX = 160;
const MESSAGE_PREFIX = "pi-subagents-";

/** The active branch of a session file as display items. */
export function parseTranscript(jsonl: string): TranscriptItem[] {
  const entries: SessionEntry[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as SessionEntry;
      if (typeof entry === "object" && entry !== null && typeof entry.type === "string") entries.push(entry);
    } catch {
      // An entry still being appended; it is complete on the next read.
    }
  }
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) if (typeof e.id === "string") byId.set(e.id, e);
  const leaf = [...entries].reverse().find((e) => typeof e.id === "string");
  const onBranch = new Set<string>();
  for (let cur = leaf; cur && typeof cur.id === "string" && !onBranch.has(cur.id); cur = typeof cur.parentId === "string" ? byId.get(cur.parentId) : undefined) {
    onBranch.add(cur.id);
  }
  const items: TranscriptItem[] = [];
  for (const e of entries) {
    if (typeof e.id !== "string" || !onBranch.has(e.id)) continue;
    const at = typeof e["timestamp"] === "string" ? e["timestamp"] : "";
    items.push(...itemsOf(e).map((content): TranscriptItem => ({ ...content, at })));
  }
  return items;
}

function itemsOf(e: SessionEntry): TranscriptContent[] {
  if (e.type === "compaction") return [{ kind: "compaction", summary: String(e["summary"] ?? "") }];
  if (e.type === "custom_message") {
    const customType = String(e["customType"] ?? "");
    const details = e["details"] as { messageId?: unknown } | undefined;
    return [{
      kind: "message",
      mode: customType.startsWith(MESSAGE_PREFIX) ? customType.slice(MESSAGE_PREFIX.length) : customType,
      messageId: typeof details?.messageId === "string" ? details.messageId : null,
      text: textOf(e["content"]),
    }];
  }
  if (e.type !== "message") return [];
  const m = e["message"] as { role?: string; content?: unknown; toolName?: string; toolCallId?: string; isError?: boolean; stopReason?: string; errorMessage?: string } | undefined;
  if (!m) return [];
  if (m.role === "user") return [{ kind: "task", text: textOf(m.content).replace(TASK_HEADER_PATTERN, "") }];
  if (m.role === "toolResult") return [{ kind: "tool_result", callId: typeof m.toolCallId === "string" ? m.toolCallId : null, name: String(m.toolName ?? "tool"), text: textOf(m.content), isError: m.isError === true }];
  if (m.role !== "assistant") return [];
  const out: TranscriptContent[] = [];
  for (const block of Array.isArray(m.content) ? (m.content as ContentBlock[]) : []) {
    if (block.type === "thinking" && block.thinking) out.push({ kind: "thinking", text: block.thinking });
    else if (block.type === "text" && block.text) out.push({ kind: "assistant", text: block.text });
    else if (block.type === "toolCall") {
      const name = String(block.name ?? "tool");
      out.push({ kind: "tool_call", id: typeof block.id === "string" ? block.id : null, name, summary: summarizeArgs(name, block.arguments), verdict: name === DECISION_TOOL ? verdictOf(block.arguments) : null });
    }
  }
  if (m.stopReason === "error") out.push({ kind: "error", text: m.errorMessage ?? "provider error" });
  if (m.stopReason === "aborted") out.push({ kind: "error", text: "interrupted" });
  return out;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[]).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

/** One line naming what a tool call does: its command, path, or message. */
function summarizeArgs(tool: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const a = args as Record<string, unknown>;
  const str = (key: string): string => (typeof a[key] === "string" ? (a[key] as string) : "");
  if (tool === "send_message") return oneLine(`→ ${str("target")}${a["request_reply"] === true ? " (asks)" : ""}: ${str("message")}`);
  if (tool === "spawn_agent") return oneLine(`${str("task_name")} (${str("profile")}): ${str("message")}`);
  if (tool === "wait_agent") return oneLine(str("condition") || "activity");
  if (tool === DECISION_TOOL) return oneLine(`${verdictOf(args)}${str("reason") ? ` · ${str("reason")}` : ""}`);
  for (const key of ["command", "path", "pattern", "target"]) {
    if (str(key)) return oneLine(str(key));
  }
  return oneLine(JSON.stringify(a));
}

function verdictOf(args: unknown): string {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const blockers = Array.isArray(a["blockers"]) ? a["blockers"].length : 0;
  return `${String(a["decision"] ?? "?")} · ${String(a["candidateId"] ?? "?")}${blockers > 0 ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}`;
}

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX)}…` : flat;
}

/** Display text: no terminal sequences, tabs as spaces, no carriage returns. */
function clean(text: string): string {
  return sanitizeDisplay(text, 20_000).replace(/\t/g, "  ").replace(/\r/g, "");
}

/** Column-wise wrap for tool output (code, JSON): no word reflow. */
function hardWrap(line: string, width: number): string[] {
  const out: string[] = [];
  for (let start = 0, total = visibleWidth(line); start < total; start += width) out.push(sliceByColumn(line, start, width));
  return out;
}

function wrapped(text: string, width: number, indent: string, style: (s: string) => string, maxLines: number | null, hard: boolean): string[] {
  const inner = Math.max(10, width - indent.length);
  const lines = clean(text).split("\n").flatMap((l) => (l === "" ? [""] : hard ? hardWrap(l, inner) : wrapTextWithAnsi(l, inner)));
  const shown = maxLines !== null && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const out = shown.map((l) => `${indent}${style(l)}`);
  if (shown.length < lines.length) out.push(`${indent}${style(`… ${lines.length - shown.length} more lines`)}`);
  return out;
}

/** Render one conversation's items to lines of at most `width` columns. */
export function renderTranscript(items: TranscriptItem[], width: number, style: UiStyle, messages: MessageInfo): string[] {
  return renderItems(items, width, style, messages, MAIN_OPTIONS);
}

/** A tool result is shown under its own call (parallel calls finish after all of them are issued). */
function renderItems(items: TranscriptItem[], width: number, style: UiStyle, messages: MessageInfo, options: RenderOptions): string[] {
  const out: string[] = [];
  const head = (s: string): string => truncateToWidth(s, width, "…");
  const calls = new Set(items.flatMap((i) => (i.kind === "tool_call" && i.id ? [i.id] : [])));
  const results = new Map<string, Extract<TranscriptItem, { kind: "tool_result" }>>();
  for (const i of items) if (i.kind === "tool_result" && i.callId && calls.has(i.callId)) results.set(i.callId, i);
  const resultLines = (r: Extract<TranscriptItem, { kind: "tool_result" }>): string[] => wrapped(r.text || "(no output)", width, "    ", r.isError ? style.error : style.dim, TOOL_RESULT_LINES, true);
  let previous: TranscriptItem["kind"] | null = null;
  for (const item of items) {
    const after = previous;
    previous = item.kind;
    switch (item.kind) {
      case "task": {
        const repair = options.labelRepairs && item.text.startsWith(REPAIR_PREFIX);
        out.push("", head(repair ? style.warning(style.bold("▸ repair requested by the gate")) : style.accent(style.bold(`▸ ${options.taskLabel}`))));
        out.push(...wrapped(item.text, width, "  ", style.text, options.taskLines, false));
        break;
      }
      case "assistant":
        out.push("", ...wrapped(item.text, width, "", style.text, null, false));
        break;
      case "thinking":
        if (after === "task" || after === "message") out.push("");
        out.push(...wrapped(item.text, width - 2, "", style.thinking, THINKING_LINES, false).map((l) => `${style.dim("│")} ${l}`));
        break;
      case "tool_call": {
        out.push(head(`${style.accent("⚙")} ${style.bold(clean(item.name))} ${style.muted(clean(item.summary))}`));
        const result = item.id ? results.get(item.id) : undefined;
        if (result) out.push(...resultLines(result));
        break;
      }
      case "tool_result":
        if (!item.callId || !calls.has(item.callId)) out.push(...resultLines(item));
        break;
      case "message": {
        const info = item.messageId ? messages.get(item.messageId) : undefined;
        const label = info?.reply ? "reply" : item.mode;
        out.push("", head(style.warning(`✉ ${label} from ${clean(info?.from ?? "unknown sender")}`)));
        out.push(...wrapped(item.text, width, "  ", style.text, null, false));
        break;
      }
      case "compaction":
        out.push("", head(style.muted("─ context compacted ─")), ...wrapped(item.summary, width, "  ", style.dim, THINKING_LINES, false));
        break;
      case "error":
        out.push(head(style.error(`✗ ${clean(item.text)}`)));
        break;
    }
  }
  return out[0] === "" ? out.slice(1) : out;
}

/**
 * A gated agent's conversation with its gate evaluations placed where they
 * started (between the agent's generations).
 */
export function renderConversation(main: TranscriptItem[], reviews: ReviewBlock[], width: number, style: UiStyle, messages: MessageInfo): string[] {
  const out: string[] = [];
  const pending = [...reviews].sort((a, b) => a.at.localeCompare(b.at));
  let segment: TranscriptItem[] = [];
  const flush = (): void => {
    if (segment.length > 0) out.push("", ...renderItems(segment, width, style, messages, MAIN_OPTIONS));
    segment = [];
  };
  for (const item of main) {
    while (pending.length > 0 && pending[0]!.at < item.at) {
      flush();
      out.push("", ...renderReview(pending.shift()!, width, style, messages));
    }
    segment.push(item);
  }
  flush();
  for (const review of pending) out.push("", ...renderReview(review, width, style, messages));
  return out[0] === "" ? out.slice(1) : out;
}

/** The decision a review submitted, or why it was not accepted. */
function decisionOf(items: TranscriptItem[]): string | null {
  const call = [...items].reverse().find((i): i is Extract<TranscriptItem, { kind: "tool_call" }> => i.kind === "tool_call" && i.name === DECISION_TOOL);
  if (!call) return null;
  const result = items.find((i): i is Extract<TranscriptItem, { kind: "tool_result" }> => i.kind === "tool_result" && i.callId !== null && i.callId === call.id);
  return result?.isError ? `decision rejected: ${oneLine(result.text)}` : `decision: ${call.verdict ?? call.summary}`;
}

function renderReview(review: ReviewBlock, width: number, style: UiStyle, messages: MessageInfo): string[] {
  const inner = Math.max(20, width - 2);
  const body = renderItems(review.items, inner, style, messages, REVIEW_OPTIONS);
  if (review.streaming) {
    body.push("", ...clean(review.streaming).split("\n").flatMap((l) => (l === "" ? [""] : wrapTextWithAnsi(l, inner))));
    body[body.length - 1] = `${body[body.length - 1]}${style.accent("▍")}`;
  } else if (review.active) {
    body.push(style.accent("… reviewing"));
  }
  const rule = (text: string): string => truncateToWidth(`${style.warning(style.bold(text))} ${style.warning("─".repeat(width))}`, width, "");
  const footer = decisionOf(review.items) ?? (review.active ? "reviewing" : "no decision recorded");
  return [rule(`╭─ ${clean(review.label)}`), ...body.map((l) => `${style.warning("┃")} ${l}`), rule(`╰─ ${clean(footer)}`)];
}
