import type { EngineDescriptor, SearchMonitor } from "./search-monitor.js";
import type { SearchPolicy } from "./search-policy.js";

export type SearchDomain = "web" | "papers";
/** Safe observations and an explicit test action; metadata getters never retrieve or resolve keys. */
export interface SearchViewProfile {
  monitor: SearchMonitor;
  engines(): readonly EngineDescriptor[];
  policy(): SearchPolicy;
  search(query: string, signal: AbortSignal): Promise<string>;
}
export interface SearchViewProfiles { web: SearchViewProfile; papers: SearchViewProfile }
