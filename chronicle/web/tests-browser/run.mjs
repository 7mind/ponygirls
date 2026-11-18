import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, advanceClock, advanceClockUntil, api, connectionConfig, pauseClock, retryBudgetMillis } from './fixture.mjs';
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!browsers) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH to the provisioned Playwright 1.64.1 browsers; tests never download browsers.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, allowedHosts: ['chronicle.test'], watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP chronicle.test 127.0.0.1', '--no-proxy-server'] });
const errors = [];
async function scene(configure) {
  return sceneAt(origin, true, configure);
}
async function sceneAt(sceneOrigin, waitForArchive, configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  const page = await context.newPage(); page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  const fixture = new ChronicleFixture(); if (configure) await configure(fixture, page); await fixture.install(page);
  await page.goto(`${sceneOrigin}/tests-browser/harness.html`);
  if (fixture.signedIn) { await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor(); }
  if (waitForArchive) await archiveReady(page);
  return { context, page, fixture };
}
// The shared account page in the outlet (degraded mode: the fixture has only the five existing account endpoints).
async function openTokens(page, login = 'alice') {
  await page.getByRole('button', { name: login, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Access tokens', exact: true }).click();
  await page.getByRole('heading', { name: 'Access tokens', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New token', exact: true }).first().waitFor();
}
async function mint(page, name) {
  await page.getByRole('button', { name: 'New token', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create token', exact: true }).click();
}
async function revoke(page, name) {
  await page.getByRole('button', { name: `Revoke ${name}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke token', exact: true }).click();
  await page.getByRole('button', { name: `Revoke ${name}`, exact: true }).waitFor({ state: 'detached' });
}
async function signOut(page, login = 'alice') {
  await page.getByRole('button', { name: login, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
}
const tokenRow = (page, name) => page.locator('table[data-list="tokens"] tr[data-row-id]').filter({ hasText: name });
const SIGN_IN = /^Sign in/;
async function archiveReady(page) {
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-table[aria-busy="false"]').waitFor();
  await page.locator('.archive-row .table-title').first().waitFor();
}
async function submitExpression(page, expression) {
  await page.getByRole('combobox', { name: 'Search conversations' }).fill(expression);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await archiveReady(page);
}
async function search(page) {
  await page.keyboard.press('Control+k');
  await submitExpression(page, '(original source) mode:hybrid');
}
async function waitForCalls(fixture, predicate, count) {
  const deadline = Date.now() + 10_000;
  while (fixture.calls.filter(predicate).length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fixture.calls.filter(predicate).length >= count, 'expected generated API operation was not observed');
}
try {
  // Regression: neutral task labels replace promotional headings and empty-state slogans.
  // Behavioral-Active Blackbox / Good Communication: rendered UI, controlled API fixture.
  {
    const { context, page } = await scene();
    await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
    await page.locator('.archive-row .table-title').getByText('Following the migration thread', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations' }).inputValue(), '');
    assert.equal(await page.getByRole('dialog').count(), 0, 'the default archive is browsable without an unsolicited source modal');
    assert.equal(await page.getByRole('heading', { name: /Search sessions|No search submitted|No session selected/ }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Chronicle home', exact: true }).textContent(), 'chronicle');
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    await context.close(); console.log('PASS browser: neutral task headings, empty states and branding');
  }
  // Regression: loopback HTTP is trustworthy; non-loopback HTTP is not.
  // Blackbox / Good Communication: real Chromium origin security + controlled API fixture.
  {
    const { context, page, fixture } = await sceneAt(`http://chronicle.test:${address.port}`, false, undefined);
    assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues })), { secure: false, uuid: 'undefined', random: 'function' });
    await page.locator('.connection-widget[data-state="live"]').waitFor({ timeout: 5000 });
    await search(page);
    await openTokens(page); await mint(page, 'Private HTTP token');
    await page.getByLabel('One-time token secret', { exact: true }).waitFor({ timeout: 5000 });
    assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_Hello));
    assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/tokens')).length, 1);
    for (const envelope of fixture.calls) assert.match(envelope.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await context.close(); console.log('PASS browser: non-loopback insecure HTTP supports Hello and reads without randomUUID');
  }
  // Specified: Blackbox / Good Communication, real UI + generated codecs with a controlled owner-scoped API.
  {
    const { context, page, fixture } = await scene(fixture => {
      fixture.staticTokens = [new api.TokenInfo('00000000-0000-4000-8000-000000000088', 'Configured collector', [api.Scope.Ingest], '2026-10-24T00:00:00Z', false)];
      fixture.tokens = [new api.TokenInfo('00000000-0000-4000-8000-000000000089', 'Issued collector', [api.Scope.Ingest], '2026-10-24T00:00:00Z', false)];
    });
    await openTokens(page);
    const configured = tokenRow(page, 'Configured collector');
    await configured.getByText('Configuration').waitFor();
    assert.equal(await configured.getByText('read-only', { exact: true }).count(), 1);
    assert.equal(await configured.getByRole('button', { name: /^Revoke/ }).count(), 0);
    assert.equal(await configured.locator('input, textarea').count(), 0);
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
    await tokenRow(page, 'Issued collector').getByText('Issued here', { exact: true }).waitFor();
    await revoke(page, 'Issued collector');
    assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/revoke')).length, 1);
    await context.close(); console.log('PASS browser: static token metadata has no secret or modification controls; issued revoke preserved');
  }
  for (const transition of ['logout-bob', 'observed-bob', 'logout-alice']) {
    const { context, page, fixture } = await scene();
    const privateQuery = '(alice-private-migration-phrase) AND project:"alice-private-project" AND branch:"alice-private-branch" AND after:"2026-10-01T10:00:00Z" AND before:"2026-11-01T10:00:00Z" AND tag:"alice-private-tag" mode:semantic';
    // An incomplete draft is never applied by the live Archive editor (a complete one is applied after 350 ms and
    // closes the source dialog, which raced the steps below).
    const privateDraft = `${privateQuery} AND producer:"alice-private-draft" AND`;
    await submitExpression(page, privateQuery);
    await page.getByRole('combobox', { name: 'Search conversations' }).fill(privateDraft);
    if (transition === 'observed-bob') {
      const beforeReconnect = fixture.searchCount; fixture.restart();
      await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeReconnect + 1);
      assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), privateDraft, 'same-user reconnect preserves the unsubmitted expression draft');
      assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).at(-1).operation.query.expression, privateQuery, 'same-user reconnect reissues the submitted expression, not its later draft');
    }
    const boundary = fixture.requests.length;
    const nextUser = transition === 'logout-alice' ? 'alice' : 'bob';
    if (transition === 'observed-bob') {
      fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart();
    } else {
      await signOut(page);
      await page.getByRole('heading', { name: SIGN_IN }).waitFor();
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill(nextUser);
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.getByRole('button', { name: nextUser, exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Search', exact: true }).getAttribute('aria-current'), 'page');
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();
    await archiveReady(page); await page.waitForTimeout(150);
    const after = fixture.requests.slice(boundary).filter(request => request.userId === nextUser).map(request => request.envelope.operation);
    assert.ok(after.some(operation => operation instanceof api.Operation_Archive), `${transition}: the new account receives its own default archive`);
    assert.equal(after.filter(operation => operation instanceof api.Operation_Archive && operation.query.expression !== '').length, 0, `${transition}: prior-session text and metadata must never be reissued`);
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations' }).inputValue(), '');
    await context.close(); console.log(`PASS browser: ${transition} clears private expression draft/submitted before any new-session RPC`);
  }
  const { context, page, fixture } = await scene(async (fixture, page) => { await page.clock.install(); });
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(shortcut);
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations' }).evaluate(element => element === document.activeElement), true);
  }
  await search(page);
  const before = fixture.searchCount; fixture.blackholeActive();
  // Within one heartbeat interval plus pong deadline, a liveness deadline expires on the silent socket: the unanswered
  // heartbeat's pong deadline, or the deadline of a request the page sent on it after it went silent (both production values).
  await advanceClock(page, connectionConfig.heartbeatInterval + connectionConfig.pongTimeout);
  await page.locator('.event-log li').filter({ hasText: /STALE \((matching pong deadline|request timeout)\)/ }).waitFor({ state: 'attached' });
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, before + 1);
  await page.locator('.connection-widget[data-state="live"]').waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), '(original source) mode:hybrid');
  const beforeRestore = fixture.searchCount;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeRestore + 1);
  const beforeRestart = fixture.searchCount; fixture.restart();
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeRestart + 1);
  await page.getByRole('link', { name: 'Access', exact: true }).click();
  await openTokens(page); await mint(page, 'Synthetic collector');
  await page.getByLabel('One-time token secret', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  assert.equal(await page.getByLabel('One-time token secret', { exact: true }).inputValue(), 'synthetic-secret-shown-once');
  await page.getByRole('button', { name: 'I have saved it', exact: true }).click(); await page.getByRole('button', { name: 'Yes, I have saved it', exact: true }).click();
  await page.getByLabel('One-time token secret', { exact: true }).waitFor({ state: 'detached' });
  await page.goBack(); await page.getByRole('main', { name: 'Access management', exact: true }).waitFor();
  assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/tokens')).length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Archive', exact: true }).click();
  await archiveReady(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout must not overflow');
  await context.close(); console.log('PASS browser: keyboard search, indexing retry, silent blackhole resync, lifecycle/server restart, responsive layout');
  for (const mode of ['unauthorized', 'version']) {
    const { context, page, fixture } = await scene(); await search(page); fixture.mode = mode; fixture.restart();
    const state = mode === 'version' ? 'update-required' : 'unauthorized';
    await (mode === 'version' ? page.locator('.connection-widget[data-state="update-required"]') : page.locator('main[data-account-auth]')).waitFor(); const count = fixture.sockets.length;
    await page.waitForTimeout(1200); assert.equal(fixture.sockets.length, count); assert.equal(await page.locator('.archive-row').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0);
    await context.close(); console.log(`PASS browser: ${state} clears protected content and stops without loop`);
  }
  {
    const { context, page, fixture } = await scene(async (fixture, page) => { await pauseClock(page); }); fixture.mode = 'outage'; fixture.restart();
    await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="stopped"]').count() === 1, retryBudgetMillis(connectionConfig), 'the connection did not stop retrying');
    const count = fixture.sockets.length;
    await advanceClock(page, connectionConfig.retryCap + 2 * connectionConfig.connectTimeout); assert.equal(fixture.sockets.length, count);
    fixture.mode = 'normal'; await page.getByLabel('Connection: stopped').click(); await page.getByRole('button', { name: 'Try again manually' }).click();
    await page.locator('.connection-widget[data-state="live"]').waitFor();
    const live = fixture.sockets.length; await page.evaluate(() => { document.dispatchEvent(new Event('resume')); });
    await fixture.waitUntil(() => fixture.sockets.length > live, 'resume did not open a replacement socket'); await context.close(); console.log('PASS browser: finite retries → stopped → manual recovery; resume replacement');
  }
  {
    const { context, page, fixture } = await scene(); fixture.mintUncertain = true;
    await openTokens(page); await mint(page, 'Uncertain collector');
    await page.getByRole('button', { name: 'Refresh list and check', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).waitFor();
    assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/tokens')).length, 1);
    assert.equal(await page.getByLabel('One-time token secret', { exact: true }).count(), 0);
    await revoke(page, 'Uncertain collector');
    await context.close(); console.log('PASS browser: uncertain account mint never replayed, list reconciled, lost secret requires revoke/remint');
  }
  {
    const { context, page, fixture } = await sceneAt(origin, false, fixture => { fixture.signedIn = false; });
    await page.getByRole('heading', { name: SIGN_IN }).waitFor();
    await page.getByRole('textbox', { name: 'Username', exact: true }).fill('alice');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Archive', exact: true }).click();
    await archiveReady(page);
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'chronicle_session' && cookie.httpOnly));
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    fixture.dropLogout = true; await signOut(page);
    await page.getByText(/^Sign-out failed/).waitFor({ timeout: 5000 });
    assert.equal(await page.getByRole('button', { name: 'alice', exact: true }).isVisible(), true, 'a failed sign-out changes nothing');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Logout).length, 0);
    await context.close(); console.log('PASS browser: account v1 HTTP login uses only cookie; a failed sign-out is reported and changes nothing');
  }
  {
    const { context, page, fixture } = await scene(); fixture.mintUncertain = true;
    await openTokens(page); await mint(page, 'Private token metadata');
    await page.getByRole('button', { name: 'Refresh list and check', exact: true }).click();
    await tokenRow(page, 'Private token metadata').waitFor();
    fixture.mode = 'unauthorized'; fixture.restart();
    await page.locator('main[data-account-auth]').waitFor();
    assert.equal(await page.locator('[data-account-outlet]').count(), 0, 'forbidden token metadata must not remain visible after auth denial');
    assert.equal(await page.getByText('Private token metadata', { exact: true }).count(), 0);
    await context.close(); console.log('PASS browser: auth denial also hides token-recovery metadata');
  }
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
