import { createHash } from 'node:crypto';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import {
  MEMORY_TYPE,
  MEMORY_VERSION,
  MAX_MEMORY_LABEL,
  MAX_MEMORY_TEXT,
  MAX_MEMORY_SNAPSHOT,
  MAX_MEMORY_REFS,
  type MemoryId,
  type TaskId,
  type TextDigest,
  type MemoryScope,
  type SessionView,
  type TextSelector,
  type PublicSource,
  type SourceText,
  type SourceSummary,
  type SourceResolution,
  type SourceRole,
  type MemoryRecord,
  type StoredMemoryRecord,
  type TaskRecord,
  type SnapshotRecord,
  type ClaimRecord,
  type CorrectionRecord,
  type SnapshotBinding,
  type CheckerIdentity,
  type CheckFinding,
  type MemoryPort,
  type MemoryRuntime,
} from './memory-types.ts';

export type ClaimInput = Omit<ClaimRecord, 'id' | 'kind' | 'author'>;
export type CorrectionInput = Omit<CorrectionRecord, 'id' | 'kind' | 'author'>;

export type MemoryCodecErrorCode = 'SCHEMA' | 'BOUNDS' | 'REFERENCE' | 'DIGEST';
export class MemoryCodecError extends Error {
  readonly code: MemoryCodecErrorCode;
  constructor(code: MemoryCodecErrorCode, message: string) {
    super(message);
    this.name = 'MemoryCodecError';
    this.code = code;
  }
}

export function decodeMemoryRecord(value: unknown): MemoryRecord {
  try {
    return decodeRecord(value);
  } catch (error) {
    if (error instanceof MemoryCodecError) throw error;
    throw new MemoryCodecError('SCHEMA', errorText(error));
  }
}

type JsonObject = Record<string, unknown>;

interface ViewIndex {
  readonly all: readonly SessionEntry[];
  readonly branch: readonly SessionEntry[];
  readonly byId: ReadonlyMap<string, SessionEntry>;
  readonly current: ReadonlySet<string>;
}

interface NativeText {
  readonly entryId: string;
  readonly role: SourceRole;
  readonly toolName: string | null;
  readonly timestamp: string;
  readonly parts: readonly {
    readonly part: number;
    readonly text: string;
  }[];
}

interface SourceContext {
  readonly index: ViewIndex;
  readonly selected: readonly SessionEntry[];
  readonly captured: ReadonlySet<string>;
}

interface History {
  readonly records: Map<MemoryId, MemoryRecord>;
  readonly superseded: Set<MemoryId>;
  readonly terminalStarts: Set<MemoryId>;
}

function fail(message: string): never {
  throw new Error(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plain(value: unknown, name: string): JsonObject {
  if (!isObject(value)) fail(`${name} must be an object`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${name} must be a plain object`);
  }
  return value;
}

function shape(value: unknown, names: readonly string[], name: string): JsonObject {
  const result = plain(value, name);
  const keys = Reflect.ownKeys(result);
  if (
    keys.length !== names.length ||
    keys.some(key => typeof key !== 'string' || !names.includes(key)) ||
    names.some(key => !Object.hasOwn(result, key))
  ) {
    fail(`${name} must contain exactly ${names.join(', ')}`);
  }
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      fail(`${name}.${key} must be a data property`);
    }
  }
  return result;
}

function stringField(
  value: unknown,
  maximum: number,
  name: string,
  nonblank: boolean,
): string {
  const message = `${name} must be a nonempty string of at most ${maximum} UTF-16 code units`;
  if (typeof value !== 'string') fail(message);
  if (value.length === 0 || value.length > maximum) {
    throw new MemoryCodecError('BOUNDS', message);
  }
  if (nonblank && value.trim().length === 0) fail(message);
  return value;
}

function id(value: unknown, name: string): string {
  return stringField(value, 128, name, false);
}

function timestamp(value: unknown, name: string): string {
  const result = stringField(value, 128, name, false);
  const milliseconds = Date.parse(result);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== result
  ) {
    fail(`${name} must be a canonical ISO UTC timestamp`);
  }
  return result;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new MemoryCodecError('BOUNDS', `${name} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function arrayOf<T>(
  value: unknown,
  maximum: number,
  decode: (item: unknown, index: number) => T,
  name: string,
): readonly T[] {
  if (!Array.isArray(value)) fail(`${name} must be an array of at most ${maximum} items`);
  if (value.length > maximum) {
    throw new MemoryCodecError('BOUNDS', `${name} must be an array of at most ${maximum} items`);
  }

  // Reject holes, symbol properties and additional array properties.
  if (
    Reflect.ownKeys(value).length !== value.length + 1 ||
    value.some((_item, index) => !Object.hasOwn(value, index))
  ) {
    fail(`${name} must be a dense ordinary array`);
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail(`${name} must not contain holes`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      fail(`${name} items must be data properties`);
    }
  }
  return Object.freeze(value.map((item: unknown, index: number) => decode(item, index)));
}

function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) {
    throw new MemoryCodecError('REFERENCE', `${name} contains duplicate IDs`);
  }
}

function refs(value: unknown, name: string): readonly MemoryId[] {
  const result = arrayOf(
    value,
    MAX_MEMORY_REFS,
    (item, index) => id(item, `${name}[${index}]`),
    name,
  );
  unique(result, name);
  return result;
}

function digestField(value: unknown, name: string): TextDigest {
  if (
    typeof value !== 'string' ||
    !/^sha256-utf16le:[0-9a-f]{64}$/.test(value)
  ) {
    fail(`${name} must be a tagged SHA-256 UTF-16LE text digest`);
  }
  return value as TextDigest;
}

export function textDigest(text: string): TextDigest {
  if (typeof text !== 'string') fail('Text digest input must be a string');
  return `sha256-utf16le:${createHash('sha256')
    .update(Buffer.from(text, 'utf16le'))
    .digest('hex')}`;
}

function selectorField(value: unknown): TextSelector {
  const object = shape(
    value,
    ['entryId', 'part', 'start', 'end'],
    'Text selector',
  );
  const start = integer(object.start, 0, Number.MAX_SAFE_INTEGER, 'Selector start');
  const end = integer(object.end, 0, Number.MAX_SAFE_INTEGER, 'Selector end');
  if (end <= start || end - start > MAX_MEMORY_SNAPSHOT) {
    throw new MemoryCodecError('BOUNDS', `Selector must select from 1 to ${MAX_MEMORY_SNAPSHOT} UTF-16 code units`);
  }
  return Object.freeze({
    entryId: id(object.entryId, 'Selector entryId'),
    part: integer(object.part, 0, Number.MAX_SAFE_INTEGER, 'Selector part'),
    start,
    end,
  });
}

function sourceField(value: unknown): PublicSource {
  const object = shape(
    value,
    ['selector', 'role', 'toolName', 'timestamp', 'digest'],
    'Public source',
  );
  const role = object.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') {
    fail('Public source role must be user, assistant or toolResult');
  }
  const toolName = role === 'toolResult'
    ? stringField(object.toolName, 128, 'Source toolName', false)
    : null;
  if (role !== 'toolResult' && object.toolName !== null) {
    fail('Non-tool source toolName must be null');
  }
  return Object.freeze({
    selector: selectorField(object.selector),
    role,
    toolName,
    timestamp: timestamp(object.timestamp, 'Source timestamp'),
    digest: digestField(object.digest, 'Source digest'),
  });
}

function bindingField(value: unknown, name: string): SnapshotBinding {
  const object = shape(value, ['id', 'digest'], name);
  return Object.freeze({
    id: id(object.id, `${name}.id`),
    digest: digestField(object.digest, `${name}.digest`),
  });
}

function checkerField(value: unknown): CheckerIdentity {
  const object = shape(
    value,
    ['id', 'version', 'implementationDigest', 'scope'],
    'Checker identity',
  );
  return Object.freeze({
    id: id(object.id, 'Checker id'),
    version: stringField(object.version, 128, 'Checker version', true),
    implementationDigest: stringField(
      object.implementationDigest,
      256,
      'Checker implementationDigest',
      true,
    ),
    scope: stringField(object.scope, MAX_MEMORY_TEXT, 'Checker scope', true),
  });
}

function findingField(value: unknown, index: number): CheckFinding {
  const name = `Check finding ${index}`;
  const object = shape(value, ['code', 'message', 'evidenceIds'], name);
  return Object.freeze({
    code: stringField(object.code, 128, `${name}.code`, true),
    message: stringField(object.message, MAX_MEMORY_TEXT, `${name}.message`, true),
    evidenceIds: refs(object.evidenceIds, `${name}.evidenceIds`),
  });
}

/**
 * Structural decoding intentionally does not resolve current native sources.
 * Historical snapshot integrity and current source availability are separate.
 */
function decodeRecord(value: unknown): MemoryRecord {
  const object = plain(value, 'Memory record');
  const kind = object.kind;
  const recordId = id(object.id, 'Memory id');
  const taskId = id(object.taskId, 'Memory taskId');

  switch (kind) {
    case 'task': {
      shape(object, ['kind', 'id', 'taskId', 'label', 'userEntryId'], 'Task record');
      if (taskId !== recordId) throw new MemoryCodecError('REFERENCE', 'Task taskId must equal its id');
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        label: stringField(object.label, MAX_MEMORY_LABEL, 'Task label', true),
        userEntryId: id(object.userEntryId, 'Task userEntryId'),
      });
    }
    case 'snapshot': {
      shape(
        object,
        [
          'kind', 'id', 'taskId', 'purpose', 'label',
          'source', 'text', 'digest', 'dependsOn',
        ],
        'Snapshot record',
      );
      const purpose = object.purpose;
      if (purpose !== 'evidence' && purpose !== 'artifact') {
        fail('Snapshot purpose must be evidence or artifact');
      }
      const source = sourceField(object.source);
      const text = stringField(
        object.text,
        MAX_MEMORY_SNAPSHOT,
        'Snapshot text',
        false,
      );
      const digest = digestField(object.digest, 'Snapshot digest');
      const dependsOn = refs(object.dependsOn, 'Snapshot dependsOn');
      if (digest !== textDigest(text) || source.digest !== digest) {
        throw new MemoryCodecError('DIGEST', 'Snapshot text, digest and source digest disagree');
      }
      if (source.selector.end - source.selector.start !== text.length) {
        fail('Snapshot text length must match its exact selection');
      }
      if (purpose === 'evidence' && dependsOn.length !== 0) {
        throw new MemoryCodecError('REFERENCE', 'Evidence snapshots cannot have derived dependencies');
      }
      if (purpose === 'artifact' && source.role === 'user') {
        fail('Artifacts require selected assistant or tool text');
      }
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        purpose,
        label: stringField(object.label, MAX_MEMORY_LABEL, 'Snapshot label', true),
        source,
        text,
        digest,
        dependsOn,
      });
    }
    case 'claim': {
      shape(
        object,
        [
          'kind', 'id', 'taskId', 'author',
          'category', 'text', 'evidenceIds', 'dependsOn',
        ],
        'Claim record',
      );
      if (object.author !== 'model') fail('Claim author must be model');
      const category = object.category;
      if (
        category !== 'observation' &&
        category !== 'interpretation' &&
        category !== 'decision' &&
        category !== 'assumption'
      ) {
        fail('Invalid claim category');
      }
      const evidenceIds = refs(object.evidenceIds, 'Claim evidenceIds');
      const dependsOn = refs(object.dependsOn, 'Claim dependsOn');
      unique([...evidenceIds, ...dependsOn], 'Claim references');
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        author: 'model',
        category,
        text: stringField(object.text, MAX_MEMORY_TEXT, 'Claim text', true),
        evidenceIds,
        dependsOn,
      });
    }
    case 'correction': {
      shape(
        object,
        [
          'kind', 'id', 'taskId', 'author',
          'targetIds', 'replacementIds', 'evidenceIds', 'reason',
        ],
        'Correction record',
      );
      if (object.author !== 'model') fail('Correction author must be model');
      const targetIds = refs(object.targetIds, 'Correction targetIds');
      const replacementIds = refs(object.replacementIds, 'Correction replacementIds');
      const evidenceIds = refs(object.evidenceIds, 'Correction evidenceIds');
      if (targetIds.length === 0 || evidenceIds.length === 0) {
        throw new MemoryCodecError('BOUNDS', 'Corrections require at least one target and supporting evidence ID');
      }
      unique(
        [...targetIds, ...replacementIds, ...evidenceIds],
        'Correction references',
      );
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        author: 'model',
        targetIds,
        replacementIds,
        evidenceIds,
        reason: stringField(object.reason, MAX_MEMORY_TEXT, 'Correction reason', true),
      });
    }
    case 'check-start': {
      shape(
        object,
        [
          'kind', 'id', 'taskId', 'toolCallId',
          'checker', 'artifact', 'evidence', 'startedAt',
        ],
        'Check-start record',
      );
      const artifact = bindingField(object.artifact, 'Check artifact');
      const evidence = arrayOf(
        object.evidence,
        MAX_MEMORY_REFS,
        (item, index) => bindingField(item, `Check evidence ${index}`),
        'Check evidence',
      );
      unique(
        [artifact.id, ...evidence.map(binding => binding.id)],
        'Check input bindings',
      );
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        toolCallId: id(object.toolCallId, 'Check toolCallId'),
        checker: checkerField(object.checker),
        artifact,
        evidence,
        startedAt: timestamp(object.startedAt, 'Check startedAt'),
      });
    }
    case 'check-result': {
      shape(
        object,
        [
          'kind', 'id', 'taskId', 'startId', 'outcome',
          'findings', 'errorCode', 'finishedAt',
        ],
        'Check-result record',
      );
      const outcome = object.outcome;
      if (
        outcome !== 'pass' &&
        outcome !== 'fail' &&
        outcome !== 'inconclusive' &&
        outcome !== 'error' &&
        outcome !== 'cancelled' &&
        outcome !== 'timeout'
      ) {
        fail('Invalid check outcome');
      }
      return Object.freeze({
        kind,
        id: recordId,
        taskId,
        startId: id(object.startId, 'Check startId'),
        outcome,
        findings: arrayOf(
          object.findings,
          MAX_MEMORY_REFS,
          findingField,
          'Check findings',
        ),
        errorCode: object.errorCode === null
          ? null
          : stringField(object.errorCode, 128, 'Check errorCode', true),
        finishedAt: timestamp(object.finishedAt, 'Check finishedAt'),
      });
    }
    default:
      return fail('Unsupported memory record kind');
  }
}

function decodeEntry(
  entry: SessionEntry,
  current: ReadonlySet<string>,
): StoredMemoryRecord {
  try {
    if (entry.type !== 'custom' || entry.customType !== MEMORY_TYPE) {
      fail('Expected a native cuckoo.memory custom entry');
    }
    const envelope = shape(entry.data, ['version', 'record'], 'Memory envelope');
    if (envelope.version !== MEMORY_VERSION) fail('Unsupported memory envelope version');
    return Object.freeze({
      entryId: id(entry.id, 'Memory native entryId'),
      timestamp: timestamp(entry.timestamp, 'Memory native timestamp'),
      branch: current.has(entry.id) ? 'current' : 'other',
      record: decodeMemoryRecord(envelope.record),
    });
  } catch (error) {
    const message = `Invalid memory at entry ${entry.id}: ${errorText(error)}`;
    if (error instanceof MemoryCodecError) throw new MemoryCodecError(error.code, message);
    return fail(message);
  }
}

function memoryEntry(entry: SessionEntry): boolean {
  return entry.type === 'custom' && entry.customType === MEMORY_TYPE;
}

function scopeField(scope: MemoryScope): void {
  if (scope !== 'branch' && scope !== 'session') fail('Invalid memory scope');
}

function indexView(view: SessionView): ViewIndex {
  id(view.sessionId, 'Session id');
  if (!Array.isArray(view.entries) || !Array.isArray(view.branch)) {
    fail('Session view requires native entries and branch arrays');
  }
  const allById = new Map<string, SessionEntry>();
  for (const entry of view.entries) {
    const entryId = id(entry.id, 'Native entry id');
    if (allById.has(entryId)) fail(`Duplicate native entry ID ${entryId}`);
    allById.set(entryId, entry);
  }

  const current = new Set<string>();
  const currentEntries = new Map<string, SessionEntry>();
  let parentId: string | null = null;
  for (const entry of view.branch) {
    const entryId = id(entry.id, 'Branch entry id');
    if (current.has(entryId)) fail(`Duplicate branch entry ID ${entryId}`);
    if (!allById.has(entryId)) fail(`Branch entry ${entryId} is absent from this session`);
    if (entry.parentId !== parentId) {
      fail(`Branch entry ${entryId} does not follow the current native branch path`);
    }
    current.add(entryId);
    currentEntries.set(entryId, entry);
    parentId = entryId;
  }

  // The native branch object is authoritative when a caller supplies distinct
  // representations of the same current-branch entry.
  const all = view.entries.map(entry => {
    const branchEntry = currentEntries.get(entry.id);
    return branchEntry === undefined ? entry : branchEntry;
  });
  const byId = new Map(all.map(entry => [entry.id, entry]));
  return { all, branch: view.branch, byId, current };
}

function newHistory(): History {
  return {
    records: new Map(),
    superseded: new Set(),
    terminalStarts: new Set(),
  };
}

function reference(
  history: History,
  record: MemoryRecord,
  referenceId: string,
): MemoryRecord {
  if (referenceId === record.id) fail(`Self reference ${referenceId}`);
  const target = history.records.get(referenceId);
  if (target === undefined) {
    fail(`Reference ${referenceId} is not an earlier current-branch memory record`);
  }
  if (target.taskId !== record.taskId) fail(`Cross-task reference ${referenceId}`);
  return target;
}

function evidenceReference(
  history: History,
  record: MemoryRecord,
  referenceId: string,
): MemoryRecord {
  const target = reference(history, record, referenceId);
  if (target.kind !== 'snapshot' && target.kind !== 'check-result') {
    fail(`Evidence ${referenceId} must name a snapshot or check-result`);
  }
  return target;
}

function correctable(record: MemoryRecord): boolean {
  return record.kind === 'claim' ||
    (record.kind === 'snapshot' && record.purpose === 'artifact');
}

function validateRelations(
  history: History,
  record: MemoryRecord,
  latestUserEntryId: string | null,
): void {
  if (history.records.has(record.id)) fail(`Duplicate memory ID ${record.id}`);

  if (record.kind === 'task') {
    if (latestUserEntryId === null || record.userEntryId !== latestUserEntryId) {
      fail('Task must anchor the latest preceding native user-message entry');
    }
    return;
  }

  const task = history.records.get(record.taskId);
  if (task === undefined || task.kind !== 'task') {
    fail(`Task ${record.taskId} is not an earlier current-branch task`);
  }

  switch (record.kind) {
    case 'snapshot':
      for (const dependencyId of record.dependsOn) {
        const dependency = reference(history, record, dependencyId);
        if (
          dependency.kind !== 'snapshot' &&
          dependency.kind !== 'claim' &&
          dependency.kind !== 'check-result'
        ) {
          fail(`Artifact dependency ${dependencyId} must be a snapshot, claim or check-result`);
        }
      }
      return;

    case 'claim':
      for (const evidenceId of record.evidenceIds) {
        evidenceReference(history, record, evidenceId);
      }
      for (const dependencyId of record.dependsOn) {
        reference(history, record, dependencyId);
      }
      return;

    case 'correction':
      for (const targetId of record.targetIds) {
        const target = reference(history, record, targetId);
        if (!correctable(target)) {
          fail(`Correction target ${targetId} must be a claim or artifact snapshot`);
        }
        if (history.superseded.has(targetId)) {
          fail(`Correction target ${targetId} is already explicitly superseded`);
        }
      }
      for (const replacementId of record.replacementIds) {
        const replacement = reference(history, record, replacementId);
        if (!correctable(replacement)) {
          fail(`Replacement ${replacementId} must be a claim or artifact snapshot`);
        }
        if (history.superseded.has(replacementId)) {
          fail(`Replacement ${replacementId} is already explicitly superseded`);
        }
      }
      for (const evidenceId of record.evidenceIds) {
        evidenceReference(history, record, evidenceId);
      }
      return;

    case 'check-start': {
      const artifact = reference(history, record, record.artifact.id);
      if (artifact.kind !== 'snapshot' || artifact.purpose !== 'artifact') {
        fail('Check artifact must name an earlier artifact snapshot');
      }
      if (artifact.digest !== record.artifact.digest) {
        fail('Check artifact digest does not match its snapshot');
      }
      for (const binding of record.evidence) {
        const evidence = reference(history, record, binding.id);
        if (evidence.kind !== 'snapshot' || evidence.digest !== binding.digest) {
          fail(`Check evidence binding ${binding.id} does not match its snapshot`);
        }
        // Purpose is a model annotation, not authority. The trusted checker
        // decides whether this selected snapshot has an admissible role.
      }
      return;
    }

    case 'check-result': {
      const start = reference(history, record, record.startId);
      if (start.kind !== 'check-start') fail('Check result must name an earlier check-start');
      if (history.terminalStarts.has(record.startId)) {
        fail(`Check-start ${record.startId} already has a terminal result`);
      }
      const allowedEvidence = new Set(start.evidence.map(binding => binding.id));
      for (const finding of record.findings) {
        for (const evidenceId of finding.evidenceIds) {
          reference(history, record, evidenceId);
          if (!allowedEvidence.has(evidenceId)) {
            fail(`Finding evidence ${evidenceId} was not bound by its check-start`);
          }
        }
      }
      return;
    }
  }
}

function remember(history: History, record: MemoryRecord): void {
  history.records.set(record.id, record);
  if (record.kind === 'correction') {
    for (const targetId of record.targetIds) history.superseded.add(targetId);
  }
  if (record.kind === 'check-result') history.terminalStarts.add(record.startId);
}

function loadBranch(index: ViewIndex): readonly StoredMemoryRecord[] {
  const result: StoredMemoryRecord[] = [];
  const history = newHistory();
  let latestUserEntryId: string | null = null;

  for (const entry of index.branch) {
    if (entry.type === 'message' && entry.message.role === 'user') {
      latestUserEntryId = entry.id;
    }
    if (!memoryEntry(entry)) continue;
    const stored = decodeEntry(entry, index.current);
    try {
      validateRelations(history, stored.record, latestUserEntryId);
    } catch (error) {
      fail(`Invalid memory at entry ${entry.id}: ${errorText(error)}`);
    }
    remember(history, stored.record);
    result.push(stored);
  }
  return Object.freeze(result);
}

export function readMemory(
  view: SessionView,
  scope: MemoryScope,
): readonly StoredMemoryRecord[] {
  scopeField(scope);
  const index = indexView(view);
  const branch = loadBranch(index);
  if (scope === 'branch') return branch;

  // Other histories are structurally decoded, never combined into the active
  // branch's reference/status graph.
  const branchRecords = new Map(branch.map(stored => [stored.entryId, stored]));
  const result: StoredMemoryRecord[] = [];
  const ids = new Set<string>();
  for (const entry of index.all) {
    if (!memoryEntry(entry)) continue;
    const current = branchRecords.get(entry.id);
    const stored = current === undefined ? decodeEntry(entry, index.current) : current;
    if (ids.has(stored.record.id)) {
      fail(`Invalid memory at entry ${entry.id}: duplicate memory ID ${stored.record.id}`);
    }
    ids.add(stored.record.id);
    result.push(stored);
  }
  return Object.freeze(result);
}

function capturedResponses(entries: readonly SessionEntry[]): ReadonlySet<string> {
  const captured = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== 'cuckoo.report') continue;

    // Read only the public provenance marker, never raw/private report data.
    if (!isObject(entry.data)) {
      fail(`Invalid Cuckoo source marker at entry ${entry.id}`);
    }
    const messageEntryId: unknown = entry.data.messageEntryId;
    if (messageEntryId === undefined) continue; // Legacy reports did not save it.
    try {
      captured.add(id(messageEntryId, 'Captured response entryId'));
    } catch (error) {
      fail(`Invalid Cuckoo source marker at entry ${entry.id}: ${errorText(error)}`);
    }
  }
  return captured;
}

function sourceContext(view: SessionView, scope: MemoryScope): SourceContext {
  scopeField(scope);
  readMemory(view, scope);
  const index = indexView(view);
  return {
    index,
    selected: scope === 'branch' ? index.branch : index.all,
    captured: capturedResponses(index.all),
  };
}

function nativeText(
  entry: SessionEntry,
  captured: ReadonlySet<string>,
): NativeText | undefined {
  if (entry.type !== 'message' || captured.has(entry.id)) return undefined;
  const message = entry.message;
  const role = message.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') {
    return undefined;
  }
  const toolName = role === 'toolResult'
    ? stringField(message.toolName, 128, 'Native toolName', false)
    : null;

  // Reserve the extension's tool namespace: memory/recall/check output must
  // be linked by record ID, not laundered into fresh native evidence.
  if (toolName !== null && toolName.startsWith('cuckoo_')) return undefined;

  const parts: { readonly part: number; readonly text: string }[] = [];
  const content: unknown = message.content;
  if (typeof content === 'string') {
    if (role !== 'user') fail(`Invalid native source content at entry ${entry.id}`);
    parts.push(Object.freeze({ part: 0, text: content }));
  } else {
    if (!Array.isArray(content)) fail(`Invalid native source content at entry ${entry.id}`);
    for (let part = 0; part < content.length; part++) {
      const block: unknown = content[part];
      if (!isObject(block) || block.type !== 'text') continue;
      if (typeof block.text !== 'string') {
        fail(`Invalid native text block at entry ${entry.id}, part ${part}`);
      }
      // No thinking, images, tool-call arguments, details or custom data.
      parts.push(Object.freeze({ part, text: block.text }));
    }
  }
  return Object.freeze({
    entryId: entry.id,
    // This is the native stored role, not proof of human approval.
    role,
    toolName,
    timestamp: timestamp(entry.timestamp, 'Native source timestamp'),
    parts: Object.freeze(parts),
  });
}

function selectedText(native: NativeText, selector: TextSelector): SourceText {
  const part = native.parts.find(item => item.part === selector.part);
  if (part === undefined) fail('Selector does not name a public native text block');
  if (selector.end > part.text.length) fail('Selector is outside its native text block');
  const text = part.text.slice(selector.start, selector.end);
  const source: PublicSource = Object.freeze({
    selector,
    role: native.role,
    toolName: native.toolName,
    timestamp: native.timestamp,
    digest: textDigest(text),
  });
  return Object.freeze({ source, text });
}

export function listSources(
  view: SessionView,
  scope: MemoryScope,
): readonly SourceSummary[] {
  const context = sourceContext(view, scope);
  const result: SourceSummary[] = [];
  for (const entry of context.selected) {
    const native = nativeText(entry, context.captured);
    if (native === undefined || native.parts.length === 0) continue;
    result.push(Object.freeze({
      entryId: native.entryId,
      role: native.role,
      toolName: native.toolName,
      timestamp: native.timestamp,
      branch: context.index.current.has(entry.id) ? 'current' : 'other',
      parts: Object.freeze(native.parts.map(part => Object.freeze({
        part: part.part,
        chars: part.text.length,
      }))),
    }));
  }
  return Object.freeze(result);
}

export function readPublicSource(
  view: SessionView,
  selector: TextSelector,
  scope: MemoryScope,
): SourceText {
  const selected = selectorField(selector);
  const context = sourceContext(view, scope);
  const entry = context.selected.find(item => item.id === selected.entryId);
  if (entry === undefined) fail('Source entry not found in the selected scope');
  const native = nativeText(entry, context.captured);
  if (native === undefined) fail('Entry is not an eligible public native text source');
  return selectedText(native, selected);
}

function sameSource(left: PublicSource, right: PublicSource): boolean {
  return left.selector.entryId === right.selector.entryId &&
    left.selector.part === right.selector.part &&
    left.selector.start === right.selector.start &&
    left.selector.end === right.selector.end &&
    left.role === right.role &&
    left.toolName === right.toolName &&
    left.timestamp === right.timestamp &&
    left.digest === right.digest;
}

export function resolveSource(
  view: SessionView,
  source: PublicSource,
  scope: MemoryScope,
): SourceResolution {
  const recorded = sourceField(source);
  const context = sourceContext(view, scope);
  const entry = context.index.byId.get(recorded.selector.entryId);
  if (entry === undefined) {
    return Object.freeze({ status: 'unavailable', reason: 'Native source entry is absent' });
  }
  if (scope === 'branch' && !context.index.current.has(entry.id)) {
    return Object.freeze({
      status: 'out-of-scope',
      reason: 'Native source is outside the current branch',
    });
  }
  const native = nativeText(entry, context.captured);
  if (native === undefined) {
    return Object.freeze({
      status: 'out-of-scope',
      reason: 'Native entry is not an eligible public text source',
    });
  }
  const part = native.parts.find(item => item.part === recorded.selector.part);
  if (part === undefined || recorded.selector.end > part.text.length) {
    return Object.freeze({
      status: 'changed',
      reason: 'The recorded native text selection no longer exists',
    });
  }
  const current = selectedText(native, recorded.selector);
  if (!sameSource(recorded, current.source)) {
    return Object.freeze({
      status: 'changed',
      reason: 'Native source provenance or selected text identity changed',
    });
  }
  return Object.freeze({ status: 'available', value: current });
}

export function validateAppend(view: SessionView, record: MemoryRecord): void {
  const candidate = decodeRecord(record);
  const all = readMemory(view, 'session');
  if (all.some(stored => stored.record.id === candidate.id)) {
    fail(`Duplicate memory ID ${candidate.id}`);
  }

  const history = newHistory();
  for (const stored of all) {
    if (stored.branch === 'current') remember(history, stored.record);
  }
  let latestUserEntryId: string | null = null;
  for (const entry of view.branch) {
    if (entry.type === 'message' && entry.message.role === 'user') {
      latestUserEntryId = entry.id;
    }
  }
  validateRelations(history, candidate, latestUserEntryId);

  if (candidate.kind === 'snapshot') {
    const resolution = resolveSource(view, candidate.source, 'branch');
    if (resolution.status !== 'available') {
      fail(`Fresh snapshot source is ${resolution.status}: ${resolution.reason}`);
    }
    if (
      resolution.value.text !== candidate.text ||
      !sameSource(resolution.value.source, candidate.source)
    ) {
      fail('Snapshot bytes/provenance do not match the selected native text');
    }
  }
}

function sameRecord(left: MemoryRecord, right: MemoryRecord): boolean {
  // Both operands have already been decoded into canonical exact shapes.
  return JSON.stringify(left) === JSON.stringify(right);
}

function unchangedPrefix(
  before: readonly string[],
  after: readonly SessionEntry[],
): boolean {
  return after.length > before.length &&
    before.every((entryId, index) => after[index].id === entryId);
}

export function appendMemory(
  port: MemoryPort,
  record: MemoryRecord,
): StoredMemoryRecord {
  const candidate = decodeRecord(record);
  const before = port.view();
  validateAppend(before, candidate);
  const sessionId = before.sessionId;
  const entryIds = before.entries.map(entry => entry.id);
  const branchIds = before.branch.map(entry => entry.id);

  const returned: unknown = port.append(candidate);
  const after = port.view();

  if (
    after.sessionId !== sessionId ||
    !unchangedPrefix(entryIds, after.entries) ||
    !unchangedPrefix(branchIds, after.branch)
  ) {
    fail('Memory port changed session/branch or did not append a native entry');
  }

  // Synchronous native observers may append after the memory entry.
  const persistedRecords = readMemory(after, 'session');

  const result = shape(
    returned,
    ['entryId', 'timestamp', 'branch', 'record'],
    'Memory port result',
  );
  const returnedId = id(result.entryId, 'Returned native entryId');
  const returnedTimestamp = timestamp(result.timestamp, 'Returned native timestamp');
  const returnedRecord = decodeRecord(result.record);
  const persisted = persistedRecords.find(stored => stored.entryId === returnedId);
  if (persisted === undefined || persisted.branch !== 'current' || entryIds.includes(persisted.entryId)) {
    fail('Memory port did not identify a new current-branch memory entry');
  }
  if (
    result.branch !== 'current' ||
    returnedId !== persisted.entryId ||
    returnedTimestamp !== persisted.timestamp ||
    !sameRecord(candidate, returnedRecord) ||
    !sameRecord(candidate, persisted.record)
  ) {
    fail('Memory port returned inconsistent native entry/record metadata');
  }
  return persisted;
}

function build<K extends MemoryRecord['kind']>(
  view: SessionView,
  value: unknown,
  kind: K,
): Extract<MemoryRecord, { kind: K }> {
  const record = decodeRecord(value);
  if (record.kind !== kind) fail('Internal memory builder kind mismatch');
  validateAppend(view, record);
  return record as Extract<MemoryRecord, { kind: K }>;
}

export function makeTask(
  view: SessionView,
  label: string,
  runtime: MemoryRuntime,
): TaskRecord {
  const index = indexView(view);
  let userEntryId: string | null = null;
  for (const entry of index.branch) {
    if (entry.type === 'message' && entry.message.role === 'user') {
      userEntryId = entry.id;
    }
  }
  if (userEntryId === null) fail('Cannot create a task without a current-branch native user message');
  const recordId = runtime.newId();
  return build(view, {
    kind: 'task',
    id: recordId,
    taskId: recordId,
    label,
    userEntryId,
  }, 'task');
}

export function makeSnapshot(
  view: SessionView,
  taskId: TaskId,
  purpose: 'evidence' | 'artifact',
  label: string,
  selector: TextSelector,
  dependsOn: readonly MemoryId[],
  runtime: MemoryRuntime,
): SnapshotRecord {
  const selected = readPublicSource(view, selector, 'branch');
  return build(view, {
    kind: 'snapshot',
    id: runtime.newId(),
    taskId,
    purpose,
    label,
    source: selected.source,
    text: selected.text,
    digest: selected.source.digest,
    dependsOn,
  }, 'snapshot');
}

export function makeClaim(
  view: SessionView,
  input: ClaimInput,
  runtime: MemoryRuntime,
): ClaimRecord {
  const fields = shape(
    input,
    ['taskId', 'category', 'text', 'evidenceIds', 'dependsOn'],
    'Claim input',
  );
  return build(view, {
    ...fields,
    kind: 'claim',
    id: runtime.newId(),
    author: 'model',
  }, 'claim');
}

export function makeCorrection(
  view: SessionView,
  input: CorrectionInput,
  runtime: MemoryRuntime,
): CorrectionRecord {
  const fields = shape(
    input,
    ['taskId', 'targetIds', 'replacementIds', 'evidenceIds', 'reason'],
    'Correction input',
  );
  return build(view, {
    ...fields,
    kind: 'correction',
    id: runtime.newId(),
    author: 'model',
  }, 'correction');
}
