// Haystack controlled browser tests (Step 7 gate). Real Chromium (nixpkgs,
// HAYSTACK_CHROMIUM) against the real app + PG (HAYSTACK_TEST_PG) + built UI.
// Skipped with an explicit marker when either is unset — never a silent pass.
//
// Run after `npm run build` (UI) and server `tsc -p tsconfig.tests.json`:
//   HAYSTACK_TEST_PG=... HAYSTACK_CHROMIUM=/nix/store/.../bin/chromium \
//     npm run test:browser -w web
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import express from "express";
import { chromium } from "playwright-core";

const CONN = process.env.HAYSTACK_TEST_PG;
const CHROMIUM = process.env.HAYSTACK_CHROMIUM;
const ARTIFACTS = process.env.HAYSTACK_UI_ARTIFACTS;
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const serverRoot = path.resolve(here, "..", "..", "server");

if (!CONN || !CHROMIUM) {
  console.log("# SKIP browser leg: set HAYSTACK_TEST_PG and HAYSTACK_CHROMIUM");
  process.exit(0);
}

const { LiveUpdates } = await import(path.join(serverRoot, "dist-test", "src", "http", "live.js"));
const { createApp } = await import(path.join(serverRoot, "dist-test", "src", "http", "server.js"));
const { migrate } = await import(path.join(serverRoot, "dist-test", "src", "storage", "migrate.js"));
const { PgItemRepository } = await import(path.join(serverRoot, "dist-test", "src", "storage", "postgres.js"));
const { ItemService } = await import(path.join(serverRoot, "dist-test", "src", "application", "service.js"));
const { ManualClock } = await import(path.join(serverRoot, "dist-test", "src", "application", "clock.js"));

const admin = new pg.Client(CONN);
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS haystack_browser");
await admin.query("CREATE DATABASE haystack_browser");
await admin.end();
const BCONN = CONN.replace(/haystack_test/, "haystack_browser");
const pool = new pg.Pool({ connectionString: BCONN });
await migrate(pool, "agent-activity");

const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-uitest-"));
const humanToken = randomBytes(32).toString("base64url");
const agentToken = randomBytes(32).toString("base64url");
const digestOf = (t) => createHash("sha256").update(t, "ascii").digest("hex");
await writeFile(path.join(dir, "human.sha"), digestOf(humanToken) + "\n");
await writeFile(path.join(dir, "agent.sha"), digestOf(agentToken) + "\n");
const { loadAuth } = await import(path.join(serverRoot, "dist-test", "src", "auth", "config.js"));
let auth = await loadAuth({
  activityProjectId: "agent-activity",
  users: [
    { id: "op", type: "human", displayName: "Op", tokens: [{ id: "browser", hashFile: path.join(dir, "human.sha") }] },
    { id: "agent", type: "agent", displayName: "Agent", tokens: [{ id: "default", hashFile: path.join(dir, "agent.sha") }] },
  ],
  cookieSecure: false,
  allowedHosts: ["127.0.0.1", "localhost", "haystack.test"],
  allowedOrigins: [],
});

// Parent app: real API + static UI (mirrors the production single-origin layout).
// createApp already prefixes its routes with /api — mount at root.
const parent = express();
const sharedRepo = new PgItemRepository(BCONN);
const updates = new LiveUpdates(() => auth);
parent.use(createApp({ updates, getAuth: () => auth, repo: sharedRepo, clock: new ManualClock() }));
parent.use(express.static(path.join(webRoot, "dist"), { maxAge: 0 }));
const server = http.createServer(parent);
updates.attach(server);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const insecureBase = `http://haystack.test:${server.address().port}`;
// The page origin (with its ephemeral port) joins the CSRF allowlist after
// listen — mirroring production, where the public URL is configured.
auth = await loadAuth({ ...auth.config, allowedOrigins: [base, insecureBase] });

// Seed through the service layer (agent authorship, big ints, links).
const seedRepo = new PgItemRepository(BCONN);
const seed = new ItemService(seedRepo, new ManualClock());
const agent = { userId: "agent", type: "agent", tokenId: "default" };
let n = 0;
const rid = () => `0193e8d5-6f5c-7a1b-8c2d-${String(++n).padStart(12, "0")}`;
const docOf = (over) =>
  JSON.stringify({
    title: "t", description: "d", fields: {}, type: "fact", status: "actual",
    importance: "low", "human-attention": "cleared", links: [], ...over,
  });
// NOTE: raw text — a JS number literal would round before serialization.
await seed.put({ key: "ui:note", documentJson: '{"title":"hello memory","description":"d","fields":{"n":9007199254740993},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}', expectedRevision: 0, requestId: rid() }, agent);
await seed.put({ key: "ui:old", documentJson: docOf({ title: "buried memory", status: "archived" }), expectedRevision: 0, requestId: rid() }, agent);
await seed.put({ key: "ui:todo", documentJson: docOf({ title: "needs attention", type: "todo", "human-attention": "required" }), expectedRevision: 0, requestId: rid() }, agent);
await seed.put({
  key: "ui:xss",
  documentJson: docOf({ title: '<script>alert("xss")</script><img src=x onerror=alert(2)>', description: "javascript:alert(3)" }),
  expectedRevision: 0, requestId: rid(),
}, agent);
await seed.put({ key: "u%3Ani:caf%C3%A9%20%F0%9F%90%8E", documentJson: docOf({ title: "unicode identity", fields: { fidelity: "canonical key" } }), expectedRevision: 0, requestId: rid() }, agent);

const skillMarkdown = [
  "---", "name: verify-release", "description: Verify a release artifact", "---", "# Verify a release", "",
  "Check the **artifact** and keep `raw bytes`.", "", "```typescript", "const value: number = 7;", "```", "",
  "| Check | Result |", "| --- | --- |", "| Digest | Match |", "",
  '[documentation](https://example.invalid/docs) [unsafe](javascript:alert(8))',
  '<script>alert(9)</script><img src=x onerror=alert(10)>',
  '![tracking](https://example.invalid/haystack-track.png)', "",
  "```html", '<img src=x onerror="alert(11)">', "```", "",
].join("\n");
const snippetContent = "{ pkgs }: { packages = [ pkgs.git ]; }";
const semanticFields = '{"label":"Literal **not bold**\\n🐎","count":9007199254740993,' +
  '"precision":0.12345678901234567890123456789,"enabled":true,"empty":null,' +
  '"config":{"nested":9007199254740993,"tags":["one","two"],"enabled":false},"tags":["one",2,null],' +
  `"skill":${JSON.stringify({ type: "md", content: skillMarkdown })},` +
  `"snippet":${JSON.stringify({ type: "code", language: "nix", content: snippetContent })},` +
  '"literal":{"type":"text","content":"# Literal *text*"},' +
  '"unknown":{"type":"html","content":"<b>preserved</b>"},' +
  '"extended":{"type":"md","content":"# preserved content","filename":"SKILL.md"},' +
  '"unsupported":{"type":"code","language":"fabricated-language","content":"literal <script>alert(12)</script>"}}';
await seed.put({ key: "ui:semantic", documentJson: docOf({ title: "Semantic fields", type: "skill-draft" }).replace('"fields":{}', `"fields":${semanticFields}`), expectedRevision: 0, requestId: rid() }, agent);
await seed.put({ key: "ui:root-array", documentJson: docOf({ title: "Root array", fields: ["literal", true, null] }), expectedRevision: 0, requestId: rid() }, agent);
await seed.put({ key: "ui:root-markdown", documentJson: docOf({ title: "Root Markdown", fields: { type: "md", content: "# Root content\n\nA paragraph." } }), expectedRevision: 0, requestId: rid() }, agent);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--no-proxy-server", "--host-resolver-rules=MAP haystack.test 127.0.0.1"] });
if (ARTIFACTS) await mkdir(ARTIFACTS, { recursive: true });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (err) {
    results.push(`FAIL - ${name}: ${err.message.split("\n")[0]}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const login = async (page, tok) => {
  await page.goto(`${base}/#/browse`);
  await page.getByLabel("Token").fill(tok);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Browse" }).waitFor();
};

await check("plain HTTP preview verifies heartbeat without secure-context APIs", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${insecureBase}/#/browse`);
    assert.equal(await page.evaluate(() => isSecureContext), false);
    assert.equal(await page.evaluate(() => typeof crypto.randomUUID), "undefined");
    await page.getByLabel("Token").fill(humanToken);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
    try {
      await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor({ timeout: 2000 });
    } catch (error) {
      throw new Error(`Heartbeat not verified: ${errors.join("; ") || error.message}`);
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

await check("canonical keys survive browsing", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/get"));
    await page.getByText("unicode identity", { exact: true }).click();
    assert.equal((await response).request().postDataJSON().key, "u%3Ani:caf%C3%A9%20%F0%9F%90%8E");
    await page.getByText("canonical key", { exact: true }).waitFor();
  } finally { await ctx.close(); }
});

// 401 prompts sign-in; login works; reload keeps the session.
await check("login flow + persisted session", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/#/browse`);
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  await login(page, humanToken);
  await page.getByText("hello memory").waitFor();
  await page.reload();
  await page.getByText("hello memory").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
  if (ARTIFACTS) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(ARTIFACTS, "browse-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile page overflows");
    await page.screenshot({ path: path.join(ARTIFACTS, "browse-mobile.png"), fullPage: true });
  }
  // Logout clears it, even across history navigation.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 10000 });
  await ctx.close();
});

// Search, diagnostics, archive control.
await check("gateway outages are connection failures and preserve the session across refreshes", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/#/browse`);
    await page.getByLabel("Token").fill(humanToken);
    for (const status of [502, 503, 504]) {
      await page.route("**/api/v1/login", (route) => route.fulfill({ status, contentType: "text/html", body: "Service unavailable" }));
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").textContent(), /Server unreachable/, `HTTP ${status} must be a connection failure`);
      assert.equal(await page.getByLabel("Token").inputValue(), humanToken);
      await page.unroute("**/api/v1/login");
    }
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
    const session = (await ctx.cookies(base)).find((cookie) => cookie.name === "haystack-dev");
    assert.ok(session);
    for (const status of [502, 503, 504]) {
      await page.route("**/api/**", (route) => route.fulfill({ status, contentType: "text/html", body: "Service unavailable" }));
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByText(/Server unreachable/).waitFor({ timeout: 3000 });
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
      assert.equal(await page.getByLabel("Token").count(), 0);
      assert.ok((await ctx.cookies(base)).find((cookie) => cookie.name === session.name).value === session.value, "outage must preserve the session token");
      await page.unroute("**/api/**");
      await page.reload();
      await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
    }
  } finally { await ctx.close(); }
});

await check("invalid field JSON reports an inline error before saving", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:note", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    let writes = 0;
    page.on("request", (request) => { if (request.url().endsWith("/api/v1/put")) writes++; });
    const fields = page.getByLabel("Fields JSON", { exact: true });
    await fields.fill('{"n":');
    await page.getByRole("alert").filter({ hasText: "Invalid JSON" }).waitFor({ timeout: 3000 });
    assert.equal(await fields.getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByRole("button", { name: "Save as new revision", exact: true }).isDisabled(), true);
    assert.equal(writes, 0);
    await fields.fill('{"n":9007199254740993}');
    assert.equal(await page.getByRole("alert").filter({ hasText: "Invalid JSON" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Save as new revision", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally { await ctx.close(); }
});

// Regression: fragment persistence must not remount a focused query editor.
await check("query typing retains focus", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByLabel("Query", { exact: true }).pressSequentially("hello", { delay: 100 });
    assert.equal(await page.getByLabel("Query", { exact: true }).inputValue(), "hello");
  } finally { await ctx.close(); }
});

await check("delayed search navigation preserves a newer query draft", async () => {
  const ctx = await browser.newContext();
  try {
    await ctx.addInitScript(() => {
      const add = window.addEventListener.bind(window);
      window.addEventListener = (type, listener, options) => {
        if (type !== "hashchange") { add(type, listener, options); return; }
        add(type, (event) => window.setTimeout(() => {
          if (typeof listener === "function") listener.call(window, event);
          else if (listener !== null) listener.handleEvent(event);
        }, 250), options);
      };
    });
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    const query = page.getByRole("combobox", { name: "Query", exact: true });
    await query.fill("hello");
    const response = page.waitForResponse((value) => value.url().endsWith("/api/v1/search") && value.request().postDataJSON().query === "hello");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await query.fill("bogus:1");
    await response;
    assert.equal(await query.inputValue(), "bogus:1", "the submitted route must not overwrite a newer query draft");
  } finally { await ctx.close(); }
});

await check("query completion supports keyboard, caret insertion, and pointer selection", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    const query = page.getByRole("combobox", { name: "Query", exact: true });
    await query.fill("type:f");
    await page.getByRole("option", { name: "type:fact", exact: true }).waitFor();
    await query.press("ArrowDown");
    await query.press("Enter");
    assert.equal(await query.inputValue(), "type:fact");
    assert.equal(new URL(page.url()).hash, "#/browse", "accepting a completion must not submit the query");
    assert.equal(await query.evaluate((element) => element === document.activeElement), true);

    await query.fill("(ty) AND importance:high");
    await query.evaluate((element) => element.setSelectionRange(3, 3));
    await query.press("Control+Space");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await query.press("ArrowDown");
    await query.press("Tab");
    assert.equal(await query.inputValue(), "(type:) AND importance:high");
    assert.equal(await query.evaluate((element) => element.selectionStart), 6);
    assert.equal(await query.evaluate((element) => element === document.activeElement), true);

    await query.fill("status:actual AND ui:no");
    await page.getByRole("option", { name: 'id:"ui:note"', exact: true }).click();
    assert.equal(await query.inputValue(), 'status:actual AND id:"ui:note"');
    assert.equal(await query.evaluate((element) => element === document.activeElement), true);
    await query.fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    await query.press("Escape");
    await query.press("Control+Space");
    await page.getByRole("listbox", { name: "Query suggestions" }).waitFor();
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "query-completion.png"), fullPage: true });
    await query.press("Escape");
    assert.equal(await page.getByRole("listbox", { name: "Query suggestions" }).count(), 0);
  } finally { await ctx.close(); }
});

await check("dismissed query completions do not reopen after a delayed response", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    await page.route("**/api/v1/complete", (route) => resolveRequest(route));
    const query = page.getByRole("combobox", { name: "Query", exact: true });
    await query.fill("ty");
    const route = await pending;
    await query.press("Escape");
    const response = page.waitForResponse((value) => value.url().endsWith("/api/v1/complete"));
    await route.fulfill({ json: { suggestions: ["type:"] } });
    await (await response).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole("listbox", { name: "Query suggestions" }).count(), 0);
    assert.equal(await query.inputValue(), "ty");
  } finally { await ctx.close(); }
});

await check("system theme changes update native controls and square layouts without reloading", async () => {
  const ctx = await browser.newContext({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    const theme = () => page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const query = document.querySelector('input[role="combobox"]');
      return { scheme: root.colorScheme, background: root.backgroundColor, foreground: root.color,
        controlScheme: getComputedStyle(query).colorScheme,
        corners: [...document.querySelectorAll("button, input, .search-panel, .records-panel")].map((element) => getComputedStyle(element).borderTopLeftRadius) };
    });
    const light = await theme();
    assert.equal(light.scheme, "light");
    assert.ok(light.corners.every((radius) => radius === "0px"));
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await theme();
    assert.equal(dark.scheme, "dark");
    assert.equal(dark.controlScheme, "dark");
    assert.notEqual(dark.background, light.background);
    const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    assert.ok(luminance(dark.background) < luminance(light.background));
    assert.ok((luminance(dark.foreground) + 0.05) / (luminance(dark.background) + 0.05) >= 4.5, "dark text contrast is insufficient");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "browse-dark-desktop.png"), fullPage: true });
    await page.getByRole("combobox", { name: "Query", exact: true }).fill("ty");
    await page.getByRole("option", { name: "type:", exact: true }).waitFor();
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "completion-dark.png"), fullPage: true });
    await page.getByRole("combobox", { name: "Query", exact: true }).press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "dark mobile page overflows");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "browse-dark-mobile.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal((await theme()).scheme, "light");
  } finally { await ctx.close(); }
});

// Regression: opening an inbox must retain its route and selected navigation.
await check("inbox route persists", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "Attention inbox", exact: true }).click();
    await page.getByText("needs attention").waitFor();
    assert.equal(new URL(page.url()).hash, "#/inbox");
  } finally { await ctx.close(); }
});

await check("search + diagnostics + archive", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const trace = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/search")) trace.push({ request: request.postDataJSON().query });
  });
  try {
    await login(page, humanToken);
    await page.getByLabel("Query").fill("hello");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText("hello memory").waitFor();
    trace.push({ stage: "hello visible", input: await page.getByLabel("Query").inputValue(), hash: new URL(page.url()).hash });
    await page.getByLabel("Query").fill("bogus:1");
    trace.push({ stage: "invalid input filled", input: await page.getByLabel("Query").inputValue(), hash: new URL(page.url()).hash });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    trace.push({ stage: "invalid input submitted", input: await page.getByLabel("Query").inputValue(), hash: new URL(page.url()).hash });
    await page.getByLabel("Search errors").waitFor();
    await page.getByLabel("Query").fill("buried");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText("No matching items.").waitFor();
    await page.getByLabel("Show").check();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByText("buried memory").waitFor();
  } catch (error) {
    throw new Error(`${error.message}\nSearch trace: ${JSON.stringify(trace)}`);
  } finally { await ctx.close(); }
});

// Arbitrary JSON fidelity + XSS inertness.
await check("semantic fields preserve scalar types and exact nested numbers through history", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:semantic", exact: true }).click();
    const field = (name) => page.getByRole("region", { name: `Field: ${name}`, exact: true });
    assert.equal(await field("label").locator(".field-string").textContent(), "Literal **not bold**\n🐎");
    assert.equal(await field("label").locator("strong").count(), 0);
    assert.equal(await field("count").locator(".field-number").textContent(), "9007199254740993");
    assert.equal(await field("precision").locator(".field-number").textContent(), "0.12345678901234567890123456789");
    assert.equal(await field("enabled").locator(".field-boolean").textContent(), "true");
    assert.equal(await field("empty").locator(".field-null").textContent(), "null");
    const config = field("config").locator("pre");
    assert.match(await config.textContent(), /\n\s+"nested": 9007199254740993/);
    assert.ok(await config.locator(".hljs-attr").count() > 0, "object keys have syntax highlighting");
    assert.ok(await config.locator(".hljs-number").count() > 0, "nested numbers have syntax highlighting");
    assert.match(await field("tags").locator("pre").textContent(), /\[\n/);
    assert.match(await field("unknown").locator("pre").textContent(), /<b>preserved<\/b>/);
    assert.match(await field("extended").locator("pre").textContent(), /"filename": "SKILL.md"/);
    await page.getByText("Raw JSON", { exact: true }).click();
    const raw = page.locator(".fields-view > .field-source pre");
    await raw.waitFor();
    assert.match(await raw.textContent(), /0\.12345678901234567890123456789/);
    await page.getByText("Raw JSON", { exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
    assert.match(await page.getByLabel("Fields JSON").inputValue(), /9007199254740993/);
    assert.match(await page.getByLabel("Fields JSON").inputValue(), /"type":"md"/);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "View", exact: true }).first().click();
    await page.getByRole("heading", { name: "Snapshot r1", exact: true }).waitFor();
    const counts = page.getByRole("region", { name: "Field: count", exact: true }).locator(".field-number");
    assert.deepEqual(await counts.allTextContents(), ["9007199254740993", "9007199254740993"]);
  } finally { await ctx.close(); }
});

await check("typed field editors preview content, preserve data, and save attributed revisions", async () => {
  await seed.put({ key: "ui:editor", documentJson: docOf({ title: "Typed editor" }).replace('"fields":{}',
    '"fields":{"count":9007199254740993,"decimal":0.12345678901234567890123456789,' +
    '"skill":{"type":"md","content":"# Original"},"snippet":{"type":"code","language":"nix","content":"{ enabled = true; }"},' +
    '"literal":{"type":"text","content":"old"},"__proto__":{"type":"text","content":"Prototype field"},' +
    '"nested":{"__proto__":9007199254740993},"extended":{"type":"md","content":"# untouched","filename":"SKILL.md"}}'),
    expectedRevision: 0, requestId: rid() }, agent);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:editor", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const markdown = '# Edited skill\n\nUse **exact bytes**.\n\n```typescript\nconst n: number = 7;\n```';
    await page.getByLabel("Content: skill", { exact: true }).fill(markdown);
    const preview = page.getByRole("region", { name: "Preview: skill", exact: true });
    await preview.getByRole("heading", { name: "Edited skill", exact: true }).waitFor();
    assert.equal(await preview.locator("strong").textContent(), "exact bytes");
    assert.ok(await preview.locator(".hljs-keyword").count() > 0);
    await page.getByLabel("Language: snippet", { exact: true }).selectOption("typescript");
    await page.getByLabel("Content: snippet", { exact: true }).fill('const text: string = "🐎";');
    assert.equal(await page.getByRole("region", { name: "Preview: snippet", exact: true }).locator("code").getAttribute("data-language"), "typescript");
    await page.getByLabel("Content: literal", { exact: true }).fill("**literal**\nsecond line");
    await page.getByLabel("Content: __proto__", { exact: true }).fill("Prototype field edited");
    assert.equal(await page.getByRole("region", { name: "Preview: literal", exact: true }).locator("pre").textContent(), "**literal**\nsecond line");
    assert.equal(await page.getByRole("region", { name: "Preview: literal", exact: true }).locator("strong").count(), 0);
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "typed-editor-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "typed-editor-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "typed editor overflows on mobile");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "typed-editor-mobile.png"), fullPage: true });
    await page.getByRole("checkbox", { name: "Preview", exact: true }).uncheck();
    assert.equal(await page.getByRole("region", { name: "Preview: skill", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
    const fields = page.getByLabel("Fields JSON", { exact: true });
    const raw = await fields.inputValue();
    assert.match(raw, /9007199254740993/);
    assert.match(raw, /0\.12345678901234567890123456789/);
    assert.match(raw, /"filename": "SKILL.md"/);
    await fields.fill(raw.slice(0, -1));
    await page.getByRole("alert").filter({ hasText: "Invalid JSON" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Typed content", exact: true }).isDisabled(), true);
    await fields.fill(raw);
    await page.getByRole("button", { name: "Typed content", exact: true }).click();
    assert.equal(await page.getByLabel("Content: skill", { exact: true }).inputValue(), markdown);
    const write = page.waitForResponse((response) => response.url().endsWith("/api/v1/put"));
    await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
    assert.equal((await write).status(), 200);
    await page.getByText(/Saved as revision 2/).waitFor();
    const result = await ctx.request.post(`${base}/api/v1/get`, { data: { key: "ui:editor" } });
    const text = await result.text();
    assert.match(text, /9007199254740993/);
    assert.match(text, /0\.12345678901234567890123456789/);
    const doc = JSON.parse(text);
    assert.equal(doc.metadata.modifiedBy, "op");
    assert.deepEqual(doc.document.fields.skill, { type: "md", content: markdown });
    assert.deepEqual(doc.document.fields.snippet, { type: "code", language: "typescript", content: 'const text: string = "🐎";' });
    assert.deepEqual(doc.document.fields.extended, { type: "md", content: "# untouched", filename: "SKILL.md" });
    assert.deepEqual(doc.document.fields.__proto__, { type: "text", content: "Prototype field edited" });
    assert.equal(Object.hasOwn(doc.document.fields.nested, "__proto__"), true);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

await check("root typed content can be edited and cancelled without writing", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:root-markdown", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Content: Value", { exact: true }).fill("# Draft root");
    await page.getByRole("region", { name: "Preview: Value", exact: true }).getByRole("heading", { name: "Draft root", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("heading", { name: "Root content", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Root content", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Draft root", exact: true }).count(), 0);
  } finally { await ctx.close(); }
});

await check("typed Markdown and snippets highlight content without executing or fetching it", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await ctx.newPage();
    let dialogued = false;
    const imageRequests = [];
    page.on("dialog", async (dialog) => { dialogued = true; await dialog.dismiss(); });
    page.on("request", (request) => { if (request.url().includes("haystack-track")) imageRequests.push(request.url()); });
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:semantic", exact: true }).click();
    const skill = page.getByRole("region", { name: "Field: skill", exact: true });
    await skill.getByRole("heading", { name: "Verify a release", exact: true }).waitFor();
    assert.equal(await skill.locator("strong").textContent(), "artifact");
    assert.equal(await skill.locator("table").count(), 1);
    assert.ok(await skill.locator('[aria-label="YAML frontmatter"] .hljs-attr').count() > 0);
    assert.equal(await skill.locator('code[data-language="typescript"] .hljs-keyword').textContent(), "const");
    assert.equal(await skill.locator('code[data-language="typescript"] .hljs-number').textContent(), "7");
    assert.equal(await page.locator("img").count(), 0);
    assert.equal(await skill.locator('a[href^="javascript:"]').count(), 0);
    assert.ok((await skill.getByRole("link", { name: "documentation", exact: true }).getAttribute("rel")).includes("noreferrer"));
    assert.deepEqual(imageRequests, []);
    assert.equal(dialogued, false);
    const snippet = page.getByRole("region", { name: "Field: snippet", exact: true }).locator("pre");
    assert.equal(await snippet.textContent(), snippetContent);
    assert.ok(await snippet.locator("span").count() > 0);
    assert.equal(await page.getByRole("region", { name: "Field: literal", exact: true }).locator("pre").textContent(), "# Literal *text*");
    const unsupported = page.getByRole("region", { name: "Field: unsupported", exact: true });
    await unsupported.getByText(/Unsupported language/).waitFor();
    assert.equal(await unsupported.locator("pre").textContent(), "literal <script>alert(12)</script>");
    assert.equal(await unsupported.locator("pre span").count(), 0);
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "semantic-fields-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "semantic-fields-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "semantic mobile fields overflow");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "semantic-fields-mobile.png"), fullPage: true });
    await skill.getByText("Markdown source", { exact: true }).click();
    const source = skill.locator(".field-source pre");
    await source.waitFor();
    assert.equal(await source.textContent(), skillMarkdown);
    assert.equal(dialogued, false);
  } finally { await ctx.close(); }
});

await check("root arrays and typed Markdown remain renderable", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "ui:root-array", exact: true }).click();
    const value = page.getByRole("region", { name: "Field: Value", exact: true });
    await value.waitFor();
    assert.equal(JSON.parse(await value.locator("pre").textContent())[0], "literal");
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await page.getByRole("button", { name: "ui:root-markdown", exact: true }).click();
    await page.getByRole("region", { name: "Field: Value", exact: true }).getByRole("heading", { name: "Root content", exact: true }).waitFor();
  } finally { await ctx.close(); }
});

await check("fidelity + inert rendering", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let dialogued = false;
  page.on("dialog", async (d) => {
    dialogued = true;
    await d.dismiss();
  });
  await login(page, humanToken);
  await page.getByLabel("Query").fill("hello");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "ui:note" }).click();
  await page.getByText("9007199254740993").waitFor();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByLabel("Query").fill("xss");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "ui:xss" }).click();
  // Literal payload text is visible…
  await page.getByText('<script>alert("xss")</script>', { exact: false }).first().waitFor();
  // …but nothing executed and no raw elements were created.
  assert.equal(dialogued, false);
  assert.equal(await page.locator("img").count(), 0);
  const scripts = await page.locator("script").count();
  assert.ok(scripts >= 1, "app scripts load");
  await ctx.close();
});

// Two-editor conflict preserves the draft.
await check("conflict preserves draft", async () => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  // Both pages share one context (one session): log in once, then drive
  // two concurrent editors of the same item.
  await login(a, humanToken);
  await b.goto(`${base}/#/browse`);
  await b.getByRole("button", { name: "Browse" }).waitFor();
  for (const page of [a, b]) {
    await page.getByLabel("Query").fill("hello");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "ui:note" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
  }
  await a.getByLabel("Title").fill("winner text");
  await a.getByRole("button", { name: "Save as new revision" }).click();
  await a.getByText(/Saved as revision 2/).waitFor();
  await b.getByLabel("Title").fill("loser draft text");
  await b.getByRole("button", { name: "Save as new revision" }).click();
  await b.getByRole("alert").waitFor();
  assert.equal(await b.getByLabel("Title").inputValue(), "loser draft text");
  await b.getByRole("button", { name: /Save my draft on top/ }).click();
  await b.getByText(/Saved as revision 3/).waitFor();
  await ctx.close();
});

// History snapshots, compare, restore-as-new-revision.
await check("history + restore", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, humanToken);
  // ui:note was retitled by the conflict check; browse instead of searching.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "ui:note" }).click();
  await page.getByText("Revision 3").waitFor();
  await page.getByRole("button", { name: "View" }).first().click();
  await page.getByText(/Snapshot r/).waitFor();
  await page.getByRole("button", { name: /Restore as new revision/ }).first().click();
  await page.getByText(/Restored revision \d+ as new revision 4/).waitFor();
  await ctx.close();
});

// Attention inbox preset + clearing.
await check("attention inbox", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, humanToken);
  await page.getByRole("button", { name: "Attention inbox" }).click();
  await page.getByText("needs attention").waitFor();
  await page.getByRole("button", { name: "ui:todo" }).click();
  await page.getByRole("button", { name: "Clear attention" }).click();
  await page.getByText(/Attention cleared/).waitFor();
  await page.getByRole("button", { name: "Attention inbox" }).click();
  await page.getByText("No matching items.").waitFor();
  await ctx.close();
});

await check("an unavailable logout does not pretend the session was cleared", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    const session = (await ctx.cookies(base)).find((cookie) => cookie.name === "haystack-dev");
    await page.route("**/api/v1/logout", (route) => route.fulfill({ status: 503, contentType: "text/html", body: "Service unavailable" }));
    const response = page.waitForResponse((value) => value.url().endsWith("/api/v1/logout"));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await response;
    assert.equal(await page.getByLabel("Token").count(), 0, "failed logout must retain signed-in identity");
    await page.getByRole("status").filter({ hasText: "Sign out did not complete" }).waitFor({ timeout: 3000 });
    assert.ok((await ctx.cookies(base)).find((cookie) => cookie.name === session.name).value === session.value, "failed logout must preserve the session token");
    await page.unroute("**/api/v1/logout");
    await page.reload();
    await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  } finally { await ctx.close(); }
});

// Inaccessible API is a network failure, not an auth failure. The UI shell
// stays loaded (separate static route would survive); abort only /api/*.
await check("inaccessible server", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, humanToken);
  await page.route("**/api/**", (route) => route.abort());
  await page.getByLabel("Query").fill("hello");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("Server unreachable").waitFor({ timeout: 15000 });
  await ctx.close();
});

await check("live writes refresh browse and preserve concurrent drafts", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    const write = async (expected, title) => {
      const response = await fetch(`${base}/api/v1/put`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ key: "live:external", document_json: docOf({ title }), expected_revision: expected, request_id: rid() }) });
      assert.equal(response.status, 200);
    };
    await write(0, "Written by an agent");
    await page.getByText("Written by an agent", { exact: true }).waitFor();
    await page.getByRole("button", { name: "live:external", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("My preserved draft");
    await write(1, "Updated elsewhere");
    await page.getByText(/This record may have changed elsewhere/).waitFor();
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "My preserved draft");
    await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "My preserved draft");
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "draft-conflict.png"), fullPage: true });
    await page.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
    await page.getByRole("heading", { name: "Updated elsewhere", exact: true }).waitFor();
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "record-desktop.png"), fullPage: true });
  } finally { await ctx.close(); }
});

await check("silent heartbeat loss opens an overlapping replacement", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    let count = 0;
    let drop = false;
    let dropped = 0;
    let resolveDrop;
    const droppedFrame = new Promise((resolve) => { resolveDrop = resolve; });
    await page.clock.install();
    await page.routeWebSocket("**/api/v1/live", (socket) => {
      const id = ++count;
      const upstream = socket.connectToServer();
      upstream.onMessage((message) => {
        if (drop && id === 1 && JSON.parse(String(message)).type === "pong") { dropped++; resolveDrop(); return; }
        socket.send(message);
      });
    });
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    drop = true;
    await page.clock.runFor(10_000);
    await Promise.race([droppedFrame, new Promise((_, reject) => setTimeout(() => reject(new Error("No heartbeat was dropped")), 10_000))]);
    assert.ok(dropped > 0, "fault injection must drop a real heartbeat reply");
    await page.clock.runFor(5_250);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    assert.ok(count >= 2, "replacement connection was not created");
    await page.getByRole("button", { name: "Connection: Live", exact: true }).click();
    await page.getByText("Event log", { exact: true }).click();
    await page.getByText(/Heartbeat overdue/).waitFor();
    await page.getByText(/Superseded/).waitFor();
    if (ARTIFACTS) await page.screenshot({ path: path.join(ARTIFACTS, "connection-recovery.png"), fullPage: true });
  } finally { await ctx.close(); }
});

await check("permanent close stops and manual retry resynchronizes missed writes", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    let channel;
    await page.routeWebSocket("**/api/v1/live", (socket) => { channel = socket; socket.connectToServer(); });
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await channel.close({ code: 1007, reason: "Injected invalid payload" });
    await page.getByRole("button", { name: "Connection: Connection stopped", exact: true }).waitFor();
    const response = await fetch(`${base}/api/v1/put`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ key: "live:missed", document_json: docOf({ title: "Created while disconnected" }), expected_revision: 0, request_id: rid() }) });
    assert.equal(response.status, 200);
    assert.equal(await page.getByText("Created while disconnected", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Connection: Connection stopped", exact: true }).click();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("Created while disconnected", { exact: true }).waitFor();
    assert.equal(await page.title(), "Haystack · Live");
  } finally { await ctx.close(); }
});

await check("navigation suspension and resume restore live updates", async () => {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await page.getByRole("button", { name: "Connection: Connection paused", exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event("resume")));
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await page.getByRole("button", { name: "Connection: Live", exact: true }).click();
    await page.getByText("Event log", { exact: true }).click();
    await page.getByText(/Page navigation/).waitFor();
    await page.getByText(/Checking connection after resume/).first().waitFor();
  } finally { await ctx.close(); }
});

for (const line of results) console.log(line);
await browser.close();
updates.close();
await new Promise((resolve) => server.close(resolve));
await seedRepo.close();
await sharedRepo.close();
await pool.end();
// Explicit exit: keep-alive sockets otherwise hold the loop open forever.
process.exit(process.exitCode ?? 0);
