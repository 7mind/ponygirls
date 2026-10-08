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
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import express from "express";
import { chromium } from "playwright-core";

const CONN = process.env.HAYSTACK_TEST_PG;
const CHROMIUM = process.env.HAYSTACK_CHROMIUM;
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const serverRoot = path.resolve(here, "..", "..", "server");

if (!CONN || !CHROMIUM) {
  console.log("# SKIP browser leg: set HAYSTACK_TEST_PG and HAYSTACK_CHROMIUM");
  process.exit(0);
}

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
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [],
});

// Parent app: real API + static UI (mirrors the production single-origin layout).
// createApp already prefixes its routes with /api — mount at root.
const parent = express();
const sharedRepo = new PgItemRepository(BCONN);
parent.use(createApp({ getAuth: () => auth, repo: sharedRepo, clock: new ManualClock() }));
parent.use(express.static(path.join(webRoot, "dist"), { maxAge: 0 }));
const server = http.createServer(parent);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// The page origin (with its ephemeral port) joins the CSRF allowlist after
// listen — mirroring production, where the public URL is configured.
auth = await loadAuth({ ...auth.config, allowedOrigins: [base] });

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

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (err) {
    results.push(`FAIL - ${name}: ${err.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
};

const login = async (page, tok) => {
  await page.goto(`${base}/#/browse`);
  await page.getByLabel("Token").fill(tok);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Browse" }).waitFor();
};

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
  // Logout clears it, even across history navigation.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in" }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 10000 });
  await ctx.close();
});

// Search, diagnostics, archive control.
await check("search + diagnostics + archive", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, humanToken);
  await page.getByLabel("Query").fill("hello");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("hello memory").waitFor();
  await page.getByLabel("Query").fill("bogus:1");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search errors").waitFor();
  await page.getByLabel("Query").fill("buried");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matching items.").waitFor();
  await page.getByLabel("Show").check();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("buried memory").waitFor();
  await ctx.close();
});

// Arbitrary JSON fidelity + XSS inertness.
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

for (const line of results) console.log(line);
await browser.close();
await seedRepo.close();
await sharedRepo.close();
await pool.end();
// Explicit exit: keep-alive sockets otherwise hold the loop open forever.
process.exit(process.exitCode ?? 0);
