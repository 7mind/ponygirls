// Behavioral-Active / Blackbox-GoodCommunication; specified account v1 contracts.
// Real Chromium, DOM, focus and cookies; controlled local HTTP/routes, no live accounts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../chronicle/web/package.json', import.meta.url));
const { chromium } = require('playwright-core');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned Chromium environment; no browser downloads.');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/account.css"><script type="module" src="/account.js"></script><title>Account fixture</title><body><button data-account-settings data-account-user-id="alice">Settings</button><form data-account-login method="post" action="/api/account/v1/login"><label>Login<input name="login" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form><button id="outside">Outside</button></body></html>`;
const server = createServer(async (request, response) => {
  if (request.url === '/' || request.url === '/fixture') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
  if (['/account.js', '/account.css'].includes(request.url)) {
    try { response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css'); response.end(await readFile(new URL(`..${request.url}`, import.meta.url))); return; }
    catch { response.statusCode = 404; response.end('Account asset not implemented'); return; }
  }
  response.statusCode = 404; response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
let cases = 0;
function fixture() {
  const user = { id: 'alice', login: 'alice', displayName: 'Alice', actor: 'actor-alice' };
  return { user, tokens: [{ id: 'configured-1', name: 'Configured collector', source: 'configured', createdAt: null, revoked: false, scopes: ['api'] }], scopes: ['api'], calls: [], issuedOwners: [], secret: 'synthetic-one-time-secret', mint: 'ok', get: 200, login: 401, held: null };
}
async function run(name, body) {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), state = fixture(), errors = [];
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/account/v1{,/**}', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const call = { path, method: request.method(), body: request.postDataJSON(), owner: state.user.id, actor: request.headers()['x-account-actor'] }; state.calls.push(call);
    const reply = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(data) });
    if (path.endsWith('/login')) return reply(state.login, state.login === 200 ? { user: state.user } : { error: { code: state.login === 401 ? 'unauthorized' : 'unavailable', message: 'sanitized' } }, state.login === 200 ? { 'Set-Cookie': 'test_session=opaque; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000' } : {});
    if (request.method() === 'GET') {
      const status = state.postMintGet === undefined || state.tokens.length < 2 ? state.get : state.postMintGet;
      const account = JSON.parse(JSON.stringify({ user: state.user, tokens: state.tokens, scopes: state.scopes }));
      if (state.switchAfterRead) { state.switchAfterRead = false; state.user = { id: 'bob', login: 'bob', displayName: 'Bob', actor: 'actor-bob' }; }
      if (state.holdPostMintRead && state.tokens.length > 1) { state.holdPostMintRead = false; await new Promise(resolve => { state.readHeld = resolve; }); }
      return reply(status, status === 200 ? account : { error: { code: status === 401 ? 'unauthorized' : 'unavailable', message: 'sanitized' } });
    }
    if (call.actor !== undefined && call.actor !== state.user.actor) return reply(409, { error: { code: 'conflict', message: 'Account changed' } });
    if (path.endsWith('/revoke')) { const token = state.tokens.find(token => token.id === path.split('/').at(-2)); assert.equal(token.source, 'issued'); token.revoked = true; return reply(200, { ok: true }); }
    if (path.endsWith('/tokens')) {
      const token = { id: `issued-${state.tokens.length}`, name: call.body.name, source: 'issued', createdAt: '2026-11-15T00:00:00Z', revoked: false, scopes: call.body.scopes };
      state.tokens.push(token); state.issuedOwners.push(state.user.id);
      if (state.mint === 'lost') return route.abort('failed');
      if (state.mint === 'malformed') return reply(200, { token });
      if (state.mint === 'held') await new Promise(resolve => { state.held = resolve; });
      return reply(200, { token, secret: state.secret });
    }
    throw new Error(`Unexpected fixture request: ${request.method()} ${path}`);
  });
  try { await page.goto(origin); await body({ page, context, state }); assert.deepEqual(errors, []); cases++; console.log(`PASS account web: ${name}`); }
  finally { await context.close(); }
}
const open = async page => { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('dialog', { name: 'Account settings', exact: true }).waitFor(); await page.getByText('Configured collector', { exact: true }).waitFor(); };
const mint = async page => { await page.getByLabel('Token name', { exact: true }).fill('Laptop collector'); await page.getByRole('button', { name: 'Create access token', exact: true }).click(); };
const mintCalls = state => state.calls.filter(call => call.path.endsWith('/tokens'));
try {
  await run('shared dialog shows read-only configured tokens, issues/copies/dismisses one-time secret and revokes', async ({ page, state }) => {
    await open(page);
    assert.match(await page.getByRole('dialog').innerText(), /server configuration.*read-only/i);
    assert.equal(await page.getByRole('button', { name: 'Revoke Configured collector', exact: true }).count(), 0);
    await mint(page); await page.getByLabel('One-time token secret', { exact: true }).waitFor();
    assert.deepEqual(mintCalls(state).map(call => call.body), [{ name: 'Laptop collector', scopes: ['api'] }]);
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).inputValue(), state.secret);
    await page.getByRole('button', { name: 'Copy secret', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Secret copied' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), state.secret);
    assert.equal(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('synthetic-one-time-secret')), false);
    await page.getByRole('button', { name: 'Dismiss secret', exact: true }).click();
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Revoke Laptop collector', exact: true }).click();
    await page.getByText('Revoked', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-account-settings]')), true);
  });
  await run('Chronicle permissions preserve Raw requires Read', async ({ page, state }) => {
    state.scopes = ['Ingest', 'Read', 'Raw']; await open(page);
    await page.getByLabel('Raw', { exact: true }).check();
    assert.equal(await page.getByLabel('Read', { exact: true }).isChecked(), true);
    await page.getByLabel('Read', { exact: true }).uncheck();
    assert.equal(await page.getByLabel('Raw', { exact: true }).isChecked(), false);
    await page.getByLabel('Raw', { exact: true }).check(); await mint(page);
    await page.getByLabel('One-time token secret', { exact: true }).waitFor();
    assert.deepEqual(new Set(mintCalls(state)[0].body.scopes), new Set(['Ingest', 'Read', 'Raw']));
  });
  await run('uncertain mint never retries and requires reconciliation plus acknowledgment before reminting', async ({ page, state }) => {
    state.mint = 'lost'; await open(page); await mint(page);
    await page.getByRole('alert').filter({ hasText: 'Creation outcome is unknown' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create access token', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'I checked the list; allow another token', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await open(page);
    assert.equal(mintCalls(state).length, 1);
    await page.getByRole('button', { name: 'Refresh token list', exact: true }).click();
    await page.getByRole('button', { name: 'I checked the list; allow another token', exact: true }).click();
    state.mint = 'ok'; await mint(page); await page.getByLabel('One-time token secret', { exact: true }).waitFor();
    assert.equal(mintCalls(state).length, 2);
  });
  await run('failed reconciliation keeps uncertain mint blocked', async ({ page, state }) => {
    state.mint = 'malformed'; await open(page); await mint(page);
    await page.getByRole('alert').filter({ hasText: 'Creation outcome is unknown' }).waitFor();
    state.get = 503; await page.getByRole('button', { name: 'Refresh token list', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'unavailable' }).last().waitFor();
    assert.equal(await page.getByRole('button', { name: 'I checked the list; allow another token', exact: true }).isDisabled(), true);
    assert.equal(mintCalls(state).length, 1);
  });
  await run('post-creation authorization failure preserves unknown creation outcome', async ({ page, state }) => {
    await open(page); state.postMintGet = 401; await mint(page);
    await page.getByRole('alert').filter({ hasText: 'Sign in again' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create access token', exact: true }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: 'Creation outcome is unknown' }).waitFor();
    assert.equal(mintCalls(state).length, 1);
  });
  await run('refocusing during held post-mint validation cannot reveal the previous account secret', async ({ page, state }) => {
    state.holdPostMintRead = true; await open(page); await mint(page);
    while (state.readHeld === undefined) await new Promise(resolve => setTimeout(resolve, 5));
    state.user = { id: 'bob', login: 'bob', displayName: 'Bob', actor: 'actor-bob' }; state.tokens = [];
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    state.readHeld(); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
  });
  await run('logout fences a late mint response and clears all secret nodes', async ({ page, state }) => {
    state.mint = 'held'; await open(page); await mint(page);
    await page.waitForFunction(() => document.querySelector('[data-account-dialog]').getAttribute('aria-busy') === 'true');
    while (state.held === null) await new Promise(resolve => setTimeout(resolve, 5));
    await page.evaluate(() => { document.dispatchEvent(new Event('account:invalidate')); document.querySelector('[data-account-settings]').dataset.accountUserId = 'bob'; });
    state.user = { id: 'bob', login: 'bob', displayName: 'Bob', actor: 'actor-bob' }; state.tokens = [];
    state.held(); await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Signed in as Bob', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Laptop collector', { exact: true }).count(), 0);
  });
  await run('refocus clears an unsaved secret with explicit lost-secret recovery', async ({ page, state }) => {
    await open(page); await mint(page); await page.getByLabel('One-time token secret', { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({ hasText: 'Creation succeeded, but its one-time secret was cleared' }).waitFor();
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Create access token', exact: true }).isDisabled(), true);
    assert.equal(mintCalls(state).length, 1);
  });
  await run('cookie switch between preflight and POST cannot issue for the wrong owner', async ({ page, state }) => {
    await open(page); state.switchAfterRead = true;
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/tokens'));
    await mint(page); await response;
    assert.deepEqual(state.issuedOwners, [], 'preflight account must bind mutation atomically; no token may be created for Bob');
    assert.equal(mintCalls(state)[0].owner, 'bob', 'fixture switches cookie owner only after the preflight snapshot');
  });
  await run('account switch before mutation fails closed without issuing', async ({ page, state }) => {
    await open(page); state.user = { id: 'bob', login: 'bob', displayName: 'Bob', actor: 'actor-bob' };
    await mint(page); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(mintCalls(state).length, 0);
  });
  await run('outages are not credential rejection and reads have an explicit retry', async ({ page, state }) => {
    state.get = 503; await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /unavailable.*not.*rejected/i }).waitFor();
    state.get = 200; await page.getByRole('button', { name: 'Retry loading settings', exact: true }).click();
    await page.getByText('Configured collector', { exact: true }).waitFor();
  });
  await run('invalid session is distinct from a service outage', async ({ page, state }) => {
    state.get = 401; await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /Sign in again/i }).waitFor();
    assert.equal(await page.getByLabel('Token name', { exact: true }).count(), 0);
  });
  await run('native dialog traps focus, supports Escape and fits a small viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 }); await open(page);
    assert.equal(await page.getByRole('dialog').evaluate(dialog => dialog.matches(':modal')), true);
    for (let index = 0; index < 12; index++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true); }
    assert.equal(await page.getByRole('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    assert.equal(await page.getByRole('dialog').evaluate(dialog => { const r = dialog.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), true);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-account-settings]')), true);
  });
  await run('login clears password and separates invalid credentials from outages', async ({ page, state, context }) => {
    const submit = async () => { await page.getByLabel('Login', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill('synthetic-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); };
    await submit(); await page.getByRole('alert').filter({ hasText: 'Invalid login or password' }).waitFor();
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
    state.login = 503; await submit(); await page.getByRole('alert').filter({ hasText: /unavailable.*not.*rejected/i }).waitFor();
    state.login = 200; const navigation = page.waitForEvent('load'); await submit(); await navigation;
    const cookie = (await context.cookies()).find(cookie => cookie.name === 'test_session');
    assert.ok(cookie && cookie.httpOnly && cookie.expires > Date.now() / 1000 + 300 * 86400);
    assert.equal(await page.evaluate(() => document.cookie.includes('test_session')), false);
    assert.equal(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('synthetic-password')), false);
    assert.deepEqual(state.calls.filter(call => call.path.endsWith('/login')).map(call => call.body), Array(3).fill({ login: 'alice', password: 'synthetic-password' }));
  });
  console.log(`PASS ${cases} shared account browser cases`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
