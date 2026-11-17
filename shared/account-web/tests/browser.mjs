// Lean behavioural checks of the shared account views on the controlled-route harness (dev/index.html):
// real Chromium, DOM, focus and clipboard; the account HTTP plane is the in-page fake of dev/fake-server.js.
// Run: nix develop .#chronicle --command node shared/account-web/tests/browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from '../dev/serve.mjs';
import { FAKE_PASSWORD, FAKE_TOKEN_SECRET, FAKE_WRONG_CODE } from '../dev/fake-server.js';

const require = createRequire(new URL('../../../chronicle/web/package.json', import.meta.url));
const { chromium } = require('playwright-core');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned Chromium environment (nix develop .#chronicle); no browser downloads.');

const STEP_TIMEOUT_MS = 5000;
const MASTHEAD_PX = 48, VIEWBAR_PX = 56;
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
  try { await body({ page, calls, open }); assert.deepEqual(errors, []); cases++; console.log(`PASS account views: ${name}`); }
  finally { await context.close(); }
}
const storageText = page => page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
const callsTo = (calls, path) => calls.filter(call => call.path === path);
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
