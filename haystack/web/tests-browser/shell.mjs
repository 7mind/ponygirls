// Behavioral blackbox: the built dashboard (web/dist) in pinned Chromium against a controlled API
// (page routes and a routed live socket), not a backend. Shell of spec §3.2/§5/§8: preset and record routes,
// state-preserving Back, masthead at three widths, live changes, the account outlet in the degraded mode
// of today's servers (five account endpoints) and module-owned sign-out; no native dialogs anywhere.
// Runs alone: HAYSTACK_CHROMIUM=/abs/chrome node tests-browser/shell.mjs (after `npm run build`).
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const executablePath = process.env.HAYSTACK_CHROMIUM;
assert.ok(typeof executablePath === "string" && executablePath.startsWith("/"), "HAYSTACK_CHROMIUM must name the pinned browser executable");
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };
const USER = "op";
const PAGE = 20;
const PRESET_QUERIES = { Browse: "", Inbox: "human-attention:required", Upstream: "type:github-issue OR type:github-pr", "Skill drafts": "type:skill-draft", Archive: "archived:true" };
const PRESET_PATHS = { Browse: "browse", Inbox: "inbox", Upstream: "upstream", "Skill drafts": "skills", Archive: "archive" };
const WIDTHS = [1440, 1024, 390];
const HEIGHT = 900;

const summary = (key, title, extra) => ({ key, project: key.split(":")[0], item: key.split(":")[1], revision: 1, title, docType: "fact", status: "actual", importance: "low",
  humanAttention: "cleared", tags: [], modifiedAt: "2026-11-17T21:00:00.000Z", modifiedBy: "agent", ...extra });
function corpus() {
  const records = Array.from({ length: 70 }, (_, i) => summary(`notes:record-${String(i).padStart(2, "0")}`, `Record ${String(i).padStart(2, "0")}`, {}));
  return {
    "": records,
    "human-attention:required": Array.from({ length: 25 }, (_, i) => summary(`todo:review-${String(i).padStart(2, "0")}`, `Review ${i}`, { docType: "todo", humanAttention: "required" })),
    "type:github-issue OR type:github-pr": [summary("upstream:issue-1", "Upstream issue", { docType: "github-issue" })],
    "type:skill-draft": [summary("skills:draft-1", "Skill draft", { docType: "skill-draft" })],
    "archived:true": [summary("notes:old", "Archived note", { status: "archived" })],
  };
}

const server = http.createServer(async (request, response) => {
  const name = new URL(request.url, "http://fixture.invalid").pathname.slice(1) || "index.html";
  const file = path.resolve(dist, name);
  if (!file.startsWith(dist)) { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

/** One signed-in browser context with the controlled API; `searches` records every search body. */
async function open(browser, { width, colorScheme }) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHT }, colorScheme });
  const state = { signedIn: true, data: corpus(), searches: [], logouts: 0, dialogs: [], sockets: [] };
  await context.addInitScript(() => {
    window.nativeDialogs = [];
    for (const name of ["alert", "confirm", "prompt"]) window[name] = (...args) => { window.nativeDialogs.push([name, ...args]); return null; };
  });
  const json = (route, status, value) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(value) });
  const notFound = (route) => json(route, 404, { error: { code: "not-found", message: "not-found" } });
  await context.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (url.pathname === "/api/account/v1/logout") { state.logouts++; state.signedIn = false; await json(route, 200, { ok: true }); return; }
    if (!state.signedIn) { await json(route, 401, { code: "unauthorized", message: "unauthorized", spans: [], currentRevision: null }); return; }
    const user = { id: USER, login: USER, displayName: "Operator", actor: "actor-op" };
    switch (url.pathname) {
      case "/api/v1/whoami": await json(route, 200, { userId: USER, userType: "human", tokenId: "browser", activityProjectId: "corporate-activity" }); return;
      case "/api/v1/search": {
        state.searches.push(body);
        const rows = body.query.startsWith("linked-to:") ? [] : state.data[body.query] ?? [];
        const start = body.cursor === null ? 0 : Number(body.cursor);
        const end = start + body.limit;
        await json(route, 200, { items: rows.slice(start, end), cursor: end < rows.length ? String(end) : null });
        return;
      }
      case "/api/v1/get": await json(route, 200, { key: body.key, revision: 1, document: { json: JSON.stringify({ title: `Title of ${body.key}`, description: "d", fields: {}, type: "fact", status: "actual", importance: "low", "human-attention": "cleared", links: [], tags: [] }) },
        metadata: { createdAt: "2026-11-17T21:00:00.000Z", createdBy: "agent", modifiedAt: "2026-11-17T21:00:00.000Z", modifiedBy: "agent" } }); return;
      case "/api/v1/history": await json(route, 200, { revisions: [{ revision: 1, modifiedAt: "2026-11-17T21:00:00.000Z", modifiedBy: "agent", tokenId: "default" }] }); return;
      case "/api/v1/complete": await json(route, 200, { suggestions: [] }); return;
      case "/api/v1/query/analyze": await json(route, 200, { valid: true, spans: [] }); return;
      case "/api/account/v1": await json(route, 200, { user, tokens: [], scopes: ["api"] }); return;
      default: await notFound(route);
    }
  });
  await context.routeWebSocket(/\/api\/v1\/live$/, (socket) => {
    state.sockets.push(socket);
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.kind === "ping") socket.send(JSON.stringify({ kind: "pong", key: null, revision: null, nonce: frame.nonce, clientTs: frame.clientTs, serverTs: Date.now() }));
    });
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => { state.dialogs.push(dialog.message()); void dialog.dismiss(); });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  state.noNativeDialogs = async () => {
    assert.deepEqual(state.dialogs, [], "no native dialog opens");
    assert.deepEqual(await page.evaluate(() => window.nativeDialogs), [], "window.alert/confirm/prompt are never called");
    assert.deepEqual(errors, [], "no page errors");
  };
  return { context, page, state };
}

const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
const records = (page) => page.getByRole("region", { name: "Record results" });
const rowCount = (page) => page.getByRole("region", { name: "Record results" }).getByRole("row").count().then((rows) => rows - 1);
// Rows of the shown list only: lists kept for other routes stay mounted, hidden.
const waitRows = (page, rows) => page.waitForFunction((n) => [...document.querySelectorAll('[aria-label="Record results"]')]
  .some((region) => region.getClientRects().length > 0 && region.querySelectorAll("tbody tr").length === n), rows);
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const current = (page) => nav(page).locator('[aria-current="page"]').allTextContents();
async function signIn(page, hash) {
  await page.goto(`${base}/${hash}`);
  await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
}
async function loadBatches(page, batches) {
  for (let batch = 1; batch < batches; batch++) {
    await records(page).evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await waitRows(page, PAGE * (batch + 1));
  }
}

let browser;
const results = [];
async function check(name, run) {
  await run();
  results.push(name);
  console.log(`ok - ${name}`);
}
try {
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

  await check("shell: the five presets and records are routes; Back to a preset or from a record restores its query draft, loaded rows, scroll and focus", async () => {
    const { context, page, state } = await open(browser, { width: 1440, colorScheme: "light" });
    try {
      await signIn(page, "#/browse?q=start");
      for (const [label, query] of Object.entries(PRESET_QUERIES)) {
        const searched = page.waitForRequest((request) => request.url().endsWith("/api/v1/search") && request.postDataJSON().query === query && request.postDataJSON().limit === PAGE);
        await nav(page).getByRole("link", { name: label, exact: true }).click();
        await searched;
        assert.equal(new URL(page.url()).hash, `#/${PRESET_PATHS[label]}`);
        assert.deepEqual(await current(page), [label === "Inbox" ? "Inbox25" : label], `${label} is the only current entry`);
      }
      // Inbox: open a record from the third batch; the record keeps Inbox current; Back restores rows, scroll and focus.
      await nav(page).getByRole("link", { name: "Inbox", exact: true }).click();
      await waitRows(page, PAGE);
      assert.equal(await nav(page).getByRole("link", { name: "Inbox", exact: true }).getAttribute("aria-describedby") !== null, true, "the inbox count is described");
      await page.goto(`${base}/#/browse`);
      await waitRows(page, PAGE);
      await loadBatches(page, 3);
      await records(page).evaluate((element) => { element.scrollTop = 700; });
      await page.evaluate(() => window.scrollTo(0, 120));
      const opener = page.getByRole("button", { name: "notes:record-45", exact: true });
      await opener.focus();
      const listSearches = () => state.searches.filter((search) => search.query === "").length;
      const before = { searches: listSearches(), rows: await rowCount(page), panel: await records(page).evaluate((element) => element.scrollTop), page: await page.evaluate(() => window.scrollY) };
      assert.ok(before.page > 0 && before.panel > 0, "the list is scrolled before opening a record");
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Title of notes:record-45", exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/item/notes%3Arecord-45");
      assert.deepEqual(await current(page), ["Browse"], "the record keeps its originating entry current");
      assert.equal(await page.evaluate(() => window.scrollY), 0, "a record opens at its top");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await waitRows(page, before.rows);
      assert.equal(new URL(page.url()).hash, "#/browse");
      const panelAfter = await records(page).evaluate((element) => element.scrollTop);
      assert.ok(Math.abs(panelAfter - before.panel) <= 2, `list scroll is restored: ${before.panel} → ${panelAfter}`);
      const pageAfter = await page.evaluate(() => window.scrollY);
      assert.ok(Math.abs(pageAfter - before.page) <= 2, `page scroll is restored: ${before.page} → ${pageAfter}`);
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true, "focus returns to the originating row");
      assert.equal(listSearches(), before.searches, "Back does not reload the list");
      // Preset round trip: an unsubmitted query draft, three batches and the scroll survive Inbox and browser Back.
      const query = page.getByRole("combobox", { name: "Query", exact: true });
      await query.fill("draft not submitted");
      await records(page).evaluate((element) => { element.scrollTop = 800; });
      await page.evaluate(() => window.scrollTo(0, 100));
      const left = { panel: await records(page).evaluate((element) => element.scrollTop), page: await page.evaluate(() => window.scrollY) };
      await nav(page).getByRole("link", { name: "Inbox", exact: true }).click();
      await page.getByRole("button", { name: "todo:review-00", exact: true }).waitFor();
      await page.goBack();
      await waitRows(page, before.rows);
      assert.equal(new URL(page.url()).hash, "#/browse");
      assert.equal(await query.inputValue(), "draft not submitted", "the query draft is kept");
      assert.ok(Math.abs(await records(page).evaluate((element) => element.scrollTop) - left.panel) <= 2, "list scroll is kept across presets");
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - left.page) <= 2, "page scroll is kept across presets");
      // Focus in the list (an address change keeps it there) returns with the list.
      const row = page.getByRole("button", { name: "notes:record-30", exact: true });
      await row.focus();
      await page.evaluate(() => { location.hash = "#/upstream"; });
      await page.getByRole("button", { name: "upstream:issue-1", exact: true }).waitFor();
      await page.goBack();
      await waitRows(page, before.rows);
      assert.equal(await row.evaluate((element) => element === document.activeElement), true, "focus returns to the row it left");
      assert.equal(listSearches(), before.searches, "the round trips do not reload the list");
      // Edit is a route: Cancel returns to the record, Back from the record to the list; a reload keeps the editor.
      await page.getByRole("button", { name: "notes:record-03", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Title", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/item/notes%3Arecord-03/edit");
      await page.reload();
      await page.getByLabel("Title", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/item/notes%3Arecord-03");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#/browse");
      await waitRows(page, PAGE); // the reload above started a new document: the list loads afresh
      // Browser Back and Forward between a preset and a record.
      await nav(page).getByRole("link", { name: "Skill drafts", exact: true }).click();
      await page.getByRole("button", { name: "skills:draft-1", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      assert.deepEqual(await current(page), ["Skill drafts"]);
      await page.goBack();
      await page.getByRole("button", { name: "skills:draft-1", exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/skills");
      await page.goForward();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      assert.deepEqual(await current(page), ["Skill drafts"]);
      await state.noNativeDialogs();
    } finally { await context.close(); }
  });

  await check("shell: masthead fits 1440, 1024 and 390 pixels in light and dark; menus and popover close with Escape", async () => {
    for (const width of WIDTHS) for (const colorScheme of ["light", "dark"]) {
      const { context, page, state } = await open(browser, { width, colorScheme });
      try {
        await signIn(page, "#/browse");
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), colorScheme);
        const banner = page.getByRole("banner");
        const height = await page.evaluate(() => {
          const probe = document.body.appendChild(document.createElement("div"));
          probe.style.setProperty("height", "var(--masthead-h)");
          const value = probe.getBoundingClientRect().height;
          probe.remove();
          return value;
        });
        assert.equal((await banner.boundingBox()).height, height, `${width}/${colorScheme}: masthead height is the token`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${colorScheme}: no horizontal document overflow`);
        const controls = [page.getByRole("button", { name: "Connection: Live", exact: true }), page.getByRole("button", { name: "Theme", exact: true }), page.getByRole("button", { name: USER, exact: true })];
        const boxes = [];
        for (const control of controls) {
          const box = await control.boundingBox();
          assert.ok(box !== null && box.x >= 0 && box.x + box.width <= width, `${width}: masthead control is inside the viewport`);
          boxes.push(box);
        }
        const navBox = await nav(page).boundingBox();
        const apart = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        for (const [index, box] of boxes.entries()) {
          assert.ok(apart(box, navBox), `${width}: masthead control ${index} does not cover the navigation`);
          if (index > 0) assert.ok(apart(box, boxes[index - 1]), `${width}: masthead controls do not overlap`);
        }
        for (const label of Object.keys(PRESET_QUERIES)) {
          const link = nav(page).getByRole("link", { name: label, exact: true });
          await link.scrollIntoViewIfNeeded();
          assert.ok(await link.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return rect.left >= 0 && rect.right <= innerWidth && target !== null && element.contains(target);
          }), `${width}: ${label} is reachable and not covered`);
        }
        const connection = controls[0];
        await connection.click();
        const details = page.getByRole("region", { name: "Connection details", exact: true });
        const box = await details.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, `${width}: connection details fit the viewport`);
        await details.getByRole("button", { name: "Reconnect now", exact: true }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await details.count(), 0);
        assert.equal(await connection.evaluate((element) => element === document.activeElement), true, "Escape returns focus to the indicator");
        const user = controls[2];
        await user.click();
        const menu = page.getByRole("menu", { name: "Account", exact: true });
        for (const item of ["Account settings", "Access tokens", "Sign out"]) await menu.getByRole("menuitem", { name: item, exact: true }).waitFor();
        assert.equal(await menu.getByRole("menuitem", { name: "Users", exact: true }).count(), 0, "Users is offered to administrators only");
        assert.equal(await menu.getByRole("menuitem", { name: "Account settings", exact: true }).evaluate((element) => element === document.activeElement), true, "an opened menu focuses its first item");
        const menuBox = await menu.boundingBox();
        assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, `${width}: the user menu fits the viewport`);
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
        assert.equal(await user.evaluate((element) => element === document.activeElement), true, "Escape returns focus to the user button");
        if (width === WIDTHS[0] && colorScheme === "light") {
          const theme = controls[1];
          await theme.click();
          await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
          await page.reload();
          await connection.waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "the theme choice persists");
          await theme.click();
          assert.equal(await page.getByRole("menuitemradio", { checked: true }).textContent(), "Dark", "the menu shows the current choice");
          await page.getByRole("menuitemradio", { name: "System", exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
        }
        await state.noNativeDialogs();
      } finally { await context.close(); }
    }
  });

  await check("shell: a live change never resets a scrolled list, Show merges it in place keeping the first visible row; an untouched list refreshes in place", async () => {
    const { context, page, state } = await open(browser, { width: 1440, colorScheme: "light" });
    try {
      await signIn(page, "#/browse");
      await waitRows(page, PAGE);
      const send = (key) => state.sockets.at(-1).send(JSON.stringify({ kind: "changed", key, revision: 2, nonce: null, clientTs: null, serverTs: null }));
      state.data[""].unshift(summary("notes:fresh", "Fresh record", {}));
      const refreshed = page.waitForRequest((request) => request.url().endsWith("/api/v1/search") && request.postDataJSON().query === "");
      send("notes:fresh");
      await refreshed;
      await page.getByRole("button", { name: "notes:fresh", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Records changed · Show", exact: true }).count(), 0, "an untouched list needs no announcement");
      await loadBatches(page, 3);
      await records(page).evaluate((element) => { element.scrollTop = 900; });
      const listSearches = () => state.searches.filter((search) => search.query === "").length;
      const searches = listSearches();
      state.data[""].unshift(summary("notes:later", "Later record", {}));
      send("notes:later");
      const pill = page.getByRole("button", { name: "Records changed · Show", exact: true });
      await pill.waitFor();
      await frames(page);
      assert.equal(await rowCount(page), PAGE * 3, "rows are kept");
      assert.equal(await records(page).evaluate((element) => element.scrollTop), 900, "scroll is kept");
      assert.equal(listSearches(), searches, "the list is not reloaded until the reader asks");
      const firstVisible = () => records(page).evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        const row = [...element.querySelectorAll("tbody tr")].find((candidate) => candidate.getBoundingClientRect().bottom > top);
        return { key: row.dataset.rowId, top: row.getBoundingClientRect().top };
      });
      const anchor = await firstVisible();
      await pill.click();
      await records(page).getByRole("button", { name: "notes:later", exact: true }).waitFor({ state: "attached" });
      await frames(page);
      assert.equal(await pill.count(), 0);
      assert.equal(await rowCount(page), PAGE * 3, "Show reloads the loaded chain in place instead of restarting it");
      const after = await records(page).evaluate((element, key) => element.querySelector(`tbody tr[data-row-id="${CSS.escape(key)}"]`).getBoundingClientRect().top, anchor.key);
      assert.ok(Math.abs(after - anchor.top) <= 2, `the first visible row keeps its place: ${anchor.top} → ${after}`);
      await state.noNativeDialogs();
    } finally { await context.close(); }
  });

  await check("shell: Access tokens open in the account outlet over a kept list (degraded server) and Sign out is module-owned", async () => {
    const { context, page, state } = await open(browser, { width: 1440, colorScheme: "light" });
    try {
      await signIn(page, "#/inbox");
      await waitRows(page, PAGE);
      await page.evaluate(() => window.scrollTo(0, 100));
      const scrolled = await page.evaluate(() => window.scrollY);
      const row = page.getByRole("button", { name: "todo:review-00", exact: true });
      await row.evaluate((element) => { element.keptProbe = true; });
      await page.getByRole("button", { name: USER, exact: true }).click();
      await page.getByRole("menuitem", { name: "Access tokens", exact: true }).click();
      await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, "#account/tokens");
      assert.doesNotMatch(await page.locator("[data-account-outlet]").innerText(), /\bnull\b/, "sections the server does not offer are absent, not rendered as text");
      assert.equal(await page.getByRole("main").count(), 0, "the host main is hidden under the account page");
      assert.deepEqual(await current(page), [], "no workspace entry is current on the account page");
      await nav(page).getByRole("link", { name: "Inbox", exact: true }).click();
      await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("main").waitFor();
      assert.equal(await rowCount(page), PAGE, "the list is shown again with its rows");
      assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrolled) <= 2, "leaving the account page restores the list scroll");
      assert.deepEqual(await current(page), ["Inbox25"]);
      assert.equal(await row.evaluate((element) => element.keptProbe), true, "the list stayed mounted under the account page");
      await page.getByRole("button", { name: USER, exact: true }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).waitFor();
      assert.equal(state.logouts, 1, "the account module posts the sign-out");
      assert.equal(await page.getByRole("banner").getByRole("link", { name: "Browse" }).count(), 0, "the signed-out masthead has no navigation");
      await state.noNativeDialogs();
    } finally { await context.close(); }
  });
} finally {
  if (browser !== undefined) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
assert.equal(results.length, 4);
