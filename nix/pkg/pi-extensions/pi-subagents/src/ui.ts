/**
 * pi-subagents — governing-session observation and TUI inspector.
 *
 * One event model, several views: list_agents, read_agent, wait_agent, the
 * widget, and the inspector project the same journal-backed state. Actions
 * use the same supervisor API as tools and record human origin.
 *
 * Child content is untrusted display input: ANSI/OSC sequences are
 * sanitized before rendering. Headless output contains no terminal escapes.
 * Escape closes the inspector or cancels the local wait; it never
 * terminates children.
 */

import type { AgentView } from "./supervisor.ts";

export type InspectorAction =
  | { kind: "message"; agentId: string }
  | { kind: "task"; agentId: string }
  | { kind: "interrupt"; agentId: string }
  | { kind: "close"; agentId: string }
  | { kind: "answer"; agentId: string }
  | { kind: "retry_review"; agentId: string };

/** Strip ANSI CSI/OSC sequences and control characters for safe display. */
export function sanitizeDisplay(input: string, maxLength = 4000): string {
  let out = input.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return out.length > maxLength ? `${out.slice(0, maxLength)}…[truncated]` : out;
}

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

/** Compact widget line (no second transcript in the root conversation). */
export function widgetLine(views: AgentView[]): string {
  const c = countTree(views);
  const parts = [`agents: ${views.length}`, `running ${c.running}`, `queued ${c.queued}`];
  if (c.questions > 0) parts.push(`questions ${c.questions}`);
  return parts.join(" · ");
}

/** Headless projection: structured text, no terminal escapes. */
export function renderHeadless(views: AgentView[]): string {
  if (views.length === 0) return "No subagents.";
  return views
    .map(
      (v) =>
        `${sanitizeDisplay(v.path)} [${v.profile}] ${v.observed}${v.pendingIntent !== v.observed ? ` (${sanitizeDisplay(v.pendingIntent)})` : ""} gen=${v.generation} model=${sanitizeDisplay(v.model)}${v.taskOutcome ? ` outcome=${v.taskOutcome}` : ""}`,
    )
    .join("\n");
}

export interface InspectorCallbacks {
  onAction: (action: InspectorAction) => void;
  onClose: () => void;
  refresh: () => AgentView[];
  requestRender: () => void;
}

/**
 * Single tree inspector. Rows show canonical path, profile, model, observed
 * state, pending intent, generation, usage, and freshness. Nested agents are
 * visible, not hidden behind their owner. Enter opens status/result detail;
 * actions use the supervisor API with human origin.
 */
export class AgentInspector {
  private views: AgentView[];
  private selected = 0;
  private scrollTop = 0;
  private detail: AgentView | null = null;
  private statusLine = "";

  private callbacks: InspectorCallbacks;
  constructor(
    initial: AgentView[],
    callbacks: InspectorCallbacks,
  ) {
    this.callbacks = callbacks;
    this.views = initial;
  }

  invalidate(): void {}

  notice(text: string): void {
    this.statusLine = sanitizeDisplay(text, 200);
  }

  refreshViews(views: AgentView[]): void {
    this.views = views;
    this.selected = Math.min(this.selected, Math.max(0, views.length - 1));
  }

  render(width: number): string[] {
    const w = Math.max(40, width);
    const lines: string[] = [];
    lines.push(sanitizeDisplay(widgetLine(this.views)).padEnd(w).slice(0, w));
    lines.push("─".repeat(Math.min(w, 120)));
    const rows = this.views.map((v, i) => this.rowLine(v, i === this.selected));
    const budget = 20;
    const start = Math.min(this.scrollTop, Math.max(0, rows.length - budget));
    const visible = rows.slice(start, start + budget);
    for (const row of visible) lines.push(fit(row, w));
    if (this.detail) {
      lines.push("─".repeat(Math.min(w, 120)));
      lines.push(...this.detailLines(this.detail, w));
    }
    lines.push("");
    lines.push(
      sanitizeDisplay("[↑↓] select [enter] detail [m] message [t] task [i] interrupt [c] close [a] answer [g] gate retry [r] refresh [esc] dismiss (never kills children)", w),
    );
    if (this.statusLine) lines.push(sanitizeDisplay(`! ${this.statusLine}`, w));
    return lines;
  }

  handleInput(data: string): void {
    const key = data.length === 1 && data >= " " && data !== "\x7f" ? data : keyName(data);
    if (key === "escape" || key === "q") {
      this.callbacks.onClose();
      return;
    }
    if (key === "up" || key === "k") {
      this.selected = Math.max(0, this.selected - 1);
      this.clampScroll();
      return;
    }
    if (key === "down" || key === "j") {
      this.selected = Math.min(this.views.length - 1, this.selected + 1);
      this.clampScroll();
      return;
    }
    if (key === "enter") {
      this.detail = this.views[this.selected] ?? null;
      return;
    }
    if (key === "r") {
      this.views = this.callbacks.refresh();
      this.selected = Math.min(this.selected, Math.max(0, this.views.length - 1));
      return;
    }
    const current = this.views[this.selected];
    if (!current) return;
    if (key === "m") this.callbacks.onAction({ kind: "message", agentId: current.id });
    else if (key === "t") this.callbacks.onAction({ kind: "task", agentId: current.id });
    else if (key === "i") this.callbacks.onAction({ kind: "interrupt", agentId: current.id });
    else if (key === "c") this.callbacks.onAction({ kind: "close", agentId: current.id });
    else if (key === "a") this.callbacks.onAction({ kind: "answer", agentId: current.id });
    else if (key === "g") this.callbacks.onAction({ kind: "retry_review", agentId: current.id });
  }

  private clampScroll(): void {
    if (this.selected < this.scrollTop) this.scrollTop = this.selected;
    if (this.selected >= this.scrollTop + 20) this.scrollTop = this.selected - 19;
  }

  private rowLine(v: AgentView, selected: boolean): string {
    const indent = "  ".repeat(Math.min(4, v.depth - 1));
    const marker = selected ? "› " : "  ";
    const gate = v.managedGateFor ? ` gate:${v.managedGateFor.slice(0, 8)}` : "";
    return `${marker}${indent}${v.path} [${v.profile}] ${v.observed} · ${v.pendingIntent} · gen ${v.generation}${gate} · ${v.model}`;
  }

  private detailLines(v: AgentView, width: number): string[] {
    return [
      fit(`path: ${v.path}  id: ${v.id}`, width),
      fit(`profile: ${v.profile}  model: ${v.model}  observed: ${v.observed}`, width),
      fit(`pending: ${v.pendingIntent}  generation: ${v.generation}  outcome: ${v.taskOutcome ?? "-"}`, width),
      fit(`usage: in=${v.usage.inputTokens} out=${v.usage.outputTokens} cost=${v.usage.cost ?? (v.usage.unknown ? "unknown" : "n/a")}  active: ${v.lastActivityAt}`, width),
    ];
  }
}

function fit(line: string, width: number): string {
  const clean = sanitizeDisplay(line, width);
  return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
}

function keyName(data: string): string {
  if (data === "\x1b") return "escape";
  if (data === "\r" || data === "\n") return "enter";
  if (data === "\x1b[A") return "up";
  if (data === "\x1b[B") return "down";
  return data;
}
