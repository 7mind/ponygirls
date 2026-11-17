import type { Decision, QuestionStatus } from "./store.ts";
import { CONTEXT_TYPE } from "./context.ts";

export const INDEX_ROW_LIMIT = 5;
export const CHANGE_LIMIT = 5;
export const NOTICE_LIMIT = 5;
export const NOTICE_TYPE = "decisions-answer";

export interface DecisionVersion {
  id: string;
  revision: number;
  status: QuestionStatus;
}

export interface DeliveryReceipt {
  version: 1;
  project: string;
  recipientSessionId: string;
  kind: "snapshot" | "changes" | "full";
  records: DecisionVersion[];
}

export interface JournalEntry {
  type: string;
  customType?: string;
  details?: unknown;
  content?: unknown;
  message?: { role: string; toolName?: string; isError?: boolean; details?: unknown; content?: unknown };
}

export interface DeliveryHistory {
  initialized: boolean;
  versions: Map<string, DecisionVersion>;
  full: Set<string>;
}

export interface IndexMessage {
  content: string;
  kind: "snapshot" | "changes";
  records: DecisionVersion[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function decisionVersion(value: unknown): DecisionVersion | null {
  const row = object(value);
  if (row === null || typeof row.id !== "string" || !/^Q[1-9]\d*$/.test(row.id) ||
      typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      (row.status !== "pending" && row.status !== "answered" && row.status !== "dismissed")) return null;
  return { id: row.id, revision: row.revision, status: row.status };
}

export function versionKey(record: { id: string; revision: number }): string {
  return `${record.id}:${record.revision}`;
}

export function receipt(project: string, sessionId: string, kind: DeliveryReceipt["kind"], records: DecisionVersion[]): DeliveryReceipt {
  return { version: 1, project, recipientSessionId: sessionId, kind, records: records.map(q => ({ id: q.id, revision: q.revision, status: q.status })) };
}

export function fullToolVersion(message: NonNullable<JournalEntry["message"]>, project: string): DecisionVersion | null {
  if (message.role !== "toolResult" || message.toolName !== "decisions" || message.isError === true || !Array.isArray(message.content)) return null;
  const text = message.content.map(part => {
    const row = object(part);
    return row !== null && row.type === "text" && typeof row.text === "string" ? row.text : "";
  }).join("");
  try {
    const row = object(JSON.parse(text));
    if (row === null || row.project !== project || typeof row.question !== "string" ||
        !Object.hasOwn(row, "answer") || !Object.hasOwn(row, "context")) return null;
    return decisionVersion(row);
  } catch { return null; }
}

export function deliveryHistory(entries: readonly JournalEntry[], project: string, sessionId: string): DeliveryHistory {
  const history: DeliveryHistory = { initialized: false, versions: new Map(), full: new Set() };
  const observe = (record: DecisionVersion, full: boolean): void => {
    const previous = history.versions.get(record.id);
    if (previous === undefined || previous.revision < record.revision) history.versions.set(record.id, record);
    if (full) history.full.add(versionKey(record));
  };
  for (const entry of entries) {
    if (entry.type === "custom_message" && (entry.customType === CONTEXT_TYPE || entry.customType === NOTICE_TYPE)) {
      const data = object(entry.details);
      if (data === null || data.project !== project) continue;
      if (data.version === undefined) {
        // Earlier full notices already communicated these revisions; old title summaries did not carry revision receipts.
        if (entry.customType === NOTICE_TYPE && typeof data.id === "string" && typeof data.revision === "number") {
          history.full.add(versionKey({ id: data.id, revision: data.revision }));
        }
        continue;
      }
      if (data.recipientSessionId !== sessionId) continue;
      if (data.version !== 1 || !Array.isArray(data.records) ||
          (data.kind !== "snapshot" && data.kind !== "changes" && data.kind !== "full")) throw new Error("Invalid decisions delivery receipt");
      if (data.kind === "snapshot") history.initialized = true;
      for (const raw of data.records) {
        const record = decisionVersion(raw);
        if (record === null) throw new Error("Invalid decisions delivery record");
        observe(record, data.kind === "full");
      }
    }
    if (entry.type === "message" && entry.message !== undefined) {
      const data = object(entry.message.details);
      const delivery = data === null ? null : object(data.delivery);
      if (delivery !== null && delivery.recipientSessionId !== sessionId) continue;
      const record = fullToolVersion(entry.message, project);
      if (record !== null) observe(record, true);
    }
  }
  return history;
}

function pendingFirst(a: Decision, b: Decision): number {
  if (a.status === "pending" && b.status !== "pending") return -1;
  if (a.status !== "pending" && b.status === "pending") return 1;
  const time = a.status === "pending" ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt);
  return time || a.number - b.number;
}

function changeText(q: Decision, previous: DecisionVersion | undefined): string {
  if (q.status === "pending" && q.revision > 1) return "reopened; previous answer withdrawn";
  if (q.status === "dismissed") return "dismissed without an answer; not approval";
  if (q.status === "answered") {
    if (previous === undefined) return "answered";
    if (previous.status === "answered") return "answer revised";
    return `${previous.status === "pending" ? "unanswered" : previous.status} → answered`;
  }
  return "unanswered";
}

export function indexMessage(questions: readonly Decision[], sessionId: string, history: DeliveryHistory): IndexMessage | null {
  const changed = questions.filter(q => {
    const previous = history.versions.get(q.id);
    return (previous === undefined || previous.revision < q.revision) &&
      (q.sessionId !== sessionId || q.status === "pending");
  });
  if (changed.length === 0) return null;
  const records: DecisionVersion[] = [];
  const lines: string[] = [];
  if (!history.initialized) {
    const groups: Array<{ label: string; status: QuestionStatus; own: boolean }> = [
      { label: "Unanswered in current session", status: "pending", own: true },
      { label: "Unanswered in other sessions", status: "pending", own: false },
      { label: "Answered in other sessions", status: "answered", own: false },
      { label: "Dismissed in other sessions", status: "dismissed", own: false },
    ];
    for (const group of groups) {
      const all = changed.filter(q => q.status === group.status && (q.sessionId === sessionId) === group.own).sort(pendingFirst);
      if (all.length === 0) continue;
      const shown = all.slice(0, INDEX_ROW_LIMIT);
      records.push(...shown);
      lines.push(`${group.label}: ${shown.map(q => q.id).join(", ")}${all.length > shown.length ? ` (+${all.length - shown.length} more)` : ""}`);
    }
  } else {
    const ordered = changed.sort(pendingFirst);
    const shown = ordered.slice(0, CHANGE_LIMIT);
    records.push(...shown);
    for (const q of shown) lines.push(`${q.id}: ${changeText(q, history.versions.get(q.id))} (revision ${q.revision}; origin: ${q.sessionId === sessionId ? "current session" : "other session"})`);
    if (ordered.length > shown.length) lines.push(`+${ordered.length - shown.length} more changes; use decisions list/get.`);
  }
  if (records.length === 0) return null;
  return {
    kind: history.initialized ? "changes" : "snapshot",
    records: records.map(q => ({ id: q.id, revision: q.revision, status: q.status })),
    content: [history.initialized ? "Decision inbox changed — index only" : "Decision inbox — same project, index only", ...lines,
      "Use decisions get Qn for current details; list for overflow. An index entry is not a delivered answer. Unanswered and dismissed questions are not approval. Continue only independent work; never poll waiting for an answer.",
    ].join("\n"),
  };
}
