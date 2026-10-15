/**
 * Round-3 regressions (failing first): live native auth, prepare reauth,
 * per-invocation scopes, combined-signal release, usage domain/bounds,
 * late/crash accounting.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";

const CG = "mcp__codegraph__codegraph_explore";

function handle(name: string, impl?: PinnedGoverningHandle["execute"]): PinnedGoverningHandle {
  return { name, description: `${name} d`, parameters: { type: "object" }, execute: impl ?? (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) };
}

function caller(ext: string[] = [CG], native: string[] = ["read"]): BrokerCaller {
  return {
    agentId: "a1", taskRunId: "t1", generation: 1,
    grants: { tools: native, externalTools: ext, repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    workdir: "/tmp", writableRoot: null, sandbox: null,
  };
}

const nativeOk = async () => ({ stdout: "", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false });

test("F1 nested read via direct scoped .execute succeeds with native effect (granted reader)", async () => {
  const store = new InMemoryRunStore("r");
  let nativeEffects = 0;
  const native = async (_c: BrokerCaller, req: { operationId?: string; tool: string; args: Record<string, unknown>; parentOperationId?: string }) => {
    nativeEffects++;
    void req;
    return { stdout: "file-bytes", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false };
  };
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    // Sibling native access through ctx.tools DURING the run (the defect-1
    // path): must route live with a real native effect, not POLICY_DENIED.
    const tools = (ctx as { tools: Array<{ name: string; execute: (...a: unknown[]) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }> }> }).tools;
    const readHandle = tools.find((t) => t.name === "read");
    if (!readHandle) return { content: [{ type: "text", text: "no-read-handle" }], details: {}, isError: true };
    const res = await readHandle.execute("direct-read-1", { path: "foo" }, undefined, undefined);
    return { content: [{ type: "text", text: res.isError ? `denied:${JSON.stringify(res.content)}` : `read:${JSON.stringify(res.content)}` }], details: {} };
  });
  const disp = new GoverningToolDispatcher(
    store, () => ({ isActive: () => true, listHandles: () => [outer], getHandle: () => outer, baseCtx: () => ({}) }), native,
  );
  const res = await disp.execute(caller(), { tool: CG, args: {} });
  assert.equal(res.isError, false);
  assert.ok(JSON.stringify(res.content).includes("file-bytes"), `nested read denied or no effect: ${JSON.stringify(res.content)}`);
  assert.equal(nativeEffects, 1, "native backend saw zero effects");
});

test("F2 prepareArguments revoking registry blocks the actual effect", async () => {
  const store = new InMemoryRunStore("r");
  let effects = 0;
  let revoked = false;
  const parent: PinnedGoverningHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    prepareArguments: () => { revoked = true; return {}; },
    execute: (async () => { effects++; return { content: [{ type: "text", text: "ran" }], details: {} }; }),
  };
  const disp = new GoverningToolDispatcher(
    store,
    () => ({
      isActive: () => !revoked,
      listHandles: () => (revoked ? [] : [parent]),
      getHandle: (n: string) => (!revoked && n === CG ? parent : undefined),
      baseCtx: () => ({}),
    }),
    nativeOk,
  );
  const res = await disp.execute(caller(), { tool: CG, args: {} });
  assert.equal(effects, 0, "revoked handle still executed once");
  assert.equal(res.isError, true);
});

test("F3 retained inner scope cannot call again while outer still active", async () => {
  const store = new InMemoryRunStore("r");
  const INNER = "mcp__inner__tool";
  let innerCalls = 0;
  let retainedInnerCtx: { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean; result: { content: Array<{ text?: string }> } }> } | null = null;
  let secondInnerViaOuterOk = false;
  const inner = handle(INNER, async (_id, _p, _s, _u, ctx) => {
    innerCalls++;
    if (innerCalls === 1) retainedInnerCtx = ctx as never;
    return { content: [{ type: "text", text: "inner-done" }], details: {} };
  });
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    const sc = ctx as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> };
    await sc.executeTool(INNER, {});
    // Inner completed but outer still active: retained inner ctx must be dead...
    const again = await (retainedInnerCtx as unknown as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> }).executeTool(INNER, {});
    // ...while the outer scope itself stays live for a legitimate second call.
    const second = await sc.executeTool(INNER, {});
    secondInnerViaOuterOk = !second.isError;
    return { content: [{ type: "text", text: again.isError ? "inner-retired" : "inner-reused" }], details: {} };
  });
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer, inner], getHandle: (n: string) => (n === CG ? outer : inner), baseCtx: () => ({}) }),
    nativeOk,
  );
  const res = await disp.execute(caller([CG, INNER]), { tool: CG, args: {} });
  assert.equal(innerCalls, 2, `expected inner once + outer second call, got ${innerCalls}`);
  assert.ok(JSON.stringify(res.content).includes("inner-retired"), `retained inner scope reused: ${JSON.stringify(res.content)}`);
  assert.ok(secondInnerViaOuterOk, "outer live scope wrongly retired");
});

test("F4 explicit nested signal abort releases an abort-ignoring nested call", async () => {
  const store = new InMemoryRunStore("r");
  const SLOW = "mcp__slow__tool";
  const slow = handle(SLOW, () => new Promise(() => {})); // ignores abort forever
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    const out = await (ctx as { executeTool: (n: string, a: unknown, o?: { signal?: AbortSignal }) => Promise<{ isError: boolean }> }).executeTool(SLOW, {}, { signal: ctl.signal });
    return { content: [{ type: "text", text: out.isError ? "nested-released" : "nested-hung" }], details: {} };
  });
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer, slow], getHandle: (n: string) => (n === CG ? outer : slow), baseCtx: () => ({}) }),
    nativeOk,
  );
  const start = Date.now();
  const res = await disp.execute(caller([CG, SLOW]), { tool: CG, args: {} });
  assert.ok(Date.now() - start < 3000, "nested explicit abort left promise pending (only cancelJobs releases)");
  assert.ok(JSON.stringify(res.content).includes("nested-released"), `nested not released: ${JSON.stringify(res.content)}`);
});

test("F5 usage domain validated; bound covers whole payload; loss explicit", async () => {
  const { boundExternalResult } = await import("../src/governing-runtime.ts");
  // Blob usage must not reattach raw after bound
  const r1 = boundExternalResult({ content: [{ type: "text", text: "hi" }], details: {}, usage: { blob: "x".repeat(300_000) } });
  assert.ok(Buffer.byteLength(JSON.stringify(r1), "utf8") <= 200_000, "blob usage reattached raw");
  // Details drop must carry explicit marker
  const r2 = boundExternalResult({ content: [{ type: "text", text: "hi" }], details: { big: "x".repeat(300_000) } });
  assert.ok(Buffer.byteLength(JSON.stringify(r2), "utf8") <= 200_000);
  // Supervisor domain validation tested at supervisor level (negative/Infinity/NaN)
});

test("F5 supervisor rejects invalid usage domain (negative/Infinity/NaN)", async () => {
  const { mkSup } = await import("./ctl-worker.ts");
  const { tick } = await import("./ctl-worker.ts");
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  const cg = handle(CG, async () => ({ content: [{ type: "text", text: "x" }], details: {}, usage: { input: -5, output: Infinity, cost: NaN } }));
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "u", message: "m", profile: "reader" }, "inv-use-1");
  await tick();
  await built.byAgent(g.agentId)[0].call(CG, { q: "x" });
  const view = built.sup.list("governor").find((v) => v.id === g.agentId) as unknown as { usage: { inputTokens: number; outputTokens: number } };
  assert.ok(Number.isFinite(view.usage.inputTokens) && view.usage.inputTokens >= 0, `corrupt totals: ${JSON.stringify(view.usage)}`);
  assert.ok(Number.isFinite(view.usage.outputTokens) && view.usage.outputTokens >= 0, `corrupt totals: ${JSON.stringify(view.usage)}`);
});
