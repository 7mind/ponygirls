// Static design-token census of the Manure stylesheets (no server, no browser).
// usage: node token-census.mjs [outdir]   -> prints markdown, writes token-census.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const FILES = {
  "dashboard/styles.css": "manure/web/dashboard/styles.css",
  "account.css (shared/account-web)": "shared/account-web/account.css",
  "unlock/styles.css": "manure/web/unlock/styles.css",
  "viewer/styles.css": "manure/web/viewer/styles.css",
};

function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const decls = []; const media = [];
  // flatten: track @media prelude by brace depth
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") { stack.push(buf.trim()); buf = ""; }
    else if (ch === "}") { flush(); stack.pop(); }
    else if (ch === ";") { flush(); }
    else buf += ch;
  }
  function flush() {
    const t = buf.trim(); buf = "";
    if (!t) return;
    const m = /^([a-zA-Z-]+|--[\w-]+)\s*:\s*([\s\S]+)$/.exec(t);
    if (!m) return;
    const ctx = stack.filter((s) => s.startsWith("@media")).join(" ");
    const sel = stack.filter((s) => !s.startsWith("@")).at(-1) || "";
    decls.push({ prop: m[1], value: m[2].trim().replace(/\s+/g, " "), selector: sel, media: ctx });
  }
  for (const s of css.matchAll(/@media\s*([^{]+)\{/g)) media.push(s[1].trim());
  return { decls, media };
}
const LEN = /(-?\d*\.?\d+)(px|rem|em|%|vh|vw|dvh|ch)\b|(?<![\w.#-])0(?![\w.%])/g;
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|transparent|currentColor)\b/g;
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

function census(files) {
  const out = {};
  for (const [label, rel] of Object.entries(files)) {
    const css = fs.readFileSync(path.join(root, rel), "utf8");
    const { decls, media } = parse(css);
    const r = { file: rel, bytes: css.length, declarations: decls.length, customProperties: {}, fontSizes: new Map(), fontWeights: new Map(), lineHeights: new Map(), letterSpacings: new Map(),
      spacing: new Map(), radii: new Map(), shadows: new Map(), colorLiterals: new Map(), colorVarUses: new Map(), zIndex: new Map(), breakpoints: new Map(), fontFamilies: new Map(), borderWidths: new Map(), sizes: new Map() };
    for (const m of media) bump(r.breakpoints, m);
    for (const d of decls) {
      if (d.prop.startsWith("--")) { (r.customProperties[d.media || "(base)"] ||= {})[d.prop] = d.value; }
      if (d.prop === "font-size") bump(r.fontSizes, d.value);
      if (d.prop === "font") { const m = /(\d*\.?\d+(?:px|rem|em))(?:\/(\S+))?/.exec(d.value); if (m) { bump(r.fontSizes, m[1]); if (m[2]) bump(r.lineHeights, m[2]); } }
      if (d.prop === "font-weight") bump(r.fontWeights, d.value);
      if (d.prop === "line-height") bump(r.lineHeights, d.value);
      if (d.prop === "letter-spacing") bump(r.letterSpacings, d.value);
      if (d.prop === "font-family") bump(r.fontFamilies, d.value.slice(0, 60));
      if (/^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/.test(d.prop)) for (const v of d.value.match(LEN) || []) bump(r.spacing, v);
      if (/^border(-(top|right|bottom|left))?(-width)?$/.test(d.prop)) for (const v of d.value.match(/\d*\.?\d+px/g) || []) bump(r.borderWidths, v);
      if (d.prop === "border-radius") bump(r.radii, d.value);
      if (d.prop === "box-shadow") bump(r.shadows, d.value);
      if (d.prop === "z-index") bump(r.zIndex, d.value);
      if (/^(width|min-width|max-width|height|min-height|max-height)$/.test(d.prop)) bump(r.sizes, d.value);
      if (!d.prop.startsWith("--")) {
        for (const c of d.value.match(COLOR) || []) bump(r.colorLiterals, c.toLowerCase());
        for (const c of d.value.matchAll(/var\((--[\w-]+)/g)) bump(r.colorVarUses, c[1]);
      }
    }
    // custom-property definitions also carry colour literals: count them separately
    r.colorsDefinedInCustomProperties = new Set(decls.filter((d) => d.prop.startsWith("--")).flatMap((d) => (d.value.match(COLOR) || []).map((c) => c.toLowerCase()))).size;
    for (const k of Object.keys(r)) if (r[k] instanceof Map) r[k] = sorted(r[k]);
    out[label] = r;
  }
  return out;
}

// ---- contrast (WCAG 2.x) for the dashboard token pairs, both schemes
const hex = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); if (h.length === 4) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };

function contrast() {
  const css = fs.readFileSync(path.join(root, FILES["dashboard/styles.css"]), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root1 = /:root\s*\{([^}]*)\}/.exec(css)[1];
  const dark = /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)[1];
  const vars = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]));
  const light = vars(root1); const darkV = { ...light, ...vars(dark) };
  const pairs = [["--ink", "--background"], ["--ink", "--surface"], ["--muted", "--surface"], ["--muted", "--surface-muted"], ["--muted", "--background"], ["--accent", "--surface"],
    ["--on-accent", "--accent"], ["--selected-ink", "--selected"], ["--selected-ink", "--surface-muted"], ["--warning", "--warning-surface"], ["--danger", "--danger-surface"], ["--danger", "--surface"],
    ["--positive", "--positive-surface"], ["--positive", "--surface"], ["--line", "--surface"], ["--line-strong", "--surface"], ["--input-line", "--surface"], ["--muted", "--surface-hover"], ["--accent", "--surface-muted"]];
  const rows = pairs.map(([fg, bg]) => ({ fg, bg, light: ratio(light[fg], light[bg]), dark: ratio(darkV[fg], darkV[bg]) }));
  // account.css hard-coded palette
  const acc = fs.readFileSync(path.join(root, FILES["account.css (shared/account-web)"]), "utf8");
  const a = (n) => /--account-[\w-]+:\s*(#[0-9a-f]+)/g;
  const accountLight = { bg: "#fff", fg: "#17212e", muted: "#526071", border: "#c9d2df", panel: "#f1f5f9", danger: "#a61b26" };
  const accountDark = { bg: "#17212e", fg: "#edf2f9", muted: "#b4c0cf", border: "#455569", panel: "#202f41", danger: "#ffadb4" };
  const accountRows = [["fg", "bg"], ["muted", "bg"], ["muted", "panel"], ["danger", "bg"], ["border", "bg"]].map(([f, b]) => ({ pair: `${f} on ${b}`, light: ratio(accountLight[f], accountLight[b]), dark: ratio(accountDark[f], accountDark[b]) }));
  return { dashboard: rows, accountDialog: accountRows };
}

const result = { generated: new Date().toISOString(), files: census(FILES), contrast: contrast() };
const outdir = process.argv[2] ? path.resolve(process.argv[2]) : here;
fs.mkdirSync(outdir, { recursive: true });
fs.writeFileSync(path.join(outdir, "token-census.json"), JSON.stringify(result, null, 1));

const lines = [];
for (const [label, r] of Object.entries(result.files)) {
  lines.push(`### ${label}`, `${r.bytes} bytes, ${r.declarations} declarations`);
  const cp = Object.entries(r.customProperties).map(([ctx, o]) => `${ctx}: ${Object.keys(o).length}`).join("; ");
  lines.push(`- custom properties: ${cp || "none"}`);
  for (const k of ["fontSizes", "fontWeights", "lineHeights", "letterSpacings", "spacing", "radii", "shadows", "zIndex", "breakpoints", "borderWidths", "fontFamilies"]) {
    lines.push(`- ${k}: ${r[k].length} distinct — ${r[k].map(([v, n]) => `${v}×${n}`).join(", ")}`);
  }
  lines.push(`- colour literals outside custom-property definitions: ${r.colorLiterals.length} distinct — ${r.colorLiterals.map(([v, n]) => `${v}×${n}`).join(", ")}`);
  lines.push(`- colours defined inside custom properties: ${r.colorsDefinedInCustomProperties} distinct; var(--…) uses: ${r.colorVarUses.reduce((s, [, n]) => s + n, 0)} over ${r.colorVarUses.length} tokens`, "");
}
lines.push("### Contrast (WCAG ratio; AA text >= 4.5, large/UI >= 3)", "| pair | light | dark |", "|---|---|---|");
for (const r of result.contrast.dashboard) lines.push(`| ${r.fg} on ${r.bg} | ${r.light} | ${r.dark} |`);
for (const r of result.contrast.accountDialog) lines.push(`| account dialog ${r.pair} | ${r.light} | ${r.dark} |`);
fs.writeFileSync(path.join(outdir, "token-census.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
