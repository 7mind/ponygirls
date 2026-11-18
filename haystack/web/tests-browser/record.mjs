// Record page (spec §3.2 Record, §5, §8): typed fields with the sanitised Markdown pipeline, history snapshots,
// comparison and restore through the in-app dialog, attention clearing and Back to the originating preset, the
// document as the only scroller. Real pinned Chromium against the selected Scala/native server (HAYSTACK_SERVER_COMMAND)
// and an owned PostgreSQL database; waits only for rendered state.
// Runs alone after `npm run build`: node --import ../scripts/register-generated.mjs tests-browser/record.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { prerequisites } from "./prerequisites.mjs";
import { writePasswordHash } from "./credentials.mjs";
import { ownedDatabase, configFor, atomicConfig, startServer, stopServer, publicClient, freePort } from "./native.mjs";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import { SearchRequest, SearchResult, SearchSort } from "../../generated/typescript/haystack/api/index.ts";

const MASTHEAD_PX = 48;
const VIEWBAR_PX = 56;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** Playwright's default wait, for the case's own held requests. */
const WAIT_MS = 30_000;
/** The record page's bound on one record read (record-reads.ts). */
const RECORD_READ_TIMEOUT_MS = 15_000;
const here = path.dirname(fileURLToPath(import.meta.url));

await prerequisites("main");

let database; let dir; let backend; let browser;
const cleanup = async () => {
  if (browser) await browser.close();
  await stopServer(backend);
  if (database) await database.close();
  if (dir) await rm(dir, { recursive: true, force: true });
};
process.once("SIGTERM", () => { void cleanup().finally(() => process.exit(143)); });
const results = [];
try {
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-record-"));
  database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
  const password = randomBytes(32).toString("base64url");
  await writePasswordHash(path.join(dir, "human.password"), password);
  const agentToken = randomBytes(32).toString("base64url");
  await writeFile(path.join(dir, "agent.sha"), createHash("sha256").update(agentToken, "ascii").digest("hex") + "\n");
  await writeFile(path.join(dir, "human.sha"), createHash("sha256").update(randomBytes(32).toString("base64url"), "ascii").digest("hex") + "\n");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    activityProjectId: "agent-activity",
    users: [
      { id: "op", type: "human", displayName: "Op", enabled: true, login: "op", passwordHashFile: path.join(dir, "human.password"), tokens: [{ id: "browser", hashFile: path.join(dir, "human.sha") }] },
      { id: "agent", type: "agent", displayName: "Agent", tokens: [{ id: "default", hashFile: path.join(dir, "agent.sha") }] },
    ],
    cookieSecure: true, allowedHosts: ["127.0.0.1"], allowedOrigins: [base], insecureHttpOrigins: [base], rateLimit: { windowMs: 60000, max: 600 },
  };
  const configFile = path.join(dir, "config.json");
  await atomicConfig(configFile, await configFor({ database: database.runtime, port, webRoot: path.resolve(here, "../dist"), auth }));
  backend = await startServer(configFile, port, path.join(dir, "server.log"));

  const seed = publicClient(base, agentToken);
  let requests = 0;
  const rid = () => `0193e8d5-6f5c-7a1b-8c2d-${String(++requests).padStart(12, "0")}`;
  const docOf = (over) => JSON.stringify({ title: "t", description: "d", fields: {}, type: "fact", status: "actual", importance: "low", "human-attention": "cleared", links: [], ...over });
  const withFields = (over, fields) => docOf(over).replace('"fields":{}', `"fields":${fields}`);
  const search = async (query) => {
    const context = BaboonCodecContext.Default;
    const response = await fetch(`${base}/api/v1/search`, { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Haystack-Version": "1.0.0", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(SearchRequest.jsonCodec().encode(context, new SearchRequest(query, undefined, 100, undefined, new SearchSort("key", "asc")))) });
    assert.equal(response.status, 200);
    return SearchResult.jsonCodec().decode(context, await response.json()).items.map((item) => `${item.project}:${item.item}`);
  };

  // NOTE: raw JSON text — a JS number literal would round before serialization.
  await seed.put({ key: "ui:note", documentJson: '{"title":"hello memory","description":"d","fields":{"n":9007199254740993},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}', expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:xss", documentJson: docOf({ title: '<script>alert("xss")</script><img src=x onerror=alert(2)>', description: "javascript:alert(3)" }), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:todo", documentJson: docOf({ title: "needs attention", type: "todo", "human-attention": "required" }), expectedRevision: 0, requestId: rid() });
  const skillMarkdown = [
    "---", "name: verify-release", "description: Verify a release artifact", "---", "# Verify a release", "",
    "Check the **artifact** and keep `raw bytes`.", "", "```typescript", "const value: number = 7;", "```", "",
    "| Check | Result |", "| --- | --- |", "| Digest | Match |", "",
    '[documentation](https://example.invalid/docs) [unsafe](javascript:alert(8))',
    '<script>alert(9)</script><img src=x onerror=alert(10)>',
    '![tracking](https://example.invalid/haystack-track.png)', "",
    "```html", '<img src=x onerror="alert(11)">', "```", "",
    ...Array.from({ length: 40 }, (_, i) => `- step ${i}: verify the artifact digest and record the outcome`),
  ].join("\n");
  const snippetContent = "{ pkgs }: { packages = [ pkgs.git ]; }";
  const semanticFields = '{"label":"Literal **not bold**\\n🐎","count":9007199254740993,' +
    '"precision":0.12345678901234567890123456789,"enabled":true,"empty":null,' +
    '"config":{"nested":9007199254740993,"tags":["one","two"],"enabled":false,"note":"long enough to be shown as an indented block"},"tags":["one",2,null],' +
    `"skill":${JSON.stringify({ type: "md", content: skillMarkdown })},` +
    `"snippet":${JSON.stringify({ type: "code", language: "nix", content: snippetContent })},` +
    '"literal":{"type":"text","content":"# Literal *text*"},' +
    '"unknown":{"type":"html","content":"<b>preserved</b>"},' +
    '"extended":{"type":"md","content":"# preserved content","filename":"SKILL.md"},' +
    '"unsupported":{"type":"code","language":"fabricated-language","content":"literal <script>alert(12)</script>"}}';
  await seed.put({ key: "ui:semantic", documentJson: withFields({ title: "Semantic fields", type: "skill-draft" }, semanticFields), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:semantic", documentJson: withFields({ title: "Semantic fields, revised", type: "skill-draft" }, semanticFields), expectedRevision: 1, requestId: rid() });
  await seed.put({ key: "ui:root-array", documentJson: docOf({ title: "Root array", fields: ["literal", true, null] }), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:root-markdown", documentJson: docOf({ title: "Root Markdown", fields: { type: "md", content: "# Root content\n\nA paragraph." } }), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:history", documentJson: withFields({ title: "History one", importance: "low" }, '{"due":"2026-11-24","n":9007199254740993}'), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:history", documentJson: withFields({ title: "History two", importance: "high" }, '{"due":"2026-12-01","n":9007199254740993}'), expectedRevision: 1, requestId: rid() });
  await seed.put({ key: "ui:history", documentJson: withFields({ title: "History three", importance: "high", "human-attention": "required" }, '{"due":"2026-12-01","n":9007199254740993}'), expectedRevision: 2, requestId: rid() });
  await seed.put({ key: "ui:late-a", documentJson: docOf({ title: "Left behind" }), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:late-a", documentJson: docOf({ title: "Left behind, revised" }), expectedRevision: 1, requestId: rid() });
  await seed.put({ key: "ui:late-link", documentJson: docOf({ title: "Links to the record left behind", links: [["relates-to", "ui:late-a"]] }), expectedRevision: 0, requestId: rid() });
  await seed.put({ key: "ui:late-b", documentJson: docOf({ title: "Arrived at" }), expectedRevision: 0, requestId: rid() });

  browser = await chromium.launch({ executablePath: process.env.HAYSTACK_CHROMIUM, args: ["--no-sandbox", "--no-proxy-server"] });
  const signIn = await browser.newContext();
  {
    const page = await signIn.newPage();
    await page.goto(`${base}/#/browse`);
    await page.getByLabel("Username", { exact: true }).fill("op");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
  }
  const storageState = await signIn.storageState();
  await signIn.close();

  /** A signed-in page; native dialogs and page errors are recorded and asserted absent by `quiet()`. */
  async function open(viewport = DESKTOP) {
    const context = await browser.newContext({ viewport, storageState });
    await context.addInitScript(() => {
      window.nativeDialogs = [];
      for (const name of ["alert", "confirm", "prompt"]) window[name] = (...args) => { window.nativeDialogs.push([name, ...args]); return null; };
    });
    const page = await context.newPage();
    const dialogs = [], errors = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.quiet = async () => {
      assert.deepEqual(dialogs, [], "no native dialog opens");
      assert.deepEqual(await page.evaluate(() => window.nativeDialogs), [], "window.alert/confirm/prompt are never called");
      assert.deepEqual(errors, [], "no page errors");
    };
    return { context, page };
  }
  const record = async (page, key) => {
    await page.goto(`${base}/#/item/${encodeURIComponent(key)}`);
    await page.locator('[data-record="ready"]').waitFor();
  };
  const field = (page, name) => page.getByRole("region", { name: `Field: ${name}`, exact: true });
  const value = (page, name) => field(page, name).locator("[data-field-value]");
  const check = async (name, run) => {
    console.log(`# check - ${name}`);
    try { await run(); results.push(`ok - ${name}`); console.log(`ok - ${name}`); }
    catch (error) { results.push(`FAIL - ${name}`); console.error(error); process.exitCode = 1; }
  };

  await check("semantic fields preserve scalar types and exact nested numbers through history", async () => {
    const { context, page } = await open();
    try {
      await record(page, "ui:semantic");
      assert.equal(await value(page, "label").textContent(), "Literal **not bold**\n🐎");
      assert.equal(await field(page, "label").locator("strong").count(), 0);
      assert.equal(await value(page, "count").textContent(), "9007199254740993");
      assert.equal(await value(page, "precision").textContent(), "0.12345678901234567890123456789");
      assert.equal(await value(page, "enabled").textContent(), "true");
      assert.equal(await value(page, "empty").textContent(), "null");
      const config = field(page, "config").locator("pre");
      assert.match(await config.textContent(), /\n\s+"nested": 9007199254740993/);
      assert.ok(await config.locator(".hljs-attr").count() > 0, "object keys have syntax highlighting");
      assert.ok(await config.locator(".hljs-number").count() > 0, "nested numbers have syntax highlighting");
      assert.equal(await value(page, "tags").textContent(), '["one",2,null]', "short JSON is an exact compact row");
      assert.match(await field(page, "unknown").locator("pre").textContent(), /<b>preserved<\/b>/);
      assert.match(await field(page, "extended").locator("pre").textContent(), /"filename": "SKILL.md"/);
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "View raw JSON", exact: true }).click();
      const raw = page.getByRole("region", { name: "Fields JSON", exact: true }).locator("pre");
      assert.match(await raw.textContent(), /"precision": 0\.12345678901234567890123456789/);
      assert.match(await raw.textContent(), /"count": 9007199254740993/);
      await page.getByRole("button", { name: "Typed view", exact: true }).click();
      await page.getByRole("button", { name: "View revision 1", exact: true }).click();
      await page.getByRole("region", { name: "Snapshot", exact: true }).getByText("Viewing revision 1 of 2").waitFor();
      const changes = page.getByRole("region", { name: "Changes: metadata", exact: true });
      assert.deepEqual(await changes.locator("del, ins").allTextContents(), ["Semantic fields", "Semantic fields, revised"]);
      await page.getByText(/^Unchanged in both revisions: .*\bcount\b/).waitFor();
      await page.getByRole("button", { name: "Revision 1 only", exact: true }).click();
      assert.equal(await value(page, "count").textContent(), "9007199254740993");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("typed Markdown and snippets highlight content without executing or fetching it", async () => {
    const { context, page } = await open();
    try {
      const imageRequests = [];
      page.on("request", (request) => { if (request.url().includes("haystack-track")) imageRequests.push(request.url()); });
      await record(page, "ui:semantic");
      const skill = field(page, "skill");
      const heading = skill.getByRole("heading", { name: "Verify a release", exact: true });
      assert.equal(await heading.evaluate((element) => element.tagName), "H4", "Markdown headings are demoted below the page title");
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, "one page title");
      assert.equal(await skill.locator("strong").first().textContent(), "artifact");
      assert.equal(await skill.locator("table").count(), 1);
      assert.ok(await skill.locator('[aria-label="YAML frontmatter"] .hljs-attr').count() > 0);
      assert.equal(await skill.locator('code[data-language="typescript"] .hljs-keyword').textContent(), "const");
      assert.equal(await skill.locator('code[data-language="typescript"] .hljs-number').textContent(), "7");
      assert.equal(await page.locator("img").count(), 0);
      assert.equal(await skill.locator('a[href^="javascript:"]').count(), 0);
      assert.ok((await skill.getByRole("link", { name: "documentation", exact: true }).getAttribute("rel")).includes("noreferrer"));
      assert.deepEqual(imageRequests, []);
      const snippet = field(page, "snippet").locator("pre");
      assert.equal(await snippet.textContent(), snippetContent);
      assert.ok(await snippet.locator("span").count() > 0);
      assert.equal(await field(page, "literal").locator("pre").textContent(), "# Literal *text*");
      const unsupported = field(page, "unsupported");
      await unsupported.getByText(/Unsupported language/).waitFor();
      assert.equal(await unsupported.locator("pre").textContent(), "literal <script>alert(12)</script>");
      assert.equal(await unsupported.locator("pre span").count(), 0);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize(PHONE);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "semantic mobile fields overflow");
      await skill.getByRole("group", { name: "View of skill", exact: true }).getByRole("button", { name: "Source", exact: true }).click();
      assert.equal(await skill.locator("pre").textContent(), skillMarkdown);
      assert.equal(await heading.count(), 0, "the source view renders no Markdown");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("root arrays and typed Markdown remain renderable", async () => {
    const { context, page } = await open();
    try {
      await record(page, "ui:root-array");
      assert.equal(await value(page, "Value").textContent(), '["literal",true,null]');
      await record(page, "ui:root-markdown");
      await field(page, "Value").getByRole("heading", { name: "Root content", exact: true }).waitFor();
    } finally { await context.close(); }
  });

  await check("fidelity + inert rendering, and an unknown key is a page state", async () => {
    const { context, page } = await open();
    try {
      await record(page, "ui:note");
      assert.equal(await value(page, "n").textContent(), "9007199254740993");
      await record(page, "ui:xss");
      // Literal payload text is visible, but nothing executed and no raw elements were created.
      assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), '<script>alert("xss")</script><img src=x onerror=alert(2)>');
      await page.getByText("javascript:alert(3)", { exact: true }).waitFor();
      assert.equal(await page.locator("img").count(), 0);
      await record(page, "ui:semantic");
      await page.goto(`${base}/#/item/${encodeURIComponent("ui:does-not-exist")}`);
      await page.getByRole("heading", { name: "Record not found", exact: true }).waitFor();
      await page.locator('[data-record="missing"]').getByRole("button", { name: "Back to Browse", exact: true }).first().click();
      await page.waitForFunction(() => location.hash === "#/browse");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("history: a snapshot compares revisions and restores through the in-app dialog", async () => {
    const { context, page } = await open();
    try {
      await record(page, "ui:history");
      await page.getByRole("button", { name: "View revision 1", exact: true }).click();
      const banner = page.getByRole("region", { name: "Snapshot", exact: true });
      await banner.getByText("Viewing revision 1 of 3").waitFor();
      assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0, "a snapshot is read-only");
      await page.getByRole("heading", { name: "Changes from revision 1 to revision 3", exact: true }).waitFor();
      const changes = page.getByRole("region", { name: "Changes: metadata", exact: true });
      assert.deepEqual(await changes.locator("del, ins").allTextContents(), ["History one", "History three", "low", "high", "cleared", "required"]);
      const due = page.getByRole("region", { name: "Changes: due", exact: true });
      assert.deepEqual(await due.locator("[data-diff]").evaluateAll((lines) => lines.map((line) => [line.dataset.diff, line.textContent])),
        [["del", "Removed: 2026-11-24"], ["add", "Added: 2026-12-01"]]);
      // The viewed revision's complete fields JSON, exact, before restoring it; Typed view and Changes lead back.
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "View raw JSON", exact: true }).click();
      const raw = await page.getByRole("region", { name: "Fields JSON", exact: true }).locator("pre").textContent();
      assert.deepEqual([/"due": "2026-11-24"/.test(raw), /"n": 9007199254740993/.test(raw)], [true, true], "raw JSON of revision 1");
      await page.getByRole("button", { name: "Typed view", exact: true }).click();
      assert.equal(await value(page, "due").textContent(), "2026-11-24");
      await page.getByRole("button", { name: "Changes", exact: true }).click();
      await page.getByRole("heading", { name: "Changes from revision 1 to revision 3", exact: true }).waitFor();
      await banner.getByLabel("Compare with").selectOption("2");
      await page.getByRole("heading", { name: "Changes from revision 1 to revision 2", exact: true }).waitFor();
      // Restore asks first; Cancel is focused, Escape closes and returns focus to the trigger without writing.
      const restore = banner.getByRole("button", { name: "Restore as new revision", exact: true });
      await restore.click();
      const dialog = page.getByRole("dialog", { name: "Restore revision 1?", exact: true });
      await dialog.getByText("4 values differ from the latest revision: title, importance, human-attention, due.", { exact: true }).waitFor();
      assert.match(await dialog.textContent(), /saved again as a new revision 4/);
      assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate((element) => element === document.activeElement), true, "Cancel is focused by default");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await restore.evaluate((element) => element === document.activeElement), true, "focus returns to the trigger");
      assert.equal((await seed.get("ui:history")).revision, 3, "a cancelled restore writes nothing");
      await restore.click();
      await dialog.getByRole("button", { name: "Restore as revision 4", exact: true }).click();
      await page.getByText("Restored revision 1 as new revision 4", { exact: true }).waitFor();
      await page.locator('[data-record="ready"]').waitFor();
      const restored = await seed.get("ui:history");
      assert.equal(restored.revision, 4);
      const { fields, tags, ...document } = JSON.parse(restored.document.json);
      const expected = JSON.parse(docOf({ title: "History one", importance: "low" }));
      delete expected.fields;
      assert.deepEqual({ document, tags, due: fields.due }, { document: expected, tags: [], due: "2026-11-24" });
      assert.match(restored.document.json, /"n":9007199254740993/, "restored fields keep exact numbers");
      assert.equal(restored.metadata.modifiedBy, "op");
      await page.getByRole("heading", { name: "History one", exact: true }).waitFor();
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("attention: a record opened from Inbox clears its attention, and Back returns to Inbox", async () => {
    const { context, page } = await open();
    try {
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await page.goto(`${base}/#/inbox`);
      await page.locator('[data-list="inbox"] [data-row-id="ui:todo"]').getByText("needs attention", { exact: true }).click();
      await page.locator('[data-record="ready"]').waitFor();
      assert.deepEqual(await nav.locator('[aria-current="page"]').allTextContents().then((texts) => texts.map((text) => text.replace(/\d+$/, ""))), ["Inbox"], "the record keeps Inbox current");
      await page.getByRole("note").getByRole("button", { name: "Clear attention", exact: true }).click();
      await page.getByText("Attention cleared · saved as revision 2", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear attention", exact: true }).first().waitFor({ state: "detached" });
      const cleared = await seed.get("ui:todo");
      assert.equal(JSON.parse(cleared.document.json)["human-attention"], "cleared");
      assert.equal(cleared.metadata.modifiedBy, "op");
      assert.equal((await search("human-attention:required")).includes("ui:todo"), false, "the record left the Inbox query");
      await page.getByRole("button", { name: "Back to Inbox", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#/inbox");
      await page.locator('[data-list="inbox"]').waitFor();
      await page.quiet();
      // Opened without an in-app list entry (a pasted link), Back goes to Browse.
      const pasted = await context.newPage();
      await record(pasted, "ui:todo");
      await pasted.getByRole("button", { name: "Back to Browse", exact: true }).click();
      await pasted.waitForFunction(() => location.hash === "#/browse");
    } finally { await context.close(); }
  });

  await check("a record read that never answers ends after the page's timeout with Retry, and Retry loads the record", async () => {
    const { context, page } = await open();
    try {
      // No live connection: nothing but the held read and Retry reads the record.
      await page.routeWebSocket("**/api/v1/live", () => {});
      await page.clock.install();
      await page.route("**/api/v1/get", () => {}, { times: 1 });
      const sent = page.waitForRequest("**/api/v1/get");
      await page.goto(`${base}/#/item/${encodeURIComponent("ui:late-b")}`);
      await sent;
      await page.clock.runFor(RECORD_READ_TIMEOUT_MS);
      const failed = page.locator('[data-record="failed"]');
      await failed.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("heading", { name: "Arrived at", exact: true }).waitFor();
      await page.quiet();
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    }
  });

  await check("late answers for a record that was left change nothing on the record opened next", async () => {
    const { context, page } = await open();
    try {
      const left = "ui:late-a";
      const held = [];
      let heldChanged = () => {};
      /** Holds the answers of requests about `left` until `release`. */
      const hold = (about) => async (route) => {
        if (!about(route.request().postDataJSON())) { await route.fallback(); return; }
        const gate = new Promise((resolve) => { held.push(resolve); });
        heldChanged();
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      };
      /** Resolves once `count` requests are held; fails after the same bound as a locator wait. */
      const holding = (count) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${count} held requests did not happen`)), WAIT_MS);
        heldChanged = () => { if (held.length >= count) { clearTimeout(timer); resolve(); } };
        heldChanged();
      });
      const release = async () => {
        const finished = new Promise((resolve, reject) => {
          let pending = held.length;
          const timer = setTimeout(() => reject(new Error("the held answers did not arrive")), WAIT_MS);
          const finish = (request) => {
            if (!/\/api\/v1\/(get|history|search)$/.test(request.url()) || !JSON.stringify(request.postDataJSON()).includes(left) || --pending > 0) return;
            clearTimeout(timer); page.off("requestfinished", finish); resolve();
          };
          page.on("requestfinished", finish);
        });
        for (const resolve of held.splice(0)) resolve();
        await finished;
        // The answers are in the page: let it apply whatever it would.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      const arrived = async () => {
        assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Arrived at");
        assert.equal(await page.locator(".record-sub").getByText("Revision 1", { exact: true }).count(), 1);
        assert.equal(await page.getByRole("region", { name: "History", exact: true }).getByText("1 revision", { exact: true }).count(), 1);
        assert.equal(await page.locator('[aria-label="Incoming links"]').getByText("No record links here.", { exact: true }).count(), 1);
      };
      // Its history and incoming links answer after the next record is shown.
      await page.route("**/api/v1/history", hold((body) => body.key === left));
      await page.route("**/api/v1/search", hold((body) => body.query.includes(left)));
      await record(page, left);
      await page.evaluate((key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }, "ui:late-b");
      await page.getByRole("region", { name: "History", exact: true }).getByText("1 revision", { exact: true }).waitFor();
      await page.locator('[aria-label="Incoming links"]').getByText("No record links here.", { exact: true }).waitFor();
      await holding(2);
      await release();
      await arrived();
      // Its record answers after the next record is shown.
      await page.route("**/api/v1/get", hold((body) => body.key === left));
      await page.evaluate((key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }, left);
      await page.locator('[data-record="loading"]').waitFor();
      await page.evaluate((key) => { location.hash = `#/item/${encodeURIComponent(key)}`; }, "ui:late-b");
      await page.getByRole("heading", { name: "Arrived at", exact: true }).waitFor();
      await page.getByRole("region", { name: "History", exact: true }).getByText("1 revision", { exact: true }).waitFor();
      await holding(1);
      await release();
      await arrived();
      await page.quiet();
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    }
  });

  await check("record page: the document is the only scroller; the header bar and the snapshot banner stick", async () => {
    const { context, page } = await open();
    try {
      await record(page, "ui:semantic");
      await page.getByRole("button", { name: "View revision 1", exact: true }).click();
      await page.getByRole("button", { name: "Revision 1 only", exact: true }).click();
      await field(page, "skill").waitFor();
      const layout = await page.evaluate(() => {
        scrollTo(0, 1500);
        const scrollers = [...document.querySelectorAll("body *")].filter((element) => {
          const style = getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
        }).map((element) => `${element.tagName}.${element.getAttribute("class")}`);
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        return { scrollers, scrollY: Math.round(scrollY), scrollable: document.scrollingElement.scrollHeight > innerHeight,
          overflowX: document.documentElement.scrollWidth > innerWidth, bar: top(".record-bar"), banner: top('[aria-label="Snapshot"]') };
      });
      assert.deepEqual(layout, { scrollers: [], scrollY: 1500, scrollable: true, overflowX: false, bar: MASTHEAD_PX, banner: MASTHEAD_PX + VIEWBAR_PX });
      await page.setViewportSize(PHONE);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow at 390 px");
      await page.quiet();
    } finally { await context.close(); }
  });
} finally { await cleanup(); }
console.log(`# ${results.length} checks; ${results.filter((line) => line.startsWith("FAIL")).length} failures; 0 skipped`);
assert.equal(results.length, 9);
process.exit(process.exitCode ?? 0);
