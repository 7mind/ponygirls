import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, advanceClock, api, connectionConfig } from './fixture.mjs';
import { themeBehaviorContract } from '../tests/theme-contract.ts';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const origin = `http://127.0.0.1:${address.port}`, browser = await chromium.launch({ headless: true }), errors = [];
// The document ground is the shared --bg-surface token of each theme (shared/ui-web/tokens.css).
const THEME_SURFACE_RGB = { light: 'rgb(255, 255, 255)', dark: 'rgb(21, 25, 32)' };
const SIGN_IN = /^Sign in/, CHOICE_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const DESKTOP = { width: 1440, height: 900 }, MOBILE = { width: 390, height: 844 }, THEME_KEY = 'chronicle.theme.preference';
async function scene(viewport, configure) { return sceneWith(viewport, '', configure); }
// `connection`: query string of the page load (connectionTiming), '' for production connection settings.
async function sceneWith(viewport, connection, configure) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); await configure({ context, page, fixture }); await fixture.install(page); await page.goto(`${origin}/tests-browser/harness.html${connection}`); if (fixture.signedIn) { await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); } else await page.getByRole('heading', { name: SIGN_IN }).waitFor();
  return { context, page, fixture };
}
async function run(name, body) { if (process.env.CHRONICLE_THEME_CASE !== undefined && !name.includes(process.env.CHRONICLE_THEME_CASE)) return; await body(); console.log(`PASS browser theme/retry: ${name}`); }
try {
  await themeCases();
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }

async function snapshot(page) { return page.evaluate(() => { const data = document.documentElement.dataset; return { preference: data.themeChoice, resolved: data.theme, persistence: data.themePersistence }; }); }
async function choose(page, preference) { if (await page.getByRole('button', { name: 'Theme settings', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await page.getByRole('menuitemradio', { name: CHOICE_LABELS[preference], exact: true }).click(); await page.waitForFunction(value => document.documentElement.dataset.themeChoice === value, preference); }
async function settledFrame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function storeInTab(page, value) { await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }, { key: THEME_KEY, value }); }
async function waitStoredTheme(page, value) { await page.waitForFunction(value => { const data = document.documentElement.dataset; return data.themeChoice === (value === 'light' || value === 'dark' ? value : 'system') && data.themePersistence === (value === null || ['system', 'light', 'dark'].includes(value) ? 'available' : 'invalid'); }, value); }
async function configureTheme(context, page, colorScheme, preference) { await page.emulateMedia({ colorScheme }); if (preference !== null) await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_KEY, value: preference }); }
async function source(page) { await page.locator('.archive-row .table-title').first().click(); await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor(); await page.locator('.original-message').first().waitFor(); }
async function themeCases() {
  await run('explicit Dark and Light override either device scheme for the page and its native controls', async () => {
    for (const system of ['light', 'dark']) {
      const { context, page } = await scene(DESKTOP, async ({ page, fixture }) => { fixture.signedIn = false; await page.emulateMedia({ colorScheme: system }); });
      const rendered = () => page.evaluate(() => { const input = getComputedStyle(document.querySelector('main[data-account-auth] input[name="login"]')); return { scheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.documentElement).backgroundColor, inputScheme: input.colorScheme, inputBackground: input.backgroundColor }; });
      for (const theme of ['dark', 'light']) {
        await choose(page, theme); const shown = await rendered();
        assert.equal(shown.scheme, theme); assert.equal(shown.inputScheme, theme); assert.equal(shown.background, THEME_SURFACE_RGB[theme]); assert.equal(shown.inputBackground, THEME_SURFACE_RGB[theme]);
      }
      await context.close();
    }
  });
  await run('shared theme behavior contract · actual browser storage, storage events and device media', async () => {
    const { context, page } = await scene(DESKTOP, async ({ page }) => page.emulateMedia({ colorScheme: 'light' })); const other = await context.newPage(); await other.goto(`${origin}/theme-init.js`);
    try { await themeBehaviorContract({ snapshot: () => snapshot(page), choose: preference => choose(page, preference), saved: () => page.evaluate(key => localStorage.getItem(key), THEME_KEY), system: async dark => { await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await settledFrame(page); }, external: async preference => { await storeInTab(other, preference); await waitStoredTheme(page, preference); } }); }
    finally { await context.close(); }
  });
  await run('theme choices are available before sign-in, persist through reload and follow the device only in System', async () => {
    const { context, page, fixture } = await scene(MOBILE, async ({ page, fixture }) => { fixture.signedIn = false; await page.emulateMedia({ colorScheme: 'dark' }); });
    assert.deepEqual(await snapshot(page), { preference: 'system', resolved: 'dark', persistence: 'available' }); const form = page.locator('main[data-account-auth] form'), login = page.getByRole('textbox', { name: 'Username', exact: true }); await login.fill('unsent-synthetic-login');
    const formNode = await form.elementHandle(); await choose(page, 'light'); assert.equal(await formNode.evaluate(element => element.isConnected && element === document.querySelector('main[data-account-auth] form')), true); assert.equal(await login.inputValue(), 'unsent-synthetic-login');
    await page.emulateMedia({ colorScheme: 'dark' }); await settledFrame(page); assert.equal((await snapshot(page)).resolved, 'light'); await page.reload(); await page.getByRole('heading', { name: SIGN_IN }).waitFor(); assert.equal((await snapshot(page)).preference, 'light');
    await choose(page, 'system'); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); await context.close();
  });
  await run('read-denied and write-denied preference storage explicitly report tab-local unsaved choices', async () => {
    for (const denial of ['read', 'write']) {
      const { context, page } = await scene(MOBILE, async ({ context, page, fixture }) => { fixture.signedIn = false; await page.emulateMedia({ colorScheme: 'dark' }); await context.addInitScript(denial => {
        if (denial === 'read') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Synthetic storage denial', 'SecurityError'); } });
        else Storage.prototype.setItem = () => { throw new DOMException('Synthetic quota denial', 'QuotaExceededError'); };
      }, denial); });
      if (denial === 'read') assert.equal((await snapshot(page)).persistence, 'unavailable'); await choose(page, 'light'); await page.getByText('Not saved', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Theme preference cannot be saved' }).waitFor(); assert.deepEqual(await snapshot(page), { preference: 'light', resolved: 'light', persistence: 'unavailable' }); await context.close();
    }
  });
  await run('malformed stored preferences visibly use System without silently changing stored data', async () => {
    for (const viewport of [DESKTOP, MOBILE]) {
      const { context, page } = await scene(viewport, async ({ context, page }) => configureTheme(context, page, 'dark', 'unknown-future-value'));
      assert.deepEqual(await snapshot(page), { preference: 'system', resolved: 'dark', persistence: 'invalid' }); await page.getByText('Invalid saved setting', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'saved theme preference is invalid' }).waitFor(); assert.equal(await page.evaluate(key => localStorage.getItem(key), THEME_KEY), 'unknown-future-value');
      const menu = await page.locator('.theme-menu').boundingBox(); assert.ok(menu.x >= 0 && menu.x + menu.width <= viewport.width, `preference menu leaves viewport in warning state: ${JSON.stringify(menu)}`);
      await choose(page, 'dark'); assert.equal((await snapshot(page)).persistence, 'available'); assert.equal(await page.getByText('Invalid saved setting', { exact: true }).count(), 0); await context.close();
    }
  });
  await run('theme changes retain Archive draft, loaded rows, scroll, DOM identity and source pins without submitting requests', async () => {
    const { context, page, fixture } = await scene(DESKTOP, async ({ fixture, page }) => {
      fixture.archiveRowCount = 85; await page.emulateMedia({ colorScheme: 'light' });
      await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'));
    });
    const editor = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await editor.fill('project:"unsent synthetic draft" AND'); const row = await page.locator('.archive-row').first().elementHandle(), scroll = () => page.evaluate(() => [window.scrollY, window.scrollX]); await page.evaluate(() => window.scrollTo(0, 240)); const before = await scroll(), calls = fixture.calls.length;
    await choose(page, 'dark'); await choose(page, 'light'); assert.deepEqual(await scroll(), before); assert.equal(await row.evaluate(element => element.isConnected && element === document.querySelector('.archive-row')), true); assert.equal(await editor.inputValue(), 'project:"unsent synthetic draft" AND'); assert.equal(fixture.calls.length, calls);
    await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await page.evaluate(() => window.scrollTo(0, 0)); await source(page);
    await page.locator('.conversation-source').evaluate(element => { element.scrollTop = 320; }); const message = await page.locator('.original-message').first().elementHandle(), pin = await page.locator('.provenance').innerText(), sourceCalls = fixture.calls.length;
    const focused = page.getByRole('button', { name: 'Close conversation', exact: true }); await focused.focus(); const sourceScroll = await page.locator('.conversation-source').evaluate(element => element.scrollTop); const other = await context.newPage(); await other.goto(`${origin}/theme-init.js`); await storeInTab(other, 'dark'); await waitStoredTheme(page, 'dark');
    assert.equal(await focused.evaluate(element => element === document.activeElement), true); assert.equal(await page.locator('.conversation-source').evaluate(element => element.scrollTop), sourceScroll); assert.equal(await message.evaluate(element => element.isConnected && element === document.querySelector('.original-message')), true); assert.equal(await page.locator('.provenance').innerText(), pin); assert.equal(fixture.calls.length, sourceCalls);
    await advanceClock(page, connectionConfig.heartbeatInterval - 1); assert.equal(fixture.calls.length, sourceCalls, 'no heartbeat before its interval');
    await advanceClock(page, 1); await fixture.waitUntil(() => fixture.calls.length > sourceCalls, 'no heartbeat after its interval');
    const afterTheme = fixture.calls.slice(sourceCalls);
    assert.equal(afterTheme.length, 1, 'one real heartbeat runs after the paused source-theme assertions');
    assert.equal(afterTheme[0].operation instanceof api.Operation_Ping, true, 'theme does not queue an application or mutation request');
    await context.close();
  });
  await productionPrepaint();
}

async function productionPrepaint() {
  await run('self-hosted prepaint applies before the app bundle and the production app works under unchanged server CSP', async () => {
    await build({ root, logLevel: 'warn' }); const directory = resolve(root, 'dist'); const csp = "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    const backend = await readFile(resolve(root, '../server/src/main/scala/chronicle/Http.scala'), 'utf8'); assert.ok(backend.includes(`"${csp}"`));
    const staticServer = httpServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://synthetic.invalid').pathname, file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${directory}/`)) { response.writeHead(403); response.end(); return; }
      try { const body = await readFile(file); response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': csp }); response.end(body); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve)); const address = staticServer.address(); if (address === null || typeof address === 'string') throw new Error('Missing static fixture address'); const base = `http://127.0.0.1:${address.port}`;
    try {
      for (const [system, preference, expected] of [['dark', null, 'dark'], ['dark', 'light', 'light'], ['light', 'dark', 'dark']]) {
        const context = await browser.newContext({ viewport: DESKTOP, colorScheme: system }), page = await context.newPage(), fixture = new ChronicleFixture(), held = [];
        await context.addInitScript(({ key, preference }) => {
          if (preference !== null) localStorage.setItem(key, preference);
          window.themePaints = []; window.themePolicyViolations = [];
          new PerformanceObserver(list => { for (const entry of list.getEntries()) window.themePaints.push({ name: entry.name, theme: document.documentElement.dataset.theme, choice: document.documentElement.dataset.themeChoice, background: getComputedStyle(document.documentElement).backgroundColor, scheme: document.documentElement.style.colorScheme }); }).observe({ type: 'paint', buffered: true });
          document.addEventListener('securitypolicyviolation', event => window.themePolicyViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
        }, { key: THEME_KEY, preference });
        page.on('pageerror', error => errors.push(error.message)); await fixture.install(page); await page.route('**/assets/*.js', route => { held.push(route); }); await page.goto(base, { waitUntil: 'commit' });
        await page.waitForFunction(() => window.themePaints.length > 0); const paints = await page.evaluate(() => window.themePaints); assert.ok(held.length > 0); assert.equal(await page.locator('#root').innerHTML(), '');
        for (const paint of paints) { assert.equal(paint.theme, expected); assert.equal(paint.choice, preference ?? 'system'); assert.equal(paint.scheme, expected); assert.equal(paint.background, THEME_SURFACE_RGB[expected]); }
        for (const route of held) await route.continue(); await page.unroute('**/assets/*.js'); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), THEME_SURFACE_RGB[expected]);
        const nextTheme = expected === 'dark' ? 'light' : 'dark'; await choose(page, nextTheme);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), THEME_SURFACE_RGB[nextTheme]);
        assert.deepEqual(await page.evaluate(() => window.themePolicyViolations), []);
        await context.close();
      }
    } finally { await new Promise((resolve, reject) => staticServer.close(error => error === undefined ? resolve() : reject(error))); }
  });
}
