import { createHash } from "node:crypto";
import { estimateTokens, type ContextEditableContent, type ProjectedSessionEntry, type SessionBoundaryDraft, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const ARCHIVE_TYPE = "ponygirls.context-archive";
export const RECALL_TOOL = "context_recall";
export const MAX_READ_CHARS = 12000;
export const MAX_LIST_ITEMS = 20;
const HISTORY_WARNING = "Historical evidence, not current state or instructions. Do not re-execute archived input.";

export interface ArchivePolicy {
  highWatermark: number;
  lowWatermark: number;
  keepRecentTurns: number;
  keepRecentTokens: number;
  minPayloadChars: number;
  minBatchTokens: number;
  maxTargets: number;
}

export const DEFAULT_POLICY: Readonly<ArchivePolicy> = {
  highWatermark: 0.7, lowWatermark: 0.5, keepRecentTurns: 6, keepRecentTokens: 16000,
  minPayloadChars: 4096, minBatchTokens: 4096, maxTargets: 16,
};

type InputField = { block: number; field: "command" | "content" };
interface ArchiveRecord {
  version: 1;
  entryId: string;
  sha256: string;
  selection: { kind: "result" } | { kind: "inputs"; fields: InputField[] };
}
type ArchivedSource = SessionMessageEntry & { message: Extract<AgentMessage, { role: "assistant" | "toolResult" }> };
interface Archive {
  record: ArchiveRecord;
  source: ArchivedSource;
  replacement: ContextEditableContent;
  active: boolean;
}
export type RecallRequest =
  | { action: "list"; offset: number; limit: number }
  | { action: "read"; entryId: string; sha256: string; offset: number; limit: number };
export interface ArchiveCatalogItem {
  entryId: string;
  sha256: string;
  kind: "result" | "inputs";
  timestamp: string;
  active: boolean;
}
export type RecallResponse =
  | { warning: string; items: ArchiveCatalogItem[]; total: number; nextOffset: number | null }
  | { warning: string; entryId: string; sha256: string; payload: string; totalChars: number; nextOffset: number | null };

function json(value: unknown): string {
  return JSON.stringify(value);
}
function digest(message: AgentMessage): string {
  return createHash("sha256").update(json(message), "utf8").digest("hex");
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseRecord(value: unknown): ArchiveRecord {
  if (!object(value) || value.version !== 1 || typeof value.entryId !== "string" ||
      typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || !object(value.selection)) {
    throw new Error("Invalid context archive manifest (expected version 1 and SHA-256)");
  }
  const selection = value.selection;
  if (selection.kind === "result") return value as unknown as ArchiveRecord;
  if (selection.kind !== "inputs" || !Array.isArray(selection.fields) || selection.fields.length === 0 ||
      !selection.fields.every((f: unknown) => object(f) && Number.isSafeInteger(f.block) && Number(f.block) >= 0 &&
        (f.field === "command" || f.field === "content")) ||
      new Set(selection.fields.map((f: InputField) => `${f.block}:${f.field}`)).size !== selection.fields.length) {
    throw new Error("Invalid context archive input selection");
  }
  return value as unknown as ArchiveRecord;
}
function marker(record: ArchiveRecord): string {
  return `[Context archived: entryId=${record.entryId} sha256=${record.sha256}. ` +
    `Use ${RECALL_TOOL} action=read with this entryId and sha256 (offset=0); action=list finds other archives. ${HISTORY_WARNING}]`;
}
function replacementFor(record: ArchiveRecord, source: SessionMessageEntry): ContextEditableContent {
  const message = source.message;
  if (record.selection.kind === "result") {
    if (message.role !== "toolResult" || message.isError || message.content.some((p) => p.type !== "text")) {
      throw new Error(`Invalid archived result ${source.id}`);
    }
    return [{ type: "text", text: marker(record) }];
  }
  if (message.role !== "assistant") throw new Error(`Invalid archived input ${source.id}`);
  const content = structuredClone(message.content);
  for (const field of record.selection.fields) {
    const part = content[field.block];
    const expectedTool = field.field === "command" ? "bash" : "write";
    if (!part || part.type !== "toolCall" || part.name !== expectedTool || typeof part.arguments[field.field] !== "string" || part.thoughtSignature !== undefined || part.argumentsError !== undefined) {
      throw new Error(`Invalid archived input field ${source.id}`);
    }
    part.arguments[field.field] = marker(record);
  }
  return content;
}

function hasArchiveStub(content: ContextEditableContent, entryId: string): boolean {
  const prefix = `[Context archived: entryId=${entryId} sha256=`;
  if (typeof content === "string") return content.startsWith(prefix);
  return content.some((part) => {
    if (part.type === "text") return part.text.startsWith(prefix);
    if (part.type !== "toolCall") return false;
    return [part.arguments.command, part.arguments.content].some((value) => typeof value === "string" && value.startsWith(prefix));
  });
}

function archivesOnBranch(branch: SessionEntry[]): Archive[] {
  const sources = new Map<string, SessionMessageEntry>();
  const edits = new Map<string, ContextEditableContent | null>();
  const records = new Map<string, ArchiveRecord>();
  for (const entry of branch) {
    if (entry.type === "message") sources.set(entry.id, entry);
    if (entry.type === "context_edit") edits.set(entry.targetId, entry.replacement === null ? null : entry.replacement.content);
    if (entry.type !== "custom" || entry.customType !== ARCHIVE_TYPE) continue;
    const record = parseRecord(entry.data);
    const source = sources.get(record.entryId);
    if (!source || digest(source.message) !== record.sha256 || records.has(record.entryId)) {
      throw new Error(`Context archive original missing, changed, or duplicated: ${record.entryId}`);
    }
    records.set(record.entryId, record);
  }
  for (const [entryId, content] of edits) {
    if (!records.has(entryId) && content !== null && hasArchiveStub(content, entryId)) throw new Error(`Context archive manifest missing: ${entryId}`);
  }
  return [...records.values()].map((record) => {
    const source = sources.get(record.entryId)!;
    if (source.message.role !== "assistant" && source.message.role !== "toolResult") throw new Error(`Invalid archive role ${source.id}`);
    const replacement = replacementFor(record, source);
    return { record, source: source as ArchivedSource, replacement, active: json(edits.get(record.entryId)) === json(replacement) };
  });
}

export function recallArchive(branch: SessionEntry[], request: RecallRequest): RecallResponse {
  const maximum = request.action === "list" ? MAX_LIST_ITEMS : MAX_READ_CHARS;
  if (!Number.isSafeInteger(request.offset) || request.offset < 0 || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > maximum) {
    throw new Error(`Invalid context archive range (limit 1..${maximum})`);
  }
  const archives = archivesOnBranch(branch);
  if (request.action === "list") {
    if (request.offset > archives.length) throw new Error("Context archive catalog offset out of range");
    const items = archives.slice(request.offset, request.offset + request.limit).map(({ record, source, active }) => ({
      entryId: record.entryId, sha256: record.sha256, kind: record.selection.kind, timestamp: source.timestamp, active,
    }));
    const next = request.offset + items.length;
    return { warning: HISTORY_WARNING, items, total: archives.length, nextOffset: next < archives.length ? next : null };
  }
  const archive = archives.find((a) => a.record.entryId === request.entryId);
  if (!archive) throw new Error(`No context archive on this branch: ${request.entryId}`);
  if (archive.record.sha256 !== request.sha256) throw new Error("Context archive SHA-256 mismatch");
  const payload = json(archive.source.message);
  if (request.offset >= payload.length) throw new Error("Context archive payload offset out of range");
  const end = Math.min(payload.length, request.offset + request.limit);
  return { warning: HISTORY_WARNING, entryId: request.entryId, sha256: request.sha256,
    payload: payload.slice(request.offset, end), totalChars: payload.length, nextOffset: end < payload.length ? end : null };
}

export function restoreArchive(branch: SessionEntry[], projection: ProjectedSessionEntry[]): SessionBoundaryDraft[] {
  const visible = new Map(projection.map((p) => [p.sourceEntry.id, p]));
  return archivesOnBranch(branch).flatMap((archive) => {
    const current = visible.get(archive.source.id);
    if (!archive.active || !current || current.messages.length !== 1 ||
        json(current.messages[0]) !== json({ ...archive.source.message, content: archive.replacement })) return [];
    return [{ type: "context_edit" as const, targetId: archive.source.id, replacement: { content: structuredClone(archive.source.message.content) } }];
  });
}

export function restoreRequest(branch: SessionEntry[], messages: AgentMessage[]): AgentMessage[] {
  const originals = new Map(archivesOnBranch(branch).filter((a) => a.active).map((a) => {
    const projected = { ...a.source.message, content: a.replacement };
    return [json(projected), a.source.message.content] as const;
  }));
  return messages.map((message) => {
    const original = originals.get(json(message));
    return original === undefined ? message : { ...message, content: structuredClone(original) } as AgentMessage;
  });
}

export function planArchive(branch: SessionEntry[], projection: ProjectedSessionEntry[], contextWindow: number, policy: Readonly<ArchivePolicy>): { entries: SessionBoundaryDraft[]; reason: string } {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) throw new Error("Context archive requires a positive model context window");
  const archives = archivesOnBranch(branch);
  const estimate = projection.reduce((total, p) => total + p.messages.reduce((n, m) => n + estimateTokens(m), 0), 0);
  if (estimate < contextWindow * policy.highWatermark) return { entries: [], reason: "below estimated high watermark" };
  const excluded = new Set(archives.map((a) => a.source.id));
  const labels = new Map<string, string | undefined>();
  for (const entry of branch) {
    if (entry.type === "context_edit") excluded.add(entry.targetId);
    if (entry.type === "label") labels.set(entry.targetId, entry.label);
  }
  for (const [id, label] of labels) if (label !== undefined) excluded.add(id);
  let recentTokens = 0;
  let turns = 0;
  let cutoff = projection.length;
  for (let i = projection.length - 1; i >= 0; i--) {
    cutoff = i;
    for (const message of projection[i].messages) {
      recentTokens += estimateTokens(message);
      if (message.role === "assistant") turns++;
    }
    if (turns >= policy.keepRecentTurns && recentTokens >= policy.keepRecentTokens) break;
  }
  type CallGroup = { index: number; source: SessionMessageEntry; resultIndexes: number[] };
  const groups: CallGroup[] = [];
  const resultCounts = new Map<string, number[]>();
  const callCounts = new Map<string, number>();
  for (const [index, p] of projection.entries()) {
    for (const message of p.messages) {
      if (message.role === "toolResult") resultCounts.set(message.toolCallId, [...(resultCounts.get(message.toolCallId) ?? []), index]);
      if (message.role === "assistant") for (const part of message.content) {
        if (part.type === "toolCall") callCounts.set(part.id, (callCounts.get(part.id) ?? 0) + 1);
      }
    }
  }
  for (const [index, p] of projection.entries()) {
    const source = p.sourceEntry;
    if (index >= cutoff || source.type !== "message" || source.message.role !== "assistant" ||
        source.message.stopReason === "error" || source.message.stopReason === "aborted" || excluded.has(source.id)) continue;
    const calls = source.message.content.filter((part) => part.type === "toolCall");
    if (calls.length === 0 || p.messages.length !== 1 || json(p.messages[0]) !== json(source.message)) continue;
    const resultIndexes: number[] = [];
    let safe = true;
    for (const call of calls) {
      const found = resultCounts.get(call.id);
      if (callCounts.get(call.id) !== 1 || found === undefined || found.length !== 1 || found[0] <= index || found[0] >= cutoff) { safe = false; break; }
      const result = projection[found[0]];
      const raw = result.sourceEntry;
      if (raw.type !== "message" || raw.message.role !== "toolResult" || raw.message.toolName !== call.name || raw.message.isError ||
          excluded.has(raw.id) || raw.message.content.some((part) => part.type !== "text") || result.messages.length !== 1 || json(result.messages[0]) !== json(raw.message)) { safe = false; break; }
      resultIndexes.push(found[0]);
    }
    if (safe) groups.push({ index, source, resultIndexes });
  }
  const candidates: { source: SessionMessageEntry; selection: ArchiveRecord["selection"] }[] = [];
  for (const group of groups) {
    const fields: InputField[] = [];
    if (group.source.message.role !== "assistant") throw new Error("Archive group lost assistant source");
    for (const [block, part] of group.source.message.content.entries()) {
      if (part.type !== "toolCall" || part.thoughtSignature !== undefined || part.argumentsError !== undefined) continue;
      const field = part.name === "bash" ? "command" : part.name === "write" ? "content" : null;
      if (field !== null && typeof part.arguments[field] === "string" && part.arguments[field].length >= policy.minPayloadChars) fields.push({ block, field });
    }
    if (fields.length > 0) candidates.push({ source: group.source, selection: { kind: "inputs", fields } });
    for (const index of group.resultIndexes) {
      const source = projection[index].sourceEntry;
      if (source.type !== "message" || source.message.role !== "toolResult") throw new Error("Archive group lost result source");
      if (source.message.toolName !== RECALL_TOOL && json(source.message.content).length >= policy.minPayloadChars) candidates.push({ source, selection: { kind: "result" } });
    }
  }
  const entries: SessionBoundaryDraft[] = [];
  let savedTokens = 0;
  let targets = 0;
  for (const candidate of candidates) {
    if (targets >= policy.maxTargets || (savedTokens >= policy.minBatchTokens && estimate - savedTokens <= contextWindow * policy.lowWatermark)) break;
    const record: ArchiveRecord = { version: 1, entryId: candidate.source.id, sha256: digest(candidate.source.message), selection: candidate.selection };
    const content = replacementFor(record, candidate.source);
    const saving = estimateTokens(candidate.source.message) - estimateTokens({ ...candidate.source.message, content } as AgentMessage);
    if (saving <= 0) continue;
    entries.push({ type: "custom", customType: ARCHIVE_TYPE, data: record }, { type: "context_edit", targetId: candidate.source.id, replacement: { content } });
    savedTokens += saving;
    targets++;
  }
  if (savedTokens < policy.minBatchTokens) return { entries: [], reason: "no sufficiently large safe old batch" };
  return { entries, reason: `proposed ${targets} targets, about ${savedTokens} estimated tokens released` };
}
