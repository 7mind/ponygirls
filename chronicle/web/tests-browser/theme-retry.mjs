import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
import { themeBehaviorContract } from '../tests/theme-contract.ts';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const origin = `http://127.0.0.1:${address.port}`, browser = await chromium.launch({ headless: true }), errors = [];
const AA_TEXT = 4.5, AA_CONTROL = 3;
const MIN_LIGHT_CANVAS_LUMINANCE = .85, MIN_DARK_CANVAS_LUMINANCE = .02, MAX_DARK_CANVAS_LUMINANCE = .12, MIN_DARK_SURFACE_CONTRAST = 1.25;
const THEME_CANVAS_RGB = { light: 'rgb(241, 245, 249)', dark: 'rgb(36, 44, 55)' };
const MAX_COMPACT_RETRY_WIDTH = 280, MIN_SUMMARY_TABLE_FRACTION = .9, DESKTOP = { width: 1440, height: 900 }, MOBILE = { width: 390, height: 844 }, THEME_KEY = 'chronicle.theme.preference';
const evidence = resolve(root, 'test-results/theme-retry'); await mkdir(evidence, { recursive: true });
async function scene(viewport, configure) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); await configure({ context, page, fixture }); await fixture.install(page); await page.goto(`${origin}/tests-browser/harness.html`); if (fixture.signedIn) await page.locator('.archive-row').first().waitFor(); else await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  return { context, page, fixture };
}
async function run(name, body) { if (process.env.CHRONICLE_THEME_CASE !== undefined && !name.includes(process.env.CHRONICLE_THEME_CASE)) return; await body(); console.log(`PASS browser theme/retry: ${name}`); }
try {
  await run('compact retry uses the owner-summary toolbar instead of reserving half the totals pane', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const { context, page, fixture } = await scene(viewport, async () => {}); await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-overview .section-heading time').waitFor();
      const metrics = await page.evaluate(() => {
        const summary = document.querySelector('.activity-overview'), table = summary.querySelector('.activity-counts'), trigger = summary.querySelector('.retry-failed-action > button, .retry-failed-trigger'), style = getComputedStyle(summary);
        return { available: summary.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), totals: table.getBoundingClientRect().width, button: trigger.getBoundingClientRect().width, document: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      assert.ok(metrics.totals >= metrics.available * MIN_SUMMARY_TABLE_FRACTION, `owner totals lose width to the retry/help column: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.button <= MAX_COMPACT_RETRY_WIDTH, `retry action is not compact: ${JSON.stringify(metrics)}`); assert.ok(metrics.document <= metrics.viewport);
      const trigger = page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }); await trigger.click(); const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').waitFor();
      assert.equal(await preview.getByRole('checkbox').isChecked(), false); assert.equal(await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).isDisabled(), true);
      await preview.getByRole('button', { name: 'Cancel retry preview', exact: true }).click(); assert.equal(await trigger.evaluate(element => element === document.activeElement), true); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 0);
      await context.close();
    }
  });
  await themeCases();
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }

async function snapshot(page) { return page.evaluate(() => { const data = document.documentElement.dataset; return { preference: data.themePreference, resolved: data.theme, persistence: data.themePersistence }; }); }
async function choose(page, preference) { if (!await page.locator('.theme-control').evaluate(element => element.open)) await page.locator('.theme-control>summary').click(); await page.getByLabel('Color theme', { exact: true }).selectOption(preference); await page.waitForFunction(value => document.documentElement.dataset.themePreference === value, preference); }
async function settledFrame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function storeInTab(page, value) { await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }, { key: THEME_KEY, value }); }
async function waitStoredTheme(page, value) { await page.waitForFunction(value => { const data = document.documentElement.dataset; return data.themePreference === (value === 'light' || value === 'dark' ? value : 'system') && data.themePersistence === (value === null || ['system', 'light', 'dark'].includes(value) ? 'available' : 'invalid'); }, value); }
async function configureTheme(context, page, colorScheme, preference) { await page.emulateMedia({ colorScheme }); if (preference !== null) await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_KEY, value: preference }); }
async function activity(page) { await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-overview .section-heading time').waitFor(); }
async function source(page) { await page.locator('.archive-row .table-title').first().click(); await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor(); await page.locator('.original-message').first().waitFor(); }
async function themeCases() {
  await run('specified lifted dark surfaces and genuinely light rendered controls under either device scheme', async () => {
    for (const system of ['light', 'dark']) {
      const { context, page } = await scene(DESKTOP, async ({ page, fixture }) => { fixture.signedIn = false; await page.emulateMedia({ colorScheme: system }); });
      await choose(page, 'dark');
      const dark = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return { canvas: style.getPropertyValue('--canvas').trim(), paper: style.getPropertyValue('--paper').trim(), background: style.backgroundColor }; });
      assert.ok(luminance(dark.canvas) >= MIN_DARK_CANVAS_LUMINANCE, `Dark canvas is near black: ${luminance(dark.canvas)} < ${MIN_DARK_CANVAS_LUMINANCE}`);
      assert.ok(luminance(dark.canvas) <= MAX_DARK_CANVAS_LUMINANCE);
      assert.ok(contrast(dark.canvas, dark.paper) >= MIN_DARK_SURFACE_CONTRAST, 'Dark panels must be visibly separated from the canvas');
      await choose(page, 'light');
      const light = await page.evaluate(() => { const style = getComputedStyle(document.documentElement), input = getComputedStyle(document.querySelector('.login-card input')); return { canvas: style.getPropertyValue('--canvas').trim(), scheme: style.colorScheme, background: style.backgroundColor, inputBackground: input.backgroundColor, inputScheme: input.colorScheme, ink: input.color }; });
      assert.ok(luminance(light.canvas) >= MIN_LIGHT_CANVAS_LUMINANCE, 'Explicit Light must render a light canvas, including on a dark OS');
      assert.equal(light.scheme, 'light'); assert.equal(light.inputScheme, 'light'); assert.notEqual(light.background, dark.background);
      assert.equal(light.inputBackground, 'rgb(255, 255, 255)');
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
    assert.deepEqual(await snapshot(page), { preference: 'system', resolved: 'dark', persistence: 'available' }); const form = page.locator('.login-card form'), login = page.getByRole('textbox', { name: 'Login', exact: true }); await login.fill('unsent-synthetic-login');
    const formNode = await form.elementHandle(); await choose(page, 'light'); assert.equal(await formNode.evaluate(element => element.isConnected && element === document.querySelector('.login-card form')), true); assert.equal(await login.inputValue(), 'unsent-synthetic-login');
    await page.emulateMedia({ colorScheme: 'dark' }); await settledFrame(page); assert.equal((await snapshot(page)).resolved, 'light'); await page.reload(); await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor(); assert.equal((await snapshot(page)).preference, 'light');
    await choose(page, 'system'); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); await context.close();
  });
  await run('read-denied and write-denied preference storage explicitly report tab-local unsaved choices', async () => {
    for (const denial of ['read', 'write']) {
      const { context, page } = await scene(MOBILE, async ({ context, page, fixture }) => { fixture.signedIn = false; await page.emulateMedia({ colorScheme: 'dark' }); await context.addInitScript(denial => {
        if (denial === 'read') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Synthetic storage denial', 'SecurityError'); } });
        else Storage.prototype.setItem = () => { throw new DOMException('Synthetic quota denial', 'QuotaExceededError'); };
      }, denial); });
      if (denial === 'read') assert.equal((await snapshot(page)).persistence, 'unavailable'); await choose(page, 'light'); await page.getByText('Not saved', { exact: true }).waitFor(); await page.getByRole('status').filter({ hasText: 'Theme preference cannot be saved' }).waitFor(); assert.deepEqual(await snapshot(page), { preference: 'light', resolved: 'light', persistence: 'unavailable' }); await context.close();
    }
  });
  await run('malformed stored preferences visibly use System without silently changing stored data', async () => {
    for (const viewport of [DESKTOP, MOBILE]) {
      const { context, page } = await scene(viewport, async ({ context, page }) => configureTheme(context, page, 'dark', 'unknown-future-value'));
      assert.deepEqual(await snapshot(page), { preference: 'system', resolved: 'dark', persistence: 'invalid' }); await page.getByText('Invalid saved setting', { exact: true }).waitFor(); await page.locator('.theme-control>summary').click(); await page.getByRole('status').filter({ hasText: 'saved theme preference is invalid' }).waitFor(); assert.equal(await page.evaluate(key => localStorage.getItem(key), THEME_KEY), 'unknown-future-value');
      const menu = await page.locator('.theme-menu').boundingBox(); assert.ok(menu.x >= 0 && menu.x + menu.width <= viewport.width, `preference menu leaves viewport in warning state: ${JSON.stringify(menu)}`);
      await choose(page, 'dark'); assert.equal((await snapshot(page)).persistence, 'available'); assert.equal(await page.getByText('Invalid saved setting', { exact: true }).count(), 0); await context.close();
    }
  });
  await run('theme changes retain Archive draft, loaded rows, scroll, DOM identity and source pins without submitting requests', async () => {
    const { context, page, fixture } = await scene(DESKTOP, async ({ fixture, page }) => { fixture.archiveRowCount = 85; await page.emulateMedia({ colorScheme: 'light' }); });
    const editor = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await editor.fill('project:"unsent synthetic draft" AND'); const row = await page.locator('.archive-row').first().elementHandle(), scroll = page.locator('.archive-table-scroll'); await scroll.evaluate(element => { element.scrollTop = 240; element.scrollLeft = 120; }); const before = await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), calls = fixture.calls.length;
    await choose(page, 'dark'); await choose(page, 'light'); assert.deepEqual(await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), before); assert.equal(await row.evaluate(element => element.isConnected && element === document.querySelector('.archive-row')), true); assert.equal(await editor.inputValue(), 'project:"unsent synthetic draft" AND'); assert.equal(fixture.calls.length, calls);
    await page.locator('.theme-control>summary').click(); await scroll.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; }); await source(page);
    await page.locator('.conversation-source').evaluate(element => { element.scrollTop = 320; }); const message = await page.locator('.original-message').first().elementHandle(), pin = await page.locator('.provenance').innerText(), sourceCalls = fixture.calls.length;
    const focused = page.getByRole('button', { name: 'Close conversation', exact: true }); await focused.focus(); const sourceScroll = await page.locator('.conversation-source').evaluate(element => element.scrollTop); const other = await context.newPage(); await other.goto(`${origin}/theme-init.js`); await storeInTab(other, 'dark'); await waitStoredTheme(page, 'dark');
    assert.equal(await focused.evaluate(element => element === document.activeElement), true); assert.equal(await page.locator('.conversation-source').evaluate(element => element.scrollTop), sourceScroll); assert.equal(await message.evaluate(element => element.isConnected && element === document.querySelector('.original-message')), true); assert.equal(await page.locator('.provenance').innerText(), pin); assert.equal(fixture.calls.length, sourceCalls); await context.close();
  });
  await run('owner-wide preview stays confirmed through theme changes, independent of History and filters; no Apply is implied', async () => {
    const { context, page, fixture } = await scene(DESKTOP, async () => {}); await activity(page); await page.getByRole('button', { name: 'History', exact: true }).click(); await page.getByRole('combobox', { name: 'Search indexing job metadata', exact: true }).fill('status:Failed'); await page.locator('.activity-jobs').getByRole('button', { name: 'Filter', exact: true }).click(); await page.locator('.activity-job-table[aria-busy="false"]').waitFor();
    const trigger = page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }); await trigger.click(); const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }), checkbox = preview.getByRole('checkbox'); await checkbox.check(); const node = await preview.elementHandle(), counts = await preview.locator('table').innerText(), calls = fixture.calls.length;
    await choose(page, 'dark'); assert.equal(await checkbox.isChecked(), true); assert.equal(await node.evaluate(element => element.isConnected && element === document.querySelector('.retry-failed-preview')), true); assert.equal(await preview.locator('table').innerText(), counts); assert.equal(await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).isEnabled(), true); assert.equal(fixture.calls.length, calls); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 0);
    await preview.getByRole('button', { name: 'Cancel retry preview', exact: true }).click(); assert.equal(await trigger.evaluate(element => element === document.activeElement), true); await context.close();
  });
  await run('theme changes cannot clear delivered retry uncertainty or resend Apply', async () => {
    const { context, page, fixture } = await scene(DESKTOP, async ({ fixture }) => { fixture.bulkDropReply = true; }); await activity(page); await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').check(); await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click(); await page.getByRole('region', { name: 'Uncertain mutation', exact: true }).waitFor();
    const uncertain = await page.locator('.notice.uncertain').innerText(), applies = fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).map(call => call.requestId); await choose(page, 'dark'); await choose(page, 'light'); assert.equal(await page.locator('.notice.uncertain').innerText(), uncertain); assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).isDisabled(), true); assert.deepEqual(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).map(call => call.requestId), applies); await context.close();
  });
  await visualCases();
  await productionPrepaint();
}

function luminance(hex) { assert.match(hex, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i); const value = hex.length === 4 ? hex.slice(1).split('').map(value => value + value).join('') : hex.slice(1); const channels = [0, 2, 4].map(index => { const channel = parseInt(value.slice(index, index + 2), 16) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; }
function contrast(a, b) { const left = luminance(a), right = luminance(b); return (Math.max(left, right) + .05) / (Math.min(left, right) + .05); }
async function paletteAudit(page, label) {
  const palette = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return Object.fromEntries(Array.from(style).filter(name => name.startsWith('--')).map(name => [name.slice(2), style.getPropertyValue(name).trim()])); });
  const pairs = [];
  for (const foreground of ['ink', 'muted']) for (const background of ['canvas', 'paper', 'soft', 'control-hover', 'notice-surface', 'error-surface', 'warning-surface', 'row-hover', 'row-selected', 'table-heading', 'table-sorted', 'passage-surface', 'passage-item', 'passage-selected', 'message-highlight', 'raw-surface', 'secret-surface', 'socket-surface']) pairs.push([foreground, background, AA_TEXT]);
  pairs.push(['on-accent', 'accent', AA_TEXT], ['on-accent', 'accent-hover', AA_TEXT], ['accent', 'paper', AA_TEXT], ['error', 'paper', AA_TEXT], ['error', 'error-surface', AA_TEXT], ['error-ink', 'error-surface', AA_TEXT], ['warning-ink', 'warning-surface', AA_TEXT], ['warning-ink', 'paper', AA_TEXT], ['success', 'paper', AA_TEXT], ['tag-ink', 'tag-surface', AA_TEXT], ['mark-ink', 'mark', AA_TEXT], ['role-ink', 'paper', AA_TEXT], ['passage-number', 'passage-item', AA_TEXT], ['placeholder', 'paper', AA_TEXT], ['healthy', 'paper', AA_TEXT], ['selection-ink', 'selection', AA_TEXT], ['disabled-ink', 'disabled-surface', AA_TEXT]);
  for (const background of ['paper', 'canvas', 'soft', 'notice-surface']) pairs.push(['focus', background, AA_CONTROL]);
  pairs.push(['control-border', 'paper', AA_CONTROL], ['control-border', 'canvas', AA_CONTROL]);
  const results = pairs.map(([foreground, background, minimum]) => ({ foreground, background, minimum, contrast: contrast(palette[foreground], palette[background]) }));
  for (const result of results) assert.ok(result.contrast >= result.minimum, `${label}: ${result.foreground}/${result.background} ${result.contrast.toFixed(3)} < ${result.minimum}`);
  return results;
}
async function visualCases() {
  await run('light/dark desktop/mobile views, controls and focus meet contrast and viewport geometry checks; synthetic screenshots', async () => {
    const metrics = [];
    for (const viewport of [DESKTOP, MOBILE]) for (const preference of ['light', 'dark']) {
      const label = `${preference}-${viewport.width}x${viewport.height}`, { context, page, fixture } = await scene(viewport, async ({ context, page }) => configureTheme(context, page, preference, preference));
      const ratios = await paletteAudit(page, label); const capture = async name => { await page.screenshot({ path: resolve(evidence, `${label}-${name}.png`), animations: 'disabled' }); };
      await capture('archive'); const native = await page.getByRole('combobox', { name: 'Search conversations', exact: true }).evaluate(element => ({ scheme: getComputedStyle(element).colorScheme, background: getComputedStyle(element).backgroundColor })); assert.equal(native.scheme, preference);
      await source(page); await capture('source'); await page.getByRole('button', { name: 'Close conversation', exact: true }).click(); await activity(page);
      await capture('activity'); const trigger = page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }); const box = await trigger.boundingBox(); assert.ok(box.width <= MAX_COMPACT_RETRY_WIDTH);
      const help = page.getByLabel('About owner-wide indexing retries', { exact: true }); await help.focus(); await page.keyboard.press('Enter'); const helpBox = await page.locator('.retry-failed-help-content').boundingBox(); assert.ok(helpBox.x >= 0 && helpBox.x + helpBox.width <= viewport.width); const focus = await help.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) })); assert.notEqual(focus.style, 'none'); assert.ok(focus.width >= 2); await capture('retry-help'); await page.keyboard.press('Enter');
      await trigger.click(); const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').waitFor(); const previewBox = await preview.boundingBox(), overviewBox = await page.locator('.activity-overview').boundingBox(); assert.ok(previewBox.width > overviewBox.width * .85); assert.ok(previewBox.x >= 0 && previewBox.x + previewBox.width <= viewport.width); await capture('retry-preview'); await preview.getByRole('button', { name: 'Cancel retry preview', exact: true }).click();
      await page.getByRole('button', { name: 'access', exact: true }).click(); await page.getByRole('heading', { name: 'Access management', exact: true }).waitFor(); await capture('access'); await page.locator('.connection-widget>summary').click(); await capture('connection');
      metrics.push({ label, contrast: ratios, native, trigger: box, help: helpBox, preview: previewBox, documentWidth: await page.evaluate(() => document.documentElement.scrollWidth) }); assert.ok(metrics.at(-1).documentWidth <= viewport.width); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); await context.close();
      const signedOut = await scene(viewport, async ({ context, page, fixture }) => { fixture.signedIn = false; await configureTheme(context, page, preference, preference); }); await signedOut.page.screenshot({ path: resolve(evidence, `${label}-login.png`), animations: 'disabled' }); await signedOut.context.close();
    }
    await writeFile(resolve(evidence, 'visual-metrics.json'), JSON.stringify(metrics, null, 2));
  });
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
          new PerformanceObserver(list => { for (const entry of list.getEntries()) window.themePaints.push({ name: entry.name, theme: document.documentElement.dataset.theme, background: getComputedStyle(document.documentElement).backgroundColor, scheme: document.documentElement.style.colorScheme }); }).observe({ type: 'paint', buffered: true });
          document.addEventListener('securitypolicyviolation', event => window.themePolicyViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
        }, { key: THEME_KEY, preference });
        page.on('pageerror', error => errors.push(error.message)); await fixture.install(page); await page.route('**/assets/*.js', route => { held.push(route); }); await page.goto(base, { waitUntil: 'commit' });
        await page.waitForFunction(() => window.themePaints.length > 0); const paints = await page.evaluate(() => window.themePaints); assert.ok(held.length > 0); assert.equal(await page.locator('#root').innerHTML(), '');
        for (const paint of paints) { assert.equal(paint.theme, expected); assert.equal(paint.scheme, expected); assert.equal(paint.background, THEME_CANVAS_RGB[expected]); }
        for (const route of held) await route.continue(); await page.unroute('**/assets/*.js'); await page.locator('.archive-row').first().waitFor(); assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), THEME_CANVAS_RGB[expected]);
        const nextTheme = expected === 'dark' ? 'light' : 'dark'; await choose(page, nextTheme);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), THEME_CANVAS_RGB[nextTheme]);
        assert.deepEqual(await page.evaluate(() => window.themePolicyViolations), []);
        await writeFile(resolve(evidence, `prepaint-${system}-${preference ?? 'system'}.json`), JSON.stringify(paints, null, 2)); await context.close();
      }
    } finally { await new Promise((resolve, reject) => staticServer.close(error => error === undefined ? resolve() : reject(error))); }
  });
}
