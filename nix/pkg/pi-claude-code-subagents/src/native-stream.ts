import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { NATIVE_LOGICAL_BYTES } from "./native-framing.ts";

const MAX_QUEUED_EVENTS = 1024;

export function observeNativeOriginal(source: AssistantMessageEventStream, result: Promise<AssistantMessage>, onBareEnd: (error: Error) => void): AssistantMessageEventStream {
  let settled = false;
  let consumed = false;
  void result.then(() => { settled = true; }, () => { settled = true; });
  const bareEnd = (): never => {
    const error = new Error("STREAM_ENDED_WITHOUT_MESSAGE: native original ended without an assistant message");
    onBareEnd(error);
    throw error;
  };
  return {
    result: () => result,
    [Symbol.asyncIterator]: () => {
      if (consumed) throw new Error("INVALID: native original iterator already consumed");
      consumed = true;
      const iterator = source[Symbol.asyncIterator]();
      let terminal = false;
      const observed: AsyncIterator<AssistantMessageEvent> = {
        next: async () => {
          const next = await iterator.next();
          if (next.done === true && !terminal) {
            if (!settled) await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (!settled) return bareEnd();
            const message = await result;
            if (typeof message !== "object" || message === null) return bareEnd();
          } else if (next.done !== true && (next.value.type === "done" || next.value.type === "error")) terminal = true;
          return next;
        },
      };
      if (typeof iterator.return === "function") observed.return = iterator.return.bind(iterator);
      if (typeof iterator.throw === "function") observed.throw = iterator.throw.bind(iterator);
      return observed;
    },
  } as unknown as AssistantMessageEventStream;
}

export class NativeEventQueue implements AsyncIterator<AssistantMessageEvent> {
  private readonly events: Array<{ event: AssistantMessageEvent; bytes: number }> = [];
  private bytes = 0;
  private ended = false;
  private failure: Error | null = null;
  private waiting: { resolve(value: IteratorResult<AssistantMessageEvent>): void; reject(error: Error): void } | null = null;

  constructor(source: AsyncIterator<AssistantMessageEvent>, abort: AbortController) {
    const cancelled = (): void => this.fail(new Error("NOT_RUNNING: native stream cancelled"));
    abort.signal.addEventListener("abort", cancelled, { once: true });
    if (abort.signal.aborted) cancelled();
    void this.pump(source).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error("native stream failed"));
      abort.abort();
      if (typeof source.return === "function") void Promise.resolve(source.return()).catch(() => {});
    }).finally(() => { abort.signal.removeEventListener("abort", cancelled); });
  }

  next(): Promise<IteratorResult<AssistantMessageEvent>> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const next = this.events.shift();
    if (next !== undefined) { this.bytes -= next.bytes; return Promise.resolve({ done: false, value: next.event }); }
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    if (this.waiting !== null) return Promise.reject(new Error("INVALID: concurrent native consumer"));
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }

  private fail(error: Error): void {
    if (this.failure !== null) return;
    this.failure = error;
    this.events.length = 0;
    this.bytes = 0;
    if (this.waiting !== null) { this.waiting.reject(error); this.waiting = null; }
  }

  private async pump(source: AsyncIterator<AssistantMessageEvent>): Promise<void> {
    for (;;) {
      const next = await source.next();
      if (this.failure !== null) return;
      if (next.done === true) {
        this.ended = true;
        if (this.waiting !== null) { this.waiting.resolve({ done: true, value: undefined }); this.waiting = null; }
        return;
      }
      const snapshot = structuredClone(next.value);
      const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
      if (bytes > NATIVE_LOGICAL_BYTES || this.events.length >= MAX_QUEUED_EVENTS || this.bytes + bytes > NATIVE_LOGICAL_BYTES) throw new Error("PAYLOAD_TOO_LARGE: native event queue overflow");
      if (this.waiting !== null) { this.waiting.resolve({ done: false, value: snapshot }); this.waiting = null; }
      else { this.events.push({ event: snapshot, bytes }); this.bytes += bytes; }
      if (snapshot.type === "done" || snapshot.type === "error") { this.ended = true; return; }
    }
  }
}
