import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { config, refreshConfig } from "../config.js";
import { PaperResearchService } from "./service.js";
import { createPaperProviders } from "./providers.js";
import type { SharedRuntime } from "../engine/runtime.js";

const provider = Type.Union([Type.Literal("firecrawl"), Type.Literal("exa"), Type.Literal("searxng"), Type.Literal("arxiv")]);
const identifier = Type.Object({ namespace: Type.Union([Type.Literal("doi"), Type.Literal("arxiv"), Type.Literal("pmid"), Type.Literal("pmcid"), Type.Literal("firecrawl")]), value: Type.String() });
const paperFields = {
  title: Type.String(), url: Type.String(), ids: Type.Array(identifier), authors: Type.Array(Type.String()),
  abstract: Type.Optional(Type.String()), snippet: Type.Optional(Type.String()), date: Type.Optional(Type.String()),
  dateKind: Type.Optional(Type.Union([Type.Literal("published"), Type.Literal("created")])), categories: Type.Array(Type.String()), notices: Type.Optional(Type.Array(Type.String())),
};
const rankedPaper = Type.Object({ ...paperFields, sources: Type.Array(provider),
  contributions: Type.Array(Type.Object({ provider, rank: Type.Number(), weight: Type.Number(), term: Type.Number() })),
  score: Type.Number(), rrfScore: Type.Number(), textBoost: Type.Number(), exactId: Type.Boolean(), exactTitle: Type.Boolean() });
const count = Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum results, or passages for read (default 10 results / 4 passages)." }));
const query = Type.String({ minLength: 1, maxLength: 2000 });
const id = Type.String({ minLength: 1, maxLength: 2000, description: "Source identifier: arxiv:1706.03762, doi:10.…, pmid:…, pmcid:…, or Firecrawl canonical paper ID." });
const mode = Type.Union([Type.Literal("first"), Type.Literal("targeted"), Type.Literal("all")]);
const rerank = Type.Union([Type.Literal("rrf"), Type.Literal("lexical")]);

export function registerPaperResearch(pi: ExtensionAPI, runtime: SharedRuntime): void {
  let service = new PaperResearchService(createPaperProviders, runtime);
  pi.on("session_start", () => { service = new PaperResearchService(createPaperProviders, runtime); });
  pi.registerTool(defineTool({
    name: "paper_research",
    label: "Paper Research",
    description: "Research scholarly papers, separately from ordinary web search. Search fuses configured Firecrawl Research, Exa publication, SearXNG science and opt-in arXiv through the same main/alwaysInclude scheduler and ranking engine as web search, " +
      "deduplicating scholarly identifiers before weighted RRF60 and optional bounded lexical reranking. Exact identifiers and complete title matches get priority. " +
      "Read retrieves metadata or question-relevant passages (Firecrawl); arXiv supports metadata only. Related expands similar papers, citers or references (Firecrawl). " +
      "Retains source IDs, abstracts versus snippets, dates, ranking evidence and partial failures. Does not establish peer review or factual correctness.",
    promptSnippet: "Search, inspect and follow related scholarly papers across configured research sources",
    promptGuidelines: [
      "Use paper_research for scientific literature; use web_search for ordinary websites.",
      "Search uses main sources plus alwaysInclude sources (SearXNG science by default), shared concurrency/deadline budgets and configurable boosts/reranking; select source to bypass other sources, or mode=all for all configured sources.",
      "Read a paper with query to verify relevant passages before citing claims; an abstract or search snippet is not full-text evidence.",
      "Preserve paper identifiers and source citations; multiple retrieval paths are not independent confirmations or proof of peer review.",
    ],
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    parameters: Type.Union([
      Type.Object({ action: Type.Literal("search"), query, numResults: count, source: Type.Optional(provider), mode: Type.Optional(mode), rerank: Type.Optional(rerank) }),
      Type.Object({ action: Type.Literal("read"), id, query: Type.Optional(query), numResults: count,
        source: Type.Optional(Type.Union([Type.Literal("firecrawl"), Type.Literal("arxiv")])) }),
      Type.Object({ action: Type.Literal("related"), id, intent: query, numResults: count,
        mode: Type.Optional(Type.Union([Type.Literal("similar"), Type.Literal("citers"), Type.Literal("references")])) }),
    ]),
    outputSchema: Type.Object({ action: Type.Union([Type.Literal("search"), Type.Literal("read"), Type.Literal("related")]),
      results: Type.Array(rankedPaper), paper: Type.Optional(Type.Object(paperFields)),
      passages: Type.Array(Type.Object({ text: Type.String(), score: Type.Number() })),
      providers: Type.Array(Type.Object({ provider, tier: Type.Union([Type.Literal("main"), Type.Literal("alwaysInclude"), Type.Literal("native")]),
        status: Type.Union([Type.Literal("success"), Type.Literal("empty"), Type.Literal("failed"), Type.Literal("timeout"), Type.Literal("cancelled"), Type.Literal("not-started")]), count: Type.Number(), reason: Type.Optional(Type.String()), error: Type.Optional(Type.String()) })),
      notices: Type.Array(Type.String()), truncated: Type.Boolean(), cancelled: Type.Boolean(), timedOut: Type.Boolean(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      refreshConfig(ctx.cwd);
      return service.execute(params, config, signal);
    },
  }));
}
