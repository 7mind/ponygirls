/**
 * Delegated calls skip the governing session's tool_call hooks; extensions
 * that must prepare their tool's call (codegraph index preparation) opt in
 * through the delegated-call channel. The prepared arguments reach the
 * tool, a failed preparation blocks it, and cancellation never waits for it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";
import { DELEGATED_CALL_CHANNEL, prepareThroughEventBus, type DelegatedCall, type DelegatedCallEvent } from "../src/delegated-call.ts";

const CG = "mcp__codegraph__codegraph_explore";

function caller(): BrokerCaller {
  return {
    agentId: "a1", taskRunId: "t1", generation: 1,
    grants: { tools: ["read"], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "none" },
    workdir: "/work/child", writableRoot: null, sandbox: null,
  };
}

function recordingHandle(seen: unknown[]): PinnedGoverningHandle {
  return {
    name: CG, description: "d", parameters: { type: "object" },
    execute: async (_id, params) => { seen.push(params); return { content: [{ type: "text", text: "explored" }], details: {} }; },
  };
}

function dispatcher(handle: PinnedGoverningHandle, prepareCall: (call: DelegatedCall) => Promise<Record<string, unknown>> | null): GoverningToolDispatcher {
  return new GoverningToolDispatcher(
    new InMemoryRunStore("r"),
    () => ({ isActive: () => true, listHandles: () => [handle], getHandle: () => handle, baseCtx: () => ({}) }),
    async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }),
    { prepareCall },
  );
}

async function eventBus(): Promise<{ emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void }> {
  const sdk = process.env["PI_SUBAGENTS_SDK_ROOT"];
  assert.ok(sdk, "PI_SUBAGENTS_SDK_ROOT must name the pinned pi-monorepo");
  const mod = (await import(pathToFileURL(join(sdk, "dist/core/event-bus.js")).href)) as { createEventBus: () => { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void } };
  return mod.createEventBus();
}

test("the delegated tool receives the arguments its preparation produced, with the child's workdir", async () => {
  const seen: unknown[] = [];
  const calls: DelegatedCall[] = [];
  const disp = dispatcher(recordingHandle(seen), async (call) => {
    calls.push(call);
    return { ...call.args, projectPath: "/work/child/repo" };
  });
  const res = await disp.execute(caller(), { tool: CG, args: { query: "q", projectPath: "repo" } });
  assert.equal(res.isError, false, JSON.stringify(res.content));
  assert.deepEqual(calls, [{ tool: CG, args: { query: "q", projectPath: "repo" }, workdir: "/work/child" }]);
  assert.deepEqual(seen, [{ query: "q", projectPath: "/work/child/repo" }]);
});

test("an unclaimed call runs with its validated arguments", async () => {
  const seen: unknown[] = [];
  const disp = dispatcher(recordingHandle(seen), () => null);
  const res = await disp.execute(caller(), { tool: CG, args: { query: "q" } });
  assert.equal(res.isError, false);
  assert.deepEqual(seen, [{ query: "q" }]);
});

test("a failed preparation blocks the delegated tool with the preparer's reason", async () => {
  const seen: unknown[] = [];
  const disp = dispatcher(recordingHandle(seen), async () => { throw new Error("Codegraph index unavailable at /work/child/repo"); });
  const res = await disp.execute(caller(), { tool: CG, args: { query: "q" } });
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /BLOCKED: Codegraph index unavailable at \/work\/child\/repo/);
  assert.deepEqual(seen, []);
});

test("cancelling during a long preparation returns promptly and never runs the tool", async () => {
  const seen: unknown[] = [];
  let release: (() => void) | null = null;
  const prepared = new Promise<void>((done) => { release = done; });
  let entered: () => void = () => {};
  const preparing = new Promise<void>((done) => { entered = done; });
  const disp = dispatcher(recordingHandle(seen), async (call) => { entered(); await prepared; return call.args; });
  const pending = disp.execute(caller(), { tool: CG, args: { query: "q" } });
  await preparing;
  await disp.cancelJobs("a1");
  const res = await pending;
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /NOT_RUNNING/);
  release!();
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(seen, [], "the tool must not run after its call was cancelled during preparation");
});

test("event-bus preparation: handlers change a copy in place, block by rejecting, and must claim work synchronously", async () => {
  const bus = await eventBus();
  const args = { query: "q", projectPath: "repo" };
  const off = bus.on(DELEGATED_CALL_CHANNEL, (data) => {
    const event = data as DelegatedCallEvent;
    if (event.toolName !== CG) return;
    event.waitUntil((async () => {
      await new Promise((done) => setTimeout(done, 5));
      event.input["projectPath"] = `${event.cwd}/${String(event.input["projectPath"])}`;
    })());
  });
  assert.deepEqual(await prepareThroughEventBus(bus, { tool: CG, args, workdir: "/work/child" }), { query: "q", projectPath: "/work/child/repo" });
  assert.deepEqual(args, { query: "q", projectPath: "repo" }, "the child's original arguments are not mutated");
  assert.equal(prepareThroughEventBus(bus, { tool: "mcp__other__tool", args, workdir: "/w" }), null, "an unclaimed call has nothing to wait for");
  off();

  const offBlock = bus.on(DELEGATED_CALL_CHANNEL, (data) => { (data as DelegatedCallEvent).waitUntil(Promise.reject(new Error("not prepared"))); });
  const blocked = prepareThroughEventBus(bus, { tool: CG, args, workdir: "/w" });
  assert.ok(blocked);
  await assert.rejects(blocked, /not prepared/);
  offBlock();

  let late: unknown = null;
  const offLate = bus.on(DELEGATED_CALL_CHANNEL, async (data) => {
    await Promise.resolve();
    try { (data as DelegatedCallEvent).waitUntil(Promise.resolve()); } catch (e) { late = e; }
  });
  await prepareThroughEventBus(bus, { tool: CG, args, workdir: "/w" });
  await new Promise((done) => setTimeout(done, 5));
  assert.match(String(late), /must be called synchronously/);
  offLate();
});
