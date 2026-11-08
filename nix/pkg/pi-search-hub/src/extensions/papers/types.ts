export const PAPER_PROVIDERS = ["firecrawl", "exa", "searxng", "arxiv"] as const;
export type PaperProviderName = typeof PAPER_PROVIDERS[number];
export type PaperNamespace = "doi" | "arxiv" | "pmid" | "pmcid" | "firecrawl";
export interface PaperIdentifier { namespace: PaperNamespace; value: string }
export interface PaperRecord {
  title: string;
  url: string;
  ids: PaperIdentifier[];
  authors: string[];
  abstract?: string;
  snippet?: string;
  date?: string;
  dateKind?: "published" | "created";
  categories: string[];
  notices?: string[];
}
export interface PaperSearchRequest {
  query: string;
  numResults: number;
}
export interface PaperReadRequest { id: string; query?: string; numResults: number }
export interface PaperRelatedRequest { id: string; intent: string; mode: "similar" | "citers" | "references"; numResults: number }
export interface PaperPassage { text: string; score: number }
export interface PaperReadResult { paper: PaperRecord; passages: PaperPassage[]; notices?: string[] }
export interface PaperProvider {
  name: PaperProviderName;
  search(request: PaperSearchRequest, signal: AbortSignal): Promise<PaperRecord[]>;
  read?: (request: PaperReadRequest, signal: AbortSignal) => Promise<PaperReadResult>;
  related?: (request: PaperRelatedRequest, signal: AbortSignal) => Promise<PaperRecord[]>;
}
export interface PaperSourceConfig {
  enabled?: boolean;
  tier?: "main" | "fallback";
  timeoutMs?: number;
  maxResults?: number;
  boost?: number;
}
export interface PaperConfig {
  mode?: "first" | "targeted" | "all";
  rerank?: "rrf" | "lexical";
  sources?: Partial<Record<PaperProviderName, PaperSourceConfig>>;
}
export interface PaperContribution {
  provider: PaperProviderName;
  rank: number;
  weight: number;
  term: number;
}
export interface RankedPaper extends PaperRecord {
  sources: PaperProviderName[];
  contributions: PaperContribution[];
  score: number;
  rrfScore: number;
  textBoost: number;
  exactId: boolean;
}
export interface PaperProviderStats {
  provider: PaperProviderName;
  tier: "main" | "fallback";
  status: "success" | "empty" | "failed" | "timeout";
  count: number;
  error?: string;
}
export interface PaperSearchResult { results: RankedPaper[]; providers: PaperProviderStats[] }
