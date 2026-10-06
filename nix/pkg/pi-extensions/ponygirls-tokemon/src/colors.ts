/**
 * ponygirls-tokemon — provider brand colours (tokemon's palette), nudged so
 * neighbours stay distinct: Meta blue, Zhipu indigo, Qwen violet, and Copilot
 * fuchsia step around the blue-purple wheel; Vercel grey and xAI off-white
 * differ by lightness (both brands are monochrome).
 */

const PROVIDER_COLORS = new Map([
  ["github-copilot", "#D946EF"],
  ["kimi-coding", "#B58900"],
  ["meta", "#0082FB"],
  ["minimax", "#EF4444"],
  ["minimax-cn", "#EF4444"],
  ["openrouter", "#06B6D4"],
  ["vercel-ai-gateway", "#9CA3AF"],
  ["xai", "#F8FAFC"],
  ["xai-management", "#F8FAFC"],
  ["zai", "#6366F1"],
  ["zai-coding-cn", "#6366F1"],
  ["xiaomi", "#FF6900"],
  ["qwen-token-plan", "#7C3AED"],
  ["qwen-token-plan-cn", "#7C3AED"],
]);
/** Family fallbacks for future provider ids (e.g. a new xiaomi-* plan). */
const PREFIX_COLORS: ReadonlyArray<[string, string]> = [["xiaomi", "#FF6900"], ["qwen", "#7C3AED"], ["minimax", "#EF4444"], ["zai", "#6366F1"], ["xai", "#F8FAFC"]];
/** Deterministic picks for anything unknown. */
const FALLBACK_COLORS = ["#22D3EE", "#E879F9", "#4ADE80", "#FACC15", "#60A5FA", "#67E8F9", "#F0ABFC", "#86EFAC"];

export function providerColor(provider: string): string {
  const exact = PROVIDER_COLORS.get(provider);
  if (exact !== undefined) return exact;
  const family = PREFIX_COLORS.find(([prefix]) => provider.startsWith(prefix));
  if (family !== undefined) return family[1];
  let hash = 0;
  for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}
