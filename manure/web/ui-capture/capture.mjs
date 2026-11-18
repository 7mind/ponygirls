// Manure UI capture driver. Reads the JSON payload produced by capture.py on stdin
// (contains throwaway credentials of the isolated instance; never written to the output).
// Scenes are plain async functions in SCENES; add a capture by adding a shot() call.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");

const OUT = input.out;
const DOM_DIR = path.join(OUT, "dom");
fs.mkdirSync(DOM_DIR, { recursive: true });
const BASE = input.base;
const ROLES = input.roles;
const VP = {
  d: { width: 1440, height: 900, tag: "1440x900" },
  s: { width: 1024, height: 700, tag: "1024x700" },
  m: { width: 390, height: 844, tag: "390x844" },
  tall: { width: 1440, height: 2600, tag: "1440x2600" },
};
const FAULT_SETTLE_MS = 400;
const index = [];
const metrics = { notes: [] };
const dialogs = [];
let counter = 0;
let currentScene = "";

process.on("unhandledRejection", (e) => { metrics.notes.push(`unhandled rejection in ${currentScene}: ${String(e && e.message).split("\n")[0]}`); });
const log = (m) => console.log(`[capture ${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- helpers
const browser = await chromium.launch({
  executablePath: input.chromium,
  args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`],
});

async function newPage({ vp = VP.d, scheme = "light", storageState = undefined, clipboard = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, storageState, deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  if (clipboard) await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  page.__vp = vp; page.__scheme = scheme; page.__dialogMode = "dismiss"; page.__listCalls = [];
  page.on("dialog", async (dialog) => {
    dialogs.push({ scene: currentScene, type: dialog.type(), message: dialog.message(), handled: page.__dialogMode });
    if (page.__dialogMode === "accept") await dialog.accept(); else await dialog.dismiss();
  });
  page.on("pageerror", (e) => metrics.notes.push(`pageerror in ${currentScene}: ${e.message}`));
  page.on("response", async (res) => {
    if (res.url().endsWith("/api/current") && res.request().method() === "POST") {
      const body = res.request().postData() || "";
      if (body.includes('"ListArtifacts"')) page.__listCalls.push({ t: Date.now(), status: res.status() });
    }
  });
  return page;
}

let statsPage = null;
// Self-check: decode the PNG in a scratch page and measure how much of it is non-background.
async function pixelStats(buffer) {
  if (statsPage === null) statsPage = await (await browser.newContext()).newPage();
  return statsPage.evaluate(async (b64) => {
    const blob = await (await fetch("data:image/png;base64," + b64)).blob();
    const bitmap = await createImageBitmap(blob);
    const w = 160, h = Math.max(1, Math.round(bitmap.height * 160 / bitmap.width));
    const canvas = new OffscreenCanvas(w, h); const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) { const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
    const top = Math.max(...counts.values());
    return { width: bitmap.width, height: bitmap.height, distinctColors: counts.size, dominantColorShare: +(top / (w * h)).toFixed(3) };
  }, buffer.toString("base64"));
}
const STATUS_SELECTORS = ["#list-status", "#detail-status", "#upload-status", "#access-status", ".account-status", ".account-error", "#query-diagnostic", "#draft-status", "#unlock-error", "#status", "#files-status", "#list-error", "#session-status"];
// Evidence for the self-check: visible headings/status lines and the text actually inside the viewport.
const pageText = (page, selectors) => page.evaluate((sels) => {
  const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const status = sels.flatMap((s) => [...document.querySelectorAll(s)].filter(visible).map((e) => `${s}: ${e.textContent.trim().replace(/\s+/g, " ").slice(0, 140)}`)).filter((t) => !/: $/.test(t));
  const h = [...document.querySelectorAll("h1")].find(visible);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const words = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement; if (!el || !visible(el) || !n.textContent.trim()) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
    if (b.width > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth) words.push(n.textContent.trim().replace(/\s+/g, " "));
  }
  return { heading: h ? h.textContent.trim().slice(0, 100) : null, status, dialogOpen: !!document.querySelector("dialog[open]"), dialogText: (document.querySelector("dialog[open]") || { innerText: "" }).innerText.replace(/\s+/g, " ").slice(0, 400), viewportText: words.join(" | ").slice(0, 700), scroll: { page: Math.round(scrollY), panel: Math.round((document.getElementById("results-panel") || { scrollTop: 0 }).scrollTop) } };
}, selectors);
const evidence = [];

async function shot(page, name, what, how, { full = false, probe = false, clip = undefined } = {}) {
  await sleep(150);
  counter += 1;
  const theme = page.__scheme === "dark" ? "-dark" : "";
  const file = `${String(counter).padStart(2, "0")}-${name}${full ? "-fullpage" : ""}-${page.__vp.tag}${theme}.png`;
  const buffer = await page.screenshot({ path: path.join(OUT, file), fullPage: full, clip });
  index.push({ n: counter, file, what, how, scene: currentScene });
  evidence.push({ file, pixels: await pixelStats(buffer), ...(await pageText(page, STATUS_SELECTORS)) });
  if (probe) fs.writeFileSync(path.join(DOM_DIR, file.replace(/\.png$/, ".json")), JSON.stringify(await domProbe(page), null, 2));
  log(`shot ${file}`);
  return file;
}

async function domProbe(page) {
  return page.evaluate(() => {
    const cssPath = (el) => {
      const parts = [];
      while (el && el.nodeType === 1 && el !== document.documentElement) {
        let part = el.localName;
        if (el.id) { parts.unshift(part + "#" + el.id); break; }
        if (el.classList.length) part += "." + [...el.classList].join(".");
        parts.unshift(part); el = el.parentElement;
      }
      return parts.join(" > ");
    };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const scrollers = [], sticky = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (el.getClientRects().length === 0) continue;
      const oy = ["auto", "scroll"].includes(cs.overflowY), ox = ["auto", "scroll"].includes(cs.overflowX);
      if (oy || ox) scrollers.push({
        selector: cssPath(el), overflowX: cs.overflowX, overflowY: cs.overflowY, height: cs.height, maxHeight: cs.maxHeight,
        clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
        scrollsY: el.scrollHeight > el.clientHeight + 1, scrollsX: el.scrollWidth > el.clientWidth + 1, scrollTop: Math.round(el.scrollTop),
      });
      if (["sticky", "fixed"].includes(cs.position)) sticky.push({ selector: cssPath(el), position: cs.position, top: cs.top, zIndex: cs.zIndex, rect: rect(el) });
    }
    const de = document.documentElement;
    const table = document.querySelector("#catalogue-table");
    const headers = table && table.getClientRects().length ? [...table.querySelectorAll("th")].map((th) => ({ text: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width) })) : null;
    const firstRow = document.querySelector("#artifact-list tr");
    const style = (sel, props) => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return null; const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs[p]])); };
    return {
      url: location.pathname + location.hash, viewport: { w: innerWidth, h: innerHeight }, scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      document: { scrollHeight: de.scrollHeight, clientHeight: de.clientHeight, scrollWidth: de.scrollWidth },
      scrollers, stickyOrFixed: sticky, tableColumns: headers, firstRowRect: firstRow ? rect(firstRow) : null,
      rows: document.querySelectorAll("#artifact-list tr").length,
      regions: Object.fromEntries(["#results-panel", ".manifest-panel", "#quick-upload", "#list-form", ".topbar", ".workspace-footer"].map((s) => { const e = document.querySelector(s); return [s, e && e.getClientRects().length ? rect(e) : null]; })),
      computed: {
        body: style("body", ["fontFamily", "fontSize", "lineHeight", "color", "backgroundColor"]),
        th: style("#catalogue-table th", ["fontSize", "padding", "color", "backgroundColor"]),
        td: style("#catalogue-table td", ["fontSize", "padding", "borderBottom"]),
        button: style("button", ["fontSize", "padding", "border", "borderRadius"]),
        input: style("input[type=text]", ["fontSize", "padding", "border", "borderRadius"]),
        h1: style("h1:not([hidden])", ["fontSize", "fontWeight", "letterSpacing"]),
        accountDialog: style(".account-dialog", ["fontSize", "padding", "borderRadius", "backgroundColor", "maxHeight", "width", "overflowY"]),
      },
    };
  });
}

const isList = (route) => (route.request().postData() || "").includes('"ListArtifacts"');
const errorBody = (route, code) => JSON.stringify({ requestId: route.request().postDataJSON().requestId, result: { Error: { failure: { code, message: "controlled fixture", retryAfterSeconds: null } } } });

// Settled catalogue: the counter reports loaded rows, no matches or a failure (notice).
async function waitList(page) {
  await page.waitForFunction(() => /loaded|No matches|Not loaded|Not searched|hits ·/.test(document.getElementById("list-status").textContent), null, { timeout: 30000 });
  await sleep(200);
}
async function login(page, user = input.alice) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.fill("[data-account-login] input[name=login]", user.login);
  await page.fill("[data-account-login] input[name=password]", user.password);
  await page.click("[data-account-login] button[type=submit]");
  await page.waitForSelector("#main:not([hidden])", { timeout: 20000 });
  await waitList(page);
}
async function authState() {
  const page = await newPage();
  await login(page);
  const state = await page.context().storageState();
  await page.context().close();
  return state;
}
async function loadAll(page, maxSteps = 80) {
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    if (await page.evaluate(() => /all matching artifacts loaded/.test(document.getElementById("list-status").textContent))) break;
    await page.evaluate(() => { const p = document.getElementById("results-panel"); p.scrollTop = p.scrollHeight; });
    await sleep(300);
  }
  return steps;
}
async function openDetail(page, id) {
  await page.evaluate((i) => { window.location.hash = "#/artifact/" + i; }, id);
  await page.waitForSelector("#detail-section:not([hidden])", { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById("detail-name").textContent !== "Loading artifact…" && !/Loading file manifest|Waiting for/.test(document.getElementById("files-status").textContent), null, { timeout: 20000 }).catch(() => {});
  await sleep(300);
}
async function applySearch(page, text) {
  await page.fill("#filter-text", text);
  await page.click("#search-submit");
  await page.waitForFunction(() => /Draft matches/.test(document.getElementById("draft-status").textContent) && !/Loading|Searching/.test(document.getElementById("list-status").textContent), null, { timeout: 30000 });
  await sleep(500);
}
async function backToList(page) {
  await page.evaluate(() => { window.location.hash = "#/artifacts"; });
  await page.waitForSelector("#dashboard-section:not([hidden])");
  await waitList(page);
}
async function scrollPanelIntoView(page) {
  await page.evaluate(() => { const r = document.getElementById("results-panel").getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 12); });
  await sleep(200);
}
async function waitViewer(page) {
  await page.waitForFunction(() => { const c = document.querySelector("#content"); const s = document.getElementById("status"); return c && (c.children.length > 0) && (!s || !/Loading/.test(s.textContent)); }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForFunction(() => { const pending = document.querySelectorAll(".diagram, pre > code[class*=language-mermaid], pre > code[class*=language-dot]"); return [...pending].every((d) => !d.matches(".diagram") || d.querySelector("svg, .error")); }, null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
}
async function gotoContent(page, role, suffix = "") {
  const res = await page.goto(ROLES[role].content_url.replace(/\/$/, "") + "/" + suffix, { waitUntil: "load", timeout: 30000 }).catch((e) => ({ error: e.message }));
  return res;
}
const hold = async (page, match, ms, then) => {
  await page.route(match, async (route) => { await sleep(ms); await route.continue().catch(() => {}); });
};

// ---------------------------------------------------------------- scenes
let AUTH = null;
const SCENES = {};

SCENES.auth = async () => { AUTH = await authState(); };

SCENES.login = async () => {
  for (const [vp, scheme] of [[VP.d, "light"], [VP.s, "light"], [VP.d, "dark"]]) {
    const primary = vp === VP.d && scheme === "light";
    // session check in flight
    if (primary) {
      const page = await newPage({ vp, scheme });
      await page.route("**/api/current", async (route) => { if ((route.request().postData() || "").includes('"Whoami"')) await sleep(4000); await route.continue().catch(() => {}); });
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await sleep(900);
      await shot(page, "login-session-checking", "Initial 'Checking session…' card while Whoami is pending (delayed 4 s by the harness)", "goto / with Whoami response held", {});
      await page.context().close();
      const down = await newPage({ vp, scheme });
      await down.route("**/api/current", async (route) => { if ((route.request().postData() || "").includes('"Whoami"')) await route.abort("connectionrefused").catch(() => {}); else await route.continue().catch(() => {}); });
      await down.goto(BASE + "/", { waitUntil: "load" });
      await down.waitForSelector("#session-retry-button:not([hidden])");
      await shot(down, "login-service-unavailable", "Session check failed: 'service is unavailable' card with Retry connection", "goto / with Whoami aborted", {});
      await down.context().close();
    }
    const page = await newPage({ vp, scheme });
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForSelector("#login-section:not([hidden])");
    await shot(page, "login-empty", "Login card, empty form", "goto / without a session cookie", { probe: primary });
    await page.fill("#login-input", "alice"); await page.fill("#password-input", "not-the-password");
    await shot(page, "login-filled", "Login form filled (password masked)", "type login + password", {});
    await page.click("#login-form button[type=submit]");
    await page.waitForSelector("[data-account-login-error]:not([hidden])", { timeout: 10000 });
    await sleep(200);
    await shot(page, "login-error", "Login rejected: inline account-error under the form", "submit wrong password", {});
    await page.context().close();
  }
};

SCENES.catalogue = async () => {
  // --- initial loading state
  {
    const page = await newPage({ storageState: AUTH });
    await page.route("**/api/current", async (route) => { if (isList(route)) await sleep(4000); await route.continue().catch(() => {}); });
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForSelector("#workspace-shell:not([hidden])");
    await sleep(600);
    await shot(page, "catalogue-initial-loading", "Workspace while the first ListArtifacts page is pending: empty results panel, footer status 'Loading artifacts…'", "logged-in goto / with ListArtifacts held 4 s", { probe: true });
    await page.context().close();
  }
  const page = await newPage({ storageState: AUTH, clipboard: false });
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("#workspace-shell:not([hidden])");
  await waitList(page);
  metrics.firstListMs = Date.now() - t0;
  await shot(page, "catalogue-first-render", "Catalogue as first rendered at 1440x900: top bar, quick upload, heading, search panel; results table starts near/below the fold", "log in, wait for first page (25 rows)", { probe: true });
  await shot(page, "catalogue-first-render", "Full-page capture of the first-rendered catalogue (page scrolls; results panel is its own 70vh scroller)", "same state, fullPage screenshot", { full: true });
  metrics.rowsFirstPage = await page.evaluate(() => document.querySelectorAll("#artifact-list tr").length);

  // --- nested scroll states
  await scrollPanelIntoView(page);
  await shot(page, "catalogue-page-scrolled-panel-top", "Page scrolled so the results panel fills the viewport; panel itself still at scrollTop 0", "window.scrollTo(panel top)", { probe: true });
  await page.evaluate(() => { const p = document.getElementById("results-panel"); p.scrollTop = Math.round(p.scrollHeight / 2); });
  await sleep(500);
  await shot(page, "catalogue-both-scrolled", "NESTED SCROLL: page scrolled AND inner results panel scrolled (two scrollbars, two scroll positions)", "scroll page to panel, then panel to ~50% of loaded rows", { probe: true });
  // more rows load on demand; capture in-flight state
  const slow = page;
  await slow.route("**/api/current", async (route) => { if (isList(route) && slow.__slow) await sleep(2500); await route.continue().catch(() => {}); });
  slow.__slow = true;
  await page.evaluate(() => { const p = document.getElementById("results-panel"); p.scrollTop = p.scrollHeight; });
  await sleep(700);
  await shot(page, "catalogue-loading-more", "Infinite load in flight: panel at bottom, status 'Loading more artifacts…' (next page held 2.5 s)", "scroll panel to bottom with next ListArtifacts held", { probe: true });
  slow.__slow = false;
  const steps = await loadAll(page);
  metrics.loadAllSteps = steps;
  metrics.rowsAllLoaded = await page.evaluate(() => document.querySelectorAll("#artifact-list tr").length);
  metrics.listCallsToLoadAll = page.__listCalls.length;
  await sleep(300);
  await shot(page, "catalogue-all-loaded-panel-bottom", "All matching artifacts loaded: panel scrolled to its end, status 'all matching artifacts loaded', page still scrolled", "keep scrolling panel until cursor exhausted", { probe: true });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(300);
  await shot(page, "catalogue-all-loaded-page-bottom", "Page scrolled to the very bottom: results footer and workspace footer text", "window.scrollTo(bottom) after all rows loaded", { probe: true });
  await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById("results-panel").scrollTop = 0; });
  await shot(page, "catalogue-all-loaded-full", "Full-page capture after loading every row (document height unchanged: all rows live inside the inner scroller)", "fullPage screenshot after all rows loaded", { full: true, probe: true });

  // --- back-navigation scroll/state retention measurement
  await scrollPanelIntoView(page);
  await page.evaluate(() => { document.getElementById("results-panel").scrollTop = 3000; });
  await sleep(300);
  const before = await page.evaluate(() => ({ rows: document.querySelectorAll("#artifact-list tr").length, top: document.getElementById("results-panel").scrollTop, page: scrollY }));
  const target = await page.evaluate(() => { const rows = [...document.querySelectorAll("#artifact-list tr")]; const panel = document.getElementById("results-panel").getBoundingClientRect(); const row = rows.find((r) => r.getBoundingClientRect().top > panel.top + 40); return row.dataset.artifactId; });
  await page.click(`#artifact-list tr[data-artifact-id="${target}"] button[data-action=details]`);
  await page.waitForSelector("#detail-section:not([hidden])");
  await sleep(500);
  await shot(page, "detail-reached-from-row", "Detail view reached by clicking a row deep in the list (page scroll position after navigation shown as-is)", "click row name button at panel scrollTop 3000", {});
  await page.click("#detail-back-button");
  await page.waitForSelector("#dashboard-section:not([hidden])"); await waitList(page);
  const after = await page.evaluate(() => ({ rows: document.querySelectorAll("#artifact-list tr").length, top: document.getElementById("results-panel").scrollTop, page: scrollY }));
  metrics.backNavigation = { before, after, note: "Back to artifacts: loaded rows/scroll positions before opening a detail vs after clicking 'Back to artifacts'" };
  await shot(page, "catalogue-after-back-from-detail", "Catalogue after 'Back to artifacts': list was reset (first page only, scroll positions lost)", "click Back to artifacts from a deep row's detail", { probe: true });

  // --- sort
  await page.click('[data-sort="total_bytes"]'); await waitList(page); await sleep(400);
  await scrollPanelIntoView(page);
  await shot(page, "catalogue-sorted-size", "Sorted by Size (click on column header; sort indicator arrow, sort summary)", "click 'Size' header button", {});
  await page.click('[data-sort="created_by_user"]'); await waitList(page); await sleep(400);
  await shot(page, "catalogue-sorted-owner", "Sorted by Owner", "click 'Owner' header button", {});
  await page.evaluate(() => window.scrollTo(0, 0));

  // --- presets / search / expression editor
  await page.click('[data-visibility-preset="public"]'); await sleep(500);
  await shot(page, "catalogue-preset-clicked", "After clicking the 'Public' access preset (draft/applied status line, pressed state)", "click Public preset", {});
  await page.click('[data-visibility-preset=""]'); await sleep(300);
  await page.fill("#filter-text", "access:public tag:release");
  await shot(page, "catalogue-draft-changed", "Typed an expression but did not press Search: 'Draft changed · press Search to apply. Sort is disabled.'", "type 'access:public tag:release'", {});
  await applySearch(page, "access:public tag:release");
  await shot(page, "catalogue-search-applied", "Applied query access:public tag:release (results + count badge)", "press Search", { probe: true });
  await page.fill("#filter-text", "");
  await page.click("#filter-text"); await page.keyboard.type("ow"); await sleep(300);
  await shot(page, "catalogue-suggestions-popover", "Expression suggestions popover (listbox) under the search input", "focus input, type 'ow'", { probe: true });
  await page.keyboard.press("Escape");
  await page.fill("#filter-text", "access:bogus");
  await sleep(200);
  await shot(page, "catalogue-query-diagnostic", "Invalid expression diagnostic line (red) under the search form", "type 'access:bogus'", {});
  await applySearch(page, "zzz-no-such-artifact");
  await shot(page, "catalogue-empty-state", "Empty state: 'No matching artifacts'", "search for a text with no match", {});
  await applySearch(page, "expired:true");
  metrics.expiredBadgesInExpiredListing = await page.evaluate(() => document.querySelectorAll("#artifact-list .status-badge.expired").length);
  await shot(page, "catalogue-expired-listing", "expired:true listing (observed: 25 rows on the first page, none carrying the 'Expired' badge; expired rows sort by created_at among the rest)", "search expired:true", {});
  for (const mode of ["lexical", "semantic"]) {
    await applySearch(page, `mode:${mode} capacity`);
    await shot(page, `catalogue-mode-${mode}`, `Retrieval mode '${mode}' (state depends on server capabilities; the isolated server has no embedding provider)`, `search 'mode:${mode} capacity'`, {});
  }
  await applySearch(page, "");
  await page.click("#query-syntax summary"); await sleep(200);
  await page.click(".upload-guide summary");
  await sleep(200);
  await shot(page, "catalogue-help-open", "'Query syntax' and 'Upload with the CLI' disclosures open (long help text inside the search panel)", "open both <details>", { full: true });
  await page.click("#query-syntax summary"); await page.click(".upload-guide summary");

  // --- row-level controls
  await scrollPanelIntoView(page);
  const firstDetails = page.locator('#artifact-list tr:first-child button[data-action="details"]');
  await firstDetails.focus();
  await page.keyboard.press("Tab");
  await sleep(150);
  await shot(page, "catalogue-row-keyboard-focus", "Keyboard focus ring on the row's copy-link button (focus-visible styling in a dense row)", "focus first row's name button, Tab", {});
  await page.locator("#artifact-list tr:nth-child(3)").hover();
  await shot(page, "catalogue-row-hover", "Row hover background", "mouse over row 3", {});
  await page.locator("#artifact-list tr:nth-child(2) button.record-copy").click();
  await sleep(400);
  await shot(page, "catalogue-copy-link-fallback", "Copy-link without clipboard permission: inline status + manual-copy input + Dismiss link inside the table cell", "click copy-link icon (clipboard permission not granted)", {});
  page.__dialogMode = "dismiss";
  await page.locator('#artifact-list tr:nth-child(4) button[data-action="delete"]').click();
  await sleep(300);
  metrics.notes.push("Row 'Delete' and detail Delete use window.confirm(): native dialog is not capturable by page screenshots; message text recorded in dialogs.json.");

  // --- list failure
  const bad = await newPage({ storageState: AUTH });
  await bad.route("**/api/current", async (route) => { if (isList(route)) await route.fulfill({ status: 503, contentType: "application/json", body: errorBody(route, "Unavailable") }).catch(() => {}); else await route.continue().catch(() => {}); });
  await bad.goto(BASE + "/", { waitUntil: "load" });
  await bad.waitForSelector("#retry-list-button:not([hidden])", { timeout: 20000 });
  await shot(bad, "catalogue-list-error", "List failure: red alert banner + footer status + 'Retry loading' (503 injected)", "ListArtifacts answered 503 by the harness", { probe: true });
  await bad.context().close();

  // --- narrow viewports
  for (const vp of [VP.s, VP.m]) {
    const p = await newPage({ vp, storageState: AUTH });
    await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
    await shot(p, "catalogue-first-render", `Catalogue at ${vp.tag}: table collapses to stacked card rows below 1350px`, "log in, first page", { probe: true });
    await shot(p, "catalogue-first-render", `Full page at ${vp.tag}`, "fullPage", { full: true });
    await scrollPanelIntoView(p);
    await p.evaluate(() => { const el = document.getElementById("results-panel"); el.scrollTop = 900; });
    await sleep(400);
    await shot(p, "catalogue-both-scrolled", `Nested scroll at ${vp.tag}: page + results panel scrolled`, "scroll page to panel then panel 900px", { probe: true });
    await p.context().close();
  }
  await page.context().close();
};

SCENES.upload = async () => {
  const page = await newPage({ storageState: AUTH, clipboard: true });
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#workspace-shell:not([hidden])"); await waitList(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  await shot(page, "upload-idle", "Quick upload panel idle (file input, access segmented control, disabled Upload, Dismiss)", "log in; panel above the catalogue heading", { clip: { x: 0, y: 40, width: 1440, height: 130 } });
  await page.setInputFiles("#upload-files", [
    { name: "screenshot 2026-11-17 at 10.41.22.png", mimeType: "image/png", buffer: png },
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\n\nhello\n") },
    { name: "a-very-long-file-name-that-keeps-going-and-going-for-the-purpose-of-layout-testing-0123456789.log", mimeType: "text/plain", buffer: Buffer.alloc(300000, 97) },
  ]);
  await sleep(300);
  await shot(page, "upload-staged", "Three files staged (list of staged uploads inside the quick-upload panel, which pushes the catalogue down)", "choose 3 files in the file input", { probe: true });
  await page.check("#upload-external"); await sleep(200);
  await shot(page, "upload-staged-external", "External access selected: help text about passwords appears", "select 'External' radio", {});
  await page.route("**/api/current/artifacts/*/chunks*", async (route) => { await sleep(2500); await route.continue().catch(() => {}); });
  await page.click("#upload-submit");
  await sleep(1200);
  await shot(page, "upload-in-progress", "Upload in flight (chunk requests held 2.5 s): per-file phase/progress text", "click Upload with chunk PUTs delayed", {});
  await page.unroute("**/api/current/artifacts/*/chunks*");
  await page.waitForFunction(() => /Finished this upload attempt/.test(document.getElementById("upload-status").textContent), null, { timeout: 60000 });
  await sleep(500);
  await shot(page, "upload-finished-external", "Upload finished: ready links + one-time External passwords shown inline per file", "wait for 'Finished this upload attempt'", { probe: true, full: true });
  await page.click("#upload-clear"); await sleep(200);
  // failure
  await page.setInputFiles("#upload-files", [{ name: "will-fail.txt", mimeType: "text/plain", buffer: Buffer.alloc(5000, 98) }]);
  await page.check("#upload-internal");
  await page.route("**/api/current/artifacts/*/chunks*", (route) => route.abort("connectionreset").catch(() => {}));
  await page.click("#upload-submit");
  await page.waitForFunction(() => /Upload failed/.test(document.getElementById("upload-list").textContent), null, { timeout: 30000 });
  await shot(page, "upload-failed", "Upload failure: error paragraph in staged list (chunk request reset by the harness)", "click Upload with chunk PUTs aborted", {});
  await page.context().close();
};

SCENES.detail = async () => {
  const page = await newPage({ storageState: AUTH, clipboard: true });
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#workspace-shell:not([hidden])"); await waitList(page);
  // loading state
  const held = await newPage({ storageState: AUTH });
  await held.route("**/api/current", async (route) => { if ((route.request().postData() || "").includes('"GetArtifact"')) await sleep(4000); await route.continue().catch(() => {}); });
  await held.goto(BASE + "/#/artifact/" + ROLES.md_report.artifact_id, { waitUntil: "load" });
  await sleep(1200);
  await shot(held, "detail-loading", "While GetArtifact is pending the detail view is NOT shown: the catalogue stays on screen with only the footer status 'Loading artifact details…' (no skeleton)", "deep link to #/artifact/<id> with GetArtifact held 4 s", {});
  await held.context().close();

  const cases = [
    ["md_report", "detail-public-file", "Detail of a public single-file artifact (tags, hostname, project path, content URL; 3-panel right column)"],
    ["internal_png", "detail-internal-file", "Detail of an internal artifact"],
    ["external_site", "detail-external-dir", "Detail of an external-password directory artifact (Copy current password / Rotate buttons visible)"],
    ["big_dir", "detail-big-manifest", "Directory artifact with 160 files + empty dir: manifest table in its own 50vh scroller"],
    ["long_name", "detail-long-name", "Very long name/tags/hostname/project path: wrapping behaviour of heading and metadata"],
    ["hostile", "detail-hostile-name", "Name containing HTML/markup: rendered as text"],
    ["uploading", "detail-uploading-state", "Artifact still in 'uploading' state: access controls disabled, manifest of partial upload"],
    ["ttl_week", "detail-with-expiry", "Artifact with an expiry timestamp"],
  ];
  for (const [role, name, what] of cases) {
    await openDetail(page, ROLES[role].artifact_id);
    await shot(page, name, what, `deep link #/artifact/<id> (${role})`, { probe: role === "md_report" || role === "big_dir" });
    if (role === "big_dir") {
      await page.evaluate(() => { const m = document.querySelector(".manifest-panel"); m.scrollIntoView({ block: "start" }); m.scrollTop = 600; });
      await sleep(300);
      await shot(page, "detail-big-manifest-nested-scroll", "NESTED SCROLL on the detail page: page scrolled + manifest panel scrolled independently", "scroll page to the manifest, manifest to 600px", { probe: true });
      await shot(page, "detail-big-manifest", "Full-page capture: manifest scroller does not extend the page", "fullPage", { full: true });
    }
  }
  // external password flows
  await openDetail(page, ROLES.external_site.artifact_id);
  await page.click("#get-password-button"); await sleep(900);
  await shot(page, "detail-external-password-revealed", "'Copy current password' reveals the password panel (warning-coloured) above the detail layout", "click Copy current password", {});
  await page.click("#rotate-dismiss-button"); await sleep(200);
  await page.click("#rotate-button"); await sleep(1200);
  await shot(page, "detail-external-rotated", "After 'Rotate external password': new password revealed, status text updated", "click Rotate external password", {});
  await page.click("#rotate-dismiss-button");
  // access mode change
  await openDetail(page, ROLES.mutable.artifact_id);
  await page.selectOption("#access-mode", "public"); await sleep(200);
  await shot(page, "detail-access-mode-changed", "Access mode select changed to Public (Save enabled, description updates)", "select Public in the Access & sharing panel", {});
  page.__dialogMode = "accept";
  await page.click("#access-save-button"); await sleep(1500);
  page.__dialogMode = "dismiss";
  await shot(page, "detail-access-saved-public", "After confirming the native 'Make artifact … public?' dialog and saving", "click Save access mode, accept window.confirm", {});
  await page.selectOption("#access-mode", "external"); await page.click("#access-save-button"); await sleep(1800);
  await shot(page, "detail-access-saved-external", "Switched to External: generated password revealed", "select External, Save", {});
  // errors
  await page.evaluate(() => { window.location.hash = "#/artifact/00000000000000000000000000000000"; });
  await sleep(1500);
  await shot(page, "detail-not-found", "Detail of a non-existent artifact: bounced to the catalogue with an error banner", "deep link to unknown id", { probe: true });
  await backToList(page);
  await openDetail(page, ROLES.expired_0.artifact_id).catch(() => {});
  await sleep(500);
  await shot(page, "detail-expired-artifact", "Deep link to an expired artifact: bounced to the catalogue with 'Detail failed (expired)' banner", "deep link to expired id", {});
  await backToList(page);
  // delete confirm text
  await openDetail(page, ROLES.deletable.artifact_id);
  await page.click("#delete-button"); await sleep(300);
  // opening content from detail (internal -> single-use grant handoff)
  await openDetail(page, ROLES.internal_md.artifact_id);
  await Promise.all([page.waitForURL(/artifacts\.localhost/, { timeout: 20000 }).catch(() => {}), page.click("#open-button")]);
  await waitViewer(page);
  await shot(page, "viewer-internal-via-grant", "Internal artifact opened from the dashboard 'Open artifact' button: grant handoff, viewer on the content origin", "detail > Open artifact (POST grant form, redirect)", {});
  await page.context().close();
  // secondary viewports
  for (const vp of [VP.s, VP.m]) {
    const p = await newPage({ vp, storageState: AUTH });
    await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
    await openDetail(p, ROLES.external_site.artifact_id);
    await shot(p, "detail-external-dir", `Detail view at ${vp.tag}`, "deep link", { probe: true });
    await shot(p, "detail-external-dir", `Full page at ${vp.tag}`, "fullPage", { full: true });
    await p.context().close();
  }
};

SCENES.account = async () => {
  const open = async (page) => { await page.click("#account-settings"); await page.waitForSelector(".account-dialog[open]"); };
  const loaded = async (page) => { await page.waitForSelector(".account-token", { timeout: 15000 }); await sleep(250); };
  const variants = [[VP.d, "light"], [VP.s, "light"], [VP.m, "light"], [VP.d, "dark"]];
  for (const [vp, scheme] of variants) {
    const primary = vp === VP.d && scheme === "light";
    const page = await newPage({ vp, scheme, storageState: AUTH, clipboard: true });
    await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#workspace-shell:not([hidden])"); await waitList(page);
    if (primary) {
      const slow = await newPage({ vp, scheme, storageState: AUTH });
      await slow.goto(BASE + "/", { waitUntil: "load" }); await slow.waitForSelector("#workspace-shell:not([hidden])"); await waitList(slow);
      await slow.route("**/api/account/v1", async (route) => { await sleep(3500); await route.continue().catch(() => {}); });
      await slow.click("#account-settings"); await sleep(700);
      await shot(slow, "account-dialog-loading", "Account dialog while GET /api/account/v1 is pending ('Loading account settings…')", "click Settings with the account read held 3.5 s", { probe: true });
      await slow.context().close();
    }
    await open(page); await loaded(page);
    await shot(page, "account-dialog-token-list", "Token-settings dialog opened: intro text, create form, token list (configured + issued + revoked)", "click Settings in the top bar", { probe: true });
    await page.evaluate(() => { const d = document.querySelector(".account-dialog"); d.scrollTop = d.scrollHeight / 2; });
    await sleep(200);
    await shot(page, "account-dialog-scrolled-mid", "Same dialog scrolled to the middle (dialog is its own scroller over a modal backdrop)", "scroll the dialog", { probe: primary });
    await page.evaluate(() => { const d = document.querySelector(".account-dialog"); d.scrollTop = d.scrollHeight; });
    await sleep(200);
    await shot(page, "account-dialog-scrolled-end", "Dialog scrolled to the end of the long token list (revoked tokens, last rows)", "scroll the dialog to the bottom", {});
    await page.evaluate(() => { document.querySelector(".account-dialog").scrollTop = 0; });
    if (primary) {
      // issue form + secret
      await page.fill(".account-token-form input[name=name]", "capture-harness token");
      await shot(page, "account-dialog-issue-form-filled", "Create form with a token name typed", "type a name", {});
      await page.click(".account-token-form button[type=submit]");
      await page.waitForSelector(".account-secret", { timeout: 15000 }); await sleep(300);
      await shot(page, "account-dialog-secret-shown", "One-time secret panel ('Save your token now') inserted above the list, secret pre-selected", "submit Create access token", { probe: true });
      await page.click(".account-secret button:has-text('Copy secret')"); await sleep(400);
      await shot(page, "account-dialog-secret-copied", "After 'Copy secret': status line under the secret panel", "click Copy secret (clipboard permitted)", {});
      await page.click(".account-secret button:has-text('Dismiss secret')"); await sleep(200);
      // revoke
      page.__dialogMode = "dismiss";
      await page.locator(".account-token button:has-text('Revoke')").first().click(); await sleep(300);
      page.__dialogMode = "accept";
      await page.locator(".account-token button:has-text('Revoke')").first().click();
      await page.waitForFunction(() => /revoked/i.test(document.querySelector(".account-status").textContent), null, { timeout: 15000 }); await sleep(300);
      page.__dialogMode = "dismiss";
      await shot(page, "account-dialog-after-revoke", "After revoking one token (native confirm accepted): status line + Revoked badge", "click Revoke, accept window.confirm", {});
      metrics.notes.push("Token revoke uses window.confirm(): native dialog is not capturable; message text recorded in dialogs.json.");
      // refresh
      await page.click("button:has-text('Refresh token list')"); await sleep(300);
      await shot(page, "account-dialog-refreshed", "After 'Refresh token list' (status sentence about checking issued tokens)", "click Refresh token list", {});
      await page.keyboard.press("Tab");
      await shot(page, "account-dialog-keyboard-focus", "Keyboard focus state inside the dialog", "press Tab", {});
      // full-length reference
      const tall = await newPage({ vp: VP.tall, storageState: AUTH });
      await tall.goto(BASE + "/", { waitUntil: "load" }); await tall.waitForSelector("#workspace-shell:not([hidden])"); await waitList(tall);
      await open(tall); await loaded(tall);
      await shot(tall, "account-dialog-full-length", "Reference: dialog at a 2600px-tall viewport so the whole content is visible at once", "tall viewport", { probe: true });
      await tall.context().close();
      // errors
      const faults = [
        ["account-error-unauthorized", "Read returns 401: 'Your browser session is no longer authorized'", (r) => r.request().method() === "GET" && /\/api\/account\/v1$/.test(r.request().url()), 401],
        ["account-error-unavailable", "Read returns 500: 'account service is unavailable' + 'Retry loading settings'", (r) => r.request().method() === "GET" && /\/api\/account\/v1$/.test(r.request().url()), 500],
      ];
      for (const [name, what, match, status] of faults) {
        const p = await newPage({ vp, scheme, storageState: AUTH });
        await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
        await p.route("**/api/account/v1", async (route) => { if (match(route)) await route.fulfill({ status, contentType: "application/json", body: "{}" }).catch(() => {}); else await route.continue().catch(() => {}); });
        await open(p); await sleep(900);
        await shot(p, name, what, `open dialog with GET /api/account/v1 answered ${status}`, {});
        await p.context().close();
      }
      for (const [name, status, what] of [["account-error-mint-500", 500, "Token creation fails (500) AFTER being sent: error + 'creation outcome unknown' recovery block"], ["account-error-mint-403", 403, "Token creation 403: same unknown-outcome recovery block plus permission error"]]) {
        const p = await newPage({ vp, scheme, storageState: AUTH });
        await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
        await p.route("**/api/account/v1/tokens", async (route) => { await route.fulfill({ status, contentType: "application/json", body: "{}" }).catch(() => {}); });
        await open(p); await loaded(p);
        await p.fill(".account-token-form input[name=name]", "will fail");
        await p.click(".account-token-form button[type=submit]"); await sleep(900);
        await shot(p, name, what, `submit create form with POST /tokens answered ${status}`, {});
        await p.click("button:has-text('Refresh token list')"); await sleep(800);
        await shot(p, name + "-reconcile", "Recovery block after refreshing the list: 'I checked the list; allow another token' enabled", "click Refresh token list", {});
        await p.context().close();
      }
      {
        const p = await newPage({ vp, scheme, storageState: AUTH });
        await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
        await p.route("**/api/account/v1/tokens/*/revoke", async (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
        p.__dialogMode = "accept";
        await open(p); await loaded(p);
        await p.locator(".account-token button:has-text('Revoke')").first().click(); await sleep(900);
        await shot(p, "account-error-revoke", "Revocation fails (500): error plus 'Revocation could not be confirmed' status", "click Revoke with POST revoke answered 500", {});
        await p.context().close();
      }
      {
        const p = await newPage({ vp, scheme, storageState: AUTH });
        await p.goto(BASE + "/", { waitUntil: "load" }); await p.waitForSelector("#workspace-shell:not([hidden])"); await waitList(p);
        await open(p); await loaded(p);
        await p.fill(".account-token-form input[name=name]", "   ");
        await p.click(".account-token-form button[type=submit]"); await sleep(400);
        await shot(p, "account-dialog-empty-name-submit", "Submitting a whitespace-only token name: no visible message (silent focus only)", "type spaces, press Create", {});
        await p.context().close();
      }
    }
    await page.context().close();
  }
};

// UX-M4 states are named after the mockup shots (<app>-<view>-<state>-<width>[-dark].png) for the look comparison.
const vpName = (vp) => String(vp.width);
async function stateShot(page, name, what, how) {
  await sleep(150);
  const file = `${name}.png`;
  const buffer = await page.screenshot({ path: path.join(OUT, file) });
  index.push({ n: index.length + 1, file, what, how, scene: currentScene });
  evidence.push({ file, pixels: await pixelStats(buffer), ...(await pageText(page, STATUS_SELECTORS)) });
  log(`shot ${file}`);
}
const unlockAnswer = (status) => async (route) => (route.request().method() === "POST"
  ? route.fulfill({ status, contentType: "application/json", body: "{}" }) : route.continue());

SCENES.unlock = async () => {
  for (const [vp, scheme] of [[VP.d, "light"], [VP.d, "dark"], [VP.m, "light"]]) {
    const primary = vp === VP.d && scheme === "light";
    const suffix = `${scheme === "dark" ? "dark-" : ""}${vpName(vp)}`;
    const page = await newPage({ vp, scheme });
    await gotoContent(page, "external_md");
    await page.waitForSelector("#unlock-form", { timeout: 15000 });
    await stateShot(page, `manure-unlock-${suffix}`, "External-artifact password card on the content origin", "anonymous goto <content-url> of an external artifact");
    if (primary) {
      await page.fill("#password-input", "definitely-wrong");
      await page.click("#unlock-form button[type=submit]");
      await page.waitForSelector("#unlock-error:not([hidden])", { timeout: 10000 });
      await stateShot(page, "manure-unlock-error-1440", "Wrong password: field error under the input", "submit a wrong password");
      await page.route("**/__manure/unlock", unlockAnswer(429));
      await page.fill("#password-input", "throttled");
      await page.click("#unlock-form button[type=submit]");
      await page.waitForSelector("#unlock-throttled:not([hidden])", { timeout: 10000 });
      await stateShot(page, "manure-unlock-rate-limited-1440", "Throttled: warning notice, form paused", "unlock POST answered 429 (route)");
      await page.reload({ waitUntil: "load" });
      await page.unroute("**/__manure/unlock");
      await page.route("**/__manure/unlock", unlockAnswer(404));
      await page.fill("#password-input", "gone");
      await page.click("#unlock-form button[type=submit]");
      await page.waitForSelector("#unlock-gone:not([hidden])", { timeout: 10000 });
      await stateShot(page, "manure-unlock-expired-1440", "Artifact deleted or expired while the card was open", "unlock POST answered 404 (route)");
      await page.unroute("**/__manure/unlock");
      await page.reload({ waitUntil: "load" });
      await page.fill("#password-input", ROLES.external_md.external_password);
      await page.click("#unlock-form button[type=submit]");
      await page.waitForURL(/artifacts\.localhost/); await waitViewer(page);
      await stateShot(page, "manure-viewer-after-unlock-1440", "Markdown viewer after the correct password", "submit correct password");
    }
    await page.context().close();
  }
};

SCENES.viewer = async () => {
  const open = async (role, suffix = "", options = {}) => {
    const page = await newPage(options);
    const res = await gotoContent(page, role, suffix);
    if (res && res.error) throw new Error(`viewer ${role}: ${res.error}`);
    await page.waitForSelector("body[data-viewer]");
    if (await page.locator("#content").count()) await waitViewer(page); else await sleep(500);
    return page;
  };
  for (const [vp, scheme] of [[VP.d, "light"], [VP.d, "dark"], [VP.s, "light"], [VP.m, "light"]]) {
    const suffix = `${scheme === "dark" ? "dark-" : ""}${vpName(vp)}`;
    const page = await open("md_report", "", { vp, scheme });
    await stateShot(page, `manure-viewer-markdown-${suffix}`, "Markdown viewer: bar, meta line, rendered document", "anonymous goto <content-url> (md_report)");
    if (vp === VP.d && scheme === "light") {
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      await stateShot(page, "manure-viewer-raw-1440", "Markdown viewer, Raw: numbered source with light highlighting", "click Raw");
      await page.getByRole("button", { name: "Rendered", exact: true }).click();
      const diagram = page.getByRole("figure", { name: "Diagram 1", exact: true });
      await diagram.scrollIntoViewIfNeeded();
      await diagram.getByRole("button", { name: "Actual size", exact: true }).focus();
      await page.keyboard.press("Enter");
      await stateShot(page, "manure-viewer-diagram-actual-1440", "Embedded Mermaid diagram at actual size, zoom tools shown on focus", "focus the figure's Actual size, press Enter");
    }
    await page.context().close();
    const listing = await open("browse_dir", "", { vp, scheme });
    await stateShot(listing, `manure-viewer-directory-${suffix}`, "Directory listing with the README rendered beneath", "anonymous goto <content-url> (browse_dir)");
    if (vp === VP.d && scheme === "light") {
      await listing.getByText("Download all (CLI)…", { exact: true }).click();
      await stateShot(listing, "manure-viewer-directory-cli-1440", "Directory listing, 'Download all (CLI)' disclosure open", "click Download all (CLI)");
    }
    await listing.context().close();
  }
  for (const [role, suffix, name, what] of [
    ["browse_dir", "samples/", "manure-viewer-directory-subdir-1440", "Nested listing without README: parent row, folder and file rows"],
    ["browse_dir", "__manure/view/notes/%C3%BC-%C3%BCn%C3%AFcode%20%26%20%3Cb%3E.md", "manure-viewer-nested-1440", "Markdown file inside a directory artifact: breadcrumb with the folder path"],
    ["pdf", "", "manure-viewer-pdf-1440", "PDF viewer: sticky page toolbar, page on the canvas stage"],
    ["png", "", "manure-viewer-image-1440", "Image viewer: zoom toolbar, image on the canvas stage"],
    ["mermaid", "", "manure-viewer-diagram-1440", "Standalone Mermaid file rendered as a diagram image"],
    ["bad_dot", "", "manure-viewer-error-1440", "Graphviz render error: notice with Download original and the raw source"],
    ["code_py", "", "manure-viewer-text-1440", "Python source file: numbered text preview (was a download)"],
    ["zip_file", "", "manure-viewer-archive-1440", "ZIP archive: no-preview card with Download original (was a bare download)"],
  ]) {
    const page = await open(role, suffix);
    await stateShot(page, name, what, `anonymous goto <content-url>/${suffix} (${role})`);
    await page.context().close();
  }
};

SCENES.keyboard = async () => {
  const page = await newPage({ storageState: AUTH });
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#workspace-shell:not([hidden])"); await waitList(page);
  const stops = [];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); return { tag: e.localName, id: e.id, text: (e.getAttribute("aria-label") || e.textContent || e.value || "").trim().slice(0, 40), y: Math.round(r.y), visible: r.width > 0 }; }));
  }
  metrics.tabOrderFirst40 = stops;
  await page.context().close();
};

SCENES.dark = async () => {
  const page = await newPage({ scheme: "dark", storageState: AUTH, clipboard: true });
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#workspace-shell:not([hidden])"); await waitList(page);
  await shot(page, "catalogue-first-render", "Catalogue, dark scheme (prefers-color-scheme: dark; there is no theme switch)", "log in with colorScheme=dark", { probe: true });
  await scrollPanelIntoView(page);
  await page.evaluate(() => { document.getElementById("results-panel").scrollTop = 500; }); await sleep(400);
  await shot(page, "catalogue-both-scrolled", "Dark catalogue with page + panel scrolled (status badges, access badges)", "scroll", {});
  await openDetail(page, ROLES.external_site.artifact_id);
  await shot(page, "detail-external-dir", "Detail view, dark", "deep link", { probe: true });
  await page.click("#get-password-button"); await sleep(900);
  await shot(page, "detail-external-password-revealed", "Password reveal panel, dark", "click Copy current password", {});
  await page.context().close();
};

// ---------------------------------------------------------------- redesigned shell + catalogue (UX-M1)
// Files are named like the mockup shots (<app>-<view>-<state>-<width>[-dark].png) for side-by-side review.
async function snap(page, name, what) {
  await sleep(250);
  const file = name + ".png";
  await page.screenshot({ path: path.join(OUT, file) });
  index.push({ n: index.length + 1, file, what, how: currentScene === "m2" ? "UX-M2 scene" : "UX-M1 scene", scene: currentScene });
  log(`snap ${file}`);
}
async function themed(page, scheme) {
  await page.evaluate((choice) => document.dispatchEvent(new CustomEvent("ui:theme-choice", { detail: choice })), scheme);
}
async function catalogue(vp, scheme) {
  const page = await newPage({ vp, scheme, storageState: AUTH, clipboard: true });
  await page.goto(BASE + "/#/artifacts", { waitUntil: "load" });
  await page.waitForSelector("#main:not([hidden])"); await waitList(page);
  await themed(page, scheme);
  return page;
}
SCENES.m1 = async () => {
  const width = (vp) => String(vp.width);
  for (const [vp, scheme] of [[VP.d, "light"], [VP.s, "light"], [VP.m, "light"], [VP.d, "dark"], [VP.s, "dark"], [VP.m, "dark"]]) {
    const page = await catalogue(vp, scheme);
    await snap(page, `manure-catalogue${scheme === "dark" ? "-dark" : ""}-${width(vp)}`, "Catalogue first render");
    if (vp === VP.d || vp === VP.m) {
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(1200);
      if (vp === VP.m) await page.fill("#filter-text", "access:external changed draft");
      await page.evaluate(() => window.scrollTo(0, 1500)); await sleep(300);
      await snap(page, `manure-catalogue-scrolled${scheme === "dark" ? "-dark" : ""}-${width(vp)}`, "Catalogue scrolled: sticky view bar and table header (390: wrapped view bar with a changed draft)");
    }
    await page.context().close();
  }
  const page = await catalogue(VP.d, "light");
  // end of a filtered list
  await page.fill("#filter-text", "access:external"); await page.press("#filter-text", "Enter"); await waitList(page);
  for (let i = 0; i < 10 && !/All /.test(await page.textContent("#list-status")); i++) { await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(800); }
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(300);
  await snap(page, "manure-catalogue-end-1440", "Filtered list scrolled to its end marker");
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap(page, "manure-catalogue-filtered-1440", "access:external applied through the scope control");
  // draft states
  await page.fill("#filter-text", "access:external tag:release"); await page.click("body", { position: { x: 5, y: 600 } }).catch(() => {});
  await snap(page, "manure-catalogue-stale-draft-1440", "Changed draft: results kept, draft hint in the query bar");
  await page.fill("#filter-text", "access:bogus tag:release");
  await snap(page, "manure-catalogue-diagnostic-1440", "Invalid draft: anchored diagnostic, nothing sent");
  await page.fill("#filter-text", ""); await page.click("#filter-text"); await page.keyboard.type("tag:release state:"); await sleep(300);
  await snap(page, "manure-catalogue-suggestions-1440", "Completion suggestions under the query bar");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.goto(BASE + "/#/artifacts", { waitUntil: "load" }); await waitList(page);
  // row menu, delete dialog, syntax dialog, drop overlay
  const second = page.locator("#artifact-list > tr").nth(2);
  await second.hover(); await second.locator("[data-action=more]").click();
  await snap(page, "manure-catalogue-row-menu-1440", "Row actions menu (Copy ID, Copy content link, Details, Delete…)");
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.waitForSelector("dialog[open]");
  await snap(page, "manure-catalogue-delete-confirm-1440", "In-app delete confirmation, Cancel focused");
  await page.keyboard.press("Escape"); await sleep(200);
  await page.click("#syntax-button"); await page.waitForSelector("dialog[open]");
  await snap(page, "manure-catalogue-syntax-1440", "Query syntax dialog");
  await page.keyboard.press("Escape"); await sleep(200);
  await page.evaluate(() => { const t = new DataTransfer(); t.items.add(new File(["x"], "a.txt")); document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: t, bubbles: true })); });
  await snap(page, "manure-catalogue-drop-1440", "Drop overlay while files are dragged over the page");
  await page.context().close();
  // empty, error, loading
  const empty = await catalogue(VP.d, "light");
  await empty.fill("#filter-text", 'tag:release hostname:"atlantis"'); await empty.press("#filter-text", "Enter"); await waitList(empty);
  await snap(empty, "manure-catalogue-empty-1440", "No matching artifacts");
  await empty.context().close();
  const failing = await newPage({ storageState: AUTH });
  await failing.route("**/api/current", async (route) => { if (isList(route)) await route.fulfill({ status: 503, contentType: "application/json", body: errorBody(route, "Unavailable") }); else await route.continue().catch(() => {}); });
  await failing.goto(BASE + "/#/artifacts", { waitUntil: "load" }); await waitList(failing);
  await snap(failing, "manure-catalogue-error-1440", "First page failed: notice with Retry, nothing else");
  await failing.context().close();
  const loading = await newPage({ storageState: AUTH });
  await loading.route("**/api/current", async (route) => { if (isList(route)) await sleep(5000); await route.continue().catch(() => {}); });
  await loading.goto(BASE + "/#/artifacts", { waitUntil: "load" }); await loading.waitForSelector("#main:not([hidden])"); await sleep(800);
  await snap(loading, "manure-catalogue-loading-1440", "First page pending: skeleton rows");
  await loading.context().close();
  // account outlet and login
  for (const scheme of ["light", "dark"]) {
    const account = await catalogue(VP.d, scheme);
    await account.click("#user-menu-button"); await account.getByRole("menuitem", { name: "Access tokens" }).click();
    await account.getByRole("heading", { name: "Access tokens", exact: true }).waitFor(); await account.locator("table[data-list=tokens] tr[data-row-id]").first().waitFor();
    await snap(account, `account-settings-tokens-manure${scheme === "dark" ? "-dark" : ""}-1440`, "Access tokens in the account outlet (degraded mode: no profile endpoint)");
    await account.context().close();
  }
  for (const scheme of ["light", "dark"]) {
    const out = await newPage({ scheme });
    await out.goto(BASE + "/", { waitUntil: "load" }); await out.waitForSelector("[data-account-login]"); await themed(out, scheme);
    await snap(out, `account-login-default-manure${scheme === "dark" ? "-dark" : ""}-1440`, "Signed out: login card in the auth mount");
    await out.context().close();
  }
};

// ---------------------------------------------------------------- Upload page and CLI view (UX-M2)
// Named like the mockup shots (manure-upload-<state>-<width>[-dark].png). Each state is reached through the real
// upload protocol; chunk requests are held or aborted at the network layer to reach progress and failure.
SCENES.m2 = async () => {
  const away = async (page, name, what) => { await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await snap(page, name, what); };
  const names = ["screenshot 2026-11-17 at 10.41.22.png", "a-very-long-file-name-that-keeps-going-and-going-for-the-purpose-of-layout-testing-0123456789.log", "notes.md"];
  const stage = async (page, sizes) => page.locator("#upload-files").setInputFiles(names.map((name, i) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.alloc(sizes[i], 0x61 + i) })));
  const states = async (page, state, n) => page.waitForFunction(([wanted, count]) => document.querySelectorAll(`tbody[data-upload-row][data-state="${wanted}"]`).length === count, [state, n]);
  async function uploadPage(vp, scheme, chunkHold) {
    const page = await newPage({ vp, scheme, storageState: AUTH, clipboard: true });
    page.__held = { release: null };
    await page.route("**/api/current/artifacts/*/chunks*", async (route) => {
      if (chunkHold && chunkHold(route.request().url(), page.__held)) { await new Promise((resolve) => { page.__held.release = resolve; }); }
      await route.continue().catch(() => {});
    });
    await page.goto(BASE + "/#/upload", { waitUntil: "load" });
    await page.getByRole("button", { name: "Choose files…" }).waitFor(); await themed(page, scheme);
    return page;
  }
  const settings = async (page, access) => {
    if (access) await page.getByRole("group", { name: "Access" }).getByRole("button", { name: access, exact: true }).click();
    await page.getByLabel("Expires", { exact: true }).selectOption("7");
    await page.getByLabel(/^Tags/).fill("release, report");
  };
  const press = (page) => page.getByRole("button", { name: /^Upload \d+ files?$/ }).click();
  for (const [vp, scheme] of [[VP.d, "light"], [VP.s, "light"], [VP.m, "light"], [VP.d, "dark"], [VP.m, "dark"]]) {
    const suffix = (state) => `manure-upload${state ? "-" + state : ""}${scheme === "dark" ? "-dark" : ""}-${vp.width}`;
    let page = await uploadPage(vp, scheme, null);
    await away(page, suffix(""), "Upload page, nothing staged");
    await stage(page, [70, 300 * 1024, 15]); await settings(page, null);
    await away(page, suffix("staged"), "Three files staged; settings and the summary line");
    if (vp === VP.s) { await page.context().close(); continue; }
    await press(page); await states(page, "ready", 3);
    await away(page, suffix("done"), "Three internal uploads ready: content links");
    await page.context().close();
  }
  // 1440 light only: external done, progress, failed, locked settings.
  let page = await uploadPage(VP.d, "light", null);
  await stage(page, [70, 300 * 1024, 15]); await settings(page, "External"); await press(page); await states(page, "ready", 3);
  await away(page, "manure-upload-done-external-1440", "Three external uploads ready: each with its one-time password panel");
  await page.locator("[data-upload-secret]").first().getByRole("button", { name: "Reveal" }).click();
  await away(page, "manure-upload-done-external-revealed-1440", "First password revealed: Copy and 'I have saved it' enabled");
  await page.locator("[data-upload-secret]").first().getByRole("button", { name: "I have saved it" }).click();
  await page.getByRole("dialog").waitFor();
  await away(page, "manure-upload-done-external-confirm-1440", "Dismissing a password asks first; Cancel has the focus");
  await page.context().close();
  const chunkBytes = await (async () => { const p = await newPage({ storageState: AUTH }); await p.goto(BASE + "/#/upload"); const value = await p.evaluate(async () => (await (await fetch("/api/current", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001", apiVersion: "1.0.0", command: { GetCapabilities: {} } }) })).json()).result.CapabilityInfo.capabilities.chunkBytes); await p.context().close(); return value; })();
  // progress: file 2 spans two chunks; its second chunk is held.
  page = await uploadPage(VP.d, "light", (url, held) => /offset=[1-9]/.test(url) && held.release === null);
  await page.locator("#upload-files").setInputFiles(names.map((name, i) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.alloc([70, Math.floor(chunkBytes * 1.4), 15][i], 0x61 + i) })));
  await settings(page, null); await press(page); await states(page, "uploading", 1);
  while (page.__held.release === null) await sleep(100);
  await away(page, "manure-upload-progress-1440", "File 2 of 3 uploading: settings locked, Cancel upload");
  await page.getByRole("button", { name: "Cancel upload" }).click(); page.__held.release(); await states(page, "stopped", 1);
  await away(page, "manure-upload-stopped-1440", "Cancelled: the reserved artifact keeps its offset; Retry continues it");
  await page.context().close();
  // failed: the connection resets on the first chunk of file 2.
  page = await newPage({ storageState: AUTH, clipboard: true });
  let failed = false;
  await page.route("**/api/current/artifacts/*/chunks*", async (route) => {
    if (!failed && /offset=0/.test(route.request().url()) && (await page.locator('tbody[data-upload-row][data-state="uploading"] .cell-title').textContent()).startsWith("a-very-long")) { failed = true; await route.abort("connectionreset"); }
    else await route.continue().catch(() => {});
  });
  await page.goto(BASE + "/#/upload", { waitUntil: "load" }); await page.getByRole("button", { name: "Choose files…" }).waitFor();
  await stage(page, [70, 300 * 1024, 15]); await settings(page, null); await press(page); await states(page, "failed", 1);
  await away(page, "manure-upload-failed-1440", "File 2 failed: the reason, Retry on the same artifact; later files stay staged");
  await page.context().close();
  // CLI view
  for (const [vp, scheme] of [[VP.d, "light"], [VP.s, "light"], [VP.m, "light"], [VP.d, "dark"]]) {
    const cli = await newPage({ vp, scheme, storageState: AUTH, clipboard: true });
    await cli.goto(BASE + "/#/cli", { waitUntil: "load" }); await cli.getByRole("heading", { name: "Command-line client", level: 1 }).waitFor(); await themed(cli, scheme);
    await away(cli, `manure-upload-cli${scheme === "dark" ? "-dark" : ""}-${vp.width}`, "CLI view: copyable commands");
    await cli.context().close();
  }
  // drop overlay over the catalogue, then the staged hand-off
  const drop = await catalogue(VP.d, "light");
  await drop.evaluate(() => { const t = new DataTransfer(); t.items.add(new File(["x"], "a.txt")); t.items.add(new File(["y"], "b.txt")); document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: t, bubbles: true })); });
  await away(drop, "manure-catalogue-drop-1440", "Drop overlay: files continue on the Upload page");
  await drop.evaluate(() => { const t = new DataTransfer(); t.items.add(new File(["x"], "a.txt")); t.items.add(new File(["y"], "b.txt")); document.dispatchEvent(new DragEvent("drop", { dataTransfer: t, bubbles: true, cancelable: true })); });
  await states(drop, "staged", 2);
  await away(drop, "manure-upload-handoff-1440", "After the drop: the Upload page with the two files staged");
  await drop.context().close();
};

// ---------------------------------------------------------------- main
// The scenes after "m1" capture the pre-redesign dashboard (ids and dialogs that UX-M1 replaced); they are
// kept as the record of the "before" captures and are not run by default.
const ORDER = ["auth", "m1", "m2", "login", "catalogue", "upload", "detail", "account", "unlock", "viewer", "keyboard", "dark"];
const DEFAULT_SCENES = ["auth", "m1", "unlock", "viewer"];
const only = new Set(input.scenes && input.scenes.length ? ["auth", ...input.scenes] : DEFAULT_SCENES);
for (const name of ORDER) {
  if (!only.has(name)) continue;
  currentScene = name;
  log(`scene ${name}`);
  try { await SCENES[name](); } catch (error) {
    metrics.notes.push(`scene ${name} FAILED: ${error.message.split("\n")[0]}`);
    log(`scene ${name} FAILED: ${error.stack}`);
  }
}
await browser.close();

// ---------------------------------------------------------------- outputs
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 1));
fs.writeFileSync(path.join(OUT, "dialogs.json"), JSON.stringify(dialogs, null, 2));
const rows = index.map((e) => `| ${e.n} | \`${e.file}\` | ${e.what} | ${e.how} |`);
fs.writeFileSync(path.join(OUT, "index.md"), [
  "# Manure UI capture index", "",
  `Generated ${new Date().toISOString()} by manure/web/ui-capture (Chromium via playwright-core, DPR 1, fonts: DejaVu only — Inter is not installed in the pinned font set).`,
  `Primary viewport 1440x900; secondary 1024x700 (and 390x844 for a few responsive checks); default scheme light, dark via prefers-color-scheme.`, "",
  "| # | File | What it shows | How it was reached |", "|---|---|---|---|", ...rows, "",
].join("\n"));
log(`done: ${index.length} screenshots`);
