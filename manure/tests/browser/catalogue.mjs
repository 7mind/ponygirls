// Catalogue shell checks of the dashboard redesign (spec §8 items 1–4, 7, 9) over the real API.
// Runnable alone: `node catalogue.mjs < payload.json` (payload from test_browser_catalogue.py).
// Fault injection is test-only; credentials arrive over stdin and never appear in the output.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const RECORDS = input.records.length;
const PAGE = 25;
const results = [];

const check = async (name, run) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) problems.push("console: " + message.text()); });
    page.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
    await page.addInitScript(() => {
      window.__shell = { violations: [], listCalls: 0, failNextAppend: false };
      document.addEventListener("securitypolicyviolation", (event) => window.__shell.violations.push(event.violatedDirective));
      const original = window.fetch.bind(window);
      window.fetch = (url, options) => {
        let command = null;
        try { command = JSON.parse(options?.body || "null")?.command ?? null; } catch (_) { command = null; }
        if (command?.ListArtifacts) {
          window.__shell.listCalls++;
          if (command.ListArtifacts.query.cursor != null && window.__shell.failNextAppend) {
            window.__shell.failNextAppend = false;
            return Promise.resolve(new Response(JSON.stringify({ requestId: JSON.parse(options.body).requestId, result: { Error: { failure: { code: "Unavailable", message: "controlled fixture", retryAfterSeconds: 1 } } } }), { status: 503, headers: { "Content-Type": "application/json" } }));
          }
        }
        return original(url, options);
      };
    });
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("[data-account-login] input[name=login]").fill(input.login);
    await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
    await page.locator("[data-account-login] button[type=submit]").click();
    await page.getByRole("button", { name: input.userId }).waitFor();
    await counterLoaded(page);
    await run(page);
    assert.deepEqual(await page.evaluate(() => window.__shell.violations), [], "no CSP violation");
    assert.deepEqual(problems, []);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message.split("\n").slice(0, 8).join(" ") });
  } finally { await context.close(); }
};
const rows = (page) => page.locator("#artifact-list > tr");
const counterLoaded = (page) => page.waitForFunction(() => / loaded/.test(document.querySelector("#list-status").textContent));
const rowCount = (page, n) => page.waitForFunction((count) => document.querySelectorAll("#artifact-list > tr").length === count, n);
const toEnd = (page) => page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
const search = async (page, text) => {
  await page.getByRole("combobox", { name: "Search artifacts" }).fill(text);
  await page.getByRole("combobox", { name: "Search artifacts" }).press("Enter");
  await page.waitForFunction((q) => new URLSearchParams(location.hash.split("?")[1]).get("query") === q, text);
  await counterLoaded(page);
};
const loadAll = async (page) => {
  for (let loaded = PAGE; loaded < RECORDS; loaded += PAGE) { await toEnd(page); await rowCount(page, Math.min(RECORDS, loaded + PAGE)); }
};
// Spec §8.1: every element that scrolls vertically, besides the document.
const scrollers = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0;
}).map((el) => el.id || el.className || el.tagName));

await check("one document scroller, sticky view bar and header, a table at every width", async (page) => {
  await search(page, input.prefix);
  await toEnd(page); await rowCount(page, 2 * PAGE);
  assert.deepEqual(await scrollers(page), []);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), "the document scrolls");
  await page.evaluate(() => window.scrollTo(0, 1500));
  const tops = await page.evaluate(() => {
    const viewbar = document.querySelector("#list-form").parentElement.getBoundingClientRect();
    return { masthead: document.querySelector(".masthead").getBoundingClientRect().height, viewbarTop: viewbar.top, viewbarHeight: viewbar.height,
      headerTop: document.querySelector("#catalogue-table thead th").getBoundingClientRect().top };
  });
  assert.ok(Math.abs(tops.viewbarTop - tops.masthead) <= 1, "view bar sticks under the masthead: " + JSON.stringify(tops));
  assert.ok(Math.abs(tops.headerTop - tops.masthead - tops.viewbarHeight) <= 1, "table header sticks under the view bar: " + JSON.stringify(tops));
  for (const [width, height] of [[1024, 700], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({
      overflow: document.scrollingElement.scrollWidth - innerWidth,
      table: getComputedStyle(document.querySelector("#catalogue-table")).display,
      row: getComputedStyle(document.querySelector("#artifact-list > tr")).display,
    }));
    assert.equal(layout.overflow <= 0, true, `no horizontal document overflow at ${width}px`);
    if (width === 1024) { assert.equal(layout.table, "table"); assert.equal(layout.row, "table-row", "rows stay table rows at 1024px"); }
    assert.deepEqual(await scrollers(page), [], `no inner scroller at ${width}px`);
  }
});

await check("document scrolling appends without duplicates, labels progress, ends with a marker; a failed append keeps rows", async (page) => {
  await search(page, input.prefix);
  assert.equal(await rows(page).count(), PAGE);
  assert.match(await page.locator("#list-status").textContent(), new RegExp(`^${PAGE} loaded · more available$`));
  await page.locator("#artifact-list a[data-action=details]").first().focus();
  const focused = await page.evaluate(() => document.activeElement.dataset.artifactId);
  await toEnd(page); await rowCount(page, 2 * PAGE);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.artifactId), focused, "appending rows keeps keyboard focus");
  await page.evaluate(() => { window.__shell.failNextAppend = true; });
  await toEnd(page);
  const failure = page.getByRole("alert").filter({ hasText: "could not be loaded" });
  await failure.waitFor();
  assert.equal(await rows(page).count(), 2 * PAGE, "a failed append keeps the rows");
  await failure.getByRole("button", { name: "Retry" }).click();
  await rowCount(page, RECORDS);
  assert.equal(await page.locator("#list-status").textContent(), `All ${RECORDS} artifacts loaded`);
  await page.getByText(`End of list · ${RECORDS} artifacts`, { exact: true }).waitFor();
  assert.equal(await rows(page).evaluateAll((nodes) => new Set(nodes.map((node) => node.dataset.artifactId)).size), RECORDS, "no duplicates");
  assert.equal(await page.getByRole("button", { name: /Load more|Result page|Source span/ }).count(), 0);
});

await check("Back from an artifact restores rows, scroll and focus; a view round trip and reload keep the query", async (page) => {
  await search(page, input.prefix);
  await loadAll(page);
  await page.evaluate(() => window.scrollTo(0, 1200));
  const before = await page.evaluate(() => scrollY);
  const target = await page.evaluate(() => [...document.querySelectorAll("#artifact-list > tr")].find((row) => row.getBoundingClientRect().top > 200).dataset.artifactId);
  const calls = await page.evaluate(() => window.__shell.listCalls);
  await page.locator(`#artifact-list a[data-action=details][data-artifact-id="${target}"]`).click();
  await page.waitForFunction((id) => document.querySelector("#detail-list").textContent.includes(id), target);
  await page.goBack();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await rowCount(page, RECORDS);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) <= 2, "scroll position restored");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.artifactId), target, "focus returns to the originating row");
  assert.equal(await page.evaluate(() => window.__shell.listCalls), calls, "Back does not reload the list");
  await page.getByRole("link", { name: "Upload", exact: true }).first().click();
  await page.getByRole("heading", { name: "Upload", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Artifacts" }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await rowCount(page, RECORDS);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) <= 2, "scroll position survives a view round trip");
  assert.equal(await page.evaluate(() => window.__shell.listCalls), calls, "the view round trip does not reload the list");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Sort by Name" }).click();
  await page.waitForFunction(() => /sort:name/.test(new URLSearchParams(location.hash.split("?")[1]).get("query")));
  await counterLoaded(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await counterLoaded(page);
  assert.equal(await page.getByRole("combobox", { name: "Search artifacts" }).inputValue(), "sort:name direction:asc " + input.prefix);
  assert.equal(await page.locator('th:has([data-sort="name"])').getAttribute("aria-sort"), "ascending");
});

await check("delete confirms in an in-app dialog with Cancel focused; Escape cancels", async (page) => {
  await page.addInitScript(() => { window.confirm = () => { throw new Error("window.confirm used"); }; window.alert = () => { throw new Error("window.alert used"); }; });
  await page.reload({ waitUntil: "domcontentloaded" });
  await counterLoaded(page);
  await search(page, input.victimName);
  await rowCount(page, 1);
  const more = page.getByRole("button", { name: "More actions for " + input.victimName });
  await more.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete artifact?" });
  await confirm.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  // Focus moves back to the trigger when the dialog's close event runs.
  await page.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === name, "More actions for " + input.victimName);
  assert.equal(await rows(page).count(), 1, "cancel keeps the artifact");
  await more.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await confirm.getByRole("button", { name: "Delete artifact" }).click();
  await rowCount(page, 0);
  const status = (await page.request.post(input.base + "/api/current", { headers: { Origin: input.base },
    data: { requestId: crypto.randomUUID(), apiVersion: "1.0.0", command: { GetArtifact: { artifactId: input.victim } } } })).status();
  assert.equal(status, 404);
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
