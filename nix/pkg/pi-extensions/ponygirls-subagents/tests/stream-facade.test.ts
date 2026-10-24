/**
 * Stream facade unit controls (real pinned SDK streams via the PUBLIC
 * package root factory, no workers, no deep imports).
 * Proves the adapter contract: identical events/objects/full usage on valid
 * paths, explicit rejection on bare EOF, early-close independence, loud
 * setup faults. No provider/network involved.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptStream, isFacadeLocalCompletion } from "../src/stream-facade.ts";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;

function requireSdkRoot(): string {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT must be set (pinned production SDK 1.4.0)");
  const root: string = SDK_ROOT;
  assert.ok(existsSync(root), `pinned SDK root missing: ${root}`);
  const version: unknown = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version;
  assert.equal(version, "1.4.0", `pinned SDK must be 1.4.0 (got ${String(version)})`);
  return root;
}

interface TestStream {
  push: (event: AssistantMessageEvent) => void;
  end: (result?: AssistantMessage) => void;
  result: () => Promise<AssistantMessage>;
  [Symbol.asyncIterator]: () => AsyncIterator<AssistantMessageEvent>;
}

function asTestStream(value: unknown, what: string): TestStream {
  assert.ok(typeof value === "object" && value !== null, `${what} must be an object`);
  const rec = value as Record<string, unknown>;
  assert.ok(typeof rec["push"] === "function", `${what} must have push`);
  assert.ok(typeof rec["end"] === "function", `${what} must have end`);
  assert.ok(typeof rec["result"] === "function", `${what} must have result`);
  const holder = value as { [Symbol.asyncIterator]?: unknown };
  assert.ok(typeof holder[Symbol.asyncIterator] === "function", `${what} must be async-iterable`);
  return value as TestStream;
}

async function createStream(): Promise<TestStream> {
  requireSdkRoot();
  const mod = (await import("@earendil-works/pi-ai")) as Record<string, unknown>;
  const factory: unknown = mod["createAssistantMessageEventStream"];
  assert.ok(typeof factory === "function", "pinned SDK public root must expose the stream factory value");
  const stream: unknown = (factory as () => unknown)();
  return asTestStream(stream, "public factory product");
}

function testMessage(overrides?: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "test-sim",
    model: "sim-1",
    usage: {
      input: 11,
      output: 6,
      cacheRead: 7,
      cacheWrite: 8,
      totalTokens: 32,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 5 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...(overrides ?? {}),
  };
}

function fullUsage(): Record<string, unknown> {
  return {
    input: 11,
    output: 6,
    cacheRead: 7,
    cacheWrite: 8,
    totalTokens: 32,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 5 },
  };
}

test("facade: bare end() rejects explicitly with EOF identity, no hang", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "task-facade-bare", generation: 1 });
  raw.end();
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, []);
  let outcome: string | null = null;
  try {
    await faced.result();
  } catch (error: unknown) {
    outcome = error instanceof Error ? error.message : String(error);
  }
  assert.ok(outcome !== null, "result() must reject, never pend forever");
  assert.ok(outcome.includes("STREAM_ENDED_WITHOUT_MESSAGE"), "explicit owned error, got: " + String(outcome).slice(0, 160));
  assert.ok(outcome.includes("task-facade-bare"), "identity carried");
});

test("facade: normal terminal stream stays identical (events, message, full usage)", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t", generation: 0 });
  const message = testMessage();
  queueMicrotask(() => raw.push({ type: "done", reason: "stop", message }));
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.equal(seen.length, 1, "exactly the provider event relayed");
  assert.equal((seen[0] as AssistantMessageEvent)["type"], "done");
  const out = await faced.result();
  assert.ok(out === message, "identical message object, not a fabrication");
  assert.deepEqual(out.usage, fullUsage(), "full usage untouched");
});

test("facade: error terminal stream stays transparent", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t", generation: 0 });
  const message = testMessage({ stopReason: "error", errorMessage: "boom" });
  queueMicrotask(() => raw.push({ type: "error", reason: "error", error: message }));
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.equal(seen.length, 1);
  const out = await faced.result();
  assert.equal(out["errorMessage"], "boom");
  assert.deepEqual(out["usage"], fullUsage(), "error usage untouched");
});

test("facade: early consumer close never touches the provider stream", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t", generation: 0 });
  const message = testMessage();
  const iterator = faced[Symbol.asyncIterator]();
  await iterator.return?.();
  queueMicrotask(() => raw.push({ type: "done", reason: "stop", message }));
  const out = await faced.result();
  assert.ok(out === message, "pump completed independently; result intact after early close");
});

test("facade: missing result/iterator infrastructure fails loudly at wrap time", async () => {
  // Intentionally malformed producer shapes: the casts below are the test
  // subject itself (untyped JS reaching a typed boundary must fail loudly).
  const badResult = { push: () => {}, end: () => {} } as unknown as Parameters<typeof adaptStream>[0];
  assert.throws(() => adaptStream(badResult, {}, { taskRunId: "t", generation: 0 }), /no supported result/);
  const badIter = { push: () => {}, end: () => {}, result: async () => ({}) } as unknown as Parameters<typeof adaptStream>[0];
  assert.throws(() => adaptStream(badIter, {}, { taskRunId: "t", generation: 0 }), /not async-iterable/);
});

test("facade: synchronous factory throw fails publicly with cause, no hang or abort", async () => {
  const pendingForever: Promise<AssistantMessage> = new Promise(() => {});
  const source = {
    result: () => pendingForever,
    [Symbol.asyncIterator]() {
      throw new Error("SYNC_FACTORY_BOOM");
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-sync-factory", generation: 3 });
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, []);
  let outcome: string | null = null;
  try {
    await faced.result();
  } catch (error: unknown) {
    outcome = error instanceof Error ? error.message : String(error);
  }
  assert.ok(outcome !== null, "factory throw must reject publicly, never hang");
  assert.ok(outcome.includes("STREAM_ITERATION_FAILED"), "owned failure, got: " + String(outcome).slice(0, 160));
  assert.ok(outcome.includes("SYNC_FACTORY_BOOM"), "original cause preserved");
});

test("facade: synchronous next throw fails publicly with cause", async () => {
  const pendingForever: Promise<AssistantMessage> = new Promise(() => {});
  const source = {
    result: () => pendingForever,
    [Symbol.asyncIterator]() {
      return {
        next() {
          throw new Error("SYNC_NEXT_BOOM");
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-sync-next", generation: 3 });
  let outcome: string | null = null;
  try {
    await faced.result();
  } catch (error: unknown) {
    outcome = error instanceof Error ? error.message : String(error);
  }
  assert.ok(outcome !== null && outcome.includes("SYNC_NEXT_BOOM"), "sync next cause preserved, got: " + String(outcome).slice(0, 160));
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, [], "iteration ends after contained next failure");
});

test("facade: synchronous result throw becomes a public rejection, never a sync throw", async () => {
  const source = {
    result() {
      throw new Error("SYNC_RESULT_BOOM");
    },
    async *[Symbol.asyncIterator]() {},
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-sync-result", generation: 3 });
  let outcome: unknown = null;
  let syncThrew = false;
  try {
    outcome = await faced.result().then(
      () => "RESOLVED",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  } catch {
    syncThrew = true;
  }
  assert.equal(syncThrew, false, "result() must return a promise, never throw synchronously");
  assert.ok(typeof outcome === "string" && outcome.includes("SYNC_RESULT_BOOM"), "original cause preserved, got: " + String(outcome).slice(0, 160));
});

test("facade: original rejection joined with concurrent EOF, neither erased", async () => {
  const source = {
    result: () => Promise.reject(new Error("ORIGINAL_FAULT")),
    async *[Symbol.asyncIterator]() {},
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-join", generation: 3 });
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  let outcome: string | null = null;
  try {
    await faced.result();
  } catch (error: unknown) {
    outcome = error instanceof Error ? error.message : String(error);
  }
  assert.ok(outcome !== null && outcome.includes("ORIGINAL_FAULT"), "original preserved, got: " + String(outcome).slice(0, 200));
  assert.ok(outcome.includes("STREAM_ENDED_WITHOUT_MESSAGE"), "secondary EOF preserved, got: " + String(outcome).slice(0, 200));
});

test("facade: push/end stay transparent with genuine SDK semantics (public contract)", async () => {
  // Executable regression for the reproduced read-only facade defect: the
  // pinned public ORIGINAL controls resolve the identical message for both
  // push(done) and end(message), so the facade must too — with reference
  // identity, never a fabrication. Timestamp predates the stream so SDK
  // timing stays a no-op and identity is exact.
  for (const operation of ["push", "end"] as const) {
    const control = await createStream();
    const message = testMessage({ timestamp: 1 });
    if (operation === "push") control.push({ type: "done", reason: "stop", message });
    else control.end(message);
    assert.equal(await control.result(), message, `public SDK ${operation} control must resolve identical message`);
    const raw = await createStream();
    const faced = adaptStream(raw, {}, { taskRunId: "t-contract", generation: 0 });
    if (operation === "push") faced.push({ type: "done", reason: "stop", message });
    else faced.end(message);
    assert.equal(await faced.result(), message, `facade ${operation} must resolve identical message`);
    raw.end(message);
  }
});

test("facade: pushed events join the ordered replay; late pushes drop after done", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-push-order", generation: 0 });
  const first = testMessage({ timestamp: 1 });
  const text: AssistantMessageEvent = { type: "text_delta", contentIndex: 0, delta: "hello", partial: first };
  const done: AssistantMessageEvent = { type: "done", reason: "stop", message: first };
  faced.push(text);
  faced.push(done);
  // A post-done push is dropped with SDK parity, never appended.
  faced.push({ type: "text_delta", contentIndex: 0, delta: "late", partial: first });
  const seen: AssistantMessageEvent[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, [text, done], "single ordered replay with identical event objects");
  assert.equal(await faced.result(), first, "pushed terminal settles result with identical message");
  raw.end(first);
});

test("facade: settled provider outcome is never rewritten by a late push", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-first-wins", generation: 0 });
  const provided = testMessage({ timestamp: 1 });
  const pushed = testMessage({ timestamp: 1 });
  raw.push({ type: "done", reason: "stop", message: provided });
  assert.equal(await faced.result(), provided, "provider outcome settles first");
  faced.push({ type: "done", reason: "stop", message: pushed });
  assert.equal(await faced.result(), provided, "late push never rewrites the settled outcome");
});

test("facade: abort stops the pump but late terminal results still resolve", async () => {
  const raw = await createStream();
  const controller = new AbortController();
  const faced = adaptStream(raw, { signal: controller.signal }, { taskRunId: "t", generation: 0 });
  const seen: unknown[] = [];
  const iterating = (async (): Promise<void> => {
    for await (const event of faced) seen.push(event);
  })();
  controller.abort();
  const message = testMessage();
  raw.push({ type: "done", reason: "stop", message });
  const out = await faced.result();
  assert.ok(out === message, "aborted-then-completed provider response fully observed");
  await iterating;
  assert.ok(seen.length <= 1, "replay ends at buffered prefix after abort-stop");
});

test("facade: valid result with throwing iterator factory is withheld, not published", async () => {
  const message = testMessage({ timestamp: 1 });
  const source = {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      throw new Error("JOIN_FACTORY_BOOM");
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-join-factory", generation: 0 });
  await assert.rejects(() => faced.result(), /STREAM_ITERATION_FAILED.*JOIN_FACTORY_BOOM/, "factory failure joins the public outcome");
  await assert.rejects(() => faced.result(), /valid but unpublished/, "valid result withheld, cause preserved");
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, [], "no events relayed");
});

test("facade: valid result with synchronously throwing next() is withheld, not published", async () => {
  const message = testMessage({ timestamp: 1 });
  const source = {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      return {
        next() {
          throw new Error("JOIN_SYNC_NEXT_BOOM");
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-join-next", generation: 0 });
  await assert.rejects(() => faced.result(), /STREAM_ITERATION_FAILED.*JOIN_SYNC_NEXT_BOOM/, "sync next failure joins the public outcome");
  await assert.rejects(() => faced.result(), /valid but unpublished/, "valid result withheld, cause preserved");
});

test("facade: throwing IteratorResult.done getter fails publicly instead of hanging", async () => {
  const message = testMessage({ timestamp: 1 });
  const evil: Record<string, unknown> = {};
  Object.defineProperty(evil, "done", {
    get() {
      throw new Error("DONE_GETTER_BOOM");
    },
  });
  evil["value"] = { type: "text_delta", contentIndex: 0, delta: "x", partial: message };
  const source = {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      return { next: async () => evil };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-done-getter", generation: 0 });
  await assert.rejects(() => faced.result(), /STREAM_ITERATION_FAILED.*DONE_GETTER_BOOM/, "property-access fault joins the public outcome");
  const seen: unknown[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, [], "replay ends, nothing relayed");
});

test("facade: throwing event.type getter fails publicly instead of hanging", async () => {
  const message = testMessage({ timestamp: 1 });
  const evilEvent: Record<string, unknown> = {};
  Object.defineProperty(evilEvent, "type", {
    get() {
      throw new Error("TYPE_GETTER_BOOM");
    },
  });
  const source = {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: false, value: evilEvent }) };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-type-getter", generation: 0 });
  await assert.rejects(() => faced.result(), /STREAM_ITERATION_FAILED.*TYPE_GETTER_BOOM/, "event property-access fault joins the public outcome");
});

test("facade: early iterator close with failing pump and pending result still rejects publicly", async () => {
  const source = {
    result: () => new Promise<AssistantMessage>(() => {}),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw new Error("CLOSE_NEXT_BOOM");
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-close", generation: 0 });
  const it = faced[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.done, true, "replay ends after pump failure (no hang on close path)");
  await it.return?.();
  await assert.rejects(() => faced.result(), /STREAM_ITERATION_FAILED.*CLOSE_NEXT_BOOM/, "pending result with failed iteration rejects, never hangs");
});

test("facade: provider terminal before any result() call drops a later local push", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-first", generation: 0 });
  const messageM = testMessage({ timestamp: 1 });
  raw.push({ type: "done", reason: "stop", message: messageM });
  // Consume the relayed provider terminal directly, without calling
  // result() first: completion state must already be stable.
  const it = faced[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.done, false, "provider terminal relayed");
  const messageN = testMessage({ timestamp: 1 });
  faced.push({ type: "done", reason: "stop", message: messageN });
  assert.equal(await faced.result(), messageM, "provider terminal wins; late local push dropped");
  assert.ok(!isFacadeLocalCompletion(messageM), "provider message is not a local completion");
  const second = await it.next();
  assert.equal(second.done, true, "dropped push never surfaces in replay");
  await it.return?.();
  raw.end(messageM);
});

test("facade: local end first wins public completion while late genuine ORIGINAL stays distinct", async () => {
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-local-first", generation: 0 });
  const messageN = testMessage({
    timestamp: 1,
    usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  faced.end(messageN);
  assert.ok(isFacadeLocalCompletion(messageN), "end() message marked as local completion");
  const messageM = testMessage({ timestamp: 1 });
  raw.push({ type: "done", reason: "stop", message: messageM });
  assert.ok(!isFacadeLocalCompletion(messageM), "genuine provider message stays distinct");
  assert.equal(await faced.result(), messageN, "first terminal (local end) wins public completion");
  const seen: AssistantMessageEvent[] = [];
  for await (const event of faced) seen.push(event);
  assert.deepEqual(seen, [], "frozen tail: provider events after local end never surface");
  raw.end(messageM);
});

test("facade: deferred pump failure after a bound wait withholds instead of publishing success", async () => {
  // Counterexample regression: source.result() resolves valid M while the
  // owned pump blocks in next() on a controller-owned deferred. A first
  // result() (result-only consumption, no iteration) must NOT publish M
  // merely because the pump is unfinished; rejecting the deferred must join
  // a withheld failure, identically on repeated calls (one stable public
  // completion). Handshakes are counters/flags, never elapsed time.
  const messageM = testMessage({ timestamp: 1 });
  let releaseNext: () => void = () => {};
  const nextGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  let nextCalls = 0;
  const source = {
    result: () => Promise.resolve(messageM),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          nextCalls += 1;
          await nextGate;
          throw new Error("DEFERRED_NEXT_BOOM");
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-deferred", generation: 0 });
  // Handshake 1: the owned pump is blocked inside next() (bounded
  // microtask drain, not a sleep: the deferred cannot resolve by itself).
  for (let i = 0; i < 20 && nextCalls === 0; i += 1) await Promise.resolve();
  assert.equal(nextCalls, 1, "pump entered next() exactly once");
  // Handshake 2: the first public outcome is still unsettled — no
  // bound-expired success is published over the unfinished pump. The yields
  // below are scheduling (they let a bound-expiry timer fire if one were
  // armed); the evidence is the settled flag, never elapsed time.
  const first = faced.result();
  let firstSettled: string | null = null;
  first.then(
    () => {
      firstSettled = "resolved";
    },
    () => {
      firstSettled = "rejected";
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  assert.equal(firstSettled, null, "first result() stays pending while the owned pump is unfinished");
  // Handshake 3: fail the pump; the withheld failure joins publicly.
  releaseNext();
  await assert.rejects(() => first, /STREAM_RESULT_WITHHELD_AFTER_ITERATION_FAILURE.*DEFERRED_NEXT_BOOM/, "deferred pump failure withholds the valid result");
  await assert.rejects(() => first, /valid but unpublished/, "withheld cause preserved");
  // Repeated calls agree (stable completion, no success-then-failure).
  await assert.rejects(() => faced.result(), /STREAM_RESULT_WITHHELD_AFTER_ITERATION_FAILURE.*DEFERRED_NEXT_BOOM/, "repeated result() agrees");
});

test("facade: known result rejection with pending pump fails publicly at once (result-only)", async () => {
  // Counterexample regression: source.result() rejects E while next()
  // blocks on a controller-owned deferred. result() must reject with E
  // without waiting for the pump (no abort, no next() completion), and
  // repeated calls must agree (stable memoized outcome).
  let releaseNext: () => void = () => {};
  const nextGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  let nextCalls = 0;
  const source = {
    result: () => Promise.reject(new Error("KNOWN_RESULT_BOOM")),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          nextCalls += 1;
          await nextGate;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-reject-pending", generation: 0 });
  for (let i = 0; i < 20 && nextCalls === 0; i += 1) await Promise.resolve();
  assert.equal(nextCalls, 1, "pump entered next() exactly once");
  await assert.rejects(() => faced.result(), /KNOWN_RESULT_BOOM/, "known rejection fails publicly without pump completion");
  await assert.rejects(() => faced.result(), /KNOWN_RESULT_BOOM/, "repeated call agrees (stable, no hang)");
  releaseNext();
  await assert.rejects(() => faced.result(), /KNOWN_RESULT_BOOM/, "stable after deferred pump completion too");
});

test("facade: known result rejection terminates SDK replay without hanging consumers", async () => {
  // SDK-loop-shaped consumption (concurrent iteration + result) against a
  // rejecting source with a pending pump: iteration must terminate and
  // result must reject, neither hanging on the deferred next().
  let releaseNext: () => void = () => {};
  const nextGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  const source = {
    result: () => Promise.reject(new Error("LOOP_RESULT_BOOM")),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          await nextGate;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-reject-loop", generation: 0 });
  const seen: unknown[] = [];
  const iterating = (async (): Promise<void> => {
    for await (const event of faced) seen.push(event);
  })();
  await assert.rejects(() => faced.result(), /LOOP_RESULT_BOOM/, "result rejects promptly");
  await iterating;
  assert.deepEqual(seen, [], "replay terminated with nothing relayed");
  releaseNext();
});

test("facade: late-start iteration after known rejection terminates (no missed wakeup)", async () => {
  // Missed-wakeup regression: source.result() rejects while NO consumer
  // iterates (pump blocked on a deferred next). A consumer starting
  // iteration only afterwards must still terminate instead of waiting
  // forever on a wake that already fired with no waiter present. No abort,
  // no next() release. Watchdog fails loudly on hang (liveness guard, the
  // evidence is termination itself).
  let releaseNext: () => void = () => {};
  const nextGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  const source = {
    result: () => Promise.reject(new Error("LATE_START_BOOM")),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          await nextGate;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-late-start", generation: 0 });
  await assert.rejects(() => faced.result(), /LATE_START_BOOM/, "known rejection fails publicly first");
  const seen: unknown[] = [];
  const watchdog = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("LATE_START_HANG: replay never terminated")), 10000);
  });
  await Promise.race([
    (async (): Promise<void> => {
      for await (const event of faced) seen.push(event);
    })(),
    watchdog,
  ]);
  assert.deepEqual(seen, [], "late-start replay terminates empty");
  releaseNext();
  await assert.rejects(() => faced.result(), /LATE_START_BOOM/, "repeated call agrees");
});

test("facade: rejection during buffered-event processing terminates replay (paused consumer)", async () => {
  // Paused-consumer regression: the pump relays one non-terminal event,
  // the consumer takes it and pauses before the next pull, and the known
  // rejection lands in between (wake fires with no waiter). Resuming must
  // drain, then terminate — never hang on the lost wake. No abort, no
  // next() release for the failure itself.
  let releaseNext: () => void = () => {};
  const nextGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  let nextCalls = 0;
  const textEvent = { type: "text_delta", contentIndex: 0, delta: "held", partial: {} };
  const source = {
    result: () => Promise.reject(new Error("PAUSED_CONSUMER_BOOM")),
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          nextCalls += 1;
          if (nextCalls === 1) return { done: false, value: textEvent };
          await nextGate;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-paused", generation: 0 });
  const it = faced[Symbol.asyncIterator]();
  const first = await it.next();
  assert.equal(first.done, false, "buffered event delivered before rejection lands");
  // Let the rejection observation run while paused (macrotask yields, the
  // deferred stays shut): the wake fires with no waiter present.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const watchdog = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PAUSED_HANG: replay never terminated")), 10000);
  });
  const second = await Promise.race([it.next(), watchdog]);
  assert.equal(second.done, true, "resumed replay terminates after drain");
  await it.return?.();
  releaseNext();
  await assert.rejects(() => faced.result(), /PAUSED_CONSUMER_BOOM/, "public failure preserved");
});

test("facade: already-waiting iteration ends when eager rejection lands (no missed wakeup)", async () => {
  // Missed-wakeup ordering regression: a deferred source.result() with a
  // permanently pending next(); facade iteration starts FIRST (replay
  // registers a waiter on the unfinished pump), THEN the source rejects
  // without any facade.result() call. The eager rejection observation must
  // both persist termination state and wake the existing waiter, or the
  // waiter hangs on a wake that already fired. No abort, no next() release.
  // After iteration ends, the original rejection must remain public.
  let rejectSource: (error: unknown) => void = () => {};
  const resultGate = new Promise<AssistantMessage>((_, reject) => {
    rejectSource = reject;
  });
  let nextCalls = 0;
  const source = {
    result: () => resultGate,
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          nextCalls += 1;
          await new Promise<void>(() => {});
          return { done: true, value: undefined };
        },
      };
    },
  };
  const faced = adaptStream(source as unknown as Parameters<typeof adaptStream>[0], {}, { taskRunId: "t-waiting", generation: 0 });
  const seen: unknown[] = [];
  const iterating = (async (): Promise<void> => {
    for await (const event of faced) seen.push(event);
  })();
  // Handshake: the pump is blocked inside next() and replay is waiting
  // (bounded microtask drain; the deferreds cannot resolve by themselves).
  for (let i = 0; i < 20 && nextCalls === 0; i += 1) await Promise.resolve();
  assert.equal(nextCalls, 1, "pump entered next() exactly once");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  // Reject WITHOUT calling facade.result(): the waiter must still release.
  rejectSource(new Error("WAITING_REJECT_BOOM"));
  const watchdog = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("WAITING_HANG: iteration never terminated")), 10000);
  });
  await Promise.race([iterating, watchdog]);
  assert.deepEqual(seen, [], "waiting replay terminated empty");
  await assert.rejects(() => faced.result(), /WAITING_REJECT_BOOM/, "original rejection remains public afterwards");
  await assert.rejects(() => faced.result(), /WAITING_REJECT_BOOM/, "repeated call agrees");
});

test("facade: ORIGINAL end(message) preserves identical message and full Usage (result-only)", async () => {
  // Pinned-SDK ORIGINAL-versus-facade control for raw.end(message): the
  // provider ends cleanly with a valid message and no terminal event (not
  // a facade push/end). The facade must resolve the identical message
  // object with untouched Usage — never withhold it as an EOF failure.
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-original-end", generation: 0 });
  const message = testMessage({ timestamp: 1 });
  raw.end(message);
  const out = await faced.result();
  assert.ok(out === message, "identical message object, not a fabrication");
  assert.deepEqual(out.usage, fullUsage(), "full Usage untouched");
});

test("facade: ORIGINAL end(message) with iteration ends empty and resolves (iterate-then-result)", async () => {
  // Same ORIGINAL path with SDK-loop-shaped consumption: concurrent
  // iteration (yields nothing — no events were pushed) plus result.
  const raw = await createStream();
  const faced = adaptStream(raw, {}, { taskRunId: "t-original-end-it", generation: 0 });
  const message = testMessage({ timestamp: 1 });
  raw.end(message);
  const seen: unknown[] = [];
  const iterating = (async (): Promise<void> => {
    for await (const event of faced) seen.push(event);
  })();
  const out = await faced.result();
  await iterating;
  assert.deepEqual(seen, [], "no events relayed from an eventless ORIGINAL end");
  assert.ok(out === message, "identical message object after iteration");
  assert.deepEqual(out.usage, fullUsage(), "full Usage untouched after iteration");
});
