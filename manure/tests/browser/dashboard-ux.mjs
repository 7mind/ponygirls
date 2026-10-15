// UX scenarios over the real API. Transport fault injection is test-only;
// secret inputs arrive over stdin and never appear in output or screenshots.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const require = createRequire(path.join(input.core, "package.json"));
const { chromium, firefox } = require("playwright-core");
const browser = input.engine === "firefox"
  ? await firefox.launch({ executablePath: input.browser, firefoxUserPrefs: { "network.dns.localDomains": [input.bundle, input.protectedId, input.publicId, ...input.records].map((id) => `${id}.${input.suffix}`).join(",") } })
  : await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=MAP *.${input.suffix} 127.0.0.1`] });
const results = [];
if (input.artifacts) await fs.mkdir(input.artifacts, { recursive: true });
const check = async (name, run) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors = [];
    const urls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => urls.push(request.url()));
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.__ux = { failList: false, holdList: false, holdRotate: false, failLogout: false, failSession: location.hash === "#/ux-session-fail", holdInfoId: null, releaseInfo: null, releaseList: null, releaseRotate: null };
      window.fetch = (url, options) => {
        const state = window.__ux;
        const value = String(url);
        if (state.failSession && value.endsWith("/whoami")) return Promise.reject(new Error("test-offline"));
        if (state.failLogout && value.endsWith("/logout")) return Promise.reject(new Error("test-offline"));
        const listPage = value.includes("/artifacts?") && value.includes("cursor=");
        if (listPage && state.failList) { state.failList = false; return Promise.resolve(new Response('{"error":{"code":"unavailable"}}', { status: 503, headers: { "Content-Type": "application/json" } })); }
        const response = original(url, options);
        if (state.holdInfoId && value.endsWith("/artifacts/" + state.holdInfoId)) { state.holdInfoId = null; return response.then((res) => new Promise((resolve) => { state.releaseInfo = () => resolve(res); })); }
        if (listPage && state.holdList) { state.holdList = false; return response.then((res) => new Promise((resolve) => { state.releaseList = () => resolve(res); })); }
        if (value.endsWith("/external-password:rotate") && state.holdRotate) { state.holdRotate = false; return response.then((res) => new Promise((resolve) => { state.releaseRotate = () => resolve(res); })); }
        return response;
      };
    });
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("#token-input").fill(input.token);
    await page.locator("#login-form button[type=submit]").click();
    await page.locator("#whoami-text").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("shown"));
    assert.equal((await page.locator("#token-input").inputValue()).length, 0);
    await run(page, context);
    assert.deepEqual(errors, []);
    assert.equal(urls.some((url) => url.includes(input.token)), false, "credential must not travel in a URL");
    results.push({ name, ok: true });
  } catch (error) {
    // Selectors and assertions contain fixture names/lengths only, never secrets.
    results.push({ name, ok: false, error: error.message.split("\n").slice(0, 3).join(" ") });
  } finally { await context.close(); }
};
const rows = (page) => page.locator("#artifact-list > tr");
const count = (page, length) => page.waitForFunction((n) => document.querySelectorAll("#artifact-list > tr").length === n, length);
const titles = (page) => page.locator("#artifact-list .record-open strong").allTextContents();
const bottom = (page) => page.locator("#results-panel").evaluate((node) => { node.scrollTop = node.scrollHeight; });
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const capture = async (page, name) => {
  if (input.artifacts) await page.screenshot({ path: path.join(input.artifacts, name + ".png"), fullPage: true });
};
const search = async (page, text) => {
  await page.locator("#filter-text").fill(text);
  await page.locator("#filter-text").press("Enter");
  await page.waitForFunction((q) => new URLSearchParams(location.hash.split("?")[1]).get("q") === q && document.querySelector("#list-status").textContent.includes("shown"), text);
};
const recordSearch = async (page) => {
  await search(page, "ux-record-");
  await page.waitForFunction(() => document.querySelectorAll("#artifact-list > tr").length === 25 && [...document.querySelectorAll("#artifact-list .record-open strong")].every((node) => node.textContent.startsWith("ux-record-")));
};
const detail = async (page, id, query) => {
  await search(page, query);
  await page.locator(`button[data-action=details][data-artifact-id="${id}"]`).click();
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.waitForFunction((value) => document.querySelector("#detail-list").textContent.includes(value), id);
};

await check("sortable table, global search, URL reload and responsive themes", async (page) => {
  await recordSearch(page);
  assert.equal(await page.locator("#next-button, #prev-button").count(), 0);
  assert.equal(await page.locator("thead [data-sort]").count(), 9);
  assert.equal((await titles(page))[0], "ux-record-64");
  await page.locator('[data-sort="name"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#artifact-list strong")?.textContent === "ux-record-00");
  assert.deepEqual(await titles(page), Array.from({ length: 25 }, (_, i) => `ux-record-${String(i).padStart(2, "0")}`));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#artifact-list strong")?.textContent === "ux-record-00");
  assert.equal(await page.locator("#filter-text").inputValue(), "ux-record-");
  if (input.artifacts) await page.screenshot({ path: path.join(input.artifacts, "catalogue-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  if (input.artifacts) await page.screenshot({ path: path.join(input.artifacts, "catalogue-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (input.artifacts) await page.screenshot({ path: path.join(input.artifacts, "catalogue-mobile.png"), fullPage: true });
});

await check("infinite scrolling appends without duplicates and reaches exhaustion", async (page) => {
  await recordSearch(page);
  await page.locator("#artifact-list [data-action=details]").first().focus();
  const focusedId = await page.evaluate(() => document.activeElement.dataset.artifactId);
  await bottom(page); await count(page, 50);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.artifactId), focusedId, "appending rows must retain keyboard focus");
  await bottom(page); await count(page, 65);
  assert.equal(await page.locator("#load-more-button").isVisible(), false);
  assert.equal(await page.locator("#artifact-list > tr").evaluateAll((nodes) => new Set(nodes.map((node) => node.dataset.artifactId)).size), 65);
  await page.locator("#filter-visibility").selectOption("external");
  await count(page, 22);
  assert.equal(await rows(page).evaluateAll((nodes) => nodes.every((node) => node.children[2].textContent === "external")), true);
});

await check("append failure preserves rows, stops automatic loading and retries", async (page) => {
  await recordSearch(page);
  await page.evaluate(() => { window.__ux.failList = true; });
  await bottom(page);
  await page.locator("#list-error").waitFor({ state: "visible" });
  assert.equal(await rows(page).count(), 25);
  await settle(page);
  assert.equal(await rows(page).count(), 25);
  await page.locator("#retry-list-button").click();
  await count(page, 50);
  assert.equal(await page.locator("#list-error").isVisible(), false);
});

await check("old pages cannot append after a sort change", async (page) => {
  await recordSearch(page);
  await page.evaluate(() => { window.__ux.holdList = true; });
  await bottom(page);
  await page.waitForFunction(() => window.__ux.releaseList !== null);
  await page.locator('[data-sort="name"]').click();
  await page.waitForFunction(() => document.querySelector("#artifact-list strong")?.textContent === "ux-record-00");
  await page.evaluate(() => window.__ux.releaseList());
  await settle(page);
  assert.deepEqual(await titles(page), Array.from({ length: 25 }, (_, i) => `ux-record-${String(i).padStart(2, "0")}`));
});

await check("details show file manifest, inert names and attachment downloads", async (page) => {
  await detail(page, input.bundle, "ux-bundle");
  await page.waitForFunction(() => document.querySelectorAll("#file-list > tr").length === 4);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('#file-list a[href*="%C3%BCber%20file.txt"]').click(),
  ]);
  assert.equal(download.suggestedFilename(), "über file.txt");
  assert.equal((await fs.readFile(await download.path())).equals(Buffer.from("unicode download")), true);
  if (input.artifacts) await page.screenshot({ path: path.join(input.artifacts, "artifact-detail.png"), fullPage: true });
  await page.locator("#detail-back-button").click();
  await search(page, "ux-hostile");
  await page.waitForFunction(() => document.querySelector("#artifact-list").textContent.includes("ux-hostile"));
  assert.equal(await page.locator("#artifact-list img, #artifact-list script").count(), 0);
});

await check("internal grant handoff opens isolated content without dashboard cookies", async (page) => {
  await detail(page, input.bundle, "ux-bundle");
  const cookies = [];
  page.on("request", async (request) => {
    if (new URL(request.url()).hostname === `${input.bundle}.${input.suffix}`) {
      const headers = await request.allHeaders();
      cookies.push({ dashboard: (headers.cookie || "").includes("manure-dev="), authorization: Boolean(headers.authorization) });
    }
  });
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Isolated internal preview", exact: true }).waitFor();
  assert.notEqual(new URL(page.url()).origin, input.base);
  assert.equal(cookies.length > 0, true);
  assert.equal(cookies.some((headers) => headers.dashboard || headers.authorization), false);
});

await check("public previews and protected unlock keep isolated origin flows", async (page) => {
  await detail(page, input.publicId, "ux-public");
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Public preview", exact: true }).waitFor();
  await page.goto(input.base + "/#/artifacts", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("shown"));
  await detail(page, input.protectedId, "ux-protected");
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await capture(page, "unlock-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "unlock-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture(page, "unlock-mobile");
  await page.locator("#password-input").fill("incorrect");
  await page.locator("#unlock-form button").click();
  await page.locator("#unlock-error").waitFor({ state: "visible" });
  assert.equal((await page.locator("#password-input").inputValue()).length, 0);
  await page.locator("#password-input").fill(input.password);
  await page.locator("#unlock-form button").click();
  await page.waitForFunction(() => document.body.textContent.includes("protected") && document.querySelector("#unlock-form") === null);
  assert.equal(page.url().includes(input.password), false);
});

await check("expired artifacts remain deletable from the catalogue", async (page) => {
  await search(page, "ux-expired");
  await page.locator("#include-expired").check();
  await count(page, 1);
  assert.equal(await page.locator('[data-action=delete]').isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-action=delete]').click();
  await count(page, 0);
  assert.equal((await page.request.get(input.base + "/api/v1/artifacts/" + input.expiredId)).status(), 404);
});

await check("password reveals clear on dismiss, navigation and confirmed logout", async (page, context) => {
  await detail(page, input.protectedId, "ux-protected");
  await page.locator("#rotate-button").click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 43);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
  const session = (await context.cookies(input.base)).find((cookie) => cookie.name === "manure-dev");
  assert.equal(session.httpOnly, true);
  await page.locator("#rotate-dismiss-button").click();
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0);
  await page.locator("#rotate-button").click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 43);
  await page.locator("#detail-back-button").click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 0);
  await detail(page, input.protectedId, "ux-protected");
  await page.locator("#logout-button").click();
  await page.locator("#login-section").waitFor({ state: "visible" });
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0);
});

await check("failed logout cannot resurrect an in-flight password reveal", async (page) => {
  await detail(page, input.protectedId, "ux-protected");
  await page.evaluate(() => { window.__ux.holdRotate = true; });
  await page.locator("#rotate-button").click();
  await page.waitForFunction(() => window.__ux.releaseRotate !== null);
  await page.evaluate(() => { window.__ux.failLogout = true; });
  await page.locator("#logout-button").click();
  await page.waitForFunction(() => document.querySelector("#detail-status").textContent.includes("Sign out could not be confirmed"));
  await page.evaluate(() => window.__ux.releaseRotate());
  await settle(page);
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0, "logout attempt must invalidate the reveal");
});

await check("returning from details after cancelling a page restores scrolling", async (page) => {
  await recordSearch(page);
  await page.evaluate(() => { window.__ux.holdList = true; });
  await bottom(page);
  await page.waitForFunction(() => window.__ux.releaseList !== null);
  await page.locator("#results-panel").evaluate((node) => { node.scrollTop = 0; });
  await page.locator("#artifact-list [data-action=details]").first().click();
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.locator("#detail-back-button").click();
  await page.locator("#dashboard-section").waitFor({ state: "visible" });
  await page.evaluate(() => window.__ux.releaseList());
  await settle(page);
  assert.equal(await page.locator("#load-more-button").isEnabled(), true);
  await page.locator("#load-more-button").click();
  await count(page, 50);
});

await check("missing deep links recover to a usable catalogue", async (page) => {
  await page.goto(input.base + "/#/artifact/" + "0".repeat(32), { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("Detail failed"));
  assert.equal(await page.locator("#dashboard-section").isVisible(), true);
  assert.equal(await rows(page).count() > 0 || await page.locator("#retry-list-button").isVisible(), true);
  await page.locator("#retry-list-button").click();
  await count(page, 25);
});

await check("session network failures expose a visible recovery action", async (page) => {
  await page.goto(input.base + "/#/ux-session-fail", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#session-status").textContent.includes("unavailable"));
  assert.equal(await page.locator("#login-section").isVisible(), false);
  assert.equal(await page.locator("#session-retry-button").isVisible(), true);
  await page.evaluate(() => { window.__ux.failSession = false; });
  await page.locator("#session-retry-button").click();
  await page.locator("#workspace-shell").waitFor({ state: "visible" });
  await count(page, 25);
});

await check("a new detail target cannot retain old metadata and destructive actions", async (page) => {
  await detail(page, input.bundle, "ux-bundle");
  await page.waitForFunction(() => document.querySelectorAll("#file-list a").length > 0);
  await page.evaluate((id) => { window.__ux.holdInfoId = id; location.hash = "#/artifact/" + id; }, input.protectedId);
  await page.waitForFunction(() => window.__ux.releaseInfo !== null);
  assert.equal(await page.locator("#delete-button").isEnabled(), false, "Delete must be disabled until the active artifact is observed");
  assert.equal(await page.locator("#copy-id-button").isEnabled(), false);
  assert.equal(await page.locator("#file-list a").count(), 0);
  await page.evaluate(() => window.__ux.releaseInfo());
  await page.waitForFunction(() => document.querySelector("#detail-name").textContent === "ux-protected");
  assert.equal(await page.locator("#delete-button").isEnabled(), true);
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
