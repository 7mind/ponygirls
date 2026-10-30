/**
 * Collapsed transcript forms for goal instructions, commit metadata, and
 * lifecycle notices. These only shorten what is drawn while pi's global
 * expand toggle is off; persisted and model-facing content is unchanged, and
 * the expanded form is the full text.
 */
import type { Component } from "@earendil-works/pi-tui";
import { fit, stateColor, type UiFg } from "@ponygirls/pi-ui";
import { formatDuration, GOAL_STATUS_LOOK } from "./presentation.ts";
import { type InstructionPurpose, parseExecutionIndex, parseInstructionHeader, parseObjective } from "./prompts.ts";

/** The part of pi's Theme the transcript forms use. */
export interface TranscriptTheme {
  fg(color: UiFg | "customMessageLabel" | "customMessageText", text: string): string;
  bg(color: "customMessageBg", text: string): string;
}

/** Data of a `codex-goal-notice` entry; pause notices also carry the paused goal's facts. */
export interface NoticeData {
  text: string;
  at: string;
}

export interface PauseNoticeData extends NoticeData {
  event: "paused";
  goalId: string;
  revision: number;
  timeUsedSeconds: number;
}

/** Data of a `codex-goal-commit` entry. */
export interface CommitMetaData {
  sessionId: string;
  goalId: string | null;
  revision: number;
  tombstone?: true;
}

const PURPOSE_LABEL: Readonly<Record<Exclude<InstructionPurpose, "continuation">, string>> = {
  kickoff: "kickoff",
  objective_update: "objective update",
  resync: "resync",
  budget_wrapup: "budget wrap-up",
};

/** The text parts of a custom message's content, as pi's default renderer joins them. */
export function messageText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * `◎ goal · kickoff · active · “objective” · 24 lines ▸ ctrl+o`, or null when
 * the content does not start with a goal instruction tag. `expandKey` is
 * pi's expand binding; the hint is left out when nothing is bound.
 */
export function instructionSummary(theme: TranscriptTheme, content: string, expandKey: string): string | null {
  const header = parseInstructionHeader(content);
  if (header === null) return null;
  const look = GOAL_STATUS_LOOK[header.status];
  let kind: string;
  let objective = "";
  if (header.purpose === "continuation") {
    const index = parseExecutionIndex(content);
    kind = index === null ? "continuation" : `continuation ${index}`;
  } else {
    kind = PURPOSE_LABEL[header.purpose];
    const text = parseObjective(content);
    if (text !== null) objective = ` · “${oneLine(text)}”`;
  }
  const lines = content.split("\n").length;
  const expand = expandKey === "" ? "" : ` ▸ ${expandKey}`;
  return (
    theme.fg("customMessageLabel", `${look.glyph} goal`) +
    theme.fg("customMessageText", ` · ${kind} · `) +
    theme.fg(stateColor(look.state), header.status) +
    theme.fg("customMessageText", `${objective} · ${lines} lines${expand}`)
  );
}

export function isPauseNotice(data: NoticeData): data is PauseNoticeData {
  const candidate = data as Partial<PauseNoticeData>;
  return candidate.event === "paused" && typeof candidate.revision === "number" && typeof candidate.timeUsedSeconds === "number";
}

/** `◉ goal paused · rev 474 · 6s · /goal resume` */
export function pauseNoticeSummary(theme: TranscriptTheme, data: PauseNoticeData): string {
  const look = GOAL_STATUS_LOOK.paused;
  return (
    theme.fg(stateColor(look.state), `${look.glyph} goal paused`) +
    theme.fg("customMessageText", ` · rev ${data.revision} · ${formatDuration(data.timeUsedSeconds)} · /goal resume`)
  );
}

export function isCommitMeta(data: unknown): data is CommitMetaData {
  const candidate = data as Partial<CommitMetaData> | null;
  return candidate !== null && typeof candidate === "object" && typeof candidate.revision === "number";
}

/** `  · goal rev 2 committed` (dim), noting a clearing tombstone. */
export function commitSummary(theme: TranscriptTheme, data: CommitMetaData): string {
  return theme.fg("dim", `  · goal rev ${data.revision} committed${data.tombstone === true ? " · cleared" : ""}`);
}

/** One line on the custom-message background, inset by pi's output padding. */
export class BannerLine implements Component {
  private readonly theme: TranscriptTheme;
  private readonly line: string;
  private readonly padding: number;

  constructor(theme: TranscriptTheme, line: string, padding: number) {
    this.theme = theme;
    this.line = line;
    this.padding = padding;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const inset = " ".repeat(Math.max(0, Math.min(this.padding, width)));
    return [this.theme.bg("customMessageBg", fit(`${inset}${this.line}`, width))];
  }
}
