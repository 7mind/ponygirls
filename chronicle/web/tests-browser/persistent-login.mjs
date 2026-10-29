import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Behavioral Blackbox Good-Communication, regression + specified origins.
// Browser/HTTP cookie machinery is real; auth and renewal responses are synthetic.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use pinned browsers; no downloads.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
let cases = 0;
async function run(name, body) {
  if (process.env.CHRONICLE_LOGIN_CASE && !name.includes(process.env.CHRONICLE_LOGIN_CASE)) return;
  const context = await browser.newContext(), page = await context.newPage(), fixture = new ChronicleFixture();
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
  try { await fixture.install(page); await body({ context, page, fixture }); assert.deepEqual(errors, []); cases++; console.log(`PASS persistent login: ${name}`); }
  finally { await context.close(); }
}
try {
  await run('transient disconnect clears private content without asking for credentials', async ({ page, fixture }) => {
    await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
    fixture.mode = 'outage'; fixture.restart();
    await page.locator('.archive-row').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('heading', { name: 'Sign in', exact: true }).count(), 0, 'recoverable disconnect is not credential rejection');
    await page.getByRole('status').filter({ hasText: /Reconnecting|Session unavailable/ }).first().waitFor();
    await page.locator('.connection-widget[data-state="stopped"]').waitFor();
    fixture.mode = 'normal'; await page.getByRole('button', { name: 'Retry session', exact: true }).click();
    await page.locator('.archive-row').first().waitFor();
  });
  await run('nonterminal Whoami failure offers bounded credential-free recovery', async ({ page, fixture }) => {
    fixture.whoamiFailure = 'Synthetic identity service unavailable';
    await page.goto(`${origin}/tests-browser/harness.html`); await page.getByRole('alert').filter({ hasText: fixture.whoamiFailure }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Sign in', exact: true }).count(), 0);
    const before = fixture.calls.length; fixture.whoamiFailure = null;
    await page.getByRole('button', { name: 'Retry session', exact: true }).click();
    await page.locator('.archive-row').first().waitFor(); assert.ok(fixture.calls.length > before);
  });
  await run('initial renewal makes a persistent HttpOnly cookie and survives context restoration', async ({ context, page, fixture }) => {
    await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    assert.equal(fixture.refreshRequests.length, 1, 'an authenticated connection renews immediately');
    const request = fixture.refreshRequests[0]; assert.equal(request.method, 'POST'); assert.equal(request.body, null); assert.equal(request.headers.origin, origin);
    const cookie = (await context.cookies()).find(cookie => cookie.name === 'chronicle_session');
    assert.ok(cookie && cookie.expires > Date.now() / 1000 + 29 * 86400); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
    assert.equal(await page.evaluate(() => document.cookie.includes('chronicle_session')), false);
    const restored = await browser.newContext({ storageState: await context.storageState() });
    try { assert.deepEqual(await restored.cookies(), await context.cookies()); } finally { await restored.close(); }
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /password|token|session/i.test(key))), false);
  });
  await run('renewal HTTP 401 clears private content and really requires sign-in', async ({ page, fixture }) => {
    fixture.refreshStatus = 401;
    await page.goto(`${origin}/tests-browser/harness.html`); await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.locator('.archive-row, .original-message, .identity').count(), 0);
    assert.equal(fixture.refreshRequests.length, 1);
    assert.equal(fixture.calls.some(call => /Apply/.test(call.operation.$type)), false);
  });
  await run('renewal HTTP 500 and malformed TTL are explicit recoverable failures, not credential rejection', async ({ page, fixture }) => {
    fixture.refreshStatus = 500;
    await page.goto(`${origin}/tests-browser/harness.html`); await page.getByRole('alert').filter({ hasText: 'HTTP 500' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Sign in', exact: true }).count(), 0);
    await page.locator('.archive-row').first().waitFor();
    fixture.refreshStatus = 200; fixture.refreshTtl = 'invalid'; await page.getByRole('button', { name: 'Retry session renewal', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'invalid TTL' }).waitFor();
    fixture.refreshTtl = '2592000'; await page.getByRole('button', { name: 'Retry session renewal', exact: true }).click();
    await page.getByRole('button', { name: 'Retry session renewal', exact: true }).waitFor({ state: 'detached' });
    assert.equal(fixture.refreshRequests.length, 3);
  });
  await run('old renewal availability warning disappears on a later genuine HTTP 401', async ({ page, fixture }) => {
    fixture.refreshStatus = 500;
    await page.goto(`${origin}/tests-browser/harness.html`); await page.getByRole('alert').filter({ hasText: 'HTTP 500' }).waitFor();
    fixture.refreshStatus = 401; await page.getByRole('button', { name: 'Retry session renewal', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByText(/Your credentials have not been rejected/).count(), 0, 'old availability warning must not contradict confirmed 401');
    assert.equal(await page.getByRole('button', { name: 'Retry session renewal', exact: true }).count(), 0);
  });
  await run('unsupported dashboard shows reload guidance instead of credentials or ineffective retry', async ({ page, fixture }) => {
    fixture.mode = 'version'; await page.goto(`${origin}/tests-browser/harness.html`);
    await page.locator('.connection-widget[data-state="update-required"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reload dashboard', exact: true }).count(), 1, 'version mismatch needs actionable reload guidance');
    assert.equal(await page.getByRole('heading', { name: 'Sign in', exact: true }).count(), 0);
    fixture.mode = 'normal'; await page.getByRole('button', { name: 'Reload dashboard', exact: true }).click();
    await page.locator('.archive-row').first().waitFor();
  });
  await run('periodic renewal and focus/resume use the advertised TTL without catch-up bursts', async ({ page, fixture }) => {
    fixture.refreshTtl = '4'; await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'));
    await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
    const first = fixture.refreshRequests.length; assert.equal(first, 1);
    await page.clock.runFor(1999); assert.equal(fixture.refreshRequests.length, first);
    const renewed = page.waitForResponse(response => response.url().endsWith('/api/session/refresh'));
    await page.clock.runFor(1); await renewed; assert.equal(fixture.refreshRequests.length, 2);
    await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
    await page.clock.runFor(8000); assert.equal(fixture.refreshRequests.length, 2);
    const resumed = page.waitForResponse(response => response.url().endsWith('/api/session/refresh'));
    await page.evaluate(() => document.dispatchEvent(new Event('resume'))); await resumed;
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); assert.equal(fixture.refreshRequests.length, 3);
  });
  await run('cookie account mismatch removes old content and forces Whoami before another owner is shown', async ({ page, fixture }) => {
    let release; const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/session/refresh', async route => { await held; await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Chronicle-Session-Ttl-Seconds': '2592000' }, body: JSON.stringify(api.UserInfo_JsonCodec.instance.encode(api.BaboonCodecContext.Default, fixture.user)) }); });
    await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
    const old = await page.locator('.archive-row').first().elementHandle();
    fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read]); fixture.whoamiFailure = 'Hold new owner revalidation'; release();
    await page.getByRole('alert').filter({ hasText: fixture.whoamiFailure }).waitFor();
    assert.equal(await old.evaluate(element => element.isConnected), false);
    assert.equal(await page.locator('.archive-row, .identity').count(), 0);
    fixture.whoamiFailure = null; await page.getByRole('button', { name: 'Retry session', exact: true }).click();
    await page.locator('.identity').getByText('bob', { exact: true }).waitFor();
  });
  await run('logout cancels a pending renewal and late HTTP cannot restore private UI', async ({ page, fixture }) => {
    let request; const started = new Promise(resolve => { request = resolve; });
    await page.route('**/api/session/refresh', route => request(route));
    await page.goto(`${origin}/tests-browser/harness.html`); const route = await started;
    await page.locator('.archive-row').first().waitFor();
    const cancelled = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/session/refresh'));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await cancelled;
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await route.fulfill({ status: 401, body: '{}' });
    assert.equal(await page.locator('.archive-row, .identity').count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Logout).length, 1);
  });
  await run('real persistent browser restart retains renewed HttpOnly cookie but not a session-only cookie', async () => {
    await mkdir(resolve(root, 'test-results'), { recursive: true });
    const profile = await mkdtemp(resolve(root, 'test-results/persistent-login-'));
    let persistent;
    try {
      persistent = await chromium.launchPersistentContext(profile, { headless: true });
      let page = await persistent.newPage(), fixture = new ChronicleFixture(); fixture.signedIn = false;
      await fixture.install(page); await page.goto(`${origin}/tests-browser/harness.html`);
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
      await page.getByLabel('Login', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in →', exact: true }).click(); await page.locator('.archive-row').first().waitFor();
      await persistent.addCookies([{ name: 'session_only_control', value: 'synthetic', url: origin }]);
      const cookie = (await persistent.cookies()).find(cookie => cookie.name === 'chronicle_session'); assert.ok(cookie && cookie.expires > 0 && cookie.httpOnly);
      await persistent.close(); persistent = await chromium.launchPersistentContext(profile, { headless: true });
      const restored = await persistent.cookies(); assert.deepEqual(restored.find(cookie => cookie.name === 'chronicle_session'), cookie); assert.equal(restored.some(cookie => cookie.name === 'session_only_control'), false);
      page = await persistent.newPage(); fixture = new ChronicleFixture(); await fixture.install(page);
      await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
      assert.match(fixture.refreshRequests[0].headers.cookie, /chronicle_session=synthetic/);
    } finally { await persistent?.close(); await rm(profile, { recursive: true, force: true }); }
  });
  assert.ok(cases > 0, 'No persistent-login browser cases selected');
  console.log(`PASS ${cases} persistent-login browser cases (synthetic auth server)`);
} finally { await browser.close(); await server.close(); }
