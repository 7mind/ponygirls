import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import searchHub from "../extensions/search-hub.js";
import type { NativeEngine } from "../extensions/native.js";
import { NativeSearchError, NativeUsageUnavailableError } from "../extensions/native.js";
import { refreshConfig } from "../extensions/config.js";
import { SearchService } from "../extensions/search-service.js";

const state = vi.hoisted(() => ({ native: [] as NativeEngine[], calls: [] as string[], failMain: false }));
vi.mock("../extensions/native.js", async importOriginal => ({ ...await importOriginal<typeof import("../extensions/native.js")>(), discoverNativeEngines: async () => state.native }));
vi.mock("../extensions/backends/registry.js", () => ({
  BACKEND_DEFS: Object.fromEntries(["a", "b", "c", "d", "free"].map(name => [name, { label: name }])),
  runBackend: async (name: string) => {
    state.calls.push(name);
    if (state.failMain) throw new Error("fixture unavailable");
    return [{ title: name, url: `https://example.org/${name}`, snippet: name }];
  },
}));
const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } };
let cwd: string;
let ctx: ExtensionContext;
function configure() {
  writeFileSync(join(cwd, ".pi/search.json"), JSON.stringify({ combine: true, combineMode: "targeted", backends: Object.fromEntries(["a", "b", "c", "d", "free"].map(name => [name, { enabled: true }])), alwaysInclude: { free: { timeoutMs: 1000 } } }));
  refreshConfig(cwd, true);
}
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "search-service-")); mkdirSync(join(cwd, ".pi"));
  ctx = { cwd } as ExtensionContext;
  configure(); state.calls = []; state.failMain = false;
  state.native = [{ id: "openai", label: "fixture", search: async () => {
    state.calls.push("native:openai"); return { results: [{ title: "native", url: "https://example.org/native" }], usage };
  } }];
});
afterEach(() => rmSync(cwd, { recursive: true }));

// Behavioral-Active-Blackbox-Group: tool service and real tier/fusion/monitor composition.
describe("search tool service", () => {
  it("uses all three tiers, preserves the main cap, records counters and nested usage", async () => {
    const service = new SearchService(); const result = await service.search({ query: "public query" }, undefined, ctx);
    expect(state.calls.sort()).toEqual(["a", "b", "c", "free", "native:openai"]);
    expect(result.details.resultCount).toBe(5); expect(result.usage).toEqual(usage);
    expect(service.monitor.snapshot()).toHaveLength(5);
    expect(service.monitor.snapshot().every(row => row.success === 1 && row.ongoing === 0)).toBe(true);
  });
  it("an explicit engine bypasses every other tier even with combine forced", async () => {
    const service = new SearchService(); const result = await service.search({ query: "q", backend: "a" }, undefined, ctx);
    expect(state.calls).toEqual(["a"]); expect(result.details.resultCount).toBe(1); expect(result.usage).toBeUndefined();
  });
  it("includes settled inference usage even when a native engine fails", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("no grounded sources", usage); };
    const result = await new SearchService().search({ query: "q" }, undefined, ctx);
    expect(result.details.resultCount).toBe(4); expect(result.usage).toEqual(usage);
    expect(result.details.backendStats["native:openai"].success).toBe(false);
  });
  it("does not expose raw provider error text inside partially successful search output", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("Authorization: Bearer fixture-secret https://fixture/?key=credential", usage); };
    const result = await new SearchService().search({ query: "q" }, undefined, ctx);
    expect(result.details.resultCount).toBeGreaterThan(0);
    expect(result.content[0].text).not.toMatch(/fixture-secret|credential|Authorization/);
  });
  it("reports all-empty/failing searches as tool errors without dropping settled usage", async () => {
    state.failMain = true; state.native[0].search = async () => { throw new NativeSearchError("no grounded sources", usage); };
    const result = await new SearchService().search({ query: "q" }, undefined, ctx);
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
      const pending = new SearchService().search({ query: "q" }, undefined, ctx);
      await vi.advanceTimersByTimeAsync(45_001);
      expect((await pending).usage).toEqual(usage);
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
  });
  it("reports unavailable usage explicitly instead of inventing zero", async () => {
    state.native[0].search = async () => { throw new NativeUsageUnavailableError("openai"); };
    const result = await new SearchService().search({ query: "q" }, undefined, ctx);
    expect(result.usage).toBeUndefined();
    expect(result.details.usageUnavailableEngines).toEqual(["native:openai"]);
    expect(result.content[0].text).toContain("Nested model usage unavailable");
    expect(result.content[0].text).not.toContain("stream did not settle within");
  });
  it("preserves settled native usage when the caller cancels", async () => {
    const controller = new AbortController();
    state.native[0].search = async () => { controller.abort(); throw new NativeSearchError("cancelled", usage); };
    const result = await new SearchService().search({ query: "q" }, controller.signal, ctx);
    expect(result.isError).toBe(true); expect(result.usage).toEqual(usage);
    expect(result.content[0].text).toBe("Search cancelled");
  });
  it("keeps explicit native failures marked as errors with their usage", async () => {
    state.native[0].search = async () => { throw new NativeSearchError("hosted tool unavailable", usage); };
    const result = await new SearchService().search({ query: "q", backend: "native:openai" }, undefined, ctx);
    expect(result.isError).toBe(true); expect(result.usage).toEqual(usage);
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
      await expect(new SearchService().search(params, undefined, ctx)).rejects.toThrow();
    }
    expect(state.calls).toEqual([]);
  });
});
