/** Paper metadata adapters. arXiv metadata is CC0. A host-local file lock
 * serializes Pi processes sharing getAgentDir(), including the whole connection.
 * Operators must coordinate across machines/different agent directories. A crash
 * leaves a fail-closed lock: after stopping all clients, explicitly remove
 * paper-arxiv/lock. Never delete state.json: missing/corrupt state fails closed;
 * repair it only while all clients are stopped, using a conservative timestamp. */
import { mkdir, readFile, writeFile, rename, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { resolveBackendKey } from "../credentials.js";
import { getAgentDir } from "../utils.js";
import type { SearchConfig } from "../types.js";
import type { PaperIdentifier, PaperProvider, PaperProviderName, PaperRecord } from "./types.js";

const MAX_BYTES = 2_000_000;
type Obj = Record<string, unknown>;
function object(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid response");
  return v as Obj;
}
function string(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new Error("Invalid response");
  return v.trim();
}
function optional(v: unknown): string | undefined { return v == null ? undefined : string(v); }
function strings(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error("Invalid response");
  return v.map(string);
}
function array(v: unknown): unknown[] { if (!Array.isArray(v)) throw new Error("Invalid response"); return v; }
function count(n: number): number { if (!Number.isInteger(n) || n < 1) throw new Error("Invalid request"); return Math.min(n, 50); }
function url(v: unknown): string { const s = string(v); const u = new URL(s); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("Invalid response"); return s; }
function ids(v: unknown): PaperIdentifier[] {
  if (v == null) return [];
  const data = object(v);
  return (["doi", "arxiv", "pmid", "pmcid"] as const).flatMap(namespace => strings(data[namespace]).map(value => ({ namespace, value })));
}
function canonical(values: PaperIdentifier[]): string {
  for (const ns of ["doi", "arxiv", "pmid", "pmcid"]) {
    const id = values.find(i => i.namespace === ns)?.value;
    if (id) return ns === "doi" ? `https://doi.org/${encodeURI(id)}` : ns === "arxiv" ? `https://arxiv.org/abs/${encodeURI(id)}` : ns === "pmid" ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(id)}/` : `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(id)}/`;
  }
  return "";
}
function firePaper(v: unknown, read = false): PaperRecord {
  const p = object(v); const identifiers = ids(p.ids);
  identifiers.push({ namespace: "firecrawl", value: string(p.paperId) });
  if (p.primaryId != null) {
    const primary = string(p.primaryId); const colon = primary.indexOf(":");
    const namespace = primary.slice(0, colon);
    if (["doi", "arxiv", "pmid", "pmcid"].includes(namespace) && colon > 0) identifiers.push({ namespace: namespace as PaperIdentifier["namespace"], value: primary.slice(colon + 1) });
  }
  const unique = identifiers.filter((id, index) => identifiers.findIndex(x => x.namespace === id.namespace && x.value === id.value) === index);
  return { title: string(p.title), url: canonical(unique) || `https://api.firecrawl.dev/v2/search/research/papers/${encodeURIComponent(string(p.paperId))}`, ids: unique,
    authors: read && typeof p.authors === "string" ? p.authors.split(",").map(x => x.trim()).filter(Boolean) : strings(p.authors),
    abstract: optional(p.abstract), categories: strings(p.categories), date: optional(p.createdDate), dateKind: p.createdDate == null ? undefined : "created" };
}
function webPaper(v: unknown, exa: boolean): PaperRecord {
  const p = object(v);
  return { title: string(p.title), url: url(p.url), ids: [], authors: p.author == null ? [] : [string(p.author)], categories: [],
    snippet: exa ? optional(p.text) ?? (p.highlights == null ? undefined : strings(p.highlights).join("\n")) : optional(p.content),
    date: optional(p.publishedDate), dateKind: p.publishedDate == null ? undefined : "published" };
}
async function body(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.ok) { await response.body?.cancel(); throw new Error("Upstream failure"); }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("Response too large"); }
  if (!response.body) throw new Error("Invalid response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("Response too large"); }
      chunks.push(next.value);
    }
    const all = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
async function safe<T>(name: PaperProviderName, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  try { signal.throwIfAborted(); return await work(); }
  catch { if (signal.aborted) throw new DOMException("Paper request cancelled", "AbortError"); throw new Error(`${name} paper request failed`); }
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Fail-closed advisory lock. No age-based stealing: a slow live request and a
 * crashed request cannot safely be distinguished by another process. */
async function withArxivLock<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const root = join(getAgentDir(), "paper-arxiv");
  await mkdir(getAgentDir(), { recursive: true, mode: 0o700 });
  try {
    await mkdir(root, { mode: 0o700 });
    // Only the process that created the state directory may initialize it. If
    // interrupted here, other processes fail closed instead of inventing state.
    await writeFile(join(root, "state.json"), JSON.stringify({ lastStart: 0 }), { flag: "wx", mode: 0o600 });
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const lock = join(root, "lock"); const owner = randomUUID();
  while (true) {
    signal.throwIfAborted();
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    await delay(100, signal);
  }
  // If owner creation fails leave the lock unavailable, never steal/remove it.
  await writeFile(join(lock, "owner"), owner, { flag: "wx", mode: 0o600 });
  try {
    const state = object(JSON.parse(await readFile(join(root, "state.json"), "utf8")));
    if (typeof state.lastStart !== "number" || !Number.isSafeInteger(state.lastStart) || state.lastStart < 0) throw new Error("Invalid rate state");
    // Recheck the wall clock after each wait (including backwards clock jumps).
    while (state.lastStart + 3000 > Date.now()) await delay(Math.min(state.lastStart + 3000 - Date.now(), 3000), signal);
    signal.throwIfAborted();
    const temp = join(lock, "next-state.json");
    await writeFile(temp, JSON.stringify({ lastStart: Date.now() }), { flag: "wx", mode: 0o600 });
    await rename(temp, join(root, "state.json"));
    signal.throwIfAborted();
    try { return await work(); }
    finally {
      await writeFile(temp, JSON.stringify({ lastStart: Date.now() }), { flag: "wx", mode: 0o600 });
      await rename(temp, join(root, "state.json"));
    }
  } finally {
    if (await readFile(join(lock, "owner"), "utf8") === owner) {
      await unlink(join(lock, "owner"));
      await rmdir(lock);
    }
  }
}
function arxivIdentifier(value: string): string | undefined {
  let id = value.trim().replace(/^arxiv:\s*/i, "");
  if (/^https?:\/\/(?:www\.)?arxiv.org\/(?:abs|pdf)\//i.test(id)) {
    const parsed = new URL(id); id = parsed.pathname.replace(/^\/(?:abs|pdf)\//, "").replace(/\.pdf$/i, "");
  }
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(id) ? id : undefined;
}
const atomParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true, processEntities: true });
function many(v: unknown): unknown[] { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function atom(text: string): PaperRecord[] {
  // No DTDs or user-defined entities: only standard XML entities are needed.
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error("Invalid XML");
  const raw = object(atomParser.parse(text)).feed;
  if (raw === "") return [];
  const feed = object(raw);
  return many(feed.entry).map(v => {
    const p = object(v); const idUrl = url(p.id); const parsed = new URL(idUrl);
    if (parsed.hostname !== "arxiv.org" || !parsed.pathname.startsWith("/abs/")) throw new Error("Invalid response");
    const id = parsed.pathname.slice(5); if (!id || id === "errors") throw new Error("Invalid response");
    const identifiers: PaperIdentifier[] = [{ namespace: "arxiv", value: id }];
    if (p["arxiv:doi"] != null) identifiers.push({ namespace: "doi", value: string(p["arxiv:doi"]) });
    return { title: string(p.title).replace(/\s+/g, " "), url: `https://arxiv.org/abs/${id}`, ids: identifiers,
      abstract: string(p.summary).replace(/\s+/g, " "), authors: many(p.author).map(a => string(object(a).name)),
      categories: many(p.category).map(c => string(object(c)["@_term"])), date: string(p.published), dateKind: "published" };
  });
}

/** Optional fetch injection is a transport boundary for offline fixture tests. */
export function createPaperProviders(settings: SearchConfig, transport: typeof fetch = fetch): PaperProvider[] {
  const config = settings;
  const providers: PaperProvider[] = [];
  const enabled = (name: PaperProviderName) => config.papers?.sources?.[name]?.enabled === true || (name !== "arxiv" && !!settings.backends?.[name]?.enabled && config.papers?.sources?.[name]?.enabled !== false);
  const json = async (name: PaperProviderName, endpoint: string, signal: AbortSignal, payload?: unknown) => {
    signal.throwIfAborted();
    const key = await resolveBackendKey(name, settings, signal);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers[name === "exa" ? "x-api-key" : "Authorization"] = name === "exa" ? key : `Bearer ${key}`;
    if (payload) headers["Content-Type"] = "application/json";
    return object(JSON.parse(await body(await transport(endpoint, { method: payload ? "POST" : "GET", headers, body: payload ? JSON.stringify(payload) : undefined, signal, redirect: "error" }), signal)));
  };
  if (enabled("firecrawl")) {
    const base = "https://api.firecrawl.dev/v2/search/research/papers";
    const fireResults = (data: Obj) => array(checked(data).results).map(v => {
      const record = firePaper(v);
      if (data.partial === true || data.truncated === true) record.notices = ["Firecrawl returned partial results"];
      return record;
    });
    const checked = (data: Obj) => { if (data.success !== true) throw new Error("Invalid response"); return data; };
    providers.push({ name: "firecrawl",
      search: (r, s) => safe("firecrawl", s, async () => fireResults(await json("firecrawl", `${base}?${new URLSearchParams({ query: r.query, k: String(count(r.numResults)) })}`, s)).slice(0, count(r.numResults))),
      read: (r, s) => safe("firecrawl", s, async () => {
        const params = new URLSearchParams(); if (r.query?.trim()) { params.set("query", r.query); params.set("k", String(count(r.numResults))); }
        const data = checked(await json("firecrawl", `${base}/${encodeURIComponent(string(r.id))}${params.size ? `?${params}` : ""}`, s));
        const passages = data.passages == null ? [] : array(data.passages).map(v => { const p = object(v); if (typeof p.score !== "number" || !Number.isFinite(p.score)) throw new Error("Invalid response"); return { text: string(p.text), score: p.score }; });
        return { paper: firePaper(data.paper, true), passages: passages.slice(0, count(r.numResults)), ...(data.partial === true ? { notices: ["Firecrawl returned partial results"] } : {}) };
      }),
      related: (r, s) => safe("firecrawl", s, async () => {
        if (!["similar", "citers", "references"].includes(r.mode)) throw new Error("Invalid request");
        const params = new URLSearchParams({ intent: r.intent, mode: r.mode, k: String(count(r.numResults)), rerank: "true" });
        return fireResults(await json("firecrawl", `${base}/${encodeURIComponent(string(r.id))}/similar?${params}`, s)).slice(0, count(r.numResults));
      }),
    });
  }
  if (enabled("exa")) providers.push({ name: "exa", search: (r, s) => safe("exa", s, async () => {
    const data = await json("exa", "https://api.exa.ai/search", s, { query: r.query, type: "auto", category: "publication", numResults: count(r.numResults), contents: { text: { maxCharacters: 10000 } } });
    const notices = data.notices == null ? undefined : strings(data.notices).slice(0, 10).map(n => n.slice(0, 500));
    return array(data.results).map(v => ({ ...webPaper(v, true), notices })).slice(0, count(r.numResults));
  }) });
  if (enabled("searxng")) providers.push({ name: "searxng", search: (r, s) => safe("searxng", s, async () => {
    const base = string(settings.backends?.searxng?.instanceUrl).replace(/\/+$/, "");
    // Operator-controlled configuration, unlike arbitrary user-supplied read URLs:
    // local/private self-hosted instances are supported. Never follow redirects.
    const instance = new URL(base);
    if (!["https:", "http:"].includes(instance.protocol) || instance.username || instance.password || instance.search || instance.hash) throw new Error("Unsafe instance");
    const endpoint = `${base}/search?${new URLSearchParams({ q: r.query, format: "json", categories: "science" })}`;
    const data = await json("searxng", endpoint, s);
    return array(data.results).map(v => {
      const record = webPaper(v, false);
      if (Array.isArray(data.unresponsive_engines) && data.unresponsive_engines.length) record.notices = ["Some SearXNG engines were unavailable"];
      return record;
    }).slice(0, count(r.numResults));
  }) });
  if (enabled("arxiv")) {
    // The host lock serializes all instances and its acquisition waits are abortable.
    // Retain the physical operation promise after dispatch: racing it against abort
    // would release the shared runtime's pool slot while transport still owns it.
    const request = (params: URLSearchParams, signal: AbortSignal) => withArxivLock(signal, async () =>
      atom(await body(await transport(`https://export.arxiv.org/api/query?${params}`, { signal, redirect: "error", headers: { Accept: "application/atom+xml" } }), signal)));
    providers.push({ name: "arxiv",
      search: (r, s) => safe("arxiv", s, () => {
        const exact = arxivIdentifier(r.query);
        if (exact) return request(new URLSearchParams({ id_list: exact, max_results: "1" }), s);
        if (/^(?:(?:doi|pmid|pmcid):|10\.\d{4,9}\/|https?:\/\/(?:dx\.)?doi\.org\/)/i.test(r.query.trim())) return Promise.resolve([]);
        const terms = r.query.match(/[\p{L}\p{N}]+/gu) ?? []; if (!terms.length) throw new Error("Invalid request");
        return request(new URLSearchParams({ search_query: terms.map(term => `all:"${term}"`).join(" AND "), max_results: String(count(r.numResults)), sortBy: "relevance", sortOrder: "descending" }), s);
      }),
      read: (r, s) => safe("arxiv", s, async () => {
        const id = arxivIdentifier(r.id);
        if (!id) throw new Error("Invalid request");
        const papers = await request(new URLSearchParams({ id_list: id, max_results: "1" }), s);
        if (papers.length !== 1) throw new Error("Paper not found");
        return { paper: papers[0], passages: [], ...(r.query?.trim() ? { notices: ["arXiv supports metadata only; passage retrieval is unavailable"] } : {}) };
      }),
    });
  }
  return providers;
}
