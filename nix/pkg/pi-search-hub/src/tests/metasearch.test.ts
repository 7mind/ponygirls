import { describe, it, expect } from "vitest";
import { runMetasearch } from "../extensions/metasearch.js";
import type { SearchResult } from "../extensions/types.js";

const hit = (name: string): SearchResult => ({ title: name, url: `https://example.test/${name}`, snippet: name });

// Behavioral-Active-Blackbox-Group: tier policy with a hand-written search adapter.
describe("automatic metasearch", () => {
  for (const mode of ["first", "targeted", "all"] as const) {
    it(`always runs fallback and native beside ${mode} main selection`, async () => {
      const calls: string[] = [];
      const result = await runMetasearch({
        mode, orderedBackends: ["a", "b", "c", "d", "free"],
        fallback: [{ backend: "free", timeoutMs: 1000 }],
        native: [{ backend: "native:openai", timeoutMs: 1000 }],
        query: "public query", numResults: 10,
        runBackend: async name => { calls.push(name); return [hit(name)]; },
      });
      expect(calls.filter(name => name === "free")).toHaveLength(1);
      expect(calls.filter(name => name === "native:openai")).toHaveLength(1);
      expect(calls.filter(name => /^[a-d]$/.test(name))).toHaveLength(mode === "first" ? 1 : mode === "targeted" ? 3 : 4);
      expect(result.results.map(result => result.url)).toContain(hit("free").url);
      expect(result.results.map(result => result.url)).toContain(hit("native:openai").url);
    });
  }

  it("fuses raw ranked lists across all tiers, including agreement below the main cutoff", async () => {
    const result = await runMetasearch({
      mode: "targeted", orderedBackends: ["a", "b", "c", "free"],
      fallback: [{ backend: "free", timeoutMs: 1000 }], native: [{ backend: "native:xai", timeoutMs: 1000 }],
      query: "q", numResults: 2,
      runBackend: async name => name === "free" || name === "native:xai" ? [hit("c")] : [hit(name)],
    });
    expect(result.results[0].url).toBe(hit("c").url);
    expect(result.results[0].sources).toEqual(["c", "free", "native:xai"]);
  });

  it("returns native-only results when all ordinary backends fail", async () => {
    const result = await runMetasearch({ mode: "first", orderedBackends: ["a"], fallback: [],
      native: [{ backend: "native:anthropic", timeoutMs: 1000 }], query: "q", numResults: 3,
      runBackend: async name => { if (name === "a") throw new Error("unavailable"); return [hit("source")]; },
    });
    expect(result.results).toHaveLength(1);
    expect(result.backendStats.get("a")?.success).toBe(false);
  });

  it("isolates a native deadline without discarding ordinary results", async () => {
    const result = await runMetasearch({ mode: "first", orderedBackends: ["a"], fallback: [],
      native: [{ backend: "native:xai", timeoutMs: 30 }], query: "q", numResults: 3,
      runBackend: (name, _query, _count, signal) => name === "a" ? Promise.resolve([hit("a")]) : new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("native adapter cancelled")), { once: true });
      }),
    });
    expect(result.results[0].url).toBe(hit("a").url);
    expect(result.backendStats.get("native:xai")?.error).toContain("timed out");
  });

  it("does not turn cancellation into successful partial results or start more main backends", async () => {
    const controller = new AbortController(); const calls: string[] = [];
    const pending = runMetasearch({ mode: "first", orderedBackends: ["a", "b"], fallback: [], native: [],
      query: "q", numResults: 3, signal: controller.signal,
      runBackend: async name => { calls.push(name); controller.abort(new Error("cancelled")); throw new Error("cancelled"); },
    });
    await expect(pending).rejects.toThrow("cancelled"); expect(calls).toEqual(["a"]);
  });
});
