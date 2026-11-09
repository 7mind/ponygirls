import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import searchHub from "../extensions/search-hub.js";
import { Value } from "typebox/value";
import type { NativeEngine } from "../extensions/native.js";
import { NativeSearchError, NativeUsageUnavailableError } from "../extensions/native.js";
import { refreshConfig, roundRobinIndex } from "../extensions/config.js";
import type { SearchConfig } from "../extensions/types.js";
import { SearchService } from "../extensions/search-service.js";

import { SharedRuntime } from "../extensions/engine/runtime.js";
import { DEFAULT_CONCURRENCY } from "../extensions/engine/policy.js";

interface EngineRequest { name: string; count: number }
const state = vi.hoisted(() => ({ native: [] as NativeEngine[], calls: [] as string[], requests: [] as EngineRequest[], failMain: false }));
vi.mock("../extensions/native.js", async importOriginal => ({ ...await importOriginal<typeof import("../extensions/native.js")>(), discoverNativeEngines: async () => state.native }));
vi.mock("../extensions/backends/registry.js", () => ({
  BACKEND_DEFS: Object.fromEntries(["a", "b", "c", "d", "free"].map(name => [name, { label: name }])),
  runBackend: async (name: string, _query: string, count: number) => {
    state.calls.push(name); state.requests.push({ name, count });
    if (state.failMain) throw new Error("fixture unavailable");
    return [{ title: name, url: `https://example.org/${name}`, snippet: name }];
  },
}));
const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } };
let cwd: string;
let ctx: ExtensionContext;
function configure(overrides: Partial<SearchConfig>) {
  writeFileSync(join(cwd, ".pi/search.json"), JSON.stringify({ combine: true, combineMode: "targeted", backends: Object.fromEntries(["a", "b", "c", "d", "free"].map(name => [name, { enabled: true }])), alwaysInclude: { free: { timeoutMs: 1000 } }, ...overrides }));
  refreshConfig(cwd, true);
}
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "search-service-")); mkdirSync(join(cwd, ".pi"));
  ctx = { cwd } as ExtensionContext;
  configure({}); state.calls = []; state.requests = []; state.failMain = false;
  state.native = [{ id: "openai", label: "fixture", search: async (_query, count) => {
    state.calls.push("native:openai"); state.requests.push({ name: "native:openai", count }); return { results: [{ title: "native", url: "https://example.org/native" }], usage };
  } }];
});
afterEach(() => rmSync(cwd, { recursive: true }));

// Behavioral-Active-Blackbox-Group: tool service and real tier/fusion/monitor composition.
describe("search tool service", () => {
  it("exposes detached safe policy metadata without inference, random sampling, or rotation", async () => {
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY));
    expect(() => service.policy()).toThrow("before discovery");
    configure({ selectionStrategy: "round-robin", backends: { a: { enabled: true, apiKey: "fixture-private-key" }, free: { enabled: true } } });
    const rotation = roundRobinIndex;
    await service.refresh(ctx, undefined);
    const policy = service.policy();
    expect(policy.main.engineOrder).toEqual(["a"]);
    expect(policy.native).toEqual({ engineCount: 1, timeoutMs: 45_000, settlementGraceMs: 1000 });
    expect(policy.fusion).toEqual({ rankConstant: 60, rerank: "rrf", titleWeight: .2, bodyWeight: .1, exactTitle: true });
    expect(policy.execution).toEqual({ maxConcurrent: 6, perProvider: 2, overallTimeoutMs: 60_000, sourceTimeoutMs: 30_000, discoveryTimeoutMs: 10_000 });
    expect(policy.maximumResultCount).toBe(20);
    expect(policy.fallback).toEqual([{ backend: "free", timeoutMs: 1000, maxResults: 20 }]);
    expect(JSON.stringify(policy)).not.toContain("fixture-private-key");
    Reflect.set(policy.main.engineOrder, 0, "changed");
    Reflect.set(policy.fallback[0], "timeoutMs", 9);
    expect(service.policy().main.engineOrder).toEqual(["a"]);
    expect(service.policy().fallback[0].timeoutMs).toBe(1000);
    expect(roundRobinIndex).toBe(rotation);
    configure({ selectionStrategy: "random" });
    const random = vi.spyOn(Math, "random");
    try {
      await service.refresh(ctx, undefined); service.policy(); service.policy();
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
    expect(state.calls).toEqual([]);
    expect(service.monitor.snapshot()).toEqual([]);
  });
  it.each([
    { settings: { combine: false, combineMode: "targeted" as const }, mode: "first", engines: ["a"], count: 20 },
    { settings: { combine: true, combineMode: "targeted" as const }, mode: "targeted", engines: ["a", "b", "c"], count: 20 },
    { settings: { combine: true, combineMode: "all" as const }, mode: "all", engines: ["a", "b", "c", "d"], count: 20 },
    { settings: { combine: true, combineMode: undefined }, mode: "all", engines: ["a", "b", "c", "d"], count: 20 },
    { settings: { combine: undefined, combineMode: undefined }, mode: "first", engines: ["a"], count: 20 },
  ])("binds displayed $mode defaults to actual engine requests ($settings)", async ({ settings, mode, engines, count }) => {
    configure({ ...settings, alwaysInclude: { free: { timeoutMs: 2500, maxResults: 2 } } });
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY));
    await service.search({ query: "q" }, undefined, ctx);
    const policy = service.policy();
    expect(policy.main.mode).toBe(mode);
    expect(policy.main.combineForced).toBe(settings.combine === true);
    expect(policy.main.requestedPerEngine).toBe(count);
    expect(policy.main.engineOrder).toEqual(["a", "b", "c", "d"]);
    expect(state.requests.filter(row => engines.includes(row.name))).toEqual(engines.map(name => ({ name, count })));
    expect(state.requests).toContainEqual({ name: "free", count: policy.fallback[0].maxResults });
    expect(state.requests).toContainEqual({ name: "native:openai", count: policy.main.requestedPerEngine! });
    expect(state.requests).toHaveLength(engines.length + 2);
    expect(policy.fallback[0]).toEqual({ backend: "free", timeoutMs: 2500, maxResults: 2 });
  });
  it("keeps policy scoped to defaults when callers request a different count or combine mode", async () => {
    configure({ combine: false });
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY));
    await expect(service.search({ query: "q", numResults: 99, combine: true }, undefined, ctx)).rejects.toThrow("numResults");
    expect(state.requests).toEqual([]);
    await service.search({ query: "q", numResults: 20, combine: true }, undefined, ctx);
    const policy = service.policy();
    expect(policy.main.mode).toBe("first");
    expect(policy.main.combineMode).toBe("targeted");
    expect(policy.main.requestedPerEngine).toBe(20);
    expect(state.requests).toContainEqual({ name: "a", count: 2 * policy.maximumResultCount });
    expect(state.requests).toContainEqual({ name: "native:openai", count: 2 * policy.maximumResultCount });
    expect(state.requests).toHaveLength(5);
    configure({ combine: true }); state.requests = [];
    await service.search({ query: "q", combine: false }, undefined, ctx);
    expect(service.policy().main.combineForced).toBe(true);
    expect(state.requests).toHaveLength(5);
  });
  it("rejects malformed combine settings before discovery without exposing untrusted values", async () => {
    writeFileSync(join(cwd, ".pi/search.json"), JSON.stringify({ combineMode: "fixture-private-value", backends: { a: { enabled: true } } }));
    refreshConfig(cwd, true);
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY));
    await expect(service.refresh(ctx, undefined)).rejects.toThrow("Invalid combineMode");
    await expect(service.refresh(ctx, undefined)).rejects.not.toThrow("fixture-private-value");
    expect(() => service.policy()).toThrow("before discovery");
    await expect(service.search({ query: "q" }, undefined, ctx)).rejects.toThrow("Invalid combineMode");
    expect(state.calls).toEqual([]);
  });
  it("exposes detached effective source caps, timeouts and boosts without provider work", async () => {
    configure({ sources: { a: { timeoutMs: 123, maxResults: 7, boost: 2.5 }, "native:openai": { timeoutMs: 456, maxResults: 4, boost: 0.5 } },
      alwaysInclude: { free: { timeoutMs: 87, maxResults: 3, boost: 1.5 } } });
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY));
    await service.refresh(ctx, undefined);
    const policy = service.policy();
    expect(policy.sources).toEqual(expect.arrayContaining([
      { name: "a", timeoutMs: 123, maxResults: 7, boost: 2.5 },
      { name: "free", timeoutMs: 87, maxResults: 3, boost: 1.5 },
      { name: "native:openai", timeoutMs: 456, maxResults: 4, boost: 0.5 },
    ]));
    Reflect.set(policy.sources[0], "timeoutMs", 1);
    expect(service.policy().sources[0].timeoutMs).toBe(123);
    expect(state.calls).toEqual([]); expect(service.monitor.snapshot()).toEqual([]);
  });
  it("uses all three tiers, preserves the main cap, records counters and nested usage", async () => {
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)); const result = await service.search({ query: "public query" }, undefined, ctx);
    expect(state.calls.sort()).toEqual(["a", "b", "c", "free", "native:openai"]);
    expect(result.details.resultCount).toBe(5); expect(result.usage).toEqual(usage);
    for (const name of ["a", "b", "c"]) expect(result.details.backendStats[name]).toMatchObject({ status: "success", tier: "main", count: 1 });
    expect(result.details.backendStats.d).toMatchObject({ status: "not-started", reason: "target-satisfied", count: 0 });
    expect(result.details.backendStats.free).toMatchObject({ status: "success", tier: "alwaysInclude" });
    expect(result.details.backendStats["native:openai"]).toMatchObject({ status: "success", tier: "native" });
    expect(service.monitor.snapshot()).toHaveLength(5);
    expect(service.monitor.snapshot().every(row => row.success === 1 && row.ongoing === 0)).toBe(true);
  });
  it("an explicit engine bypasses every other tier even with combine forced", async () => {
    const service = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)); const result = await service.search({ query: "q", backend: "a" }, undefined, ctx);
    expect(state.calls).toEqual(["a"]); expect(result.details.resultCount).toBe(1); expect(result.usage).toBeUndefined();
  });
  it("includes settled inference usage even when a native engine fails", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("no grounded sources", usage); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
    expect(result.details.resultCount).toBe(4); expect(result.usage).toEqual(usage);
    expect(result.details.backendStats["native:openai"]).toMatchObject({ success: false, status: "failed", tier: "native" });
  });
  it("does not expose raw provider error text inside partially successful search output", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("Authorization: Bearer fixture-secret https://fixture/?key=credential", usage); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
    expect(result.details.resultCount).toBeGreaterThan(0);
    expect(result.content[0].text).not.toMatch(/fixture-secret|credential|Authorization/);
  });
  it("reports all-empty/failing searches as tool errors without dropping settled usage", async () => {
    state.failMain = true; state.native[0].search = async () => { throw new NativeSearchError("no grounded sources", usage); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
    expect(result.isError).toBe(true); expect(result.usage).toEqual(usage);
  });
  it("waits for native abort settlement before returning timeout usage", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController(); setTimeout(() => controller.abort(new Error("deadline")), ms); return controller.signal;
    });
    try {
      state.native[0].search = async (_query, _count, signal) => new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => setTimeout(() => reject(new NativeSearchError("cancelled", usage)), 1), { once: true });
      });
      const pending = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
      await vi.advanceTimersByTimeAsync(45_001);
      const result = await pending;
      expect(result.usage).toEqual(usage);
      expect(result.details.backendStats["native:openai"]).toMatchObject({ status: "timeout", reason: "source-deadline", tier: "native" });
      expect(result.details.timedOut).toBe(false);
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
  });
  it("reports unavailable usage explicitly instead of inventing zero", async () => {
    state.native[0].search = async () => { throw new NativeUsageUnavailableError("openai"); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
    expect(result.usage).toBeUndefined();
    expect(result.details.usageUnavailableEngines).toEqual(["native:openai"]);
    expect(result.content[0].text).toContain("Nested model usage unavailable");
    expect(result.content[0].text).not.toContain("stream did not settle within");
  });
  it("preserves settled native usage when the caller cancels", async () => {
    const controller = new AbortController();
    state.native[0].search = async () => { controller.abort(); throw new NativeSearchError("cancelled", usage); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, controller.signal, ctx);
    expect(result.isError).toBe(true); expect(result.usage).toEqual(usage);
    expect(result.content[0].text).toBe("Search cancelled");
    expect(result.details.cancelled).toBe(true);
    expect(result.details.backendStats["native:openai"]).toMatchObject({ status: "cancelled", reason: "caller-cancelled" });
  });
  it("keeps explicit native failures marked as errors with their usage", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("hosted tool unavailable", usage); };
    const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q", backend: "native:openai" }, undefined, ctx);
    expect(result.isError).toBe(true); expect(result.usage).toEqual(usage);
  });
  it("registers flat TypeBox enums that retain every web tool restriction", () => {
    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const pi = {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => tools.set(tool.name, tool),
      registerCommand: () => {}, on: () => {},
    } as unknown as ExtensionAPI;
    searchHub(pi);
    const search = tools.get("web_search")!.parameters;
    const read = tools.get("web_read")!.parameters;
    expect(search).toMatchObject({ properties: {
      backend: { type: "string", enum: ["duckduckgo", "auto"] },
      rerank: { type: "string", enum: ["rrf", "lexical"] },
    } });
    expect(read).toMatchObject({ properties: {
      mode: { type: "string", enum: ["rush", "smart"] },
      reader: { type: "string", enum: ["jina", "sofya", "firecrawl", "exa", "exa_mcp"] },
    } });
    for (const backend of ["duckduckgo", "auto"]) {
      for (const rerank of ["rrf", "lexical"]) expect(Value.Check(search, { query: "q", backend, rerank })).toBe(true);
    }
    for (const invalid of [{ backend: "unknown" }, { backend: 1 }, { rerank: "unknown" }, { rerank: 1 }]) {
      expect(Value.Check(search, { query: "q", ...invalid })).toBe(false);
    }
    for (const reader of ["jina", "sofya", "firecrawl", "exa", "exa_mcp"]) {
      for (const mode of ["rush", "smart"]) expect(Value.Check(read, { url: "https://example.org", reader, mode })).toBe(true);
    }
    for (const invalid of [{ reader: "unknown" }, { reader: 1 }, { mode: "unknown" }, { mode: 1 }]) {
      expect(Value.Check(read, { url: "https://example.org", ...invalid })).toBe(false);
    }
  });
  it("never writes status-bar entries and preserves a disabled search tool on refresh", async () => {
    const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
    let active: string[] = [];
    const pi = {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => { tools.set(tool.name, tool); if (!active.includes(tool.name)) active.push(tool.name); },
      registerCommand: () => {}, on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
      getActiveTools: () => [...active], setActiveTools: (names: string[]) => { active = names; },
    } as unknown as ExtensionAPI;
    const setStatus = vi.fn(); const ui = { setStatus, notify: vi.fn() };
    ctx = { ...ctx, mode: "print", hasUI: false, ui } as unknown as ExtensionContext;
    searchHub(pi);
    active = active.filter(name => name !== "web_search");
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("before_agent_start")!({}, ctx);
    expect(active).not.toContain("web_search");
    const result = await tools.get("web_search")!.execute("id", { query: "q" }, new AbortController().signal, undefined, ctx as ExtensionToolContext);
    expect(result.content[0].type).toBe("text"); expect(setStatus).not.toHaveBeenCalled();
    await handlers.get("session_shutdown")!({}, ctx);
  });
  it("rejects malformed boundary inputs before starting providers", async () => {
    for (const params of [{ query: " " }, { query: "q", numResults: NaN }, { query: "q", numResults: 1.5 }]) {
      await expect(new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search(params, undefined, ctx)).rejects.toThrow();
    }
    expect(state.calls).toEqual([]);
  });
});
