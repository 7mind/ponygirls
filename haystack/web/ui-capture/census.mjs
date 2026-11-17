// Static design-token census of the dashboard stylesheet(s). Usage:
//   node census.mjs [css files…]   (default: ../src/styles.css and shared/account-web/account.css)
// Prints Markdown; pass --json for machine output. Regex-based: counts literal
// declarations, not computed styles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== "--json");
const files = args.length ? args : [path.join(here, "../src/styles.css"), path.join(here, "../../../shared/account-web/account.css")];
const json = process.argv.includes("--json");

function census(file) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const decls = [];
  // rule bodies, including those nested in @media
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      decls.push({ selector, prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() });
    }
  }
  const tally = (list) => { const t = new Map(); for (const v of list) t.set(v, (t.get(v) ?? 0) + 1); return [...t].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); };
  const isVarDef = (d) => d.prop.startsWith("--");
  const colorRe = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  const lengths = (v) => [...v.replace(/var\([^)]*\)|calc\([^)]*\)|min\([^)]*\)|clamp\([^)]*\)/g, "").matchAll(/-?\d*\.?\d+(?:px|rem|em|%|vh|dvh|vw|ch)?/g)].map((x) => x[0]).filter((x) => x !== "0" || true);
  const varDefs = decls.filter(isVarDef);
  const nonVar = decls.filter((d) => !isVarDef(d));
  const sizes = nonVar.filter((d) => d.prop === "font-size").map((d) => d.value)
    .concat(nonVar.filter((d) => d.prop === "font").flatMap((d) => [...d.value.matchAll(/(?:^|\s)(\d+(?:\.\d+)?(?:px|rem|em))(?:\/|\s)/g)].map((x) => x[1])));
  const spacingDecls = nonVar.filter((d) => /^(margin|padding|gap)(-(top|right|bottom|left|inline|block))?$|^(row-gap|column-gap)$/.test(d.prop));
  const spacingValues = spacingDecls.flatMap((d) => lengths(d.value).filter((x) => /(px|rem|em)$/.test(x) || x === "0"));
  const radii = nonVar.filter((d) => d.prop === "border-radius").map((d) => d.value);
  const shadows = nonVar.filter((d) => d.prop === "box-shadow").map((d) => d.value);
  const literalColors = nonVar.flatMap((d) => [...d.value.matchAll(colorRe)].map((x) => x[0].toLowerCase()));
  const varColors = varDefs.flatMap((d) => [...d.value.matchAll(colorRe)].map((x) => x[0].toLowerCase()));
  const weights = nonVar.filter((d) => d.prop === "font-weight").map((d) => d.value).concat(nonVar.filter((d) => d.prop === "font").flatMap((d) => [...d.value.matchAll(/(?:^|\s)([1-9]00|normal|bold)(?:\s|$)/g)].map((x) => x[1])));
  const families = nonVar.filter((d) => /^font(-family)?$/.test(d.prop)).map((d) => d.value.replace(/^[^"A-Za-z]*(?:\d+(?:\.\d+)?(?:px|rem|em)(?:\/[\d.]+(?:px|rem|em)?)?\s+)?/, "").slice(0, 70));
  const lineHeights = nonVar.filter((d) => d.prop === "line-height").map((d) => d.value).concat(nonVar.filter((d) => d.prop === "font").flatMap((d) => [...d.value.matchAll(/\/([\d.]+(?:px|rem|em)?)/g)].map((x) => x[1])));
  const zIndex = nonVar.filter((d) => d.prop === "z-index").map((d) => d.value);
  const breakpoints = [...css.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
  const varUses = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  const borders = nonVar.filter((d) => /^border(-(top|right|bottom|left))?$/.test(d.prop)).map((d) => d.value.replace(colorRe, "COLOR"));
  const opacity = nonVar.filter((d) => d.prop === "opacity").map((d) => d.value);
  const maxWidths = nonVar.filter((d) => /^(max-)?(width|height)$|^min-(width|height)$/.test(d.prop)).map((d) => `${d.prop}:${d.value}`);
  return { file, declarations: decls.length, rules: [...css.matchAll(/\{/g)].length,
    customProperties: varDefs.map((d) => `${d.prop}: ${d.value}`),
    distinctVarDefs: new Set(varDefs.map((d) => d.prop)).size,
    varUses: tally(varUses), literalColorsOutsideVarDefs: tally(literalColors), colorsInVarDefs: tally(varColors),
    fontSizes: tally(sizes), spacing: tally(spacingValues), spacingDeclCount: spacingDecls.length, radii: tally(radii), shadows: tally(shadows), weights: tally(weights),
    families: tally(families), lineHeights: tally(lineHeights), zIndex: tally(zIndex), breakpoints: tally(breakpoints), borders: tally(borders), opacity: tally(opacity), sizes: tally(maxWidths).length };
}
const results = files.map(census);
if (json) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
for (const r of results) {
  console.log(`## ${path.relative(process.cwd(), r.file)}\n`);
  console.log(`- declarations: ${r.declarations}; rule blocks: ${r.rules}; custom properties defined: ${r.distinctVarDefs} (${r.customProperties.length} definitions incl. dark overrides)`);
  const row = (name, list) => console.log(`- **${name}**: ${list.length} distinct — ${list.map(([v, n]) => `${v}×${n}`).join(", ")}`);
  row("font sizes", r.fontSizes); row("font weights", r.weights); row("line heights", r.lineHeights);
  row("spacing values (margin/padding/gap)", r.spacing); console.log(`  (${r.spacingDeclCount} spacing declarations)`);
  row("border radii", r.radii); row("box shadows", r.shadows);
  row("literal colours outside custom-property definitions", r.literalColorsOutsideVarDefs); row("colours inside custom-property definitions", r.colorsInVarDefs);
  row("z-index", r.zIndex); row("@media conditions", r.breakpoints); row("border shorthands (colour masked)", r.borders); row("font families", r.families);
  console.log(`- var() uses: ${r.varUses.reduce((a, [, n]) => a + n, 0)} across ${r.varUses.length} distinct properties`);
  console.log();
}
