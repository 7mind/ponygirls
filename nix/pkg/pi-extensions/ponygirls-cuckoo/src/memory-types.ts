import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export const MEMORY_TYPE = 'cuckoo.memory';
export const MEMORY_VERSION = 1;
export const MAX_MEMORY_LABEL = 256;
export const MAX_MEMORY_TEXT = 4000;
export const MAX_MEMORY_SNAPSHOT = 100000;
export const MAX_MEMORY_REFS = 32;
export const MAX_MEMORY_PAGE = 20;
export const DEFAULT_MEMORY_PAGE = 10;
export const MAX_MEMORY_READ_CHARS = 6000;
export const DEFAULT_MEMORY_READ_CHARS = 4000;
export const MAX_MEMORY_RESPONSE_BYTES = 50000;

export type TaskId = string;
export type MemoryId = string;
export type TextDigest = `sha256-utf16le:${string}`;
export type MemoryScope = 'branch' | 'session';
export type SourceRole = 'user' | 'assistant' | 'toolResult';
export type RecordStatus = 'active' | 'superseded' | 'needs-recheck';

export interface SessionView {
  readonly sessionId: string;
  readonly entries: readonly SessionEntry[];
  readonly branch: readonly SessionEntry[];
}
export interface TextSelector {
  readonly entryId: string;
  readonly part: number;
  readonly start: number;
  readonly end: number;
}
export interface PublicSource {
  readonly selector: TextSelector;
  readonly role: SourceRole;
  readonly toolName: string | null;
  readonly timestamp: string;
  readonly digest: TextDigest;
}
export interface SourceText {
  readonly source: PublicSource;
  readonly text: string;
}
export type SourceResolution =
  | { readonly status: 'available'; readonly value: SourceText }
  | { readonly status: 'unavailable' | 'changed' | 'out-of-scope'; readonly reason: string };
export interface SourceSummary {
  readonly entryId: string;
  readonly role: SourceRole;
  readonly toolName: string | null;
  readonly timestamp: string;
  readonly branch: 'current' | 'other';
  readonly parts: readonly { readonly part: number; readonly chars: number }[];
}

export interface TaskRecord {
  readonly kind: 'task';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly label: string;
  readonly userEntryId: string;
}
export interface SnapshotRecord {
  readonly kind: 'snapshot';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly purpose: 'evidence' | 'artifact';
  readonly label: string;
  readonly source: PublicSource;
  readonly text: string;
  readonly digest: TextDigest;
  readonly dependsOn: readonly MemoryId[];
}
export interface ClaimRecord {
  readonly kind: 'claim';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly author: 'model';
  readonly category: 'observation' | 'interpretation' | 'decision' | 'assumption';
  readonly text: string;
  readonly evidenceIds: readonly MemoryId[];
  readonly dependsOn: readonly MemoryId[];
}
export interface CorrectionRecord {
  readonly kind: 'correction';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly author: 'model';
  readonly targetIds: readonly MemoryId[];
  readonly replacementIds: readonly MemoryId[];
  readonly evidenceIds: readonly MemoryId[];
  readonly reason: string;
}
export interface SnapshotBinding {
  readonly id: MemoryId;
  readonly digest: TextDigest;
}
export interface CheckerIdentity {
  readonly id: string;
  readonly version: string;
  readonly implementationDigest: string;
  readonly scope: string;
}
export interface CheckStartedRecord {
  readonly kind: 'check-start';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly toolCallId: string;
  readonly checker: CheckerIdentity;
  readonly artifact: SnapshotBinding;
  readonly evidence: readonly SnapshotBinding[];
  readonly startedAt: string;
}
export type CheckOutcome = 'pass' | 'fail' | 'inconclusive' | 'error' | 'cancelled' | 'timeout';
export interface CheckFinding {
  readonly code: string;
  readonly message: string;
  readonly evidenceIds: readonly MemoryId[];
}
export interface CheckFinishedRecord {
  readonly kind: 'check-result';
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly startId: MemoryId;
  readonly outcome: CheckOutcome;
  readonly findings: readonly CheckFinding[];
  readonly errorCode: string | null;
  readonly finishedAt: string;
}
export type MemoryRecord = TaskRecord | SnapshotRecord | ClaimRecord | CorrectionRecord | CheckStartedRecord | CheckFinishedRecord;
export interface MemoryEnvelope { readonly version: typeof MEMORY_VERSION; readonly record: MemoryRecord }
export interface StoredMemoryRecord {
  readonly entryId: string;
  readonly timestamp: string;
  readonly branch: 'current' | 'other';
  readonly record: MemoryRecord;
}
export interface RecordState {
  readonly id: MemoryId;
  readonly status: RecordStatus;
  readonly reasons: readonly string[];
  readonly supersededBy: readonly MemoryId[];
  readonly invalidatedBy: readonly MemoryId[];
}
export interface MemoryProjection {
  readonly records: readonly StoredMemoryRecord[];
  readonly states: readonly RecordState[];
}
export interface MemoryPort {
  view(): SessionView;
  append(record: MemoryRecord): StoredMemoryRecord;
}
export interface MemoryRuntime {
  readonly newId: () => MemoryId;
  readonly now: () => string;
}
