import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { NativeFrameServer, NativeRpcClient, tryPrepareNativeResponse } from "../src/native-framing.ts";
import { NativeEventQueue } from "../src/native-stream.ts";

type DeltaType = Extract<AssistantMessageEvent, { delta: string }>["type"];

function message(): AssistantMessage {
  return {
    role: "assistant", api: "fixture", provider: "fixture", model: "fixture", timestamp: 1,
    stopReason: "pending", content: [{ type: "text", text: "" }, { type: "text", text: "" }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, totalFromProvider: false } },
  };
}

function delta(partial: AssistantMessage, text: string, contentIndex = 0, type: DeltaType = "text_delta"): AssistantMessageEvent {
  return Object.freeze({ type, contentIndex, delta: text, partial });
}

function fixture(events: readonly AssistantMessageEvent[]) {
  const abort = new AbortController();
  let reads = 0;
  let returns = 0;
  const queue = new NativeEventQueue({
    next: async () => {
      const value = events[reads++];
      return value === undefined ? { done: true, value: undefined } : { done: false, value };
    },
    return: async () => { returns++; return { done: true, value: undefined }; },
  }, abort);
  return { queue, abort, reads: () => reads, returns: () => returns };
}

test("native queue stops pulling at capacity and resumes on dequeue", async () => {
  const partial = message();
  const events: AssistantMessageEvent[] = Array.from({ length: 128 }, (_, i) => delta(partial, String(i), i % 2));
  const terminal: AssistantMessageEvent = { type: "done", reason: "stop", message: { ...partial, stopReason: "stop" } };
  events.push(terminal);
  const f = fixture(events);
  try {
    await setImmediate();
    const capacity = f.reads();
    assert.ok(capacity > 0 && capacity <= 64, `pulled ${capacity} entries without a consumer`);
    partial.content[0] = { type: "text", text: "updated after enqueue" };
    const first = await f.queue.next();
    assert.equal(first.done, false);
    assert.ok("partial" in first.value);
    assert.equal(first.value.partial, partial);
    assert.equal(first.value.partial.content[0], partial.content[0]);
    assert.deepEqual(first.value, events[0]);
    await setImmediate();
    assert.equal(f.reads(), capacity + 1);
    for (const event of events.slice(1)) assert.deepEqual(await f.queue.next(), { done: false, value: event });
    assert.deepEqual(await f.queue.next(), { done: true, value: undefined });
    assert.equal(f.reads(), events.length);
  } finally { f.abort.abort(); }
});

test("native queue abort closes a paused source without another dequeue or read", async () => {
  const partial = message();
  const f = fixture(Array.from({ length: 128 }, (_, i) => delta(partial, String(i), i % 2)));
  try {
    await setImmediate();
    const reads = f.reads();
    assert.ok(reads > 0 && reads <= 64);
    f.abort.abort();
    await assert.rejects(f.queue.next(), /NOT_RUNNING: native stream cancelled/);
    await setImmediate();
    assert.equal(f.reads(), reads);
    assert.equal(f.returns(), 1);
  } finally { f.abort.abort(); }
});

test("native queue abort rejects a waiting consumer and does not read again after a late source event", async () => {
  let finish!: (event: IteratorResult<AssistantMessageEvent>) => void;
  const read = new Promise<IteratorResult<AssistantMessageEvent>>((resolve) => { finish = resolve; });
  const abort = new AbortController();
  let reads = 0;
  const queue = new NativeEventQueue({ next: () => { reads++; return read; } }, abort);
  const pending = assert.rejects(queue.next(), /NOT_RUNNING: native stream cancelled/);
  try {
    await assert.rejects(queue.next(), /INVALID: concurrent native consumer/);
    abort.abort();
    await pending;
    finish({ done: false, value: delta(message(), "late") });
    await setImmediate();
    assert.equal(reads, 1);
    await assert.rejects(queue.next(), /NOT_RUNNING: native stream cancelled/);
  } finally { abort.abort(); }
});

test("native queue merges only matching adjacent deltas, keeping live partials and boundaries", async () => {
  const partial = message();
  const other = structuredClone(partial);
  const boundary: AssistantMessageEvent = { type: "text_end", contentIndex: 0, content: "a🦄", partial };
  const terminal: AssistantMessageEvent = { type: "error", reason: "error", error: { ...partial, stopReason: "error" } };
  const long = "a".repeat(6 * 1024);
  const first = delta(partial, "a");
  const events = [first, delta(partial, "\ud83e"), delta(partial, "\udd84"), boundary,
    delta(partial, "b"), delta(partial, "c", 1), delta(other, "d", 1),
    delta(other, "e", 1, "thinking_delta"), delta(other, "f", 1, "thinking_delta"),
    delta(other, "x", 1, "toolcall_delta"), delta(other, "y", 1, "toolcall_delta"),
    delta(partial, long), delta(partial, long), terminal];
  const f = fixture(events);
  try {
    await setImmediate();
    for (const expected of [delta(partial, "a🦄"), boundary, events[4], events[5], events[6],
      delta(other, "ef", 1, "thinking_delta"), delta(other, "xy", 1, "toolcall_delta"), events[11], events[12], terminal]) {
      const next = await f.queue.next();
      assert.equal(next.done, false);
      assert.deepEqual(next.value, expected);
      if ("partial" in expected) {
        assert.ok("partial" in next.value);
        assert.equal(next.value.partial, expected.partial);
      }
    }
    assert.deepEqual(await f.queue.next(), { done: true, value: undefined });
    assert.deepEqual(first, delta(partial, "a"));
  } finally { f.abort.abort(); }
});

test("native queue splits a batch that would exceed the serialized response limit", async () => {
  const partial = message();
  const piece = "\\\"🦄".repeat(4);
  const first = delta(partial, piece);
  const second = delta(partial, piece);
  const terminal: AssistantMessageEvent = { type: "done", reason: "stop", message: { ...partial, stopReason: "stop" } };
  const f = fixture([first, second, delta(partial, "a", 1), delta(partial, "b", 1), terminal]);
  const limit = Buffer.byteLength(JSON.stringify({ done: false, event: first }), "utf8");
  const attempts: AssistantMessageEvent[] = [];
  const server = new NativeFrameServer<string>(async () => {
    let prepared: ReturnType<typeof tryPrepareNativeResponse>;
    const next = await f.queue.next((event) => {
      attempts.push(event);
      prepared = tryPrepareNativeResponse({ done: false, event }, limit);
      return prepared !== undefined;
    });
    return prepared ?? { done: next.done, event: next.value };
  }, (owner) => owner);
  try {
    await setImmediate();
    const client = new NativeRpcClient();
    for (const expected of [first, second, delta(partial, "ab", 1), terminal]) {
      assert.deepEqual(await client.call((frame) => server.handle(frame, "owner"), {}), { done: false, event: expected });
    }
    assert.deepEqual(attempts, [delta(partial, piece + piece), delta(partial, "ab", 1)]);
  } finally { f.abort.abort(); }
});
