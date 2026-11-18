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
      window.__ux = { rotations: 0, listInFlight: 0, listPeak: 0, readCommands: [], holdSearch: false, releaseSearch: null, failList: false, holdList: false, holdListReset: false, releaseListReset: null, holdCapabilities: false, releaseCapabilities: null, holdRotate: false, failLogout: false, failSession: location.hash === "#/ux-session-fail", holdInfoId: null, releaseInfo: null, releaseList: null, releaseRotate: null };
      window.fetch = (url, options) => {
        const state = window.__ux;
        const value = String(url);
        let envelope;try { envelope=JSON.parse(options?.body || "null"); } catch (_) { envelope=null; }
        const command=new URL(value,location.href).pathname==="/api/current" ? envelope?.command : null;
        if (state.failSession && command?.Whoami) return Promise.reject(new Error("test-offline"));
        if (state.failLogout && command?.Logout) return Promise.reject(new Error("test-offline"));
        if (command?.RotateExternalPassword) state.rotations++;
        if (command?.ListArtifacts) state.readCommands.push({ mode: "catalogue", query: command.ListArtifacts.query.query });
        if (command?.Search) state.readCommands.push({ mode: command.Search.query.mode, query: command.Search.query.query });
        const listPage=command?.ListArtifacts?.query.cursor != null;
        if (listPage && state.failList) { state.failList=false; return Promise.resolve(new Response(JSON.stringify({requestId:envelope.requestId,result:{Error:{failure:{code:"Unavailable",message:"controlled fixture",retryAfterSeconds:1}}}}),{status:503,headers:{"Content-Type":"application/json"}})); }
        if (command?.ListArtifacts || command?.Search) {
          state.listInFlight++;
          state.listPeak=Math.max(state.listPeak,state.listInFlight);
        }
        const response=original(url,options).then(res => {
          if (command?.ListArtifacts || command?.Search) state.listInFlight--;
          return res;
        }, error => {
          if (command?.ListArtifacts || command?.Search) state.listInFlight--;
          throw error;
        });
        if (state.holdInfoId && command?.GetArtifact?.artifactId===state.holdInfoId) { state.holdInfoId=null;return response.then(res=>new Promise(resolve=>{state.releaseInfo=()=>resolve(res);})); }
        if (command?.GetCapabilities && state.holdCapabilities) { state.holdCapabilities=false;return response.then(res=>new Promise(resolve=>{state.releaseCapabilities=()=>resolve(res);})); }
        if (command?.Search && state.holdSearch) { state.holdSearch=false;return response.then(res=>new Promise(resolve=>{state.releaseSearch=()=>resolve(res);})); }
        if (listPage && state.holdList) { state.holdList=false;return response.then(res=>new Promise(resolve=>{state.releaseList=()=>resolve(res);})); }
        if (command?.ListArtifacts && !listPage && state.holdListReset) { state.holdListReset=false;return response.then(res=>new Promise(resolve=>{state.releaseListReset=()=>resolve(res);})); }
        if (command?.RotateExternalPassword && state.holdRotate) { state.holdRotate=false;return response.then(res=>new Promise(resolve=>{state.releaseRotate=()=>resolve(res);})); }
        return response;
      };
    });
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await signIn(page);
    await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("loaded"));
    await run(page, context);
    assert.deepEqual(errors, []);
    assert.equal(urls.some((url) => url.includes(input.token)), false, "credential must not travel in a URL");
    results.push({ name, ok: true });
  } catch (error) {
    // Selectors and assertions contain fixture names/lengths only, never secrets.
    results.push({ name, ok: false, error: error.message.split("\n").slice(0, 8).join(" ") });
  } finally { await context.close(); }
};
const rows = (page) => page.locator("#artifact-list > tr");
const count = (page, length) => page.waitForFunction((n) => document.querySelectorAll("#artifact-list > tr").length === n, length);
const titles = (page) => page.locator("#artifact-list .cell-title").allTextContents();
const bottom = (page) => page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const listNotice = (page) => page.locator("#list-notice").textContent();
async function signIn(page) {
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
  await page.locator("#whoami-text").waitFor({ state: "visible" });
}
const signOut = async (page) => {
  await page.locator("#user-menu-button").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.locator("#login-section").waitFor({ state: "visible" });
};
const search = async (page, text) => {
  await page.locator("#filter-text").fill(text);
  await page.locator("#filter-text").press("Enter");
  await page.waitForFunction((q) => new URLSearchParams(location.hash.split("?")[1]).get("query")?.includes(q) &&
    document.querySelector("#catalogue-table").getAttribute("aria-busy") === "false" && / loaded|No matches/.test(document.querySelector("#list-status").textContent), text);
};
const recordSearch = async (page) => {
  await search(page, "ux-record-");
  await page.waitForFunction(() => document.querySelectorAll("#artifact-list > tr").length === 25 && [...document.querySelectorAll("#artifact-list .cell-title")].every((node) => node.textContent.startsWith("ux-record-")));
};
const detail = async (page, id, query) => {
  await search(page, query);
  await page.locator(`#catalogue-table a[data-action=details][data-artifact-id="${id}"]`).click();
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.waitForFunction((value) => document.querySelector("#detail-list").textContent.includes(value), id);
};

await check("sortable table, global search and URL reload", async (page) => {
  await recordSearch(page);
  assert.equal(await page.locator("#next-button, #prev-button").count(), 0);
  assert.equal(await page.locator("thead [data-sort]").count(), 7);
  // Creation time is stored in whole seconds; sequential fixture names are
  // NOT the tie breaker. Read authoritative metadata through the current typed
  // API and independently apply CreatedAt DESC, raw-byte artifact-ID DESC.
  const metadata = await page.evaluate(async (ids) => {
    const api = await import("/current-protocol.js");
    return Promise.all(ids.map(async (id) => {
      const item = await api.request(window.fetch.bind(window), api.artifact(id));
      return { id: item.artifact_id, name: item.name, createdAt: item.created_at };
    }));
  }, input.records);
  const createdDescending = (items) => [...items].sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || Buffer.compare(Buffer.from(b.id, "utf8"), Buffer.from(a.id, "utf8")));
  assert(metadata.every((item) => Number.isFinite(Date.parse(item.createdAt))));
  assert.deepEqual(createdDescending([
    { id: "0".repeat(32), name: "uploaded-last", createdAt: "2026-01-01T00:00:00Z" },
    { id: "f".repeat(32), name: "uploaded-first", createdAt: "2026-01-01T00:00:00Z" },
  ]).map((item) => item.name), ["uploaded-first", "uploaded-last"], "timestamp ties use raw ID bytes, not upload/name sequence");
  const ordered = createdDescending(metadata);
  assert.deepEqual(await titles(page), ordered.slice(0, 25).map((item) => item.name), "default global created-at and raw-ID ordering");
  await page.locator('[data-sort="name"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#artifact-list .cell-title")?.textContent === "ux-record-00");
  assert.deepEqual(await titles(page), Array.from({ length: 25 }, (_, i) => `ux-record-${String(i).padStart(2, "0")}`));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#artifact-list .cell-title")?.textContent === "ux-record-00");
  assert.equal(await page.locator("#filter-text").inputValue(), "sort:name direction:asc ux-record-");
});

await check("expression length bound and delayed capabilities preserve draft", async (page) => {
  assert.equal(await page.locator("#filter-text").getAttribute("maxlength"), "131072");
  await page.locator("#filter-text").fill("x".repeat(131073));
  assert.equal((await page.locator("#filter-text").inputValue()).length, 131072, "native input enforces its expression limit");
  await page.locator("#filter-text").evaluate((input) => { input.value = "x".repeat(131073); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#search-submit").click();
  assert.equal(await page.locator("#query-diagnostic").textContent(), "Query exceeds 131072 UTF-16 code units.");
  await page.locator("#filter-text").fill("x".repeat(4097));
  await page.locator("#search-submit").click();
  assert.equal(await page.locator("#query-diagnostic").textContent(), "Search text exceeds 4096 UTF-16 code units.");
  await page.evaluate(() => { location.hash = "#/artifacts?mode=semantic&q=ux-bundle"; });
  await page.waitForFunction(() => document.querySelector("#list-notice").textContent.includes("unavailable"));
  assert.equal(await page.locator("#filter-text").inputValue(), "mode:semantic ux-bundle");
  await page.evaluate(() => { window.__ux.holdCapabilities = true; });
  await page.locator("#retry-list-button").click();
  await page.waitForFunction(() => window.__ux.releaseCapabilities !== null, null, { timeout: 10000 });
  try {
    await page.locator("#filter-text").fill("unsent draft");
    await page.evaluate(() => window.__ux.releaseCapabilities());
    await settle(page);
    assert.equal(await page.locator("#filter-text").inputValue(), "unsent draft");
    assert.equal(await page.locator("#sort-summary").textContent(), "Relevance order · not sortable");
  } finally { await page.evaluate(() => window.__ux.releaseCapabilities?.()); }
});

await check("direct route fences held retrieval and never replays unsent URL query", async (page) => {
  await page.locator("#filter-text").fill("mode:lexical ux-public");
  await page.evaluate(() => { window.__ux.holdSearch = true; });
  await page.locator("#list-form button[type=submit]").click();
  await page.waitForFunction(() => window.__ux.releaseSearch !== null, null, { timeout: 10000 });
  try {
    await page.evaluate(() => { location.hash = "#/artifacts?mode=lexical&q=ux-protected"; });
    await page.waitForFunction(() => document.querySelector("#list-notice").textContent.includes("Press Search"));
    await page.evaluate(() => window.__ux.releaseSearch());
    await settle(page);
    assert.equal(await page.locator("#retrieval-results").textContent(), "");
    assert.deepEqual(await page.evaluate(() => window.__ux.readCommands.filter(c => c.mode !== "catalogue").map(c => c.query)), ["ux-public"]);
  } finally { await page.evaluate(() => window.__ux.releaseSearch?.()); }
});

await check("sort and access scope wait for a changed draft; the scope then applies at once", async (page) => {
  await recordSearch(page);
  const before = await page.evaluate(() => window.__ux.readCommands.length);
  await page.locator("#filter-text").fill("mode:lexical kind:dir owner:unsent-owner unsent draft");
  assert.equal(await page.locator('[data-sort="name"]').isDisabled(), true);
  assert.equal(await page.locator('[data-visibility-preset="external"]').isDisabled(), true);
  await page.locator("#refresh-button").click();
  await page.waitForFunction((n)=>window.__ux.readCommands.length === n+1,before);
  assert.deepEqual(await page.evaluate(()=>window.__ux.readCommands.at(-1)),{mode:"catalogue",query:"ux-record-"});
  assert.equal(await page.locator("#filter-text").inputValue(), "mode:lexical kind:dir owner:unsent-owner unsent draft");
  await page.locator("#filter-text").fill("ux-record-");
  await page.locator('[data-visibility-preset="external"]').click();
  await page.waitForFunction(()=>new URLSearchParams(location.hash.split("?")[1]).get("query")==="access:external ux-record-" &&
    document.querySelector("#catalogue-table").getAttribute("aria-busy") === "false" && document.querySelector("#list-status").textContent.includes("loaded"));
  assert.equal(await page.locator("#filter-text").inputValue(),"access:external ux-record-");
  assert.equal(await page.locator('[data-visibility-preset="external"]').getAttribute("aria-pressed"), "true");
  assert.equal(await rows(page).evaluateAll((nodes) => nodes.length > 0 && nodes.every((node) => node.dataset.visibility === "external")), true);
});
await check("confirmed logout clears owner/query fragment and next login does not replay it", async (page) => {
  await page.locator("#filter-text").fill("mode:lexical owner:private-creator ux-public");
  await page.locator("#list-form button[type=submit]").click();
  await page.waitForFunction(() => new URLSearchParams(location.hash.split("?")[1]).get("query")?.includes("owner:private-creator"));
  await page.waitForFunction(() => window.__ux.readCommands.some(c => c.mode === "Lexical"));
  await signOut(page);
  assert.equal(page.url().includes("private-creator"), false, "logout must remove owner from URL");
  assert.equal(page.url().includes("ux-public"), false, "logout must remove query from URL");
  await signIn(page);
  assert.equal(await page.locator("#filter-text").inputValue(), "", "new login clears expression");
  // Sign-in reloads the page; the catalogue read waits for the capabilities read of the new page.
  await page.waitForFunction(() => / loaded|No matches/.test(document.querySelector("#list-status").textContent));
  assert.ok(await page.evaluate(() => window.__ux.readCommands.length > 0), "reloaded dashboard must load an authenticated catalogue");
  assert.equal(await page.evaluate(() => window.__ux.readCommands.some(c => c.mode !== "catalogue")), false, "no retrieval replay across logout/login");
});

await check("access tokens open in the account outlet: issue, reveal, acknowledge and revoke without native dialogs", async (page) => {
  page.on("dialog", (dialog) => { throw new Error("native dialog " + dialog.type()); });
  await page.locator("#user-menu-button").click();
  await page.getByRole("menuitem", { name: "Access tokens" }).click();
  await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor();
  assert.equal(await page.locator("#main").isHidden(), true, "the account page replaces the workspace view");
  assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).locator('[aria-current="page"]').count(), 0, "no workspace view is highlighted on the account page");
  assert.equal((await page.getByRole("navigation", { name: "Account sections" }).textContent()).includes("null"), false, "sections this server does not offer are left out");
  const table = page.getByRole("table", { name: "Access tokens" });
  await table.locator("tr[data-row-id]").first().waitFor();
  const configured = table.locator("tr[data-row-id]").filter({ hasText: "Configuration" });
  assert.ok(await configured.count() > 0, "declarative credentials remain visible in settings");
  assert.equal(await configured.getByRole("button", { name: /^Revoke/ }).count(), 0, "configured tokens cannot be revoked here");
  await page.getByRole("button", { name: "New token", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser acceptance collector");
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  const secret = page.getByLabel("One-time token secret", { exact: true });
  await secret.waitFor();
  await page.getByRole("button", { name: "Reveal", exact: true }).click();
  const value = await secret.inputValue();
  assert.ok(value.length > 20);
  assert.equal(await page.evaluate((shown) => JSON.stringify([localStorage, sessionStorage]).includes(shown), value), false, "one-time secrets must not enter browser storage");
  await page.getByRole("button", { name: "I have saved it", exact: true }).click();
  await page.getByRole("button", { name: "Yes, I have saved it", exact: true }).click();
  await secret.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Revoke Browser acceptance collector", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke token", exact: true }).click();
  await table.locator("tr[data-row-id]").filter({ hasText: "Browser acceptance collector" }).waitFor({ state: "detached" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Artifacts" }).click();
  await page.locator("#main").waitFor({ state: "visible" });
  assert.equal(await page.getByRole("heading", { name: "Access tokens", exact: true }).count(), 0);
  assert.ok(await rows(page).count() > 0, "the catalogue rows were kept while the account page was shown");
});
await check("unauthenticated incoming retrieval deep link survives login without implicit Search", async (page) => {
  await signOut(page);
  const link = input.base + "/#/artifacts?mode=lexical&q=ux-public&owner=one-user";
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.locator("#login-section").waitFor({ state: "visible" });
  assert.equal(page.url(), link);
  await signIn(page);
  assert.equal(await page.locator("#filter-text").inputValue(), "mode:lexical owner:one-user ux-public");
  assert.equal(await page.locator("#retrieval-results").textContent(), "");
  assert.equal(await page.evaluate(() => window.__ux.readCommands.some(c => c.mode !== "catalogue")), false);
});

await check("old pages cannot append after a sort change", async (page) => {
  await recordSearch(page);
  await page.evaluate(() => { window.__ux.holdList = true; });
  await bottom(page);
  await page.waitForFunction(() => window.__ux.releaseList !== null);
  await page.locator('[data-sort="name"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.hash.split("?")[1]).get("query")?.includes("sort:name"));
  assert.equal(await page.evaluate(() => window.__ux.listInFlight), 0,
    "network body finished, but held reply has not settled in the application");
  await page.waitForFunction(() => document.querySelectorAll("#artifact-list > tr").length === 0);
  assert.equal(await page.locator("#artifact-list > tr").count(), 0, "old response cannot append across sort");
  await page.evaluate(() => window.__ux.releaseList());
  await page.waitForFunction(() => document.querySelector("#artifact-list .cell-title")?.textContent === "ux-record-00");
  await settle(page);
  assert.deepEqual(await titles(page), Array.from({ length: 25 }, (_, i) => `ux-record-${String(i).padStart(2, "0")}`));
  assert.equal(await page.evaluate(() => window.__ux.listPeak), 1, "only one physical request while stale read was unsettled");
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
  await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("loaded"));
  await detail(page, input.protectedId, "ux-protected");
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
  await search(page, "expired:true ux-expired");
  await count(page, 1);
  await page.getByRole("button", { name: "More actions for ux-expired" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "Delete…" }).isEnabled(), true);
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("dialog", { name: "Delete artifact?" }).getByRole("button", { name: "Delete artifact" }).click();
  await count(page, 0);
  assert.equal((await page.request.post(input.base+"/api/current",{data:{requestId:crypto.randomUUID(),apiVersion:"1.0.0",command:{GetArtifact:{artifactId:input.expiredId}}}})).status(),404);
});

await check("rotation asks first; password reveals clear on dismiss, navigation and confirmed logout", async (page, context) => {
  await detail(page, input.protectedId, "ux-protected");
  const confirmRotation = page.getByRole("dialog", { name: "Rotate the external password?" });
  await page.locator("#rotate-button").click();
  await confirmRotation.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  await confirmRotation.waitFor({ state: "detached" });
  await page.locator("#rotate-button").click();
  await confirmRotation.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirmRotation.waitFor({ state: "detached" });
  await settle(page);
  assert.equal(await page.evaluate(() => window.__ux.rotations), 0, "Escape and Cancel rotate nothing");
  await page.locator("#rotate-button").click();
  await confirmRotation.getByRole("button", { name: "Rotate password", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 43);
  assert.equal(await page.evaluate(() => window.__ux.rotations), 1, "only the explicit confirmation rotates");
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
  const session = (await context.cookies(input.base)).find((cookie) => cookie.name === "manure-dev");
  assert.equal(session.httpOnly, true);
  await page.locator("#rotate-dismiss-button").click();
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0);
  await page.locator("#rotate-button").click();
  await confirmRotation.getByRole("button", { name: "Rotate password", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 43);
  await page.locator("#detail-back-button").click();
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 0);
  await detail(page, input.protectedId, "ux-protected");
  await signOut(page);
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0);
});

await check("Back from details after a cancelled append keeps the rows and loads on", async (page) => {
  await recordSearch(page);
  await page.evaluate(() => { window.__ux.holdList = true; });
  await bottom(page);
  await page.waitForFunction(() => window.__ux.releaseList !== null);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#artifact-list a[data-action=details]").first().click();
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.locator("#detail-back-button").click();
  await page.locator("#dashboard-section").waitFor({ state: "visible" });
  assert.equal(await rows(page).count(), 25, "the loaded rows are kept");
  await page.evaluate(() => window.__ux.releaseList());
  await settle(page);
  assert.equal(await rows(page).count(), 25, "the cancelled append cannot add rows");
  await bottom(page);
  await count(page, 50);
});
await check("missing deep links recover to a usable catalogue", async (page) => {
  await page.goto(input.base + "/#/artifact/" + "0".repeat(32), { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#list-notice").textContent.includes("Detail failed"));
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
  await page.locator("#main").waitFor({ state: "visible" });
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

await check("retrieval detail denial clears pinned evidence", async (page) => {
  await page.locator("#filter-text").fill("mode:lexical ux-bundle");
  await page.locator("#list-form button[type=submit]").click();
  try { await page.waitForFunction(() => document.querySelector("#retrieval-results").textContent.includes("ux-bundle"), null, { timeout: 10000 }); }
  catch (error) { throw new Error("retrieval status: " + await page.locator("#list-status").textContent() + " / " + await listNotice(page)); }
  const response = await page.request.post(input.base + "/api/current", { headers: { Origin: input.base }, data: {
    requestId: crypto.randomUUID(), apiVersion: "1.0.0", command: { DeleteArtifact: { artifactId: input.bundle } }
  }});
  assert.equal(response.status(), 200);
  await page.locator("#retrieval-results [data-action=details]").first().click();
  await page.waitForFunction(() => document.querySelector("#list-notice").textContent.includes("Detail failed"));
  assert.equal(await page.locator("#retrieval-results").textContent(), "", "denied artifact and evidence cannot be retained");
});



await check("caret-aware completion supports keyboard, pointer, dismissal and IME without requests", async (page) => {
  const query=page.locator('#filter-text'), popup=page.locator('#query-suggestions');
  const before=await page.evaluate(()=>window.__ux.readCommands.length);
  await query.fill('ac');
  await page.locator('#query-suggestions [role=option]').first().waitFor();
  await query.press('Enter');
  assert.equal(await query.inputValue(),'access:');
  assert.equal(await page.evaluate(()=>document.querySelector('#filter-text').selectionStart),7);
  await query.press('ArrowDown'); await query.press('Enter');
  assert.equal(await query.inputValue(),'access:external ');
  await query.fill('text:"kept literal" access:pubzzz sort:name');
  await query.evaluate(node=>{node.setSelectionRange(29,29);node.dispatchEvent(new Event('select'));});
  await page.locator('#query-suggestions [role=option]').filter({hasText:'public'}).click();
  assert.equal(await query.inputValue(),'text:"kept literal" access:public sort:name');
  assert.equal(await page.evaluate(()=>document.querySelector('#filter-text').selectionStart),33);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'filter-text');
  await query.fill('ac'); await query.press('Escape');
  assert.equal(await popup.isVisible(),false); assert.equal(await query.inputValue(),'ac');
  await query.press('Tab'); assert.notEqual(await page.evaluate(()=>document.activeElement.id),'filter-text');
  await query.focus(); await query.dispatchEvent('compositionstart');
  assert.equal(await popup.isVisible(),false);
  await query.press('Enter'); await page.locator('#search-submit').click();
  assert.equal(await page.evaluate(()=>window.__ux.readCommands.length),before);
  await query.dispatchEvent('compositionend');
  await page.locator('#clear-search-button').click();
  assert.equal(await query.inputValue(),''); assert.equal(await popup.isVisible(),false);
  await query.fill('access:PUBLIC'); await page.locator('#search-submit').click();
  assert.equal(await page.locator('#query-diagnostic').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__ux.readCommands.length),before);
  await page.evaluate(()=>{location.hash='#/artifacts?query=mode:INVALID';});
  await page.waitForFunction(()=>document.querySelector('#list-notice').textContent.includes('Invalid URL query'));
  assert.equal(await query.inputValue(),'mode:INVALID');
  assert.equal(await page.locator('#refresh-button').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.__ux.readCommands.length),before,'invalid URL never falls back to catalogue');
});

await check("latest unsent catalogue expression replaces queued reads", async (page) => {
  await recordSearch(page);
  await page.evaluate(()=>{window.__ux.holdList=true;});
  await bottom(page);
  await page.waitForFunction(()=>window.__ux.releaseList!==null).catch(error=>{throw new Error('held append: '+error.message);});
  const before=await page.evaluate(()=>window.__ux.readCommands.length);
  for (const text of ['ux-protected','ux-public','ux-hostile']) {
    await page.locator('#filter-text').fill(text); await page.locator('#search-submit').click();
    await page.waitForFunction(q=>new URLSearchParams(location.hash.split('?')[1]).get('query')===q,text).catch(error=>{throw new Error('submitted '+text+': '+error.message);});
  }
  assert.equal(await page.evaluate(()=>window.__ux.readCommands.length),before);
  await page.evaluate(()=>window.__ux.releaseList());
  await page.waitForFunction(()=>document.querySelector('#artifact-list').textContent.includes('ux-hostile')).catch(async error=>{
    throw new Error('latest read: '+JSON.stringify(await page.evaluate(()=>({hash:location.hash,query:document.querySelector('#filter-text').value,status:document.querySelector('#list-status').textContent,commands:window.__ux.readCommands})))+' '+error.message);
  });
  assert.deepEqual(await page.evaluate(n=>window.__ux.readCommands.slice(n).map(c=>c.query),before),['ux-hostile']);
  assert.equal(await page.evaluate(()=>window.__ux.listPeak),1);
});

await check("quick upload is one desktop row, accessible segments and bounded mobile wrap", async (page) => {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Upload" }).click();
  await page.locator("#upload-section").waitFor({ state: "visible" });
  const boxes=await Promise.all(['#upload-files','#upload-visibility','#upload-submit','#upload-clear'].map(selector=>page.locator(selector).boundingBox()));
  const centers=boxes.map(b=>b.y+b.height/2);
  assert.ok(Math.max(...centers)-Math.min(...centers)<3,'all upload controls share one desktop row');
  assert.ok(boxes[0].width<=240,'file picker remains short');
  assert.equal(await page.locator('#quick-upload h2, #quick-upload select').count(),0);
  await page.locator('#upload-external').check();
  assert.equal(await page.locator('#upload-access-help').isVisible(),true);
  await page.locator('#upload-public').check();
  assert.equal(await page.locator('#upload-access-help').isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  for (const selector of ['#upload-files','#upload-visibility','#upload-submit','#upload-clear']) {
    const box=await page.locator(selector).boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=390);
  }
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
