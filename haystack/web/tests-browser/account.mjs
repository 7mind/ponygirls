// Behavioral-Active-Blackbox-GoodCommunication: real Haystack React UI and common
// account assets in Chromium, with owned API fixtures rather than a real backend.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const executablePath = process.env.HAYSTACK_CHROMIUM;
assert.ok(typeof executablePath === "string" && executablePath.startsWith("/"), "HAYSTACK_CHROMIUM must name the pinned browser executable");
const root = fileURLToPath(new URL("../", import.meta.url));
const assets = process.env.HAYSTACK_ACCOUNT_WEB_ROOT ?? fileURLToPath(new URL("../../../shared/account-web/", import.meta.url));
assert.ok(path.isAbsolute(assets), "HAYSTACK_ACCOUNT_WEB_ROOT must be absolute");
const accountAssets = new Map(await Promise.all(["account.js", "account-client.js", "account.css"].map(async name => [name, await readFile(path.join(assets, name))])));
console.log(`# controlled account assets ${[...accountAssets].map(([name, bytes]) => `${name}:${createHash("sha256").update(bytes).digest("hex")}`).join(" ")}`);
// The dashboard's own asset plugin (vite.config.ts) serves the account and shared design-system files from here.
process.env.ACCOUNT_WEB_ROOT = assets;
const password = randomBytes(32).toString("base64url");
const apiToken = randomBytes(32).toString("base64url");
const sessions = new Map();
const issued = [];
const configured = { id: "configured/" + "declarative".repeat(15), name: "Declared automation " + "configuration".repeat(8), source: "configured", createdAt: null, revoked: false, scopes: ["api"] };
const user = id => ({ id, login: id, displayName: id === "operator" ? "Operator" : "Replacement account", actor: createHash("sha256").update(`account-actor-v1:${id}`, "utf8").digest("hex") });
const routes = [];
let base;
const vite = await createServer({ root, plugins: [{
  name: "account-api-fixture",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://fixture.invalid");
      if (url.pathname === "/account-fixture.html") {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(url.pathname, '<!doctype html><html lang="en" data-app="haystack"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="/ui/theme-init.js" vite-ignore></script><link rel="stylesheet" href="/ui/tokens.css" vite-ignore><link rel="stylesheet" href="/ui/components.css" vite-ignore><script type="module" src="/account.js" vite-ignore></script></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script><link rel="stylesheet" href="/account.css" vite-ignore></body></html>'));
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
      if (url.pathname === "/api/account/v1/logout") {
        assert.equal(req.headers["x-account-actor"], user(session.userId).actor, "sign-out binds the preflight account actor");
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
  // Desktop widths only: the shared account page has no phone layout yet (its token table overflows below 720 px).
  for (const width of [1440, 1024]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, permissions: ["clipboard-read", "clipboard-write"] });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => { errors.push(`native dialog: ${dialog.message()}`); void dialog.dismiss(); });
      await page.goto(`${base}/account-fixture.html#/browse`);
      await page.getByLabel("Username", { exact: true }).fill("operator");
      await page.getByLabel("Password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Invalid username or password." }).waitFor();
      assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "", "login submission clears the plaintext input");
      await page.route("**/api/account/v1/login", route => route.fulfill({ status: 503, contentType: "text/html", body: "Unavailable" }));
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "credentials have not been rejected" }).waitFor();
      await page.unroute("**/api/account/v1/login");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const userMenu = page.getByRole("button", { name: "operator", exact: true });
      await userMenu.waitFor();
      const session = (await context.cookies(base)).find(cookie => cookie.name === "haystack-ui");
      assert.ok(session.httpOnly && session.value !== password && session.value !== apiToken);
      const query = page.getByRole("combobox", { name: "Query", exact: true });
      await query.fill("background query");
      await query.evaluate(input => input.setSelectionRange(3, 3));
      const openTokens = async () => {
        await userMenu.click();
        await page.getByRole("menuitem", { name: "Access tokens", exact: true }).click();
        await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor();
      };
      await openTokens();
      const outlet = page.locator("[data-account-outlet]");
      const tokens = page.getByRole("table", { name: "Access tokens", exact: true });
      await tokens.getByText(configured.name, { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: `Revoke ${configured.name}`, exact: true }).count(), 0, "configured tokens have no mutation control");
      await page.evaluate(() => {
        window.shortcutProbe = [];
        window.addEventListener("keydown", event => {
          if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
          queueMicrotask(() => {
            const query = document.querySelector('input[role="combobox"]');
            window.shortcutProbe.push({ prevented: event.defaultPrevented, selection: [query.selectionStart, query.selectionEnd] });
          });
        });
      });
      for (const shortcut of ["Control+k", "Meta+k"]) {
        await page.keyboard.press(shortcut);
        const probe = await page.evaluate(() => window.shortcutProbe.at(-1));
        assert.equal(probe.prevented, false, "the hidden list's search shortcut does not act under the account page");
        assert.deepEqual(probe.selection, [3, 3], "the kept background query selection does not change");
      }
      const tokenName = `Browser fixture ${width} ${colorScheme}`;
      await page.getByRole("button", { name: "New token", exact: true }).first().click();
      await page.getByLabel("Name", { exact: true }).fill(tokenName);
      await page.getByRole("button", { name: "Create token", exact: true }).click();
      const secret = page.getByLabel("One-time token secret", { exact: true });
      await secret.waitFor();
      assert.notEqual(await secret.inputValue(), apiToken, "the one-time secret is masked");
      await page.getByRole("button", { name: "Reveal", exact: true }).click();
      assert.equal(await secret.inputValue(), apiToken);
      await page.getByRole("button", { name: "Copy secret", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Secret copied to clipboard" }).waitFor();
      assert.ok(await page.evaluate(async expected => await navigator.clipboard.readText() === expected, apiToken));
      assert.ok(await page.evaluate(expected => ![...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(expected)), apiToken), "one-time secret must not enter web storage");
      const fit = await outlet.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, page: document.documentElement.scrollWidth }));
      assert.ok(fit.left >= 0 && fit.right <= width && fit.page <= width, `${width}/${colorScheme}: the account page fits without horizontal overflow`);
      await page.getByRole("button", { name: "I have saved it", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Yes, I have saved it", exact: true }).click();
      await secret.waitFor({ state: "detached" });
      const revoke = page.getByRole("button", { name: `Revoke ${tokenName}`, exact: true });
      await revoke.click();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await revoke.count(), 1, "cancelling the in-app confirmation keeps the token");
      await revoke.click();
      await page.getByRole("dialog").getByRole("button", { name: "Revoke token", exact: true }).click();
      await page.getByRole("status").filter({ hasText: `Token “${tokenName}” revoked` }).waitFor();
      assert.equal(await revoke.count(), 0);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).click();
      await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await query.inputValue(), "background query", "the list and its draft were kept under the account page");
      await openTokens();
      sessions.get(session.value).userId = "replacement";
      await page.getByRole("button", { name: "Refresh token list", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("[data-account-outlet]").dataset.accountUserId === "replacement");
      await page.getByRole("button", { name: "replacement", exact: true }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Username", { exact: true }).waitFor();
      assert.equal((await context.cookies(base)).some(cookie => cookie.name === "haystack-ui"), false);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  assert.equal(routes.includes("/api/v1/login"), false, "Haystack must not use legacy API-token login");
  console.log("ok - Haystack password login, account page in the outlet with token lifecycle, identity change and module sign-out at desktop widths");
} finally { if (browser !== undefined) await browser.close(); await vite.close(); }
