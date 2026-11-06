// Versioned structural contract with ponygirls-subagents; no model-facing capability.
export const HISTORY_CHANNEL = 'ponygirls-subagents:history-v1';
export interface HistorySource {
  sourceId: string; rootSessionId: string; agentId: string; agentPath: string; sessionId: string;
  parentAgentId: string | null; taskRunId: string | null; kind: 'agent' | 'review'; copiedFrom: string | null; reconstructedPrefixBytes: number;
}
export interface HistoryPage { entries: readonly unknown[]; nextOffset: number; eof: boolean; ready: boolean; gaps: readonly string[] }
export interface HistoryFeed {
  sources(): readonly HistorySource[];
  read(sourceId: string, offset: number, limit: number): Promise<HistoryPage>;
  subscribe(listener: () => void): () => void;
}
