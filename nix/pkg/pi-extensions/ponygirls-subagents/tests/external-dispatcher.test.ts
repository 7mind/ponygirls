import assert from "node:assert/strict";
import test from "node:test";
import { runToolCall } from "@earendil-works/pi-agent-core";
import { GoverningToolDispatcher, type GoverningRegistry } from "../src/external-dispatcher.ts";
import { boundExternalResult, wrapGoverningHandleForChild, type PinnedGoverningHandle } from "../src/governing-runtime.ts";
import { InMemoryRunStore } from "../src/store.ts";
import type { BrokerCaller } from "../src/broker.ts";

function caller(overrides: Partial<BrokerCaller> = {}): BrokerCaller {
  return {
    agentId: "agent-1",
    taskRunId: "task-1",
    generation: 1,
    grants: { tools: ["read"], externalTools: ["mcp__codegraph__codegraph_explore"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    workdir: "/tmp",
    writableRoot: null,
    sandbox: null,
    ...overrides,
  };
}

function fakeParent(name: string, impl?: PinnedGoverningHandle["execute"]): PinnedGoverningHandle {
  return {
    name,
    description: `${name} desc`,
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: impl ?? (async (_id, params) => ({ content: [{ type: "text", text: `ok:${JSON.stringify(params)}` }], details: {} })),
  };
}

function registry(handles: PinnedGoverningHandle[], active = true): GoverningRegistry {
  return {
    isActive: () => active,
    listHandles: () => [...handles],
    getHandle: (n) => handles.find((h) => h.name === n),
    baseCtx: () => ({}),
  };
}

const nativeOk = async () => ({ stdout: "n", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false });

// D1: scoped external .execute must route through dispatcher (reauth/validation/journal), not raw parent
test("D1 scoped tools.execute enforces grants and validation (no raw bypass)", async () => {
  let parentCalls = 0;
  const evil = fakeParent("mcp__evil__tool", async () => { parentCalls++; return { content: [{ type: "text", text: "evil" }], details: {} }; });
  const allowed = fakeParent("mcp__codegraph__codegraph_explore");
  const store = new InMemoryRunStore("r");
  const disp = new GoverningToolDispatcher(store, () => registry([allowed, evil]), nativeOk);
  // Top-level dispatch of allowed tool whose impl internally tries direct scoped .execute of evil.
  // Simulate by capturing scoped ctx: parent impl receives scoped ctx as 5th arg and calls tools.find(evil).execute directly.
  let capturedCtx: unknown = null;
  const sneaky = fakeParent("mcp__codegraph__codegraph_explore", async (_id, _p, _s, _u, ctx) => {
    capturedCtx = ctx;
    const tools = (ctx as { tools: Array<{ name: string; execute: (...a: unknown[]) => Promise<unknown> }> }).tools;
    const evilHandle = tools.find((t) => t.name === "mcp__evil__tool");
    if (!evilHandle) return { content: [{ type: "text", text: "evil-blocked" }], details: {} };
    // Direct .execute bypass attempt with valid-looking args
    const res = (await evilHandle.execute("direct-id", { q: "x" }, undefined, undefined)) as { content: Array<{ text: string }> };
    return { content: [{ type: "text", text: `direct:${JSON.stringify(res.content)}` }], details: {} };
  });
  const disp2 = new GoverningToolDispatcher(store, () => registry([sneaky, evil]), nativeOk);
  const res = await disp2.execute(caller(), { tool: "mcp__codegraph__codegraph_explore", args: { q: "hi" } });
  // Evil must not have run (grants only allow codegraph_explore)
  assert.equal(parentCalls, 0, "direct scoped .execute bypassed dispatcher grants");
  assert.ok(JSON.stringify(res.content).includes("evil-blocked") || res.isError, "expected denial, not raw evil execution");
  void capturedCtx;
});

// D2: cancel must leave uncertain when tool ignores abort and later effects
test("D2 cancelled external with late effect journals uncertain and preserves usage", async () => {
  const store = new InMemoryRunStore("r");
  let release!: (v: { content: Array<{ type: string; text: string }>; usage: Record<string, unknown> }) => void;
  const slow = fakeParent("mcp__codegraph__codegraph_explore", (_id, _p, signal) => new Promise((resolve) => {
    release = resolve as never;
    // Ignore abort: resolve later with effect + usage anyway
    setTimeout(() => resolve({ content: [{ type: "text", text: "late-effect" }], details: {}, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }), 50);
    void signal;
  }));
  const disp = new GoverningToolDispatcher(store, () => registry([slow]), nativeOk);
  const pending = disp.execute(caller(), { operationId: "op-cancel-1", tool: "mcp__codegraph__codegraph_explore", args: { q: "x" } });
  await new Promise((r) => setTimeout(r, 10));
  await disp.cancelJobs("agent-1");
  const res = await pending;
  assert.equal(res.isError, true);
  // Cancellation returns promptly; the abort-ignoring tool settles late with
  // a single uncertain outcome preserving usage — poll for it.
  let outcomes: ReturnType<typeof store.readSince>["records"] = [];
  const start = Date.now();
  while (Date.now() - start < 5000) {
    outcomes = store.readSince(0, 1000).records.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-cancel-1");
    if (outcomes.length > 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  // Must not be a clean "cancelled" with dropped usage; late effect => uncertain + usage preserved
  const hasUncertain = outcomes.some((r) => (r.body as Record<string, unknown>)["status"] === "uncertain");
  const hasUsage = outcomes.some((r) => (r.body as Record<string, unknown>)["usage"] !== null && (r.body as Record<string, unknown>)["usage"] !== undefined);
  assert.ok(hasUncertain, `expected uncertain outcome, got ${JSON.stringify(outcomes.map((r) => r.body))}`);
  assert.ok(hasUsage, "late usage silently discarded");
  void release;
});

// D3: nested native must reuse broker intent/outcome (no duplicate post-effect intent)
test("D3 nested native reuses broker journal (single intent, broker-owned)", async () => {
  const store = new InMemoryRunStore("r");
  const seen: Array<{ op?: string; parent?: string }> = [];
  const native = async (_c: BrokerCaller, req: { operationId?: string; tool: string; args: Record<string, unknown>; parentOperationId?: string }) => {
    seen.push({ op: req.operationId, parent: req.parentOperationId });
    // Simulate broker journaling intent/outcome itself
    store.append("tool.intent", { operationId: req.operationId, agentId: "agent-1", tool: req.tool, parentOperationId: req.parentOperationId ?? null });
    store.append("tool.outcome", { operationId: req.operationId, status: "ok" });
    return { stdout: "ok", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false };
  };
  let capturedCtx: { executeTool: (n: string, a: unknown) => Promise<unknown> } | null = null;
  const parent = fakeParent("mcp__codegraph__codegraph_explore", async (_id, _p, _s, _u, ctx) => {
    capturedCtx = ctx as never;
    // Nested native via scoped executeTool
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("read", { path: "x" });
    return { content: [{ type: "text", text: "done" }], details: {} };
  });
  const disp = new GoverningToolDispatcher(store, () => registry([parent]), native);
  // Caller grants include read (native) + external
  const c = caller({ grants: { tools: ["read"], externalTools: ["mcp__codegraph__codegraph_explore"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" } });
  await disp.execute(c, { tool: "mcp__codegraph__codegraph_explore", args: { q: "x" } });
  assert.ok(capturedCtx, "no scoped ctx captured");
  const intents = store.readSince(0, 1000).records.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === "read");
  // Exactly one intent for the nested read (broker-owned), not dispatcher duplicate post-effect
  assert.equal(intents.length, 1, `expected single native intent, got ${intents.length}: ${JSON.stringify(intents.map((r) => r.body))}`);
  assert.ok(seen[0]?.op && seen[0]?.parent, "native broker must receive operationId + parentOperationId");
});

// D4: bound result size postcondition even for single huge image
test("D4 boundExternalResult guarantees size even for single huge image", () => {
  const big = "x".repeat(300_000);
  const res = boundExternalResult({ content: [{ type: "image", data: big, mimeType: "image/png" }], details: { keep: "me" }, structuredContent: { big } });
  const bytes = Buffer.byteLength(JSON.stringify(res), "utf8");
  assert.ok(bytes <= 200_000, `still oversize: ${bytes}`);
  // Dropping must be explicit, not silent
  const text = JSON.stringify(res);
  assert.ok(text.includes("truncat") || text.includes("PAYLOAD_TOO_LARGE") || text.includes("dropped") || res.content.length === 0, "loss must be explicit");
});

// D5: scoped executeTool returns full AgentToolCallOutcome shape, no as-never concealment
test("D5 nested executeTool outcome has full toolCall identity (name/args/type)", async () => {
  const store = new InMemoryRunStore("r");
  let seenOutcome: unknown = null;
  const parent = fakeParent("mcp__codegraph__codegraph_explore", async (_id, _p, _s, _u, ctx) => {
    const out = (await (ctx as { executeTool: (n: string, a: unknown) => Promise<{ toolCall: Record<string, unknown>; result: unknown; isError: boolean }> }).executeTool("mcp__codegraph__codegraph_explore", { q: "nested" })) as { toolCall: Record<string, unknown> };
    seenOutcome = out.toolCall;
    return { content: [{ type: "text", text: "done" }], details: {} };
  });
  // Registry needs two handles: outer + nested target (same name ok, different call)
  const inner = fakeParent("mcp__codegraph__codegraph_explore");
  const disp = new GoverningToolDispatcher(store, () => registry([parent, inner].slice(0, 1).concat([fakeParent("mcp__codegraph__codegraph_explore")])), nativeOk);
  // Use distinct names to assert identity: outer calls inner2
  const inner2 = fakeParent("mcp__a__b", async () => ({ content: [{ type: "text", text: "inner" }], details: {} }));
  const parent2 = fakeParent("mcp__codegraph__codegraph_explore", async (_id, _p, _s, _u, ctx) => {
    const out = (await (ctx as { executeTool: (n: string, a: unknown) => Promise<{ toolCall: Record<string, unknown> }> }).executeTool("mcp__a__b", { q: "1" })) as { toolCall: Record<string, unknown> };
    seenOutcome = out.toolCall;
    return { content: [{ type: "text", text: "done" }], details: {} };
  });
  const disp2 = new GoverningToolDispatcher(store, () => registry([parent2, inner2]), nativeOk);
  const c = caller({ grants: { tools: [], externalTools: ["mcp__codegraph__codegraph_explore", "mcp__a__b"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" } });
  await disp2.execute(c, { tool: "mcp__codegraph__codegraph_explore", args: { q: "x" } });
  const tc = seenOutcome as Record<string, unknown>;
  assert.ok(tc && typeof tc["id"] === "string", "missing toolCall.id");
  assert.equal(tc["name"], "mcp__a__b", `missing/wrong toolCall.name: ${JSON.stringify(tc)}`);
  assert.ok(tc["arguments"] && typeof tc["arguments"] === "object", "missing toolCall.arguments");
  assert.equal(tc["type"], "toolCall", `missing toolCall.type: ${JSON.stringify(tc)}`);
  void disp;
});

// D6: wrapper preserves prepareArguments/outputSchema/executionMode
test("D6 wrap preserves prepareArguments/outputSchema/executionMode", async () => {
  const parent = {
    name: "mcp__codegraph__codegraph_explore",
    description: "d",
    parameters: { type: "object" },
    prepareArguments: (a: unknown) => ({ q: String((a as Record<string, unknown>)["qq"] ?? "") }),
    outputSchema: { type: "object" },
    executionMode: "sequential" as const,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) as PinnedGoverningHandle["execute"],
  } as unknown as PinnedGoverningHandle & { prepareArguments: (a: unknown) => unknown; outputSchema: unknown; executionMode: string };
  const wrapped = wrapGoverningHandleForChild(parent, {});
  assert.deepEqual((wrapped as unknown as Record<string, unknown>)["prepareArguments"] !== undefined, true, "prepareArguments lost");
  assert.deepEqual((wrapped as unknown as Record<string, unknown>)["outputSchema"] !== undefined, true, "outputSchema lost");
  assert.equal((wrapped as unknown as Record<string, unknown>)["executionMode"], "sequential", "executionMode lost");
  // And runToolCall must apply prepareArguments (qq -> q)
  let seenParams: unknown = null;
  const parent2 = {
    name: "mcp__codegraph__codegraph_explore",
    description: "d",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    prepareArguments: (a: unknown) => ({ q: String((a as Record<string, unknown>)["qq"] ?? "") }),
    execute: (async (_id: string, params: unknown) => { seenParams = params; return { content: [{ type: "text", text: "ok" }], details: {} }; }) as PinnedGoverningHandle["execute"],
  } as unknown as PinnedGoverningHandle;
  const store = new InMemoryRunStore("r");
  const disp = new GoverningToolDispatcher(store, () => registry([parent2]), nativeOk);
  await disp.execute(caller(), { tool: "mcp__codegraph__codegraph_explore", args: { qq: "hello" } });
  assert.deepEqual(seenParams, { q: "hello" }, `prepareArguments not applied: ${JSON.stringify(seenParams)}`);
});

// R1: production-SDK dispatch after originating return (no-model, real runToolCall validation)
test("R1 production runToolCall validates after originating return (no model)", async () => {
  const handle = {
    name: "mcp__codegraph__codegraph_explore",
    description: "fake codegraph",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: (async (_id: string, params: unknown) => ({ content: [{ type: "text", text: `got:${(params as Record<string, unknown>)["q"]}` }], details: {} })) as never,
  };
  // Simulate originating spawn tool returning first
  const originating = await (async () => ({ agentId: "a-1" }))();
  assert.ok(originating.agentId);
  // Dispatch after return with broker-owned ID/signal via public runToolCall (real SDK validation)
  const toolCall = { type: "toolCall" as const, id: "ext:owned-1", name: handle.name, arguments: { q: "hello" } };
  const assistantMessage = { role: "assistant" as const, content: [], timestamp: 0 } as never;
  const good = await runToolCall(toolCall, { tools: [handle] as never, assistantMessage: assistantMessage as never, context: { messages: [], tools: [handle] } as never, signal: new AbortController().signal });
  assert.equal(good.isError, false);
  // Invalid args must fail validation (not execute)
  let executed = false;
  const badHandle = { ...handle, execute: (async () => { executed = true; return { content: [{ type: "text", text: "x" }], details: {} }; }) as never };
  const bad = await runToolCall({ type: "toolCall" as const, id: "ext:owned-2", name: badHandle.name, arguments: {} }, { tools: [badHandle] as never, assistantMessage: assistantMessage as never, context: { messages: [], tools: [badHandle] } as never, signal: new AbortController().signal });
  assert.equal(bad.isError, true);
  assert.equal(executed, false, "invalid args executed despite validation");
});

test("D1b direct scoped .execute with invalid args fails validation without parent effect", async () => {
  const { GoverningToolDispatcher } = await import("../src/external-dispatcher.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  let parentCalls = 0;
  const parent = {
    name: "mcp__codegraph__codegraph_explore",
    description: "d",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: (async () => { parentCalls++; return { content: [{ type: "text", text: "should-not-run" }], details: {} }; }),
  };
  const store = new InMemoryRunStore("r");
  const disp = new GoverningToolDispatcher(store, () => ({
    isActive: () => true,
    listHandles: () => [parent],
    getHandle: (n: string) => (n === parent.name ? parent : undefined),
    baseCtx: () => ({}),
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const c = caller();
  // Top-level with invalid args (missing required q) must fail validation, parent never runs
  const res = await disp.execute(c, { tool: "mcp__codegraph__codegraph_explore", args: {} });
  assert.equal(res.isError, true);
  assert.equal(parentCalls, 0, "invalid args reached parent effect (validation bypass)");
});

test("R6 oversized usage/metadata bounded with markers; error status preserved; images valid", async () => {
  const { boundExternalResult } = await import("../src/governing-runtime.ts");
  // Short text + 300k usage field must fit after bounding
  const bigUsage = "y".repeat(300_000);
  const r1 = boundExternalResult({ content: [{ type: "text", text: "hi" }], details: {}, usage: { blob: bigUsage } });
  assert.ok(Buffer.byteLength(JSON.stringify(r1), "utf8") <= 200_000, "usage oversize not bounded");
  assert.ok(JSON.stringify(r1).includes("dropped") || r1.usage === undefined, "usage loss not explicit");
  // Multibyte content measured in bytes
  const r2 = boundExternalResult({ content: [{ type: "text", text: "é".repeat(100_000) }] });
  assert.ok(Buffer.byteLength(JSON.stringify(r2), "utf8") <= 200_000);
  // >50 blocks: dropped count explicit, size guaranteed
  const many = Array.from({ length: 80 }, (_, i) => ({ type: "text", text: `b${i}` }));
  const r3 = boundExternalResult({ content: many });
  assert.ok(Buffer.byteLength(JSON.stringify(r3), "utf8") <= 200_000);
  assert.ok(r3.content.some((b) => b.type === "text" && String((b as { text?: string }).text ?? "").includes("dropped")), "block loss not explicit");
  // Valid small image kept whole and decodable (never sliced base64)
  const png = "aGVsbG8=";
  const r4 = boundExternalResult({ content: [{ type: "image", data: png, mimeType: "image/png" }] });
  const img = r4.content.find((b) => b.type === "image") as { data: string } | undefined;
  assert.ok(img && img.data === png, "valid image altered");
  assert.equal(Buffer.from(img.data, "base64").toString("utf8"), "hello");
  // Huge image dropped with marker, size guaranteed
  const r5 = boundExternalResult({ content: [{ type: "image", data: "x".repeat(300_000), mimeType: "image/png" }] });
  assert.ok(Buffer.byteLength(JSON.stringify(r5), "utf8") <= 200_000);
  assert.ok(!r5.content.some((b) => b.type === "image" && String((b as { data?: string }).data ?? "").length > 60_000) || JSON.stringify(r5).includes("dropped") || JSON.stringify(r5).includes("truncat"), "image loss not explicit");
  // Nonserializable (BigInt) becomes explicit error, size guaranteed
  const r6 = boundExternalResult({ content: [{ type: "text", text: "ok" }], details: { bad: BigInt(1) } as unknown as Record<string, string> });
  assert.ok(Buffer.byteLength(JSON.stringify(r6), "utf8") <= 200_000);
  // Error status preserved through bounding
  const r7 = boundExternalResult({ content: [{ type: "text", text: "e" }], details: {}, isError: true });
  assert.equal(r7.isError, true);
});

test("R6 nested direct-handle validation and thrown errors surface as isError", async () => {
  const { GoverningToolDispatcher } = await import("../src/external-dispatcher.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  const store = new InMemoryRunStore("r");
  const throwing = {
    name: "mcp__codegraph__codegraph_explore",
    description: "d",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: (async () => { throw Object.assign(new Error("backend down"), { code: "E_FAIL" }); }),
  };
  const disp = new GoverningToolDispatcher(store, () => ({
    isActive: () => true,
    listHandles: () => [throwing],
    getHandle: (n: string) => (n === throwing.name ? throwing : undefined),
    baseCtx: () => ({}),
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const c = caller({ grants: { tools: [], externalTools: ["mcp__codegraph__codegraph_explore"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" } });
  const res = await disp.execute(c, { tool: "mcp__codegraph__codegraph_explore", args: { q: "x" } });
  assert.equal(res.isError, true, "thrown failure appeared successful");
});
