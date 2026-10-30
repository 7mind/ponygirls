/**
 * ponygirls-tokemon — provider brand colours (tokemon's palette), nudged so
 * neighbours stay distinct: Meta blue, Zhipu indigo, Qwen violet, and Copilot
 * fuchsia step around the blue-purple wheel; Vercel grey and xAI off-white
 * differ by lightness (both brands are monochrome).
 *
 * Brand colours are drawn on the terminal background, so `readableProviderColor`
 * keeps each OKLCH hue and chroma and moves lightness away from a reference
 * background until the WCAG contrast ratio reaches MIN_CONTRAST. Chroma (not
 * OKHSL's gamut-relative saturation) stays fixed so greys stay grey; where the
 * new lightness cannot hold it, pi-tui's gamut mapping lowers it at fixed hue.
 */

import { colorToHex, colorToOklch, colorToRgb, oklchColor, parseColor, type Color } from "@earendil-works/pi-tui";

export type Appearance = "dark" | "light";

/** WCAG 2 AA for normal-size text. */
export const MIN_CONTRAST = 4.5;
/**
 * Conservative stand-ins for the unknown terminal background: the lightest
 * common dark default (Nord #2E3440, lighter than VS Code #1E1E1E, One Dark
 * #282C34, Dracula #282A36) and the darkest common light default (Gruvbox
 * light #FBF1C7, darker than Solarized light #FDF6E3 and white). Contrast
 * that holds against these also holds against the others.
 */
export const REFERENCE_BACKGROUND: Readonly<Record<Appearance, string>> = { dark: "#2E3440", light: "#FBF1C7" };
/** Bisection steps over OKLCH lightness (0–1): 2^-16 is far below one 8-bit step. */
const LIGHTNESS_SEARCH_STEPS = 16;

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

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance. */
function relativeLuminance(color: Color): number {
  const { r, g, b } = colorToRgb(color);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(parseColor(a)), relativeLuminance(parseColor(b))].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** `hex` with its lightness moved just far enough from the reference background to reach MIN_CONTRAST. */
export function readableColor(hex: string, appearance: Appearance): string {
  const background = REFERENCE_BACKGROUND[appearance];
  if (contrastRatio(hex, background) >= MIN_CONTRAST) return hex;
  const { l, c, h } = colorToOklch(parseColor(hex));
  const at = (lightness: number): string => colorToHex(oklchColor(lightness, c, h));
  // Lightness 1 (white) on dark and 0 (black) on light always reach the target.
  let readable = appearance === "dark" ? 1 : 0;
  let unreadable = l;
  for (let step = 0; step < LIGHTNESS_SEARCH_STEPS; step++) {
    const middle = (readable + unreadable) / 2;
    if (contrastRatio(at(middle), background) >= MIN_CONTRAST) readable = middle;
    else unreadable = middle;
  }
  return at(readable);
}

export function readableProviderColor(provider: string, appearance: Appearance): string {
  return readableColor(providerColor(provider), appearance);
}
