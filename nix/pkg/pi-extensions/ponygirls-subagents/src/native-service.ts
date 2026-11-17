import { randomUUID } from "node:crypto";
import type { AssistantMessage, AssistantMessageEvent, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { NATIVE_DELEGATION, type NativeBinding, type NativeDelegationV1, type NativeRequestContext } from "./native-contract.ts";
import type { IpcEnvelope } from "./protocol.ts";
import { NativeFrameServer } from "./native-framing.ts";
import { NativeEventQueue, observeNativeOriginal } from "./native-stream.ts";

const MAX_NATIVE_INVOCATIONS = 8;
const MAX_NATIVE_SESSION_HINT_LENGTH = 256;
const NATIVE_REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface NativeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  reasoning?: number;
  unknown: boolean;
  sourceModel?: { provider: string; id: string; api: string };
}

interface Invocation {
  readonly owner: string;
  readonly abort: AbortController;
  readonly iterator: AsyncIterator<AssistantMessageEvent>;
  readonly result: Promise<AssistantMessage>;
  readonly receiptFailed: () => boolean;
  readonly originalFailure: () => Error | null;
  readonly markUnknown: () => void;
  nextPending: boolean;
  iteratorDone: boolean;
  resultDone: boolean;
}

export function nativeUsage(message: unknown): NativeUsage {
  const unknown: NativeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, unknown: true };
  if (typeof message !== "object" || message === null) return unknown;
  const usage = (message as AssistantMessage).usage;
  if (typeof usage !== "object" || usage === null || ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) || typeof usage.cost !== "object" || usage.cost === null || ![usage.cost.input, usage.cost.output, usage.cost.cacheRead, usage.cost.cacheWrite, usage.cost.total].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return unknown;
  if (usage.reasoning !== undefined && (typeof usage.reasoning !== "number" || !Number.isFinite(usage.reasoning) || usage.reasoning < 0)) return unknown;
  return { ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }), input: usage.input + usage.cacheRead + usage.cacheWrite, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, cost: usage.cost.total, unknown: false };
}

export function nativeOptions(value: unknown): Pick<SimpleStreamOptions, "reasoning" | "maxTokens" | "timeoutMs" | "cacheRetention" | "sessionId"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVALID: native request options");
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some((key) => !["reasoning", "maxTokens", "timeoutMs", "cacheRetention", "sessionId"].includes(key))) throw new Error("INVALID: unsupported native request option");
  if (o["reasoning"] !== undefined && !NATIVE_REASONING_LEVELS.some((level) => level === o["reasoning"])) throw new Error("INVALID: native reasoning");
  for (const key of ["maxTokens", "timeoutMs"]) if (o[key] !== undefined && (!Number.isSafeInteger(o[key]) || (o[key] as number) <= 0)) throw new Error("INVALID: native numeric option");
  if (o["sessionId"] !== undefined && (typeof o["sessionId"] !== "string" || o["sessionId"].length > MAX_NATIVE_SESSION_HINT_LENGTH)) throw new Error("INVALID: native session hint");
  if (o["cacheRetention"] !== undefined && !["none", "short", "long"].some((retention) => retention === o["cacheRetention"])) throw new Error("INVALID: native retention");
  return o as ReturnType<typeof nativeOptions>;
}

export class NativeInferenceService {
  readonly lifecycleSessionId = randomUUID();
  private readonly invocations = new Map<string, Invocation>();
  private readonly capabilities = new Set<NativeDelegationV1>();
  private readonly frames: NativeFrameServer<IpcEnvelope>;
  private retired = false;
  private disposal: Promise<void> | null = null;
  private authorityBarrier: Promise<void> = Promise.resolve();

  private readonly options: {
    binding(): NativeBinding;
    cwd: string;
    assertOwner(envelope: IpcEnvelope): void;
    receipt(envelope: IpcEnvelope, receiptId: string, usage: NativeUsage): boolean;
  };

  constructor(options: NativeInferenceService["options"]) {
    this.options = options;
    this.frames = new NativeFrameServer((value, envelope) => this.invoke(value, envelope), (envelope) => this.owner(envelope));
  }

  async handle(frame: unknown, envelope: IpcEnvelope): Promise<unknown> {
    this.options.assertOwner(envelope);
    const reply = await this.frames.handle(frame, envelope);
    if ((reply as { ok: boolean }).ok !== true) this.cancel();
    return reply;
  }

  refreshAuthority(): Promise<void> {
    this.cancel();
    const previous = this.authorityBarrier;
    const capabilities = [...this.capabilities];
    this.authorityBarrier = previous.then(async () => {
      await Promise.all(capabilities.map((cap) => cap.disposeSession(this.lifecycleSessionId)));
      for (const cap of capabilities) this.capabilities.delete(cap);
    });
    return this.authorityBarrier;
  }

  cancel(): void {
    for (const invocation of this.invocations.values()) { invocation.markUnknown(); invocation.abort.abort(); }
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal;
    this.retired = true;
    this.frames.retire();
    this.cancel();
    this.disposal = this.authorityBarrier.then(() => Promise.all([...this.capabilities].map((cap) => cap.disposeSession(this.lifecycleSessionId)))).then(() => { this.invocations.clear(); });
    return this.disposal;
  }

  private owner(envelope: IpcEnvelope): string { return `${envelope.taskRunId}:${envelope.executionGeneration}`; }

  private async invoke(value: unknown, envelope: IpcEnvelope): Promise<unknown> {
    if (this.retired) throw new Error("STALE_INSTANCE: native session retired");
    if (typeof value !== "object" || value === null) throw new Error("INVALID: native operation");
    const request = value as { kind: string; id: string; context: TranscriptContext; options: unknown };
    if (request.kind === "start") {
      await this.authorityBarrier;
      if (this.retired) throw new Error("STALE_INSTANCE: native service retired");
      this.options.assertOwner(envelope);
      if (this.invocations.size >= MAX_NATIVE_INVOCATIONS) throw new Error("PAYLOAD_TOO_LARGE: too many active native invocations");
      if (typeof request.context !== "object" || request.context === null || !Array.isArray(request.context.messages) || Object.keys(request.context).some((key) => key !== "messages")) throw new Error("INVALID: native canonical transcript");
      const options = nativeOptions(request.options);
      const binding = this.options.binding();
      binding.assertCurrent();
      this.capabilities.add(binding.capability);
      const abort = new AbortController();
      const id = randomUUID();
      const sourceModel = { provider: binding.model.provider, id: binding.model.id, api: binding.model.api };
      let receiptFailed = false;
      const receipt = (message: unknown): void => { if (!this.options.receipt(envelope, id, { ...nativeUsage(message), sourceModel })) receiptFailed = true; };
      let captured = false;
      let originalFailure: Error | null = null;
      let originalSettled = false;
      let unknownReported = false;
      const markUnknown = (): void => {
        if (originalSettled || unknownReported) return;
        unknownReported = true;
        if (!this.options.receipt(envelope, `${id}:unknown`, { ...nativeUsage(undefined), sourceModel })) receiptFailed = true;
      };
      const metadata: NativeRequestContext = {
        capability: binding.capability, cwd: this.options.cwd, lifecycleSessionId: this.lifecycleSessionId,
        beforeEntry: (actual) => {
          if (actual !== binding.capability || this.retired || abort.signal.aborted) throw new Error("NOT_RUNNING: native invocation revoked");
          this.options.assertOwner(envelope);
          binding.assertCurrent();
        },
        captureOriginal: (stream) => {
          if (captured) throw new Error("INVALID: native invocation captured twice");
          captured = true;
          let original: Promise<AssistantMessage>;
          try { original = stream.result(); }
          catch (error) { original = Promise.reject(error); }
          void original.then(
            (message) => { originalSettled = true; receipt(message); },
            () => { originalSettled = true; receipt(undefined); },
          );
          return observeNativeOriginal(stream, original, (error) => { originalFailure = error; });
        },
      };
      const stream = binding.stream(request.context, {
        ...options, sessionId: options.sessionId === undefined || options.sessionId.length === 0 ? undefined : `${this.lifecycleSessionId}:${options.sessionId}`, signal: abort.signal,
        metadata: { [NATIVE_DELEGATION]: metadata },
      });
      const result = stream.result().then((message) => { if (originalFailure !== null) throw originalFailure; return message; });
      const complete = (): void => {
        if (!captured) receipt(undefined);
        else markUnknown();
      };
      void result.then(complete, complete);
      this.invocations.set(id, { owner: this.owner(envelope), abort, iterator: new NativeEventQueue(stream[Symbol.asyncIterator](), abort), result, receiptFailed: () => receiptFailed, originalFailure: () => originalFailure, markUnknown, nextPending: false, iteratorDone: false, resultDone: false });
      return { id };
    }
    const invocation = this.invocations.get(request.id);
    if (invocation === undefined || invocation.owner !== this.owner(envelope)) throw new Error("STALE_GENERATION: native invocation is unavailable");
    try {
      if (request.kind === "cancel") { invocation.abort.abort(); return {}; }
      if (request.kind === "result") {
        try {
          const message = await invocation.result;
          if (invocation.receiptFailed()) throw new Error("STORE_FAILED: native usage receipt is not durably committed");
          return { message: structuredClone(message) };
        } finally { invocation.resultDone = true; }
      }
      if (request.kind === "next") {
        if (invocation.nextPending || invocation.iteratorDone) throw new Error("INVALID: concurrent or completed native iterator");
        invocation.nextPending = true;
        try {
          const event = await invocation.iterator.next();
          const failure = invocation.originalFailure();
          if (failure !== null) throw failure;
          if (invocation.receiptFailed()) throw new Error("STORE_FAILED: native usage receipt is not durably committed");
          invocation.iteratorDone = event.done === true || event.value.type === "done" || event.value.type === "error";
          return event.done === true ? { done: true } : { done: false, event: structuredClone(event.value) };
        } catch (e) { invocation.iteratorDone = true; throw e; }
        finally { invocation.nextPending = false; }
      }
      throw new Error("INVALID: unknown native operation");
    } catch (e) { invocation.abort.abort(); throw e; }
    finally { if (invocation.iteratorDone && invocation.resultDone) this.invocations.delete(request.id); }
  }
}
