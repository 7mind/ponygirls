import { afterEach, describe, it, expect, vi } from "vitest";
import { boundedPaperOperation, PaperTimeoutError, runPaperMetasearch, validatePaperConfig } from "../extensions/papers/metasearch.js";
import type { PaperConfig, PaperProvider, PaperProviderName, PaperRecord } from "../extensions/papers/types.js";
const hit = (name: string): PaperRecord => ({ title: name, url: `https://example.test/${name}`, ids: [], authors: [], categories: [] });
const provider = (name: PaperProviderName, results: PaperRecord[] = [hit(name)]): PaperProvider => ({ name, search: vi.fn(async () => results) });
const request = { query: "q", numResults: 2 };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// Specified BG: real orchestration/identity/fusion with handwritten in-process ports.
describe("paper metasearch", () => {
  it.each(["first", "targeted", "all"] as const)("runs fallback alongside %s mains with full candidate depth", async mode => {
    const providers = [provider("firecrawl"), provider("exa"), provider("searxng"), provider("arxiv")];
    const result = await runPaperMetasearch(providers, { mode }, request, undefined);
    expect(result.providers.map(p => p.provider)).toEqual(mode === "first" ? ["firecrawl", "searxng", "arxiv"] : ["firecrawl", "exa", "searxng", "arxiv"]);
    for (const p of providers.filter(p => mode !== "first" || p.name !== "exa")) expect(p.search).toHaveBeenCalledWith({ query: "q", numResults: 10 }, expect.any(AbortSignal));
  });
  it("first continues after both failed and successful-empty providers", async () => {
    const failed: PaperProvider = { name: "firecrawl", search: async () => { throw new Error("secret key=abc body"); } };
    const result = await runPaperMetasearch([failed, provider("exa", []), provider("arxiv")], { mode: "first", sources: { arxiv: { tier: "main" } } }, request, undefined);
    expect(result.providers.map(p => p.status)).toEqual(["failed", "empty", "success"]);
    expect(result.results[0].title).toBe("arxiv");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("targeted fills empty/failure slots until two usable main lists", async () => {
    const p = [provider("firecrawl", []), provider("exa"), provider("searxng"), provider("arxiv")];
    const result = await runPaperMetasearch(p, { sources: { searxng: { tier: "main" }, arxiv: { tier: "main" } } }, request, undefined);
    expect(result.providers.map(p => p.provider)).toEqual(["firecrawl", "exa", "searxng"]);
    expect(p[3].search).not.toHaveBeenCalled();
  });
  it("fuses raw candidates once across tiers before final truncation", async () => {
    const common = hit("agreement");
    const result = await runPaperMetasearch([provider("exa", [hit("a"), common]), provider("arxiv", [hit("b"), common])], { mode: "all", rerank: "rrf" }, { query: "q", numResults: 1 }, undefined);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ title: "agreement", rrfScore: 2 / 62, sources: ["arxiv", "exa"] });
  });
  it("honors candidate caps/weights and does not admit an over-returned result", async () => {
    const result = await runPaperMetasearch([provider("exa", [hit("a"), hit("b"), hit("c")]), provider("arxiv")], { sources: { exa: { maxResults: 2, boost: 3 }, arxiv: { enabled: false } } }, { query: "q", numResults: 20 }, undefined);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].rrfScore).toBe(3 / 61);
    expect(result.providers).toHaveLength(1);
  });
  it("caps default candidate depth at 40", async () => {
    const p = provider("exa");
    await runPaperMetasearch([p], {}, { query: "q", numResults: 20 }, undefined);
    expect(p.search).toHaveBeenCalledWith({ query: "q", numResults: 40 }, expect.any(AbortSignal));
  });
  it("distinguishes failed, empty and timed-out uncooperative engines", async () => {
    vi.useFakeTimers();
    const hung: PaperProvider = { name: "exa", search: () => new Promise(() => {}) };
    const failed: PaperProvider = { name: "firecrawl", search: async () => { throw new Error("timeout in response body, apiKey=secret"); } };
    const pending = runPaperMetasearch([failed, hung, provider("arxiv", [])], { sources: { exa: { timeoutMs: 20 } } }, request, undefined);
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result.providers.map(p => p.status)).toEqual(["failed", "timeout", "empty"]);
    expect(result.results).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("defaults main and fallback deadlines separately", async () => {
    vi.useFakeTimers();
    const hung = (name: PaperProviderName): PaperProvider => ({ name, search: () => new Promise(() => {}) });
    const pending = runPaperMetasearch([hung("exa"), hung("arxiv")], {}, request, undefined);
    await vi.advanceTimersByTimeAsync(8000);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(7000);
    expect((await pending).providers.map(p => p.status)).toEqual(["timeout", "timeout"]);
  });
  it("propagates caller abort promptly even when every provider ignores signals", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const hung: PaperProvider = { name: "exa", search: () => new Promise(() => {}) };
    const pending = runPaperMetasearch([hung], {}, request, controller.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await Promise.resolve();
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not call any provider when already aborted", async () => {
    const p = provider("exa");
    const c = new AbortController(); c.abort();
    await expect(runPaperMetasearch([p], {}, request, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(p.search).not.toHaveBeenCalled();
  });
  it("returns successful all-empty and all-failed stats without inventing results", async () => {
    expect((await runPaperMetasearch([provider("exa", [])], {}, request, undefined)).providers[0].status).toBe("empty");
    expect((await runPaperMetasearch([{ name: "exa", search: async () => { throw new Error("bad"); } }], {}, request, undefined)).providers[0].status).toBe("failed");
  });
  it.each([0, 21, 1.5, NaN, "2"])("rejects result count %s", async numResults => {
    await expect(runPaperMetasearch([], {}, { query: "q", numResults } as never, undefined)).rejects.toThrow("Invalid paper search request");
  });
  it.each(["", "  ", "x".repeat(2001), null])("rejects invalid query", async query => {
    await expect(runPaperMetasearch([], {}, { query, numResults: 2 } as never, undefined)).rejects.toThrow();
  });
  it("rejects duplicate providers", async () => {
    await expect(runPaperMetasearch([provider("exa"), provider("exa")], {}, request, undefined)).rejects.toThrow("duplicate");
  });
});

// Specified BA: runtime configuration and reusable deadline boundary.
describe("paper configuration and deadlines", () => {
  it.each([null, [], { mode: "bad" }, { rerank: "bad" }, { sources: null }, { sources: { typo: {} } }, { sources: { exa: null } }, { sources: { exa: { typo: 1 } } }, { sources: { exa: { enabled: "true" } } }, { sources: { exa: { tier: "native" } } }, ...[0, -1, 60001, NaN, Infinity].map(timeoutMs => ({ sources: { exa: { timeoutMs } } })), ...[0, 51, 1.5, "10"].map(maxResults => ({ sources: { exa: { maxResults } } })), ...[0, -1, Infinity, NaN, 4.01, "2"].map(boost => ({ sources: { exa: { boost } } }))])("rejects invalid runtime configuration %#", config => {
    expect(() => validatePaperConfig(config as PaperConfig)).toThrow();
  });
  it("cleans caller listener and deadline after successful completion", async () => {
    vi.useFakeTimers();
    const c = new AbortController();
    const remove = vi.spyOn(c.signal, "removeEventListener");
    expect(await boundedPaperOperation(async () => 42, 100, c.signal)).toBe(42);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts child transports on deadline, and consumes late rejection", async () => {
    vi.useFakeTimers();
    let child: AbortSignal | undefined;
    let rejectLate: (error: Error) => void = () => {};
    const pending = boundedPaperOperation(signal => { child = signal; return new Promise((_, reject) => { rejectLate = reject; }); }, 5, undefined);
    const rejected = expect(pending).rejects.toBeInstanceOf(PaperTimeoutError);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(child?.aborted).toBe(true);
    rejectLate(new Error("late secret"));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
