/**
 * The per-turn `decisions-context` message, collapsed to one line in the
 * transcript (ctrl+o shows pi's default full rendering). Only the displayed
 * form changes; the message content sent to the model is untouched.
 */

export const CONTEXT_TYPE = "decisions-context";

const QUESTION_LINE = /^(Q\d+) \[(pending|answered|dismissed)\] /;

export interface ContextSummary {
  pending: string[];
  resolved: number;
}

export function summarizeContext(content: string): ContextSummary {
  const summary: ContextSummary = { pending: [], resolved: 0 };
  for (const line of content.split("\n")) {
    const match = QUESTION_LINE.exec(line);
    if (!match) continue;
    if (match[2] === "pending") summary.pending.push(match[1]!);
    else summary.resolved += 1;
  }
  return summary;
}

/** Plain one-line text; the renderer styles its parts. */
export function contextLine(summary: ContextSummary): { lead: string; detail: string } {
  const recent = summary.resolved > 0 ? ` · ${summary.resolved} recently resolved` : "";
  const ids = summary.pending.length > 0 ? ` · ${summary.pending.join(" ")}` : "";
  return { lead: `? decisions · ${summary.pending.length} unanswered`, detail: `${ids}${recent} · context for the model ▸ ctrl+o` };
}
