export type SearchMode = "first" | "targeted" | "all";
export type SourceTier = "main" | "alwaysInclude" | "native";
export interface SearchTimeouts {
  overallMs: number;
  sourceMs: number;
  alwaysIncludeMs: number;
  nativeMs: number;
  nativeGraceMs: number;
  discoveryMs: number;
  readerMs: number;
  credentialMs: number;
}
export interface ConcurrencyLimits { maxConcurrent: number; perProvider: number }
export interface CandidatePolicy { multiplier: number; minimum: number; maximum: number }
export interface RankingPolicy {
  rankConstant: number;
  rerank: "rrf" | "lexical";
  titleWeight: number;
  bodyWeight: number;
  exactTitle: boolean;
}
export interface SourcePolicy {
  enabled?: boolean;
  timeoutMs?: number;
  maxResults?: number;
  boost?: number;
  /** Additional paths do not add a vote when one of these sources found the same document. '*' matches any other source. */
  redundantWith?: string[];
}
export interface SearchProfileConfig {
  mode?: SearchMode;
  targetUsableSources?: number;
  candidates?: Partial<CandidatePolicy>;
  ranking?: Partial<RankingPolicy>;
  sources?: Record<string, SourcePolicy>;
  alwaysInclude?: Record<string, SourcePolicy>;
}
export interface ResolvedProfile {
  mode: SearchMode;
  targetUsableSources: number;
  candidates: CandidatePolicy;
  ranking: RankingPolicy;
  sources: Record<string, SourcePolicy>;
  alwaysInclude: Record<string, SourcePolicy>;
}
export interface EngineSource<T> {
  id: string;
  provider: string;
  tier: SourceTier;
  timeoutMs: number;
  maxResults: number;
  weight: number;
  redundantWith: string[];
  settlementGraceMs: number;
  run(query: string, count: number, signal: AbortSignal): Promise<T[]>;
  /** Safe observation of the authoritative logical outcome, exactly once, before fusion. */
  onOutcome?(stat: SourceStats): void;
}
export type SourceStatus = "success" | "empty" | "failed" | "timeout" | "cancelled" | "not-started";
export interface SourceStats {
  source: string;
  tier: SourceTier;
  status: SourceStatus;
  count: number;
  reason?: "source-deadline" | "overall-deadline" | "caller-cancelled" | "target-satisfied";
  error?: string;
}
export interface RankedList<T> { source: string; weight: number; redundantWith: string[]; results: T[] }
export interface EngineSearchRequest {
  query: string;
  numResults: number;
  mode: SearchMode;
  targetUsableSources: number;
  overallTimeoutMs: number;
  signal: AbortSignal | undefined;
}
export interface EngineSearchResult<T> { lists: RankedList<T>[]; stats: SourceStats[]; cancelled: boolean; timedOut: boolean }
export interface RankingContribution { source: string; rank: number; weight: number; term: number }
export interface RankingEvidence {
  sources: string[];
  contributions: RankingContribution[];
  rrfScore: number;
  textBoost: number;
  score: number;
  exactId: boolean;
  exactTitle: boolean;
}
export interface DocumentAdapter<T> {
  normalize(document: T): T;
  aliases(document: T): string[];
  merge(documents: T[]): T;
  title(document: T): string;
  body(document: T): string;
  exactIdentifier(document: T, query: string): boolean;
}
export interface RankedDocument<T> { document: T; ranking: RankingEvidence }
