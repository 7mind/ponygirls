// Behavioral blackbox: Search, the ranked retrieval view next to Browse (search-parity W4; client default rule of
// haystack/docs/api.md) — the built dashboard (web/dist) served by the selected Scala/native server, pinned Chromium.
// Two servers with their own owned databases: one with a loopback STUB embedding endpoint started here
// (embedding-stub.mjs: deterministic vectors, requests recorded, no external network) and one lexical-only.
// The stub's outage is a real stop of its listener. Records are seeded through the authenticated public API.
// Runs alone (after `npm run build`):
//   HAYSTACK_SERVER_COMMAND=… HAYSTACK_CHROMIUM=… HAYSTACK_TEST_PG=… HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1 \
//     node --import ../scripts/register-generated.mjs tests-browser/retrieve.mjs
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
import { startEmbeddingStub, stubEmbeddingConfig, QUERY_PREFIX } from "./embedding-stub.mjs";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import { RetrievalMode, RetrieveRequest, RetrieveResult } from "../../generated/typescript/haystack/api/index.ts";

const PAGE = 20;
/** Non-archived records of the configured server: each is a hybrid candidate for any query (stub vectors). */
const HARBOUR = 25;
const VISIBLE = HARBOUR + 2;
/** Records whose text contains "harbour" (the archived one excluded). */
const LEXICAL = HARBOUR + 1;
const DESKTOP = { width: 1440, height: 900 };
/** Bound on waiting for the worker to publish (or re-publish) the seeded records; state is polled, not slept on. */
const INDEXING_DEADLINE_MS = 60000;
const POLL_MS = 100;
const NOT_CONFIGURED = "semantic retrieval is not configured; lexical-only capability";
const EMBEDDING_FAILED = "query embedding failed";
const lexicalNotice = (reason) => `Hybrid search is not available on this server: ${reason}; showing lexical results`;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await prerequisites("main");

let dir; let stub; let browser;
const databases = []; const backends = [];
const cleanup = async () => {
  if (browser) await browser.close();
  for (const backend of backends) await stopServer(backend);
  for (const database of databases) await database.close();
  if (stub) await stub.close();
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
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-retrieve-"));
  stub = await startEmbeddingStub();
  const password = randomBytes(32).toString("base64url");
  await writePasswordHash(path.join(dir, "human.password"), password);
  const agentToken = randomBytes(32).toString("base64url");
  await writeFile(path.join(dir, "agent.sha"), createHash("sha256").update(agentToken, "ascii").digest("hex") + "\n");
  /** One server with its own database; `embedding` null is lexical-only. */
  async function server(name, embedding) {
    const database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
    databases.push(database);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const auth = {
      activityProjectId: "agent-activity",
      users: [
        { id: "op", type: "human", displayName: "Op", enabled: true, login: "op", passwordHashFile: path.join(dir, "human.password"), tokens: [] },
        { id: "agent", type: "agent", displayName: "Agent", tokens: [{ id: "default", hashFile: path.join(dir, "agent.sha") }] },
      ],
      cookieSecure: true, allowedHosts: ["127.0.0.1"], allowedOrigins: [base], insecureHttpOrigins: [base], rateLimit: { windowMs: 60000, max: 6000 },
    };
    const config = await configFor({ database: database.runtime, port, webRoot: path.join(webRoot, "dist"), auth });
    config.retrieval.embedding = embedding;
    const configFile = path.join(dir, `${name}.json`);
    await atomicConfig(configFile, config);
    backends.push(await startServer(configFile, port, path.join(dir, `${name}.log`)));
    return { base, client: publicClient(base, agentToken) };
  }
  const configured = await server("configured", await stubEmbeddingConfig(stub, dir));
  const lexicalOnly = await server("lexical-only", null);
  let requests = 0;
  const rid = () => `0193e8d5-6f5c-7a1b-8c2d-${String(++requests).padStart(12, "0")}`;
  const docOf = (over) => JSON.stringify({ title: "t", description: "d", fields: {}, type: "fact", status: "actual", importance: "low", "human-attention": "cleared", links: [], tags: [], ...over });
  const put = (target, key, over) => target.client.put({ key, documentJson: docOf(over), expectedRevision: 0, requestId: rid() });
  for (let index = 0; index < HARBOUR; index++) {
    await put(configured, `harbour:note-${String(index).padStart(2, "0")}`, { title: `Harbour note ${index}`, description: "Crane schedule for the harbour", tags: ["harbour"] });
  }
  await put(configured, "notes:markup", { title: "Escaping <b>markup</b> in harbour notes", description: "<i>harbour</i> & <script>notes</script>" });
  await put(configured, "fleet:car", { title: "Company car pool", description: "Booking the car for site visits" });
  await put(configured, "notes:old", { title: "Archived harbour plan", status: "archived" });
  for (const index of [1, 2, 3]) await put(lexicalOnly, `harbour:plain-${index}`, { title: `Harbour plain ${index}`, description: "Lexical only" });
  // Only its description matches: the evidence is that long text, shown as a bounded snippet.
  await put(lexicalOnly, "notes:long", { title: "Long plain", description: `harbour ${"long evidence ".repeat(40)}` });

  const codec = BaboonCodecContext.Default;
  /** The configured server's own answer (agent token): `pending` of the whole scope. */
  async function pending(project) {
    const response = await fetch(`${configured.base}/api/v1/retrieve`, { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Haystack-Version": "1.0.0", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(RetrieveRequest.jsonCodec().encode(codec, new RetrieveRequest("harbour", RetrievalMode.Hybrid, project, true, 0, 1))) });
    assert.equal(response.status, 200, await response.clone().text());
    return RetrieveResult.jsonCodec().decode(codec, await response.json()).pending;
  }
  async function indexed(project) {
    const deadline = Date.now() + INDEXING_DEADLINE_MS;
    while ((await pending(project)) !== 0n) {
      assert.ok(Date.now() < deadline, "the worker publishes the seeded records within the deadline");
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  await indexed(undefined);

  browser = await chromium.launch({ executablePath: process.env.HAYSTACK_CHROMIUM, args: ["--no-sandbox", "--no-proxy-server"] });
  const view = (page) => page.locator("section.retrieve");
  const text = (page) => view(page).getByRole("textbox", { name: "Search text", exact: true });
  const modes = (page) => view(page).getByRole("group", { name: "Search mode", exact: true });
  const hits = (page) => view(page).getByRole("region", { name: "Search results" }).locator("li[data-hit-key]");
  const hitKeys = (page) => hits(page).evaluateAll((rows) => rows.map((row) => row.dataset.hitKey));
  /** Settled with `rows` hits and `mode` effective. */
  const settled = (page, mode, rows) => page.waitForFunction(([wanted, count]) => {
    const section = document.querySelector("section.retrieve");
    return section !== null && section.getAttribute("aria-busy") === "false" && section.querySelector(`[data-effective-mode="${wanted}"]`) !== null
      && section.querySelectorAll("li[data-hit-key]").length === count;
  }, [mode, rows]);
  const summary = (page) => view(page).locator("[data-effective-mode]");
  const notice = (page, kind) => view(page).locator(`[data-notice="${kind}"]`);
  const toEnd = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  /** A signed-in page on `base`; retrieval requests are recorded as the page sends them; `done` asserts no native dialogs or page errors. */
  async function open(base, hash, viewport = DESKTOP) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      window.nativeDialogs = [];
      for (const name of ["alert", "confirm", "prompt"]) window[name] = (...args) => { window.nativeDialogs.push([name, ...args]); return null; };
      window.retrievals = [];
      const send = window.fetch.bind(window);
      window.fetch = (resource, init) => {
        if (String(resource).endsWith("/api/v1/retrieve")) window.retrievals.push(JSON.parse(String(init.body)));
        return send(resource, init);
      };
    });
    const page = await context.newPage();
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
    return { page, done, retrievals: () => page.evaluate(() => window.retrievals.map((body) => body.mode)),
      requests: () => page.evaluate(() => window.retrievals.map((body) => `${body.mode}@${body.offset}`)) };
  }
  const searchHash = (params) => `#/search?${new URLSearchParams(params)}`;

  await check("search: an empty query sends no request; Search sits next to Browse; Enter runs the default hybrid over the stub embedding with its count semantics, escaped bounded snippets and an end marker", async () => {
    const { page, done, retrievals } = await open(configured.base, "#/search");
    await view(page).locator('[data-empty="idle"]').getByRole("button", { name: "token rotation", exact: true }).waitFor();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    assert.deepEqual((await nav.getByRole("link").allTextContents()).slice(0, 2), ["Browse", "Search"]);
    assert.equal(await nav.getByRole("link", { name: "Search", exact: true }).getAttribute("aria-current"), "page");
    assert.deepEqual(await retrievals(), [], "an empty query is not searched");
    const queried = stub.requests.length;
    await text(page).fill("harbour");
    await text(page).press("Enter");
    await settled(page, "Hybrid", PAGE);
    assert.equal(new URL(page.url()).hash, "#/search?q=harbour", "no explicit mode in the route");
    assert.match(await summary(page).innerText(), new RegExp(`^Mode Hybrid \\(default\\) · ${VISIBLE} records in the candidate window \\(ranking limit \\d+\\)$`));
    assert.ok(stub.requests.slice(queried).some((input) => input.includes(`${QUERY_PREFIX}harbour`)), "the server embedded the query through the stub");
    assert.equal(await modes(page).getByRole("button", { name: "Default", exact: true }).getAttribute("aria-pressed"), "true");
    for (const mode of ["Semantic", "Hybrid"]) assert.equal(await modes(page).getByRole("button", { name: mode, exact: true }).getAttribute("aria-disabled"), null);
    assert.equal(await notice(page, "lexical").count(), 0);
    assert.equal(await notice(page, "pending").count(), 0, "every record in scope is published");
    assert.equal(await view(page).locator(".viewbar-meta").innerText(), `${PAGE} loaded · more available`);
    await toEnd(page);
    await settled(page, "Hybrid", VISIBLE);
    assert.equal(new Set(await hitKeys(page)).size, VISIBLE, "appended pages carry no duplicates");
    assert.equal(await view(page).locator("[data-list-end]").innerText(), `End of the candidate window · ${VISIBLE} records`);
    assert.deepEqual(await retrievals(), ["Hybrid", "Hybrid"]);
    const markup = view(page).locator('li[data-hit-key="notes:markup"]');
    const evidence = markup.locator("p");
    assert.equal(await evidence.locator("*").count(), 0, "evidence text is escaped, never markup");
    assert.match(await evidence.innerText(), /<(b|i|script)>/, "markup in the evidence is shown as text");
    assert.match(await markup.innerText(), /revision 1 · (title|description) · \/(title|description)/, "revision, field and pointer of the evidence");
    const scrollers = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
    }).length);
    assert.equal(scrollers, 0, "no element scrolls vertically but the document");
    await page.evaluate(() => window.scrollTo(0, 600));
    assert.equal(await page.evaluate(() => document.querySelector("section.retrieve .viewbar").getBoundingClientRect().top),
      await page.evaluate(() => document.querySelector(".masthead").getBoundingClientRect().height), "the view bar sticks under the masthead");
    await done();
  });

  await check("search: a hit opens its record; Back returns to Search with the query, mode, loaded hits, scroll and focus, without searching again", async () => {
    const { page, done, retrievals } = await open(configured.base, searchHash({ q: "harbour" }));
    await settled(page, "Hybrid", PAGE);
    await toEnd(page);
    await settled(page, "Hybrid", VISIBLE);
    const key = (await hitKeys(page))[PAGE + 2];
    const link = view(page).locator(`li[data-hit-key="${key}"]`).getByRole("link", { name: key, exact: true });
    await link.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    const scrollY = await page.evaluate(() => window.scrollY);
    assert.ok(scrollY > 0);
    await link.click();
    await page.getByRole("button", { name: "Back to Search", exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).hash, `#/item/${encodeURIComponent(key)}`);
    assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search", exact: true }).getAttribute("aria-current"), "page",
      "the record keeps its originating view highlighted");
    await page.goBack();
    await settled(page, "Hybrid", VISIBLE);
    assert.equal(new URL(page.url()).hash, "#/search?q=harbour");
    assert.equal(await text(page).inputValue(), "harbour");
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollY) <= 2, "the scroll position is restored");
    assert.equal(await link.evaluate((element) => element === document.activeElement), true, "focus returns to the opened hit");
    assert.deepEqual(await retrievals(), ["Hybrid", "Hybrid"], "the loaded hits are kept, not searched again");
    await done();
  });

  await check("search: a lexical-only server searches lexically by default with the reason; semantic and hybrid are disabled with it; an explicit semantic route is refused", async () => {
    const { page, done, retrievals } = await open(lexicalOnly.base, searchHash({ q: "harbour" }));
    await settled(page, "Lexical", 4);
    assert.equal(await summary(page).innerText(), "Mode Lexical (default) · 4 exact matches");
    assert.equal(await notice(page, "lexical").innerText(), lexicalNotice(NOT_CONFIGURED));
    for (const mode of ["Semantic", "Hybrid"]) {
      const button = modes(page).getByRole("button", { name: mode, exact: true });
      assert.equal(await button.getAttribute("aria-disabled"), "true");
      assert.equal(await button.getAttribute("title"), `${mode}: Not configured on this server`);
    }
    assert.equal(await page.getByText("Semantic and Hybrid: not configured on this server", { exact: true }).isVisible(), true, "the reason is visible, not only a tooltip");
    // aria-disabled keeps the control focusable (its reason is announced); activating it does nothing.
    await modes(page).getByRole("button", { name: "Semantic", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).hash, "#/search?q=harbour", "a disabled mode does nothing");
    assert.deepEqual(await retrievals(), ["Lexical"]);
    assert.equal(await view(page).locator("[data-list-end]").innerText(), "End of list · 4 records");
    const long = await view(page).locator('li[data-hit-key="notes:long"] p').innerText();
    assert.ok(long.length === 241 && long.endsWith("…"), "long evidence is cut to a bounded snippet");
    await page.evaluate((hash) => { location.hash = hash; }, searchHash({ q: "harbour", mode: "semantic" }));
    const refusal = notice(page, "unavailable");
    await refusal.waitFor();
    assert.match(await refusal.innerText(), new RegExp(`Semantic search is unavailable\\s+The server answered: ${NOT_CONFIGURED}\\. No other mode was used\\.`));
    assert.equal(await hits(page).count(), 0);
    assert.deepEqual(await retrievals(), ["Lexical", "Semantic"], "an explicit mode is requested exactly, never substituted");
    await done();
  });

  await check("search: with the embedding stub stopped a defaulted hybrid is re-run lexically once and shows the server's reason; a failing re-run keeps that mode and notice with the error; Search and Retry search again", async () => {
    await stub.stop();
    try {
      const { page, done, retrievals } = await open(configured.base, searchHash({ q: "harbour" }));
      await settled(page, "Lexical", PAGE);
      assert.equal(await notice(page, "lexical").innerText(), lexicalNotice(EMBEDDING_FAILED));
      assert.match(await summary(page).innerText(), new RegExp(`^Mode Lexical \\(default\\) · ${LEXICAL} exact matches$`));
      assert.deepEqual(await retrievals(), ["Hybrid", "Lexical"], "one lexical re-run");
      // The lexical re-run itself fails: the attempted mode and the downgrade notice stay shown with the error.
      await page.route("**/api/v1/retrieve", (route) => route.request().postDataJSON().mode === "Lexical" ? route.abort() : route.continue());
      await view(page).getByRole("button", { name: "Search", exact: true }).click();
      const failure = view(page).getByRole("alert").filter({ hasText: "Search failed" });
      await failure.waitFor();
      assert.match(await failure.innerText(), /Server unreachable/);
      assert.equal(await notice(page, "lexical").innerText(), lexicalNotice(EMBEDDING_FAILED), "the downgrade is never silent");
      assert.equal(await summary(page).innerText(), "Mode Lexical (default)");
      await page.unroute("**/api/v1/retrieve");
      await failure.getByRole("button", { name: "Retry", exact: true }).click();
      await settled(page, "Lexical", PAGE);
      assert.deepEqual(await retrievals(), ["Hybrid", "Lexical", "Hybrid", "Lexical", "Hybrid", "Lexical"], "Search and Retry of unchanged values search again");
      await done();
    } finally { await stub.start(); }
  });

  await check("search: when the embedding fails after the first page, a default search restarts lexically from offset 0 with the notice; an explicit one keeps its hits and offers the lexical search", async () => {
    {
      const { page, done, requests } = await open(configured.base, searchHash({ q: "harbour" }));
      await settled(page, "Hybrid", PAGE);
      await stub.stop();
      try {
        await toEnd(page);
        await settled(page, "Lexical", PAGE);
        assert.equal(await notice(page, "lexical").innerText(), lexicalNotice(EMBEDDING_FAILED));
        assert.match(await summary(page).innerText(), new RegExp(`^Mode Lexical \\(default\\) · ${LEXICAL} exact matches$`));
        assert.deepEqual(await requests(), ["Hybrid@0", "Hybrid@20", "Lexical@0"], "the lexical search starts again: rankings are not mixed");
        await done();
      } finally { await stub.start(); }
    }
    {
      const { page, done, requests } = await open(configured.base, searchHash({ q: "harbour", mode: "hybrid" }));
      await settled(page, "Hybrid", PAGE);
      await stub.stop();
      try {
        await toEnd(page);
        const refusal = notice(page, "unavailable");
        await refusal.waitFor();
        assert.match(await refusal.innerText(), new RegExp(`Hybrid search is unavailable\\.\\s+The server answered: ${EMBEDDING_FAILED}\\. The ${PAGE} records above are kept; no other mode was used\\.`));
        assert.equal(await hits(page).count(), PAGE, "the explicit mode's hits stay");
        assert.equal(await notice(page, "lexical").count(), 0, "an explicit mode is not downgraded");
        await refusal.getByRole("button", { name: "Search lexically instead", exact: true }).click();
        await settled(page, "Lexical", PAGE);
        assert.equal(new URL(page.url()).hash, "#/search?q=harbour&mode=lexical");
        assert.deepEqual(await requests(), ["Hybrid@0", "Hybrid@20", "Lexical@0"]);
        await done();
      } finally { await stub.start(); }
    }
  });

  await check("search: an address with the same values in another spelling searches again on the first Search", async () => {
    const { page, done, retrievals } = await open(configured.base, "#/search?q=harbour%20note");
    await settled(page, "Hybrid", PAGE);
    await stub.stop();
    try {
      await view(page).getByRole("button", { name: "Search", exact: true }).click();
      // Rendered proof that a search ran: with the stub stopped the defaulted hybrid now falls back.
      await notice(page, "lexical").waitFor();
      await settled(page, "Lexical", PAGE);
      assert.deepEqual(await retrievals(), ["Hybrid", "Hybrid", "Lexical"]);
      await done();
    } finally { await stub.start(); }
  });

  await check("search: an explicitly chosen semantic search with the stub stopped is refused with the reason; Search lexically instead runs it lexically", async () => {
    await stub.stop();
    try {
      const { page, done, retrievals } = await open(configured.base, searchHash({ q: "harbour", mode: "semantic" }));
      const refusal = notice(page, "unavailable");
      await refusal.waitFor();
      assert.match(await refusal.innerText(), new RegExp(`Semantic search is unavailable\\s+The server answered: ${EMBEDDING_FAILED}\\. No other mode was used\\.`));
      assert.equal(await summary(page).innerText(), "Mode Semantic (chosen)");
      assert.equal(await hits(page).count(), 0);
      assert.equal(await modes(page).getByRole("button", { name: "Semantic", exact: true }).getAttribute("aria-pressed"), "true");
      await refusal.getByRole("button", { name: "Search lexically instead", exact: true }).click();
      await settled(page, "Lexical", PAGE);
      assert.equal(new URL(page.url()).hash, "#/search?q=harbour&mode=lexical");
      assert.match(await summary(page).innerText(), new RegExp(`^Mode Lexical \\(chosen\\) · ${LEXICAL} exact matches$`));
      assert.equal(await notice(page, "lexical").count(), 0, "an explicit lexical search has no fallback notice");
      assert.deepEqual(await retrievals(), ["Semantic", "Lexical"]);
      await done();
    } finally { await stub.start(); }
  });

  await check("search: a just-written record not yet indexed for semantic search is declared by the pending notice", async () => {
    const hold = stub.hold((input) => input.includes("fresh-marker"));
    try {
      await put(configured, "fresh:new", { title: "fresh-marker harbour arrival" });
      const { page, done } = await open(configured.base, searchHash({ q: "harbour", project: "fresh" }));
      await settled(page, "Hybrid", 0);
      assert.equal(await notice(page, "pending").innerText(), "1 item is not yet indexed for semantic search; results may be incomplete");
      assert.equal(await view(page).getByRole("textbox", { name: "Project (exact)", exact: true }).inputValue(), "fresh");
      await view(page).locator('[data-empty="no-matches"]').waitFor();
      await done();
    } finally { hold.release(); }
    await indexed("fresh");
  });

  await check("search: the mode control is reachable by keyboard from the search text and applies the chosen mode", async () => {
    const { page, done, retrievals } = await open(configured.base, searchHash({ q: "harbour" }));
    await settled(page, "Hybrid", PAGE);
    await text(page).focus();
    const lexical = modes(page).getByRole("button", { name: "Lexical", exact: true });
    for (let presses = 0; presses < 6 && !(await lexical.evaluate((element) => element === document.activeElement)); presses++) await page.keyboard.press("Tab");
    assert.equal(await lexical.evaluate((element) => element === document.activeElement), true, "Tab reaches the mode control");
    await page.keyboard.press("Space");
    await settled(page, "Lexical", PAGE);
    assert.equal(new URL(page.url()).hash, "#/search?q=harbour&mode=lexical");
    assert.equal(await lexical.getAttribute("aria-pressed"), "true");
    assert.match(await summary(page).innerText(), /^Mode Lexical \(chosen\)/);
    assert.deepEqual(await retrievals(), ["Hybrid", "Lexical"]);
    await done();
  });
} finally { await cleanup(); }
console.log(`# ${results.length} checks; ${failures} failures; 0 skipped`);
process.exit(failures === 0 ? 0 : 1);
