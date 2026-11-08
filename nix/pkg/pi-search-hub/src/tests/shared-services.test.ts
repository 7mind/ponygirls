import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NativeEngine } from "../extensions/native.js";
import type { SearchConfig, SearchResult } from "../extensions/types.js";
import { refreshConfig } from "../extensions/config.js";
import { SharedRuntime } from "../extensions/engine/runtime.js";
import { DEFAULT_CONCURRENCY } from "../extensions/engine/policy.js";
import { paperProfile } from "../extensions/engine/profiles.js";
import { SearchService } from "../extensions/search-service.js";
import { PaperResearchService } from "../extensions/papers/service.js";
import type { PaperRecord } from "../extensions/papers/types.js";

const state = vi.hoisted(() => ({ discover: async (): Promise<NativeEngine[]> => [],
  run: async (_name: string, _query: string, _count: number, _signal: AbortSignal | undefined): Promise<SearchResult[]> => [], calls: [] as string[] }));
vi.mock("../extensions/native.js", async original => ({ ...await original<typeof import("../extensions/native.js")>(), discoverNativeEngines: (...args: unknown[]) => state.discover() }));
vi.mock("../extensions/backends/registry.js", () => ({
  BACKEND_DEFS: Object.fromEntries(["firecrawl", "exa", "searxng"].map(name => [name, { label: name }])),
  runBackend: (name: string, query: string, count: number, signal?: AbortSignal) => { state.calls.push(name); return state.run(name, query, count, signal); },
}));
let dir: string;
let ctx: ExtensionContext;
function configure(settings: SearchConfig): void {
  writeFileSync(join(dir, ".pi/search.json"), JSON.stringify(settings)); refreshConfig(dir, true);
}
function webRow(name: string): SearchResult { return { title: `${name} study`, url: `https://doi.org/10.1234/${name}`, snippet: name }; }
function paperRow(name: string): PaperRecord { return { ...webRow(name), ids: [{ namespace: "doi", value: `10.1234/${name}` }], authors: [], categories: [] }; }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shared-services-")); mkdirSync(join(dir, ".pi")); vi.stubEnv("HOME", dir);
  ctx = { cwd: dir } as ExtensionContext; state.discover = async () => []; state.calls = [];
  state.run = async name => [webRow(name)];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true }); });

// Behavioral-Active-Blackbox-Group: public tools/services share one real engine and manual transports.
it("inherits compatible alwaysInclude settings into papers, with profile overrides", () => {
  const profile = paperProfile({ alwaysInclude: { searxng: { timeoutMs: 1234, maxResults: 1, boost: 3 }, langsearch: { timeoutMs: 900 } },
    papers: { alwaysInclude: { searxng: { boost: 2 } } } }, ["firecrawl", "searxng"]);
  expect(profile.alwaysInclude.searxng).toEqual({ timeoutMs: 1234, maxResults: 1, boost: 2 });
  expect(profile.alwaysInclude.langsearch).toBeUndefined();
  expect(profile.sources.searxng.redundantWith).toEqual(["*"]);
});

it("uses identical boosts, reranking, candidate budgets and alwaysInclude policies in both domains", async () => {
  const settings: SearchConfig = { mode: "all", candidates: { minimum: 2, maximum: 2, multiplier: 1 }, ranking: { rerank: "lexical", titleWeight: 0.7, bodyWeight: 0.2 },
    backends: { firecrawl: { enabled: true }, exa: { enabled: true }, searxng: { enabled: true } },
    sources: { exa: { boost: 2 }, searxng: { redundantWith: ["*"] } }, alwaysInclude: { searxng: { timeoutMs: 1234, maxResults: 1, boost: 3 } } };
  configure(settings);
  const requests: { domain: string; source: string; count: number }[] = [];
  state.run = async (name, _query, count) => { requests.push({ domain: "web", source: name, count }); return [webRow(name === "searxng" ? "firecrawl" : name)]; };
  const runtime = new SharedRuntime(DEFAULT_CONCURRENCY);
  const web = await new SearchService(runtime).search({ query: "exa", numResults: 2 }, undefined, ctx);
  const papers = new PaperResearchService(() => (["firecrawl", "exa", "searxng"] as const).map(name => ({ name, search: async request => {
    requests.push({ domain: "papers", source: name, count: request.numResults }); return [paperRow(name === "searxng" ? "firecrawl" : name)];
  } })), runtime);
  const paper = await papers.execute({ action: "search", query: "exa", numResults: 2 }, settings, undefined);
  expect(web.details.results.map(result => result.title)).toEqual(paper.details.results.map(result => result.title));
  expect(web.details.results[0].title).toBe("exa study");
  expect(web.details.results[0].ranking?.score).toBeCloseTo(paper.details.results[0].score);
  for (const domain of ["web", "papers"]) expect(requests.filter(request => request.domain === domain)).toEqual(expect.arrayContaining([
    { domain, source: "firecrawl", count: 2 }, { domain, source: "exa", count: 2 }, { domain, source: "searxng", count: 1 },
  ]));
  expect(paper.details.providers.find(provider => provider.provider === "searxng")?.tier).toBe("alwaysInclude");
});
it("does not describe unstarted sources as failed requests", async () => {
  configure({ mode: "first", backends: { firecrawl: { enabled: true }, exa: { enabled: true } } });
  const result = await new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
  expect(result.details.backendStats.exa.status).toBe("not-started");
  expect(result.content[0].text).toContain("not-started");
  expect(result.content[0].text).not.toContain("unknown error");
});

it("counts stalled discovery against the overall deadline and starts no sources after expiry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  configure({ backends: { firecrawl: { enabled: true } }, timeouts: { overallMs: 100, discoveryMs: 10000 } });
  state.discover = () => new Promise(() => {});
  const pending = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q" }, undefined, ctx);
  let settled = false; void pending.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(101);
  expect(settled).toBe(true);
  const result = await pending;
  expect(state.calls).toEqual([]);
  expect(result.details.timedOut).toBe(true);
  expect(result.details.backendStats.firecrawl.status).toBe("not-started");
  expect(result.details.backendStats.firecrawl.reason).toBe("overall-deadline");
});

it.each([undefined, "native:openai"])("reports expired native discovery as a deadline, not bad configuration (%s)", async backend => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  configure({ backends: { firecrawl: { enabled: true } }, alwaysInclude: { "native:openai": {} }, timeouts: { overallMs: 100, discoveryMs: 10000 } });
  state.discover = () => new Promise(() => {});
  const pending = new SearchService(new SharedRuntime(DEFAULT_CONCURRENCY)).search({ query: "q", backend }, undefined, ctx);
  let failure: unknown; void pending.catch(error => { failure = error; });
  await vi.advanceTimersByTimeAsync(101);
  expect(failure).toBeUndefined();
  const result = await pending;
  expect(result.details.timedOut).toBe(true);
  expect(result.details.backendStats["native:openai"].status).toBe("not-started");
  expect(result.details.backendStats["native:openai"].reason).toBe("overall-deadline");
  expect(state.calls).toEqual([]);
});

it("enforces one provider slot across simultaneous web and paper tool calls", async () => {
  configure({ concurrency: { maxConcurrent: 1, perProvider: 1 }, backends: { firecrawl: { enabled: true } } });
  let release: (() => void) | undefined;
  state.run = async () => new Promise(resolve => { release = () => resolve([webRow("firecrawl")]); });
  const runtime = new SharedRuntime(DEFAULT_CONCURRENCY);
  const web = new SearchService(runtime).search({ query: "q" }, undefined, ctx);
  await vi.waitFor(() => expect(release).toBeDefined());
  let paperStarted = false;
  const papers = new PaperResearchService(() => [{ name: "firecrawl", search: async () => { paperStarted = true; return [paperRow("firecrawl")]; } }], runtime);
  const paper = papers.execute({ action: "search", query: "q" }, { concurrency: { maxConcurrent: 1, perProvider: 1 } }, undefined);
  await Promise.resolve(); await Promise.resolve(); expect(paperStarted).toBe(false);
  release!(); const results = await Promise.all([web, paper]);
  expect(paperStarted).toBe(true); expect(results.every(result => !result.isError)).toBe(true);
});
