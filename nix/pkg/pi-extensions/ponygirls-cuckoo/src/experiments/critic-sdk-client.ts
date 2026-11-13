import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import type {
  Api,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  FetchFunction,
  Model,
  ModelsSimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { TextDigest } from '../memory-types.ts';
import {
  REFLECTION_PROMPT,
  REFLECTION_PROMPT_ID,
  criticBundleDigest,
  reflectionTextDigest,
} from './reflection-critic.ts';
import type {
  CriticClockPort,
  CriticModelIdentity,
  CriticModelObserver,
  CriticModelPort,
  CriticModelRequest,
  CriticModelResult,
  CriticUsage,
} from './reflection-critic.ts';

export interface CriticSdkBounds {
  readonly maxPayloadBytes: number;
  /**
   * Aggregate request/response body bytes observed at the injected fetch
   * boundary. Response bytes are after fetch decoding; headers/TLS are excluded.
   */
  readonly maxTransportBytes: number;
  readonly maxOutputChars: number;
  readonly maxOutputBytes: number;
  readonly maxOutputTokens: number;
  readonly deadlineMs: number;
  readonly maxEvents: number;
}

export type CriticSdkErrorCode =
  | 'busy'
  | 'invalid-binding'
  | 'invalid-request'
  | 'unauthorized'
  | 'unsupported-api'
  | 'aborted'
  | 'deadline'
  | 'clock'
  | 'transport'
  | 'transport-bound'
  | 'payload-bound'
  | 'output-bound'
  | 'event-bound'
  | 'unexpected-fetch'
  | 'model-mismatch'
  | 'tools-forbidden'
  | 'thinking-forbidden'
  | 'invalid-stream'
  | 'incomplete'
  | 'invalid-output'
  | 'observer-failed'
  | 'audit-failed';

export class CriticSdkError extends Error {
  public readonly code: CriticSdkErrorCode;

  public constructor(code: CriticSdkErrorCode) {
    super(`Critic SDK transport: ${code}`);
    this.name = 'CriticSdkError';
    this.code = code;
  }
}

export interface CriticSdkAudit {
  readonly version: 1;
  readonly stage: 'start' | 'handoff' | 'draining' | 'settled';
  readonly requestId: string;
  readonly civilTime: number;
  readonly elapsedMs: number;
  readonly configurationDigest: TextDigest;
  readonly inputDigest: TextDigest;
  readonly requestedModel: string;
  readonly reportedModel: string | null;
  readonly usage: CriticUsage;
  readonly publicChars: number;
  readonly transportBytes: number;
  readonly fetchHandoffs: number;
  readonly outcome: CriticSdkErrorCode | 'complete' | null;
  /** Neither cancellation nor client settlement establishes remote termination. */
  readonly providerWork: 'unknown';
}

export interface CriticSdkConfiguration {
  readonly physicalModel: Model<Api>;
  /**
   * Host digest of the private transport/runtime configuration, including fetch
   * routing policy. This is a trusted binding, not introspection of credentials.
   */
  readonly transportConfigurationDigest: TextDigest;
  /** Exact final request URL digest; redirects are forbidden. */
  readonly requestUrlDigest: TextDigest;
  readonly bounds: CriticSdkBounds;
}

export interface CriticSdkRuntimeBinding {
  lookupExact(provider: string, id: string): Model<Api> | undefined;
  streamSimple(model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions): AssistantMessageEventStream;
}

export interface CriticSdkDependencies extends CriticSdkConfiguration {
  readonly runtime: CriticSdkRuntimeBinding;
  readonly identity: CriticModelIdentity;
  readonly clock: CriticClockPort;
  readonly fetch: FetchFunction;
  /**
   * Synchronous trusted check of current enablement, grant, exact input, scope,
   * privacy policy, expiry/revocation and approved model/configuration.
   * A Promise or truthy non-boolean is not authorization.
   */
  readonly authorize: (request: CriticModelRequest) => boolean;
  /**
   * At most four sanitized events per invocation. No payload, URL, headers,
   * thinking, raw provider events, or private error bodies are supplied.
   */
  readonly audit: (event: CriticSdkAudit) => void;
}

interface TextBlock {
  text: string;
  ended: boolean;
}

type FetchInput = Parameters<FetchFunction>[0];
type FetchInit = Parameters<FetchFunction>[1];

function fail(code: CriticSdkErrorCode): never {
  throw new CriticSdkError(code);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-request');
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, names: string): Record<string, unknown> {
  const result = record(value);
  const actual = Object.keys(result).sort();
  const expected = names.split(' ').sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail('invalid-request');
  }
  return result;
}

function id(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim().length === 0
  ) {
    fail('invalid-request');
  }
}

function integer(value: unknown, maximum: number): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail('invalid-request');
  }
}

function digest(value: unknown): asserts value is TextDigest {
  if (typeof value !== 'string' || !/^sha256-utf16le:[0-9a-f]{64}$/.test(value)) {
    fail('invalid-binding');
  }
}

function excluded(value: string): boolean {
  return /anthropic|claude/i.test(value);
}

function freezeTree(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
}

function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  freezeTree(copy);
  return copy;
}

function canonical(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    if (object[key] !== undefined) result[key] = canonical(object[key]);
  }
  return result;
}

function modelDigest(model: Model<Api>): TextDigest {
  const encoded = JSON.stringify(canonical(model));
  if (encoded.length > 100000) fail('invalid-binding');
  return reflectionTextDigest(encoded);
}

function validateBounds(bounds: CriticSdkBounds): void {
  exact(bounds, [
    'maxPayloadBytes maxTransportBytes maxOutputChars maxOutputBytes',
    'maxOutputTokens deadlineMs maxEvents',
  ].join(' '));
  integer(bounds.maxPayloadBytes, 400000);
  integer(bounds.maxTransportBytes, 8000000);
  integer(bounds.maxOutputChars, 32000);
  integer(bounds.maxOutputBytes, 128000);
  integer(bounds.maxOutputTokens, 16000);
  integer(bounds.deadlineMs, 60000);
  integer(bounds.maxEvents, 20000);
}

export function criticSdkConfigurationDigest(
  configuration: CriticSdkConfiguration,
): TextDigest {
  validateBounds(configuration.bounds);
  digest(configuration.transportConfigurationDigest);
  digest(configuration.requestUrlDigest);
  return reflectionTextDigest(JSON.stringify([
    'critic-sdk-client-v1',
    modelDigest(configuration.physicalModel),
    configuration.transportConfigurationDigest,
    configuration.requestUrlDigest,
    canonical(configuration.bounds),
    REFLECTION_PROMPT_ID,
    reflectionTextDigest(REFLECTION_PROMPT),
    'sse/no-tools/no-continuation/no-retries/native-off',
  ]));
}

function supported(model: Model<Api>): void {
  if (
    excluded(model.id) ||
    excluded(model.provider) ||
    excluded(model.name) ||
    excluded(model.api)
  ) {
    fail('invalid-binding');
  }
  if (
    ![
      'openai-completions',
      'openai-responses',
      'openai-codex-responses',
    ].includes(model.api)
  ) {
    fail('unsupported-api');
  }
  // Completions thinking formats vary. This adapter only admits non-reasoning
  // completions models; responses models must support native none/off.
  if (model.reasoning) {
    if (model.api === 'openai-completions') fail('unsupported-api');
    const off = model.thinkingLevelMap?.off;
    if (off !== undefined && off !== 'none' && off !== 'off') {
      fail('unsupported-api');
    }
  }
}

function count(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1000000000000
  ) {
    fail('invalid-stream');
  }
  return value;
}

function maximum(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function prefix(text: string, maxChars: number, maxBytes: number): string {
  let low = 0;
  let high = Math.min(text.length, maxChars);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low);
}

function validAdvice(text: string, request: CriticModelRequest): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail('invalid-output');
  }
  const output = exact(parsed, 'version findings');
  if (
    output.version !== 1 ||
    !Array.isArray(output.findings) ||
    output.findings.length > 32
  ) {
    fail('invalid-output');
  }
  const ids = new Set(request.bundle.records.map(item => item.id));
  for (const candidate of output.findings) {
    const finding = exact(candidate, 'severity message refs');
    if (
      !['info', 'warning'].includes(String(finding.severity)) ||
      typeof finding.message !== 'string' ||
      finding.message.trim().length === 0 ||
      finding.message.length > 2000 ||
      !Array.isArray(finding.refs) ||
      finding.refs.length === 0 ||
      finding.refs.length > 32
    ) {
      fail('invalid-output');
    }
    const seen = new Set<string>();
    for (const ref of finding.refs) {
      id(ref);
      if (!ids.has(ref) || seen.has(ref)) fail('invalid-output');
      seen.add(ref);
    }
  }
}

/**
 * Explicit host-created adapter; nothing is registered or enabled automatically.
 *
 * The supplied runtime owns credentials. This module never creates a runtime,
 * discovers models, loads resources, or accesses credential/configuration files.
 * Exact catalog lookups below only verify the supplied physical binding.
 *
 * Cancellation fences output immediately. The returned Promise deliberately
 * remains pending while an injected fetch/read/cancel operation ignores abort:
 * otherwise the controller could falsely release its transport admission slot.
 * This is cooperative containment, not a process sandbox or a money cap.
 */
export function createCriticSdkClient(
  dependencies: CriticSdkDependencies,
): CriticModelPort {
  const model = snapshot(dependencies.physicalModel);
  const bounds = snapshot(dependencies.bounds);
  const identity = snapshot(dependencies.identity);
  const requestUrlDigest = dependencies.requestUrlDigest;
  const expectedModelDigest = modelDigest(model);
  const expectedConfiguration = criticSdkConfigurationDigest({
    physicalModel: model,
    transportConfigurationDigest: dependencies.transportConfigurationDigest,
    requestUrlDigest,
    bounds,
  });
  id(identity.id);
  digest(identity.configurationDigest);
  supported(model);
  if (
    identity.id !== model.id ||
    identity.configurationDigest !== expectedConfiguration
  ) {
    fail('invalid-binding');
  }

  const checkPhysical = (): void => {
    const physical = dependencies.runtime.lookupExact(model.provider, model.id);
    if (
      physical === undefined ||
      physical.api === 'pi-virtual' ||
      modelDigest(physical) !== expectedModelDigest
    ) {
      fail('invalid-binding');
    }
    supported(physical);
  };
  checkPhysical();

  let busy = false;
  return {
    complete(request: CriticModelRequest, observer: CriticModelObserver): Promise<unknown> {
      if (busy) return Promise.reject(new CriticSdkError('busy'));
      busy = true;
      return execute(request, observer).finally(() => { busy = false; });
    },
  };

  async function execute(
    supplied: CriticModelRequest,
    observer: CriticModelObserver,
  ): Promise<CriticModelResult> {
    let request: CriticModelRequest;
    let inputDigest: TextDigest;
    try {
      request = snapshot(supplied);
      exact(request, [
        'requestId model prompt bundle tools ambientContext thinking delegation',
        'actions maxOutputTokens deadlineMs',
      ].join(' '));
      id(request.requestId);
      exact(request.model, 'id configurationDigest');
      exact(request.prompt, 'id text digest');
      if (
        request.model.id !== identity.id ||
        request.model.configurationDigest !== identity.configurationDigest ||
        request.prompt.id !== REFLECTION_PROMPT_ID ||
        request.prompt.text !== REFLECTION_PROMPT ||
        request.prompt.digest !== reflectionTextDigest(REFLECTION_PROMPT) ||
        !Array.isArray(request.tools) ||
        request.tools.length !== 0 ||
        request.ambientContext !== 'none' ||
        request.thinking !== 'disabled' ||
        request.delegation !== 'disabled' ||
        request.actions !== 'none'
      ) {
        fail('invalid-request');
      }
      integer(request.maxOutputTokens, Math.min(bounds.maxOutputTokens, model.maxTokens));
      integer(request.deadlineMs, bounds.deadlineMs);
      inputDigest = criticBundleDigest(request.bundle);
    } catch (error: unknown) {
      throw error instanceof CriticSdkError ? error : new CriticSdkError('invalid-request');
    }

    const userText = JSON.stringify(request.bundle);
    const abort = new AbortController();
    const tasks = new Set<Promise<unknown>>();
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    const cancelledReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    const blocks = new Map<number, TextBlock>();
    let publicText = '';
    let reportedModel: string | null = null;
    let usage: CriticUsage = { inputTokens: null, outputTokens: null };
    let transportBytes = 0;
    let fetchCalls = 0;
    let fetchHandoffs = 0;
    let events = 0;
    let payloadSeen = false;
    let expectedPayload: Buffer | null = null;
    let started = false;
    let terminalSeen = false;
    let closed = false;
    let failure: CriticSdkErrorCode | null = null;
    let lastMonotonic = dependencies.clock.monotonicNowMs();
    if (!Number.isFinite(lastMonotonic) || lastMonotonic < 0) fail('clock');
    const startedMonotonic = lastMonotonic;
    const deadline = startedMonotonic + request.deadlineMs;
    let rejectAbort: (error: CriticSdkError) => void = () => {};
    const abortGate = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    void abortGate.catch(() => {});

    function track<T>(promise: Promise<T>): Promise<T> {
      tasks.add(promise);
      void promise.then(
        () => { tasks.delete(promise); },
        () => { tasks.delete(promise); },
      );
      return promise;
    }

    function cancelReaders(): void {
      for (const reader of readers) {
        if (cancelledReaders.has(reader)) continue;
        cancelledReaders.add(reader);
        try {
          track(reader.cancel()).catch(() => {});
        } catch {
          // Cancellation failure does not establish transport settlement.
        }
      }
    }

    function stop(code: CriticSdkErrorCode): void {
      if (failure === null) failure = code;
      abort.abort();
      cancelReaders();
      rejectAbort(new CriticSdkError(failure));
    }

    function now(): number {
      const value = dependencies.clock.monotonicNowMs();
      if (
        !Number.isFinite(value) ||
        value < lastMonotonic ||
        value > Number.MAX_SAFE_INTEGER
      ) {
        stop('clock');
        return fail('clock');
      }
      lastMonotonic = value;
      return value;
    }

    function ensure(): void {
      if (closed) fail('aborted');
      if (observer.signal.aborted) stop('aborted');
      if (now() >= deadline) stop('deadline');
      if (failure !== null) fail(failure);
    }

    function notify(operation: () => void): void {
      try {
        operation();
      } catch {
        stop('observer-failed');
        fail('observer-failed');
      }
    }

    function audit(stage: CriticSdkAudit['stage']): void {
      const civilTime = dependencies.clock.civilNowMs();
      if (!Number.isSafeInteger(civilTime) || civilTime < 0) fail('clock');
      try {
        dependencies.audit(snapshot({
          version: 1,
          stage,
          requestId: request.requestId,
          civilTime,
          elapsedMs: now() - startedMonotonic,
          configurationDigest: identity.configurationDigest,
          inputDigest,
          requestedModel: identity.id,
          reportedModel,
          usage,
          publicChars: publicText.length,
          transportBytes,
          fetchHandoffs,
          outcome: failure === null && terminalSeen ? 'complete' : failure,
          providerWork: 'unknown',
        }));
      } catch {
        stop('audit-failed');
        fail('audit-failed');
      }
    }

    function eventBound(): void {
      ensure();
      events += 1;
      if (events > bounds.maxEvents) {
        stop('event-bound');
        fail('event-bound');
      }
    }

    function bytes(length: number): void {
      transportBytes += length;
      if (transportBytes > bounds.maxTransportBytes) {
        stop('transport-bound');
        fail('transport-bound');
      }
    }

    function freshAuthorization(): void {
      ensure();
      checkPhysical();
      let allowed = false;
      try {
        allowed = dependencies.authorize(request) === true;
      } catch {
        fail('unauthorized');
      }
      if (!allowed) fail('unauthorized');
      ensure();
    }

    function publicMetadata(data: unknown, sdkModel: Model<Api>): void {
      if (closed || failure !== null) return;
      eventBound();
      if (
        sdkModel.id !== model.id ||
        sdkModel.provider !== model.provider ||
        sdkModel.api !== model.api
      ) {
        fail('invalid-binding');
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return;
      const root = data as Record<string, unknown>;
      // Deliberately inspect only model and usage metadata, never content,
      // reasoning, tool arguments, errors, headers, or arbitrary event bodies.
      const response = root.response;
      const metadata = response !== null &&
        typeof response === 'object' &&
        !Array.isArray(response)
        ? response as Record<string, unknown>
        : root;
      const observed = metadata.model;
      if (observed !== undefined && observed !== null) {
        id(observed);
        const mismatch = (
          excluded(observed) ||
          observed !== identity.id ||
          (reportedModel !== null && reportedModel !== observed)
        );
        reportedModel = observed;
        notify(() => observer.onReportedModel(observed));
        if (mismatch) {
          stop('model-mismatch');
          fail('model-mismatch');
        }
      }
      const rawUsage = metadata.usage;
      if (rawUsage !== undefined && rawUsage !== null) {
        const raw = record(rawUsage);
        const input = model.api === 'openai-completions'
          ? count(raw.prompt_tokens)
          : count(raw.input_tokens);
        const output = model.api === 'openai-completions'
          ? count(raw.completion_tokens)
          : count(raw.output_tokens);
        usage = {
          inputTokens: maximum(usage.inputTokens, input),
          outputTokens: maximum(usage.outputTokens, output),
        };
        notify(() => observer.onUsage(snapshot(usage)));
        if (usage.outputTokens !== null && usage.outputTokens > request.maxOutputTokens) {
          stop('output-bound');
          fail('output-bound');
        }
      }
    }

    function payload(_original: unknown, sdkModel: Model<Api>): unknown {
      ensure();
      if (
        payloadSeen ||
        sdkModel.id !== model.id ||
        sdkModel.provider !== model.provider ||
        sdkModel.api !== model.api
      ) {
        fail('invalid-binding');
      }
      payloadSeen = true;

      // Rebuild the public payload rather than inheriting model sampling
      // overrides, provider-added tools, continuation IDs, or ambient metadata.
      // This wire builder can later be reused by a separate host-bound
      // extra-compute adapter; this critic factory admits only the fixed prompt.
      const body: Record<string, unknown> = model.api === 'openai-completions'
        ? {
            model: model.id,
            stream: true,
            messages: [
              { role: 'system', content: request.prompt.text },
              { role: 'user', content: userText },
            ],
            tools: [],
            tool_choice: 'none',
            max_tokens: request.maxOutputTokens,
            stream_options: { include_usage: true },
          }
        : {
            model: model.id,
            stream: true,
            store: false,
            instructions: request.prompt.text,
            input: [{
              role: 'user',
              content: [{ type: 'input_text', text: userText }],
            }],
            tools: [],
            tool_choice: 'none',
            parallel_tool_calls: false,
            max_output_tokens: request.maxOutputTokens,
            include: [],
          };
      if (model.reasoning) {
        // Pinned responses adapters map omitted simple reasoning to this native
        // off/default-none setting. Unsupported off mappings were rejected above.
        body.reasoning = { effort: model.thinkingLevelMap?.off ?? 'none' };
      }
      // The pinned codex builder otherwise omits maxTokens from its payload.
      // An endpoint rejecting this explicit cap fails; there is no silent retry
      // without the bound and no claim of a financial cap.
      const encoded = Buffer.from(JSON.stringify(body), 'utf8');
      if (encoded.length > bounds.maxPayloadBytes) fail('payload-bound');
      expectedPayload = encoded;
      return body;
    }

    async function dispatch(input: FetchInput, init: FetchInit): Promise<Response> {
      fetchCalls += 1;
      if (fetchCalls !== 1 || !payloadSeen) fail('unexpected-fetch');
      ensure();
      const incoming = new Request(input, init);
      if (
        incoming.method !== 'POST' ||
        reflectionTextDigest(incoming.url) !== requestUrlDigest ||
        incoming.body === null
      ) {
        fail('invalid-binding');
      }
      const signal = AbortSignal.any([abort.signal, incoming.signal]);
      const reader = incoming.body.getReader();
      readers.add(reader);
      const chunks: Uint8Array[] = [];
      for (;;) {
        ensure();
        const item = await track(reader.read());
        ensure();
        if (item.done) break;
        bytes(item.value.byteLength);
        chunks.push(Buffer.from(item.value));
      }
      readers.delete(reader);
      reader.releaseLock();

      const wirePayload = Buffer.concat(chunks);
      const encoding = (incoming.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
      let decodedPayload: Buffer;
      if (encoding === 'identity') decodedPayload = wirePayload;
      else if (encoding === 'gzip') {
        try {
          decodedPayload = gunzipSync(wirePayload, { maxOutputLength: bounds.maxPayloadBytes });
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') fail('payload-bound');
          fail('invalid-binding');
        }
      } else fail('invalid-binding');
      if (decodedPayload.length > bounds.maxPayloadBytes) fail('payload-bound');
      if (expectedPayload === null || !decodedPayload.equals(expectedPayload)) fail('invalid-binding');

      const outgoing = new Request(incoming.url, {
        method: 'POST',
        headers: incoming.headers,
        body: wirePayload,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      });
      audit('handoff');

      // SDK onPayload is awaited. Authorization there is NOT sufficient.
      // No await, audit callback, or payload mutation occurs between this fresh
      // authorization/identity check and the injected fetch invocation.
      freshAuthorization();
      if (signal.aborted) fail('aborted');
      fetchHandoffs += 1;
      const rawPromise = dependencies.fetch(outgoing);
      const response = await track(rawPromise);
      if (closed || failure !== null || signal.aborted) {
        if (response.body !== null) track(response.body.cancel()).catch(() => {});
        fail(failure ?? 'aborted');
      }
      if (response.body === null) fail('transport');
      const upstream = response.body.getReader();
      readers.add(upstream);
      let bodyFinished = false;
      const finishBody = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
        if (bodyFinished) return;
        bodyFinished = true;
        if (failure === null) controller.close();
        else controller.error(new CriticSdkError(failure));
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
          if (bodyFinished) return;
          try {
            if (closed) { finishBody(controller); return; }
            ensure();
            const item = await track(upstream.read());
            // SDK sentinel cleanup may cancel while this read is pending.
            if (bodyFinished) return;
            if (closed) { finishBody(controller); return; }
            ensure();
            if (item.done) {
              readers.delete(upstream);
              upstream.releaseLock();
              finishBody(controller);
              return;
            }
            bytes(item.value.byteLength);
            controller.enqueue(item.value);
          } catch {
            if (bodyFinished) return;
            if (closed) { finishBody(controller); return; }
            // Let the SDK's ordered error event follow already queued public deltas.
            bodyFinished = true;
            controller.error(new CriticSdkError(failure ?? 'transport'));
          }
        },
        cancel(): Promise<void> {
          bodyFinished = true;
          cancelledReaders.add(upstream);
          return track(upstream.cancel()).then(() => {
            readers.delete(upstream);
          });
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const guardedFetch: FetchFunction = (input, init) => track(dispatch(input, init));

    function publicDelta(delta: string): void {
      const combined = publicText + delta;
      const bounded = prefix(combined, bounds.maxOutputChars, bounds.maxOutputBytes);
      const accepted = bounded.slice(publicText.length);
      publicText = bounded;
      if (accepted.length !== 0) notify(() => observer.onPublicText(accepted));
      if (bounded !== combined) {
        stop('output-bound');
        fail('output-bound');
      }
    }

    function blockIndex(value: number): void {
      if (!Number.isSafeInteger(value) || value < 0 || value > 63) {
        fail('invalid-stream');
      }
    }

    function handle(event: AssistantMessageEvent): string | null {
      eventBound();
      if (event.type === 'error') fail('transport');
      if (terminalSeen) fail('invalid-stream');
      if (event.type === 'start') {
        if (started) fail('invalid-stream');
        started = true;
        return null;
      }
      if (!started) fail('invalid-stream');
      if (
        event.type === 'toolcall_start' ||
        event.type === 'toolcall_delta' ||
        event.type === 'toolcall_end'
      ) {
        fail('tools-forbidden');
      }
      if (
        event.type === 'thinking_start' ||
        event.type === 'thinking_delta' ||
        event.type === 'thinking_end'
      ) {
        // No thinking text/signatures are inspected or forwarded.
        fail('thinking-forbidden');
      }
      if (event.type === 'text_start') {
        blockIndex(event.contentIndex);
        if (blocks.has(event.contentIndex)) fail('invalid-stream');
        blocks.set(event.contentIndex, { text: '', ended: false });
        return null;
      }
      if (event.type === 'text_delta' || event.type === 'text_end') {
        blockIndex(event.contentIndex);
        const block = blocks.get(event.contentIndex);
        if (block === undefined || block.ended) fail('invalid-stream');
        if (event.type === 'text_delta') {
          if (typeof event.delta !== 'string') fail('invalid-stream');
          publicDelta(event.delta);
          block.text += event.delta;
        } else {
          if (event.content !== block.text) fail('invalid-stream');
          block.ended = true;
        }
        return null;
      }
      if (event.type !== 'done') fail('invalid-stream');
      if (event.reason !== 'stop' || event.message.stopReason !== 'stop') {
        fail('incomplete');
      }
      const message = event.message;
      if (
        message.api !== model.api ||
        message.provider !== model.provider ||
        message.model !== model.id ||
        !Array.isArray(message.content)
      ) {
        fail('invalid-stream');
      }
      let finalText = '';
      for (let index = 0; index < message.content.length; index += 1) {
        const part = message.content[index];
        if (part.type === 'toolCall') fail('tools-forbidden');
        if (part.type === 'thinking') fail('thinking-forbidden');
        if (part.type !== 'text') fail('invalid-stream');
        const block = blocks.get(index);
        if (block === undefined || !block.ended || block.text !== part.text) {
          fail('invalid-stream');
        }
        finalText += part.text;
      }
      if (
        blocks.size !== message.content.length ||
        finalText !== publicText ||
        [...blocks.values()].some(block => !block.ended)
      ) {
        fail('invalid-stream');
      }
      // SDK message.model is a request echo. SDK default usage zeros are not
      // accounting evidence. Only the raw model/usage metadata hook above counts.
      validAdvice(finalText, request);
      terminalSeen = true;
      return finalText;
    }

    const onAbort = (): void => { stop('aborted'); };
    observer.signal.addEventListener('abort', onAbort, { once: true });
    let cancelDeadline: () => void = () => {};
    let result: CriticModelResult | null = null;
    try {
      cancelDeadline = dependencies.clock.schedule(request.deadlineMs, () => {
        stop('deadline');
      });
      ensure();
      freshAuthorization();
      audit('start');

      const context: Context = {
        systemPrompt: request.prompt.text,
        messages: [{ role: 'user', content: userText, timestamp: 0 }],
        tools: [],
      };
      const options: ModelsSimpleStreamOptions = {
        signal: abort.signal,
        fetch: guardedFetch,
        transport: 'sse',
        toolChoice: 'none',
        maxTokens: request.maxOutputTokens,
        maxRetries: 0,
        maxRetryDelayMs: 1,
        timeoutMs: request.deadlineMs,
        disableContinuation: true,
        cacheRetention: 'none',
        onPayload: payload,
        onProviderStreamEvent: publicMetadata,
        // Omitted reasoning selects native off/none in the pinned responses
        // adapters; onPayload additionally enforces the exact off wire value.
      };
      const stream = dependencies.runtime.streamSimple(model, context, options);
      const iterator = stream[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([iterator.next(), abortGate]);
        ensure();
        if (next.done) break;
        const finalText = handle(next.value);
        if (finalText !== null) {
          if (fetchHandoffs !== 1) fail('unexpected-fetch');
          result = {
            publicText: finalText,
            reportedModel,
            usage: snapshot(usage),
          };
        }
      }
      if (!terminalSeen || result === null) fail('incomplete');
    } catch (error: unknown) {
      stop(error instanceof CriticSdkError ? error.code : 'transport');
    } finally {
      closed = true;
      abort.abort();
      cancelReaders();
      try {
        cancelDeadline();
      } catch {
        if (failure === null) failure = 'clock';
      }
      observer.signal.removeEventListener('abort', onAbort);

      try {
        audit('draining');
      } catch {
        failure = 'audit-failed';
      }
      // Retain admission while an injected fetch/body operation ignores abort.
      // Late authorization and output callbacks are already fenced by closed.
      while (tasks.size !== 0) {
        await Promise.allSettled([...tasks]);
      }
      try {
        audit('settled');
      } catch {
        failure = 'audit-failed';
      }
    }

    if (failure !== null) fail(failure);
    if (result === null) fail('incomplete');
    return snapshot(result);
  }
}
