// Regression: the record table's fixed minimum width required horizontal scrolling.
// Behavioral, blackbox/group: actual React UI and Chromium, controlled API fixture;
// this does not establish server or protocol acceptance.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const executablePath = process.env.HAYSTACK_CHROMIUM;
assert.ok(typeof executablePath === "string" && executablePath.startsWith("/"), "HAYSTACK_CHROMIUM must name the pinned browser executable");
const artifacts = process.env.HAYSTACK_UI_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
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
        import { App } from '/src/App.tsx'; import { api } from '/src/api.ts'; import '/src/styles.css';
        api.whoami = async () => ({userId:'operator',type:'human',tokenId:'test',activityProjectId:'activity'});
        api.search = async () => ({items:location.search === "?fixture=normal" ? ${JSON.stringify(normalItems)} : [${JSON.stringify(item)}],cursor:undefined});
        api.analyze = async () => ({valid:true,diagnostics:[]});
        createRoot(document.getElementById('root')).render(React.createElement(App));`;
  },
  configureServer(server) {
    server.middlewares.use("/layout.html", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml('/layout.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/@vite/client"></script></head><body><div id="root"></div><script type="module" src="/layout-entry.js"></script></body></html>'));
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
      await page.goto(`${vite.resolvedUrls.local[0]}layout.html#/browse`);
      await page.locator(".record-open").waitFor();
      if (artifacts) await page.screenshot({ path: `${artifacts}/haystack-layout-${width}-${colorScheme}.png`, fullPage: true });
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
      await page.locator(".record-open").focus();
      await page.keyboard.press("Enter");
      assert.ok(new URL(page.url()).hash.startsWith("#/item/"), "record action must remain available");
      console.log(`ok - record layout ${width}px ${colorScheme}: no horizontal overflow; metadata, sorting and open action available`);
    }
  }
  if (artifacts) {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`${vite.resolvedUrls.local[0]}layout.html?fixture=normal#/browse`);
      await page.locator(".record-open").first().waitFor();
      await page.screenshot({ path: `${artifacts}/haystack-normal-1440-${colorScheme}.png`, fullPage: true });
    }
  }
} finally { if (browser) await browser.close(); await vite.close(); }
