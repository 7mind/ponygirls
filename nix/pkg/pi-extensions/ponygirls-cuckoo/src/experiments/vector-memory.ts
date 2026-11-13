import { createHash } from 'node:crypto';
import { textDigest } from '../memory-core.ts';
import type { MemoryId, TaskId, RecordStatus, TextDigest } from '../memory-types.ts';

export { textDigest } from '../memory-core.ts';

// Isolated X2 candidate. No transports, discovery, credentials or automatic activation.
// Deterministic fixture encoders test workflow, not semantic relevance.
// The trusted host owns authorization and current status computation (projectStates).
// This module consumes fresh authority; similarity never establishes truth or authority.

export const MAX_VECTOR_DIMENSIONS = 16384;
export const MIN_VECTOR_DIMENSIONS = 1;
export const MAX_INDEX_ROWS = 100000;
export const MAX_TOP_K = 100;
export const MAX_INDEX_TEXT_CHARS = 100000;
export const MAX_QUERY_TEXT_CHARS = 12000;
export const MAX_METADATA_ID_CHARS = 128;
export const MAX_VECTOR_RESPONSE_BYTES = 50000;
export const MAX_EXECUTION_MS = 60000;
export const MAX_INDEX_VECTOR_COMPONENTS = 4000000;
const UNIT_NORM_TOLERANCE = 0.000001;
export const VECTOR_MEMORY_NOTICE =
  'Vector-similarity retrieval candidates only; similarity is not evidence of truth, authority, or current correctness. Status comes from the supplied current projection.';

export type Vector = readonly number[];
export type EncoderNormalization = 'unit' | 'raw';
export type VectorErrorCode =
  | 'ENCODER_UNAVAILABLE' | 'ENCODER_MISMATCH' | 'ENCODER_IDENTITY_INVALID'
  | 'DIMENSION_MISMATCH' | 'NONFINITE_VECTOR' | 'ZERO_NORM' | 'VECTOR_OVERFLOW'
  | 'MALFORMED_OUTPUT' | 'GRANT_DENIED' | 'GRANT_REVOKED' | 'GRANT_EXPIRED'
  | 'QUERY_TEXT_DENIED' | 'REVOKED_RECORD' | 'DIGEST_MISMATCH'
  | 'DUPLICATE_ROW' | 'DUPLICATE_ROW_ID' | 'TOO_MANY_ROWS'
  | 'TEXT_TOO_LONG' | 'INVALID_TEXT' | 'INVALID_STATUS' | 'TOPK_OUT_OF_RANGE'
  | 'INVALID_CONFIG' | 'INVALID_CONTEXT' | 'INVALID_AUTHORITY'
  | 'INVALID_METADATA' | 'OUTPUT_TOO_LARGE' | 'CANCELLED' | 'DEADLINE_EXCEEDED';

export class VectorMemoryError extends Error {
  readonly code: VectorErrorCode;
  constructor(code: VectorErrorCode, message: string) {
    super(message);
    this.name = 'VectorMemoryError';
    this.code = code;
  }
}

export interface EncoderIdentity {
  readonly identifier: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly normalization: EncoderNormalization;
  readonly implementationDigest: string;
  readonly configDigest: string;
}

export interface WorkContext {
  readonly signal: AbortSignal | undefined;
  // Required absolute epoch-millisecond deadline. Undefined is rejected at runtime.
  readonly deadlineMs: number;
}

export interface EncoderPort {
  readonly identity: EncoderIdentity;
  encode(text: string, ctx: WorkContext): Promise<Vector>;
}

export interface IndexRecordApproval {
  readonly recordId: MemoryId;
  readonly digest: TextDigest;
}

export interface IndexDataGrant {
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly taskIds: readonly TaskId[];
  readonly recordApprovals: readonly IndexRecordApproval[];
  readonly encoderKeys: readonly string[];
  readonly allowQueryText: boolean;
  // Exact query-text approval, independently of source-record approval.
  readonly queryDigests: readonly TextDigest[];
  readonly revokedRecordIds: readonly MemoryId[];
  readonly expiresAtMs: number | undefined;
  readonly revoked: boolean;
}

export interface VectorCurrentRecord {
  readonly recordId: MemoryId;
  readonly taskId: TaskId;
  readonly digest: TextDigest;
  readonly status: RecordStatus;
}

export interface VectorAuthoritySnapshot {
  readonly grant: IndexDataGrant;
  // These records are projected in grant.projectId/sessionId/branch only.
  // The host must not combine effective status from different branches.
  readonly records: readonly VectorCurrentRecord[];
}

export interface VectorAuthorityPort {
  // Trusted synchronous host getter, not a model-supplied approval object.
  // Called afresh before transmission and after awaiting the encoder.
  current(): VectorAuthoritySnapshot;
}

export interface IndexRow {
  readonly rowId: string;
  readonly recordId: MemoryId;
  readonly taskId: TaskId;
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  // Historical status at indexing; NEVER used as current query authority.
  readonly status: RecordStatus;
  readonly contentDigest: TextDigest;
  readonly vector: Vector;
  readonly indexedAt: string;
}

export interface IndexRowInput {
  readonly rowId: string;
  readonly recordId: MemoryId;
  readonly taskId: TaskId;
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  // Validated as metadata, but the trusted projection supplies stored status.
  readonly status: RecordStatus;
  readonly text: string;
  readonly digest: TextDigest;
  readonly indexedAt: string;
}

export interface VectorIndexConfig {
  readonly encoderKey: string;
  readonly dimensions: number;
  readonly normalization: EncoderNormalization;
  readonly maxRows: number;
  readonly maxTopK: number;
}

export interface VectorIndex {
  readonly config: VectorIndexConfig;
  readonly rows: readonly IndexRow[];
}

export interface QueryRequest {
  readonly text: string;
  readonly taskId: TaskId;
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly topK: number;
  readonly includeStatuses: readonly RecordStatus[];
}

export interface RetrievalCandidate {
  readonly rank: number;
  readonly score: number;
  readonly recordId: MemoryId;
  readonly taskId: TaskId;
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly status: RecordStatus;
  readonly contentDigest: TextDigest;
  readonly indexedAt: string;
}

export interface QuerySuccess {
  readonly candidates: readonly RetrievalCandidate[];
  readonly corpusSize: number;
  readonly notice: string;
}

interface ScopeIdentity {
  readonly projectId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly taskId: TaskId;
}

interface AuthorityView {
  readonly grant: IndexDataGrant;
  readonly approvals: ReadonlyMap<string, TextDigest>;
  readonly records: ReadonlyMap<string, VectorCurrentRecord>;
  readonly revoked: ReadonlySet<string>;
}

interface EligibleRow {
  readonly row: IndexRow;
  readonly status: RecordStatus;
}

function fail(code: VectorErrorCode, message: string): never {
  throw new VectorMemoryError(code, message);
}

function id(value: string): void {
  if (typeof value !== 'string' || value.length === 0 ||
      value.length > MAX_METADATA_ID_CHARS) {
    fail('INVALID_METADATA', 'Identifiers must contain 1 through 128 UTF-16 code units');
  }
}

function boundedString(value: string, limit: number, code: VectorErrorCode): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    fail(code, 'String is missing or exceeds its allowed length');
  }
}

function digest(value: TextDigest): void {
  if (typeof value !== 'string' || !/^sha256-utf16le:[a-f0-9]{64}$/.test(value)) {
    fail('DIGEST_MISMATCH', 'Invalid exact text digest');
  }
}

function status(value: RecordStatus): void {
  if (value !== 'active' && value !== 'superseded' && value !== 'needs-recheck') {
    fail('INVALID_STATUS', 'Unsupported record status');
  }
}

function timestamp(value: string): void {
  if (typeof value !== 'string' || value.length > 32 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail('INVALID_METADATA', 'Timestamp must be bounded UTC ISO-8601');
  }
  const parsed = Date.parse(value);
  const canonical = value.length === 20 ? value.slice(0, -1) + '.000Z' : value;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical) {
    fail('INVALID_METADATA', 'Timestamp is not a valid UTC date');
  }
}

function normalization(value: EncoderNormalization, code: VectorErrorCode): void {
  if (value !== 'unit' && value !== 'raw') fail(code, 'Unsupported normalization');
}

function dimensions(value: number, code: VectorErrorCode): void {
  if (!Number.isSafeInteger(value) ||
      value < MIN_VECTOR_DIMENSIONS || value > MAX_VECTOR_DIMENSIONS) {
    fail(code, 'Dimensions are outside the bounded supported range');
  }
}

function snapshotIdentity(value: EncoderIdentity): EncoderIdentity {
  if (typeof value !== 'object' || value === null) {
    fail('ENCODER_IDENTITY_INVALID', 'Missing encoder identity');
  }
  const copy: EncoderIdentity = {
    identifier: value.identifier,
    model: value.model,
    version: value.version,
    dimensions: value.dimensions,
    normalization: value.normalization,
    implementationDigest: value.implementationDigest,
    configDigest: value.configDigest,
  };
  boundedString(copy.identifier, 256, 'ENCODER_IDENTITY_INVALID');
  boundedString(copy.model, 256, 'ENCODER_IDENTITY_INVALID');
  boundedString(copy.version, 128, 'ENCODER_IDENTITY_INVALID');
  boundedString(copy.implementationDigest, 256, 'ENCODER_IDENTITY_INVALID');
  boundedString(copy.configDigest, 256, 'ENCODER_IDENTITY_INVALID');
  dimensions(copy.dimensions, 'ENCODER_IDENTITY_INVALID');
  normalization(copy.normalization, 'ENCODER_IDENTITY_INVALID');
  return Object.freeze(copy);
}

function identityKey(identity: EncoderIdentity): string {
  return createHash('sha256').update(JSON.stringify([
    identity.identifier, identity.model, identity.version,
    identity.dimensions, identity.normalization,
    identity.implementationDigest, identity.configDigest,
  ]), 'utf8').digest('hex');
}

export function encoderIdentityKey(identity: EncoderIdentity): string {
  return identityKey(snapshotIdentity(identity));
}

function snapshotConfig(value: VectorIndexConfig): VectorIndexConfig {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_CONFIG', 'Missing index configuration');
  }
  const copy: VectorIndexConfig = {
    encoderKey: value.encoderKey,
    dimensions: value.dimensions,
    normalization: value.normalization,
    maxRows: value.maxRows,
    maxTopK: value.maxTopK,
  };
  if (typeof copy.encoderKey !== 'string' || !/^[a-f0-9]{64}$/.test(copy.encoderKey)) {
    fail('INVALID_CONFIG', 'Invalid encoder identity key');
  }
  dimensions(copy.dimensions, 'INVALID_CONFIG');
  normalization(copy.normalization, 'INVALID_CONFIG');
  if (!Number.isSafeInteger(copy.maxRows) ||
      copy.maxRows < 1 || copy.maxRows > MAX_INDEX_ROWS) {
    fail('INVALID_CONFIG', 'Invalid maximum row count');
  }
  if (!Number.isSafeInteger(copy.maxTopK) ||
      copy.maxTopK < 1 || copy.maxTopK > MAX_TOP_K) {
    fail('INVALID_CONFIG', 'Invalid maximum top-k');
  }
  return Object.freeze(copy);
}

interface VectorMagnitude {
  readonly scale: number;
  readonly scaledNorm: number;
}

function magnitude(vector: Vector): VectorMagnitude {
  let scale = 0;
  for (const component of vector) scale = Math.max(scale, Math.abs(component));
  if (scale === 0) fail('ZERO_NORM', 'Zero vector norm');
  // Scale before squaring, including when the unscaled norm is subnormal.
  let squares = 0;
  for (const component of vector) squares += (component / scale) ** 2;
  return { scale, scaledNorm: Math.sqrt(squares) };
}

export function validateVector(vector: Vector, count: number): number[] {
  dimensions(count, 'DIMENSION_MISMATCH');
  if (!Array.isArray(vector)) fail('MALFORMED_OUTPUT', 'Vector must be an array');
  if (vector.length !== count) fail('DIMENSION_MISMATCH', 'Vector dimensions mismatch');
  const copy: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const component: unknown = vector[i];
    if (typeof component !== 'number') {
      fail('MALFORMED_OUTPUT', 'Vector components must be numbers');
    }
    if (!Number.isFinite(component)) fail('NONFINITE_VECTOR', 'Nonfinite vector component');
    copy.push(component);
  }
  const { scale, scaledNorm } = magnitude(copy);
  if (!Number.isFinite(scale * scaledNorm)) fail('VECTOR_OVERFLOW', 'Vector norm overflow');
  return copy;
}

function unit(vector: readonly number[]): readonly number[] {
  const { scale, scaledNorm } = magnitude(vector);
  return vector.map(x => (x / scale) / scaledNorm);
}

export function cosineSimilarity(a: Vector, b: Vector): number {
  const left = unit(validateVector(a, a.length));
  const right = unit(validateVector(b, a.length));
  let score = 0;
  for (let i = 0; i < left.length; i += 1) score += left[i] * right[i];
  if (!Number.isFinite(score)) fail('NONFINITE_VECTOR', 'Nonfinite similarity');
  return Math.max(-1, Math.min(1, score));
}

function storedVector(vector: Vector, config: VectorIndexConfig): Vector {
  const copy = validateVector(vector, config.dimensions);
  if (config.normalization === 'unit') {
    const { scale, scaledNorm } = magnitude(copy);
    if (Math.abs(scale * scaledNorm - 1) > UNIT_NORM_TOLERANCE) {
      fail('MALFORMED_OUTPUT', 'Stored unit-space vector is not normalized');
    }
  }
  return Object.freeze(copy);
}

function encodedVector(vector: Vector, config: VectorIndexConfig): Vector {
  const copy = validateVector(vector, config.dimensions);
  return Object.freeze(config.normalization === 'unit' ? [...unit(copy)] : copy);
}

function scope(value: ScopeIdentity): void {
  id(value.projectId);
  id(value.sessionId);
  id(value.branch);
  id(value.taskId);
}

function rowMetadata(row: IndexRow): void {
  id(row.rowId);
  id(row.recordId);
  scope(row);
  status(row.status);
  digest(row.contentDigest);
  timestamp(row.indexedAt);
}

function namespace(row: ScopeIdentity & { readonly recordId: string }): string {
  return JSON.stringify([
    row.projectId, row.sessionId, row.branch, row.taskId, row.recordId,
  ]);
}

function rowNamespace(row: ScopeIdentity & { readonly rowId: string }): string {
  return JSON.stringify([
    row.projectId, row.sessionId, row.branch, row.taskId, row.rowId,
  ]);
}

function snapshotIndex(index: VectorIndex, ctx: WorkContext): VectorIndex {
  if (typeof index !== 'object' || index === null) {
    fail('INVALID_CONFIG', 'Missing index');
  }
  const config = snapshotConfig(index.config);
  if (!Array.isArray(index.rows) || index.rows.length > config.maxRows) {
    fail('TOO_MANY_ROWS', 'Index exceeds its row bound');
  }
  if (index.rows.length * config.dimensions > MAX_INDEX_VECTOR_COMPONENTS) {
    fail('TOO_MANY_ROWS', 'Index exceeds its vector component budget');
  }
  const recordKeys = new Set<string>();
  const rowKeys = new Set<string>();
  const rows: IndexRow[] = [];
  for (const value of index.rows) {
    checkContext(ctx);
    if (typeof value !== 'object' || value === null) {
      fail('INVALID_METADATA', 'Malformed index row');
    }
    const row: IndexRow = {
      rowId: value.rowId,
      recordId: value.recordId,
      taskId: value.taskId,
      projectId: value.projectId,
      sessionId: value.sessionId,
      branch: value.branch,
      status: value.status,
      contentDigest: value.contentDigest,
      vector: Object.freeze([]),
      indexedAt: value.indexedAt,
    };
    rowMetadata(row);
    const rk = namespace(row);
    const ik = rowNamespace(row);
    if (recordKeys.has(rk)) fail('DUPLICATE_ROW', 'Duplicate scoped record');
    if (rowKeys.has(ik)) fail('DUPLICATE_ROW_ID', 'Duplicate scoped row ID');
    recordKeys.add(rk);
    rowKeys.add(ik);
    rows.push(Object.freeze({ ...row, vector: storedVector(value.vector, config) }));
  }
  return Object.freeze({ config, rows: Object.freeze(rows) });
}

function snapshotContext(value: WorkContext): WorkContext {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.deadlineMs) || value.deadlineMs <= 0 ||
      value.deadlineMs > Date.now() + MAX_EXECUTION_MS) {
    fail('INVALID_CONTEXT', 'A finite positive deadline within 60000ms is required');
  }
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
    fail('INVALID_CONTEXT', 'Signal must be an AbortSignal');
  }
  const ctx = Object.freeze({ signal: value.signal, deadlineMs: value.deadlineMs });
  checkContext(ctx);
  return ctx;
}

function checkContext(ctx: WorkContext): void {
  if (ctx.signal !== undefined && ctx.signal.aborted) {
    fail('CANCELLED', 'Vector operation cancelled');
  }
  if (Date.now() >= ctx.deadlineMs) {
    fail('DEADLINE_EXCEEDED', 'Vector operation deadline exceeded');
  }
}

function arrayBound(value: readonly unknown[], maximum: number): void {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('INVALID_AUTHORITY', 'Authority array is missing or exceeds its bound');
  }
}

function snapshotAuthority(port: VectorAuthorityPort, ctx: WorkContext): AuthorityView {
  checkContext(ctx);
  if (typeof port !== 'object' || port === null || typeof port.current !== 'function') {
    fail('INVALID_AUTHORITY', 'Missing trusted authority getter');
  }
  let value: VectorAuthoritySnapshot;
  try {
    value = port.current();
  } catch {
    fail('INVALID_AUTHORITY', 'Trusted authority is unavailable');
  }
  if (typeof value !== 'object' || value === null ||
      typeof value.grant !== 'object' || value.grant === null) {
    fail('INVALID_AUTHORITY', 'Invalid authority snapshot');
  }
  const raw = value.grant;
  id(raw.projectId);
  id(raw.sessionId);
  id(raw.branch);
  if (typeof raw.revoked !== 'boolean' || typeof raw.allowQueryText !== 'boolean') {
    fail('INVALID_AUTHORITY', 'Invalid grant flags');
  }
  if (raw.revoked) fail('GRANT_REVOKED', 'Data grant revoked');
  if (raw.expiresAtMs !== undefined &&
      (!Number.isFinite(raw.expiresAtMs) || raw.expiresAtMs <= 0)) {
    fail('INVALID_AUTHORITY', 'Invalid grant expiry');
  }
  if (raw.expiresAtMs !== undefined && Date.now() >= raw.expiresAtMs) {
    fail('GRANT_EXPIRED', 'Data grant expired');
  }
  arrayBound(raw.taskIds, MAX_INDEX_ROWS);
  arrayBound(raw.recordApprovals, MAX_INDEX_ROWS);
  arrayBound(raw.revokedRecordIds, MAX_INDEX_ROWS);
  arrayBound(raw.encoderKeys, 128);
  arrayBound(raw.queryDigests, 128);
  arrayBound(value.records, MAX_INDEX_ROWS);

  const tasks = new Set<string>();
  for (const task of raw.taskIds) {
    id(task);
    if (tasks.has(task)) fail('INVALID_AUTHORITY', 'Duplicate authorized task');
    tasks.add(task);
  }
  const approvals = new Map<string, TextDigest>();
  for (const approval of raw.recordApprovals) {
    if (typeof approval !== 'object' || approval === null) {
      fail('INVALID_AUTHORITY', 'Invalid record approval');
    }
    id(approval.recordId);
    digest(approval.digest);
    if (approvals.has(approval.recordId)) {
      fail('INVALID_AUTHORITY', 'Duplicate record approval');
    }
    approvals.set(approval.recordId, approval.digest);
  }
  const revoked = new Set<string>();
  for (const recordId of raw.revokedRecordIds) {
    id(recordId);
    revoked.add(recordId);
  }
  const encoderKeys: string[] = [];
  for (const key of raw.encoderKeys) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) {
      fail('INVALID_AUTHORITY', 'Invalid authorized encoder key');
    }
    encoderKeys.push(key);
  }
  const queryDigests: TextDigest[] = [];
  for (const queryDigest of raw.queryDigests) {
    digest(queryDigest);
    queryDigests.push(queryDigest);
  }
  const records = new Map<string, VectorCurrentRecord>();
  for (const record of value.records) {
    checkContext(ctx);
    if (typeof record !== 'object' || record === null) {
      fail('INVALID_AUTHORITY', 'Invalid current record');
    }
    const copy = Object.freeze({
      recordId: record.recordId, taskId: record.taskId,
      digest: record.digest, status: record.status,
    });
    id(copy.recordId);
    id(copy.taskId);
    digest(copy.digest);
    status(copy.status);
    if (records.has(copy.recordId)) {
      fail('INVALID_AUTHORITY', 'Current scoped record IDs must be unique');
    }
    records.set(copy.recordId, copy);
  }
  const grant: IndexDataGrant = Object.freeze({
    projectId: raw.projectId, sessionId: raw.sessionId, branch: raw.branch,
    taskIds: Object.freeze([...tasks]),
    recordApprovals: Object.freeze([...approvals].map(([recordId, d]) =>
      Object.freeze({ recordId, digest: d }))),
    encoderKeys: Object.freeze(encoderKeys),
    allowQueryText: raw.allowQueryText,
    queryDigests: Object.freeze(queryDigests),
    revokedRecordIds: Object.freeze([...revoked]),
    expiresAtMs: raw.expiresAtMs,
    revoked: raw.revoked,
  });
  checkContext(ctx);
  return { grant, approvals, records, revoked };
}

function authorizedScope(
  target: ScopeIdentity,
  authority: AuthorityView,
  config: VectorIndexConfig,
  identity: EncoderIdentity,
): void {
  const grant = authority.grant;
  if (target.projectId !== grant.projectId || target.sessionId !== grant.sessionId ||
      target.branch !== grant.branch || !grant.taskIds.includes(target.taskId)) {
    fail('GRANT_DENIED', 'Operation is outside the current authorized scope');
  }
  const key = identityKey(identity);
  if (key !== config.encoderKey || identity.dimensions !== config.dimensions ||
      identity.normalization !== config.normalization) {
    fail('ENCODER_MISMATCH', 'Encoder space does not match the index');
  }
  if (!grant.encoderKeys.includes(key)) {
    fail('GRANT_DENIED', 'Encoder is not currently authorized');
  }
}

function authorizedInput(input: IndexRowInput, authority: AuthorityView): VectorCurrentRecord {
  if (authority.revoked.has(input.recordId)) {
    fail('REVOKED_RECORD', 'Record approval revoked');
  }
  const approval = authority.approvals.get(input.recordId);
  const current = authority.records.get(input.recordId);
  if (approval === undefined || current === undefined || current.taskId !== input.taskId) {
    fail('GRANT_DENIED', 'Record is absent from the approved current task');
  }
  if (approval !== input.digest || current.digest !== input.digest) {
    fail('DIGEST_MISMATCH', 'Exact source binding changed; rebuild under current approval');
  }
  return current;
}

function authorizedQuery(request: QueryRequest, authority: AuthorityView): void {
  if (!authority.grant.allowQueryText ||
      !authority.grant.queryDigests.includes(textDigest(request.text))) {
    fail('QUERY_TEXT_DENIED', 'Exact query text is not authorized for transmission');
  }
}

function eligibleRows(
  index: VectorIndex,
  request: QueryRequest,
  authority: AuthorityView,
  ctx: WorkContext,
): readonly EligibleRow[] {
  const result: EligibleRow[] = [];
  for (const row of index.rows) {
    checkContext(ctx);
    if (row.projectId !== request.projectId || row.sessionId !== request.sessionId ||
        row.branch !== request.branch || row.taskId !== request.taskId) continue;
    if (authority.revoked.has(row.recordId)) continue;
    const approval = authority.approvals.get(row.recordId);
    const current = authority.records.get(row.recordId);
    if (approval === undefined || current === undefined ||
        current.taskId !== request.taskId) continue;
    // An explicitly approved stale row is an error, not an empty-success result.
    if (approval !== row.contentDigest || current.digest !== row.contentDigest) {
      fail('DIGEST_MISMATCH', 'Approved index content is stale; rebuild required');
    }
    if (!request.includeStatuses.includes(current.status)) continue;
    result.push({ row, status: current.status });
  }
  return result;
}

function snapshotInput(value: IndexRowInput): IndexRowInput {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_METADATA', 'Missing row input');
  }
  const copy: IndexRowInput = Object.freeze({
    rowId: value.rowId, recordId: value.recordId, taskId: value.taskId,
    projectId: value.projectId, sessionId: value.sessionId, branch: value.branch,
    status: value.status, text: value.text, digest: value.digest, indexedAt: value.indexedAt,
  });
  id(copy.rowId);
  id(copy.recordId);
  scope(copy);
  timestamp(copy.indexedAt);
  status(copy.status);
  digest(copy.digest);
  if (typeof copy.text !== 'string') fail('INVALID_TEXT', 'Source text must be a string');
  if (copy.text.length > MAX_INDEX_TEXT_CHARS) fail('TEXT_TOO_LONG', 'Source text too long');
  if (textDigest(copy.text) !== copy.digest) {
    fail('DIGEST_MISMATCH', 'Source text does not match its exact digest');
  }
  return copy;
}

function snapshotRequest(value: QueryRequest, config: VectorIndexConfig): QueryRequest {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_METADATA', 'Missing query request');
  }
  arrayBound(value.includeStatuses, 3);
  const copy: QueryRequest = Object.freeze({
    text: value.text, taskId: value.taskId, projectId: value.projectId,
    sessionId: value.sessionId, branch: value.branch, topK: value.topK,
    includeStatuses: Object.freeze([...value.includeStatuses]),
  });
  scope(copy);
  if (typeof copy.text !== 'string' || copy.text.length === 0) {
    fail('INVALID_TEXT', 'Query text must be a nonempty string');
  }
  if (copy.text.length > MAX_QUERY_TEXT_CHARS) fail('TEXT_TOO_LONG', 'Query text too long');
  if (!Number.isSafeInteger(copy.topK) || copy.topK < 1 || copy.topK > config.maxTopK) {
    fail('TOPK_OUT_OF_RANGE', 'Query top-k exceeds the configured bound');
  }
  if (copy.includeStatuses.length === 0) fail('INVALID_STATUS', 'No requested statuses');
  for (const requested of copy.includeStatuses) status(requested);
  if (new Set(copy.includeStatuses).size !== copy.includeStatuses.length) {
    fail('INVALID_STATUS', 'Duplicate requested status');
  }
  return copy;
}

function assertIdentityUnchanged(encoder: EncoderPort, initial: EncoderIdentity): void {
  if (encoderIdentityKey(encoder.identity) !== identityKey(initial)) {
    fail('ENCODER_MISMATCH', 'Encoder identity changed during encoding');
  }
}

// Bounds waiting even if an adapter ignores its signal. This cannot prove remote work
// stopped, undo transmission, or interrupt synchronous event-loop-blocking host code.
// No retries, fallback, retained provider error bodies or late-result publication.
async function encodeBounded(
  encoder: EncoderPort,
  encode: EncoderPort['encode'],
  text: string,
  ctx: WorkContext,
): Promise<Vector> {
  checkContext(ctx);
  const controller = new AbortController();
  const childContext: WorkContext = Object.freeze({
    signal: controller.signal, deadlineMs: ctx.deadlineMs,
  });
  return await new Promise<Vector>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (ctx.signal !== undefined) ctx.signal.removeEventListener('abort', abort);
    };
    const stop = (code: 'CANCELLED' | 'DEADLINE_EXCEEDED'): void => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(new VectorMemoryError(code,
        code === 'CANCELLED' ? 'Vector operation cancelled' : 'Vector deadline exceeded'));
    };
    const abort = (): void => { stop('CANCELLED'); };

    if (ctx.signal !== undefined) ctx.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop('DEADLINE_EXCEEDED'),
      Math.max(0, ctx.deadlineMs - Date.now()));
    if (ctx.signal !== undefined && ctx.signal.aborted) {
      stop('CANCELLED');
      return;
    }
    if (Date.now() >= ctx.deadlineMs) {
      stop('DEADLINE_EXCEEDED');
      return;
    }

    // Invoke before yielding so fresh authorization and client handoff are serial.
    // The rejection handler stays attached after timeout/abort to fence late errors.
    const execute = async (): Promise<Vector> => {
      checkContext(childContext);
      return await encode.call(encoder, text, childContext);
    };
    void execute().then(vector => {
      if (settled) return;
      if (ctx.signal !== undefined && ctx.signal.aborted) {
        stop('CANCELLED');
        return;
      }
      if (Date.now() >= ctx.deadlineMs) {
        stop('DEADLINE_EXCEEDED');
        return;
      }
      settled = true;
      cleanup();
      resolve(vector);
    }, () => {
      if (settled) return;
      if (ctx.signal !== undefined && ctx.signal.aborted) {
        stop('CANCELLED');
        return;
      }
      if (Date.now() >= ctx.deadlineMs) {
        stop('DEADLINE_EXCEEDED');
        return;
      }
      settled = true;
      cleanup();
      reject(new VectorMemoryError('ENCODER_UNAVAILABLE',
        'Encoder unavailable; no fallback or automatic retry'));
    });
  });
}

function compareRows(a: IndexRow, b: IndexRow): number {
  const left = namespace(a);
  const right = namespace(b);
  if (left !== right) return left < right ? -1 : 1;
  return a.rowId === b.rowId ? 0 : a.rowId < b.rowId ? -1 : 1;
}

function checkResponse(result: QuerySuccess): void {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_VECTOR_RESPONSE_BYTES) {
    fail('OUTPUT_TOO_LARGE', 'Response metadata exceeds 50000 UTF-8 bytes');
  }
}

export function createIndex(config: VectorIndexConfig): VectorIndex {
  return Object.freeze({
    config: snapshotConfig(config), rows: Object.freeze([]),
  });
}

export async function addRow(
  index: VectorIndex,
  input: IndexRowInput,
  encoder: EncoderPort,
  authority: VectorAuthorityPort,
  context: WorkContext,
): Promise<VectorIndex> {
  const ctx = snapshotContext(context);
  const selected = snapshotInput(input);
  const snapshot = snapshotIndex(index, ctx);
  const identity = snapshotIdentity(encoder.identity);
  const encode = encoder.encode;
  if (typeof encode !== 'function') fail('ENCODER_UNAVAILABLE', 'Missing encoder implementation');

  const before = snapshotAuthority(authority, ctx);
  authorizedScope(selected, before, snapshot.config, identity);
  authorizedInput(selected, before);

  const recordKey = namespace(selected);
  const rowKey = rowNamespace(selected);
  const existing = snapshot.rows.find(row => namespace(row) === recordKey);
  const collision = snapshot.rows.find(row =>
    rowNamespace(row) === rowKey && namespace(row) !== recordKey);
  if (collision !== undefined) fail('DUPLICATE_ROW_ID', 'Scoped row ID already in use');
  if (existing !== undefined && existing.contentDigest === selected.digest) {
    fail('DUPLICATE_ROW', 'Exact record already indexed; status is supplied at query time');
  }
  const nextCount = snapshot.rows.length + (existing === undefined ? 1 : 0);
  if (nextCount > snapshot.config.maxRows ||
      nextCount * snapshot.config.dimensions > MAX_INDEX_VECTOR_COMPONENTS) {
    fail('TOO_MANY_ROWS', 'Index capacity exceeded');
  }

  const output = await encodeBounded(encoder, encode, selected.text, ctx);
  checkContext(ctx);
  assertIdentityUnchanged(encoder, identity);
  const after = snapshotAuthority(authority, ctx);
  authorizedScope(selected, after, snapshot.config, identity);
  const current = authorizedInput(selected, after);
  const vector = encodedVector(output, snapshot.config);
  checkContext(ctx);

  const row: IndexRow = Object.freeze({
    rowId: selected.rowId, recordId: selected.recordId, taskId: selected.taskId,
    projectId: selected.projectId, sessionId: selected.sessionId, branch: selected.branch,
    status: current.status, contentDigest: selected.digest,
    indexedAt: selected.indexedAt, vector,
  });
  const rows = snapshot.rows.filter(value => namespace(value) !== recordKey);
  rows.push(row);
  rows.sort(compareRows);
  checkContext(ctx);
  return Object.freeze({ config: snapshot.config, rows: Object.freeze(rows) });
}

export async function query(
  index: VectorIndex,
  request: QueryRequest,
  encoder: EncoderPort,
  authority: VectorAuthorityPort,
  context: WorkContext,
): Promise<QuerySuccess> {
  const ctx = snapshotContext(context);
  const snapshot = snapshotIndex(index, ctx);
  const selected = snapshotRequest(request, snapshot.config);
  const identity = snapshotIdentity(encoder.identity);
  const encode = encoder.encode;
  if (typeof encode !== 'function') fail('ENCODER_UNAVAILABLE', 'Missing encoder implementation');

  const before = snapshotAuthority(authority, ctx);
  authorizedScope(selected, before, snapshot.config, identity);
  authorizedQuery(selected, before);
  // Validate exact approved bindings and filter scope/status BEFORE transmission.
  // An empty corpus still exercises the explicitly approved encoder; unavailable
  // encoding is not silently presented as a valid empty retrieval.
  eligibleRows(snapshot, selected, before, ctx);

  const output = await encodeBounded(encoder, encode, selected.text, ctx);
  checkContext(ctx);
  assertIdentityUnchanged(encoder, identity);
  const after = snapshotAuthority(authority, ctx);
  authorizedScope(selected, after, snapshot.config, identity);
  authorizedQuery(selected, after);
  const eligible = eligibleRows(snapshot, selected, after, ctx);
  const queryVector = encodedVector(output, snapshot.config);

  const scored = eligible.map(item => {
    checkContext(ctx);
    return {
      row: item.row, status: item.status,
      score: cosineSimilarity(queryVector, item.row.vector),
    };
  });
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.row.recordId !== b.row.recordId) return a.row.recordId < b.row.recordId ? -1 : 1;
    return a.row.rowId === b.row.rowId ? 0 : a.row.rowId < b.row.rowId ? -1 : 1;
  });
  const candidates: readonly RetrievalCandidate[] = Object.freeze(
    scored.slice(0, selected.topK).map((entry, i) => Object.freeze({
      rank: i + 1, score: entry.score,
      recordId: entry.row.recordId, taskId: entry.row.taskId,
      projectId: entry.row.projectId, sessionId: entry.row.sessionId,
      branch: entry.row.branch, status: entry.status,
      contentDigest: entry.row.contentDigest, indexedAt: entry.row.indexedAt,
    })),
  );
  const result: QuerySuccess = Object.freeze({
    candidates, corpusSize: eligible.length, notice: VECTOR_MEMORY_NOTICE,
  });
  checkResponse(result);
  checkContext(ctx);
  return result;
}
