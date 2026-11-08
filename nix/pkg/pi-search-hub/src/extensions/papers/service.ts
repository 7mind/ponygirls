import type { SearchConfig } from "../types.js";
import { createPaperProviders } from "./providers.js";
import { boundedPaperOperation, runPaperMetasearch, validatePaperConfig } from "./metasearch.js";
import { fusePapers } from "./ranking.js";
import type { PaperConfig, PaperPassage, PaperProvider, PaperProviderName, PaperProviderStats, PaperReadResult, PaperRecord, RankedPaper } from "./types.js";

export type PaperResearchParams =
  | { action: "search"; query: string; numResults?: number; source?: PaperProviderName; mode?: PaperConfig["mode"]; rerank?: PaperConfig["rerank"] }
  | { action: "read"; id: string; query?: string; numResults?: number; source?: "firecrawl" | "arxiv" }
  | { action: "related"; id: string; intent: string; mode?: "similar" | "citers" | "references"; numResults?: number };
export interface PaperResearchOutput {
  action: "search" | "read" | "related";
  results: RankedPaper[];
  paper?: PaperRecord;
  passages: PaperPassage[];
  providers: PaperProviderStats[];
  notices: string[];
  truncated: boolean;
}
const MAX_OUTPUT_BYTES = 60_000;
const MAX_QUERY_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;
const POLICY_NOTICE = "Paper metadata and passages are source evidence, not independent confirmation or proof of peer review. Ranking uses weighted RRF60, optional bounded lexical boosts, and exact-identifier priority; semantic quality has not been benchmarked.";

function text(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}
function boundedPaper<T extends PaperRecord>(paper: T): T {
  return { ...paper, title: text(paper.title, 400), abstract: paper.abstract === undefined ? undefined : text(paper.abstract, 1400),
    snippet: paper.snippet === undefined ? undefined : text(paper.snippet, 600),
    authors: paper.authors.slice(0, 20).map(author => text(author, 100)), categories: paper.categories.slice(0, 10).map(category => text(category, 80)),
    notices: paper.notices === undefined ? undefined : paper.notices.slice(0, 5).map(notice => text(notice, 500)) };
}
function boundedOutput(output: PaperResearchOutput): PaperResearchOutput {
  const original = JSON.stringify(output);
  const result: PaperResearchOutput = { ...output, results: output.results.map(boundedPaper),
    paper: output.paper === undefined ? undefined : boundedPaper(output.paper),
    passages: output.passages.map(passage => ({ ...passage, text: text(passage.text, 6000) })),
    notices: [...new Set(output.notices.map(notice => text(notice, 500)))].slice(0, 20) };
  result.truncated = JSON.stringify(result) !== original;
  while (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_OUTPUT_BYTES - 200) {
    result.truncated = true;
    if (result.passages.length > 0) result.passages.pop();
    else if (result.results.length > 0) result.results.pop();
    else throw new Error("Paper metadata exceeds the output limit");
  }
  if (result.truncated) result.notices.push("Output was bounded: text, author/category lists or result/passages may have been truncated.");
  return result;
}
function requiredText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_QUERY_LENGTH) {
    throw new Error(`${label} must contain 1–${MAX_QUERY_LENGTH} characters`);
  }
}
function resultCount(value: number | undefined, fallback: number): number {
  const count = value === undefined ? fallback : value;
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("numResults must be an integer from 1 to 20");
  return count;
}

/** Session-owned providers retain direct-source rate limiting across tool calls. */
export class PaperResearchService {
  private signature: string | undefined;
  private providers: PaperProvider[] = [];
  private arxiv: PaperProvider | undefined;
  constructor(private readonly factory: typeof createPaperProviders) {}

  async execute(params: PaperResearchParams, settings: SearchConfig, signal: AbortSignal | undefined) {
    signal?.throwIfAborted();
    const paperSettings = settings.papers === undefined ? {} : settings.papers;
    validatePaperConfig(paperSettings);
    const signature = JSON.stringify({ backends: settings.backends, papers: paperSettings });
    if (signature !== this.signature) {
      this.providers = this.factory(settings).map(provider => {
        if (provider.name !== "arxiv") return provider;
        if (this.arxiv === undefined) this.arxiv = provider;
        return this.arxiv;
      });
      this.signature = signature;
    }
    if (this.providers.length === 0) throw new Error("No paper sources configured. Enable Firecrawl, Exa, SearXNG or papers.sources.arxiv in search.json.");
    const output: PaperResearchOutput = { action: params.action, results: [], passages: [], providers: [], notices: [POLICY_NOTICE], truncated: false };
    if (params.action === "search") {
      requiredText(params.query, "query");
      const count = resultCount(params.numResults, 10);
      const providers = params.source === undefined ? this.providers : this.providers.filter(provider => provider.name === params.source);
      if (providers.length === 0) throw new Error("Requested paper source is not enabled");
      const policy = { ...paperSettings,
        ...(params.mode === undefined ? {} : { mode: params.mode }), ...(params.rerank === undefined ? {} : { rerank: params.rerank }) };
      const result = await runPaperMetasearch(providers, policy, { query: params.query, numResults: count }, signal);
      output.results = result.results;
      output.providers = result.providers;
    } else if (params.action === "read" || params.action === "related") {
      requiredText(params.id, "id");
      const name = params.action === "read" ? params.source ?? "firecrawl" : "firecrawl";
      const provider = this.providers.find(candidate => candidate.name === name);
      if (provider === undefined) throw new Error(`Paper source ${name} is not enabled`);
      const timeout = paperSettings.sources?.[name]?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const count = resultCount(params.numResults, params.action === "read" ? 4 : 10);
      if (params.action === "read") {
        if (params.query !== undefined) {
          requiredText(params.query, "query");
          if (name === "arxiv") throw new Error("arXiv supports metadata only; use Firecrawl for passage questions");
        }
        const read = provider.read;
        if (read === undefined) throw new Error("This source does not support paper reads");
        let result: PaperReadResult;
        try { result = await boundedPaperOperation(operationSignal => read({ id: params.id, query: params.query, numResults: count }, operationSignal), timeout, signal); }
        catch { signal?.throwIfAborted(); throw new Error(`Paper read failed (${name}); source unavailable or paper/passages not found`); }
        output.paper = result.paper;
        output.passages = result.passages.slice(0, count);
        output.notices.push(...(result.notices ?? []));
        if (params.query !== undefined && output.passages.length === 0) {
          output.notices.push("No full-text passages returned; metadata is not passage evidence.");
        }
      } else {
        requiredText(params.intent, "intent");
        if (params.mode !== undefined && !["similar", "citers", "references"].includes(params.mode)) throw new Error("Invalid related-paper mode");
        const related = provider.related;
        if (related === undefined) throw new Error("This source does not support related papers");
        let papers: PaperRecord[];
        try { papers = await boundedPaperOperation(operationSignal => related({ id: params.id, intent: params.intent,
          mode: params.mode ?? "similar", numResults: count }, operationSignal), timeout, signal); }
        catch { signal?.throwIfAborted(); throw new Error("Related-paper retrieval failed (firecrawl)"); }
        output.results = fusePapers([{ provider: name, weight: paperSettings.sources?.[name]?.boost ?? 1, results: papers }], params.intent, count, paperSettings.rerank ?? "lexical");
      }
      output.providers = [{ provider: name, tier: paperSettings.sources?.[name]?.tier ?? (name === "arxiv" ? "fallback" : "main"),
        status: params.action === "related" && output.results.length === 0 ? "empty" : "success",
        count: params.action === "read" ? 1 : output.results.length }];
    } else throw new Error("Unknown paper research action");
    output.notices.push(...output.results.flatMap(paper => paper.notices ?? []), ...(output.paper?.notices ?? []));
    const bounded = boundedOutput(output);
    return { content: [{ type: "text" as const, text: JSON.stringify(bounded) }],
      details: bounded, structuredContent: bounded,
      isError: bounded.providers.length > 0 && bounded.providers.every(provider => provider.status === "failed" || provider.status === "timeout") };
  }
}
