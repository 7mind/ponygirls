// Behavioral-Active-Blackbox-GoodCommunication: real Haystack React UI and common
// account assets in Chromium, with owned API fixtures rather than a real backend.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";

const executablePath = process.env.HAYSTACK_CHROMIUM;
assert.ok(typeof executablePath === "string" && executablePath.startsWith("/"), "HAYSTACK_CHROMIUM must name the pinned browser executable");
const root = fileURLToPath(new URL("../", import.meta.url));
const assets = process.env.HAYSTACK_ACCOUNT_WEB_ROOT ?? fileURLToPath(new URL("../../../shared/account-web/", import.meta.url));
assert.ok(path.isAbsolute(assets), "HAYSTACK_ACCOUNT_WEB_ROOT must be absolute");
const accountAssets = new Map(await Promise.all(["account.js", "account.css"].map(async name => [name, await readFile(path.join(assets, name))])));
console.log(`# controlled account assets ${[...accountAssets].map(([name, bytes]) => `${name}:${createHash("sha256").update(bytes).digest("hex")}`).join(" ")}`);
const password = randomBytes(32).toString("base64url");
const apiToken = randomBytes(32).toString("base64url");
const sessions = new Map();
const issued = [];
const configured = { id: "configured/" + "declarative".repeat(15), name: "Declared automation " + "configuration".repeat(8), source: "configured", createdAt: null, revoked: false, scopes: ["api"] };
const user = id => ({ id, login: id, displayName: id === "operator" ? "Operator" : "Replacement account", actor: createHash("sha256").update(`account-actor-v1:${id}`, "utf8").digest("hex") });
const routes = [];
let base;
const vite = await createServer({ root, configFile: false, plugins: [react(), {
  name: "account-api-fixture",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://fixture.invalid");
      const asset = accountAssets.get(url.pathname.slice(1));
      if (asset !== undefined) { res.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css"); res.end(asset); return; }
      if (url.pathname === "/account-fixture.html") {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/account.css" vite-ignore><script type="module" src="/account.js" vite-ignore></script></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'));
        return;
      }
      if (!url.pathname.startsWith("/api/")) { next(); return; }
      routes.push(url.pathname);
      const send = (status, value) => { res.statusCode = status; res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
      const fail = (status, code) => send(status, { error: { code, message: code } });
      const cookie = /(?:^|;\s*)haystack-ui=([^;]+)/.exec(req.headers.cookie ?? "");
      const session = cookie === null ? undefined : sessions.get(cookie[1]);
      let body = null;
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        assert.equal(req.headers.origin, base, "account fixture mutations must remain same-origin");
      }
      if (url.pathname === "/api/account/v1/login") {
        if (body.login !== "operator" || body.password !== password) { fail(401, "unauthorized"); return; }
        const secret = randomBytes(32).toString("base64url");
        sessions.set(secret, { userId: "operator", id: randomBytes(8).toString("hex") });
        res.setHeader("Set-Cookie", `haystack-ui=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`);
        send(200, { user: user("operator") }); return;
      }
      if (session === undefined) { fail(401, "unauthorized"); return; }
      if (url.pathname === "/api/v1/whoami") { send(200, { userId: session.userId, userType: "human", tokenId: session.id, activityProjectId: "corporate-activity" }); return; }
      if (url.pathname === "/api/v1/logout") {
        sessions.delete(cookie[1]); res.setHeader("Set-Cookie", "haystack-ui=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"); send(200, { ok: true }); return;
      }
      if (url.pathname === "/api/v1/search") { send(200, { items: [], cursor: null }); return; }
      if (url.pathname === "/api/v1/query/analyze") { send(200, { valid: true, spans: [] }); return; }
      if (url.pathname === "/api/account/v1" && req.method === "GET") { send(200, { user: user(session.userId), tokens: [configured, ...issued], scopes: ["api"] }); return; }
      if (url.pathname === "/api/account/v1/tokens") {
        assert.equal(req.headers["x-account-actor"], user(session.userId).actor, "token creation binds the preflight account actor");
        assert.deepEqual(body.scopes, ["api"]);
        const token = { id: `issued/${issued.length + 1}`, name: body.name, source: "issued", createdAt: new Date().toISOString(), revoked: false, scopes: ["api"] };
        issued.push(token); send(200, { token, secret: apiToken }); return;
      }
      const revoke = /^\/api\/account\/v1\/tokens\/(.+)\/revoke$/.exec(url.pathname);
      if (revoke !== null) {
        assert.equal(req.headers["x-account-actor"], user(session.userId).actor, "token revocation binds the preflight account actor");
        const token = issued.find(token => token.id === decodeURIComponent(revoke[1]));
        if (token === undefined) { fail(403, "forbidden"); return; }
        token.revoked = true; send(200, { ok: true }); return;
      }
      fail(404, "not-found");
    });
  },
}], server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await vite.listen(); base = vite.resolvedUrls.local[0].replace(/\/$/, "");
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  for (const width of [1440, 390, 320]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, permissions: ["clipboard-read", "clipboard-write"] });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${base}/account-fixture.html#/browse`);
      await page.getByLabel("Username", { exact: true }).fill("operator");
      await page.getByLabel("Password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Invalid login or password" }).waitFor();
      assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "", "login submission clears the plaintext input");
      await page.route("**/api/account/v1/login", route => route.fulfill({ status: 503, contentType: "text/html", body: "Unavailable" }));
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "credentials have not been rejected" }).waitFor();
      await page.unroute("**/api/account/v1/login");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const settings = page.getByRole("button", { name: "Settings", exact: true });
      await settings.waitFor();
      const session = (await context.cookies(base)).find(cookie => cookie.name === "haystack-ui");
      assert.ok(session.httpOnly && session.value !== password && session.value !== apiToken);
      await settings.click();
      const dialog = page.getByRole("dialog", { name: "Account settings", exact: true });
      await dialog.getByText("Managed in server configuration; read-only here.", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: `Revoke ${configured.name}`, exact: true }).count(), 0, "configured tokens have no mutation control");
      const tokenName = `Browser fixture ${width} ${colorScheme}`;
      await dialog.getByLabel("Token name", { exact: true }).fill(tokenName);
      await dialog.getByRole("button", { name: "Create access token", exact: true }).click();
      const secret = dialog.getByLabel("One-time token secret", { exact: true });
      await secret.waitFor();
      assert.ok(await secret.inputValue() === apiToken);
      assert.equal(await dialog.getByRole("button", { name: "Create access token", exact: true }).isDisabled(), true);
      await dialog.getByRole("button", { name: "Copy secret", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: "Secret copied" }).waitFor();
      assert.ok(await page.evaluate(async expected => await navigator.clipboard.readText() === expected, apiToken));
      assert.ok(await page.evaluate(expected => ![...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(expected)), apiToken), "one-time secret must not enter web storage");
      const fit = await dialog.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, scroll: element.scrollWidth, client: element.clientWidth }));
      assert.ok(fit.left >= 0 && fit.right <= width && fit.scroll <= fit.client + 1, `${width}/${colorScheme}: settings fit without horizontal clipping`);
      await dialog.getByRole("button", { name: "Dismiss secret", exact: true }).click();
      assert.equal(await page.getByLabel("One-time token secret", { exact: true }).count(), 0);
      page.once("dialog", confirm => confirm.dismiss());
      await dialog.getByRole("button", { name: `Revoke ${tokenName}`, exact: true }).click();
      assert.equal(await dialog.getByRole("button", { name: `Revoke ${tokenName}`, exact: true }).count(), 1);
      page.once("dialog", confirm => confirm.accept());
      await dialog.getByRole("button", { name: `Revoke ${tokenName}`, exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: "Access token revoked." }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: `Revoke ${tokenName}`, exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 0);
      assert.equal(await settings.evaluate(element => element === document.activeElement), true, "closing Settings restores keyboard focus");
      await settings.click();
      await dialog.getByLabel("Token name", { exact: true }).waitFor();
      sessions.get(session.value).userId = "replacement";
      await dialog.getByRole("button", { name: "Refresh token list", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("[data-account-settings]").dataset.accountUserId === "replacement");
      assert.equal(await dialog.count(), 0, "server-observed account changes close stale Settings and refresh Haystack identity");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).waitFor();
      assert.equal((await context.cookies(base)).some(cookie => cookie.name === "haystack-ui"), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  assert.equal(routes.includes("/api/v1/login"), false, "Haystack must not use legacy API-token login");
  console.log("ok - Haystack password login, settings lifecycle and token controls fit desktop and mobile");
} finally { if (browser !== undefined) await browser.close(); await vite.close(); }
