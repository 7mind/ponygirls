// Regression: the record table's fixed minimum width required horizontal scrolling.
// Behavioral, blackbox/group: actual React UI and Chromium, controlled API fixture;
// this does not establish server or protocol acceptance.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

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
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  for (const width of [1440, 1101, 1100, 1024, 801, 800, 390, 320]) {
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      // A new document per case: lists stay mounted (hidden) across routes within one document.
      await page.goto(`${vite.resolvedUrls.local[0]}layout.html?case=${width}-${colorScheme}#/browse`);
      await page.locator(".record-open").waitFor();
      const dimensions = await page.evaluate(() => {
        const panel = document.querySelector(".records-panel");
        const table = panel.querySelector("table");
        return { page: [document.documentElement.scrollWidth, innerWidth], panel: [panel.scrollWidth, panel.clientWidth], table: [table.scrollWidth, table.clientWidth] };
      });
      for (const [name, [scroll, client]] of Object.entries(dimensions)) assert.ok(scroll <= client + 1, `${width}/${colorScheme}: ${name} horizontal overflow ${scroll} > ${client}`);
      const row = page.locator("tbody tr");
      assert.equal(await row.locator("td").count(), 9);
      const accessibility = await page.getByRole("table").ariaSnapshot();
      assert.match(accessibility, /- table:/);
      assert.equal((accessibility.match(/- row[ :]/g) ?? []).length, 2, "table header and data row semantics retained");
      assert.equal((accessibility.match(/- columnheader/g) ?? []).length, 9);
      assert.equal((accessibility.match(/- cell/g) ?? []).length, 9);
      for (const value of [item.title, item.item, item.project, item.type, item.status, item.importance, "Needs review", item.tags.join(", "), item.modifiedBy, String(item.revision)]) {
        assert.ok((await row.textContent()).includes(value), `missing metadata: ${value}`);
      }
      const clipped = await row.locator("td, td span, td strong, td small").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1 || ["hidden", "clip"].includes(getComputedStyle(element).overflowX)).map(element => element.textContent));
      assert.deepEqual(clipped, [], "metadata must wrap rather than clip");
      for (const label of ["Record", "Project", "Type", "Status", "Priority", "Attention", "Modified", "Rev"]) {
        const button = page.getByRole("button", { name: `Sort by ${label}`, exact: true });
        await button.focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(label => document.querySelector(`[aria-label="Sort by ${label}"]`).closest("th").getAttribute("aria-sort") !== "none", label);
      }
      const appliedHash = new URL(page.url()).hash;
      await page.getByRole("link", { name: "Skip to main content", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(new URL(page.url()).hash, appliedHash, "skip navigation must not replace the applied hash route");
      assert.equal(await page.getByRole("main").evaluate(element => element === document.activeElement), true);
      await page.locator(".record-open").focus();
      await page.keyboard.press("Enter");
      assert.ok(new URL(page.url()).hash.startsWith("#/item/"), "record action must remain available");
      console.log(`ok - record layout ${width}px ${colorScheme}: no horizontal overflow; metadata, sorting and open action available`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${vite.resolvedUrls.local[0]}layout.html?fixture=normal#/browse`);
  await page.locator(".record-open").first().waitFor();
  for (const row of await page.locator("tbody tr").all()) {
    assert.ok((await row.boundingBox()).height <= 64, "ordinary desktop rows stay compact");
  }
  assert.equal(await page.getByRole("main").evaluate(element => element.getBoundingClientRect().left), 0, "records use the full workspace width");
  await page.evaluate(() => { window.layoutUser = "stale"; window.holdWhoami = "stale"; document.dispatchEvent(new Event("account:changed")); });
  await page.waitForFunction(() => typeof window.releaseWhoami === "function");
  await page.evaluate(() => { window.layoutUser = "replacement"; document.dispatchEvent(new Event("account:changed")); });
  await page.waitForFunction(() => document.querySelector("[data-account-outlet]").dataset.accountUserId === "replacement");
  await page.evaluate(() => { window.releaseWhoami(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator("[data-account-outlet]").getAttribute("data-account-user-id"), "replacement", "a late identity response cannot restore a superseded account");
  assert.ok(await page.evaluate(() => window.accountInvalidations > 0), "identity replacement invalidates stale account state");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${vite.resolvedUrls.local[0]}layout.html?fixture=normal&pending=1#/browse`);
  await page.getByRole("button", { name: "Retry original write", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "uncertain-write recovery must fit the mobile workspace");
  await page.getByRole("button", { name: "Retry original write", exact: true }).click();
  await page.getByText(/Original write confirmed as revision 7/).waitFor();
} finally { if (browser) await browser.close(); await vite.close(); }
