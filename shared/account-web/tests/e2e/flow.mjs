// The accounts feature end to end through a service's REAL dashboard and REAL server (accounts design §4, §12;
// shared/account-web/README.md): self-signup with authenticator set-up → pending → admin approval → sign-in without a
// code → opt-in TOTP at login → recovery → admin enrollment by one-time link → admin flag rules → credential reset →
// disable. One browser, one context per person and device. Only the pages are driven; the one direct request checks
// that an API token survives recovery, which no page shows. Each service has a thin harness that starts its server.
//
// Time steps: every TOTP time step is usable once per account (design §4.2.3) and the server accepts {T-1, T, T+1}.
// Codes are therefore taken in ascending steps from that window instead of waiting 30 s per code; set-up proofs of a
// new key (signup, enrollment, reset) are independent of the account's previous steps. Only when the window holds no
// unused step does the flow wait for the next step boundary; the result lists every such wait (`waits`).
//
// Failures report the step, the visible text of every page and the failed requests, with every password, key, code,
// token and link of the run redacted.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// A code for step T-1 stops verifying at the next boundary; it is only used with this much time left.
const PREVIOUS_STEP_MARGIN_SECONDS = 8;
const UI_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1440, height: 900 };
const PAGE_TEXT_LIMIT = 1500;
const FAILED_REQUEST_LIMIT = 12;
const SECRET_MIN_LENGTH = 6;
const PASSWORD_BYTES = 18;
// Each person gets its own client address (TEST-NET-2) through the X-Forwarded-For header that the servers accept
// from their loopback proxy; the per-address credential-endpoint windows then count one person each, as in use.
const ADDRESS_PREFIX = '198.51.100.';
// 32 random bytes, base64url without padding (design §4.4).
const ENROLLMENT_CODE = /^[A-Za-z0-9_-]{43}$/;
const ALICE = 'alice';
const BOB = 'bob';

// ---------------------------------------------------------------------------------------------
// RFC 6238 (HMAC-SHA1, 6 digits, 30 s, T0 = 0)

function base32Decode(text) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('the authenticator key shown is not base32');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}
export function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, '0');
}

// ---------------------------------------------------------------------------------------------

export async function runAccountFlow({ baseUrl, service, admin, browserType, launchOptions, evidenceDir }) {
  assert.ok(['haystack', 'manure', 'chronicle'].includes(service), `unknown service ${service}`);
  assert.ok(evidenceDir === null || path.isAbsolute(evidenceDir), 'evidenceDir is null or absolute');
  const started = Date.now();
  const secrets = new Set([admin.password]);
  const remember = value => { if (typeof value === 'string' && value.length >= SECRET_MIN_LENGTH) secrets.add(value); return value; };
  const newPassword = () => remember(randomBytes(PASSWORD_BYTES).toString('base64url'));
  const waits = [];
  const pages = [];
  let current = 'setup';
  let shots = 0;
  let addresses = 0;
  const lastStep = new Map(); // account → highest step the server has accepted (shared by all its code paths)

  const nowSeconds = () => Date.now() / 1000;
  async function waitForBoundary(purpose) {
    const ms = Math.ceil((STEP_SECONDS - (nowSeconds() % STEP_SECONDS)) * 1000) + 250;
    waits.push({ step: current, purpose, ms });
    await new Promise(resolve => setTimeout(resolve, ms));
  }
  // The lowest usable step above the account's last accepted one, so later codes keep the most room.
  function usableStep(account) {
    const now = nowSeconds(), step = Math.floor(now / STEP_SECONDS);
    const floor = lastStep.has(account) ? lastStep.get(account) : -1;
    for (const candidate of [step - 1, step, step + 1]) {
      if (candidate <= floor) continue;
      if (candidate === step - 1 && (step + 1) * STEP_SECONDS - now < PREVIOUS_STEP_MARGIN_SECONDS) continue;
      return candidate;
    }
    return null;
  }
  // A code the server will accept and consume for `account` (login second step, recovery, toggle).
  async function nextCode(account, secret, purpose) {
    for (;;) {
      const step = usableStep(account);
      if (step !== null) { lastStep.set(account, step); return remember(totpCode(secret, step)); }
      await waitForBoundary(purpose);
    }
  }
  // The proof of a newly generated key is verified without the account's previous steps; the account then keeps the
  // higher of its last step and the proving one (a reset does not lower it).
  function setupCode(account, secret) {
    const previous = lastStep.has(account) ? lastStep.get(account) : -1;
    lastStep.delete(account);
    const step = usableStep(account);
    lastStep.set(account, Math.max(previous, step));
    return remember(totpCode(secret, step));
  }
  // A code of a replaced key for a step the account has not used: it would be accepted if the key still counted.
  async function probeCode(account, secret, purpose) {
    for (;;) {
      const step = usableStep(account);
      if (step !== null) return remember(totpCode(secret, step));
      await waitForBoundary(purpose);
    }
  }

  const redact = text => {
    let result = String(text);
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      result = result.split(secret).join('[redacted]');
      const grouped = secret.match(/.{1,4}/g).join(' ');
      if (grouped !== secret) result = result.split(grouped).join('[redacted]');
    }
    return result.replace(/#account-enroll=[A-Za-z0-9_-]+/g, '#account-enroll=[redacted]');
  };

  const browser = await browserType.launch(launchOptions);
  async function device(person) {
    const context = await browser.newContext({
      viewport: VIEWPORT, permissions: ['clipboard-read', 'clipboard-write'],
      extraHTTPHeaders: { 'X-Forwarded-For': person.address }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(UI_TIMEOUT_MS);
    const record = { name: person.name, page, errors: [], failed: [] };
    page.on('pageerror', error => record.errors.push(`${current}: ${error.message}`));
    page.on('dialog', native => { record.errors.push(`${current}: native ${native.type()} dialog`); void native.dismiss(); });
    page.on('response', response => {
      if (response.status() >= 400) record.failed.push(`${current}: ${response.request().method()} ${new URL(response.url()).pathname} → ${response.status()}`);
    });
    page.on('requestfailed', request => record.failed.push(`${current}: ${request.method()} ${new URL(request.url()).pathname} failed (${request.failure()?.errorText ?? 'unknown'})`));
    pages.push(record);
    return page;
  }
  const person = name => ({ name, address: ADDRESS_PREFIX + String(++addresses) });

  async function shot(page, name) {
    if (evidenceDir === null) return;
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, `${String(++shots).padStart(2, '0')}-${name}.png`), fullPage: true });
  }
  async function step(name, body) {
    current = name;
    try { await body(); } catch (error) {
      const report = [`account flow (${service}) failed at step ${name}: ${error instanceof Error ? error.message : String(error)}`];
      for (const record of pages) {
        let text = '(page closed)', url = '';
        if (!record.page.isClosed()) {
          url = record.page.url().replace(/#.*$/, '#…');
          text = await record.page.evaluate(() => document.body.innerText).catch(() => '(no text)');
        }
        report.push(`--- ${record.name} ${url}`, text.slice(0, PAGE_TEXT_LIMIT), ...record.errors.map(line => `page error: ${line}`),
          ...record.failed.slice(-FAILED_REQUEST_LIMIT).map(line => `request: ${line}`));
      }
      throw new Error(redact(report.join('\n')));
    }
  }

  // ── Page vocabulary shared by the three dashboards ──────────────────────────────────────────
  const loginCard = page => page.locator('form[data-account-login]');
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
  const toast = (page, text) => page.locator('[data-account-toasts]').getByText(text, { exact: true }).waitFor();
  const userButton = (page, login) => page.locator('button.user-button').filter({ hasText: login });
  const signedIn = (page, login) => userButton(page, login).waitFor();
  async function openSignedOut(page) {
    await page.goto(`${baseUrl}/`);
    await loginCard(page).waitFor();
  }
  async function submitLogin(page, login, password) {
    const card = loginCard(page);
    await card.getByLabel('Username', { exact: true }).fill(login);
    await card.getByLabel('Password', { exact: true }).fill(password);
    await button(card, 'Sign in').click();
  }
  const loginAlert = (page, text) => loginCard(page).getByRole('alert').filter({ hasText: text });
  async function rejectedLogin(page, login, password) {
    await submitLogin(page, login, password);
    await loginAlert(page, 'Invalid username or password.').waitFor();
  }
  async function signIn(page, login, password) {
    await submitLogin(page, login, password);
    await signedIn(page, login);
  }
  async function menu(page, login, item) {
    await userButton(page, login).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  }
  const section = (page, view) => page.locator(`[data-account-outlet] section[data-view="${view}"]`);
  async function accountNav(page, label, view) {
    await page.getByRole('navigation', { name: 'Account sections' }).getByRole('link', { name: label }).click();
    await section(page, view).waitFor();
  }
  const userRow = (page, id) => section(page, 'users').locator(`tr[data-row-id="${id}"]`);
  async function rowAction(page, id, item) {
    await button(userRow(page, id), `Actions for ${id}`).click();
    await userRow(page, id).getByRole('menuitem', { name: item, exact: true }).click();
  }
  async function confirmWithPassword(page, title, confirm, password) {
    const prompt = dialog(page, title);
    await prompt.getByLabel('Your current password', { exact: true }).fill(password);
    await button(prompt, confirm).click();
    await prompt.waitFor({ state: 'detached' });
  }
  // Reads a shown-once link, checks that the panel survives Escape and leaving, and acknowledges it.
  async function takeLink(page, title) {
    const panel = page.locator('[data-account-link]').filter({ hasText: title });
    await panel.waitFor();
    const link = remember(await panel.getByLabel('One-time link', { exact: true }).inputValue());
    assert.ok(link.startsWith(`${baseUrl}/#account-enroll=`) && ENROLLMENT_CODE.test(link.slice(`${baseUrl}/#account-enroll=`.length)),
      'the one-time link is an enrollment fragment with a 256-bit code on the service origin');
    assert.equal(await shows(page, link), true);
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Account sections' }).getByRole('link', { name: 'Profile' }).click();
    await button(dialog(page, 'Hide the link for good?'), 'Keep it visible').click();
    assert.equal(await panel.isVisible(), true, 'the link panel is not dismissed by Escape or by leaving');
    assert.equal(await section(page, 'users').isVisible(), true, 'keeping the link stays in Users');
    await shot(page, title.startsWith('Invitation') ? 'invitation-link-shown-once' : 'reset-link-shown-once');
    await button(panel, 'Copy link').click();
    await button(panel, 'I have sent it').click();
    await button(dialog(page, 'Hide the link for good?'), 'Yes, I have sent it').click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(await shows(page, link), false, 'an acknowledged link is gone from the page');
    return link;
  }
  // Whether the page still displays `value`: its markup, its text or the value of any field.
  const shows = (page, value) => page.evaluate(wanted => [document.documentElement.outerHTML, document.body.innerText,
    ...[...document.querySelectorAll('input, textarea')].map(field => field.value)].some(text => text.includes(wanted)), value);
  async function noStoredSecret(page, values) {
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    for (const value of values) assert.ok(!stored.includes(value), 'no secret in web storage');
  }
  async function readKey(form) {
    const key = remember((await form.locator('[data-account-totp-key]').innerText()).replace(/\s+/g, ''));
    assert.ok(await form.locator('[data-account-qr] .qr-row').count() > 0, 'the QR code is rendered');
    return key;
  }

  // An authenticated API call of the service with a bearer token: the one state no page shows.
  const tokenProbe = {
    haystack: token => fetch(`${baseUrl}/api/v1/whoami`, { headers: { 'X-Haystack-Version': '1.0.0', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) } }),
    manure: token => fetch(`${baseUrl}/api/current`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ requestId: crypto.randomUUID(), apiVersion: '1.0.0', command: { Whoami: {} } }) }),
    chronicle: token => fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  }[service];

  const alice = person(ALICE), bob = person(BOB), operator = person(admin.login);
  const email = `${ALICE}@example.test`, changedEmail = `${ALICE}.changed@example.test`;
  const passwords = { alice: newPassword(), aliceRecovered: newPassword(), aliceReset: newPassword(), bob: newPassword() };
  const keys = {};
  let apiToken = null, invitation = null, reset = null;

  try {
    const aliceLaptop = await device(alice);
    const adminPage = await device(operator);

    await step('a. sign-up with authenticator set-up ends pending', async () => {
      await openSignedOut(aliceLaptop);
      await shot(aliceLaptop, 'login-card');
      await aliceLaptop.getByRole('link', { name: 'Create an account', exact: true }).click();
      const form = aliceLaptop.locator('form[data-view="signup"]');
      await form.waitFor();
      await form.getByLabel('Username', { exact: true }).fill(ALICE);
      await form.getByLabel('E-mail', { exact: true }).fill(email);
      await form.getByLabel('Password', { exact: true }).fill(passwords.alice);
      keys.alice = await readKey(form);
      await form.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill(setupCode(ALICE, keys.alice));
      await shot(aliceLaptop, 'signup-form');
      await button(form, 'Create account').click();
      const pending = aliceLaptop.locator('[data-view="signup-pending"]');
      await pending.getByRole('heading', { name: 'Account created — waiting for approval' }).waitFor();
      await shot(aliceLaptop, 'signup-pending');
      await noStoredSecret(aliceLaptop, [keys.alice, passwords.alice]);
      await button(pending, 'Go to sign-in').click();
      await loginCard(aliceLaptop).waitFor();
      await rejectedLogin(aliceLaptop, ALICE, newPassword());
      await submitLogin(aliceLaptop, ALICE, passwords.alice);
      await loginAlert(aliceLaptop, 'Awaiting approval by an administrator').waitFor();
      await shot(aliceLaptop, 'login-awaiting-approval');
    });

    await step('b. the configured admin approves; the applicant signs in without a code', async () => {
      await openSignedOut(adminPage);
      await signIn(adminPage, admin.login, admin.password);
      await menu(adminPage, admin.login, 'Users');
      await userRow(adminPage, ALICE).getByText('Pending approval', { exact: true }).waitFor();
      await shot(adminPage, 'users-pending-applicant');
      await button(userRow(adminPage, ALICE), `Approve ${ALICE}…`).click();
      const application = dialog(adminPage, `Application of “${ALICE}”`);
      await application.getByText(`${email} (not verified)`).waitFor();
      await shot(adminPage, 'approve-application');
      await button(application, 'Approve').click();
      await toast(adminPage, `${ALICE} approved`);
      await userRow(adminPage, ALICE).getByText('Active', { exact: true }).waitFor();
      await signIn(aliceLaptop, ALICE, passwords.alice);
    });

    await step('c. profile e-mail, opt-in code at sign-in, two-step sign-in', async () => {
      await menu(aliceLaptop, ALICE, 'Account settings');
      const profile = section(aliceLaptop, 'profile');
      await profile.waitFor();
      await profile.getByLabel('E-mail', { exact: true }).fill(changedEmail);
      await button(profile, 'Save e-mail').click();
      await toast(aliceLaptop, 'E-mail saved');
      await aliceLaptop.reload();
      assert.equal(await section(aliceLaptop, 'profile').getByLabel('E-mail', { exact: true }).inputValue(), changedEmail, 'the e-mail persists');
      assert.equal(await section(aliceLaptop, 'profile').getByLabel('Username', { exact: true }).isEditable(), false, 'the username is not editable');
      await shot(aliceLaptop, 'profile');

      await accountNav(aliceLaptop, 'Access tokens', 'tokens');
      await button(aliceLaptop, 'New token').first().click();
      const tokenForm = aliceLaptop.locator('form[data-account-token-form]');
      await tokenForm.getByLabel('Name', { exact: true }).fill('e2e recovery probe');
      if (service === 'chronicle') await tokenForm.getByRole('checkbox', { name: /^Read —/ }).check();
      await button(tokenForm, 'Create token').click();
      const secretPanel = aliceLaptop.locator('[data-account-secret]');
      await secretPanel.waitFor();
      await shot(aliceLaptop, 'token-secret-shown-once');
      await button(secretPanel, 'Reveal').click();
      apiToken = remember(await secretPanel.getByLabel('One-time token secret', { exact: true }).inputValue());
      await button(secretPanel, 'I have saved it').click();
      await button(dialog(aliceLaptop, 'Hide the secret for good?'), 'Yes, I have saved it').click();
      await secretPanel.waitFor({ state: 'detached' });
      assert.equal(await shows(aliceLaptop, apiToken), false, 'an acknowledged token secret is gone from the page');

      await accountNav(aliceLaptop, 'Two-factor', 'two-factor');
      const twoFactor = section(aliceLaptop, 'two-factor');
      await twoFactor.getByRole('checkbox', { name: /^Require a code at every sign-in/ }).click();
      const confirm = dialog(aliceLaptop, 'Require a code at every sign-in?');
      await confirm.getByLabel('Authenticator code', { exact: true }).fill(await nextCode(ALICE, keys.alice, 'require a code at sign-in'));
      await shot(aliceLaptop, 'require-code-confirm');
      await button(confirm, 'Require codes').click();
      await toast(aliceLaptop, 'Codes are now required at sign-in');
      await twoFactor.getByText('On', { exact: true }).waitFor();

      await menu(aliceLaptop, ALICE, 'Sign out');
      await loginCard(aliceLaptop).waitFor();
      await submitLogin(aliceLaptop, ALICE, passwords.alice);
      const second = aliceLaptop.locator('form[data-account-login-totp]');
      await second.getByRole('heading', { name: 'Enter your authenticator code' }).waitFor();
      await shot(aliceLaptop, 'login-second-step');
      await second.getByLabel('6-digit code', { exact: true }).fill(await nextCode(ALICE, keys.alice, 'second sign-in step'));
      await button(second, 'Verify and sign in').click();
      await signedIn(aliceLaptop, ALICE);
    });

    await step('d. recovery with the authenticator ends other sessions and keeps API tokens', async () => {
      assert.equal((await tokenProbe(null)).status, 401, 'the API refuses a request without a token');
      const aliceTablet = await device(alice);
      await openSignedOut(aliceTablet);
      await loginCard(aliceTablet).getByRole('link', { name: 'Forgot password?', exact: true }).click();
      const form = aliceTablet.locator('form[data-view="recover"]');
      await form.getByLabel('Username', { exact: true }).fill(ALICE);
      await form.getByLabel('Authenticator code', { exact: true }).fill(await nextCode(ALICE, keys.alice, 'recovery'));
      await form.getByLabel('New password', { exact: true }).fill(passwords.aliceRecovered);
      await shot(aliceTablet, 'recovery-form');
      await button(form, 'Set new password and sign in').click();
      await signedIn(aliceTablet, ALICE);

      await aliceLaptop.reload();
      await loginCard(aliceLaptop).waitFor();
      await rejectedLogin(aliceLaptop, ALICE, passwords.alice);
      // The new password is accepted: the code step follows (a wrong password ends at the generic failure).
      await submitLogin(aliceLaptop, ALICE, passwords.aliceRecovered);
      await aliceLaptop.locator('form[data-account-login-totp]').waitFor();
      const probe = await tokenProbe(apiToken);
      assert.equal(probe.status, 200, 'an API token minted before recovery still works');
    });

    await step('e. admin enrollment by a one-time link', async () => {
      await button(section(adminPage, 'users'), 'Enroll user').click();
      const enroll = adminPage.locator('form[data-account-enroll-form]');
      await enroll.getByLabel('Username', { exact: true }).fill(BOB);
      await button(enroll, 'Create invitation link').click();
      invitation = await takeLink(adminPage, `Invitation link for “${BOB}” — shown once`);
      await userRow(adminPage, `invite:${BOB}`).getByText('Invitation sent', { exact: true }).waitFor();

      const bobLaptop = await device(bob);
      await bobLaptop.goto(invitation);
      const form = bobLaptop.locator('form[data-view="enrollment"]');
      await form.getByRole('heading', { name: 'Finish setting up your account' }).waitFor();
      assert.ok(!bobLaptop.url().includes('#account-enroll='), 'the code is removed from the address bar');
      const username = form.getByLabel('Username', { exact: true });
      assert.equal(await username.inputValue(), BOB);
      assert.equal(await username.isEditable(), false, 'the invited username is fixed');
      await form.getByLabel('E-mail', { exact: true }).fill(`${BOB}@example.test`);
      await form.getByLabel('Password', { exact: true }).fill(passwords.bob);
      keys.bob = await readKey(form);
      await form.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill(setupCode(BOB, keys.bob));
      await shot(bobLaptop, 'enrollment-form');
      await button(form, 'Create account and sign in').click();
      await signedIn(bobLaptop, BOB);

      const replay = await device(bob);
      await replay.goto(invitation);
      await replay.getByRole('heading', { name: 'This link is no longer valid' }).waitFor();
      await shot(replay, 'invitation-link-reused');
      await replay.context().close();
    });

    await step('f. admin flag: granted with the password, configured admins are fixed, revoked again', async () => {
      const bobLaptop = pages.find(record => record.name === BOB).page;
      // The Users list is a snapshot (no polling): the admin reloads it to see that the invitation was redeemed.
      await adminPage.reload();
      await userRow(adminPage, BOB).getByText('Active', { exact: true }).waitFor();
      await rowAction(adminPage, BOB, 'Grant admin…');
      await shot(adminPage, 'grant-admin-asks-password');
      await confirmWithPassword(adminPage, `Make “${BOB}” an administrator?`, 'Grant admin', admin.password);
      await toast(adminPage, `${BOB} is now an administrator`);
      await userRow(adminPage, BOB).getByText('Admin', { exact: true }).waitFor();

      await bobLaptop.goto(`${baseUrl}/`);
      await menu(bobLaptop, BOB, 'Users');
      const configured = userRow(bobLaptop, admin.login);
      await configured.getByText('read-only', { exact: true }).waitFor();
      assert.equal(await configured.getByRole('button').count(), 0, 'a configured admin has no controls');
      assert.equal(await configured.getByText('read-only', { exact: true }).getAttribute('title'), 'Managed in server configuration');
      await shot(bobLaptop, 'second-admin-sees-users');

      await rowAction(adminPage, BOB, 'Revoke admin…');
      await confirmWithPassword(adminPage, `Remove administrator rights from “${BOB}”?`, 'Revoke admin', admin.password);
      await toast(adminPage, `${BOB} is no longer an administrator`);
      await userRow(adminPage, BOB).getByText('Admin', { exact: true }).waitFor({ state: 'detached' });
      await bobLaptop.goto(`${baseUrl}/`);
      await userButton(bobLaptop, BOB).click();
      await bobLaptop.getByRole('menuitem', { name: 'Account settings', exact: true }).waitFor();
      assert.equal(await bobLaptop.getByRole('menuitem', { name: 'Users', exact: true }).count(), 0, 'a revoked admin no longer sees Users');
      await bobLaptop.keyboard.press('Escape');
    });

    await step('g. credential reset by link replaces password and authenticator', async () => {
      await rowAction(adminPage, ALICE, 'Reset credentials…');
      await confirmWithPassword(adminPage, `Reset credentials of “${ALICE}”?`, 'Create reset link', admin.password);
      reset = await takeLink(adminPage, `Credential reset link for “${ALICE}” — shown once`);

      const alicePhone = await device(alice);
      await alicePhone.goto(reset);
      const form = alicePhone.locator('form[data-view="enrollment"]');
      await form.getByRole('heading', { name: 'Reset your credentials' }).waitFor();
      assert.equal(await form.getByLabel('Username', { exact: true }).inputValue(), ALICE);
      assert.equal(await form.getByLabel('E-mail', { exact: true }).count(), 0, 'a reset keeps the e-mail');
      await form.getByLabel('Password', { exact: true }).fill(passwords.aliceReset);
      const oldKey = keys.alice;
      keys.alice = await readKey(form);
      assert.notEqual(keys.alice, oldKey);
      await form.getByLabel('Enter the 6-digit code the app shows', { exact: true }).fill(setupCode(ALICE, keys.alice));
      await shot(alicePhone, 'reset-form');
      await button(form, 'Replace credentials and sign in').click();
      await signedIn(alicePhone, ALICE);

      await openSignedOut(aliceLaptop);
      await rejectedLogin(aliceLaptop, ALICE, passwords.aliceRecovered);
      await loginCard(aliceLaptop).getByRole('link', { name: 'Forgot password?', exact: true }).click();
      const recover = aliceLaptop.locator('form[data-view="recover"]');
      await recover.getByLabel('Username', { exact: true }).fill(ALICE);
      await recover.getByLabel('Authenticator code', { exact: true }).fill(await probeCode(ALICE, oldKey, 'old authenticator probe'));
      await recover.getByLabel('New password', { exact: true }).fill(newPassword());
      await button(recover, 'Set new password and sign in').click();
      await recover.getByRole('alert').filter({ hasText: 'Recovery was not accepted.' }).waitFor();
      await shot(aliceLaptop, 'old-authenticator-rejected');
    });

    await step('h. disabling ends the open session and refuses sign-in', async () => {
      const bobLaptop = pages.find(record => record.name === BOB).page;
      await rowAction(adminPage, BOB, 'Disable account…');
      await button(dialog(adminPage, `Disable “${BOB}”?`), 'Disable account').click();
      await toast(adminPage, `${BOB} disabled`);
      await userRow(adminPage, BOB).getByText('Disabled', { exact: true }).waitFor();
      await shot(adminPage, 'users-after-disable');
      await bobLaptop.reload();
      await loginCard(bobLaptop).waitFor();
      await rejectedLogin(bobLaptop, BOB, passwords.bob);
      await shot(bobLaptop, 'disabled-sign-in-refused');
    });

    await step('no page errors or native dialogs', async () => {
      assert.deepEqual(pages.flatMap(record => record.errors), []);
    });
  } finally {
    await browser.close();
  }
  return { durationMs: Date.now() - started, waits, screenshots: shots };
}
