// Specified Behavioral-Active tests: public adapters with a hand-written HTTP transport dummy.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPaperProviders } from "../extensions/papers/providers.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchConfig } from "../extensions/types.js";

const signal = () => new AbortController().signal;
const request = { query: "attention & learning", numResults: 2 };
const paper = { paperId: "123", primaryId: "arxiv:1706.03762", ids: { arxiv: ["1706.03762"], doi: ["10.1/test"] }, title: "Attention", abstract: "An abstract", authors: ["Alice", "Bob"], createdDate: "2017-06-12" };
const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention &amp; Learning</title><summary>A &lt;b&gt; summary</summary><author><name>Alice</name></author><author><name>Bob</name></author><published>2017-06-12T00:00:00Z</published><category term="cs.AI"/><arxiv:doi>10.1/test</arxiv:doi></entry></feed>`;
function config(name: string): SearchConfig { return { backends: { [name]: { enabled: true, ...(name === "searxng" ? { instanceUrl: "https://search.example/base" } : {}) } }, papers: { sources: { arxiv: { enabled: name === "arxiv" } } } }; }
class HttpDummy {
  calls: { url: URL; init: RequestInit }[] = [];
  constructor(public response: unknown = { results: [] }, public status = 200) {}
  fetch: typeof fetch = async (input, init = {}) => {
    this.calls.push({ url: new URL(String(input)), init });
    init.signal?.throwIfAborted();
    return new Response(typeof this.response === "string" ? this.response : JSON.stringify(this.response), { status: this.status });
  };
}
let home: string; let originalHome: string | undefined;
beforeEach(async () => { originalHome = process.env.HOME; home = await mkdtemp(join(tmpdir(), "paper-adapters-")); process.env.HOME = home; });
afterEach(async () => { vi.useRealTimers(); if (originalHome == null) delete process.env.HOME; else process.env.HOME = originalHome; await rm(home, { recursive: true, force: true }); });
describe("paper adapters (BG)", () => {
  it("includes sources only when enabled and allows independent paper opt-in", () => {
    expect(createPaperProviders({ backends: { firecrawl: { enabled: true }, exa: { enabled: false } } }).map(p => p.name)).toEqual(["firecrawl"]);
    expect(createPaperProviders({ backends: { firecrawl: { enabled: true } }, papers: { sources: { firecrawl: { enabled: false }, exa: { enabled: true }, arxiv: { enabled: true } } } }).map(p => p.name)).toEqual(["exa", "arxiv"]);
  });
  it("maps current Firecrawl search, read and related envelopes with keyless auth", async () => {
    const http = new HttpDummy({ success: true, partial: true, results: [paper] });
    const provider = createPaperProviders(config("firecrawl"), http.fetch)[0];
    const records = await provider.search(request, signal());
    expect(records[0]).toMatchObject({ abstract: "An abstract", authors: ["Alice", "Bob"], dateKind: "created", notices: ["Firecrawl returned partial results"] });
    expect(records[0].ids).toContainEqual({ namespace: "firecrawl", value: "123" });
    expect(http.calls[0].url.searchParams.get("query")).toBe(request.query);
    expect(http.calls[0].init.headers).not.toHaveProperty("Authorization");
    http.response = { success: true, paper: { ...paper, authors: "Alice, Bob", categories: ["cs.AI"] }, passages: [{ text: "A passage", score: .8 }] };
    expect(await provider.read!({ id: "a/b?c", numResults: 2, query: "why?" }, signal())).toMatchObject({ paper: { categories: ["cs.AI"], authors: ["Alice", "Bob"] }, passages: [{ text: "A passage", score: .8 }] });
    expect(http.calls[1].url.pathname).toContain("a%2Fb%3Fc");
    http.response = { success: true, results: [paper], truncated: true, poolSize: 100 };
    expect((await provider.related!({ id: "123", intent: "topic", mode: "citers", numResults: 1 }, signal()))[0].notices).toBeDefined();
    expect(http.calls[2].url.searchParams.get("rerank")).toBe("true");
  });
  // Regression: live Firecrawl rejects k unless query is supplied.
  it("omits Firecrawl k when reading metadata without query", async () => {
    const transport: typeof fetch = async (input) => {
      const endpoint = new URL(String(input));
      if (!endpoint.searchParams.has("query") && endpoint.searchParams.has("k")) return new Response("invalid parameters", { status: 400 });
      return Response.json({ success: true, paper: { ...paper, authors: "Alice, Bob" } });
    };
    const result = await createPaperProviders(config("firecrawl"), transport)[0].read!({ id: "arxiv:1706.03762", numResults: 4 }, signal());
    expect(result.passages).toEqual([]);
  });
  it("uses Exa publication search and preserves text as snippet, not abstract", async () => {
    const http = new HttpDummy({ results: [{ title: "Paper", url: "https://example.org/p", text: "Full text", author: "Alice", publishedDate: "2020-01-01" }], notices: ["Limited results"] });
    const settings = config("exa"); settings.backends!.exa!.apiKey = "secret-key";
    const [record] = await createPaperProviders(settings, http.fetch)[0].search(request, signal());
    expect(record).toMatchObject({ snippet: "Full text", dateKind: "published", notices: ["Limited results"] }); expect(record.abstract).toBeUndefined();
    expect(JSON.parse(String(http.calls[0].init.body))).toMatchObject({ category: "publication", type: "auto", contents: { text: { maxCharacters: 10000 } } });
    expect(http.calls[0].init.headers).toHaveProperty("x-api-key", "secret-key");
  });
  it("uses SearXNG science category, no count and safe partial notice", async () => {
    const http = new HttpDummy({ results: [{ title: "Paper", url: "https://example.org", content: "Snippet" }], unresponsive_engines: [["engine", "secret-key"]] });
    const [record] = await createPaperProviders(config("searxng"), http.fetch)[0].search(request, signal());
    expect(record.snippet).toBe("Snippet"); expect(record.abstract).toBeUndefined(); expect(JSON.stringify(record)).not.toContain("secret-key");
    expect(http.calls[0].url.searchParams.get("categories")).toBe("science"); expect(http.calls[0].url.searchParams.has("count")).toBe(false);
    const unsafe = config("searxng"); unsafe.backends!.searxng!.instanceUrl = "http://user:secret@search.example:8888";
    await expect(createPaperProviders(unsafe, http.fetch)[0].search(request, signal())).rejects.toThrow("searxng paper request failed"); expect(http.calls).toHaveLength(1);
  });
  // Regression: configured instances are trusted operator destinations, including private hosts.
  it("allows operator-configured private SearXNG instances without redirecting credentials", async () => {
    const http = new HttpDummy({ results: [] }); const settings = config("searxng");
    settings.backends!.searxng!.instanceUrl = "http://localhost:8888";
    expect(await createPaperProviders(settings, http.fetch)[0].search(request, signal())).toEqual([]);
    expect(http.calls[0].init.redirect).toBe("error");
  });
  it("parses real Atom entities/attributes and escapes arXiv search operators", async () => {
    const http = new HttpDummy(xml);
    const [record] = await createPaperProviders(config("arxiv"), http.fetch)[0].search({ query: 'cat" OR ti:dog', numResults: 1 }, signal());
    expect(record).toMatchObject({ title: "Attention & Learning", abstract: "A <b> summary", authors: ["Alice", "Bob"], categories: ["cs.AI"], dateKind: "published" });
    expect(http.calls[0].url.searchParams.get("search_query")).toBe('all:"cat" AND all:"OR" AND all:"ti" AND all:"dog"');
    expect(record.ids).toContainEqual({ namespace: "doi", value: "10.1/test" });
  });
  it("serializes arXiv concurrent search/read >=3 seconds and read is metadata only", async () => {
    const http = new HttpDummy(xml); const provider = createPaperProviders(config("arxiv"), http.fetch)[0];
    const started = Date.now();
    const a = provider.search(request, signal()); const b = createPaperProviders(config("arxiv"), http.fetch)[0].read!({ id: "1706.03762", numResults: 1 }, signal());
    await a;
    expect((await b).passages).toEqual([]); expect(http.calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
    expect(http.calls.find(c => c.url.searchParams.has("id_list"))?.url.searchParams.has("search_query")).toBe(false);
  });
  it("cancels queued arXiv work immediately and never fetches it", async () => {
    const http = new HttpDummy(xml); const provider = createPaperProviders(config("arxiv"), http.fetch)[0];
    await provider.search(request, signal());
    const controller = new AbortController(); const b = provider.search(request, controller.signal); const rejected = expect(b).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
    expect(http.calls).toHaveLength(1);
  });
  for (const name of ["firecrawl", "exa", "searxng", "arxiv"]) {
    it(`${name} handles empty results`, async () => {
      const http = new HttpDummy(name === "arxiv" ? "<feed></feed>" : { success: true, results: [] });
      expect(await createPaperProviders(config(name), http.fetch)[0].search(request, signal())).toEqual([]);
    });
    it(`${name} hides upstream, transport and credential errors`, async () => {
      const settings = config(name); settings.backends![name]!.apiKey = "secret-key";
      for (const http of [new HttpDummy("secret-key body", 500), new HttpDummy({ results: "secret-key" }), new HttpDummy("<feed><entry></feed>")]) {
        await expect(createPaperProviders(settings, http.fetch)[0].search(request, signal())).rejects.toThrow(`${name} paper request failed`);
      }
      const failing: typeof fetch = async () => { throw new Error("secret-key transport"); };
      await expect(createPaperProviders(settings, failing)[0].search(request, signal())).rejects.toThrow(`${name} paper request failed`);
    }, 20000);
    it(`${name} forwards abort signal and rejects bounded oversized bodies`, async () => {
      const http = new HttpDummy("x".repeat(2_000_001)); const controller = new AbortController();
      await expect(createPaperProviders(config(name), http.fetch)[0].search(request, controller.signal)).rejects.toThrow(`${name} paper request failed`);
      expect(http.calls[0].init.signal).toBe(controller.signal);
      controller.abort();
      await expect(createPaperProviders(config(name), http.fetch)[0].search(request, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    });
  }
  it("routes exact arXiv URL queries to id_list and does not search unsupported IDs", async () => {
    const http = new HttpDummy(xml); const provider = createPaperProviders(config("arxiv"), http.fetch)[0];
    await provider.search({ query: "https://arxiv.org/pdf/1706.03762v7.pdf", numResults: 2 }, signal());
    expect(http.calls[0].url.searchParams.get("id_list")).toBe("1706.03762v7");
    expect(await provider.search({ query: "doi:10.1234/test", numResults: 2 }, signal())).toEqual([]);
    expect(await provider.search({ query: "pmid:12345", numResults: 2 }, signal())).toEqual([]);
    expect(http.calls).toHaveLength(1);
  });
  it("fails closed on missing/corrupt arXiv state and never removes a foreign lock", async () => {
    const root = join(home, ".pi/agent/paper-arxiv"); await mkdir(root, { recursive: true });
    const http = new HttpDummy(xml);
    await expect(createPaperProviders(config("arxiv"), http.fetch)[0].search(request, signal())).rejects.toThrow("arxiv paper request failed");
    await writeFile(join(root, "state.json"), "invalid");
    await expect(createPaperProviders(config("arxiv"), http.fetch)[0].search(request, signal())).rejects.toThrow("arxiv paper request failed");
    await mkdir(join(root, "lock")); await writeFile(join(root, "lock/owner"), "foreign");
    const controller = new AbortController(); const pending = createPaperProviders(config("arxiv"), http.fetch)[0].search(request, controller.signal);
    const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" }); setTimeout(() => controller.abort(), 30); await failed;
    expect(http.calls).toHaveLength(0);
  });
  it("rejects XML entity declarations", async () => {
    const http = new HttpDummy('<!DOCTYPE feed [<!ENTITY x "secret">]><feed><entry>&x;</entry></feed>');
    await expect(createPaperProviders(config("arxiv"), http.fetch)[0].search(request, signal())).rejects.toThrow("arxiv paper request failed");
  });
});
