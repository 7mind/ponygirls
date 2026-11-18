import type { AssistantMessageEventStream, SimpleStreamOptions } from "@earendil-works/pi-ai";

interface OwnedProcess { close(): Promise<void>; }
export interface DelegationContext {
  capability: NativeCapability;
  cwd: string;
  lifecycleSessionId: string;
  beforeEntry(actual: NativeCapability): void;
  captureOriginal(stream: AssistantMessageEventStream): AssistantMessageEventStream;
}
interface Session {
  retired: boolean;
  abort: AbortController;
  pending: Set<Promise<unknown>>;
  workers: Set<OwnedProcess>;
  cleanupFailure: unknown;
}
export interface DelegatedRequest {
  readonly cwd: string;
  readonly signal: AbortSignal;
  beforeEntry(): void;
  captureOriginal(stream: AssistantMessageEventStream): AssistantMessageEventStream;
  own(worker: OwnedProcess): void;
  release(worker: OwnedProcess): void;
  cleanupFailed(error: unknown): void;
  track<T>(pending: Promise<T>): Promise<T>;
}
export interface NativeCapability {
  version: 1;
  readonly apis: readonly string[];
  requestProfile: "canonical-simple-no-provider-hooks-v1";
}

export class NativeSessions {
  private readonly sessions = new Map<string, Session>();
  enter(context: DelegationContext, options: SimpleStreamOptions): DelegatedRequest {
    context.beforeEntry(context.capability);
    let owner = this.sessions.get(context.lifecycleSessionId);
    if (owner === undefined) {
      owner = { retired: false, abort: new AbortController(), pending: new Set(), workers: new Set(), cleanupFailure: null };
      this.sessions.set(context.lifecycleSessionId, owner);
    }
    const session = owner;
    const signal = options.signal === undefined ? session.abort.signal : AbortSignal.any([options.signal, session.abort.signal]);
    const assert = (): void => {
      if (session.retired) throw new Error("Native delegation session retired");
      signal.throwIfAborted();
      context.beforeEntry(context.capability);
    };
    assert();
    return {
      cwd: context.cwd, signal,
      beforeEntry: assert,
      captureOriginal: (stream) => context.captureOriginal(stream),
      own: (worker) => { session.workers.add(worker); },
      release: (worker) => { session.workers.delete(worker); },
      cleanupFailed: (error) => { if (session.cleanupFailure === null) session.cleanupFailure = error; session.retired = true; session.abort.abort(); },
      track: async (pending) => {
        session.pending.add(pending);
        try { return await pending; }
        finally { session.pending.delete(pending); }
      },
    };
  }

  async dispose(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    session.retired = true;
    session.abort.abort();
    const failures: unknown[] = [];
    const join = async (tasks: Promise<unknown>[]): Promise<void> => {
      for (const outcome of await Promise.allSettled(tasks)) if (outcome.status === "rejected") failures.push(outcome.reason);
    };
    const attempted = new Set<OwnedProcess>();
    const closeOwned = (): Promise<void> => join([...session.workers].filter((worker) => !attempted.has(worker)).map((worker) => {
      attempted.add(worker);
      return Promise.resolve().then(() => worker.close());
    }));
    await closeOwned();
    await join([...session.pending]);
    await closeOwned();
    if (session.cleanupFailure !== null) failures.push(session.cleanupFailure);
    if (failures.length > 0) {
      const failure = new AggregateError(failures, "Native delegation cleanup failed");
      if (session.cleanupFailure === null) session.cleanupFailure = failure;
      throw failure;
    }
    this.sessions.delete(id);
  }
}
