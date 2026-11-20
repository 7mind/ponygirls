// Behavioral blackbox: Browse and its presets (spec §3.2; §8 items 1–5, 7, 11) — the built dashboard (web/dist)
// served by the selected Scala/native server with its own owned database, records seeded through the
// authenticated public API, pinned Chromium. Fault and timing scenarios use page routes and Playwright's clock.
// Runs alone (after `npm run build`):
//   HAYSTACK_SERVER_COMMAND=… HAYSTACK_CHROMIUM=… HAYSTACK_TEST_PG=… HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1 \
//     node --import ../scripts/register-generated.mjs tests-browser/browse.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { prerequisites } from "./prerequisites.mjs";
import { writePasswordHash } from "./credentials.mjs";
import { ownedDatabase, configFor, atomicConfig, startServer, stopServer, publicClient, freePort } from "./native.mjs";

const PAGE = 20;
const TOTAL = 45;
const DESKTOP = { width: 1440, height: 900 };
const SMALL = { width: 1024, height: 700 };
const PHONE = { width: 390, height: 844 };
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await prerequisites("main");

let database; let dir; let backend; let browser;
const cleanup = async () => {
  if (browser) await browser.close();
  await stopServer(backend);
  if (database) await database.close();
  if (dir) await rm(dir, { recursive: true, force: true });
};
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });
let failures = 0;
const results = [];
async function check(name, run) {
  console.log(`# check - ${name}`);
  try {
    await run();
    results.push(name);
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL - ${name}: ${String(error.message).split("\n")[0]}`);
    console.error(error);
  }
}

try {
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-browse-"));
  database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
  const password = randomBytes(32).toString("base64url");
  await writePasswordHash(path.join(dir, "human.password"), password);
  const agentToken = randomBytes(32).toString("base64url");
  await writeFile(path.join(dir, "agent.sha"), createHash("sha256").update(agentToken, "ascii").digest("hex") + "\n");
  const opToken = randomBytes(32).toString("base64url");
  await writeFile(path.join(dir, "op.sha"), createHash("sha256").update(opToken, "ascii").digest("hex") + "\n");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    activityProjectId: "agent-activity",
    users: [
      { id: "op", type: "human", displayName: "Op", enabled: true, login: "op", passwordHashFile: path.join(dir, "human.password"), tokens: [{ id: "seed", hashFile: path.join(dir, "op.sha") }] },
      { id: "agent", type: "agent", displayName: "Agent", tokens: [{ id: "default", hashFile: path.join(dir, "agent.sha") }] },
    ],
    cookieSecure: true, allowedHosts: ["127.0.0.1"], allowedOrigins: [base], insecureHttpOrigins: [base], rateLimit: { windowMs: 60000, max: 6000 },
  };
  const configFile = path.join(dir, "config.json");
  await atomicConfig(configFile, await configFor({ database: database.runtime, port, webRoot: path.join(webRoot, "dist"), auth }));
  backend = await startServer(configFile, port, path.join(dir, "server.log"));
  const seed = publicClient(base, agentToken);
  let requests = 0;
  const rid = () => `0193e8d5-6f5c-7a1b-8c2d-${String(++requests).padStart(12, "0")}`;
  const docOf = (over) => JSON.stringify({ title: "t", description: "d", fields: {}, type: "fact", status: "actual", importance: "low", "human-attention": "cleared", links: [], ...over });
  const put = (key, over, expectedRevision = 0) => seed.put({ key, documentJson: docOf(over), expectedRevision, requestId: rid() });
  // Reverse insertion order: newest-modified first lists "Record 00" first.
  for (let index = TOTAL - 1; index >= 0; index--) await put(`scroll:${String(index).padStart(2, "0")}`, { title: `Record ${String(TOTAL - index - 1).padStart(2, "0")}`, tags: [index % 2 ? "odd" : "even"] });
  await put("ui:note", { title: "hello memory" });
  await put("ui:old", { title: "buried memory", status: "archived" });
  await put("ui:todo", { title: "needs attention", type: "todo", "human-attention": "required" });
  // The one record the signed-in user wrote.
  await publicClient(base, opToken).put({ key: "mine:note", documentJson: docOf({ title: "written by op" }), expectedRevision: 0, requestId: rid() });

  browser = await chromium.launch({ executablePath: process.env.HAYSTACK_CHROMIUM, args: ["--no-sandbox", "--no-proxy-server"] });
  const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
  /** The list shown: lists of other routes stay mounted, hidden. */
  const list = (page) => page.locator("section.browse").filter({ visible: true });
  const query = (page) => list(page).getByRole("combobox", { name: "Query", exact: true });
  const searchButton = (page) => list(page).getByRole("button", { name: "Search", exact: true });
  const rowKeys = (page) => list(page).locator("tbody tr[data-row-id]").evaluateAll((rows) => rows.map((row) => row.dataset.rowId));
  const titles = (page) => list(page).locator("tbody .cell-title").allTextContents();
  const waitRows = (page, count) => page.waitForFunction((n) => [...document.querySelectorAll("section.browse")]
    .some((view) => view.getClientRects().length > 0 && view.getAttribute("aria-busy") === "false" && view.querySelectorAll("tbody tr[data-row-id]").length === n), count);
  const firstTitle = (page, title) => page.waitForFunction((value) => [...document.querySelectorAll("section.browse")]
    .some((view) => view.getClientRects().length > 0 && view.querySelector("tbody .cell-title")?.textContent === value), title);
  const counter = (page) => list(page).locator(".viewbar-meta");
  const toEnd = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  /** Route changes (hashchange) are held while `holdRoutes()` is in effect and delivered by `releaseRoutes()`. */
  const holdableRoutes = () => {
    let holding = false;
    const held = [];
    window.heldRoutes = () => held.length;
    window.holdRoutes = () => { holding = true; };
    window.releaseRoutes = () => { holding = false; for (const deliver of held.splice(0)) deliver(); };
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type !== "hashchange") { add(type, listener, options); return; }
      add(type, (event) => {
        const deliver = () => { if (typeof listener === "function") listener.call(window, event); else if (listener !== null) listener.handleEvent(event); };
        if (holding) held.push(deliver); else deliver();
      }, options);
    };
  };
  /** A signed-in page; native dialogs and page errors are recorded and asserted absent by `done` (spec §8 item 7). */
  async function open({ viewport = DESKTOP, hash = "#/browse", clock = false, routeLive = false, holdRoutes = false } = {}) {
    const context = await browser.newContext({ viewport });
    if (holdRoutes) await context.addInitScript(holdableRoutes);
    await context.addInitScript(() => {
      window.nativeDialogs = [];
      for (const name of ["alert", "confirm", "prompt"]) window[name] = (...args) => { window.nativeDialogs.push([name, ...args]); return null; };
      // Record-list searches as the page sends them (the masthead's Inbox count uses its own page size).
      window.listSearches = [];
      const send = window.fetch.bind(window);
      window.fetch = (resource, init) => {
        if (String(resource).endsWith("/api/v1/search") && JSON.parse(String(init.body)).limit === 20) window.listSearches.push(JSON.parse(String(init.body)).query);
        return send(resource, init);
      };
    });
    const page = await context.newPage();
    if (clock) await page.clock.install();
    /** With `routeLive`, the page's live sockets, passed through to the server. */
    const sockets = [];
    if (routeLive) await page.routeWebSocket("**/api/v1/live", (socket) => { sockets.push(socket); socket.connectToServer(); });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => { errors.push(`native dialog: ${dialog.message()}`); void dialog.dismiss(); });
    await page.goto(`${base}/${hash}`);
    await page.getByLabel("Username", { exact: true }).fill("op");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    const done = async () => {
      assert.deepEqual(errors, [], "no page errors or native dialogs");
      assert.deepEqual(await page.evaluate(() => window.nativeDialogs), [], "window.alert/confirm/prompt are never called");
      await context.close();
    };
    return { context, page, done, sockets };
  }
  const scrollList = `#/browse?${new URLSearchParams({ q: "project:scroll" })}`;

  await check("browse: the document is the only scroller; the view bar and the table header stick under the masthead", async () => {
    for (const viewport of [DESKTOP, SMALL]) {
      const { page, done } = await open({ viewport, hash: scrollList });
      await waitRows(page, PAGE);
      for (const rows of [2 * PAGE, TOTAL]) { await toEnd(page); await waitRows(page, rows); }
      const scrollers = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
      }).map((element) => element.outerHTML.slice(0, 80)));
      assert.deepEqual(scrollers, [], `${viewport.width}: no element scrolls vertically but the document`);
      assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), "the document scrolls");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal document overflow");
      await page.evaluate(() => window.scrollTo(0, 1500));
      const tops = await page.evaluate(() => {
        const view = [...document.querySelectorAll("section.browse")].find((element) => element.getClientRects().length > 0);
        return { masthead: document.querySelector(".masthead").getBoundingClientRect().height, bar: view.querySelector(".viewbar").getBoundingClientRect(),
          header: view.querySelector("thead th").getBoundingClientRect().top, scrollY };
      });
      assert.equal(tops.scrollY, 1500);
      assert.equal(tops.bar.top, tops.masthead, `${viewport.width}: the view bar sticks under the masthead`);
      assert.equal(tops.header, tops.masthead + tops.bar.height, `${viewport.width}: the table header sticks under the view bar`);
      if (viewport === DESKTOP) assert.equal(tops.header, 104, "48 px masthead + 56 px view bar (spec §8 item 2)");
      for (const column of ["Record", "Type", "Tags", "Attention", "Importance", "Modified"]) await list(page).getByRole("columnheader", { name: column }).waitFor();
      const hidden = await list(page).getByRole("columnheader", { name: "Project" }).isVisible();
      assert.equal(hidden, viewport === DESKTOP, "Project is shown at 1440 and hidden at 1024: the table stays a table");
      await done();
    }
  });

  await check("browse: the first connection does not refetch the list it has just loaded", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    await frames(page);
    assert.deepEqual(await page.evaluate(() => window.listSearches), ["project:scroll"], "one search: the first resync does not reload the list (spec §5 rule 6, H-03)");
    await done();
  });

  await check("browse sorts the complete result set from the header, restarts the loaded chain and keeps the sort across a reload", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    assert.equal(await list(page).getByRole("button", { name: "Next", exact: true }).count(), 0);
    assert.equal(await list(page).getByRole("columnheader", { name: "Modified" }).getAttribute("aria-sort"), "descending");
    await toEnd(page);
    await waitRows(page, 2 * PAGE);
    await list(page).getByRole("button", { name: "Sort by Record", exact: true }).focus();
    await page.keyboard.press("Enter");
    await firstTitle(page, "Record 00");
    await waitRows(page, PAGE);
    assert.deepEqual(await titles(page), Array.from({ length: PAGE }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
    assert.equal(await list(page).getByRole("columnheader", { name: "Record" }).getAttribute("aria-sort"), "ascending");
    assert.equal(await list(page).getByRole("columnheader", { name: "Modified" }).getAttribute("aria-sort"), null, "only the sorted column carries aria-sort");
    assert.equal(await page.evaluate(() => window.scrollY), 0, "a new sort starts at the top of its list");
    await toEnd(page);
    await waitRows(page, 2 * PAGE);
    assert.deepEqual(await titles(page), Array.from({ length: 2 * PAGE }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
    await list(page).getByRole("button", { name: "Sort by Record", exact: true }).click();
    await firstTitle(page, "Record 44");
    assert.deepEqual(await titles(page), Array.from({ length: PAGE }, (_, i) => `Record ${String(44 - i).padStart(2, "0")}`));
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("direction"), "desc");
    await page.reload();
    await firstTitle(page, "Record 44");
    assert.equal(await query(page).inputValue(), "project:scroll", "reload restores the query");
    assert.equal(await list(page).getByRole("columnheader", { name: "Record" }).getAttribute("aria-sort"), "descending", "reload restores the sort");
    await done();
  });

  await check("browse loads the document-scrolled list to an explicit end marker, every row once, without pagination controls", async () => {
    const { page, done } = await open({ hash: scrollList });
    const cursors = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/search") && request.postDataJSON().query === "project:scroll" && request.postDataJSON().cursor) cursors.push(request.postDataJSON().cursor);
    });
    await waitRows(page, PAGE);
    await counter(page).getByText(`${PAGE} loaded · more available`, { exact: true }).waitFor();
    assert.equal(await list(page).locator("[data-list-end]").count(), 0);
    await toEnd(page);
    await waitRows(page, 2 * PAGE);
    await toEnd(page);
    await waitRows(page, TOTAL);
    await counter(page).getByText(`All ${TOTAL} records loaded`, { exact: true }).waitFor();
    await list(page).getByText(`End of list · ${TOTAL} records`, { exact: true }).waitFor();
    assert.equal(new Set(await rowKeys(page)).size, TOTAL);
    for (const name of [/Load more/, /^Result page/, /^Source span/, /^Next$/]) assert.equal(await page.getByRole("button", { name }).count(), 0, `no ${name} control`);
    assert.equal(cursors.length, 2);
    assert.equal(new Set(cursors).size, 2);
    await done();
  });

  await check("browse ignores an old in-flight page after sorting", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    let arrived; let release;
    const started = new Promise((resolve) => { arrived = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/v1/search", async (route) => {
      if (route.request().postDataJSON().cursor !== null) { arrived(); await held; }
      await route.continue();
    });
    const stale = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().cursor !== null);
    try {
      await toEnd(page);
      await started;
      await list(page).getByRole("button", { name: "Sort by Record", exact: true }).click();
      await firstTitle(page, "Record 00");
    } finally { release(); }
    await (await stale).finished();
    await frames(page);
    assert.deepEqual(await titles(page), Array.from({ length: PAGE }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
    await done();
  });

  await check("browse keeps the rows when an append fails, pauses loading and retries the same cursor", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    const attempts = [];
    await page.route("**/api/v1/search", async (route) => {
      const cursor = route.request().postDataJSON().cursor;
      if (cursor !== null) {
        attempts.push(cursor);
        if (attempts.length === 1) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "unavailable", message: "injected failure", spans: [], currentRevision: null }) }); return; }
      }
      await route.continue();
    });
    await toEnd(page);
    const alert = list(page).getByRole("alert").filter({ hasText: "The next records could not be loaded." });
    await alert.waitFor();
    assert.match(await alert.textContent(), /Server unreachable.*The 20 records above are kept/);
    assert.equal((await rowKeys(page)).length, PAGE);
    await toEnd(page);
    await frames(page);
    assert.equal(attempts.length, 1, "a failed page is not retried in an observer loop");
    await list(page).getByRole("button", { name: "Retry loading records", exact: true }).click();
    await waitRows(page, 2 * PAGE);
    assert.deepEqual(attempts, [attempts[0], attempts[0]]);
    await done();
  });

  await check("browse route tag changes reset the infinite list", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    await page.goto(`${base}/#/browse?${new URLSearchParams({ q: "project:scroll tag:odd" })}`);
    await page.waitForFunction(() => document.querySelector("section.browse tbody tr")?.dataset.rowId === "scroll:01");
    assert.equal(await query(page).inputValue(), "project:scroll tag:odd");
    assert.ok((await rowKeys(page)).every((key) => Number(key.split(":")[1]) % 2 === 1));
    await done();
  });

  await check("legacy URL filters become the exact visible applied expression", async () => {
    const { page, done } = await open();
    const expression = '(((id:"ui:note" OR project:scroll) project:"scroll") tag:"odd") archived:"all"';
    const result = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === expression);
    await page.goto(`${base}/#/browse?${new URLSearchParams({ q: 'id:"ui:note" OR project:scroll', project: "scroll", tag: "odd", archive: "show" })}`);
    assert.equal((await result).request().postDataJSON().project, null, "there is no hidden project scope");
    await waitRows(page, PAGE);
    assert.equal(await query(page).inputValue(), expression);
    const params = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
    assert.equal(params.get("q"), expression);
    for (const field of ["project", "tag", "archive"]) assert.equal(params.has(field), false);
    assert.ok((await rowKeys(page)).every((key) => key.startsWith("scroll:") && Number(key.split(":")[1]) % 2 === 1), "scope constrains the entire OR body");
    await page.reload();
    await waitRows(page, PAGE);
    assert.equal(await query(page).inputValue(), expression, "canonical URL does not compose the scopes twice");
    const archive = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === "archived:true");
    await nav(page).getByRole("link", { name: "Archive", exact: true }).click();
    assert.equal((await archive).request().postDataJSON().project, null);
    await list(page).getByRole("button", { name: "ui:old", exact: true }).waitFor();
    assert.equal(await query(page).inputValue(), "archived:true", "navigation presets also use the expression");
    assert.equal(await list(page).getByRole("button", { name: "Archived", exact: true }).getAttribute("aria-pressed"), "true", "the Archived shortcut reflects the preset expression");
    await done();
  });

  await check("unsafe legacy URL filters show a migration error without searching", async () => {
    const { page, done } = await open();
    const searches = [];
    page.on("request", (request) => { if (request.url().endsWith("/api/v1/search")) searches.push(request.postDataJSON()); });
    for (const draft of ['tag:"unfinished', "type:fact OR", "(type:fact", 'link:["depends-on","p:i"', 'link:["depends-on",]', 'link:["depends-on"]', 'field["/n"]', 'field["/n"] >=']) {
      const hash = `#/browse?${new URLSearchParams({ q: draft, project: "scroll", archive: "show" })}`;
      await page.goto(`${base}/${hash}`);
      await page.waitForFunction((value) => document.querySelector('section.browse input[role="combobox"]')?.value === value, draft);
      await list(page).getByRole("alert").filter({ hasText: "Cannot safely migrate legacy URL filters" }).waitFor();
      assert.equal(await searchButton(page).isDisabled(), true);
      assert.equal(await list(page).locator("tbody tr[data-row-id]").count(), 0, "previous rows cannot masquerade as unscoped results");
      assert.equal(new URL(page.url()).hash, hash, "failed migration retains the recoverable original URL");
      assert.equal(searches.length, 0);
    }
    await nav(page).getByRole("link", { name: "Browse", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#/browse");
    await page.waitForFunction(() => [...document.querySelectorAll('section.browse input[role="combobox"]')].some((input) => input.getClientRects().length > 0 && input.value === ""));
    assert.equal(await searchButton(page).isEnabled(), true);
    await done();
  });

  await check("browse: Back from a record restores three loaded batches, the document scroll and the row focus", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    for (const rows of [2 * PAGE, TOTAL]) { await toEnd(page); await waitRows(page, rows); }
    await page.evaluate(() => window.scrollTo(0, 900));
    const opener = list(page).getByRole("button", { name: "scroll:20", exact: true });
    await opener.evaluate((element) => element.focus({ preventScroll: true }));
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash.startsWith("#/item/"));
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    await page.goBack();
    await waitRows(page, TOTAL);
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrolled) <= 2, "the document scroll is restored");
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true, "focus returns to the originating row");
    await done();
  });

  await check("browse: a live change while scrolled shows the pill, keeps rows and scroll until Show merges it in place, keeping the row being read", async () => {
    const { page, done } = await open({ hash: scrollList });
    await waitRows(page, PAGE);
    await toEnd(page);
    await waitRows(page, 2 * PAGE);
    await page.evaluate(() => window.scrollTo(0, 700));
    const before = await page.evaluate(() => window.scrollY);
    // The first row fully or partly visible below the sticky table header (the header cells stick, not <thead>).
    const firstVisible = () => page.evaluate(() => {
      const view = [...document.querySelectorAll("section.browse")].find((element) => element.getClientRects().length > 0);
      const boundary = view.querySelector("thead th").getBoundingClientRect().bottom;
      const row = [...view.querySelectorAll("tbody tr[data-row-id]")].find((candidate) => candidate.getBoundingClientRect().bottom > boundary);
      return { key: row.dataset.rowId, top: row.getBoundingClientRect().top };
    });
    // The list's own anchor is under test: Chromium's native scroll anchoring would otherwise mask it (browsers
    // without it rely on the list's anchor alone).
    await page.evaluate(() => document.documentElement.style.setProperty("overflow-anchor", "none"));
    // Archiving the fifth row removes a row above the viewport; the first table row stays.
    const removed = "scroll:04";
    await put(removed, { title: "Record 40", tags: ["even"], status: "archived" }, 1);
    const pill = list(page).getByRole("button", { name: "Records changed · Show", exact: true });
    await pill.waitFor();
    await frames(page);
    assert.equal((await rowKeys(page)).length, 2 * PAGE, "rows are kept until the reader applies the change");
    assert.equal(await page.evaluate(() => window.scrollY), before, "the scroll position is kept");
    const anchor = await firstVisible();
    const firstRow = (await rowKeys(page))[0];
    const shown = await rowKeys(page);
    assert.ok(shown.indexOf(removed) > 0 && shown.indexOf(removed) < shown.indexOf(anchor.key), `the removed row lies between the first row and the row being read (${anchor.key})`);
    await pill.click();
    await page.waitForFunction((key) => document.querySelector(`section.browse tbody tr[data-row-id="${key}"]`) === null, removed);
    await frames(page);
    assert.equal(await pill.count(), 0);
    assert.equal((await rowKeys(page))[0], firstRow, "the first table row is unchanged");
    assert.equal((await rowKeys(page)).length, 2 * PAGE, "Show reloads the loaded chain in place");
    const after = await page.evaluate((key) => document.querySelector(`section.browse tbody tr[data-row-id="${key}"]`).getBoundingClientRect().top, anchor.key);
    assert.ok(Math.abs(after - anchor.top) <= 2, `the row being read keeps its place: ${anchor.top} → ${after}`);
    await done();
  });

  await check("one expression, filter shortcuts, clear, keyboard focus and explicit Search keep the draft separate", async () => {
    const { page, done } = await open();
    const searches = [];
    // Record-list searches only: the masthead's Inbox count is a search of its own.
    page.on("request", (request) => { if (request.url().endsWith("/api/v1/search") && request.postDataJSON().limit === PAGE) searches.push(request.postDataJSON().query); });
    const input = query(page);
    await input.fill("type:todo OR type:fact");
    for (const role of ["radio", "checkbox"]) assert.equal(await page.getByRole(role).count(), 0);
    assert.equal(await page.getByRole("combobox").count(), 1);
    assert.equal(await list(page).locator("select").count(), 0);
    await list(page).getByRole("status").filter({ hasText: "Draft · press Enter to apply" }).waitFor();
    const review = list(page).getByRole("button", { name: "Needs review", exact: true });
    assert.equal(await review.getAttribute("aria-pressed"), "false");
    await review.click();
    assert.equal(await input.inputValue(), "(type:todo OR type:fact) human-attention:required", "a shortcut conjoins its term with the whole draft");
    assert.equal(await review.getAttribute("aria-pressed"), "true");
    assert.equal(await input.evaluate((element) => element === document.activeElement), true, "focus returns to the query");
    await review.click();
    assert.equal(await input.inputValue(), "(type:todo OR type:fact)");
    await list(page).getByRole("button", { name: "Add tag filter", exact: true }).click();
    assert.equal(await input.inputValue(), "(type:todo OR type:fact) tag:");
    assert.equal(await input.evaluate((element) => element === document.activeElement && element.selectionStart === element.value.length), true);
    await list(page).getByRole("listbox", { name: "Query suggestions" }).getByRole("option").first().waitFor();
    await input.fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await input.press("Escape");
    assert.equal(await input.inputValue(), "ty");
    await input.press("Escape");
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.evaluate((element) => element === document.activeElement && element.selectionStart === 0), true);
    await input.fill("type:todo");
    await list(page).getByRole("button", { name: "Clear search expression" }).click();
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Control+k");
    assert.equal(await input.evaluate((element) => element === document.activeElement && element.selectionStart === 0), true);
    assert.deepEqual(searches.filter((value) => value !== ""), [], "edits never search before an explicit submit");
    const syntax = list(page).getByRole("button", { name: "Query syntax", exact: true });
    await syntax.click();
    const dialog = page.getByRole("dialog", { name: "Query syntax" });
    await dialog.getByText("human-attention:required", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await syntax.evaluate((element) => element === document.activeElement), true, "focus returns to the trigger");
    const expression = "  type:todo  ";
    await input.fill(expression);
    const applied = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === expression);
    await searchButton(page).click();
    assert.equal((await applied).request().postDataJSON().project, null, "no invisible project constraint is sent");
    assert.equal(await input.inputValue(), expression, "the applied query is exactly the visible text, including whitespace");
    await list(page).getByRole("button", { name: "ui:todo", exact: true }).waitFor();
    assert.equal(await list(page).getByText("Draft · press Enter to apply").count(), 0);
    await done();
  });

  await check("Modified by me conjoins the signed-in user's modified-by term: the list shows only that user's records", async () => {
    const { page, done } = await open();
    const input = query(page);
    const mine = list(page).getByRole("button", { name: "Modified by me", exact: true });
    assert.equal(await mine.getAttribute("title"), "modified-by:op");
    assert.equal(await mine.getAttribute("aria-pressed"), "false");
    await input.fill("memory OR op");
    await mine.click();
    assert.equal(await input.inputValue(), "(memory OR op) modified-by:op");
    assert.equal(await mine.getAttribute("aria-pressed"), "true");
    await searchButton(page).click();
    await counter(page).getByText("All 1 record loaded", { exact: true }).waitFor();
    assert.deepEqual(await rowKeys(page), ["mine:note"]);
    await mine.click();
    assert.equal(await input.inputValue(), "(memory OR op)");
    assert.equal(await mine.getAttribute("aria-pressed"), "false");
    await done();
  });

  await check("Upstream and Skill drafts name the activity namespace their records are written to; other lists do not", async () => {
    const { page, done } = await open();
    const chip = list(page).getByText("namespace agent-activity", { exact: true });
    assert.equal(await chip.count(), 0, "Browse names no namespace");
    for (const name of ["Upstream", "Skill drafts"]) {
      await nav(page).getByRole("link", { name, exact: true }).click();
      await list(page).getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(await chip.getAttribute("title"), "Upstream activity and skill drafts are written to this project", name);
    }
    await nav(page).getByRole("link", { name: "Inbox", exact: true }).click();
    await list(page).getByRole("heading", { name: "Inbox", exact: true }).waitFor();
    assert.equal(await chip.count(), 0, "Inbox names no namespace");
    await done();
  });

  await check("query typing retains focus", async () => {
    const { page, done } = await open();
    await query(page).pressSequentially("hello", { delay: 100 });
    assert.equal(await query(page).inputValue(), "hello");
    assert.equal(await query(page).evaluate((element) => element === document.activeElement), true);
    await done();
  });

  await check("delayed search navigation preserves a newer query draft", async () => {
    const context = await browser.newContext();
    await context.addInitScript(holdableRoutes);
    const page = await context.newPage();
    try {
      await page.goto(`${base}/#/browse`);
      await page.getByLabel("Username", { exact: true }).fill("op");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
      await query(page).fill("hello");
      await page.evaluate(() => window.holdRoutes());
      await searchButton(page).click();
      await page.waitForFunction(() => window.heldRoutes() > 0);
      // The submitted route reaches the list only after the newer draft exists.
      await query(page).fill("bogus:1");
      await page.evaluate(() => window.releaseRoutes());
      await counter(page).getByText("All 1 record loaded", { exact: true }).waitFor();
      assert.deepEqual(await rowKeys(page), ["ui:note"], "the submitted route was applied");
      assert.equal(await query(page).inputValue(), "bogus:1", "the submitted route must not overwrite a newer query draft");
    } finally { await context.close(); }
  });

  await check("a submission still being checked is dropped when the reader opens a record meanwhile", async () => {
    const { page, done } = await open();
    let arrived; let release;
    const seen = new Promise((resolve) => { arrived = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/v1/query/analyze", async (route) => { arrived(); await held; await route.continue(); });
    await list(page).getByRole("button", { name: "ui:note", exact: true }).waitFor();
    await query(page).fill("hello");
    await searchButton(page).click();
    await seen;
    await list(page).getByRole("button", { name: "ui:note", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
    const checked = page.waitForResponse((response) => response.url().endsWith("/api/v1/query/analyze"));
    release();
    await (await checked).finished();
    await frames(page);
    assert.ok(new URL(page.url()).hash.startsWith("#/item/"), "the record stays open");
    await done();
  });

  await check("query completion supports keyboard, caret insertion, and pointer selection", async () => {
    const { page, done } = await open();
    const input = query(page);
    await input.fill("type:f");
    await page.getByRole("option", { name: "type:fact", exact: true }).waitFor();
    await input.press("Enter");
    assert.equal(await input.inputValue(), "type:fact ");
    await input.pressSequentially("status:actual");
    assert.equal(await input.inputValue(), "type:fact status:actual", "a completed value separates the next term");
    assert.equal(new URL(page.url()).hash, "#/browse", "accepting a completion must not submit the query");
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await input.fill("type:");
    await page.getByRole("option", { name: "type:fact", exact: true }).waitFor();
    const options = page.getByRole("option");
    assert.ok(await options.count() > 1);
    const second = await options.nth(1).textContent();
    assert.match(second, /^type:.+/);
    const secondId = await options.nth(1).getAttribute("id");
    await input.press("ArrowDown");
    assert.equal(await input.getAttribute("aria-activedescendant"), secondId);
    await input.press("ArrowUp");
    assert.equal(await input.getAttribute("aria-activedescendant"), await options.nth(0).getAttribute("id"));
    await input.press("ArrowDown");
    await input.press("Enter");
    assert.equal(await input.inputValue(), `${second} `);
    await input.fill("(ty) AND importance:high");
    await input.evaluate((element) => element.setSelectionRange(3, 3));
    await input.press("Control+Space");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await input.press("Enter");
    assert.equal(await input.inputValue(), "(type:) AND importance:high");
    assert.equal(await input.evaluate((element) => element.selectionStart), 6);
    await input.fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await input.press("Tab");
    assert.equal(await input.inputValue(), "ty", "Tab must not accept a suggestion");
    assert.equal(await list(page).getByRole("button", { name: "Clear search expression" }).evaluate((element) => element === document.activeElement), true);
    await input.fill("status:actual AND ui:no");
    await page.getByRole("option", { name: 'id:"ui:note"', exact: true }).click();
    assert.equal(await input.inputValue(), 'status:actual AND id:"ui:note" ');
    assert.equal(await input.evaluate((element) => element === document.activeElement), true);
    await input.fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await input.press("Escape");
    await input.press("Control+Space");
    await page.getByRole("listbox", { name: "Query suggestions" }).waitFor();
    await input.press("Escape");
    assert.equal(await page.getByRole("listbox", { name: "Query suggestions" }).count(), 0);
    await done();
  });

  await check("accepted field prefixes immediately offer value hints", async () => {
    const { page, done } = await open();
    const input = query(page);
    await input.fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await input.press("Enter");
    await page.getByRole("option", { name: "type:fact", exact: true }).waitFor();
    assert.equal(await input.inputValue(), "type:");
    assert.equal(await input.evaluate((element) => element.selectionStart), 5);
    await done();
  });

  await check("query completion coalesces in-flight requests and replaces a mid-token suffix", async () => {
    const { page, done } = await open({ clock: true });
    await page.evaluate(() => {
      window.completionFragments = [];
      const original = window.fetch.bind(window);
      window.fetch = (resource, init) => {
        if (String(resource).endsWith("/api/v1/complete")) window.completionFragments.push(JSON.parse(String(init.body)).query);
        return original(resource, init);
      };
    });
    const fragments = () => page.evaluate(() => window.completionFragments);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let first;
    const firstSeen = new Promise((resolve) => { first = resolve; });
    let served = 0;
    await page.route("**/api/v1/complete", async (route) => {
      if (++served === 1) { first(); await held; await route.fulfill({ json: { suggestions: ["type:"] } }); }
      else await route.continue();
    });
    try {
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
      const input = query(page);
      await input.fill("ty");
      await page.clock.runFor(250);
      await firstSeen;
      await input.fill("type:todo");
      await input.fill("typEXTRA");
      await input.evaluate((element) => element.setSelectionRange(2, 2));
      await input.press("Control+Space");
      await page.clock.runFor(250);
      assert.deepEqual(await fragments(), ["ty"], "only one hint request may be in flight");
    } finally { release(); }
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await query(page).press("Enter");
    assert.equal(await query(page).inputValue(), "type:");
    assert.equal(await query(page).evaluate((element) => element.selectionStart), 5);
    assert.deepEqual(await fragments(), ["ty", "ty"], "only the latest desired caret/text is requested");
    await done();
  });

  await check("dismissed query completions do not reopen after a delayed response", async () => {
    const { page, done } = await open();
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    await page.route("**/api/v1/complete", (route) => resolveRequest(route));
    const input = query(page);
    await input.fill("ty");
    const route = await pending;
    await input.press("Escape");
    const response = page.waitForResponse((value) => value.url().endsWith("/api/v1/complete"));
    await route.fulfill({ json: { suggestions: ["type:"] } });
    await (await response).finished();
    await frames(page);
    assert.equal(await page.getByRole("listbox", { name: "Query suggestions" }).count(), 0);
    assert.equal(await input.inputValue(), "ty");
    await done();
  });

  await check("search + diagnostics + archive, and presets are routes with their own expressions", async () => {
    const { page, done } = await open();
    const input = query(page);
    await input.fill("hello");
    await searchButton(page).click();
    await counter(page).getByText("All 1 record loaded", { exact: true }).waitFor();
    const applied = new URL(page.url()).hash;
    await input.fill("bogus:1");
    await searchButton(page).click();
    await list(page).getByRole("list", { name: "Search errors" }).waitFor();
    await list(page).getByRole("alert").filter({ hasText: "Invalid search query." }).waitFor();
    await counter(page).getByText("Query not applied · 1 loaded", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, applied, "an invalid query is not applied");
    assert.deepEqual(await rowKeys(page), ["ui:note"], "the list keeps the applied query's rows");
    await input.fill("buried");
    await searchButton(page).click();
    await list(page).getByRole("heading", { name: "No matching records", exact: true }).waitFor();
    await list(page).getByRole("button", { name: "Include archived", exact: true }).click();
    await list(page).getByRole("button", { name: "ui:old", exact: true }).waitFor();
    assert.equal(await input.inputValue(), '(buried) archived:"all"');
    await nav(page).getByRole("link", { name: "Inbox", exact: true }).click();
    await list(page).getByRole("button", { name: "ui:todo", exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/inbox");
    assert.equal(await input.inputValue(), "human-attention:required");
    assert.equal(await list(page).getByRole("button", { name: "Needs review", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await list(page).getByRole("heading", { name: "Inbox", exact: true }).count(), 1, "the list is named by its preset");
    await done();
  });

  await check("inaccessible server keeps the list, reports a connection failure and opens the connection details", async () => {
    const { page, done } = await open();
    await list(page).getByRole("button", { name: "ui:note", exact: true }).waitFor();
    await page.route("**/api/**", (route) => route.abort());
    await query(page).fill("hello");
    await searchButton(page).click();
    const failure = list(page).getByRole("alert").filter({ hasText: "Server unreachable" });
    await failure.waitFor();
    await failure.getByRole("button", { name: "Retry", exact: true }).waitFor();
    await failure.getByRole("button", { name: "Connection details", exact: true }).click();
    await page.getByRole("region", { name: "Connection details", exact: true }).waitFor();
    const indicator = page.getByRole("button", { name: "Connection: Live", exact: true });
    assert.equal(await indicator.getAttribute("aria-expanded"), "true");
    assert.equal(await indicator.evaluate((element) => element === document.activeElement), true, "focus moves to the indicator that owns the details");
    await page.keyboard.press("Escape");
    await page.getByRole("region", { name: "Connection details", exact: true }).waitFor({ state: "detached" });
    await done();
  });

  await check("an offline connection keeps the rows under one inline warning, whose Reconnect now goes live again", async () => {
    const { page, done, sockets } = await open({ hash: scrollList, routeLive: true });
    await waitRows(page, PAGE);
    const warning = list(page).getByRole("status").filter({ hasText: "Offline — showing the last loaded data." });
    assert.equal(await warning.count(), 0, "a live connection shows no warning");
    await sockets.at(-1).close({ code: 1007, reason: "Injected invalid payload" });
    await page.getByRole("button", { name: "Connection: Offline", exact: true }).waitFor();
    await warning.waitFor();
    assert.equal((await rowKeys(page)).length, PAGE, "the rows stay");
    await warning.getByRole("button", { name: "Reconnect now", exact: true }).click();
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await warning.waitFor({ state: "detached" });
    await done();
  });

  await check("browse: Search with the applied query searches it again, also at the address without a fragment, and says when nothing changed (also at 390 px, transiently); a sort back to it before the previous sort is shown is applied", async () => {
    // The address the dashboard is opened at, and stays at after sign-in, has no fragment; it shows Browse.
    const { page, done } = await open({ hash: "", holdRoutes: true });
    await waitRows(page, PAGE);
    // A scrolled list announces a live change instead of applying it: only the Search can show the new record.
    await page.evaluate(() => window.scrollTo(0, 300));
    const title = "Written after the list was loaded";
    await put("refresh:probe", { title });
    await list(page).getByRole("button", { name: "Records changed · Show", exact: true }).waitFor();
    await searchButton(page).click();
    await firstTitle(page, title);
    await waitRows(page, PAGE);
    const searches = await page.evaluate(() => window.listSearches.length);
    await searchButton(page).click();
    const confirmation = list(page).getByRole("status").filter({ hasText: "No changes" });
    await confirmation.waitFor();
    assert.equal(await page.evaluate(() => window.listSearches.length), searches + 1, "the unchanged list was searched again");
    assert.equal((await titles(page))[0], title);
    // The toast is transient: a record and Back return to the retained list, not loaded again, without it.
    const kept = await rowKeys(page);
    const loads = await page.evaluate(() => window.listSearches.length);
    await list(page).getByRole("button", { name: "refresh:probe", exact: true }).click();
    await page.getByRole("button", { name: "Back to Browse", exact: true }).waitFor();
    await page.goBack();
    await waitRows(page, PAGE);
    assert.equal(await confirmation.count(), 0, "no stale toast after the round trip");
    assert.deepEqual(await rowKeys(page), kept, "the retained rows are intact");
    assert.equal(await page.evaluate(() => window.listSearches.length), loads, "the retained list was not loaded again");
    // Phones hide the counter: the confirmation is visible there too, inside the viewport, and the toolbar fits.
    await page.setViewportSize(PHONE);
    await searchButton(page).click();
    await confirmation.waitFor();
    for (const part of [confirmation.getByText("No changes", { exact: true }), confirmation.getByRole("button", { name: "Dismiss", exact: true })]) {
      const box = await part.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= PHONE.width && box.y + box.height <= PHONE.height, `${await part.textContent()} is inside the 390 px viewport`);
    }
    assert.equal(await list(page).getByRole("search", { name: "Search records" }).evaluate((bar) => bar.scrollWidth <= bar.clientWidth), true, "the toolbar does not overflow");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal document overflow");
    await confirmation.getByRole("button", { name: "Dismiss", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    // A sort back to the route shown before the previous sort's route is shown (a busy page delivers it late).
    await page.evaluate(() => window.holdRoutes());
    await list(page).getByRole("button", { name: "Sort by Record", exact: true }).click();
    await page.waitForFunction(() => window.heldRoutes() > 0);
    await list(page).getByRole("button", { name: "Sort by Modified", exact: true }).click();
    await page.evaluate(() => window.releaseRoutes());
    await page.waitForFunction(() => location.hash === "#/browse");
    await waitRows(page, PAGE);
    assert.equal(await list(page).getByRole("columnheader", { name: "Modified" }).getAttribute("aria-sort"), "descending", "the last sort is applied");
    assert.equal((await titles(page))[0], title);
    // That search found nothing new either; a newer live change ends its toast, which never stands next to the pill.
    await confirmation.waitFor();
    await page.evaluate(() => window.scrollTo(0, 300));
    await put("refresh:later", { title: "Written after the toast" });
    await list(page).getByRole("button", { name: "Records changed · Show", exact: true }).waitFor();
    assert.equal(await confirmation.count(), 0, "the toast ends when a newer change is announced");
    await done();
  });
} finally { await cleanup(); }
console.log(`# ${results.length} checks; ${failures} failures; 0 skipped`);
process.exit(failures === 0 ? 0 : 1);
