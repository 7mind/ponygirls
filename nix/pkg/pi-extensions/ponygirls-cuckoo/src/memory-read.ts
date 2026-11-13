import {
  readMemory,
  listSources,
  readPublicSource,
  resolveSource,
} from './memory-core.ts';
import { projectStates, type SnapshotSourceState } from './memory-projection.ts';
import {
  MEMORY_VERSION,
  DEFAULT_MEMORY_PAGE,
  MAX_MEMORY_PAGE,
  DEFAULT_MEMORY_READ_CHARS,
  MAX_MEMORY_READ_CHARS,
  MAX_MEMORY_RESPONSE_BYTES,
} from './memory-types.ts';
import type {
  SessionView,
  MemoryScope,
  MemoryId,
  TaskId,
  TextSelector,
  TextDigest,
  RecordStatus,
  MemoryRecord,
  SourceSummary,
  StoredMemoryRecord,
  PublicSource,
  SourceText,
  SourceResolution,
  RecordState,
  ClaimRecord,
  CheckerIdentity,
  SnapshotBinding,
  CheckFinding,
  CheckOutcome,
} from './memory-types.ts';

export const READER_VERSION = 1;

const RECORD_KINDS: readonly MemoryRecord['kind'][] = Object.freeze([
  'task', 'snapshot', 'claim', 'correction', 'check-start', 'check-result',
]);
const STATUS_NAMES: readonly RecordStatus[] = Object.freeze(['active', 'superseded', 'needs-recheck']);
const SCOPE_NAMES: readonly MemoryScope[] = Object.freeze(['branch', 'session']);
const MAX_READER_ID_CHARS = 128;

/** The subset of core (A) and projection (B) surfaces this reader depends on. */
export interface MemoryReaderApis {
  readonly readMemory: (view: SessionView, scope: MemoryScope) => readonly StoredMemoryRecord[];
  readonly listSources: (view: SessionView, scope: MemoryScope) => readonly SourceSummary[];
  readonly readPublicSource: (view: SessionView, selector: TextSelector, scope: MemoryScope) => SourceText;
  readonly resolveSource: (view: SessionView, source: PublicSource, scope: MemoryScope) => SourceResolution;
  readonly projectStates: (records: readonly StoredMemoryRecord[], sources: readonly SnapshotSourceState[]) => readonly RecordState[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface MetadataRequest {
  readonly kind: 'metadata';
}

export interface ListRecordsRequest {
  readonly kind: 'list-records';
  readonly scope?: MemoryScope;
  readonly taskId?: TaskId;
  readonly recordKind?: MemoryRecord['kind'];
  readonly status?: RecordStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface InspectRequest {
  readonly kind: 'inspect';
  readonly id: MemoryId;
  readonly scope?: MemoryScope;
}

export interface SnapshotTextRequest {
  readonly kind: 'snapshot-text';
  readonly id: MemoryId;
  readonly scope?: MemoryScope;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ListSourcesRequest {
  readonly kind: 'list-sources';
  readonly scope?: MemoryScope;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SourceTextRequest {
  readonly kind: 'source-text';
  readonly selector: TextSelector;
  readonly scope?: MemoryScope;
  readonly offset?: number;
  readonly limit?: number;
}

export type MemoryReadRequest =
  | MetadataRequest
  | ListRecordsRequest
  | InspectRequest
  | SnapshotTextRequest
  | ListSourcesRequest
  | SourceTextRequest;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface RecordLimitsRead {
  readonly list: { readonly default: number; readonly max: number };
  readonly chars: { readonly default: number; readonly max: number };
  readonly responseBytes: number;
}

export interface MetadataResult {
  readonly kind: 'metadata';
  readonly version: typeof READER_VERSION;
  readonly memoryVersion: typeof MEMORY_VERSION;
  readonly recordKinds: readonly MemoryRecord['kind'][];
  readonly statuses: readonly RecordStatus[];
  readonly scopes: readonly MemoryScope[];
  readonly limits: RecordLimitsRead;
}

export interface ListedRecord {
  readonly entryId: string;
  readonly id: MemoryId;
  readonly kind: MemoryRecord['kind'];
  readonly taskId: TaskId;
  readonly branch: 'current' | 'other';
  readonly label: string | null;
  readonly status: RecordStatus | null;
}

export interface ListRecordsResult {
  readonly kind: 'list-records';
  readonly scope: MemoryScope;
  readonly total: number;
  readonly records: readonly ListedRecord[];
  readonly nextCursor: string | null;
}

export interface SnapshotTextAction {
  readonly action: 'snapshot-text';
  readonly id: MemoryId;
  readonly scope: MemoryScope;
}

interface InspectBase {
  readonly kind: 'inspect';
  readonly entryId: string;
  readonly id: MemoryId;
  readonly taskId: TaskId;
  readonly branch: 'current' | 'other';
  readonly status: RecordStatus | null;
  readonly supersededBy: readonly MemoryId[];
  readonly invalidatedBy: readonly MemoryId[];
  readonly timestamp: string;
}

export type InspectResult =
  | (InspectBase & {
      readonly recordKind: 'task';
      readonly label: string;
      readonly userEntryId: string;
    })
  | (InspectBase & {
      readonly recordKind: 'snapshot';
      readonly purpose: 'evidence' | 'artifact';
      readonly label: string;
      readonly digest: TextDigest;
      readonly textLength: number;
      readonly textOmitted: true;
      readonly textAction: SnapshotTextAction;
      readonly source: PublicSource;
      readonly dependsOn: readonly MemoryId[];
    })
  | (InspectBase & {
      readonly recordKind: 'claim';
      readonly author: 'model';
      readonly category: ClaimRecord['category'];
      readonly text: string;
      readonly evidenceIds: readonly MemoryId[];
      readonly dependsOn: readonly MemoryId[];
    })
  | (InspectBase & {
      readonly recordKind: 'correction';
      readonly author: 'model';
      readonly targetIds: readonly MemoryId[];
      readonly replacementIds: readonly MemoryId[];
      readonly evidenceIds: readonly MemoryId[];
      readonly reason: string;
    })
  | (InspectBase & {
      readonly recordKind: 'check-start';
      readonly toolCallId: string;
      readonly checker: CheckerIdentity;
      readonly artifact: SnapshotBinding;
      readonly evidence: readonly SnapshotBinding[];
      readonly startedAt: string;
    })
  | (InspectBase & {
      readonly recordKind: 'check-result';
      readonly startId: MemoryId;
      readonly outcome: CheckOutcome;
      readonly findings: readonly CheckFinding[];
      readonly errorCode: string | null;
      readonly finishedAt: string;
    });

export interface SnapshotTextResult {
  readonly kind: 'snapshot-text';
  readonly branch: 'current' | 'other';
  readonly id: MemoryId;
  readonly format: 'text';
  readonly offset: number;
  readonly total: number;
  readonly nextOffset: number | null;
  readonly digest: TextDigest;
  readonly text: string;
}

export interface ListSourcesResult {
  readonly kind: 'list-sources';
  readonly scope: MemoryScope;
  readonly total: number;
  readonly sources: readonly SourceSummary[];
  readonly nextCursor: string | null;
}

export interface SourceTextResult {
  readonly kind: 'source-text';
  readonly source: PublicSource;
  readonly branch: 'current' | 'other';
  readonly offset: number;
  readonly total: number;
  readonly nextOffset: number | null;
  readonly text: string;
}

export type MemoryReadResult =
  | MetadataResult
  | ListRecordsResult
  | InspectResult
  | SnapshotTextResult
  | ListSourcesResult
  | SourceTextResult;

// ---------------------------------------------------------------------------
// Request validation (strict: unknown fields, types, and limits are errors)
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnly(request: Record<string, unknown>, kind: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(request)) {
    if (!allowedSet.has(key)) throw new Error(`Unknown field '${key}' in ${kind} request`);
  }
}

function assertOptionalScope(request: Record<string, unknown>, kind: string): void {
  const value = request.scope;
  if (value !== undefined && value !== 'branch' && value !== 'session') {
    throw new Error(`${kind} scope must be 'branch' or 'session'`);
  }
}

function assertOptionalString(request: Record<string, unknown>, key: string, kind: string): void {
  const value = request[key];
  if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > MAX_READER_ID_CHARS)) {
    throw new Error(`${kind} ${key} must be a nonempty string of at most ${MAX_READER_ID_CHARS} UTF-16 code units`);
  }
}

function assertRequiredString(request: Record<string, unknown>, key: string, kind: string): void {
  const value = request[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_READER_ID_CHARS) {
    throw new Error(`${kind} ${key} must be a nonempty string of at most ${MAX_READER_ID_CHARS} UTF-16 code units`);
  }
}

function assertOptionalRecordKind(request: Record<string, unknown>, kind: string): void {
  const value = request.recordKind;
  if (value !== undefined && !RECORD_KINDS.includes(value as MemoryRecord['kind'])) {
    throw new Error(`${kind} recordKind must be one of ${RECORD_KINDS.join(', ')}`);
  }
}

function assertOptionalStatus(request: Record<string, unknown>, kind: string): void {
  const value = request.status;
  if (value !== undefined && !STATUS_NAMES.includes(value as RecordStatus)) {
    throw new Error(`${kind} status must be one of ${STATUS_NAMES.join(', ')}`);
  }
}

function assertOptionalLimit(request: Record<string, unknown>, kind: string, max: number): void {
  const value = request.limit;
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max)) {
    throw new Error(`${kind} limit must be an integer from 1 to ${max}`);
  }
}

function assertOptionalOffset(request: Record<string, unknown>, kind: string): void {
  const value = request.offset;
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new Error(`${kind} offset must be a non-negative integer`);
  }
}

function assertSelector(selector: unknown, kind: string): TextSelector {
  if (typeof selector !== 'object' || selector === null || Array.isArray(selector)) {
    throw new Error(`${kind} selector must be an object`);
  }
  const value = selector as Record<string, unknown>;
  assertOnly(value, `${kind} selector`, ['entryId', 'part', 'start', 'end']);
  if (typeof value.entryId !== 'string' || value.entryId.length === 0 || value.entryId.length > MAX_READER_ID_CHARS) {
    throw new Error(`${kind} selector.entryId must be a nonempty string of at most ${MAX_READER_ID_CHARS} UTF-16 code units`);
  }
  if (!Number.isSafeInteger(value.part) || (value.part as number) < 0) {
    throw new Error(`${kind} selector.part must be a non-negative integer`);
  }
  if (!Number.isSafeInteger(value.start) || (value.start as number) < 0) {
    throw new Error(`${kind} selector.start must be a non-negative integer`);
  }
  if (!Number.isSafeInteger(value.end) || (value.end as number) < 0) {
    throw new Error(`${kind} selector.end must be a non-negative integer`);
  }
  if ((value.start as number) > (value.end as number)) {
    throw new Error(`${kind} selector.start must not exceed selector.end`);
  }
  return {
    entryId: value.entryId,
    part: value.part as number,
    start: value.start as number,
    end: value.end as number,
  };
}

function validateRequest(request: unknown): MemoryReadRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new Error('Memory read request must be an object');
  }
  const value = request as Record<string, unknown>;
  if (typeof value.kind !== 'string' || value.kind.length === 0) {
    throw new Error('Memory read request kind must be a nonempty string');
  }
  const kind = value.kind;
  switch (kind) {
    case 'metadata':
      assertOnly(value, 'metadata', ['kind']);
      return { kind: 'metadata' };
    case 'list-records':
      assertOnly(value, 'list-records', ['kind', 'scope', 'taskId', 'recordKind', 'status', 'limit', 'cursor']);
      assertOptionalScope(value, 'list-records');
      assertOptionalString(value, 'taskId', 'list-records');
      assertOptionalRecordKind(value, 'list-records');
      assertOptionalStatus(value, 'list-records');
      assertOptionalLimit(value, 'list-records', MAX_MEMORY_PAGE);
      assertOptionalString(value, 'cursor', 'list-records');
      return value as unknown as ListRecordsRequest;
    case 'inspect':
      assertOnly(value, 'inspect', ['kind', 'id', 'scope']);
      assertRequiredString(value, 'id', 'inspect');
      assertOptionalScope(value, 'inspect');
      return value as unknown as InspectRequest;
    case 'snapshot-text':
      assertOnly(value, 'snapshot-text', ['kind', 'id', 'scope', 'offset', 'limit']);
      assertRequiredString(value, 'id', 'snapshot-text');
      assertOptionalScope(value, 'snapshot-text');
      assertOptionalOffset(value, 'snapshot-text');
      assertOptionalLimit(value, 'snapshot-text', MAX_MEMORY_READ_CHARS);
      return value as unknown as SnapshotTextRequest;
    case 'list-sources':
      assertOnly(value, 'list-sources', ['kind', 'scope', 'limit', 'cursor']);
      assertOptionalScope(value, 'list-sources');
      assertOptionalLimit(value, 'list-sources', MAX_MEMORY_PAGE);
      assertOptionalString(value, 'cursor', 'list-sources');
      return value as unknown as ListSourcesRequest;
    case 'source-text':
      assertOnly(value, 'source-text', ['kind', 'selector', 'scope', 'offset', 'limit']);
      assertOptionalScope(value, 'source-text');
      assertOptionalOffset(value, 'source-text');
      assertOptionalLimit(value, 'source-text', MAX_MEMORY_READ_CHARS);
      assertSelector(value.selector, 'source-text');
      return value as unknown as SourceTextRequest;
    default:
      throw new Error(`Unknown memory read request kind '${kind}'`);
  }
}

// ---------------------------------------------------------------------------
// UTF-8 byte length (used for the hard response-size bound)
// ---------------------------------------------------------------------------

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3; // lone high surrogate encodes as U+FFFD (3 bytes)
    } else bytes += 3;
  }
  return bytes;
}

function bounded(result: MemoryReadResult): MemoryReadResult {
  const bytes = utf8ByteLength(JSON.stringify(result));
  if (bytes > MAX_MEMORY_RESPONSE_BYTES) {
    throw new Error(`Memory read response exceeds ${MAX_MEMORY_RESPONSE_BYTES} UTF-8 bytes; no partial result returned`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reader runtime
// ---------------------------------------------------------------------------

function nativeOrder(view: SessionView): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  view.entries.forEach((entry, index) => {
    const id = entry.id;
    if (typeof id === 'string' && id.length > 0 && !order.has(id)) order.set(id, index);
  });
  return order;
}

function orderByEntry<T extends { readonly entryId: string }>(
  items: readonly T[],
  view: SessionView,
): readonly T[] {
  const order = nativeOrder(view);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = order.get(a.item.entryId);
      const bo = order.get(b.item.entryId);
      if (ao !== undefined && bo !== undefined) return ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.index - b.index;
    })
    .map(indexed => indexed.item);
}

function selectPage<T extends { readonly entryId: string }>(
  ordered: readonly T[],
  cursor: string | undefined,
  limit: number,
  matches: (item: T) => boolean,
): { readonly total: number; readonly page: readonly T[]; readonly nextCursor: string | null } {
  const total = ordered.filter(matches).length;
  let start = 0;
  if (cursor !== undefined) {
    const index = ordered.findIndex(item => item.entryId === cursor);
    if (index < 0) throw new Error(`Cursor not found in the selected scope: ${cursor}; list again without a cursor`);
    start = index + 1;
  }
  const page: T[] = [];
  let lastIndex = -1;
  for (let i = start; i < ordered.length && page.length < limit; i++) {
    if (matches(ordered[i])) { page.push(ordered[i]); lastIndex = i; }
  }
  let nextCursor: string | null = null;
  if (page.length > 0) {
    for (let i = lastIndex + 1; i < ordered.length; i++) {
      if (matches(ordered[i])) { nextCursor = page[page.length - 1].entryId; break; }
    }
  }
  return { total, page, nextCursor };
}

interface ReaderContext {
  readonly selected: readonly StoredMemoryRecord[];
  readonly current: readonly StoredMemoryRecord[];
  readonly stateById: ReadonlyMap<MemoryId, RecordState>;
  readonly currentBranchIds: ReadonlySet<string>;
}

function buildContext(apis: MemoryReaderApis, view: SessionView, scope: MemoryScope): ReaderContext {
  const selected = apis.readMemory(view, scope);
  const current = scope === 'branch' ? selected : apis.readMemory(view, 'branch');
  const sourceStates: SnapshotSourceState[] = [];
  for (const record of current) {
    if (record.record.kind === 'snapshot') {
      const resolution = apis.resolveSource(view, record.record.source, 'branch');
      sourceStates.push({ id: record.record.id, status: resolution.status });
    }
  }
  const states = apis.projectStates(current, sourceStates);
  const stateById = new Map<MemoryId, RecordState>();
  for (const state of states) stateById.set(state.id, state);
  const currentBranchIds = new Set<string>();
  view.branch.forEach(entry => {
    const id = entry.id;
    if (typeof id === 'string' && id.length > 0) currentBranchIds.add(id);
  });
  return { selected, current, stateById, currentBranchIds };
}

function stateInfo(
  ctx: ReaderContext,
  stored: StoredMemoryRecord,
): { readonly status: RecordStatus | null; readonly supersededBy: readonly MemoryId[]; readonly invalidatedBy: readonly MemoryId[] } {
  if (stored.branch !== 'current') return { status: null, supersededBy: [], invalidatedBy: [] };
  const state = ctx.stateById.get(stored.record.id);
  if (state === undefined) throw new Error(`Missing projected state for current-branch record ${stored.record.id}`);
  return { status: state.status, supersededBy: state.supersededBy, invalidatedBy: state.invalidatedBy };
}

function listLabel(record: MemoryRecord): string | null {
  if (record.kind === 'task' || record.kind === 'snapshot') return record.label;
  return null;
}

function findRecord(ctx: ReaderContext, id: MemoryId): StoredMemoryRecord {
  const stored = ctx.selected.find(record => record.record.id === id);
  if (stored === undefined) throw new Error(`Record not found: ${id}`);
  return stored;
}

// ---------------------------------------------------------------------------
// Query entry points
// ---------------------------------------------------------------------------

export function queryMemoryWith(
  apis: MemoryReaderApis,
  view: SessionView,
  request: MemoryReadRequest,
): MemoryReadResult {
  const validated = validateRequest(request);
  const kind = validated.kind;
  if (kind === 'metadata') {
    return bounded({
      kind: 'metadata',
      version: READER_VERSION,
      memoryVersion: MEMORY_VERSION,
      recordKinds: RECORD_KINDS,
      statuses: STATUS_NAMES,
      scopes: SCOPE_NAMES,
      limits: {
        list: { default: DEFAULT_MEMORY_PAGE, max: MAX_MEMORY_PAGE },
        chars: { default: DEFAULT_MEMORY_READ_CHARS, max: MAX_MEMORY_READ_CHARS },
        responseBytes: MAX_MEMORY_RESPONSE_BYTES,
      },
    });
  }
  const selectedScope = validated.scope ?? 'branch';
  const ctx = buildContext(apis, view, selectedScope);

  if (kind === 'list-records') {
    const scope = validated.scope ?? 'branch';
    const limit = validated.limit ?? DEFAULT_MEMORY_PAGE;
    const ordered = orderByEntry(ctx.selected, view);
    const matches = (stored: StoredMemoryRecord): boolean => {
      if (validated.taskId !== undefined && stored.record.taskId !== validated.taskId) return false;
      if (validated.recordKind !== undefined && stored.record.kind !== validated.recordKind) return false;
      if (validated.status !== undefined) {
        if (stored.branch !== 'current') return false;
        const state = ctx.stateById.get(stored.record.id);
        if (state === undefined || state.status !== validated.status) return false;
      }
      return true;
    };
    const { total, page, nextCursor } = selectPage(ordered, validated.cursor, limit, matches);
    return bounded({
      kind: 'list-records',
      scope,
      total,
      records: page.map(stored => {
        const info = stateInfo(ctx, stored);
        return {
          entryId: stored.entryId,
          id: stored.record.id,
          kind: stored.record.kind,
          taskId: stored.record.taskId,
          branch: stored.branch,
          label: listLabel(stored.record),
          status: info.status,
        };
      }),
      nextCursor,
    });
  }

  if (kind === 'inspect') {
    const stored = findRecord(ctx, validated.id);
    const info = stateInfo(ctx, stored);
    const base: InspectBase = {
      kind: 'inspect',
      entryId: stored.entryId,
      id: stored.record.id,
      taskId: stored.record.taskId,
      branch: stored.branch,
      status: info.status,
      supersededBy: info.supersededBy,
      invalidatedBy: info.invalidatedBy,
      timestamp: stored.timestamp,
    };
    const record = stored.record;
    let result: InspectResult;
    switch (record.kind) {
      case 'task':
        result = { ...base, recordKind: 'task', label: record.label, userEntryId: record.userEntryId };
        break;
      case 'snapshot':
        result = {
          ...base,
          recordKind: 'snapshot',
          purpose: record.purpose,
          label: record.label,
          digest: record.digest,
          textLength: record.text.length,
          textOmitted: true,
          textAction: { action: 'snapshot-text', id: record.id, scope: selectedScope },
          source: record.source,
          dependsOn: record.dependsOn,
        };
        break;
      case 'claim':
        result = {
          ...base,
          recordKind: 'claim',
          author: record.author,
          category: record.category,
          text: record.text,
          evidenceIds: record.evidenceIds,
          dependsOn: record.dependsOn,
        };
        break;
      case 'correction':
        result = {
          ...base,
          recordKind: 'correction',
          author: record.author,
          targetIds: record.targetIds,
          replacementIds: record.replacementIds,
          evidenceIds: record.evidenceIds,
          reason: record.reason,
        };
        break;
      case 'check-start':
        result = {
          ...base,
          recordKind: 'check-start',
          toolCallId: record.toolCallId,
          checker: record.checker,
          artifact: record.artifact,
          evidence: record.evidence,
          startedAt: record.startedAt,
        };
        break;
      case 'check-result':
        result = {
          ...base,
          recordKind: 'check-result',
          startId: record.startId,
          outcome: record.outcome,
          findings: record.findings,
          errorCode: record.errorCode,
          finishedAt: record.finishedAt,
        };
        break;
      default:
        throw new Error(`Unsupported stored record kind: ${(record as { kind: unknown }).kind}`);
    }
    return bounded(result);
  }

  if (kind === 'snapshot-text') {
    const stored = findRecord(ctx, validated.id);
    if (stored.record.kind !== 'snapshot') {
      throw new Error(`snapshot-text requires a snapshot record; ${validated.id} is ${stored.record.kind}`);
    }
    return bounded(snapshotTextResult(stored, validated.offset ?? 0, validated.limit ?? DEFAULT_MEMORY_READ_CHARS));
  }

  if (kind === 'list-sources') {
    const scope = validated.scope ?? 'branch';
    const limit = validated.limit ?? DEFAULT_MEMORY_PAGE;
    const ordered = orderByEntry(apis.listSources(view, scope), view);
    const { total, page, nextCursor } = selectPage(ordered, validated.cursor, limit, () => true);
    return bounded({ kind: 'list-sources', scope, total, sources: page, nextCursor });
  }

  // source-text
  const scope = validated.scope ?? 'branch';
  const offset = validated.offset ?? 0;
  const limit = validated.limit ?? DEFAULT_MEMORY_READ_CHARS;
  const read = apis.readPublicSource(view, validated.selector, scope);
  const total = read.text.length;
  if (offset > total) throw new Error(`source-text offset ${offset} exceeds source length ${total}`);
  const text = read.text.slice(offset, offset + limit);
  const end = offset + text.length;
  return bounded({
    kind: 'source-text',
    source: read.source,
    branch: ctx.currentBranchIds.has(read.source.selector.entryId) ? 'current' : 'other',
    offset,
    total,
    nextOffset: end < total ? end : null,
    text,
  });
}

function snapshotTextResult(stored: StoredMemoryRecord, offset: number, limit: number): MemoryReadResult {
  const record = stored.record;
  if (record.kind !== 'snapshot') throw new Error('snapshot-text requires a snapshot record');
  const total = record.text.length;
  if (offset > total) throw new Error(`snapshot-text offset ${offset} exceeds snapshot length ${total}`);
  const text = record.text.slice(offset, offset + limit);
  const end = offset + text.length;
  return {
    kind: 'snapshot-text',
    branch: stored.branch,
    id: record.id,
    format: 'text',
    offset,
    total,
    nextOffset: end < total ? end : null,
    digest: record.digest,
    text,
  };
}

const REAL_APIS: MemoryReaderApis = Object.freeze({
  readMemory,
  listSources,
  readPublicSource,
  resolveSource,
  projectStates,
});

export function queryMemory(view: SessionView, request: MemoryReadRequest): MemoryReadResult {
  return queryMemoryWith(REAL_APIS, view, request);
}
