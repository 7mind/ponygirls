import assert from "node:assert/strict";
import test from "node:test";
import { colorToOklch, parseColor } from "@earendil-works/pi-tui";
import { contrastRatio, MIN_CONTRAST, providerColor, readableColor, readableProviderColor, REFERENCE_BACKGROUND, type Appearance } from "../src/colors.ts";

const APPEARANCES: Appearance[] = ["dark", "light"];
const PROVIDERS = ["github-copilot", "kimi-coding", "meta", "minimax", "openrouter", "vercel-ai-gateway", "xai", "zai", "xiaomi", "qwen-token-plan", "some-new-provider", "another-one"];
/** OKLCH hue in degrees, wrapped. */
const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
/** Below this chroma a colour is grey and its hue is noise. */
const ACHROMATIC = 0.02;
const MAX_HUE_DRIFT_DEGREES = 3;

test("the contrast ratio follows WCAG 2", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrastRatio("#767676", "#ffffff") - 4.54) < 0.01);
});

test("the review's failing brand colours were below the minimum on their reference backgrounds", () => {
  assert.ok(contrastRatio("#7C3AED", REFERENCE_BACKGROUND.dark) < MIN_CONTRAST, "qwen on dark");
  assert.ok(contrastRatio("#6366F1", REFERENCE_BACKGROUND.dark) < MIN_CONTRAST, "zai on dark");
  assert.ok(contrastRatio("#F8FAFC", REFERENCE_BACKGROUND.light) < 1.1, "xai on light");
});

test("every provider colour reaches the minimum contrast on both appearances", () => {
  for (const appearance of APPEARANCES) {
    for (const provider of PROVIDERS) {
      const color = readableProviderColor(provider, appearance);
      const ratio = contrastRatio(color, REFERENCE_BACKGROUND[appearance]);
      assert.ok(ratio >= MIN_CONTRAST, `${provider} on ${appearance}: ${color} ${ratio.toFixed(2)}:1`);
    }
  }
});

test("adjusted colours keep their hue and only move lightness away from the background", () => {
  for (const appearance of APPEARANCES) {
    for (const provider of PROVIDERS) {
      const brand = providerColor(provider);
      const readable = readableProviderColor(provider, appearance);
      const before = colorToOklch(parseColor(brand));
      const after = colorToOklch(parseColor(readable));
      if (readable === brand) continue;
      assert.ok(appearance === "dark" ? after.l > before.l : after.l < before.l, `${provider} on ${appearance}: ${brand} → ${readable}`);
      assert.ok(after.c <= before.c + 0.005, `${provider} on ${appearance}: chroma grew ${before.c} → ${after.c}`);
      if (before.c >= ACHROMATIC) assert.ok(hueDistance(before.h, after.h) <= MAX_HUE_DRIFT_DEGREES, `${provider} on ${appearance}: hue ${before.h} → ${after.h}`);
    }
  }
});

test("readable colours stay unchanged and adjustments stay close to the minimum", () => {
  assert.equal(readableColor("#06B6D4", "dark"), "#06B6D4");
  assert.equal(readableColor("#7C3AED", "light"), "#7C3AED");
  for (const [hex, appearance] of [["#7C3AED", "dark"], ["#6366F1", "dark"], ["#F8FAFC", "light"]] as const) {
    const ratio = contrastRatio(readableColor(hex, appearance), REFERENCE_BACKGROUND[appearance]);
    assert.ok(ratio >= MIN_CONTRAST && ratio < MIN_CONTRAST + 0.2, `${hex} on ${appearance}: ${ratio}`);
  }
  // xAI's off-white becomes a darker grey, not a tint.
  assert.ok(colorToOklch(parseColor(readableColor("#F8FAFC", "light"))).c < ACHROMATIC);
});
