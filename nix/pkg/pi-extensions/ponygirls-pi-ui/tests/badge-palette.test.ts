import assert from "node:assert/strict";
import test from "node:test";
import { colorToHex, colorToRgb, foregroundAnsi, indexedColor, parseColor, rgbColor, visibleWidth, type Color, type TerminalColorMode } from "@earendil-works/pi-tui";
import { borderBadge, borderBadgeCompact, type BorderBadge } from "../src/badge.ts";
import { PLAIN_THEME, type UiState } from "../src/theme.ts";

const PALETTES = {
  dark: { border: "#5fa8cc", accent: "#a798d7", warning: "#cd9a22", error: "#ea7f81", success: "#68b78d", muted: "#9da5a9" },
  light: { border: "#3d8eb3", accent: "#7459b4", warning: "#8f6802", error: "#c8253d", success: "#337e58", muted: "#677176" },
} as const;
const CHIP_BACKGROUNDS = {
  dark: { settled: "#2d3f4c", running: "#3c3c4e", attention: "#4a412a", error: "#573d43", ok: "#304440" },
  light: { settled: "#d2e1e9", running: "#ddd7e9", attention: "#ded4bb", error: "#eabec4", ok: "#ceddd5" },
} as const;
const STATES = ["settled", "running", "attention", "error", "ok"] as const;
const APPEARANCES = ["dark", "light"] as const;
type Appearance = typeof APPEARANCES[number];

function concreteColors(appearance: Appearance) {
  const values = PALETTES[appearance];
  return {
    border: parseColor(values.border), accent: parseColor(values.accent), warning: parseColor(values.warning),
    error: parseColor(values.error), success: parseColor(values.success), muted: parseColor(values.muted),
  };
}

function fixture(appearance: Appearance, mode: TerminalColorMode) {
  return {
    ...PLAIN_THEME,
    appearance,
    colors: concreteColors(appearance),
    getColorMode: () => mode,
  };
}

function look(state: UiState): BorderBadge {
  return { glyph: "🐦", state, label: "5", compact: "5", wideLabel: "2+3", wideShortcut: "⌃⌥C" };
}

function emittedColors(line: string, role: 38 | 48): Color[] {
  return Array.from(line.matchAll(new RegExp(`\\x1b\\[${role};(2;(\\d+);(\\d+);(\\d+)|5;(\\d+))m`, "g")),
    ([, , r, g, b, index]) => index === undefined ? rgbColor(Number(r), Number(g), Number(b)) : indexedColor(Number(index)));
}

function luminance(color: Color): number {
  const { r, g, b } = colorToRgb(color);
  const linear = (n: number) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);
}

function contrast(text: Color, bg: Color): number {
  const a = luminance(text);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// BA: observe the emitted colors and text at the public badge renderer boundary.
test("wide chips match the approved tints in both built-in appearances, including quiet", () => {
  for (const appearance of APPEARANCES) {
    const theme = fixture(appearance, "truecolor");
    for (const state of STATES) {
      const line = borderBadge(theme, look(state), 120);
      const backgrounds = emittedColors(line, 48).map(colorToHex);
      assert.deepEqual(backgrounds, [CHIP_BACKGROUNDS[appearance][state]], `${appearance}/${state}`);
      assert.equal(line.replace(/\x1b\[[0-9;]*m/g, ""), " 🐦 2+3 · ⌃⌥C ");
      assert.equal(visibleWidth(line.trimEnd()), visibleWidth(" 🐦 2+3 · ⌃⌥C "), "Pi trims before measuring the click span");
      assert.match(line, /\x1b\[49m$/, "the fill ends before the next badge");
    }
  }
});

test("tints survive 256-colour output, with readable label and shortcut in both colour modes", () => {
  for (const appearance of APPEARANCES) {
    for (const mode of ["truecolor", "256color"] as const) {
      const theme = fixture(appearance, mode);
      const tints = new Set<string>();
      for (const state of STATES) {
        const line = borderBadge(theme, look(state), 120);
        const [bg] = emittedColors(line, 48);
        assert.ok(bg, `${appearance}/${mode}/${state} has a fill`);
        assert.equal(bg.kind, mode === "truecolor" ? "rgb" : "indexed");
        const { r, g, b } = colorToRgb(bg);
        assert.notEqual(Math.max(r, g, b) - Math.min(r, g, b), 0, `${appearance}/${mode}/${state} is not gray`);
        tints.add(colorToHex(bg));
        const inks = emittedColors(line, 38);
        assert.equal(inks.length, 2, "label and shortcut both use explicit foregrounds");
        for (const ink of inks) assert.ok(contrast(ink, bg) >= 4.5, `${appearance}/${mode}/${state}: ${colorToHex(ink)} on ${colorToHex(bg)}`);
      }
      assert.equal(tints.size, STATES.length, `${appearance}/${mode} does not quantize distinct states to the same tint`);
    }
  }
});

test("a mounted glyph-only badge uses the live theme and changes tint with state", () => {
  let appearance: Appearance = "dark";
  const theme = { ...PLAIN_THEME, get appearance() { return appearance; }, get colors() { return concreteColors(appearance); }, getColorMode: () => "truecolor" as const };
  const badge = { glyph: "🎯", state: "running", label: "", compact: "" } as const;
  const bg = (look: BorderBadge) => emittedColors(borderBadge(theme, look, 132), 48).map(colorToHex);
  assert.deepEqual(bg(badge), [CHIP_BACKGROUNDS.dark.running]);
  assert.deepEqual(bg({ ...badge, state: "settled" }), [CHIP_BACKGROUNDS.dark.settled]);
  appearance = "light";
  assert.deepEqual(bg(badge), [CHIP_BACKGROUNDS.light.running]);
});

test("a theme with terminal-defined ANSI colours keeps its own ink and width rather than guessing a tint", () => {
  const theme = {
    ...fixture("dark", "256color"),
    colors: { ...concreteColors("dark"), border: indexedColor(4), muted: indexedColor(7) },
    fg: (_role: string, text: string) => `${foregroundAnsi(indexedColor(7), "256color")}${text}\x1b[39m`,
  };
  const line = borderBadge(theme, look("settled"), 120);
  assert.deepEqual(emittedColors(line, 48), [], "ANSI 0–15 have no known RGB for tint math");
  assert.deepEqual(emittedColors(line, 38), [indexedColor(7), indexedColor(7)]);
  assert.equal(visibleWidth(line.trimEnd()), visibleWidth(" 🐦 2+3 · ⌃⌥C "));
});

test("below 120 columns and in compact slots the original foregrounds and contents are unchanged", () => {
  const theme = {
    ...fixture("dark", "truecolor"),
    fg(role: string, text: string) {
      assert.equal(role, "warning");
      return `${foregroundAnsi(parseColor(PALETTES.dark.warning), "truecolor")}${text}\x1b[39m`;
    },
  };
  const normal = borderBadge(theme, look("attention"), 119);
  const compact = borderBadgeCompact(theme, look("attention"), 120);
  assert.equal(normal, ` 🐦 ${theme.fg("warning", "5")} `);
  assert.equal(compact, `🐦${theme.fg("warning", "5")}`);
  assert.equal(borderBadge(theme, { ...look("attention"), wideLabel: "x".repeat(122) }, 120), compact);
});
