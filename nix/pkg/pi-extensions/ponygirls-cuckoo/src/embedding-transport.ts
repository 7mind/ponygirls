import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  MAX_EXECUTION_MS,
  VectorMemoryError,
  encoderIdentityKey,
  textDigest,
  validateVector,
  type EncoderIdentity,
  type EncoderPort,
  type Vector,
  type VectorErrorCode,
  type WorkContext,
} from './experiments/vector-memory.ts';
import type { TextDigest } from './memory-types.ts';

export type EmbeddingTransportPolicy =
  | 'https'
  | 'owned-loopback-http';

export type EmbeddingTransportErrorCode =
  | VectorErrorCode
  | 'AUDIT_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'REDIRECT_FORBIDDEN';

export type EmbeddingPayloadHash = `sha256:${string}`;
export type EmbeddingAuditPhase = 'prepared' | 'validated' | 'failed';

export interface EmbeddingTokenUsage {
  readonly promptTokens: number | null;
  readonly totalTokens: number | null;
}

export type EmbeddingUsage = 'unknown' | EmbeddingTokenUsage;

export interface EmbeddingAuditEvent {
  readonly phase: EmbeddingAuditPhase;
  readonly code: EmbeddingTransportErrorCode | null;
  readonly payloadHash: EmbeddingPayloadHash;
  readonly inputDigest: TextDigest;
  readonly encoderKey: string;
  readonly requestedModel: string;
  readonly requestedDimensions: number;
  readonly reportedModel: string | null;
  readonly reportedModelDigest: TextDigest | null;
  readonly reportedDimensions: number | null;
  readonly usage: EmbeddingUsage;
  readonly httpStatus: number | null;
  readonly handedOff: boolean;
  readonly transmission: 'may-have-occurred' | 'not-handed-off';
  readonly serverStop: 'unknown' | 'not-applicable';
}

export interface EmbeddingFetch {
  (url: string, init: RequestInit & { readonly signal: AbortSignal }): Promise<Response>;
}

export interface EmbeddingAuthorize {
  (inputDigest: TextDigest, encoderKey: string): boolean;
}

export interface EmbeddingAudit {
  (event: EmbeddingAuditEvent): undefined;
}

export interface EmbeddingEncoderOptions {
  /**
   * Complete request URL supplied by the composition root.
   * Its canonical URL.href is the exact destination used by fetch.
   */
  readonly url: string;
  readonly credential: string;
  readonly identity: EncoderIdentity;
  readonly fetchImpl: EmbeddingFetch;
  /**
   * Required synchronous, fresh authority check.
   * The transport never creates or expands a data grant.
   */
  readonly authorize: EmbeddingAuthorize;
  /**
   * Required synchronous sanitized audit sink.
   * A validated event precedes final delivery authorization.
   */
  readonly audit: EmbeddingAudit;
  readonly maxInputChars: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly transportPolicy: EmbeddingTransportPolicy;
}

export class EmbeddingTransportError extends Error {
  public readonly code: EmbeddingTransportErrorCode;

  public constructor(code: EmbeddingTransportErrorCode) {
    super(`Embedding transport failed: ${code}`);
    this.name = 'EmbeddingTransportError';
    this.code = code;
  }
}

function fail(code: EmbeddingTransportErrorCode): never {
  throw new EmbeddingTransportError(code);
}

function payloadHash(text: string): EmbeddingPayloadHash {
  return `sha256:${createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')}`;
}

function positiveBound(value: unknown, maximum: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Invalid asynchronous host callbacks must not leave an unhandled native
 * Promise rejection behind. They still fail closed and never authorize work.
 */
function discardCallbackPromise(value: unknown): void {
  if (value instanceof Promise) {
    void value.catch(() => {});
  }
}

function cancelBody(value: unknown): void {
  try {
    if (!(value instanceof Response)) return;
    const body = value.body;
    if (body !== null && !body.locked) {
      void body.cancel().catch(() => {});
    }
  } catch {
    // Best effort only; never evidence that server work stopped.
  }
}

function stopped(signal: AbortSignal): EmbeddingTransportError {
  return new EmbeddingTransportError(
    signal.reason === 'DEADLINE_EXCEEDED'
      ? 'DEADLINE_EXCEEDED'
      : 'CANCELLED',
  );
}

function live(signal: AbortSignal, deadlineMs: number): void {
  if (signal.aborted) throw stopped(signal);
  if (Date.now() >= deadlineMs) fail('DEADLINE_EXCEEDED');
}

function sanitized(
  error: unknown,
  signal: AbortSignal,
): EmbeddingTransportError {
  if (signal.aborted) return stopped(signal);
  if (error instanceof EmbeddingTransportError) return error;
  if (error instanceof VectorMemoryError) {
    return new EmbeddingTransportError(error.code);
  }
  return new EmbeddingTransportError('ENCODER_UNAVAILABLE');
}

/**
 * Races ignored-signal implementations and consumes late rejection.
 * Late fetch responses receive best-effort body cancellation.
 */
function interruptible<T>(
  pending: PromiseLike<T> | T,
  signal: AbortSignal,
  lateValue: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      if (settled) return;
      cleanup();
      reject(stopped(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    void Promise.resolve(pending).then(
      value => {
        if (settled) {
          try {
            lateValue(value);
          } catch {
            // Cleanup cannot reopen delivery or expose private errors.
          }
          return;
        }
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        cleanup();
        reject(error);
      },
    );

    if (signal.aborted) onAbort();
  });
}

async function boundedJSON(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    /^\d+$/.test(length) &&
    Number(length) > maximum
  ) {
    fail('OUTPUT_TOO_LARGE');
  }

  const contentType = response.headers.get('content-type');
  if (
    !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(
      contentType === null ? '' : contentType,
    )
  ) {
    fail('MALFORMED_OUTPUT');
  }

  const body = response.body;
  if (body === null) fail('MALFORMED_OUTPUT');

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let complete = false;

  try {
    for (;;) {
      const part = await interruptible(
        reader.read(),
        signal,
        () => {},
      );
      if (part.done) {
        complete = true;
        break;
      }
      if (!(part.value instanceof Uint8Array)) {
        fail('MALFORMED_OUTPUT');
      }
      bytes += part.value.byteLength;
      if (bytes > maximum) fail('OUTPUT_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }

    try {
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(Buffer.concat(chunks, bytes));
      return JSON.parse(text) as unknown;
    } catch {
      fail('MALFORMED_OUTPUT');
    }
  } finally {
    if (!complete) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        // Best effort; a pending read/cancel may ignore interruption.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A noncooperating read/cancel may still own the lock.
    }
  }
}

function usageOf(value: unknown): EmbeddingUsage {
  if (value === undefined || value === null) return 'unknown';
  if (!isRecord(value)) fail('MALFORMED_OUTPUT');

  const count = (
    name: 'prompt_tokens' | 'total_tokens',
  ): number | null => {
    if (!Object.hasOwn(value, name)) return null;
    const candidate = value[name];
    if (
      typeof candidate !== 'number' ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      fail('MALFORMED_OUTPUT');
    }
    return candidate;
  };

  return Object.freeze({
    promptTokens: count('prompt_tokens'),
    totalTokens: count('total_tokens'),
  });
}

function snapshotContext(value: WorkContext): WorkContext {
  if (typeof value !== 'object' || value === null) {
    fail('INVALID_CONTEXT');
  }
  const deadlineMs = value.deadlineMs;
  const signal = value.signal;
  if (
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0 ||
    deadlineMs > Date.now() + MAX_EXECUTION_MS ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) {
    fail('INVALID_CONTEXT');
  }
  return Object.freeze({ deadlineMs, signal });
}

function snapshotIdentity(identity: EncoderIdentity): EncoderIdentity {
  const names = [
    'identifier',
    'model',
    'version',
    'dimensions',
    'normalization',
    'implementationDigest',
    'configDigest',
  ] as const;

  if (
    typeof identity !== 'object' ||
    identity === null ||
    !Object.isFrozen(identity) ||
    Reflect.ownKeys(identity).length !== names.length ||
    names.some(name => {
      const descriptor = Object.getOwnPropertyDescriptor(identity, name);
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    fail('INVALID_CONFIG');
  }

  try {
    encoderIdentityKey(identity);
  } catch {
    fail('INVALID_CONFIG');
  }

  return Object.freeze({
    identifier: identity.identifier,
    model: identity.model,
    version: identity.version,
    dimensions: identity.dimensions,
    normalization: identity.normalization,
    implementationDigest: identity.implementationDigest,
    configDigest: identity.configDigest,
  });
}

function validatedVector(value: unknown, dimensions: number): Vector {
  if (!Array.isArray(value)) fail('MALFORMED_OUTPUT');
  const components: readonly unknown[] = value;
  if (components.length !== dimensions) fail('DIMENSION_MISMATCH');

  const numbers: number[] = [];
  for (const component of components) {
    if (typeof component !== 'number') fail('MALFORMED_OUTPUT');
    numbers.push(component);
  }

  // Shared validation retains finite-component, norm and overflow semantics.
  return Object.freeze(validateVector(numbers, dimensions));
}

/**
 * Trusted HTTP adapter, not isolation against a malicious composition root.
 *
 * No environment/auth-file access, SDK runtime creation, model discovery,
 * retries, fallback, registration, grant creation or automatic activation.
 *
 * Application payload/response bounds are not network, billing or server-stop
 * guarantees. Every encode invocation performs at most one fetch handoff.
 */
export function createEmbeddingEncoder(
  options: EmbeddingEncoderOptions,
): EncoderPort {
  if (typeof options !== 'object' || options === null) {
    fail('INVALID_CONFIG');
  }

  const {
    url,
    credential,
    identity,
    fetchImpl,
    authorize,
    audit,
    maxInputChars,
    maxRequestBytes,
    maxResponseBytes,
    transportPolicy,
  } = options;

  if (
    typeof url !== 'string' ||
    typeof credential !== 'string' ||
    !/^[\x21-\x7e]{1,8192}$/.test(credential) ||
    typeof fetchImpl !== 'function' ||
    typeof authorize !== 'function' ||
    typeof audit !== 'function' ||
    !positiveBound(maxInputChars, 100000) ||
    !positiveBound(maxRequestBytes, 1000000) ||
    !positiveBound(maxResponseBytes, 4000000)
  ) {
    fail('INVALID_CONFIG');
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    fail('INVALID_CONFIG');
  }

  if (target.username || target.password || target.hash) {
    fail('INVALID_CONFIG');
  }

  if (transportPolicy === 'https') {
    if (target.protocol !== 'https:') fail('INVALID_CONFIG');
  } else if (transportPolicy === 'owned-loopback-http') {
    if (
      target.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(target.hostname)
    ) {
      fail('INVALID_CONFIG');
    }
  } else {
    fail('INVALID_CONFIG');
  }

  const frozenIdentity = snapshotIdentity(identity);
  const key = encoderIdentityKey(frozenIdentity);
  const requestURL = target.href;

  const port: EncoderPort = {
    identity: frozenIdentity,

    async encode(text: string, supplied: WorkContext): Promise<Vector> {
      const ctx = snapshotContext(supplied);
      if (typeof text !== 'string' || text.length === 0) {
        fail('INVALID_TEXT');
      }
      if (text.length > maxInputChars) fail('TEXT_TOO_LONG');

      const body = JSON.stringify({
        model: frozenIdentity.model,
        input: text,
        encoding_format: 'float',
      });

      if (
        Buffer.byteLength(text, 'utf8') > maxRequestBytes ||
        Buffer.byteLength(body, 'utf8') > maxRequestBytes
      ) {
        fail('TEXT_TOO_LONG');
      }

      const inputDigest = textDigest(text);
      const bodyHash = payloadHash(body);
      const controller = new AbortController();
      const forwardAbort = (): void => controller.abort('CANCELLED');

      if (ctx.signal !== undefined) {
        ctx.signal.addEventListener('abort', forwardAbort, { once: true });
        if (ctx.signal.aborted) forwardAbort();
      }

      const timer = setTimeout(
        () => controller.abort('DEADLINE_EXCEEDED'),
        Math.max(0, ctx.deadlineMs - Date.now()),
      );

      let handedOff = false;
      let response: Response | undefined;
      let reportedModel: string | null = null;
      let reportedModelDigest: TextDigest | null = null;
      let reportedDimensions: number | null = null;
      let usage: EmbeddingUsage = 'unknown';
      let httpStatus: number | null = null;

      const emit = (
        phase: EmbeddingAuditPhase,
        code: EmbeddingTransportErrorCode | null,
      ): void => {
        const event: EmbeddingAuditEvent = Object.freeze({
          phase,
          code,
          payloadHash: bodyHash,
          inputDigest,
          encoderKey: key,
          requestedModel: frozenIdentity.model,
          requestedDimensions: frozenIdentity.dimensions,
          reportedModel,
          reportedModelDigest,
          reportedDimensions,
          usage,
          httpStatus,
          handedOff,
          transmission: handedOff
            ? 'may-have-occurred'
            : 'not-handed-off',
          serverStop: handedOff ? 'unknown' : 'not-applicable',
        });

        try {
          const result: unknown = audit(event);
          if (result !== undefined) {
            discardCallbackPromise(result);
            fail('AUDIT_UNAVAILABLE');
          }
        } catch {
          fail('AUDIT_UNAVAILABLE');
        }
      };

      const permitted = (): void => {
        live(controller.signal, ctx.deadlineMs);
        if (encoderIdentityKey(identity) !== key) {
          fail('ENCODER_MISMATCH');
        }

        let allowed: unknown;
        try {
          allowed = authorize(inputDigest, key);
        } catch {
          fail('GRANT_DENIED');
        }

        if (allowed !== true) {
          discardCallbackPromise(allowed);
          fail('GRANT_DENIED');
        }

        // A synchronous host callback can cancel or consume the deadline.
        live(controller.signal, ctx.deadlineMs);
        if (encoderIdentityKey(identity) !== key) {
          fail('ENCODER_MISMATCH');
        }
      };

      try {
        permitted();
        emit('prepared', null);
        permitted();

        // No await, audit callback or injected operation between final
        // authorization/identity checks and this fetch invocation.
        handedOff = true;
        const pending = fetchImpl(requestURL, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${credential}`,
          },
          body,
          signal: controller.signal,
        });

        response = await interruptible(
          pending,
          controller.signal,
          cancelBody,
        );

        permitted();
        if (!(response instanceof Response)) fail('MALFORMED_OUTPUT');

        httpStatus = response.status;
        if (
          response.redirected ||
          (response.status >= 300 && response.status < 400)
        ) {
          fail('REDIRECT_FORBIDDEN');
        }
        if (!response.ok) fail('HTTP_ERROR');

        const output = await boundedJSON(
          response,
          maxResponseBytes,
          controller.signal,
        );

        permitted();
        if (!isRecord(output)) fail('MALFORMED_OUTPUT');

        // Never retain arbitrary provider strings in audit/error messages.
        if (typeof output.model === 'string') {
          reportedModelDigest = textDigest(output.model);
          if (output.model === frozenIdentity.model) {
            reportedModel = output.model;
          }
        }
        if (output.model !== frozenIdentity.model) {
          fail('ENCODER_MISMATCH');
        }

        if (!Array.isArray(output.data) || output.data.length !== 1) {
          fail('MALFORMED_OUTPUT');
        }
        const row: unknown = output.data[0];
        if (!isRecord(row) || row.index !== 0) {
          fail('MALFORMED_OUTPUT');
        }

        const raw = row.embedding;
        if (Array.isArray(raw)) reportedDimensions = raw.length;
        usage = usageOf(output.usage);

        const vector = validatedVector(raw, frozenIdentity.dimensions);
        emit('validated', null);
        permitted();
        return vector;
      } catch (error: unknown) {
        const safe = sanitized(error, controller.signal);
        emit('failed', safe.code);
        throw safe;
      } finally {
        clearTimeout(timer);
        if (ctx.signal !== undefined) {
          ctx.signal.removeEventListener('abort', forwardAbort);
        }
        cancelBody(response);
      }
    },
  };

  return Object.freeze(port);
}
