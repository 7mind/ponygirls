import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

// Collects screenshots, an index.md and optional DOM dumps.
export class Recorder {
  constructor(outDir) { this.outDir = outDir; this.n = 0; this.entries = []; this.manifest = []; this.notes = []; }
  async init() { await mkdir(path.join(this.outDir, "dom"), { recursive: true }); }
  section(title) { this.entries.push({ section: title }); }
  /** slug = "page-state"; viewport label is appended automatically. */
  async shot(page, slug, { desc, how, full = false, clip = undefined, locator = undefined, expect = [] } = {}) {
    if (!desc || !how) throw new Error(`shot ${slug}: desc and how are required`);
    // Fail loudly on a blank/half-loaded capture: every expected selector must be visible.
    for (const selector of expect) await page.locator(selector).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => { throw new Error(`shot ${slug}: expected ${selector} to be visible`); });
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    if (text.length < 5 && !(await page.locator("dialog[open]").count())) throw new Error(`shot ${slug}: page has no text (blank capture)`);
    const vp = page.viewportSize();
    const theme = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const label = `${vp.width}x${vp.height}${theme === "dark" ? "-dark" : ""}${full ? "-full" : ""}`;
    const file = `${String(++this.n).padStart(2, "0")}-${slug}-${label}.png`;
    await (locator ?? page).screenshot({ path: path.join(this.outDir, file), fullPage: locator ? undefined : full, clip });
    this.entries.push({ file, desc, how });
    const live = await page.evaluate(() => ({
      headings: [...document.querySelectorAll("h1,h2")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim().slice(0, 80)).slice(0, 4),
      messages: [...document.querySelectorAll("[role=status],[role=alert],.notice,.draft-status,.empty-state h3")].filter((e) => e.offsetParent !== null && e.textContent.trim()).map((e) => e.textContent.trim().slice(0, 140)).slice(0, 6),
      dialogs: [...document.querySelectorAll("dialog[open]")].length,
    }));
    this.manifest.push({ file, textChars: text.length, ...live, expect });
    console.log(`# shot ${file}`);
    return file;
  }
  note(text) { this.entries.push({ note: text }); }
  async dump(page, name) {
    const data = await page.evaluate(inspectDom);
    const file = `dom/${String(this.n).padStart(2, "0")}-${name}.json`;
    await writeFile(path.join(this.outDir, file), JSON.stringify(data, null, 1));
    return data;
  }
  async writeIndex(header) {
    const lines = [`# Haystack dashboard capture index`, "", header, ""];
    for (const e of this.entries) {
      if (e.section) lines.push("", `## ${e.section}`, "");
      else if (e.note) lines.push(`> ${e.note}`);
      else lines.push(`- \`${e.file}\` — ${e.desc}. *How:* ${e.how}`);
    }
    await writeFile(path.join(this.outDir, "index.md"), lines.join("\n") + "\n");
    await writeFile(path.join(this.outDir, "manifest.json"), JSON.stringify(this.manifest, null, 1));
  }
}

// Runs in the page: every scroll container, sticky/fixed element and table geometry.
export function inspectDom() {
  const sel = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      let s = node.tagName.toLowerCase();
      if (node.id) s += `#${node.id}`;
      else if (node.classList.length) s += "." + [...node.classList].slice(0, 2).join(".");
      parts.unshift(s);
      if (node.id) break;
    }
    return parts.join(" > ");
  };
  const clipping = new Set(["auto", "scroll", "hidden", "clip"]);
  const scrollers = [], sticky = [];
  const root = document.scrollingElement;
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    if (clipping.has(cs.overflowY) || clipping.has(cs.overflowX)) {
      const scrollableY = (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
      const scrollableX = (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
      if (scrollableY || scrollableX || cs.overflowY === "auto" || cs.overflowY === "scroll")
        scrollers.push({ selector: sel(el), overflowX: cs.overflowX, overflowY: cs.overflowY, maxHeight: cs.maxHeight, height: cs.height, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, scrollableY, scrollableX });
    }
    if (cs.position === "sticky" || cs.position === "fixed") sticky.push({ selector: sel(el), position: cs.position, top: cs.top, zIndex: cs.zIndex, height: el.getBoundingClientRect().height });
  }
  const tables = [...document.querySelectorAll("table")].slice(0, 3).map((t) => ({
    selector: sel(t), layout: getComputedStyle(t).tableLayout, width: t.getBoundingClientRect().width, rows: t.tBodies[0]?.rows.length ?? 0,
    columns: [...(t.tHead?.rows[0]?.cells ?? [])].map((c) => ({ text: c.textContent.trim(), width: Math.round(c.getBoundingClientRect().width * 10) / 10, display: getComputedStyle(c).display })),
  }));
  // characters of visible text per computed font size; interactive targets under 24 CSS px
  const fontChars = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim(); const el = n.parentElement;
    if (!t || !el || el.closest("script,style") || el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
    const size = getComputedStyle(el).fontSize; fontChars[size] = (fontChars[size] ?? 0) + t.length;
  }
  const smallTargets = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=option]")].filter((e) => e.offsetParent !== null).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && (r.height < 24 || r.width < 24)).map(({ e, r }) => `${sel(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  const firstRow = document.querySelector(".records-panel tbody tr");
  const panelEl = document.querySelector(".records-panel");
  const headingOutline = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}: ${e.textContent.trim().slice(0, 50)}`).slice(0, 30);
  return {
    url: location.href,
    fontChars, smallTargets: { count: smallTargets.length, sample: smallTargets.slice(0, 12) }, headingOutline,
    resultsPanel: panelEl && { top: Math.round(panelEl.getBoundingClientRect().top + scrollY), height: panelEl.clientHeight, firstRowHeight: firstRow && Math.round(firstRow.getBoundingClientRect().height) },
    viewport: { width: innerWidth, height: innerHeight },
    document: { scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, scrollTop: root.scrollTop, scrollsVertically: root.scrollHeight > root.clientHeight + 1, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth },
    scrollers, sticky, tables,
    domNodeCount: document.getElementsByTagName("*").length,
  };
}
