/** Safe, resolved display metadata for automatic-search defaults; never credentials or backend config. */
export interface SearchPolicy {
  defaultResultCount: number;
  maximumResultCount: number;
  main: {
    mode: "first" | "targeted" | "all" | "invalid";
    combineForced: boolean;
    combineMode: "targeted" | "all" | "invalid";
    selectionStrategy: "sequential" | "random" | "round-robin" | "best-latency" | "unrecognized";
    /** Configured preference, before random/round-robin/score selection; never a sampled next-query order. */
    engineOrder: readonly string[];
    targetUsableEngines: number;
    requestedPerEngine: number | null;
  };
  fallback: readonly {
    backend: string;
    timeoutMs: number;
    /** Effective request and local cap for the displayed default result count. */
    maxResults: number;
  }[];
  native: { engineCount: number; timeoutMs: number; settlementGraceMs: number };
  fusion: { rankConstant: number; rerank: "rrf" | "lexical"; titleWeight: number; bodyWeight: number; exactTitle: boolean };
  execution: { maxConcurrent: number; perProvider: number; overallTimeoutMs: number; sourceTimeoutMs: number; discoveryTimeoutMs: number };
}
