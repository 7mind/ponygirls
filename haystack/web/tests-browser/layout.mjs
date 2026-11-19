// Browse layout sweep (spec §8 items 6, 9, 11): 1440, 1024 and 390 pixels in light and dark with long unbroken
// values — no horizontal overflow, the table stays a table with unclipped headers, truncated values stay readable
// as tooltips, text is at least 12 px and meets 4.5:1 contrast, sorting, skip link and open-record by keyboard.
// Behavioral, blackbox/group: actual React UI and Chromium, controlled API fixture;
// this does not establish server or protocol acceptance.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { LAYOUT_SCALES, launchWithScrollbars, layoutContext, resizeWindow, assertQuiescentAroundThreshold } from "../../../shared/ui-web/tests/layout-quiescence.mjs";

const executablePath = process.env.HAYSTACK_CHROMIUM;
assert.ok(typeof executablePath === "string" && executablePath.startsWith("/"), "HAYSTACK_CHROMIUM must name the pinned browser executable");
const item = {
  project: "project-" + "namespace".repeat(12), item: "record-" + "identifier".repeat(16),
  revision: 123456789, title: "A long record title " + "unbroken".repeat(24),
  type: "custom-" + "classification".repeat(10), status: "actual", importance: "high", humanAttention: "required",
  tags: ["tag-" + "unbroken".repeat(25), "another tag"],
  modifiedAt: "2026-06-15T12:34:56.000Z", modifiedBy: "operator-" + "identity".repeat(20),
};
const normalItems = [
  { ...item, project: "operations", item: "release-checklist", title: "Release checklist", type: "fact", tags: ["release", "verification"], modifiedBy: "operator", revision: 4 },
  { ...item, project: "activity", item: "review-protocol", title: "Review protocol framing", type: "github-pr", tags: ["protocol"], modifiedBy: "agent", revision: 2 },
  { ...item, project: "activity", item: "verify-artifact", title: "Verify release artifact", type: "skill-draft", tags: [], humanAttention: "cleared", modifiedBy: "agent", revision: 1 },
];
const KEY = `${item.project}:${item.item}`;
/** The record of `?fixture=history`: twelve revisions in its History card. */
const HISTORY_KEY = "operations:release-checklist", HISTORY_REVISIONS = 12;
const historyItem = { key: HISTORY_KEY, revision: HISTORY_REVISIONS, metadata: { createdAt: "2026-06-01T08:00:00.000Z", createdBy: "operator", modifiedAt: item.modifiedAt, modifiedBy: "operator" },
  document: { title: "Release checklist", description: "Steps before a release.", fieldsJson: "{}", type: "fact", status: "actual", importance: "high", humanAttention: "cleared", links: [], tags: ["release"] } };
const historyRevisions = Array.from({ length: HISTORY_REVISIONS }, (_, index) => ({ revision: HISTORY_REVISIONS - index, modifiedAt: item.modifiedAt, modifiedBy: "operator", tokenId: "test" }));
/** Visible column headers per width: Project and Rev hide at 1100 px and below, all but Record and Modified at 720 px and below. */
const COLUMNS = {
  1440: ["Record", "Type", "Project", "Tags", "Attention", "Importance", "Modified", "Rev"],
  1024: ["Record", "Type", "Tags", "Attention", "Importance", "Modified"],
  390: ["Record", "Modified"],
};
const MIN_TEXT_PX = 12;
const MIN_CONTRAST = 4.5;
/** Fewer visible texts than the one-row list has at 390 px means the audit missed the view. */
const MIN_AUDITED_TEXTS = 15;
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = await createServer({ root, optimizeDeps: { include: ["react", "react-dom/client"] }, server: { host: "127.0.0.1", port: 0 }, plugins: [{
  name: "layout-fixture",
  resolveId(id) { if (id === "/layout-entry.js") return "\0layout-entry"; },
  load(id) {
    if (id !== "\0layout-entry") return;
    return `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { App } from '/src/App.tsx'; import { api } from '/src/api.ts'; import '/src/styles.css'; import '/src/browse.css'; import '/src/record.css'; import '/src/edit.css';
        window.layoutUser = 'operator'; window.accountInvalidations = 0;
        document.addEventListener('account:invalidate', () => window.accountInvalidations++);
        api.whoami = async () => {
          const userId = window.layoutUser;
          if (window.holdWhoami === userId) await new Promise(resolve => { window.releaseWhoami = resolve; });
          return {userId,type:'human',tokenId:'test',activityProjectId:'corporate-activity'};
        };
        api.search = async () => ({items:location.search === "?fixture=normal" ? ${JSON.stringify(normalItems)} : [${JSON.stringify(item)}],cursor:undefined});
        api.analyze = async () => ({valid:true,diagnostics:[]});
        if (location.search === "?fixture=history") { api.get = async () => (${JSON.stringify(historyItem)}); api.history = async () => ({revisions:${JSON.stringify(historyRevisions)}}); }
        if (new URLSearchParams(location.search).has('pending')) {
          let pending = {key:'project:' + 'uncertainwrite'.repeat(30)}; const listeners = new Set();
          api.pendingWrite = () => pending;
          api.subscribePendingWrite = listener => { listeners.add(listener); return () => listeners.delete(listener); };
          api.retryPendingWrite = async () => { pending = undefined; listeners.forEach(listener => listener()); return {revision:7}; };
        }
        createRoot(document.getElementById('root')).render(React.createElement(App));`;
  },
  configureServer(server) {
    server.middlewares.use("/layout.html", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml('/layout.html', '<!doctype html><html data-app="haystack"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="/ui/theme-init.js"></script><link rel="stylesheet" href="/ui/tokens.css"><link rel="stylesheet" href="/ui/components.css"><script type="module" src="/@vite/client"></script></head><body><div id="root"></div><script type="module" src="/layout-entry.js"></script></body></html>'));
    });
  },
}] });

// Runs in the page: visible text below the size floor or below the contrast floor (WCAG 2 formula, opaque grounds).
function textAudit({ minPx, minContrast }) {
  const channels = (color) => color.match(/[\d.]+/g).map(Number);
  const luminance = (color) => channels(color).slice(0, 3).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const ground = (element) => {
    for (let node = element; node !== null; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      const [, , , alpha = 1] = channels(background);
      if (alpha > 0) return background;
    }
    return getComputedStyle(document.documentElement).backgroundColor;
  };
  const dimmed = (element) => { for (let node = element; node !== null; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) return true; return false; };
  const problems = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node.parentElement;
    const rect = element.getBoundingClientRect();
    if (node.textContent.trim() === "" || element.getClientRects().length === 0 || rect.width < 2 || dimmed(element)) continue;
    const style = getComputedStyle(element);
    checked++;
    if (parseFloat(style.fontSize) < minPx) problems.push(`${node.textContent.trim().slice(0, 30)}: ${style.fontSize}`);
    const [fg, bg] = [luminance(style.color), luminance(ground(element))];
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    if (ratio < minContrast) problems.push(`${node.textContent.trim().slice(0, 30)}: contrast ${ratio.toFixed(2)}`);
  }
  return { checked, problems };
}

let browser, layoutBrowsers = [];
try {
  await vite.listen();
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  for (const width of [1440, 1024, 390]) {
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      // A new document per case: lists stay mounted (hidden) across routes within one document.
      await page.goto(`${vite.resolvedUrls.local[0]}layout.html?case=${width}-${colorScheme}#/browse`);
      const open = page.getByRole("button", { name: KEY, exact: true });
      await open.waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${colorScheme}: no horizontal document overflow`);
      const table = page.getByRole("table", { name: "Records" });
      const headers = (await table.getByRole("columnheader").allTextContents()).map((text) => text.trim());
      assert.deepEqual(headers, COLUMNS[width], `${width}: visible columns; the table stays a table`);
      assert.equal(await table.getByRole("row").count(), 2, "header and data row semantics retained");
      const clipped = await table.locator("th").evaluateAll((cells) => cells.filter((cell) => cell.getClientRects().length > 0 && cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent));
      assert.deepEqual(clipped, [], `${width}: no clipped table header`);
      const row = table.locator("tbody tr");
      for (const value of [item.title, KEY, item.project, item.type, item.importance, "Needs review", ...item.tags, item.modifiedBy, String(item.revision)])
        assert.ok((await row.textContent()).includes(value), `missing metadata: ${value}`);
      const hiddenValues = await row.evaluate((element) => [...element.querySelectorAll("*")].filter((node) => node.getClientRects().length > 0 && node.children.length === 0 && node.scrollWidth > node.clientWidth + 1)
        .filter((node) => (node.closest("[title]")?.getAttribute("title") ?? "") !== node.textContent && !(node.closest("[title]")?.getAttribute("title") ?? "").endsWith(node.textContent.replace(/^by /, "")))
        .map((node) => node.textContent.slice(0, 40)));
      assert.deepEqual(hiddenValues, [], `${width}: every truncated value is available in full as a tooltip`);
      const audit = await page.evaluate(textAudit, { minPx: MIN_TEXT_PX, minContrast: MIN_CONTRAST });
      assert.ok(audit.checked >= MIN_AUDITED_TEXTS, `${width}: the audit saw the list (${audit.checked} texts)`);
      assert.deepEqual(audit.problems, [], `${width}/${colorScheme}: text size and contrast`);
      for (const label of COLUMNS[width].filter((label) => label !== "Tags")) {
        const name = label === "Rev" ? "Revision" : label;
        await page.getByRole("button", { name: `Sort by ${name}`, exact: true }).focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction((value) => document.querySelector(`[aria-label="Sort by ${value}"]`).closest("th").hasAttribute("aria-sort"), name);
      }
      const appliedHash = new URL(page.url()).hash;
      await page.getByRole("link", { name: "Skip to main content", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).hash, appliedHash, "skip navigation must not replace the applied hash route");
      assert.equal(await page.getByRole("main").evaluate((element) => element === document.activeElement), true);
      await open.focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => location.hash.startsWith("#/item/"));
      console.log(`ok - record layout ${width}px ${colorScheme}: no overflow, a table with unclipped headers, readable truncation, text size and contrast, keyboard sorting and open`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${vite.resolvedUrls.local[0]}layout.html?fixture=normal#/browse`);
  await page.getByRole("button", { name: "operations:release-checklist", exact: true }).waitFor();
  await page.evaluate(() => { window.layoutUser = "stale"; window.holdWhoami = "stale"; document.dispatchEvent(new Event("account:changed")); });
  await page.waitForFunction(() => typeof window.releaseWhoami === "function");
  await page.evaluate(() => { window.layoutUser = "replacement"; document.dispatchEvent(new Event("account:changed")); });
  await page.waitForFunction(() => document.querySelector("[data-account-outlet]").dataset.accountUserId === "replacement");
  await page.evaluate(() => { window.releaseWhoami(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator("[data-account-outlet]").getAttribute("data-account-user-id"), "replacement", "a late identity response cannot restore a superseded account");
  assert.ok(await page.evaluate(() => window.accountInvalidations > 0), "identity replacement invalidates stale account state");
  console.log("ok - a late identity response cannot restore a superseded account; the replacement invalidates stale account state");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${vite.resolvedUrls.local[0]}layout.html?fixture=normal&pending=1#/browse`);
  await page.getByRole("button", { name: "Retry original write", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "uncertain-write recovery must fit the mobile workspace");
  await page.getByRole("button", { name: "Retry original write", exact: true }).click();
  await page.getByText(/Original write confirmed as revision 7/).waitFor();
  console.log("ok - uncertain-write recovery fits 320 px and Retry confirms the original write");
  // UX-JIT (shared/ui-web/tests/layout-quiescence.mjs): with scrollbars that take space, at 100 % and 125 % display scaling,
  // Browse and a record's history settle around the window height where the document starts to scroll.
  const LAYOUT_WIDTH = 1440, LAYOUT_LOAD_HEIGHT = 900;
  const views = [["Browse", "layout.html?fixture=normal#/browse", (page) => page.getByRole("button", { name: "operations:release-checklist", exact: true }).waitFor()],
    ["Record history", `layout.html?fixture=history#/item/${HISTORY_KEY}`, (page) => page.getByRole("region", { name: "History", exact: true }).getByRole("listitem").nth(HISTORY_REVISIONS - 1).waitFor()]];
  layoutBrowsers = await Promise.all(LAYOUT_SCALES.map((scale) => launchWithScrollbars(chromium, scale, { executablePath, args: ["--no-sandbox"] })));
  const outcomes = await Promise.allSettled(LAYOUT_SCALES.flatMap((scale, index) => views.map(async ([name, path, ready]) => {
    const context = await layoutContext(layoutBrowsers[index], {}), layoutPage = await context.newPage(), errors = [];
    layoutPage.on("pageerror", (error) => errors.push(error.message));
    try {
      await resizeWindow(layoutPage, LAYOUT_WIDTH, LAYOUT_LOAD_HEIGHT);
      await layoutPage.goto(`${vite.resolvedUrls.local[0]}${path}`); await ready(layoutPage);
      await assertQuiescentAroundThreshold(layoutPage, `${name} at ${scale * 100} %`, { width: LAYOUT_WIDTH, scroller: null });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  })));
  assert.deepEqual(outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason.message), [], "Browse and record history settle at every size");
  console.log("ok - Browse and record history settle with space-taking scrollbars at 100 % and 125 % around their scroll threshold");
} finally { if (browser) await browser.close(); await Promise.all(layoutBrowsers.map((item) => item.close())); await vite.close(); }
