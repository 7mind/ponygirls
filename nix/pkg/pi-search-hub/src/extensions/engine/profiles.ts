import type { SearchConfig } from "../types.js";
import { PAPER_PROVIDERS, type PaperProviderName } from "../papers/types.js";
import { resolveProfile } from "./policy.js";
import type { ResolvedProfile, SearchProfileConfig, SourcePolicy } from "./types.js";

export function webProfile(settings: SearchConfig): ResolvedProfile {
  const legacyMode = settings.combine === true ? settings.combineMode ?? "all" : "first";
  if (settings.combineMode !== undefined && settings.combineMode !== "all" && settings.combineMode !== "targeted") throw new Error("Invalid combineMode");
  return resolveProfile({ mode: settings.mode ?? legacyMode, targetUsableSources: settings.targetUsableSources,
    candidates: settings.candidates, ranking: settings.ranking, sources: settings.sources, alwaysInclude: settings.alwaysInclude }, undefined);
}

export function paperProfile(settings: SearchConfig, available: readonly PaperProviderName[]): ResolvedProfile {
  const root = resolveProfile({ mode: settings.mode ?? "targeted", targetUsableSources: settings.targetUsableSources,
    candidates: settings.candidates, ranking: settings.ranking, sources: settings.sources, alwaysInclude: settings.alwaysInclude }, undefined);
  const compatible = (name: string) => PAPER_PROVIDERS.includes(name as PaperProviderName);
  const sources = Object.fromEntries(Object.entries(root.sources).filter(([name]) => compatible(name)));
  const alwaysInclude = { ...Object.fromEntries(available.filter(name => name === "searxng" || name === "arxiv").map(name => [name, {}])),
    ...Object.fromEntries(Object.entries(root.alwaysInclude).filter(([name]) => compatible(name))) };
  const inherited: SearchProfileConfig = { ...root, sources: { ...sources, searxng: { redundantWith: ["*"], ...sources.searxng } }, alwaysInclude };
  const profile = resolveProfile(inherited, settings.papers);
  for (const name of [...Object.keys(profile.sources), ...Object.keys(profile.alwaysInclude)]) {
    if (!PAPER_PROVIDERS.includes(name as PaperProviderName)) throw new Error("Unknown paper source policy");
  }
  return profile;
}

export function candidateCount(profile: ResolvedProfile, count: number): number {
  return Math.min(profile.candidates.maximum, Math.max(profile.candidates.minimum, Math.ceil(profile.candidates.multiplier * count)));
}

export function sourcePolicy(profile: ResolvedProfile, name: string): SourcePolicy {
  return { ...profile.sources[name], ...profile.alwaysInclude[name] };
}

export function validateAlwaysInclude(profile: ResolvedProfile, active: readonly string[]): void {
  for (const name of Object.keys(profile.alwaysInclude)) {
    if (!active.includes(name) && sourcePolicy(profile, name).enabled !== false) throw new Error("alwaysInclude source is not enabled");
  }
}
