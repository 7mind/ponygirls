// Lean behavioural checks of the shared account views on the controlled-route harness (dev/index.html):
// real Chromium, DOM, focus and clipboard; the account HTTP plane is the in-page fake of dev/fake-server.js.
// Run: nix develop .#chronicle --command node shared/account-web/tests/browser.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { startDevServer } from '../dev/serve.mjs';
import { FAKE_PASSWORD, FAKE_TOKEN_SECRET, FAKE_WRONG_CODE } from '../dev/fake-server.js';

const require = createRequire(new URL('../../../chronicle/web/package.json', import.meta.url));
const { chromium } = require('playwright-core');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned Chromium environment (nix develop .#chronicle); no browser downloads.');

const STEP_TIMEOUT_MS = 5000;
const MASTHEAD_PX = 48, VIEWBAR_PX = 56;
const HOLD_PREFIX = 'A request on this page is still running';
const server = await startDevServer({ port: 0 });
const browser = await chromium.launch({ headless: true });
let cases = 0;

// Every case gets a fresh context; `calls` survives reloads through an exposed binding.
async function run(name, body) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), calls = [], errors = [];
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', native => { errors.push(`native ${native.type()} dialog: ${native.message()}`); void native.dismiss(); });
  await page.exposeFunction('__accountCall', call => { calls.push(call); });
  const open = async (scenario, extra = '') => {
    await page.goto(`${server.origin}/?scenario=${scenario}&steps=0${extra}`);
    await page.waitForFunction(() => document.documentElement.dataset.harnessReady === 'true');
  };
  try { await body({ page, calls, open, errors }); assert.deepEqual(errors, []); cases++; console.log(`PASS account views: ${name}`); }
  finally { await context.close(); }
}
const storageText = page => page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
const callsTo = (calls, path) => calls.filter(call => call.path === path);
const posts = (calls, path) => callsTo(calls, path).filter(call => call.method === 'POST').length;
const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function mint(page, name) {
  await button(page, 'New token').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await button(page, 'Create token').click();
}

try {
  await run('login asks for the second factor and keeps the credentials in memory only', async ({ page, calls, open }) => {
    await open('login-totp');
    await page.getByLabel('Username', { exact: true }).fill('alice');
    await page.getByLabel('Password', { exact: true }).fill(FAKE_PASSWORD);
    await button(page, 'Sign in').click();
    await page.getByText('Signing in as').waitFor();
    assert.equal(await page.locator('form[data-account-login]').isHidden(), true);
    assert.equal(await page.locator('form[data-account-login] input[name="password"]').inputValue(), '', 'the password field is cleared on submit');
    await page.getByLabel('6-digit code', { exact: true }).fill(FAKE_WRONG_CODE);
    await button(page, 'Verify and sign in').click();
    await page.getByText('That code did not match').waitFor();
    await page.getByLabel('6-digit code', { exact: true }).fill('123456');
    const reloaded = page.waitForEvent('load');
    await button(page, 'Verify and sign in').click();
    await reloaded;
    assert.deepEqual(callsTo(calls, '/login').map(call => call.body), [
      { login: 'alice', password: FAKE_PASSWORD }, { login: 'alice', password: FAKE_PASSWORD, totp: FAKE_WRONG_CODE }, { login: 'alice', password: FAKE_PASSWORD, totp: '123456' }]);
    assert.equal((await storageText(page)).includes(FAKE_PASSWORD), false);
  });

  await run('signup shows QR and manual key and ends in pending approval without storing a secret', async ({ page, calls, open }) => {
    await open('signup-default');
    const qr = page.getByRole('img', { name: 'QR code with the authenticator set-up key' });
    assert.ok(await qr.locator('i').count() > 21 * 21, 'the QR is rendered as DOM cells');
    const key = (await page.getByLabel('Authenticator set-up key', { exact: true }).innerText()).replace(/\s/g, '');
    assert.match(key, /^[A-Z2-7]{32}$/);
    assert.equal(await page.getByRole('checkbox', { name: /Also require a code at every sign-in/ }).isChecked(), false, 'the switch is off by default');
    await page.getByLabel('Username', { exact: true }).fill('bob');
    await page.getByLabel('E-mail', { exact: true }).fill('bob@example.org');
    await page.getByLabel('Password', { exact: true }).fill('hunter2hunter2');
    await page.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill('731905');
    await button(page, 'Create account').click();
    await page.getByRole('heading', { name: 'Account created — waiting for approval' }).waitFor();
    assert.deepEqual(callsTo(calls, '/signup').map(call => call.body), [{ username: 'bob', email: 'bob@example.org', password: 'hunter2hunter2', totpSecret: key, totpCode: '731905', requireTotp: false }]);
    const stored = await storageText(page);
    assert.equal(stored.includes(key) || stored.includes('hunter2hunter2'), false);
  });

  await run('enrollment code is consumed from the fragment and removed from the URL', async ({ page, calls }) => {
    await page.goto(`${server.origin}/?scenario=signup-enroll&steps=0#account-enroll=Zk3vQ9hT2mXa7LrN5pWcB8sDyE1uG4jH6oKtVfIqRzM`);
    await page.getByRole('heading', { name: 'Finish setting up your account' }).waitFor();
    assert.equal(await page.evaluate(() => location.href.includes('account-enroll')), false);
    assert.deepEqual(callsTo(calls, '/enrollments/inspect').map(call => call.body), [{ code: 'Zk3vQ9hT2mXa7LrN5pWcB8sDyE1uG4jH6oKtVfIqRzM' }]);
    assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'carol');
    assert.equal(await page.getByLabel('Username', { exact: true }).getAttribute('readonly'), '');
  });

  await run('token secret survives blur/focus, Escape, section change and Back until it is acknowledged', async ({ page, calls }) => {
    await page.goto(`${server.origin}/?scenario=settings-tokens&steps=0#/archive`);
    await page.getByRole('heading', { name: 'Host view' }).waitFor();
    await page.locator('[data-account-settings]').click();
    await page.getByRole('heading', { name: 'Profile' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Host view' }).isHidden(), true, 'the account page covers the host main');
    await page.getByRole('link', { name: /^Access tokens/ }).click();
    await page.locator('table[data-list="tokens"] tr[data-row-id]').first().waitFor();
    await button(page, 'New token').click();
    const formTop = await page.locator('[data-account-token-form]').evaluate(node => node.getBoundingClientRect().top);
    await page.getByLabel('Name', { exact: true }).fill('laptop-cli');
    await button(page, 'Create token').click();
    const secret = page.getByLabel('One-time token secret', { exact: true });
    await secret.waitFor();
    assert.equal(await page.locator('[data-account-secret]').evaluate(node => node.getBoundingClientRect().top), formTop, 'the secret panel takes the place of the form');
    assert.equal(await secret.inputValue() === FAKE_TOKEN_SECRET, false, 'masked by default');
    assert.equal(await button(page, 'I have saved it').isDisabled(), true);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Profile' }).click();
    await dialog(page, 'Hide the secret for good?').waitFor();
    await button(page, 'Keep it visible').click();
    await page.evaluate(() => history.back());
    await dialog(page, 'Hide the secret for good?').waitFor();
    await button(page, 'Keep it visible').click();
    assert.equal(await page.evaluate(() => location.hash), '#account/tokens');
    await button(page, 'Reveal').click();
    assert.equal(await secret.inputValue(), FAKE_TOKEN_SECRET, 'the same secret is still there');
    await button(page, 'I have saved it').click();
    await button(page, 'Yes, I have saved it').click();
    await page.locator('[data-account-secret]').waitFor({ state: 'detached' });
    await page.evaluate(() => history.back());
    await page.getByRole('heading', { name: 'Host view' }).waitFor();
    assert.equal(callsTo(calls, '/tokens').length, 1);
    assert.equal((await storageText(page)).includes(FAKE_TOKEN_SECRET), false);
  });

  // Section ownership (README "Section ownership"): for every flow that shows a one-time value or asks for a
  // proof, (a) leaving with the prompt open discards it, (b) leaving while its request is in flight is held and every
  // control that would re-open, re-submit or discard it is disabled, (c) so is a fragment change plus a DOM mutation
  // in one task; the result then appears in the active view, after exactly one request per attempt.
  const link = async page => { await button(page, 'Copy link').click(); await button(page, 'I have sent it').click(); await button(page, 'Yes, I have sent it').click(); };
  const post = path => call => call.method === 'POST' && call.path === path;
  const named = (page, name) => page.getByRole('button', { name, exact: true });
  const FLOWS = [
    { flow: 'token mint', view: 'tokens', scenario: 'settings-tokens', hash: '#account/tokens', away: '#account/profile', hold: 'POST /tokens', isSubmit: post('/tokens'), ready: 'table[data-list="tokens"] tr[data-row-id]', prompt: '[data-account-token-form]', keeps: false,
      open: async page => { await button(page, 'New token').click(); await page.getByLabel('Name', { exact: true }).fill('laptop-cli'); },
      submit: 'Create token', blocked: ['New token', 'Create token', 'Cancel'], result: page => page.locator('[data-account-secret]'),
      acknowledge: async page => { await button(page, 'Reveal').click(); await button(page, 'I have saved it').click(); await button(page, 'Yes, I have saved it').click(); } },
    { flow: 'invitation', view: 'users', scenario: 'users-default', hash: '#account/users', away: '#account/profile', hold: 'POST /admin/enrollments', isSubmit: post('/admin/enrollments'), ready: 'tr[data-row-id="erin"]', prompt: '[data-account-enroll-form]', keeps: false,
      open: async page => { await button(page, 'Enroll user').click(); await page.getByLabel('Username', { exact: true }).fill('zoe'); },
      submit: 'Create invitation link', blocked: ['Enroll user', 'Create invitation link', 'Cancel', 'Actions for erin'], result: page => page.locator('[data-account-link]'), acknowledge: link },
    { flow: 'credential reset', view: 'users', scenario: 'users-default', hash: '#account/users', away: '#account/profile', hold: 'POST /admin/users/erin/reset', isSubmit: post('/admin/users/erin/reset'), ready: 'tr[data-row-id="erin"]', prompt: 'dialog[open]', keeps: false,
      open: async page => { await button(page, 'Actions for erin').click(); await page.getByRole('menuitem', { name: 'Reset credentials…' }).click(); await page.getByLabel('Your current password').fill(FAKE_PASSWORD); },
      submit: 'Create reset link', blocked: ['Create reset link', 'Cancel', 'Actions for erin', 'Enroll user'], result: page => page.locator('[data-account-link]'), acknowledge: link },
    { flow: 'admin flag with password proof', view: 'users', scenario: 'users-default', hash: '#account/users', away: '#account/profile', hold: 'POST /admin/users/erin/admin', isSubmit: post('/admin/users/erin/admin'), ready: 'tr[data-row-id="erin"]', prompt: 'dialog[open]', keeps: false,
      open: async page => { await button(page, 'Actions for erin').click(); await page.getByRole('menuitem', { name: 'Grant admin…' }).click(); await page.getByLabel('Your current password').fill(FAKE_PASSWORD); },
      submit: 'Grant admin', blocked: ['Grant admin', 'Cancel', 'Actions for mallory'], result: page => page.getByText('erin is now an administrator'), acknowledge: null },
    // Same-section repeated replacement: re-opening the card or toggling while the replacement is pending is impossible.
    { flow: 'authenticator replacement', view: 'two-factor', scenario: 'settings-totp', hash: '#account/two-factor', away: '#account/tokens', hold: 'POST /profile/totp', isSubmit: post('/profile/totp'), ready: '[data-view="two-factor"]', prompt: '[data-account-totp-replace]', keeps: false,
      open: async page => { await button(page, 'Replace authenticator…').click(); await page.getByLabel('Current password', { exact: true }).fill(FAKE_PASSWORD); await page.getByLabel('Code from the new entry', { exact: true }).fill('123456'); },
      submit: 'Replace authenticator', blocked: ['Replace authenticator…', 'Replace authenticator', 'Cancel', 'Require a code at every sign-in'], result: page => page.getByText('Authenticator replaced'), acknowledge: null },
    { flow: 'signup with generated secret', view: 'signup-pending', scenario: 'signup-default', hash: '#account/signup', away: '', hold: 'POST /signup', isSubmit: post('/signup'), ready: '[data-view="signup"]', prompt: '[data-view="signup"]', keeps: false,
      open: async page => { await page.getByLabel('Username', { exact: true }).fill('bob'); await page.getByLabel('E-mail', { exact: true }).fill('bob@example.org'); await page.getByLabel('Password', { exact: true }).fill('hunter2hunter2'); await page.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill('731905'); },
      submit: 'Create account', blocked: ['Create account'], result: page => page.getByRole('heading', { name: 'Account created — waiting for approval' }), acknowledge: null },
    // The landing keeps its single-use code until "Go to sign-in", so leaving with the form open keeps the form.
    { flow: 'enrollment redemption', view: 'enrollment', scenario: 'signup-enroll', hash: '', away: '#account/signup', hold: 'POST /enrollments/redeem', isSubmit: post('/enrollments/redeem'), ready: '[data-view="enrollment"]', prompt: '[data-view="enrollment"]', keeps: true,
      open: async page => { await page.getByLabel('E-mail', { exact: true }).fill('carol@example.org'); await page.getByLabel('Password', { exact: true }).fill('hunter2hunter2'); await page.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill(FAKE_WRONG_CODE); },
      submit: 'Create account and sign in', blocked: ['Create account and sign in'], result: page => page.getByText('That code does not match this key'), acknowledge: null },
    { flow: 'recovery', view: 'recover', scenario: 'recover-rejected', hash: '#account/recover', away: '', hold: 'POST /recover', isSubmit: post('/recover'), ready: '[data-view="recover"]', prompt: '[data-view="recover"]', keeps: false,
      open: async page => { await page.getByLabel('Username', { exact: true }).fill('alice'); await page.getByLabel('Authenticator code', { exact: true }).fill('204817'); await page.getByLabel('New password', { exact: true }).fill('a-new-long-password'); },
      submit: 'Set new password and sign in', blocked: ['Set new password and sign in'], result: page => page.getByText('Recovery was not accepted'), acknowledge: null },
    { flow: 'login second step', view: 'login-totp', scenario: 'login-totp', hash: '', away: '#account/signup', hold: 'POST /login', isSubmit: call => call.method === 'POST' && call.path === '/login' && call.body.totp !== undefined, ready: 'form[data-account-login]', prompt: '[data-account-login-totp]', keeps: false,
      open: async page => { await page.getByLabel('Username', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill(FAKE_PASSWORD); await button(page, 'Sign in').click(); await page.getByLabel('6-digit code', { exact: true }).fill(FAKE_WRONG_CODE); },
      submit: 'Verify and sign in', blocked: ['Verify and sign in', 'Use a different account'], result: page => page.getByText('That code did not match'), acknowledge: null }
  ];
  const submits = (calls, row) => calls.filter(row.isSubmit).length;
  const leaveTo = (page, target, mutate) => page.evaluate(([hash, withMutation]) => { location.hash = hash; if (withMutation) document.body.append(document.createElement('span')); }, [target, mutate]);
  async function load(page, row) {
    await page.goto(`${server.origin}/?scenario=${row.scenario}&steps=0`);
    await page.waitForFunction(() => document.documentElement.dataset.harnessReady === 'true');
    await page.locator(row.ready).first().waitFor();
  }
  async function submitHeld(page, row, calls) {
    await row.open(page);
    await page.evaluate(hold => { window.__accountFake.state.hold = hold; }, row.hold);
    const before = submits(calls, row);
    await button(page, row.submit).click();
    await page.waitForFunction(() => window.__accountFake.state.pending.length > 0);
    const prompts = await page.locator(row.prompt).count();
    for (const name of row.blocked) {
      const control = named(page, name).or(page.getByRole('checkbox', { name: new RegExp(`^${name}`) })).first();
      assert.equal(await control.isDisabled(), true, `${row.flow}: “${name}” is disabled while the request is pending`);
      await control.evaluate(node => node.click());
    }
    assert.equal(await page.locator(row.prompt).count(), prompts, `${row.flow}: the submitted prompt is neither replaced nor discarded`);
    assert.equal(submits(calls, row), before + 1, `${row.flow}: exactly one request`);
  }
  async function heldThenShown(page, row, mutate) {
    const toasts = await page.getByText(HOLD_PREFIX).count();
    await leaveTo(page, row.away, mutate);
    await page.waitForFunction(count => [...document.querySelectorAll('.toast')].filter(node => node.textContent.startsWith('A request on this page is still running')).length > count, toasts);
    assert.equal(await page.evaluate(() => location.hash), row.hash, `${row.flow}: the fragment is put back`);
    await page.evaluate(() => window.__accountFake.state.release());
    await row.result(page).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => location.hash), row.hash, `${row.flow}: the result is shown in its own view`);
    assert.equal(await page.locator(`[data-view="${row.view}"]`).isVisible(), true, `${row.flow}: its view is the visible one`);
    if (row.acknowledge !== null) await row.acknowledge(page);
  }
  await run('section ownership: prompts are discarded on leaving, pending requests hold navigation and block re-entry, results land in the active view', async ({ page, calls }) => {
    for (const row of FLOWS) {
      await load(page, row);
      await row.open(page);
      await leaveTo(page, row.away, false);
      if (!row.keeps) await page.locator(row.prompt).first().waitFor({ state: 'detached' });
      await leaveTo(page, row.hash, false);
      await page.locator(row.ready).first().waitFor();
      assert.equal(await page.locator(row.prompt).count(), row.prompt.startsWith('[data-view') ? 1 : 0, `${row.flow}: (a) the prompt was discarded`);
      assert.equal(submits(calls, row), 0, `${row.flow}: (a) nothing was submitted`);
      if (row.keeps) await load(page, row);
      await submitHeld(page, row, calls);
      await heldThenShown(page, row, false);
      await load(page, row);
      await submitHeld(page, row, calls);
      await heldThenShown(page, row, true);
      assert.equal(submits(calls, row), 2, `${row.flow}: one request per attempt`);
      calls.length = 0;
    }
  });

  // A frame-bounded settle for work that follows an already-delivered fake response (no fixed time).
  const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await run('account:invalidate re-reads authority: same owner keeps the secret, a lost owner tears down with a notice', async ({ page, calls }) => {
    await load(page, FLOWS[0]);
    await FLOWS[0].open(page); await button(page, 'Create token').click();
    await page.locator('[data-account-secret]').waitFor();
    const reads = () => calls.filter(call => call.method === 'GET' && call.path === '').length;
    const before = reads();
    await page.evaluate(() => { window.__accountFake.state.hold = 'GET '; document.dispatchEvent(new Event('account:invalidate')); });
    await page.waitForFunction(() => window.__accountFake.state.pending.length > 0);
    assert.equal(reads(), before + 1, 'authority is re-read before anything else happens');
    assert.equal(await page.locator('[data-account-secret]').isVisible(), true, 'nothing is torn down while the read is in flight');
    await page.evaluate(() => window.__accountFake.state.release());
    await settle(page);
    assert.equal(await page.locator('[data-account-secret]').isVisible(), true, 'the same owner keeps the secret');
    await page.evaluate(() => { window.__accountFake.state.user = { id: 'bob', login: 'bob', displayName: 'bob', actor: 'actor-bob' }; document.dispatchEvent(new Event('account:invalidate')); });
    await page.getByText('The secret of token “laptop-cli” is no longer available').waitFor();
    assert.equal(await page.locator('[data-account-secret]').count(), 0);
    await load(page, FLOWS[1]);
    await FLOWS[1].open(page); await button(page, 'Create invitation link').click();
    await page.locator('[data-account-link]').waitFor();
    await page.evaluate(() => { window.__accountFake.state.signedIn = false; document.dispatchEvent(new Event('account:invalidate')); });
    await page.getByText('The invitation link for “zoe” is no longer available').waitFor();
    await page.getByText('You were signed out').waitFor();
  });

  await run('sign-out passes the guard; row-menu listeners are released by section teardown', async ({ page, calls }) => {
    await page.addInitScript(() => {
      const live = new Set(), add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
      const tracked = (target, type, options) => target === document && type === 'click' && (options === true || (typeof options === 'object' && options !== null && options.capture === true));
      EventTarget.prototype.addEventListener = function (type, listener, options) { if (tracked(this, type, options)) live.add(listener); return add.call(this, type, listener, options); };
      EventTarget.prototype.removeEventListener = function (type, listener, options) { if (tracked(this, type, options)) live.delete(listener); return remove.call(this, type, listener, options); };
      window.__captureClicks = () => live.size;
    });
    const captures = () => page.evaluate(() => window.__captureClicks());
    await load(page, FLOWS[1]);
    await button(page, 'Actions for erin').click();
    assert.equal(await captures(), 1);
    await leaveTo(page, '#account/profile', true);
    await page.getByRole('heading', { name: 'Profile' }).waitFor();
    assert.equal(await captures(), 0, 'leaving the section closes the open menu');
    await leaveTo(page, '#account/users', false);
    await button(page, 'Actions for erin').click();
    await page.evaluate(() => { window.__accountFake.state.user = { id: 'bob', login: 'bob', displayName: 'bob', actor: 'actor-bob' }; document.dispatchEvent(new Event('account:invalidate')); });
    await page.getByText('The signed-in account changed').waitFor();
    assert.equal(await captures(), 0, 'a forced teardown closes the open menu');
    await page.mouse.click(5, 5);
    await load(page, FLOWS[0]);
    await FLOWS[0].open(page); await button(page, 'Create token').click();
    await page.locator('[data-account-secret]').waitFor();
    await page.evaluate(() => document.addEventListener('account:changed', () => { window.__changed = true; }));
    await button(page, 'Sign out').click();
    await dialog(page, 'Hide the secret for good?').waitFor();
    await button(page, 'Keep it visible').click();
    assert.equal(calls.filter(post('/logout')).length, 0);
    await button(page, 'Sign out').click();
    await button(page, 'Yes, I have saved it').click();
    await page.getByText('Sign in again to continue.').waitFor();
    assert.deepEqual(calls.filter(post('/logout')).map(call => call.actor), ['actor-alice']);
    assert.equal(await page.evaluate(() => window.__changed), true);
  });

  // Interleavings of the sequencer (README "Interleavings"): each row starts two asynchronous flows against
  // deferred responses and checks the outcome the table states.
  const mintShown = async page => { await FLOWS[0].open(page); await button(page, 'Create token').click(); await page.locator('[data-account-secret]').waitFor(); };
  const hold = (page, key) => page.evaluate(value => { window.__accountFake.state.hold = value; }, key);
  const pendingCount = (page, count) => page.waitForFunction(n => window.__accountFake.state.pending.length === n, count);
  const invalidate = (page, detail) => page.evaluate(value => document.dispatchEvent(value === null ? new Event('account:invalidate') : new CustomEvent('account:invalidate', { detail: value })), detail);
  const secretValue = page => page.getByLabel('One-time token secret', { exact: true });
  const tokenPosts = calls => calls.filter(post('/tokens')).length, logoutPosts = calls => calls.filter(post('/logout')).length;
  const holdToast = async page => { await page.getByText(HOLD_PREFIX).first().waitFor(); };
  const PAIRS = [
    { pair: 'sign-out held × mint attempt and navigation', run: async (page, calls) => {
      await hold(page, 'GET ');
      await button(page, 'Sign out').click();
      await pendingCount(page, 1);
      assert.equal(await button(page, 'New token').isDisabled(), true);
      await button(page, 'New token').evaluate(node => node.click());
      await leaveTo(page, '#account/profile', true);
      await holdToast(page);
      assert.equal(await page.evaluate(() => location.hash), '#account/tokens');
      await page.evaluate(() => window.__accountFake.state.release());
      await page.getByText('Sign in again to continue.').waitFor();
      assert.deepEqual([tokenPosts(calls), logoutPosts(calls)], [0, 1]);
    } },
    { pair: 'mint held × sign-out attempt', run: async (page, calls) => {
      await FLOWS[0].open(page); await hold(page, 'POST /tokens'); await button(page, 'Create token').click();
      await pendingCount(page, 1);
      await button(page, 'Sign out').click();
      await holdToast(page);
      await page.evaluate(() => window.__accountFake.state.release());
      await page.locator('[data-account-secret]').waitFor();
      assert.deepEqual([tokenPosts(calls), logoutPosts(calls)], [1, 0]);
    } },
    { pair: 'mint held × invalidate (same owner)', run: async (page, calls) => {
      await FLOWS[0].open(page); await hold(page, 'POST /tokens'); await button(page, 'Create token').click();
      await pendingCount(page, 1);
      await invalidate(page, null);
      await page.evaluate(() => window.__accountFake.state.release());
      await page.locator('[data-account-secret]').waitFor();
      assert.equal(await button(page, 'Reveal').isDisabled(), false);
      assert.equal(tokenPosts(calls), 1);
    } },
    { pair: 'sign-out × sign-out (double click)', run: async (page, calls) => {
      await hold(page, 'POST /logout');
      await button(page, 'Sign out').click();
      await pendingCount(page, 1);
      await button(page, 'Sign out').click();
      await holdToast(page);
      await page.evaluate(() => window.__accountFake.state.release());
      await page.getByText('Sign in again to continue.').waitFor();
      assert.equal(logoutPosts(calls), 1);
    } },
    { pair: 'invalidate × invalidate: a stale 401 after a newer success is discarded', run: async page => {
      await mintShown(page);
      await hold(page, 'GET ');
      await invalidate(page, null); await pendingCount(page, 1);
      await invalidate(page, null); await pendingCount(page, 2);
      await page.evaluate(() => window.__accountFake.state.releaseAt(1));
      await settle(page);
      await page.evaluate(() => { window.__accountFake.state.signedIn = false; window.__accountFake.state.release(); });
      await settle(page);
      assert.equal(await secretValue(page).isVisible(), true, 'the older 401 does not tear down');
      assert.equal(await page.getByText('You were signed out').count(), 0);
      assert.equal(await button(page, 'Reveal').isDisabled(), false);
    } },
    { pair: 'invalidate × invalidate: a stale success after a newer 401 cannot revive the area', run: async page => {
      await mintShown(page);
      await hold(page, 'GET ');
      await invalidate(page, null); await pendingCount(page, 1);
      await page.evaluate(() => { window.__accountFake.state.signedIn = false; });
      await invalidate(page, null); await pendingCount(page, 2);
      await page.evaluate(() => window.__accountFake.state.releaseAt(1));
      await page.getByText('The secret of token “laptop-cli” is no longer available').waitFor();
      await page.evaluate(() => { window.__accountFake.state.signedIn = true; window.__accountFake.state.release(); });
      await settle(page);
      assert.equal(await page.locator('[data-account-secret]').count(), 0);
      assert.equal(await page.getByText('You were signed out').isVisible(), true);
    } },
    { pair: 'invalidate × transport failure: values masked, Reveal/Copy/writes disabled until reconnect', run: async page => {
      await mintShown(page);
      await button(page, 'Reveal').click();
      assert.equal(await secretValue(page).inputValue(), FAKE_TOKEN_SECRET);
      await page.evaluate(() => { window.__accountFake.state.account = 'down'; });
      await invalidate(page, null);
      await page.locator('[data-account-unverified]').waitFor();
      assert.notEqual(await secretValue(page).inputValue(), FAKE_TOKEN_SECRET, 're-masked');
      for (const name of ['Reveal', 'Copy secret', 'New token']) assert.equal(await button(page, name).isDisabled(), true, `${name} disabled`);
      await page.evaluate(() => { window.__accountFake.state.account = 'ok'; window.dispatchEvent(new Event('online')); });
      await page.locator('[data-account-unverified]').waitFor({ state: 'detached' });
      await button(page, 'Reveal').click();
      assert.equal(await secretValue(page).inputValue(), FAKE_TOKEN_SECRET, 'the value was kept');
    } },
    { pair: "invalidate with reason 'signed-out': scrubbed at once, no read", run: async (page, calls) => {
      await mintShown(page);
      const reads = calls.filter(call => call.method === 'GET' && call.path === '').length;
      await invalidate(page, { reason: 'signed-out' });
      assert.equal(await page.locator('[data-account-secret]').count(), 0);
      await page.getByText('The secret of token “laptop-cli” is no longer available').waitFor();
      assert.equal(calls.filter(call => call.method === 'GET' && call.path === '').length, reads);
    } },
    { pair: 'sign-out held × owner replaced: no /logout for the new owner', run: async (page, calls) => {
      await hold(page, 'GET ');
      await button(page, 'Sign out').click();
      await pendingCount(page, 1);
      await page.evaluate(() => { const state = window.__accountFake.state; state.user = { id: 'bob', login: 'bob', displayName: 'bob', actor: 'actor-bob' }; state.release(); });
      await page.getByText('The signed-in account changed').waitFor();
      assert.equal(logoutPosts(calls), 0);
    } },
    { pair: 'background profile reload × authenticator replacement: the submitted form survives', scenario: 'settings-totp', ready: '[data-view="two-factor"]', run: async (page, calls) => {
      await page.getByRole('checkbox', { name: /^Require a code at every sign-in/ }).click();
      await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
      await hold(page, 'GET /profile');
      await button(page, 'Require codes').click();
      await pendingCount(page, 1);
      // The toggle's own owner check is released; its success starts the background reload, which is held.
      await page.evaluate(() => { const state = window.__accountFake.state; state.release(); state.hold = 'GET /profile'; });
      await page.locator('dialog[open]').waitFor({ state: 'detached' });
      await pendingCount(page, 1);
      await FLOWS[4].open(page);
      const key = await page.getByLabel('Authenticator set-up key', { exact: true }).innerText();
      await button(page, 'Replace authenticator').click();
      await pendingCount(page, 2);
      await page.evaluate(() => window.__accountFake.state.releaseAt(0));
      await settle(page);
      assert.equal(await page.locator('[data-account-totp-replace]').count(), 1, 'the reload does not rebuild the section under the write');
      assert.equal(await page.getByLabel('Authenticator set-up key', { exact: true }).innerText(), key, 'the generated key is unchanged');
      await page.evaluate(() => window.__accountFake.state.release());
      await page.getByText('Authenticator replaced').waitFor();
      assert.equal(calls.filter(post('/profile/totp')).length, 1);
    } },
    { pair: 'revoke preflight transport failure × shown secret: unverified, then recovered', run: async page => {
      await mintShown(page);
      await page.evaluate(() => { window.__accountFake.state.account = 'down'; });
      await button(page, 'Revoke ci-collector-02').click();
      await button(page, 'Revoke token').click();
      await page.locator('[data-account-unverified]').waitFor();
      for (const name of ['Reveal', 'Copy secret']) assert.equal(await button(page, name).isDisabled(), true, `${name} disabled`);
      assert.notEqual(await secretValue(page).inputValue(), FAKE_TOKEN_SECRET);
      await button(page, 'Cancel').click();
      await page.evaluate(() => { window.__accountFake.state.account = 'ok'; window.dispatchEvent(new Event('online')); });
      await page.locator('[data-account-unverified]').waitFor({ state: 'detached' });
      assert.equal(await button(page, 'Reveal').isDisabled(), false);
    } },
    { pair: 'unverified × authenticator replacement: key and QR hidden, Copy key disabled', scenario: 'settings-totp', ready: '[data-view="two-factor"]', run: async page => {
      await FLOWS[4].open(page);
      assert.equal(await page.locator('[data-account-qr]').isVisible(), true);
      await page.evaluate(() => { window.__accountFake.state.account = 'down'; });
      await invalidate(page, null);
      await page.locator('[data-account-unverified]').waitFor();
      assert.equal(await page.locator('[data-account-qr]').isHidden(), true);
      assert.equal(await page.locator('[data-account-totp-key]').isHidden(), true);
      assert.equal(await button(page, 'Copy key').isDisabled(), true);
      assert.equal(await button(page, 'Replace authenticator').isDisabled(), true);
    } },
    { pair: 'admin refresh × admin refresh: the newest list wins', scenario: 'users-default', ready: 'tr[data-row-id="erin"]', run: async page => {
      await page.evaluate(() => { const state = window.__accountFake.state; state.snapshot = true; state.hold = 'GET /admin/users'; });
      for (const name of ['bob', 'frank']) {
        await button(page, `Approve ${name}…`).click();
        await dialog(page, `Application of “${name}”`).getByRole('button', { name: 'Approve' }).click();
        await page.locator('dialog[open]').waitFor({ state: 'detached' });
      }
      await pendingCount(page, 2);
      await page.evaluate(() => window.__accountFake.state.releaseAt(1));
      await page.locator('tr[data-row-id="frank"]', { hasText: 'Active' }).waitFor();
      await page.evaluate(() => window.__accountFake.state.release());
      await settle(page);
      assert.equal(await page.locator('tr[data-row-id="frank"]', { hasText: 'Pending approval' }).count(), 0, 'the older snapshot does not roll the list back');
    } },
    { pair: 'failed sign-out × shown secret: nothing changes', run: async (page, calls) => {
      await page.evaluate(() => { window.__accountFake.state.logout = 'fail'; });
      await mintShown(page);
      await button(page, 'Reveal').click();
      await button(page, 'Sign out').click();
      await button(page, 'Yes, I have saved it').click();
      await dialog(page, 'Hide the secret for good?').getByText('Sign-out failed').waitFor();
      await button(page, 'Keep it visible').click();
      assert.equal(await secretValue(page).inputValue(), FAKE_TOKEN_SECRET);
      assert.equal(logoutPosts(calls), 1);
    } }
  ];
  // Each row gets its own page: a row may end with a one-time value shown, whose beforeunload guard would hold a reload.
  await run('sequencer interleavings: one write-or-sign-out slot, newest authority read decides', async ({ page, calls, errors }) => {
    for (const row of PAIRS) {
      const rowPage = await page.context().newPage();
      rowPage.setDefaultTimeout(STEP_TIMEOUT_MS);
      rowPage.on('pageerror', error => errors.push(error.message));
      rowPage.on('dialog', native => { errors.push(`native ${native.type()} dialog`); void native.dismiss(); });
      await rowPage.exposeFunction('__accountCall', call => { calls.push(call); });
      await load(rowPage, row.scenario === undefined ? FLOWS[0] : { scenario: row.scenario, ready: row.ready });
      try { await row.run(rowPage, calls); } catch (cause) { cause.message = `${row.pair}: ${cause.message}`; throw cause; }
      await rowPage.close({ runBeforeUnload: false });
      calls.length = 0;
    }
  });

  await run('a one-time value arriving for an inactive section is reported and shown in its own section', async ({ page, errors, calls }) => {
    await page.goto(`${server.origin}/?scenario=settings-tokens&steps=0`);
    await page.locator('table[data-list="tokens"] tr[data-row-id]').first().waitFor();
    await submitHeld(page, FLOWS[0], calls);
    // Fault injection: blind the guard so that the section changes under the in-flight request.
    await page.evaluate(() => { Object.defineProperty(document.querySelector('[data-account-outlet]'), 'isConnected', { configurable: true, get: () => false }); location.hash = '#account/profile'; });
    await page.getByRole('heading', { name: 'Profile' }).waitFor();
    await page.evaluate(() => { delete document.querySelector('[data-account-outlet]').isConnected; window.__accountFake.state.release(); });
    await page.locator('[data-account-secret]').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => location.hash), '#account/tokens');
    assert.deepEqual(errors.splice(0), ["Account: a one-time value for section 'tokens' arrived while 'profile' is shown"]);
  });

  await run('uncertain creation warns in the form position and locks creation until the list is refreshed', async ({ page, calls, open }) => {
    await open('settings-tokens-uncertain');
    await page.locator('table[data-list="tokens"] tr[data-row-id]').first().waitFor();
    await button(page, 'New token').click();
    const formTop = await page.locator('[data-account-token-form]').evaluate(node => node.getBoundingClientRect().top);
    await page.getByLabel('Name', { exact: true }).fill('lost-reply-token');
    await button(page, 'Create token').click();
    const warning = page.locator('[data-account-uncertain]');
    await warning.waitFor();
    assert.equal(await warning.evaluate(node => node.getBoundingClientRect().top), formTop);
    assert.equal(await button(page, 'New token').isDisabled(), true);
    assert.equal(await button(page, 'Dismiss').isDisabled(), true);
    await button(page, 'Refresh list and check').click();
    await page.locator('tr[data-row-id]', { hasText: 'lost-reply-token' }).waitFor();
    await button(page, 'Dismiss').click();
    assert.equal(await button(page, 'New token').isDisabled(), false);
    assert.equal(callsTo(calls, '/tokens').length, 1, 'nothing is retried automatically');
  });

  await run('revoke confirms in an in-app dialog with Cancel focused', async ({ page, calls, open }) => {
    await open('settings-tokens');
    await button(page, 'Revoke ci-collector-02').click();
    const confirm = dialog(page, 'Revoke “ci-collector-02”?');
    await confirm.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
    await confirm.getByRole('button', { name: 'Revoke token' }).click();
    await confirm.waitFor({ state: 'detached' });
    await page.locator('tr[data-row-id="00000000-0000-4000-8000-000000300014"]').waitFor({ state: 'detached' });
    assert.deepEqual(calls.filter(call => call.path.endsWith('/revoke')).map(call => [call.path, call.actor]), [['/tokens/00000000-0000-4000-8000-000000300014/revoke', 'actor-alice']]);
  });

  await run('admin approves a pending applicant', async ({ page, calls, open }) => {
    await open('settings-password');
    await page.getByRole('button', { name: 'Change password' }).waitFor(); // a profile-dependent route replaces its placeholder
    await open('users-default');
    await button(page, 'Approve bob…').click();
    const application = dialog(page, 'Application of “bob”');
    await application.getByText('(not verified)').waitFor();
    await application.getByRole('button', { name: 'Approve' }).click();
    await page.locator('tr[data-row-id="bob"]', { hasText: 'Active' }).waitFor();
    assert.deepEqual(callsTo(calls, '/admin/users/bob/approve').map(call => [call.body, call.actor]), [[{}, 'actor-alice']]);
  });

  await run('admin flag change asks for the current password and keeps the prompt on rejection', async ({ page, calls, open }) => {
    await open('users-default');
    await button(page, 'Actions for erin').click();
    await page.getByRole('menuitem', { name: 'Grant admin…' }).click();
    const prompt = dialog(page, 'Make “erin” an administrator?');
    await prompt.getByLabel('Your current password').fill('not the password');
    await prompt.getByRole('button', { name: 'Grant admin' }).click();
    await prompt.getByText('Your password was not accepted.').waitFor();
    assert.equal(await prompt.getByLabel('Your current password').inputValue(), '', 'a proof password is used for one request only');
    await prompt.getByLabel('Your current password').fill(FAKE_PASSWORD);
    await prompt.getByRole('button', { name: 'Grant admin' }).click();
    await prompt.waitFor({ state: 'detached' });
    assert.deepEqual(callsTo(calls, '/admin/users/erin/admin').map(call => call.body), [{ admin: true, currentPassword: 'not the password' }, { admin: true, currentPassword: FAKE_PASSWORD }]);
  });

  await run('an unacknowledged reset link blocks further link-producing actions', async ({ page, calls, open }) => {
    await open('users-default');
    await button(page, 'Actions for erin').click();
    await page.getByRole('menuitem', { name: 'Reset credentials…' }).click();
    const prompt = dialog(page, 'Reset credentials of “erin”?');
    await prompt.getByLabel('Your current password').fill(FAKE_PASSWORD);
    await prompt.getByRole('button', { name: 'Create reset link' }).click();
    const panel = page.locator('[data-account-link]');
    await panel.getByText('Credential reset link for “erin”').waitFor();
    assert.equal(await button(page, 'Enroll user').isDisabled(), true);
    await button(page, 'Actions for mallory').click();
    assert.equal(await page.getByRole('menuitem', { name: 'Reset credentials…' }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await panel.getByText('Credential reset link for “erin”').waitFor();
    assert.equal(callsTo(calls, '/admin/users/erin/reset').length + callsTo(calls, '/admin/users/mallory/reset').length, 1);
    // Codes are base64url: the field must draw '_' (the pinned Chromium dropped it in a 14 px DejaVu Sans Mono input).
    const field = panel.getByLabel('One-time link', { exact: true });
    const drawn = async text => { await field.evaluate((input, value) => { input.value = value; }, text); return createHash('sha256').update(await field.screenshot()).digest('hex'); };
    assert.notEqual(await drawn('AAAA____BBBB'), await drawn('AAAA    BBBB'), 'underscores of a one-time value are drawn');
  });

  await run('a pending reset link can be revoked in-app, also with invitations disabled', async ({ page, calls, open }) => {
    await open('users-signup-only');
    await page.locator('tr[data-row-id="ivan"]', { hasText: 'Reset link sent' }).waitFor();
    assert.equal(await button(page, 'Enroll user').count(), 0);
    await button(page, 'Actions for ivan').click();
    await page.getByRole('menuitem', { name: 'Revoke reset link…' }).click();
    const confirm = dialog(page, 'Revoke the reset link for “ivan”?');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
    await confirm.getByRole('button', { name: 'Revoke link' }).click();
    await confirm.waitFor({ state: 'detached' });
    await page.locator('tr[data-row-id="ivan"]', { hasText: 'Reset link sent' }).waitFor({ state: 'detached' });
    assert.deepEqual(calls.filter(call => call.path.endsWith('/revoke')).map(call => [call.path, call.body, call.actor]), [['/admin/enrollments/enrollment-0002/revoke', {}, 'actor-alice']]);
  });

  await run('without the new endpoints only login and access tokens remain', async ({ page, calls, open }) => {
    await open('login-legacy');
    assert.equal(await page.getByRole('link', { name: 'Forgot password?' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Create an account' }).count(), 0);
    await page.getByLabel('Username', { exact: true }).fill('alice');
    await page.getByLabel('Password', { exact: true }).fill(FAKE_PASSWORD);
    const reloaded = page.waitForEvent('load');
    await button(page, 'Sign in').click();
    await reloaded;
    assert.deepEqual(callsTo(calls, '/login').map(call => call.body), [{ login: 'alice', password: FAKE_PASSWORD }]);
    await page.goto(`${server.origin}/?scenario=settings-legacy&steps=0#account/profile`);
    await page.waitForFunction(() => location.hash === '#account/tokens');
    assert.deepEqual(await page.getByRole('navigation', { name: 'Account sections' }).getByRole('link').evaluateAll(links => links.map(link => link.dataset.section)), ['tokens']);
    await mint(page, 'legacy-cli');
    await page.getByLabel('One-time token secret', { exact: true }).waitFor();
  });

  await run('long token list: the document is the only scroller and the list head sticks; markup is app-independent', async ({ page, open }) => {
    await open('settings-tokens-long');
    const scrollers = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
    }).length);
    assert.equal(await scrollers(), 0);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), true);
    await page.evaluate(() => window.scrollTo(0, 1500));
    assert.equal(await page.locator('[data-view="tokens"] .account-list-head').evaluate(node => node.getBoundingClientRect().top), MASTHEAD_PX);
    assert.equal(await page.locator('table[data-list="tokens"] th').first().evaluate(node => node.getBoundingClientRect().top), MASTHEAD_PX + VIEWBAR_PX);
    const profileMarkup = async app => {
      await open('settings-profile', `&app=${app}`);
      return page.locator('[data-account-outlet]').evaluate(node => node.innerHTML.replace(/account-[a-z-]+-\d+/g, 'id'));
    };
    assert.equal(await profileMarkup('manure'), await profileMarkup('chronicle'));
  });

  console.log(`PASS ${cases} account view browser cases`);
} finally { await browser.close(); await server.close(); }
