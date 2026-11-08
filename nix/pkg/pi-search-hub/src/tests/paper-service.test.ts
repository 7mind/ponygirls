import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperResearchService, type PaperResearchParams } from "../extensions/papers/service.js";
import type { PaperProvider, PaperRecord } from "../extensions/papers/types.js";
import { loadConfig } from "../extensions/config.js";
import { registerPaperResearch } from "../extensions/papers/tool.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SharedRuntime } from "../extensions/engine/runtime.js";
import { DEFAULT_CONCURRENCY } from "../extensions/engine/policy.js";
const paperService = (factory: ConstructorParameters<typeof PaperResearchService>[0]) => new PaperResearchService(factory, new SharedRuntime(DEFAULT_CONCURRENCY));

const record: PaperRecord = { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", ids: [{ namespace: "arxiv", value: "1706.03762" }],
  authors: ["Ashish Vaswani"], abstract: "The Transformer uses attention.", categories: ["cs.CL"] };
const fixtures = (): PaperProvider[] => [
  { name: "firecrawl", search: async () => [record], read: async () => ({ paper: record, passages: [{ text: "Evidence passage", score: 0.8 }] }),
    related: async () => [record] },
  { name: "searxng", search: async () => [{ ...record, abstract: undefined, snippet: "SearXNG snippet" }] },
];
afterEach(() => vi.unstubAllEnvs());

// Behavioral-Active-Blackbox-Group: public service with hand-written provider dummies.
describe("paper research service", () => {
  it("uses scholarly fusion without losing provenance, scores, or abstract/snippet distinction", async () => {
    const result = await paperService(fixtures).execute({ action: "search", query: "attention" }, {}, undefined);
    expect(result.isError).toBe(false);
    expect(result.structuredContent.results).toHaveLength(1);
    const paper = result.structuredContent.results[0];
    expect(paper.sources).toEqual(["firecrawl", "searxng"]);
    expect(paper.abstract).toBe(record.abstract);
    expect(paper.contributions.find(item => item.provider === "searxng")?.term).toBe(0);
    expect(JSON.parse(result.content[0].text)).toEqual(JSON.parse(JSON.stringify(result.structuredContent)));
  });
  it("explicit sources bypass all other tiers and disabled sources are errors", async () => {
    const service = paperService(fixtures);
    const result = await service.execute({ action: "search", query: "attention", source: "searxng" }, {}, undefined);
    expect(result.details.providers.map(provider => provider.provider)).toEqual(["searxng"]);
    expect(result.details.results[0].abstract).toBeUndefined();
    await expect(service.execute({ action: "search", query: "q", source: "exa" }, {}, undefined)).rejects.toThrow("not enabled");
  });
  it("reads actual passages and follows related papers without substituting web search", async () => {
    const service = paperService(fixtures);
    const read = await service.execute({ action: "read", id: "arxiv:1706.03762", query: "attention" }, {}, undefined);
    expect(read.details.paper?.ids).toEqual(record.ids);
    expect(read.details.passages).toEqual([{ text: "Evidence passage", score: 0.8 }]);
    const related = await service.execute({ action: "related", id: "arxiv:1706.03762", intent: "attention", mode: "references" }, {}, undefined);
    expect(related.details.results[0].title).toBe(record.title);
  });
  it("bounds untrusted text and marks truncation without control sequences", async () => {
    const provider: PaperProvider = { name: "firecrawl", search: async () => [{ ...record, abstract: "a".repeat(100_000), title: "\u001b[31mTitle" }],
      read: async () => ({ paper: record, passages: Array.from({ length: 20 }, () => ({ text: "😀".repeat(10_000), score: 1 })) }) };
    const service = paperService(() => [provider]);
    const search = await service.execute({ action: "search", query: "attention" }, {}, undefined);
    expect(search.details.truncated).toBe(true);
    expect(search.content[0].text).not.toContain("\u001b");
    expect(search.details.results[0].abstract!.length).toBeLessThan(1500);
    const read = await service.execute({ action: "read", id: "arxiv:1706.03762", numResults: 20 }, {}, undefined);
    expect(Buffer.byteLength(read.content[0].text)).toBeLessThanOrEqual(60_000);
    expect(read.details.truncated).toBe(true);
    expect(read.details.passages.length).toBeLessThan(20);
  });
  it("does not leak provider failures from search, read or related", async () => {
    const fail = async (): Promise<never> => { throw new Error("Authorization: Bearer fixture-secret"); };
    const provider: PaperProvider = { name: "firecrawl", search: fail, read: fail, related: fail };
    const service = paperService(() => [provider]);
    const search = await service.execute({ action: "search", query: "q" }, {}, undefined);
    expect(search.isError).toBe(true);
    expect(JSON.stringify(search)).not.toMatch(/fixture-secret|Authorization/);
    await expect(service.execute({ action: "read", id: "x" }, {}, undefined)).rejects.toThrow("Paper read failed");
    await expect(service.execute({ action: "related", id: "x", intent: "q" }, {}, undefined)).rejects.toThrow("Related-paper retrieval failed");
  });
  it("distinguishes healthy no-results from all-provider failure", async () => {
    const service = paperService(() => [{ name: "firecrawl", search: async () => [] }]);
    const result = await service.execute({ action: "search", query: "nothing" }, {}, undefined);
    expect(result.details.results).toEqual([]); expect(result.isError).toBe(false);
  });
  it("reuses providers and preserves the arxiv limiter across configuration reloads", async () => {
    let factories = 0; let first = 0; let later = 0;
    const service = paperService(() => {
      const initial = factories++ === 0;
      return [{ name: "arxiv", search: async () => { if (initial) first++; else later++; return [record]; } }];
    });
    await service.execute({ action: "search", query: "q" }, {}, undefined);
    await service.execute({ action: "search", query: "q" }, {}, undefined);
    await service.execute({ action: "search", query: "q" }, { papers: { ranking: { rerank: "rrf" } } }, undefined);
    expect(factories).toBe(2); expect(first).toBe(3); expect(later).toBe(0);
  });
  it("fails closed for unavailable capabilities, invalid config and invalid inputs", async () => {
    const service = paperService(fixtures);
    await expect(paperService(() => []).execute({ action: "search", query: "q" }, {}, undefined)).rejects.toThrow("No paper sources");
    await expect(service.execute({ action: "read", id: "x", source: "arxiv" }, {}, undefined)).rejects.toThrow("not enabled");
    for (const params of [
      { action: "search", query: " " }, { action: "search", query: "q", numResults: 0 },
      { action: "read", id: "x", query: "" }, { action: "related", id: "x", intent: "" },
    ] as PaperResearchParams[]) await expect(service.execute(params, {}, undefined)).rejects.toThrow();
    await expect(service.execute({ action: "search", query: "q" }, { papers: { mode: "invalid" } } as never, undefined)).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(service.execute({ action: "search", query: "q" }, {}, abort.signal)).rejects.toThrow();
  });
  it("registers a structured independent tool without causing provider requests", () => {
    const tools: { name: string; outputSchema?: unknown; execute?: unknown }[] = [];
    const api = { on: () => {}, registerTool: (tool: typeof tools[number]) => tools.push(tool) } as unknown as ExtensionAPI;
    registerPaperResearch(api, new SharedRuntime(DEFAULT_CONCURRENCY));
    expect(tools.map(tool => tool.name)).toEqual(["paper_research"]);
    expect(tools[0].outputSchema).toBeDefined();
    expect(typeof tools[0].execute).toBe("function");
  });
});

// Behavioral-Active-Effectual-GoodCommunication: owned local configuration files.
describe("paper configuration", () => {
  it("merges source settings without changing ordinary web policy", () => {
    const dir = mkdtempSync(join(tmpdir(), "paper-config-"));
    try {
      vi.stubEnv("HOME", dir);
      mkdirSync(join(dir, ".pi/agent/extensions"), { recursive: true });
      const project = join(dir, "project"); mkdirSync(join(project, ".pi"), { recursive: true });
      writeFileSync(join(dir, ".pi/agent/extensions/search.json"), JSON.stringify({ combine: false, papers: { mode: "all", sources: { firecrawl: { enabled: true, boost: 1.4 }, arxiv: { enabled: true } } } }));
      writeFileSync(join(project, ".pi/search.json"), JSON.stringify({ papers: { sources: { firecrawl: { timeoutMs: 3000 } } } }));
      const settings = loadConfig(project);
      expect(settings.combine).toBe(false);
      expect(settings.papers).toEqual({ mode: "all", sources: { firecrawl: { enabled: true, boost: 1.4, timeoutMs: 3000 }, arxiv: { enabled: true } } });
    } finally { rmSync(dir, { recursive: true }); }
  });
});
