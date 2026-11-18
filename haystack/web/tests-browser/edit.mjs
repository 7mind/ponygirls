// Record edit page (spec §3.2 Edit, §5 rule 7, §8): typed field editors with exact numbers, validation next to the
// field, the compare-and-swap write protocol with its three distinct outcomes (remote change, conflict, unconfirmed
// write that is replayed, never resent), the leave guard through the in-app dialog, the document as the only scroller.
// Real pinned Chromium against the selected Scala/native server (HAYSTACK_SERVER_COMMAND) and an owned PostgreSQL
// database; waits only for rendered state.
// Runs alone after `npm run build`: node --import ../scripts/register-generated.mjs tests-browser/edit.mjs
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

const MASTHEAD_PX = 48;
const VIEWBAR_PX = 56;
const RAIL_GAP_PX = 16;
const SCROLL_PX = 1500;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
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
  dir = await mkdtemp(path.join(os.tmpdir(), "haystack-edit-"));
  database = await ownedDatabase({ connectionString: process.env.HAYSTACK_TEST_PG, dir });
  const password = randomBytes(32).toString("base64url");
  await writePasswordHash(path.join(dir, "human.password"), password);
  const agentToken = randomBytes(32).toString("base64url");
  await writeFile(path.join(dir, "agent.sha"), createHash("sha256").update(agentToken, "ascii").digest("hex") + "\n");
  const alicePassword = randomBytes(32).toString("base64url");
  await writePasswordHash(path.join(dir, "alice.password"), alicePassword);
  await writeFile(path.join(dir, "alice.sha"), createHash("sha256").update(randomBytes(32).toString("base64url"), "ascii").digest("hex") + "\n");
  await writeFile(path.join(dir, "human.sha"), createHash("sha256").update(randomBytes(32).toString("base64url"), "ascii").digest("hex") + "\n");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    activityProjectId: "agent-activity",
    users: [
      { id: "op", type: "human", displayName: "Op", enabled: true, login: "op", passwordHashFile: path.join(dir, "human.password"), tokens: [{ id: "browser", hashFile: path.join(dir, "human.sha") }] },
      { id: "alice", type: "human", displayName: "Alice", enabled: true, login: "alice", passwordHashFile: path.join(dir, "alice.password"), tokens: [{ id: "browser", hashFile: path.join(dir, "alice.sha") }] },
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
  const put = (key, documentJson, expectedRevision) => seed.put({ key, documentJson, expectedRevision, requestId: rid() });
  const stored = async (key) => { const item = await seed.get(key); return { revision: item.revision, modifiedBy: item.metadata.modifiedBy, text: item.document.json, document: JSON.parse(item.document.json) }; };

  // NOTE: raw JSON text — a JS number literal would round before serialization.
  await put("ui:editor", withFields({ title: "Typed editor", type: "fact", importance: "low", tags: ["old-tag", "keep"], "human-attention": "required" },
    '{"count":9007199254740993,"decimal":0.12345678901234567890123456789,' +
    '"skill":{"type":"md","content":"# Original"},"snippet":{"type":"code","language":"nix","content":"{ enabled = true; }"},' +
    '"literal":{"type":"text","content":"old"},"__proto__":{"type":"text","content":"Prototype field"},' +
    '"nested":{"__proto__":9007199254740993},"extended":{"type":"md","content":"# untouched","filename":"SKILL.md"},"label":"to be removed","flag":true}'), 0);
  await put("ui:simple", docOf({ title: "Simple fixture" }).replace('"links":[]', '"links":[["relates-to","ui:editor"]]').replace('"fields":{}', '"fields":{"n":9007199254740993}'), 0);
  await put("ui:root-markdown", docOf({ title: "Root Markdown", fields: { type: "md", content: "# Root content\n\nA paragraph." } }), 0);
  await put("ui:uncertain", docOf({ title: "Uncertain fixture" }), 0);
  await put("ui:conflict", docOf({ title: "Conflict fixture" }), 0);
  await put("ui:discard", docOf({ title: "Discard fixture" }), 0);
  for (const key of ["ui:draft-typed", "ui:draft-raw", "ui:draft-moved", "ui:draft-user", "ui:draft-generation", "ui:draft-replay"])
    await put(key, withFields({ title: `Draft fixture ${key}` }, '{"n":1,"note":{"type":"md","content":"# Note"}}'), 0);
  await put("ui:histnav", docOf({ title: "History navigation fixture" }), 0);
  await put("ui:guard", docOf({ title: "Guard fixture" }), 0);
  await put("ui:guard", docOf({ title: "Guard fixture, revised" }), 1);
  const long = (what, count) => Array.from({ length: count }, (_, i) => `${what} line ${i}`).join("\n");
  await put("ui:long", withFields({ title: "Long record", description: long("description", 30) },
    JSON.stringify({ notes: { type: "md", content: long("- note", 60) }, unit: { type: "code", language: "nix", content: long("# unit", 40) }, due: "2026-12-01" })), 0);

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
  async function open(viewport = DESKTOP, signedIn = true) {
    const context = await browser.newContext({ viewport, storageState: signedIn ? storageState : undefined });
    await context.addInitScript(() => {
      window.nativeDialogs = [];
      for (const name of ["alert", "confirm", "prompt"]) window[name] = (...args) => { window.nativeDialogs.push([name, ...args]); return null; };
    });
    const page = await context.newPage();
    const dialogs = [], errors = [], puts = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.url().endsWith("/api/v1/put")) puts.push(request.postDataJSON()); });
    page.puts = puts;
    page.quiet = async () => {
      assert.deepEqual(dialogs, [], "no native dialog opens");
      assert.deepEqual(await page.evaluate(() => window.nativeDialogs), [], "window.alert/confirm/prompt are never called");
      assert.deepEqual(errors, [], "no page errors");
    };
    return { context, page };
  }
  /** Opens the editor of `key` through the edit route. */
  const edit = async (page, key) => {
    await page.goto(`${base}/#/item/${encodeURIComponent(key)}/edit`);
    await page.locator('[data-record="editing"]').waitFor();
  };
  const save = (page) => page.getByRole("button", { name: "Save as new revision", exact: true });
  const field = (page, name) => page.locator(`[data-field-editor="${name}"]`);
  const summary = (page) => page.getByRole("alert").filter({ hasText: /prevents? saving/ });
  const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
  /** A traversal started by the browser itself (the Back button, the history menu), without waiting for a navigation that a guard cancels. */
  const browserTraversal = async (page, steps) => {
    const session = await page.context().newCDPSession(page);
    const { currentIndex, entries } = await session.send("Page.getNavigationHistory");
    await session.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex + steps].id });
    await session.detach();
  };
  const check = async (name, run) => {
    console.log(`# check - ${name}`);
    try { await run(); results.push(`ok - ${name}`); console.log(`ok - ${name}`); }
    catch (error) { results.push(`FAIL - ${name}`); console.error(error); process.exitCode = 1; }
  };

  await check("typed editors: preview, edit, rename, add and remove fields; exact numbers and odd names survive into an attributed revision", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:editor");
      assert.equal(await save(page).isDisabled(), true, "nothing changed yet");
      const markdown = '# Edited skill\n\nUse **exact bytes**.\n\n```typescript\nconst n: number = 7;\n```';
      await page.getByLabel("Content: skill", { exact: true }).fill(markdown);
      const preview = page.getByRole("region", { name: "Preview: skill", exact: true });
      await preview.getByRole("heading", { name: "Edited skill", exact: true }).waitFor();
      assert.equal(await preview.locator("strong").textContent(), "exact bytes");
      await page.getByRole("checkbox", { name: "Preview skill", exact: true }).uncheck();
      assert.equal(await preview.count(), 0, "unchecking hides the preview");
      await page.getByRole("checkbox", { name: "Preview skill", exact: true }).check();
      await preview.getByRole("heading", { name: "Edited skill", exact: true }).waitFor();
      assert.ok(await preview.locator(".hljs-keyword").count() > 0, "the preview highlights code");
            await page.getByLabel("Language: snippet", { exact: true }).selectOption("typescript");
      await page.getByLabel("Content: snippet", { exact: true }).fill('const text: string = "🐎";');
      const snippet = page.getByRole("region", { name: "Preview: snippet", exact: true });
      assert.equal(await snippet.count(), 0, "a code field's preview is opt-in");
      await page.getByRole("checkbox", { name: "Preview snippet", exact: true }).check();
      assert.equal(await snippet.locator("code").getAttribute("data-language"), "typescript");
      await page.getByLabel("Content: literal", { exact: true }).fill("**literal**\nsecond line");
      await page.getByRole("checkbox", { name: "Preview literal", exact: true }).check();
      const literal = page.getByRole("region", { name: "Preview: literal", exact: true });
      assert.equal(await literal.locator("pre").textContent(), "**literal**\nsecond line");
      assert.equal(await literal.locator("strong").count(), 0, "plain text is not rendered as Markdown");
      await page.getByLabel("Content: __proto__", { exact: true }).fill("Prototype field edited");
      await page.getByLabel("Value: flag", { exact: true }).selectOption("false");
      await page.getByRole("button", { name: "Remove field label", exact: true }).click();
      await page.getByRole("button", { name: "Add field", exact: true }).click();
      await page.getByLabel("Field name", { exact: true }).and(page.locator(":focus")).fill("added");
      await page.getByLabel("Type of added", { exact: true }).selectOption("number");
      await page.getByLabel("Value: added", { exact: true }).fill("9007199254740995");
      // Metadata: suggestions, importance, the review switch and tags.
      await page.getByRole("button", { name: "Show suggestions" }).first().click();
      await page.getByRole("option", { name: "decision", exact: true }).click();
      await page.getByLabel("Importance", { exact: true }).selectOption("critical");
      await page.getByRole("checkbox", { name: "Needs review", exact: true }).uncheck();
      await page.getByRole("button", { name: "Remove tag old-tag", exact: true }).click();
      await page.getByLabel("Tags", { exact: true }).fill("alpha,");
      await page.getByLabel("Tags", { exact: true }).fill("beta");
      await page.getByLabel("Tags", { exact: true }).press("Enter");
      await page.getByRole("button", { name: "Remove tag beta", exact: true }).waitFor();
      // Raw JSON shows the whole fields object exactly; invalid text blocks the way back.
      await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
      const fields = page.getByLabel("Fields JSON", { exact: true });
      const raw = await fields.inputValue();
      assert.match(raw, /"count": 9007199254740993/);
      assert.match(raw, /"decimal": 0\.12345678901234567890123456789/);
      assert.match(raw, /"filename": "SKILL.md"/);
      assert.match(raw, /"added": 9007199254740995/);
      await fields.fill(raw.slice(0, -1));
      await summary(page).waitFor();
      assert.equal(await page.getByRole("button", { name: "Typed content", exact: true }).isDisabled(), true);
      await fields.fill(raw);
      await page.getByRole("button", { name: "Typed content", exact: true }).click();
      assert.equal(await page.getByLabel("Content: skill", { exact: true }).inputValue(), markdown, "typed content survives the round trip through raw JSON");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize(PHONE);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the editor does not overflow a phone");
      await page.setViewportSize(DESKTOP);
      await save(page).click();
      await page.getByText("Saved as revision 2", { exact: true }).waitFor();
      const after = await stored("ui:editor");
      assert.equal(after.revision, 2);
      assert.equal(after.modifiedBy, "op");
      assert.match(after.text, /9007199254740993/);
      assert.match(after.text, /0\.12345678901234567890123456789/);
      const { fields: saved, type, importance, tags } = after.document;
      assert.deepEqual(saved.skill, { type: "md", content: markdown });
      assert.deepEqual(saved.snippet, { type: "code", language: "typescript", content: 'const text: string = "🐎";' });
      assert.deepEqual(saved.literal, { type: "text", content: "**literal**\nsecond line" });
      assert.deepEqual(saved.extended, { type: "md", content: "# untouched", filename: "SKILL.md" });
      assert.deepEqual(saved.__proto__, { type: "text", content: "Prototype field edited" });
      assert.equal(Object.hasOwn(saved.nested, "__proto__"), true, "a nested field named __proto__ is kept");
      assert.equal(saved.flag, false);
      assert.equal(Object.hasOwn(saved, "label"), false, "a removed field is gone");
      assert.match(after.text, /"added":9007199254740995/);
      assert.deepEqual([type, importance, after.document["human-attention"], tags], ["decision", "critical", "cleared", ["keep", "alpha", "beta"]]);
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("root typed content is edited in place and cancelled through the dialog without writing or leaving a history entry behind", async () => {
    const { context, page } = await open();
    try {
      await page.goto(`${base}/#/browse`);
      await edit(page, "ui:root-markdown");
      await page.getByLabel("Content: Value", { exact: true }).fill("# Draft root");
      await page.getByRole("region", { name: "Preview: Value", exact: true }).getByRole("heading", { name: "Draft root", exact: true }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog(page, "Discard unsaved changes?").getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.getByRole("heading", { name: "Root content", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Root content", exact: true }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Draft root", exact: true }).count(), 0);
      assert.equal(page.puts.length, 0);
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#/browse");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("validation: problems are shown next to the field and in a summary that focuses it; nothing is sent while they stand", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:simple");
      assert.equal(await save(page).isDisabled(), true);
      const number = page.getByLabel("Value: n", { exact: true });
      await number.fill("nine");
      await summary(page).getByRole("button", { name: /Field n: Not a JSON number/ }).waitFor();
      assert.equal(await number.getAttribute("aria-invalid"), "true");
      assert.match(await page.locator(`#${await number.getAttribute("aria-describedby")}`).textContent(), /Not a JSON number/, "the message is attached to the field");
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Raw JSON", exact: true }).isDisabled(), true, "the typed rows cannot be shown as JSON while one is invalid");
      await page.getByLabel("Title", { exact: true }).focus();
      await summary(page).getByRole("button", { name: /Field n:/ }).click();
      assert.equal(await number.evaluate((element) => element === document.activeElement), true, "the summary focuses the field");
      await number.fill("9007199254740993");
      await summary(page).waitFor({ state: "detached" });
      assert.equal(await save(page).isDisabled(), true, "the original value again: nothing changed");
      // A link needs its target; a target that names no record is flagged but allowed (dangling links exist).
      await page.getByRole("button", { name: "Add link", exact: true }).click();
      await summary(page).getByRole("button", { name: /Links, row 2: Enter the key of the target record/ }).waitFor();
      assert.equal(await page.getByLabel("Target key, row 2", { exact: true }).evaluate((element) => element === document.activeElement), true, "a new link row takes focus");
      await page.getByLabel("Target key, row 2", { exact: true }).fill("ui:nowhere");
      await page.getByLabel("Title", { exact: true }).focus();
      await page.getByText("No record has this key", { exact: true }).waitFor();
      await summary(page).waitFor({ state: "detached" });
      assert.equal(await save(page).isEnabled(), true);
      await page.getByRole("button", { name: "Remove link 2", exact: true }).click();
      assert.equal(await save(page).isDisabled(), true);
      // The first link resolved its target's title when the editor opened.
      await page.getByText("Typed editor", { exact: true }).waitFor();
      // Invalid raw JSON.
      await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
      const fields = page.getByLabel("Fields JSON", { exact: true });
      await fields.fill('{"n":');
      await summary(page).getByRole("button", { name: /Fields JSON: Invalid JSON/ }).waitFor();
      assert.equal(await fields.getAttribute("aria-invalid"), "true");
      assert.equal(await save(page).isDisabled(), true);
      await fields.fill('{"n":9007199254740993}');
      await summary(page).waitFor({ state: "detached" });
      assert.deepEqual(page.puts, [], "nothing was sent");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("an unconfirmed write is replayed with its original id and payload, blocks other writes, and the newer draft then saves on top of it; a conflict is overwritten explicitly", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:uncertain");
      await page.getByLabel("Title", { exact: true }).fill("Committed original");
      const sent = [];
      await page.route("**/api/v1/put", async (route) => {
        sent.push(route.request().postDataJSON());
        if (sent.length === 1) {
          const committed = await route.fetch();
          assert.equal(committed.status(), 200, "the failure must happen after the actual commit");
          await route.abort("failed");
        } else await route.continue();
      });
      await save(page).click();
      const unknown = page.getByRole("alert").filter({ hasText: "The outcome of your save is unknown" });
      await unknown.waitFor();
      assert.match(await unknown.textContent(), /may or may not be stored as revision 2/);
      assert.equal(await page.getByRole("status").filter({ hasText: "Save not confirmed" }).count(), 1, "the bar says so too");
      await page.getByLabel("Title", { exact: true }).fill("Newer local draft");
      assert.equal(await save(page).isDisabled(), true, "no other write while one is unconfirmed");
      assert.equal(sent.length, 1, "the edited draft never got an operation of its own");
      await unknown.getByRole("button", { name: "Retry original write", exact: true }).click();
      await page.getByText(/Original write confirmed as revision 2/).waitFor();
      assert.deepEqual(sent[1], sent[0], "the replay is the identical encoded payload, original request id and CAS");
      assert.equal(sent[0].expectedRevision, 1);
      const committed = await stored("ui:uncertain");
      assert.equal(committed.revision, 2);
      assert.equal(committed.document.title, "Committed original");
      assert.deepEqual((await seed.history("ui:uncertain")).revisions.map((revision) => revision.revision), [2, 1], "one revision, not two");
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer local draft");
      // The newer draft now builds on the confirmed write: it saves with revision 2, so only someone else's change conflicts.
      await page.locator(".record-sub").getByText("based on revision 2", { exact: true }).waitFor();
      await put("ui:uncertain", docOf({ title: "Their change" }), 2);
      await save(page).click();
      await page.getByRole("alert").filter({ hasText: "Revision 3 was saved by agent while you were editing" }).waitFor();
      assert.equal(sent[2].expectedRevision, 2);
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer local draft");
      assert.equal(await save(page).isDisabled(), true);
      await page.getByRole("button", { name: "Overwrite as revision 4", exact: true }).click();
      await page.getByText("Saved as revision 4", { exact: true }).waitFor();
      assert.notEqual(sent[3].requestId, sent[0].requestId, "only the explicit overwrite is a new operation");
      assert.equal(sent[3].expectedRevision, 3);
      assert.equal((await stored("ui:uncertain")).document.title, "Newer local draft");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("a change by someone else shows a notice and keeps the draft; saving reports the conflict; Discard mine asks first", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:conflict");
      await page.getByLabel("Title", { exact: true }).fill("My draft");
      await put("ui:conflict", docOf({ title: "Their change" }), 1);
      const notice = page.getByRole("status").filter({ hasText: "Revision 2 was saved elsewhere." });
      await notice.waitFor();
      assert.equal(await notice.getByRole("link", { name: "Review their changes" }).getAttribute("target"), "_blank");
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "My draft", "the draft is not replaced");
      await save(page).click();
      const conflict = page.getByRole("alert").filter({ hasText: "was saved by agent while you were editing" });
      await conflict.waitFor();
      assert.match(await conflict.textContent(), /title now “Their change”.*still based on revision 1/);
      assert.equal(await notice.count(), 0, "the conflict replaces the remote-change notice");
      assert.equal(await page.getByRole("status").filter({ hasText: "Conflict with revision 2" }).count(), 1);
      await conflict.getByRole("button", { name: "Discard mine", exact: true }).click();
      const confirm = dialog(page, "Discard your draft?");
      assert.equal(await confirm.getByRole("button", { name: "Keep my draft", exact: true }).evaluate((element) => element === document.activeElement), true, "the way back is focused by default");
      await page.keyboard.press("Escape");
      await confirm.waitFor({ state: "detached" });
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "My draft");
      await conflict.getByRole("button", { name: "Discard mine", exact: true }).click();
      await confirm.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
      await page.getByRole("heading", { name: "Their change", exact: true }).waitFor();
      assert.equal((await stored("ui:conflict")).revision, 2, "nothing of the draft was written");
      assert.equal(page.puts.length, 1, "only the conflicting save was sent");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("leave guard: unsaved changes are asked about before any in-app way out and on closing the tab; a pristine editor leaves freely", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:guard");
      const closing = () => page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
      assert.equal(await closing(), false, "a pristine editor does not hold the tab");
      await page.getByRole("button", { name: "Back to Browse", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#/browse");
      await edit(page, "ui:guard");
      await page.getByLabel("Title", { exact: true }).fill("Changed title");
      await page.getByRole("button", { name: "Add field", exact: true }).click();
      assert.equal(await closing(), true, "closing the tab with unsaved changes is confirmed by the browser");
      const confirm = dialog(page, "Discard unsaved changes?");
      // A link of the masthead.
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Inbox", exact: true }).click();
      assert.match(await confirm.textContent(), /You changed title and field field of ui:guard/);
      assert.equal(await confirm.getByRole("button", { name: "Keep editing", exact: true }).evaluate((element) => element === document.activeElement), true, "the way back is focused by default");
      await page.keyboard.press("Escape");
      await confirm.waitFor({ state: "detached" });
      assert.match(page.url(), /#\/item\/ui%3Aguard\/edit$/, "staying keeps the route");
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Changed title");
      // The history of the record, which leaves the editor for the record page.
      await page.getByRole("button", { name: "View revision 1", exact: true }).click();
      await confirm.getByRole("button", { name: "Keep editing", exact: true }).click();
      await confirm.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Back to Browse", exact: true }).click();
      await confirm.getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#/browse");
      await edit(page, "ui:guard");
      await page.getByLabel("Title", { exact: true }).fill("Changed again");
      await page.getByRole("button", { name: "View revision 1", exact: true }).click();
      await confirm.getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.getByRole("region", { name: "Snapshot", exact: true }).getByText("Viewing revision 1 of 2").waitFor();
      assert.equal(page.puts.length, 0);
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("browser history: Back asks before the editor unmounts, staying keeps route and draft and asks again, confirmed Back and Forward behave as without a guard", async () => {
    const { context, page } = await open();
    try {
      const record = encodeURIComponent("ui:histnav");
      const confirm = dialog(page, "Discard unsaved changes?");
      const title = page.getByLabel("Title", { exact: true });
      await page.goto(`${base}/#/item/${record}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      // A pristine editor is left by Back without a question, and Forward reopens it.
      await page.goBack();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      await page.goForward();
      await page.locator('[data-record="editing"]').waitFor();
      await title.fill("Changed by the history case");
      await browserTraversal(page, -1);
      await confirm.waitFor();
      assert.match(page.url(), /#\/item\/ui%3Ahistnav\/edit$/, "the route did not change");
      assert.equal(await title.inputValue(), "Changed by the history case", "the editor is still mounted with its draft");
      await browserTraversal(page, -1);
      assert.equal(await confirm.count(), 1, "Back again with the dialog open keeps one dialog");
      assert.match(page.url(), /#\/item\/ui%3Ahistnav\/edit$/);
      await confirm.getByRole("button", { name: "Keep editing", exact: true }).click();
      await confirm.waitFor({ state: "detached" });
      // Staying keeps the guard: the next Back asks again.
      await browserTraversal(page, -1);
      await confirm.waitFor();
      assert.equal(await title.inputValue(), "Changed by the history case");
      await confirm.getByRole("button", { name: "Discard changes", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      assert.match(page.url(), /#\/item\/ui%3Ahistnav$/, "confirmed Back lands on the record, as without the guard");
      // Forward reopens an editor without the discarded draft.
      await page.goForward();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await title.inputValue(), "History navigation fixture");
      // Saving after the guard was armed still closes the editor onto the record.
      await title.fill("Saved after the guard");
      await save(page).click();
      await page.getByText("Saved as revision 2", { exact: true }).waitFor();
      assert.match(page.url(), /#\/item\/ui%3Ahistnav$/);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await title.inputValue(), "Saved after the guard");
      assert.equal(page.puts.length, 1, "only the save was sent");
      await page.quiet();
    } finally { await context.close(); }
  });

  const recordHash = (key) => `#/item/${encodeURIComponent(key)}`;
  const draftNote = (page) => page.getByRole("note").filter({ hasText: "You have an unsaved draft of this record" });
  const restoredNotice = (page) => page.getByRole("status").filter({ hasText: "Unsaved draft restored" });

  await check("a draft survives leaving by a traversal of several entries (no Navigation API): the record offers it, the editor restores it exactly, and saving uses the original base revision", async () => {
    const { context, page } = await open();
    try {
      await context.addInitScript(() => { Object.defineProperty(window, "navigation", { value: undefined }); });
      const key = "ui:draft-typed";
      await page.goto(`${base}/#/browse`);
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByLabel("Title", { exact: true }).fill("Draft title");
      await page.getByLabel("Content: note", { exact: true }).fill("# Draft note");
      await page.getByLabel("Value: n", { exact: true }).fill("2");
      // browse, record, editor and its guard entry: three entries back is the list. No dialog, no editor.
      await page.evaluate(() => history.go(-3));
      await page.waitForFunction(() => location.hash === "#/browse");
      assert.equal(await page.locator('[data-record="editing"]').count(), 0);
      assert.equal(await page.getByRole("dialog").count(), 0, "a traversal that cannot be held asks nothing");
      await page.goto(`${base}/${recordHash(key)}`);
      await page.locator('[data-record="ready"]').waitFor();
      await draftNote(page).getByText("started from revision 1", { exact: false }).waitFor();
      await draftNote(page).getByRole("button", { name: "Continue editing", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await restoredNotice(page).getByText("started from revision 1", { exact: false }).waitFor();
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft title");
      assert.equal(await page.getByLabel("Content: note", { exact: true }).inputValue(), "# Draft note");
      assert.equal(await page.getByLabel("Value: n", { exact: true }).inputValue(), "2");
      await save(page).click();
      await page.getByText("Saved as revision 2", { exact: true }).waitFor();
      assert.equal(page.puts[0].expectedRevision, 1, "the draft saves with the revision it started from");
      const saved = await stored(key);
      assert.deepEqual([saved.document.title, saved.document.fields.n, saved.document.fields.note.content], ["Draft title", 2, "# Draft note"]);
      assert.equal(await draftNote(page).count(), 0, "a saved draft is gone");
      // Saving left no entry behind: one Back is the list the record was opened from.
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#/browse");
      await page.goForward();
      await page.locator('[data-record="ready"]').waitFor();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await restoredNotice(page).count(), 0);
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("a draft in raw JSON mode survives leaving the editor by history and is restored in raw mode; Discard removes it", async () => {
    const { context, page } = await open();
    try {
      const key = "ui:draft-raw";
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
      const text = '{"n": 41, "added": true}';
      await page.getByLabel("Fields JSON", { exact: true }).fill(text);
      await page.evaluate(() => history.go(-2));
      await page.locator('[data-record="ready"]').waitFor();
      assert.equal(await page.locator('[data-record="editing"]').count(), 0);
      await draftNote(page).getByRole("button", { name: "Continue editing", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await page.getByRole("button", { name: "Raw JSON", exact: true }).getAttribute("aria-pressed"), "true", "the mode is restored");
      assert.equal(await page.getByLabel("Fields JSON", { exact: true }).inputValue(), text, "the text is restored exactly");
      await restoredNotice(page).getByRole("button", { name: "Discard draft", exact: true }).click();
      await dialog(page, "Discard your draft?").getByRole("button", { name: "Discard draft and reload", exact: true }).click();
      await page.locator('[data-record="ready"]').waitFor();
      assert.equal(await draftNote(page).count(), 0);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await restoredNotice(page).count(), 0, "a discarded draft does not come back");
      assert.equal(await page.getByRole("button", { name: "Typed content", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(page.puts.length, 0);
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("a draft of a record that moved on is restored into the remote-change and conflict presentation; Discard on the record page removes a draft", async () => {
    const { context, page } = await open();
    try {
      const key = "ui:draft-moved";
      const title = page.getByLabel("Title", { exact: true });
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await title.fill("First draft");
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      await draftNote(page).getByRole("button", { name: "Discard", exact: true }).click();
      await dialog(page, "Discard your draft?").getByRole("button", { name: "Discard draft", exact: true }).click();
      await draftNote(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await title.inputValue(), `Draft fixture ${key}`, "the discarded draft is gone");
      await title.fill("My draft");
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      await put(key, docOf({ title: "Their change" }), 1);
      await page.getByRole("heading", { name: "Their change", exact: true }).waitFor();
      await draftNote(page).getByRole("button", { name: "Continue editing", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByRole("status").filter({ hasText: "Revision 2 was saved elsewhere." }).waitFor();
      assert.equal(await title.inputValue(), "My draft", "the draft is not rebased");
      await save(page).click();
      const conflict = page.getByRole("alert").filter({ hasText: "was saved by agent while you were editing" });
      await conflict.waitFor();
      assert.equal(page.puts[0].expectedRevision, 1, "the original base revision is what the server decides on");
      assert.equal(await title.inputValue(), "My draft", "nothing is lost");
      assert.equal((await stored(key)).revision, 2);
      await conflict.getByRole("button", { name: "Discard mine", exact: true }).click();
      await dialog(page, "Discard your draft?").getByRole("button", { name: "Discard draft and reload", exact: true }).click();
      await page.getByRole("heading", { name: "Their change", exact: true }).waitFor();
      assert.equal(await draftNote(page).count(), 0);
      await page.quiet();
    } finally { await context.close(); }
  });

  /** Holds the next put until the returned release is called. */
  const holdPut = async (page) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/v1/put", async (route) => { await held; await route.continue(); }, { times: 1 });
    return release;
  };
  const basedOn = (page, revision) => page.locator(".record-sub").getByText(`based on revision ${revision}`, { exact: true });

  await check("a completing save ends only the draft it sent: later edits stay in the editor, now based on the saved revision, also after leaving and restoring and during its own way out", async () => {
    const { context, page } = await open();
    try {
      const key = "ui:draft-generation";
      const title = page.getByLabel("Title", { exact: true });
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      // Edited while the save is in flight, in the same editor.
      await title.fill("Submitted first");
      let release = await holdPut(page);
      let sent = page.waitForRequest("**/api/v1/put");
      await save(page).click();
      await sent;
      await title.fill("Edited while saving");
      release();
      await page.getByRole("status").filter({ hasText: "Saved as revision 2. Your later changes are kept and are now based on it." }).waitFor();
      assert.equal(await basedOn(page, 2).count(), 1);
      assert.match(page.url(), /\/edit$/, "the editor holding newer edits is not closed");
      assert.equal(await title.inputValue(), "Edited while saving");
      // Left while the next save is in flight, restored in a new editor and edited there.
      release = await holdPut(page);
      sent = page.waitForRequest("**/api/v1/put");
      await save(page).click();
      await sent;
      await page.evaluate(() => history.go(-2));
      await page.getByRole("heading", { name: "Submitted first", exact: true }).waitFor();
      await draftNote(page).getByRole("button", { name: "Continue editing", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await title.fill("Edited after restoring");
      release();
      await basedOn(page, 3).waitFor();
      assert.match(page.url(), /\/edit$/, "a completion in an editor that was left does not close the current one");
      assert.equal(await title.inputValue(), "Edited after restoring");
      // Saved, then edited while the guard's history entry is being removed (that traversal held): the editor stays, guarded.
      await page.evaluate(() => {
        const back = History.prototype.back;
        history.back = () => { delete history.back; window.releaseTraversal = () => back.call(history); };
      });
      await save(page).click();
      await page.waitForFunction(() => typeof window.releaseTraversal === "function");
      await title.fill("Edited during the traversal");
      await page.evaluate(() => window.releaseTraversal());
      await page.getByRole("status").filter({ hasText: "Saved as revision 4. Your later changes are kept and are now based on it." }).waitFor();
      assert.match(page.url(), /\/edit$/, "the completion does not close an editor edited during its traversal");
      assert.equal(await title.inputValue(), "Edited during the traversal");
      await browserTraversal(page, -1);
      await dialog(page, "Discard unsaved changes?").getByRole("button", { name: "Keep editing", exact: true }).click();
      await save(page).click();
      await page.getByText("Saved as revision 5", { exact: true }).waitFor();
      assert.deepEqual(page.puts.map((request) => request.expectedRevision), [1, 2, 3, 4], "each save builds on the previous one: no conflict with the reader's own saves");
      assert.equal((await stored(key)).document.title, "Edited during the traversal");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("a save whose answer was lost, confirmed through the page's retry notice after the editor was left without any live announcement, ends its draft; no editor starts from the replaced revision", async () => {
    const { context, page } = await open();
    try {
      const key = "ui:draft-replay";
      const title = page.getByLabel("Title", { exact: true });
      // The live connection stays up but announces no change: the page learns of the writes only through their confirmation.
      let withheld = 0;
      await page.routeWebSocket("**/api/v1/live", (socket) => {
        const upstream = socket.connectToServer();
        upstream.onMessage((message) => { if (JSON.parse(String(message)).kind === "changed") withheld++; else socket.send(message); });
      });
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await title.fill("Committed, answer lost");
      await page.route("**/api/v1/put", async (route) => {
        assert.equal((await route.fetch()).status(), 200, "the failure must happen after the actual commit");
        await route.abort("failed");
      }, { times: 1 });
      await save(page).click();
      await page.getByRole("alert").filter({ hasText: "The outcome of your save is unknown" }).waitFor();
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      const notice = page.locator("main > .notice").filter({ hasText: "is pending or uncertain" });
      // The refresh that the confirmation starts is held: the page still has revision 1, which no editor may start from.
      let releaseGet;
      const heldGet = new Promise((resolve) => { releaseGet = resolve; });
      await page.route("**/api/v1/get", async (route) => { await heldGet; await route.continue(); }, { times: 1 });
      const refresh = page.waitForRequest("**/api/v1/get");
      await notice.getByRole("button", { name: "Retry original write", exact: true }).click();
      await page.getByText(/Original write confirmed as revision 2/).waitFor();
      await refresh;
      assert.equal(await draftNote(page).count(), 0, "the confirmed draft is not offered again");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Loading revision 2 before editing" }).waitFor();
      assert.equal(await page.locator('[data-record="editing"]').count(), 0, "no editor starts from the revision the confirmed write replaced");
      releaseGet();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await title.inputValue(), "Committed, answer lost");
      assert.equal(await restoredNotice(page).count(), 0);
      await title.fill("After the confirmed write");
      await save(page).click();
      await page.getByText("Saved as revision 3", { exact: true }).waitFor();
      assert.deepEqual(page.puts.map((request) => request.expectedRevision), [1, 1, 2], "the replay repeats the original; the next save builds on it");
      assert.ok(withheld > 0, "the fault injection withheld a real announcement");
      await page.quiet();
    } finally { await context.close(); }
  });

  await check("a draft survives a routine account invalidation and does not outlive the signed-in identity: signing out, a forced teardown the shell cannot follow up, or the account changing under an open page, leaves no draft", async () => {
    // Its own session: signing out ends the session on the server, which the shared sign-in of the other cases must not lose.
    const { context, page } = await open(DESKTOP, false);
    try {
      const key = "ui:draft-user";
      const anyDraftNote = page.locator('[role="note"]', { hasText: "You have an unsaved draft of this record" });
      await page.goto(`${base}/${recordHash(key)}`);
      await page.getByLabel("Username", { exact: true }).fill("op");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByLabel("Title", { exact: true }).fill("Op's draft");
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      // A routine invalidation (hosts send it on reconnects; the account module re-reads its authority) changes no identity.
      await page.evaluate(async () => {
        document.dispatchEvent(new Event("account:invalidate"));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      assert.equal(await draftNote(page).count(), 1, "the same identity keeps its draft");
      // Signing out ends the identity's drafts, even when the same user's session comes back into this document (signing in
      // here would reload the page): the shared session of the other cases, announced as the module does.
      await page.getByRole("button", { name: "op", exact: true }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Password", { exact: true }).waitFor();
      await page.evaluate(() => { window.pageMarker = "same document"; });
      await context.addCookies(storageState.cookies);
      await page.evaluate((hash) => { location.hash = hash; document.dispatchEvent(new Event("account:changed")); }, recordHash(key));
      await page.locator('[data-record="ready"]').waitFor();
      assert.equal(await page.evaluate(() => window.pageMarker), "same document");
      assert.equal(await anyDraftNote.count(), 0, "signing out ended the draft");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByLabel("Title", { exact: true }).fill("Op's draft");
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      // The shared account page is open, as the module re-reads its authority when the window is focused.
      await page.getByRole("button", { name: "op", exact: true }).click();
      await page.getByRole("menuitem", { name: "Account settings", exact: true }).click();
      await page.waitForFunction(() => location.hash.startsWith("#account"));
      await page.evaluate(() => { window.pageMarker = "same document"; });
      // A forced teardown (the host's authoritative sign-out signal) ends the identity at once, even when the shell then
      // cannot verify the next one (unreachable); op's session is still valid, so Retry returns as op in the same document.
      await page.route("**/api/v1/whoami", (route) => route.abort("failed"), { times: 1 });
      await page.evaluate(() => document.dispatchEvent(new CustomEvent("account:invalidate", { detail: { reason: "signed-out" } })));
      await page.getByRole("heading", { name: "Server unreachable", exact: true }).waitFor();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByRole("button", { name: "op", exact: true }).waitFor();
      await page.evaluate((hash) => { location.hash = hash; }, recordHash(key));
      await page.locator('[data-record="ready"]').waitFor();
      assert.equal(await page.evaluate(() => window.pageMarker), "same document");
      assert.equal(await anyDraftNote.count(), 0, "a draft of an ended identity does not come back with the same user");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      await page.getByLabel("Title", { exact: true }).fill("Op's draft");
      await page.evaluate(() => history.go(-2));
      await draftNote(page).waitFor();
      await page.getByRole("button", { name: "op", exact: true }).click();
      await page.getByRole("menuitem", { name: "Account settings", exact: true }).click();
      await page.waitForFunction(() => location.hash.startsWith("#account"));
      // Alice signs in elsewhere and her session cookie replaces op's in this browser (op's session stays valid on the server).
      const elsewhere = await browser.newContext();
      const alicePage = await elsewhere.newPage();
      await alicePage.goto(base);
      await alicePage.getByLabel("Username", { exact: true }).fill("alice");
      await alicePage.getByLabel("Password", { exact: true }).fill(alicePassword);
      await alicePage.getByRole("button", { name: "Sign in", exact: true }).click();
      await alicePage.getByRole("button", { name: "alice", exact: true }).waitFor();
      await context.addCookies(await elsewhere.cookies());
      await elsewhere.close();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      // Behind the account page: attached, not visible.
      await page.locator('[role="status"]', { hasText: "Signed-in identity changed" }).waitFor({ state: "attached" });
      // The views are rebuilt for the new identity (at the list): open the record again, in the same document.
      await page.evaluate((hash) => { location.hash = hash; }, recordHash(key));
      await page.locator('[data-record="ready"]').waitFor();
      assert.equal(await page.evaluate(() => window.pageMarker), "same document", "the page was not reloaded: only the end of the identity can have removed the draft");
      assert.equal(await anyDraftNote.count(), 0, "another identity is not offered op's draft");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator('[data-record="editing"]').waitFor();
      assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), `Draft fixture ${key}`);
      assert.equal(page.puts.length, 0);
    } finally { await context.close(); }
  });

  await check("edit page: the document is the only scroller, the edit bar and rail stick, textareas grow, and a phone does not overflow", async () => {
    const { context, page } = await open();
    try {
      await edit(page, "ui:long");
      await page.getByLabel("Content: notes", { exact: true }).waitFor();
      const layout = await page.evaluate((offset) => {
        const description = document.querySelector("textarea[id$='-description']");
        const grown = description.scrollHeight <= description.clientHeight + 1 && description.clientHeight > 300;
        scrollTo(0, offset);
        const scrollers = [...document.querySelectorAll("body *")].filter((element) => {
          const style = getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
        }).map((element) => `${element.tagName}.${element.getAttribute("class")}`);
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        return { grown, scrollers, scrollY: Math.round(scrollY), scrollable: document.scrollingElement.scrollHeight > innerHeight + offset,
          overflowX: document.documentElement.scrollWidth > innerWidth, bar: top(".edit-bar"), rail: top(".rail") };
      }, SCROLL_PX);
      assert.deepEqual(layout, { grown: true, scrollers: [], scrollY: SCROLL_PX, scrollable: true, overflowX: false, bar: MASTHEAD_PX, rail: MASTHEAD_PX + VIEWBAR_PX + RAIL_GAP_PX });
      await page.setViewportSize(PHONE);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow at 390 px");
      await page.quiet();
    } finally { await context.close(); }
  });
} finally { await cleanup(); }
console.log(`# ${results.length} checks; ${results.filter((line) => line.startsWith("FAIL")).length} failures; 0 skipped`);
assert.equal(results.length, 14);
process.exit(process.exitCode ?? 0);
