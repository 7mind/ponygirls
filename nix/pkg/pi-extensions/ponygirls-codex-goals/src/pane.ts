/** The /goal pane: the current goal at a glance, with keys for the /goal subcommands. */
import { type Component, type KeyId, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  fit,
  fractionState,
  frameRule,
  frameTitle,
  type KeyHint,
  keyHints,
  stateColor,
  type UiTheme,
  usageBar,
} from "@ponygirls/pi-ui";
import type { GoalRecord, GoalStatus } from "./goal.ts";
import { formatDuration, formatTokens, GOAL_STATUS_LOOK } from "./presentation.ts";

/** A /goal subcommand the pane can run. */
export type GoalPaneAction = "pause" | "resume" | "edit" | "clear";

export interface GoalSnapshot {
  goal: GoalRecord | null;
  revision: number;
}

export type GoalSnapshotResult = { ok: true; value: GoalSnapshot } | { ok: false; error: string };

export interface GoalPanePorts {
  /** The persisted goal, or why the store cannot be read. */
  load(): GoalSnapshotResult;
  /** Run the /goal subcommand; reports its own failures and never rejects. */
  run(action: GoalPaneAction): Promise<void>;
  requestRender(): void;
  close(): void;
  nowMs(): number;
}

interface PaneKey {
  key: KeyId;
  action: GoalPaneAction;
  label: string;
}

const PAUSE: PaneKey = { key: "p", action: "pause", label: "pause" };
const RESUME: PaneKey = { key: "r", action: "resume", label: "resume" };
const EDIT: PaneKey = { key: "e", action: "edit", label: "edit objective" };
const CLEAR: PaneKey = { key: "c", action: "clear", label: "clear" };
const CLOSE_HINT: KeyHint = { key: "esc", action: "close" };

/** Keys offered per status: only transitions the /goal subcommands accept without extra arguments. */
const STATUS_KEYS: Readonly<Record<GoalStatus, readonly PaneKey[]>> = {
  active: [PAUSE, EDIT, CLEAR],
  paused: [RESUME, EDIT, CLEAR],
  blocked: [RESUME, EDIT, CLEAR],
  usage_limited: [RESUME, EDIT, CLEAR],
  budget_limited: [EDIT, CLEAR],
  complete: [EDIT, CLEAR],
};

const INDENT = "  ";
const LABEL_WIDTH = 9;
const BUDGET_BAR_WIDTH = 10;
const PERCENT = 100;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** `today 20:46`, `yesterday 09:15`, or `2026-10-28 09:15`, in local time. */
export function localStamp(at: Date, now: Date): string {
  const clock = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const days = Math.round((localDay(now) - localDay(at)) / DAY_MS);
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${clock}`;
}

/** `just now`, `4 min ago`, `2h ago`, `3d ago`. */
export function relativeAge(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs);
  if (ms < MINUTE_MS) return "just now";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`;
  return `${Math.floor(ms / DAY_MS)}d ago`;
}

/** The goal pane shown by `/goal` and by clicking the goal badge. */
export class GoalPane implements Component {
  private readonly theme: UiTheme;
  private readonly ports: GoalPanePorts;
  private busy = false;

  constructor(theme: UiTheme, ports: GoalPanePorts) {
    this.theme = theme;
    this.ports = ports;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const loaded = this.ports.load();
    const s = this.theme;
    if (!loaded.ok || loaded.value.goal === null) {
      const body = loaded.ok
        ? s.fg("muted", "no goal — /goal <objective> sets one")
        : s.fg("error", `goal state unreadable: ${loaded.error}`);
      return [
        frameTitle(s, width, { title: "Goal", right: loaded.ok ? s.fg("dim", `rev ${loaded.value.revision}`) : undefined }, "none").line,
        `${INDENT}${body}`,
        frameRule(s, width),
        ...keyHints(s, width, [CLOSE_HINT]).lines,
      ].map((line) => truncateToWidth(line, width, "…"));
    }
    const goal = loaded.value.goal;
    const look = GOAL_STATUS_LOOK[goal.status];
    const chip = s.bg("toolPendingBg", ` ${s.fg(stateColor(look.state), `${look.glyph} ${goal.status}`)} `);
    const now = this.ports.nowMs();
    const objective = goal.objective
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - INDENT.length)))
      .map((line) => `${INDENT}${s.fg("text", line)}`);
    const hints = [...STATUS_KEYS[goal.status].map((k) => ({ key: k.key, action: k.label })), CLOSE_HINT];
    return [
      frameTitle(s, width, { title: "Goal", right: `${chip} ${s.fg("dim", `rev ${loaded.value.revision}`)}` }, "none").line,
      ...objective,
      "",
      this.row("tokens", this.budget(goal)),
      this.row("time", s.fg("text", formatDuration(goal.timeUsedSeconds))),
      this.row("created", this.when(goal.createdAt, now)),
      this.row("updated", this.when(goal.updatedAt, now)),
      frameRule(s, width),
      ...keyHints(s, width, hints).lines,
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.ports.close();
      return;
    }
    if (this.busy) return;
    const loaded = this.ports.load();
    if (!loaded.ok || loaded.value.goal === null) return;
    const pressed = STATUS_KEYS[loaded.value.goal.status].find((k) => matchesKey(data, k.key));
    if (!pressed) return;
    this.busy = true;
    void this.ports.run(pressed.action).then(() => {
      this.busy = false;
      this.ports.requestRender();
    });
  }

  private row(label: string, value: string): string {
    return `${INDENT}${this.theme.fg("muted", fit(label, LABEL_WIDTH))}${value}`;
  }

  private budget(goal: GoalRecord): string {
    const s = this.theme;
    if (goal.tokenBudget === null) return `${s.fg("text", formatTokens(goal.tokensUsed))}${s.fg("muted", " · no cap")}`;
    const fraction = goal.tokensUsed / goal.tokenBudget;
    const bar = usageBar(s, fraction, BUDGET_BAR_WIDTH, fractionState(fraction));
    const percent = Math.round(fraction * PERCENT);
    return `${s.fg("text", `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`)}  ${bar} ${s.fg("muted", `${percent}%`)}`;
  }

  private when(iso: string, nowMs: number): string {
    const at = new Date(iso);
    // An unparseable stored timestamp is shown verbatim rather than as NaN.
    if (Number.isNaN(at.getTime())) return this.theme.fg("text", iso);
    return `${this.theme.fg("text", localStamp(at, new Date(nowMs)))}  ${this.theme.fg("muted", `(${relativeAge(nowMs - at.getTime())})`)}`;
  }
}
