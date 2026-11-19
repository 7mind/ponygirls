import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";

const MAX_QUEUED_EVENTS = 32;
const MAX_MERGED_DELTA_CHARS = 8 * 1024;
const MAX_MERGED_DELTA_FRAGMENTS = 64;

type NativeDeltaEvent = Extract<AssistantMessageEvent, { delta: string }>;

interface QueueEntry {
  event: AssistantMessageEvent;
  batch?: { fragments: NativeDeltaEvent[]; splitAt: number | null };
}

function isDelta(event: AssistantMessageEvent): event is NativeDeltaEvent {
  return event.type === "thinking_delta" || event.type === "text_delta" || event.type === "toolcall_delta";
}

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
  private readonly events: QueueEntry[] = [];
  private ended = false;
  private failure: Error | null = null;
  private waiting: { resolve(value: IteratorResult<AssistantMessageEvent>): void; reject(error: Error): void } | null = null;
  private waitingForSpace: (() => void) | null = null;

  constructor(source: AsyncIterator<AssistantMessageEvent>, abort: AbortController) {
    const cancelled = (): void => {
      this.fail(new Error("NOT_RUNNING: native stream cancelled"));
      void Promise.resolve().then(() => source.return?.()).catch(() => {});
    };
    abort.signal.addEventListener("abort", cancelled, { once: true });
    if (abort.signal.aborted) cancelled();
    void this.pump(source).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error("native stream failed"));
      abort.abort();
    }).finally(() => { abort.signal.removeEventListener("abort", cancelled); });
  }

  async next(acceptBatch?: (event: AssistantMessageEvent) => boolean): Promise<IteratorResult<AssistantMessageEvent>> {
    if (this.failure !== null) throw this.failure;
    const head = this.events[0];
    if (head !== undefined) {
      const batch = head.batch;
      let event = head.event;
      if (batch !== undefined) {
        if (batch.splitAt === null && acceptBatch?.(event) === false) batch.splitAt = 0;
        if (batch.splitAt !== null) {
          event = batch.fragments[batch.splitAt++];
          if (batch.splitAt < batch.fragments.length) return { done: false, value: event };
        }
      }
      this.events.shift();
      this.resumePump();
      return { done: false, value: event };
    }
    if (this.ended) return { done: true, value: undefined };
    if (this.waiting !== null) throw new Error("INVALID: concurrent native consumer");
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }

  private fail(error: Error): void {
    if (this.failure !== null) return;
    this.failure = error;
    this.events.length = 0;
    this.resumePump();
    if (this.waiting !== null) { this.waiting.reject(error); this.waiting = null; }
  }

  private resumePump(): void {
    const resume = this.waitingForSpace;
    this.waitingForSpace = null;
    resume?.();
  }

  private enqueue(event: AssistantMessageEvent): void {
    if (this.waiting !== null) {
      this.waiting.resolve({ done: false, value: event });
      this.waiting = null;
      return;
    }
    const entry = this.events.at(-1);
    const tail = entry?.event;
    if (entry !== undefined && tail !== undefined && isDelta(tail) && isDelta(event) &&
        tail.type === event.type && tail.contentIndex === event.contentIndex && tail.partial === event.partial &&
        tail.delta.length + event.delta.length <= MAX_MERGED_DELTA_CHARS &&
        (entry.batch === undefined || (entry.batch.splitAt === null && entry.batch.fragments.length < MAX_MERGED_DELTA_FRAGMENTS))) {
      entry.batch ??= { fragments: [tail], splitAt: null };
      entry.batch.fragments.push(event);
      entry.event = { ...tail, delta: tail.delta + event.delta };
    } else this.events.push({ event });
  }

  private async pump(source: AsyncIterator<AssistantMessageEvent>): Promise<void> {
    while (this.failure === null) {
      if (this.events.length >= MAX_QUEUED_EVENTS) {
        await new Promise<void>((resolve) => { this.waitingForSpace = resolve; });
        if (this.failure !== null) return;
      }
      const next = await source.next();
      if (this.failure !== null) return;
      if (next.done === true) {
        this.ended = true;
        if (this.waiting !== null) { this.waiting.resolve({ done: true, value: undefined }); this.waiting = null; }
        return;
      }
      this.enqueue(next.value);
      if (next.value.type === "done" || next.value.type === "error") { this.ended = true; return; }
    }
  }
}
