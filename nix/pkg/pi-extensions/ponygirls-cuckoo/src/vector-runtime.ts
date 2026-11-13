import { Type } from 'typebox';
import type {
  AgentToolResult, ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { CuckooFeatures } from './feature-runtime.ts';
import {
  CuckooTaskConsents, TASK_CONSENT_POLICY,
  TASK_SNAPSHOT_LIMIT, TASK_TEXT_LIMIT_BYTES,
  type TaskConsent, type TaskData, type TaskModelBinding,
  type TaskOperationPermit, type TaskSnapshot,
} from './task-consent.ts';
import {
  encoderBinding, encoderIdentity,
  EMBEDDING_MAX_INPUT_CHARS, EMBEDDING_MAX_REQUEST_BYTES,
  EMBEDDING_MAX_RESPONSE_BYTES,
  type CuckooNetworkServices, type EncoderProfile,
} from './network-services.ts';
import {
  createEmbeddingEncoder, EmbeddingTransportError,
  type EmbeddingAuditEvent,
} from './embedding-transport.ts';
import {
  addRow, createIndex, query, encoderIdentityKey, textDigest,
  VectorMemoryError, MAX_QUERY_TEXT_CHARS, MAX_INDEX_VECTOR_COMPONENTS,
  MAX_VECTOR_RESPONSE_BYTES,
  type EncoderIdentity, type EncoderPort, type VectorIndex,
  type VectorAuthorityPort, type VectorAuthoritySnapshot,
  type IndexRecordApproval, type WorkContext,
} from './experiments/vector-memory.ts';
import type { TextDigest } from './memory-types.ts';
import { operatorDisplay } from './operator-ui.ts';

export const VECTOR_TOOL = 'cuckoo_search';
export const VECTOR_DEFAULT_TOP_K = 10;
export const VECTOR_MAX_TOP_K = 20;
export const VECTOR_SEARCH_MS = 60_000;
export const VECTOR_ENCODER_MS = 15_000;
export const VECTOR_MAX_PENDING_SEARCHES = 4;

interface SearchRequest {
  readonly taskId: string;
  readonly query: string;
  readonly topK: number;
}

interface ConfiguredEncoder {
  readonly profile: EncoderProfile;
  readonly binding: TaskModelBinding;
  readonly identity: EncoderIdentity;
  readonly key: string;
}

interface Attempt {
  readonly permitId: string;
  handedOff: boolean;
  phase: EmbeddingAuditEvent['phase'] | 'reserved';
  code: EmbeddingAuditEvent['code'];
}

interface SearchRun {
  readonly request: SearchRequest;
  readonly consent: TaskConsent;
  readonly configured: ConfiguredEncoder;
  readonly inventory: TextDigest;
  readonly cacheKey: TextDigest;
  readonly revision: number;
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
  reserved: number;
  handoffs: number;
  last: Attempt | null;
}

interface CachedIndex {
  readonly key: TextDigest;
  readonly index: VectorIndex;
}

type EncodeTarget =
  | {
      readonly kind: 'record';
      readonly recordId: string;
      readonly digest: TextDigest;
    }
  | {
      readonly kind: 'query';
      readonly digest: TextDigest;
    };

interface Operation {
  readonly encoder: EncoderPort;
  readonly authority: VectorAuthorityPort;
  readonly context: WorkContext;
  check(): TaskData;
  authorityStates(): TextDigest | null;
}

class VectorRuntimeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'VectorRuntimeError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new VectorRuntimeError(code);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseRequest(value: unknown): SearchRequest {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) fail('INVALID_ARGUMENTS');
  const object = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(object)) {
    if (
      typeof key !== 'string' ||
      !['taskId', 'query', 'topK'].includes(key)
    ) fail('INVALID_ARGUMENTS');
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      descriptor === undefined || !('value' in descriptor) ||
      object[key] === undefined
    ) fail('INVALID_ARGUMENTS');
  }
  const taskId = object.taskId;
  const text = object.query;
  const topK = Object.hasOwn(object, 'topK')
    ? object.topK : VECTOR_DEFAULT_TOP_K;
  if (
    typeof taskId !== 'string' || taskId.length === 0 ||
    taskId.length > 128 ||
    typeof text !== 'string' || text.length === 0 ||
    text.length > MAX_QUERY_TEXT_CHARS ||
    typeof topK !== 'number' || !Number.isSafeInteger(topK) ||
    topK < 1 || topK > VECTOR_MAX_TOP_K
  ) fail('INVALID_ARGUMENTS');
  return Object.freeze({ taskId, query: text, topK });
}

function vectorBranch(consent: TaskConsent): TextDigest { return textDigest(consent.scopeKey); }

function available(data: TaskData): readonly TaskSnapshot[] {
  return data.snapshots.filter(item => item.sourceStatus === 'available');
}

/** Called only with freshly checked live task data. */
function currentTaskSnapshotApprovals(
  data: TaskData,
): readonly IndexRecordApproval[] {
  return available(data).map(item => ({
    recordId: item.record.id,
    digest: item.record.digest,
  }));
}

function inventorySignature(data: TaskData): TextDigest {
  if (
    data.snapshots.length > TASK_SNAPSHOT_LIMIT ||
    data.snapshots.reduce((sum, item) =>
      sum + Buffer.byteLength(item.record.text, 'utf8'), 0) >
        TASK_TEXT_LIMIT_BYTES
  ) fail('INVENTORY_BOUNDS');
  const rows = data.snapshots.map(item => [
    item.record.id, item.record.digest, item.sourceStatus,
  ] as const).sort((left, right) => compare(left[0], right[0]));
  return textDigest(JSON.stringify(rows));
}

function stateSignature(data: TaskData): TextDigest {
  const rows = data.snapshots.map(item => [
    item.record.id, item.status,
  ] as const).sort((left, right) => compare(left[0], right[0]));
  return textDigest(JSON.stringify(rows));
}

function response(details: unknown): AgentToolResult<unknown> {
  const text = JSON.stringify(details);
  if (Buffer.byteLength(text, 'utf8') > MAX_VECTOR_RESPONSE_BYTES) {
    fail('OUTPUT_TOO_LARGE');
  }
  return { content: [{ type: 'text', text }], details };
}

export class CuckooVectors {
  private readonly features: CuckooFeatures;
  private readonly consents: CuckooTaskConsents;
  private readonly services: CuckooNetworkServices;
  private cache: CachedIndex | null = null;
  private revision = 0;
  private abort = new AbortController();
  private rootSignal: AbortSignal | null = null;
  private rootAbort: (() => void) | null = null;
  private grantSignal: AbortSignal | null = null;
  private grantAbort: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private lastAttempt: Attempt | null = null;

  constructor(
    features: CuckooFeatures,
    consents: CuckooTaskConsents,
    services: CuckooNetworkServices,
  ) {
    this.features = features;
    this.consents = consents;
    this.services = services;
    const self = this;

    features.registerTool({
      name: VECTOR_TOOL,
      label: 'Search approved task snapshots',
      description:
        'Search current source-available snapshots assigned to the exact ' +
        'operator-approved task ID. Requires a separate live task disclosure ' +
        'grant and configured encoder; the checkbox is not consent. That ' +
        'grant covers subsequent task snapshots and bounded model-written ' +
        'queries. Results include active-status candidates only, with explicit ' +
        'coverage counts. No ambient/system/developer/hidden text is harvested. ' +
        'Similarity is not truth, authority or verification. No fallback.',
      promptSnippet: 'Vector search within an explicitly approved memory task',
      promptGuidelines: [
        'Use cuckoo_search with the exact task ID approved by the operator.',
        'Inspect cuckoo_search snapshot IDs through cuckoo_memory.',
        'Do not interpret cuckoo_search similarity or active status as verification.',
      ],
      parameters: Type.Object({
        taskId: Type.String({ minLength: 1, maxLength: 128 }),
        query: Type.String({
          minLength: 1, maxLength: MAX_QUERY_TEXT_CHARS,
        }),
        topK: Type.Optional(Type.Integer({
          minimum: 1, maximum: VECTOR_MAX_TOP_K,
        })),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      annotations: {
        readOnlyHint: true, destructiveHint: false,
        idempotentHint: false, openWorldHint: true,
      },
      async execute(_id, params, signal, _update, ctx) {
        let run: SearchRun | null = null;
        try {
          self.features.requireFeature(ctx, 'vectors');
          const request = parseRequest(params);
          run = self.begin(ctx, request, signal);
          const selected = run;
          const details = await self.serialize(() =>
            self.search(ctx, selected));
          // Fence the await between search completion and tool delivery.
          const final = self.fresh(ctx, selected, null);
          if (stateSignature(final) !== details.states) {
            fail('CURRENT_STATE_CHANGED');
          }
          return response(details.result);
        } catch (error: unknown) {
          let code = 'AUTHORITY_OR_ENCODER_UNAVAILABLE';
          if (error instanceof VectorRuntimeError) code = error.code;
          else if (
            error instanceof VectorMemoryError ||
            error instanceof EmbeddingTransportError
          ) code = error.code;
          throw new Error(JSON.stringify({
            error: 'CUCKOO_VECTOR_ERROR',
            code,
            encoderOperationsReserved: run === null ? 0 : run.reserved,
            clientHandoffs: run === null ? 0 : run.handoffs,
            lastTransportCode: run === null || run.last === null
              ? null : run.last.code,
            transmission: run !== null && run.handoffs > 0
              ? 'may-have-occurred' : 'not-handed-off',
            serverStop: run !== null && run.handoffs > 0
              ? 'unknown' : 'not-applicable',
            notice:
              'No successful partial retrieval, fallback, retry or refund. ' +
              'Previously dispatched provider work may continue. An explicit ' +
              'later search is a new operation, not reconciliation or rollback.',
          }));
        }
      },
    }, ['vectors']);
  }

  private discard(): void {
    this.revision++;
    this.abort.abort();
    this.abort = new AbortController();
    this.cache = null;
    if (this.grantSignal !== null && this.grantAbort !== null) {
      this.grantSignal.removeEventListener('abort', this.grantAbort);
    }
    this.grantSignal = null;
    this.grantAbort = null;
  }

  private watchRoot(ctx: ExtensionContext): void {
    this.features.requireFeature(ctx, 'vectors');
    const signal = this.features.signal(ctx);
    if (signal !== this.rootSignal) {
      if (this.rootSignal !== null && this.rootAbort !== null) {
        this.rootSignal.removeEventListener('abort', this.rootAbort);
      }
      this.discard();
      this.rootSignal = signal;
      this.rootAbort = () => this.discard();
      signal.addEventListener('abort', this.rootAbort, { once: true });
    }
    if (signal.aborted) fail('CANCELLED');
  }

  private watchGrant(signal: AbortSignal): void {
    if (signal !== this.grantSignal) {
      if (this.grantSignal !== null && this.grantAbort !== null) {
        this.grantSignal.removeEventListener('abort', this.grantAbort);
      }
      this.grantSignal = signal;
      this.grantAbort = () => this.discard();
      signal.addEventListener('abort', this.grantAbort, { once: true });
    }
    if (signal.aborted) {
      this.discard();
      fail('CANCELLED');
    }
  }

  private configured(
    ctx: ExtensionContext,
    consent: TaskConsent,
  ): ConfiguredEncoder {
    try {
      const source = this.services.encoderProfiles.read()
        .find(profile => profile.id === consent.binding.id);
      if (source === undefined) fail('ENCODER_CONFIGURATION_CHANGED');
      const profile = Object.freeze({ ...source });
      const policy = this.services.embeddingTransportPolicy;
      const binding = encoderBinding(profile, policy);
      const identity = encoderIdentity(profile, policy);
      if (
        binding.id !== consent.binding.id ||
        binding.label !== consent.binding.label ||
        binding.destination !== consent.binding.destination ||
        binding.digest !== consent.binding.digest
      ) fail('ENCODER_CONFIGURATION_CHANGED');
      return {
        profile, binding, identity, key: encoderIdentityKey(identity),
      };
    } catch {
      // Observed drift cannot regain authority merely by changing back.
      try { this.consents.revoke(ctx, 'vectors'); }
      finally { this.discard(); }
      fail('ENCODER_CONFIGURATION_CHANGED');
    }
  }

  private fresh(
    ctx: ExtensionContext,
    run: SearchRun,
    permit: TaskOperationPermit | null,
  ): TaskData {
    this.features.requireFeature(ctx, 'vectors');
    if (
      run.signal.aborted || run.revision !== this.revision ||
      Date.now() >= run.deadlineMs
    ) fail('CANCELLED_OR_DEADLINE');
    const consent = this.consents.current(ctx, 'vectors');
    if (
      consent === null || consent.id !== run.consent.id ||
      consent.scopeKey !== run.consent.scopeKey ||
      consent.taskId !== run.request.taskId ||
      consent.projectId !== run.consent.projectId ||
      consent.sessionId !== run.consent.sessionId ||
      consent.policyId !== TASK_CONSENT_POLICY ||
      this.features.scopeKey(ctx) !== consent.scopeKey
    ) fail('TASK_GRANT_CHANGED');
    const configured = this.configured(ctx, consent);
    if (
      configured.key !== run.configured.key ||
      configured.binding.digest !== run.configured.binding.digest
    ) fail('ENCODER_CONFIGURATION_CHANGED');

    const data = permit === null
      ? this.consents.data(ctx, 'vectors', configured.binding)
      : this.consents.check(ctx, permit, configured.binding);
    if (
      data.consent.id !== run.consent.id ||
      inventorySignature(data) !== run.inventory
    ) fail('INVENTORY_CHANGED');
    if (run.signal.aborted || run.revision !== this.revision || Date.now() >= run.deadlineMs) {
      fail('CANCELLED_OR_DEADLINE');
    }
    return data;
  }

  private begin(
    ctx: ExtensionContext,
    request: SearchRequest,
    toolSignal: AbortSignal | undefined,
  ): SearchRun {
    this.watchRoot(ctx);
    const consent = this.consents.current(ctx, 'vectors');
    if (consent === null) fail('TASK_APPROVAL_REQUIRED');
    if (consent.taskId !== request.taskId) fail('TASK_NOT_APPROVED');
    const configured = this.configured(ctx, consent);
    const data = this.consents.data(ctx, 'vectors', configured.binding);
    const inventory = inventorySignature(data);
    const signals = [this.abort.signal, this.features.signal(ctx)];
    if (toolSignal !== undefined) signals.push(toolSignal);
    if (ctx.signal !== undefined) signals.push(ctx.signal);
    const signal = AbortSignal.any(signals);
    if (signal.aborted) fail('CANCELLED');
    return {
      request, consent: data.consent, configured, inventory,
      cacheKey: textDigest(JSON.stringify([
        data.consent.id, data.consent.projectId, data.consent.sessionId,
        data.consent.scopeKey, data.consent.taskId,
        configured.binding.digest, configured.key,
      ])),
      revision: this.revision,
      signal,
      // Candidate and transport deadlines use the platform civil clock.
      deadlineMs: Math.min(
        Date.now() + VECTOR_SEARCH_MS, data.consent.expiresAt,
      ),
      reserved: 0, handoffs: 0, last: null,
    };
  }

  private async serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= VECTOR_MAX_PENDING_SEARCHES) fail('SEARCH_QUEUE_FULL');
    this.pending++;
    const pending = this.tail.then(work);
    this.tail = pending.then(() => {}, () => {});
    try { return await pending; }
    finally { this.pending--; }
  }

  private operation(
    ctx: ExtensionContext,
    run: SearchRun,
    target: EncodeTarget,
  ): Operation {
    let permit: TaskOperationPermit | null = null;
    let used = false;
    let authorityStates: TextDigest | null = null;
    const checked = (): TaskData => this.fresh(ctx, run, permit);

    const authority: VectorAuthorityPort = {
      current: (): VectorAuthoritySnapshot => {
        const data = checked();
        authorityStates = stateSignature(data);
        return {
          grant: {
            projectId: data.consent.projectId,
            sessionId: data.consent.sessionId,
            branch: vectorBranch(data.consent),
            taskIds: [data.consent.taskId],
            recordApprovals: currentTaskSnapshotApprovals(data),
            encoderKeys: [run.configured.key],
            allowQueryText: target.kind === 'query',
            queryDigests: target.kind === 'query' ? [target.digest] : [],
            revokedRecordIds: [],
            expiresAtMs: data.consent.expiresAt,
            revoked: false,
          },
          records: data.snapshots.map(item => ({
            recordId: item.record.id,
            taskId: item.record.taskId,
            digest: item.record.digest,
            status: item.status,
          })),
        };
      },
    };

    const permitted = (inputDigest: TextDigest, key: string): boolean => {
      const data = checked();
      if (
        inputDigest !== target.digest || key !== run.configured.key
      ) return false;
      if (target.kind === 'query') {
        return data.consent.policyId === TASK_CONSENT_POLICY;
      }
      return available(data).some(item =>
        item.record.id === target.recordId &&
        item.record.taskId === run.request.taskId &&
        item.record.digest === target.digest);
    };

    const encoder: EncoderPort = Object.freeze({
      identity: run.configured.identity,
      encode: async (text: string, work: WorkContext) => {
        if (used) fail('ENCODER_OPERATION_ALREADY_USED');
        used = true;
        checked();
        if (textDigest(text) !== target.digest) fail('INPUT_DIGEST_CHANGED');
        permit = this.consents.reserve(ctx, 'vectors', run.configured.binding);
        run.reserved++;
        this.watchGrant(permit.signal);
        checked();

        const attempt: Attempt = {
          permitId: permit.id, handedOff: false,
          phase: 'reserved', code: null,
        };
        run.last = attempt;
        this.lastAttempt = attempt;
        const signals = [run.signal, permit.signal];
        if (work.signal !== undefined) signals.push(work.signal);
        const signal = AbortSignal.any(signals);
        if (signal.aborted) fail('CANCELLED');

        // Resolve only after a live grant and reserved permit were checked.
        const credential = this.services.credential(
          run.configured.profile.credentialEnv,
        );
        checked();
        if (credential === undefined) fail('CREDENTIAL_UNAVAILABLE');

        const transport = createEmbeddingEncoder({
          url: run.configured.profile.url,
          credential,
          identity: run.configured.identity,
          transportPolicy: this.services.embeddingTransportPolicy,
          maxInputChars: EMBEDDING_MAX_INPUT_CHARS,
          maxRequestBytes: EMBEDDING_MAX_REQUEST_BYTES,
          maxResponseBytes: EMBEDDING_MAX_RESPONSE_BYTES,
          authorize: permitted,
          audit: event => {
            attempt.phase = event.phase;
            attempt.code = event.code;
            if (event.handedOff) attempt.handedOff = true;
            return undefined;
          },
          fetchImpl: (url, init) => {
            // Additional final fence at the actual service handoff.
            if (!permitted(target.digest, run.configured.key)) {
              fail('TASK_GRANT_CHANGED');
            }
            if (signal.aborted || init.signal.aborted || Date.now() >= work.deadlineMs) fail('CANCELLED_OR_DEADLINE');
            attempt.handedOff = true;
            run.handoffs++;
            return this.services.fetch(url, init);
          },
        });
        const vector = await transport.encode(text, {
          signal, deadlineMs: work.deadlineMs,
        });
        checked();
        return vector;
      },
    });

    return {
      encoder, authority,
      context: {
        signal: run.signal,
        deadlineMs: Math.min(
          run.deadlineMs, Date.now() + VECTOR_ENCODER_MS,
        ),
      },
      check: checked,
      authorityStates: () => authorityStates,
    };
  }

  private publish(
    ctx: ExtensionContext,
    run: SearchRun,
    index: VectorIndex,
  ): void {
    this.fresh(ctx, run, null);
    this.cache = Object.freeze({ key: run.cacheKey, index });
  }

  private async search(ctx: ExtensionContext, run: SearchRun) {
    let data = this.fresh(ctx, run, null);
    const desired = new Map(available(data)
      .map(item => [item.record.id, item]));
    if (
      desired.size * run.configured.identity.dimensions >
        MAX_INDEX_VECTOR_COMPONENTS
    ) fail('INDEX_COMPONENT_BOUNDS');

    let index = this.cache !== null && this.cache.key === run.cacheKey
      ? this.cache.index
      : createIndex({
          encoderKey: run.configured.key,
          dimensions: run.configured.identity.dimensions,
          normalization: run.configured.identity.normalization,
          maxRows: TASK_SNAPSHOT_LIMIT,
          maxTopK: VECTOR_MAX_TOP_K,
        });

    index = Object.freeze({
      config: index.config,
      rows: Object.freeze(index.rows.filter(row => {
        const item = desired.get(row.recordId);
        return item !== undefined &&
          row.contentDigest === item.record.digest &&
          row.projectId === data.consent.projectId &&
          row.sessionId === data.consent.sessionId &&
          row.branch === vectorBranch(data.consent) &&
          row.taskId === data.consent.taskId;
      })),
    });
    const indexed = new Set(index.rows.map(row => row.recordId));
    const missing = [...desired.values()]
      .filter(item => !indexed.has(item.record.id));
    if (
      this.consents.remaining(ctx, 'vectors') < missing.length + 1
    ) fail('ENCODER_OPERATION_BUDGET');
    this.publish(ctx, run, index);

    for (const item of missing) {
      data = this.fresh(ctx, run, null);
      const operation = this.operation(ctx, run, {
        kind: 'record',
        recordId: item.record.id,
        digest: item.record.digest,
      });
      const next = await addRow(index, {
        rowId: item.record.id,
        recordId: item.record.id,
        taskId: data.consent.taskId,
        projectId: data.consent.projectId,
        sessionId: data.consent.sessionId,
        branch: vectorBranch(data.consent),
        status: item.status,
        text: item.record.text,
        digest: item.record.digest,
        indexedAt: new Date(
          this.services.clock.civilNowMs(),
        ).toISOString(),
      }, operation.encoder, operation.authority, operation.context);
      operation.check();
      this.publish(ctx, run, next);
      index = next;
    }

    data = this.fresh(ctx, run, null);
    const sourceAvailable = available(data);
    if (
      sourceAvailable.length !== index.rows.length ||
      sourceAvailable.some(item => !index.rows.some(row =>
        row.recordId === item.record.id &&
        row.contentDigest === item.record.digest))
    ) fail('INDEX_COVERAGE_INCOMPLETE');

    const operation = this.operation(ctx, run, {
      kind: 'query', digest: textDigest(run.request.query),
    });
    const retrieved = await query(index, {
      text: run.request.query,
      taskId: data.consent.taskId,
      projectId: data.consent.projectId,
      sessionId: data.consent.sessionId,
      branch: vectorBranch(data.consent),
      topK: run.request.topK,
      includeStatuses: ['active'],
    }, operation.encoder, operation.authority, operation.context);
    const final = operation.check();
    const states = stateSignature(final);
    if (states !== operation.authorityStates()) fail('CURRENT_STATE_CHANGED');

    const finalAvailable = available(final);
    const active = finalAvailable.filter(item => item.status === 'active');
    if (
      retrieved.corpusSize !== active.length ||
      retrieved.candidates.some(candidate => !active.some(item =>
        item.record.id === candidate.recordId &&
        item.record.digest === candidate.contentDigest &&
        candidate.status === item.status))
    ) fail('CURRENT_STATE_CHANGED');

    this.publish(ctx, run, index);
    return {
      states,
      result: {
        version: 1,
        taskId: run.request.taskId,
        consentId: final.consent.id,
        queryDigest: textDigest(run.request.query),
        candidates: retrieved.candidates,
        corpusSize: retrieved.corpusSize,
        coverage: {
          taskSnapshots: final.snapshots.length,
          sourceAvailableSnapshots: finalAvailable.length,
          excludedSourceSnapshots:
            final.snapshots.length - finalAvailable.length,
          indexedSourceAvailableSnapshots: index.rows.length,
          activeEligibleSnapshots: active.length,
          statusFilter: 'active',
          completeForCurrentSourceAvailableSnapshots: true,
        },
        encoderOperationsReserved: run.reserved,
        clientHandoffs: run.handoffs,
        remainingOperations: this.consents.remaining(ctx, 'vectors'),
        notice: retrieved.notice +
          ' Source-unavailable snapshots are explicitly excluded. ' +
          'New snapshots arriving during a request cause an explicit error; ' +
          'a later explicit search can include them under the same live task grant.',
      },
    };
  }

  async command(args: string, ctx: ExtensionContext): Promise<void> {
    const action = args.trim();
    if (action === 'revoke') {
      try { this.consents.revoke(ctx, 'vectors'); }
      finally { this.discard(); }
      ctx.ui.notify(
        'Vector task grant revoked; local index discarded. ' +
        'Already-dispatched provider work may continue.',
        'info',
      );
      return;
    }
    if (action === 'approve') {
      const consent = await this.consents.approve(ctx, 'vectors', () =>
        this.services.encoderProfiles.read().map(profile =>
          encoderBinding(profile, this.services.embeddingTransportPolicy)));
      if (consent !== null) {
        this.discard();
        ctx.ui.notify(
          `Vector task approved: ${operatorDisplay(consent.taskId)}\n` +
          `Configured encoder: ${operatorDisplay(consent.binding.label)}\n` +
          `Expires: ${new Date(consent.expiresAt).toISOString()}`,
          'info',
        );
      }
      return;
    }
    if (action !== '' && action !== 'status') {
      throw new Error('Usage: /cuckoo vectors approve|revoke|status');
    }
    this.watchRoot(ctx);
    const consent = this.consents.current(ctx, 'vectors');
    if (consent === null) {
      ctx.ui.notify(
        'Vector retrieval has no live task grant. ' +
        'Use /cuckoo vectors approve; the checkbox grants nothing.',
        'info',
      );
      return;
    }
    const configured = this.configured(ctx, consent);
    const data = this.consents.data(ctx, 'vectors', configured.binding);
    const cacheKey = textDigest(JSON.stringify([
      data.consent.id, data.consent.projectId, data.consent.sessionId,
      data.consent.scopeKey, data.consent.taskId,
      configured.binding.digest, configured.key,
    ]));
    const indexed = this.cache !== null && this.cache.key === cacheKey
      ? this.cache.index.rows.length : 0;
    ctx.ui.notify(
      `Task: ${operatorDisplay(consent.taskId)}\n` +
      `Encoder: ${operatorDisplay(configured.binding.label)}\n` +
      `Destination: ${operatorDisplay(configured.binding.destination)}\n` +
      `Snapshots: ${data.snapshots.length}; source available: ${available(data).length}; indexed: ${indexed}\n` +
      `Operations remaining: ${this.consents.remaining(ctx, 'vectors')}\n` +
      `Expires: ${new Date(consent.expiresAt).toISOString()}\n` +
      `Last attempt: ${operatorDisplay(JSON.stringify(this.lastAttempt))}`,
      'info',
    );
  }
}
