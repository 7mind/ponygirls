import type { JsonObject } from "@earendil-works/pi-ai";
import type { SearchConfig } from "../types.js";
import { createPaperProviders } from "./providers.js";
import { runPaperMetasearch, validatePaperConfig } from "./metasearch.js";
import { rankPapers } from "./ranking.js";
import { SearchMonitor, type EngineDescriptor, type SearchOutcome } from "../search-monitor.js";
import type { SearchPolicy } from "../search-policy.js";
import { SharedRuntime, TimeoutError } from "../engine/runtime.js";
import { resolveConcurrency, resolveTimeouts } from "../engine/policy.js";
import { candidateCount, paperProfile, sourcePolicy } from "../engine/profiles.js";
import { PAPER_PROVIDERS, type PaperConfig, type PaperPassage, type PaperProvider, type PaperProviderName, type PaperProviderStats, type PaperReadResult, type PaperRecord, type RankedPaper } from "./types.js";

export type PaperResearchParams =
  | { action: "search"; query: string; numResults?: number; source?: PaperProviderName; mode?: PaperConfig["mode"]; rerank?: "rrf" | "lexical" }
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
  cancelled: boolean;
  timedOut: boolean;
}
const MAX_OUTPUT_BYTES = 60_000;
const MAX_QUERY_LENGTH = 2000;
const POLICY_NOTICE = "Paper metadata and passages are source evidence, not independent confirmation or proof of peer review. Web and paper search share tier scheduling, weighted rank fusion, configurable lexical boosts and exact-lookup priority; semantic quality has not been benchmarked.";

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
  readonly monitor = new SearchMonitor();
  private descriptors: EngineDescriptor[] = [];
  private policySnapshot: SearchPolicy | undefined;
  engines(): readonly EngineDescriptor[] { return this.descriptors.map(engine => ({ ...engine })); }
  policy(): SearchPolicy {
    if (!this.policySnapshot) throw new Error("Paper policy is unavailable before refresh");
    return structuredClone(this.policySnapshot);
  }
  private signature: string | undefined;
  private providers: PaperProvider[] = [];
  private arxiv: PaperProvider | undefined;
  constructor(private readonly factory: typeof createPaperProviders, private readonly runtime: SharedRuntime) {}

  refresh(settings: SearchConfig): void {
    const paperSettings = settings.papers === undefined ? {} : settings.papers;
    validatePaperConfig(paperSettings);
    this.runtime.configure(resolveConcurrency(settings.concurrency));
    const timeouts = resolveTimeouts(settings.timeouts);
    const inherited = paperProfile(settings, []);
    const effective = { ...settings, papers: { ...paperSettings,
      sources: Object.fromEntries(PAPER_PROVIDERS.map(name => [name, sourcePolicy(inherited, name)])) } };
    const signature = JSON.stringify({ backends: settings.backends, papers: effective.papers, timeouts });
    if (signature !== this.signature) {
      this.providers = this.factory(effective).map(provider => {
        if (provider.name !== "arxiv") return provider;
        if (this.arxiv === undefined) this.arxiv = provider;
        return this.arxiv;
      });
      this.signature = signature;
    }
    const profile = paperProfile(settings, this.providers.map(provider => provider.name));
    const active = this.providers.filter(provider => sourcePolicy(profile, provider.name).enabled !== false);
    this.descriptors = active.map(provider => this.descriptor(provider.name, profile));
    const sources = active.map(({ name }) => ({ name,
      timeoutMs: sourcePolicy(profile, name).timeoutMs ?? (name in profile.alwaysInclude ? timeouts.alwaysIncludeMs : timeouts.sourceMs),
      maxResults: sourcePolicy(profile, name).maxResults ?? candidateCount(profile, 10), boost: sourcePolicy(profile, name).boost ?? 1 }));
    this.policySnapshot = {
      defaultResultCount: 10, maximumResultCount: 20,
      main: { mode: profile.mode, combineForced: false, combineMode: "all", selectionStrategy: "sequential",
        engineOrder: active.filter(p => !(p.name in profile.alwaysInclude)).map(p => p.name),
        targetUsableEngines: profile.targetUsableSources, requestedPerEngine: candidateCount(profile, 10) },
      fallback: sources.filter(p => p.name in profile.alwaysInclude).map(p => ({ backend: p.name, timeoutMs: p.timeoutMs, maxResults: p.maxResults })),
      native: { engineCount: 0, timeoutMs: timeouts.nativeMs, settlementGraceMs: timeouts.nativeGraceMs },
      fusion: { rankConstant: profile.ranking.rankConstant, rerank: profile.ranking.rerank, titleWeight: profile.ranking.titleWeight, bodyWeight: profile.ranking.bodyWeight, exactTitle: profile.ranking.exactTitle },
      execution: { ...resolveConcurrency(settings.concurrency), overallTimeoutMs: timeouts.overallMs, sourceTimeoutMs: timeouts.sourceMs, discoveryTimeoutMs: timeouts.discoveryMs }, sources,
    };
  }
  private descriptor(name: string, profile: ReturnType<typeof paperProfile>): EngineDescriptor {
    return { name, label: name, tier: name in profile.alwaysInclude ? "fallback" : "main", availability: "configured" };
  }
  private async operation<T>(name: string, profile: ReturnType<typeof paperProfile>, timeout: number, signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>, count: (value: T) => number): Promise<T> {
    let finish: ((outcome: SearchOutcome) => void) | undefined;
    try {
      const result = await this.runtime.operation(name, timeout, signal, 0, child => {
        finish = this.monitor.begin(this.descriptor(name, profile));
        return run(child);
      });
      const observed = count(result);
      finish?.({ status: observed ? "success" : "empty", resultCount: observed });
      return result;
    } catch (error) {
      finish?.({ status: error instanceof TimeoutError ? "timeout" : signal?.aborted ? "cancelled" : "failed" });
      throw error;
    }
  }
  async execute(params: PaperResearchParams, settings: SearchConfig, signal: AbortSignal | undefined) {
    signal?.throwIfAborted();
    this.refresh(settings);
    const paperSettings = settings.papers ?? {};
    const timeouts = resolveTimeouts(settings.timeouts);
    const profile = paperProfile(settings, this.providers.map(provider => provider.name));
    if (this.providers.filter(provider => sourcePolicy(profile, provider.name).enabled !== false).length === 0) throw new Error("No paper sources configured. Enable Firecrawl, Exa, SearXNG or papers.sources.arxiv in search.json.");
    const output: PaperResearchOutput = { action: params.action, results: [], passages: [], providers: [], notices: [POLICY_NOTICE], truncated: false, cancelled: false, timedOut: false };
    if (params.action === "search") {
      requiredText(params.query, "query");
      const count = resultCount(params.numResults, 10);
      const providers = params.source === undefined ? this.providers : this.providers.filter(provider => provider.name === params.source);
      if (providers.length === 0) throw new Error("Requested paper source is not enabled");
      const policy = { ...paperSettings,
        ...(params.mode === undefined ? {} : { mode: params.mode }), ...(params.rerank === undefined ? {} : { ranking: { ...paperSettings.ranking, rerank: params.rerank } }) };
      const resolved = { ...profile, mode: params.mode ?? profile.mode, ranking: { ...profile.ranking, rerank: params.rerank ?? profile.ranking.rerank },
        alwaysInclude: params.source === undefined ? profile.alwaysInclude : {} };
      const finishers = new Map<string, (outcome: SearchOutcome) => void>();
      const observed = providers.map(provider => ({ ...provider, search: (request: Parameters<PaperProvider["search"]>[0], child: AbortSignal) => {
        finishers.set(provider.name, this.monitor.begin(this.descriptor(provider.name, profile)));
        return provider.search(request, child);
      } }));
      const result = await runPaperMetasearch(observed, policy, { query: params.query, numResults: count }, signal, this.runtime, timeouts, resolved, stat => {
        if (stat.status !== "not-started") finishers.get(stat.provider)?.({ status: stat.status, resultCount: stat.count });
      });
      output.results = result.results;
      output.providers = result.providers;
      output.cancelled = result.cancelled === true;
      output.timedOut = result.timedOut === true;
      if (output.timedOut) output.notices.push("Overall search deadline reached; only completed results are included.");
    } else if (params.action === "read" || params.action === "related") {
      requiredText(params.id, "id");
      const name = params.action === "read" ? params.source ?? "firecrawl" : "firecrawl";
      const provider = this.providers.find(candidate => candidate.name === name && sourcePolicy(profile, name).enabled !== false);
      if (provider === undefined) throw new Error(`Paper source ${name} is not enabled`);
      const timeout = Math.min(sourcePolicy(profile, name).timeoutMs ?? timeouts.sourceMs, timeouts.overallMs);
      const count = resultCount(params.numResults, params.action === "read" ? 4 : 10);
      if (params.action === "read") {
        if (params.query !== undefined) {
          requiredText(params.query, "query");
          if (name === "arxiv") throw new Error("arXiv supports metadata only; use Firecrawl for passage questions");
        }
        const read = provider.read;
        if (read === undefined) throw new Error("This source does not support paper reads");
        let result: PaperReadResult;
        try { result = await this.operation(name, profile, timeout, signal, operationSignal => read({ id: params.id, query: params.query, numResults: count }, operationSignal), () => 1); }
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
        try { papers = await this.operation(name, profile, timeout, signal, operationSignal => related({ id: params.id, intent: params.intent,
          mode: params.mode ?? "similar", numResults: count }, operationSignal), papers => Math.min(papers.length, count)); }
        catch { signal?.throwIfAborted(); throw new Error("Related-paper retrieval failed (firecrawl)"); }
        output.results = rankPapers([{ source: name, weight: sourcePolicy(profile, name).boost ?? 1,
          redundantWith: sourcePolicy(profile, name).redundantWith ?? [], results: papers }], params.intent, count, profile.ranking);
      }
      output.providers = [{ provider: name, tier: name in profile.alwaysInclude ? "alwaysInclude" : "main",
        status: params.action === "related" && output.results.length === 0 ? "empty" : "success",
        count: params.action === "read" ? 1 : output.results.length }];
    } else throw new Error("Unknown paper research action");
    output.notices.push(...output.results.flatMap(paper => paper.notices ?? []), ...(output.paper?.notices ?? []));
    const bounded = boundedOutput(output);
    const serialized = JSON.stringify(bounded);
    return { content: [{ type: "text" as const, text: serialized }],
      details: bounded, structuredContent: JSON.parse(serialized) as PaperResearchOutput & JsonObject,
      isError: bounded.cancelled || (bounded.providers.length > 0 && bounded.providers.every(provider => provider.status !== "success" && provider.status !== "empty")) };
  }
}
