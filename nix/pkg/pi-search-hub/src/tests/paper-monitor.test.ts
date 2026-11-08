import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperResearchService } from "../extensions/papers/service.js";
import { createPaperProviders } from "../extensions/papers/providers.js";
import { formatPaperSearch } from "../extensions/papers/formatters.js";
import { SharedRuntime } from "../extensions/engine/runtime.js";
import { DEFAULT_CONCURRENCY } from "../extensions/engine/policy.js";
import type { PaperProvider, PaperRecord } from "../extensions/papers/types.js";

const paper: PaperRecord = { title: "Study", url: "https://example.test/paper", ids: [{ namespace: "doi", value: "10.1234/test" }], authors: ["Author"], abstract: "Evidence", categories: [], date: "2026-01-01", dateKind: "created" };
const make = (providers: PaperProvider[], runtime = new SharedRuntime(DEFAULT_CONCURRENCY)) => new PaperResearchService(() => providers, runtime);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => vi.unstubAllEnvs());

// Behavioral-Active-Blackbox-Group: public metadata/execution/monitor contracts with manual provider dummies.
describe("paper monitoring", () => {
  it("publishes fast source completion while another source is still running", async () => {
    let release!: (papers: PaperRecord[]) => void;
    const service = make([{ name: "firecrawl", search: async () => [paper] }, { name: "exa", search: () => new Promise(resolve => { release = resolve; }) }]);
    const pending = service.execute({ action: "search", query: "study" }, {}, undefined);
    await tick();
    try {
      expect(service.monitor.snapshot().find(p => p.name === "firecrawl")).toMatchObject({ success: 1, ongoing: 0 });
      expect(service.monitor.snapshot().find(p => p.name === "exa")).toMatchObject({ ongoing: 1 });
    } finally { release([]); await pending; }
  });

  it("finishes retrieval observations even when subsequent fusion throws", async () => {
    const service = make([{ name: "firecrawl", search: async () => [paper] }, { name: "exa", search: async () => [paper] }]);
    await expect(service.execute({ action: "search", query: "study" }, { papers: {
      ranking: { rankConstant: Number.MIN_VALUE }, sources: { firecrawl: { boost: Number.MAX_VALUE }, exa: { boost: Number.MAX_VALUE } },
    } }, undefined)).rejects.toThrow();
    expect(service.monitor.snapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "firecrawl", success: 1, ongoing: 0 }),
      expect.objectContaining({ name: "exa", success: 1, ongoing: 0 }),
    ]));
  });

  it("refreshes detached policy and descriptors without dispatch; default auxiliary and per-source policy are resolved", () => {
    let calls = 0;
    const service = make([{ name: "firecrawl", search: async () => { calls++; return []; } }, { name: "searxng", search: async () => { calls++; return []; } }]);
    service.refresh({ papers: { sources: { firecrawl: { timeoutMs: 700, maxResults: 7, boost: 2 } } } });
    const policy = service.policy();
    expect(policy.main).toMatchObject({ mode: "targeted", engineOrder: ["firecrawl"], targetUsableEngines: 3, requestedPerEngine: 20 });
    expect(policy.native.engineCount).toBe(0);
    expect(policy.fallback.map(p => p.backend)).toEqual(["searxng"]);
    expect(policy.sources.find(p => p.name === "firecrawl")).toEqual({ name: "firecrawl", timeoutMs: 700, maxResults: 7, boost: 2 });
    (policy.main.engineOrder as string[]).push("secret");
    (service.engines()[0] as { label: string }).label = "mutated";
    expect(service.policy().main.engineOrder).toEqual(["firecrawl"]);
    expect(service.engines()[0].label).toBe("firecrawl");
    expect(calls).toBe(0); expect(service.monitor.snapshot()).toEqual([]);
    const empty = make([]); empty.refresh({}); expect(empty.engines()).toEqual([]); expect(empty.policy().sources).toEqual([]);
  });

  it("counts actual candidate hits and separate empty outcomes, retaining configured roles on source isolation and tier history on configuration changes", async () => {
    let requested = 0;
    const service = make([{ name: "firecrawl", search: async request => { requested = request.numResults; return Array.from({ length: 20 }, (_, i) => ({ ...paper, ids: [], url: `${paper.url}/${i}` })); } }, { name: "searxng", search: async () => [] }]);
    const result = await service.execute({ action: "search", query: "study" }, {}, undefined);
    expect(requested).toBe(20); expect(result.details.results).toHaveLength(10);
    expect(service.monitor.snapshot()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "firecrawl", success: 1, resultCountLast: 20, ongoing: 0 }), expect.objectContaining({ name: "searxng", tier: "fallback", empty: 1, success: 0 })]));
    await service.execute({ action: "search", query: "study", source: "searxng" }, {}, undefined);
    expect(service.monitor.snapshot().filter(p => p.name === "searxng").map(p => p.tier)).toEqual(["fallback"]);
    await service.execute({ action: "search", query: "study", source: "firecrawl" }, { papers: { alwaysInclude: { firecrawl: {} } } }, undefined);
    expect(service.monitor.snapshot().filter(p => p.name === "firecrawl").map(p => p.tier)).toEqual(["main", "fallback"]);
  });

  it("uses authoritative source timeouts and cancellation even when adapters ignore abort; late completions cannot repaint", async () => {
    let finish!: (papers: PaperRecord[]) => void;
    const service = make([{ name: "firecrawl", search: async () => [paper] }, { name: "searxng", search: () => new Promise(resolve => { finish = resolve; }) }]);
    const result = await service.execute({ action: "search", query: "study" }, { papers: { sources: { searxng: { timeoutMs: 15 } } } }, undefined);
    expect(result.details.providers.find(p => p.provider === "searxng")?.status).toBe("timeout");
    const before = service.monitor.snapshot();
    expect(before.find(p => p.name === "searxng")).toMatchObject({ timeout: 1, ongoing: 0, success: 0 });
    finish([paper]); await tick(); expect(service.monitor.snapshot()).toEqual(before);
    let release!: (papers: PaperRecord[]) => void;
    const cancelled = make([{ name: "firecrawl", search: () => new Promise(resolve => { release = resolve; }) }]);
    const abort = new AbortController(); const pending = cancelled.execute({ action: "search", query: "study" }, {}, abort.signal);
    await tick(); abort.abort(); const output = await pending;
    expect(output.details.providers[0].status).toBe("cancelled");
    expect(cancelled.monitor.snapshot()[0]).toMatchObject({ cancelled: 1, ongoing: 0 });
    release([paper]); await tick(); expect(cancelled.monitor.snapshot()[0].success).toBe(0);
  });

  it("does not count pool-queued or target-skipped sources as attempts", async () => {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
    let release!: () => void;
    const occupying = runtime.operation("other", 1000, undefined, 0, () => new Promise<void>(resolve => { release = resolve; }));
    await tick();
    const service = make([{ name: "firecrawl", search: async () => [paper] }], runtime);
    const result = await service.execute({ action: "search", query: "study" }, { concurrency: { maxConcurrent: 1, perProvider: 1 }, timeouts: { overallMs: 15 } }, undefined);
    expect(result.details.providers[0].status).toBe("not-started"); expect(service.monitor.snapshot()).toEqual([]);
    release(); await occupying;
    const first = make([{ name: "firecrawl", search: async () => [paper] }, { name: "exa", search: async () => [] }]);
    await first.execute({ action: "search", query: "study", mode: "first" }, {}, undefined);
    expect(first.monitor.snapshot().map(p => p.name)).toEqual(["firecrawl"]);
  });

  it("monitors metadata reads and related hits, failures, configured deadlines and caller cancellation without leaks", async () => {
    const service = make([{ name: "firecrawl", search: async () => [], read: async () => ({ paper, passages: [] }), related: async () => [paper] }]);
    await service.execute({ action: "read", id: "x" }, {}, undefined);
    await service.execute({ action: "related", id: "x", intent: "study" }, {}, undefined);
    expect(service.monitor.snapshot()[0]).toMatchObject({ success: 2, resultCountTotal: 2, ongoing: 0 });
    for (const action of ["read", "related"] as const) {
      let release!: (value: never) => void;
      const slow = () => new Promise<never>(resolve => { release = resolve; });
      const timed = make([{ name: "firecrawl", search: async () => [], read: slow, related: slow }]);
      const params = action === "read" ? { action, id: "x" } : { action, id: "x", intent: "study" };
      await expect(timed.execute(params, { papers: { sources: { firecrawl: { timeoutMs: 10 } } } }, undefined)).rejects.toThrow();
      expect(timed.monitor.snapshot()[0]).toMatchObject({ timeout: 1, failed: 0, ongoing: 0 });
      release(undefined as never); await tick(); expect(timed.monitor.snapshot()[0].success).toBe(0);
      const abort = new AbortController();
      const pending = timed.execute(params, {}, abort.signal); await tick(); abort.abort();
      await expect(pending).rejects.toThrow(); expect(timed.monitor.snapshot()[0]).toMatchObject({ cancelled: 1, ongoing: 0 });
      release(undefined as never); await tick();
    }
    const fail = async (): Promise<never> => { throw new Error("secret"); };
    const failed = make([{ name: "firecrawl", search: fail, read: fail, related: fail }]);
    await expect(failed.execute({ action: "read", id: "x" }, {}, undefined)).rejects.toThrow();
    expect(failed.monitor.snapshot()[0]).toMatchObject({ failed: 1, ongoing: 0 });
  });

  it("formats evidence and safe generic source outcomes without rendering upstream error/warning bodies", async () => {
    const service = make([{ name: "firecrawl", search: async () => [{ ...paper, notices: ["Authorization: secret"] }] }]);
    const result = await service.execute({ action: "search", query: "study" }, {}, undefined);
    const formatted = formatPaperSearch(result.details);
    expect(formatted).toContain("1. Study"); expect(formatted).toContain("doi:10.1234/test");
    expect(formatted).toContain("Created: 2026-01-01"); expect(formatted).toContain("Abstract: Evidence");
    expect(formatted).toContain("Sources: firecrawl"); expect(formatted).toContain("exact ID:");
    expect(formatted).not.toMatch(/Authorization|secret/);
  });
});

// Behavioral-Active-Effectual-GoodCommunication: real factory with controlled local filesystem/transport boundary.
it("metadata refresh never resolves credential commands, fetches, or takes the arxiv lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paper-metadata-"));
  try {
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    let calls = 0;
    const service = new PaperResearchService(settings => createPaperProviders(settings, async () => { calls++; throw new Error("unexpected transport"); }), new SharedRuntime(DEFAULT_CONCURRENCY));
    service.refresh({ backends: { firecrawl: { enabled: true, apiKey: `!touch '${join(dir, "credential-ran")}'` } }, papers: { sources: { arxiv: { enabled: true } } } });
    service.policy(); service.engines(); service.monitor.snapshot(); await tick();
    expect(calls).toBe(0); expect(existsSync(join(dir, "credential-ran"))).toBe(false); expect(existsSync(join(dir, "paper-arxiv"))).toBe(false);
    expect(JSON.stringify(service.policy())).not.toContain("credential-ran");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
