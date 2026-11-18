// Shell and router (redesign spec §3.1 shell, §5, §8 items 4, 7, 9): fragment routes, masthead layout,
// in-app menus, no native dialogs and the shared account module in its degraded mode (five endpoints).
// Behavioral-Active Blackbox / Good Communication: real React app, scripted Chronicle server (SearchFixture).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { api } from './fixture.mjs';
import { SearchFixture } from './search-fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const NAV = ['Archive', 'Search', 'Activity', 'Access', 'MCP'];
const MASTHEAD_HEIGHT = 48, SCROLL_TOLERANCE = 2;
const SECRET = 'synthetic-secret-shown-once';
let cases = 0;

// The production transport deadlines: the short-deadline harness reconnects under host load, which clears views by design.
const PAGE = 'tests-browser/live-archive.html';
const ARCHIVE_PAGE = 50, LOADED_BATCHES = 3, SEARCH_TEXT = 'mode:semantic source';
async function scene(viewport, configure) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new SearchFixture(), errors = [], dialogs = [];
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  configure(fixture);
  await fixture.install(page);
  return { context, page, fixture, errors, dialogs };
}
async function run(name, viewport, configure, body) {
  if (process.env.CHRONICLE_SHELL_CASE !== undefined && !name.includes(process.env.CHRONICLE_SHELL_CASE)) return;
  const current = await scene(viewport, configure);
  try {
    await body(current);
    assert.deepEqual(current.errors, [], 'no page errors');
    assert.deepEqual(current.dialogs, [], 'no native dialogs (window.confirm/alert/prompt)');
  } finally { await current.context.close(); }
  cases++; console.log(`PASS shell: ${name}`);
}
const nav = page => page.getByRole('navigation', { name: 'Main navigation', exact: true });
const navLink = (page, name) => nav(page).getByRole('link', { name, exact: true });
const hash = page => page.evaluate(() => location.hash);
async function current(page) { return nav(page).locator('a[aria-current="page"]').allInnerTexts(); }
async function signedIn(page) { await navLink(page, 'Search').waitFor(); }
async function activityReady(page) { await page.getByRole('main', { name: 'Activity', exact: true }).waitFor(); await page.locator('.activity-job-row').first().waitFor(); }
async function userMenu(page, login) { await page.getByRole('button', { name: login, exact: true }).click(); return page.getByRole('menu', { name: login, exact: true }); }
const archiveRows = page => page.getByRole('table', { name: 'Conversations', exact: true }).locator('tbody tr');
const archiveReads = fixture => fixture.calls.filter(call => call.operation instanceof api.Operation_Archive);
const searchSummary = page => page.getByRole('main', { name: 'Search', exact: true }).locator('[data-view-bar] [role="status"]').filter({ hasText: /conversations · \d+ loaded/ });
async function loadArchiveRows(page, count) {
  await archiveRows(page).first().waitFor();
  while (await archiveRows(page).count() < count) {
    const before = await archiveRows(page).count();
    await page.getByRole('region', { name: 'Archive conversations', exact: true }).evaluate(element => element.scrollTo({ top: element.scrollHeight }));
    await page.waitForFunction(before => document.querySelectorAll('table[aria-label="Conversations"] tbody tr').length > before, before);
  }
}
const searchMain = page => page.getByRole('main', { name: 'Search', exact: true });
async function submitSearch(page, text) {
  await searchMain(page).getByRole('combobox', { name: 'Search conversations', exact: true }).fill(text);
  await searchMain(page).getByRole('button', { name: 'Search', exact: true }).click(); await searchSummary(page).waitFor();
}
function innerScrollers(page) {
  return page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => {
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
  }).map(element => element.tagName + (element.className ? `.${String(element.className).replace(/\s+/g, '.')}` : '')));
}

try {
  await run('routes: default Search, links push, Back restores route, draft and document scroll; reload and deep links', { width: 1440, height: 900 }, fixture => {
    fixture.activityJobs = Array.from({ length: 120 }, (_, index) => fixture.jobAt(index));
  }, async ({ page, fixture }) => {
    await page.goto(`${origin}/${PAGE}`); await signedIn(page);
    assert.equal(await hash(page), '#/search'); assert.deepEqual(await current(page), ['Search']);
    await navLink(page, 'Archive').click(); await page.locator('.archive-row').first().waitFor();
    assert.equal(await hash(page), '#/archive');
    await page.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('project:"unsent draft" AND');
    await navLink(page, 'Activity').click(); await activityReady(page);
    assert.equal(await hash(page), '#/activity'); assert.deepEqual(await current(page), ['Activity']);
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    assert.ok(scrollable > 600, `Activity must scroll the document for this check (${scrollable})`);
    await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForFunction(() => scrollY === 600);
    await navLink(page, 'Access').click(); await page.getByRole('main', { name: 'Access management', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'a new route starts at the top');
    await page.goBack(); await activityReady(page);
    await page.waitForFunction(tolerance => Math.abs(scrollY - 600) <= tolerance, SCROLL_TOLERANCE);
    await page.goBack(); await page.locator('.archive-row').first().waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), 'project:"unsent draft" AND', 'the Archive draft survives the round trip');
    assert.deepEqual(await current(page), ['Archive']);
    await page.goBack(); await page.waitForFunction(() => location.hash === '#/search'); assert.deepEqual(await current(page), ['Search']);
    await page.goForward(); await page.locator('.archive-row').first().waitFor();
    await page.reload(); await page.locator('.archive-row').first().waitFor(); assert.deepEqual(await current(page), ['Archive'], 'reload restores the route');

    await page.goto(`${origin}/${PAGE}#/session/${fixture.archiveAt(0).head.id}`);
    const dialog = page.getByRole('dialog', { name: 'Source conversation', exact: true }); await dialog.waitFor(); await page.locator('.original-message').first().waitFor();
    await dialog.getByRole('button', { name: 'Close conversation', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    assert.equal(await hash(page), '#/archive', 'a deep-linked session closes to its parent list');
    await page.evaluate(id => { location.hash = `#/session/${id}`; }, fixture.archiveAt(0).head.id); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close conversation', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    assert.equal(await hash(page), '#/archive'); await page.goForward(); await dialog.waitFor();
    await page.goto(`${origin}/${PAGE}#/no-such-view`); await signedIn(page);
    assert.equal(await hash(page), '#/search', 'an unknown fragment is replaced by the default route');
  });

  await run('route state: three Archive batches, a submitted Search and document scroll survive nav-link and Back/Forward round trips', { width: 1440, height: 900 }, fixture => {
    fixture.archiveRowCount = 160; fixture.activityJobs = Array.from({ length: 120 }, (_, index) => fixture.jobAt(index));
  }, async ({ page, fixture }) => {
    await page.goto(`${origin}/${PAGE}#/archive`); await loadArchiveRows(page, ARCHIVE_PAGE * LOADED_BATCHES);
    const rows = await archiveRows(page).count(), reads = archiveReads(fixture).length;
    await navLink(page, 'Search').click(); await submitSearch(page, SEARCH_TEXT);
    const summary = await searchSummary(page).innerText();
    await navLink(page, 'Activity').click(); await activityReady(page);
    await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForFunction(() => scrollY === 600);
    await navLink(page, 'Access').click(); await page.getByRole('main', { name: 'Access management', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'a route shown for the first time starts at the top');
    await navLink(page, 'Activity').click(); await activityReady(page);
    await page.waitForFunction(tolerance => Math.abs(scrollY - 600) <= tolerance, SCROLL_TOLERANCE);
    await navLink(page, 'Archive').click(); await archiveRows(page).first().waitFor();
    assert.equal(await archiveRows(page).count(), rows, 'the loaded Archive batches survive a tab round trip');
    assert.equal(archiveReads(fixture).length, reads, 'returning to the Archive reads nothing again');
    await navLink(page, 'Search').click(); await searchSummary(page).waitFor();
    assert.equal(await searchSummary(page).innerText(), summary, 'the submitted Search and its results survive a tab round trip');
    assert.equal(await searchMain(page).getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), SEARCH_TEXT);
    for (let step = 0; step < 5; step++) await page.goBack();
    assert.equal(await hash(page), `#/search?q=${encodeURIComponent(SEARCH_TEXT).replaceAll('%20', '+')}`);
    await searchSummary(page).waitFor(); assert.equal(await searchSummary(page).innerText(), summary);
    await page.goBack(); await archiveRows(page).first().waitFor(); assert.equal(await archiveRows(page).count(), rows, 'Back keeps the loaded batches');
    await page.goForward(); await searchSummary(page).waitFor(); assert.equal(await searchSummary(page).innerText(), summary, 'Forward keeps the submitted Search');
    assert.equal(archiveReads(fixture).length, reads);
  });

  await run('route parameters: filtered and sorted deep links, reload after submitting, Back to unfiltered entries and clearing through the address restore query and order', { width: 1440, height: 900 }, fixture => { fixture.archiveRowCount = 30; }, async ({ page, fixture }) => {
    await page.goto(`${origin}/${PAGE}#/archive?q=${encodeURIComponent('project:"Project 1"')}&sort=Title&dir=Asc`);
    await archiveRows(page).first().waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), 'project:"Project 1"');
    assert.equal(await page.getByRole('columnheader', { name: /Conversation/ }).getAttribute('aria-sort'), 'ascending');
    const query = archiveReads(fixture).at(-1).operation.query;
    assert.deepEqual([query.expression, query.sort, query.direction, query.preferRelevance], ['project:"Project 1"', api.ArchiveSort.Title, api.SortDirection.Asc, true]);
    await page.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('branch:"branch-2"');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'branch:"branch-2"');
    await page.getByRole('button', { name: 'Sort by Last activity', exact: true }).click();
    await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('sort') === null);
    const submitted = await hash(page);
    await page.reload(); await archiveRows(page).first().waitFor();
    assert.equal(await hash(page), submitted, 'reload keeps the fragment');
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), 'branch:"branch-2"', 'reload restores the submitted query');
    const reloaded = archiveReads(fixture).at(-1).operation.query;
    assert.deepEqual([reloaded.expression, reloaded.sort, reloaded.direction, reloaded.preferRelevance], ['branch:"branch-2"', api.ArchiveSort.LastTimestamp, api.SortDirection.Desc, false]);
    await page.goto(`${origin}/${PAGE}#/search?q=${encodeURIComponent(SEARCH_TEXT)}`);
    await searchSummary(page).waitFor();
    assert.equal(await searchMain(page).getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), SEARCH_TEXT, 'a Search deep link submits its query');
    await submitSearch(page, 'mode:semantic migration'); await page.reload(); await searchSummary(page).waitFor();
    assert.equal(await searchMain(page).getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), 'mode:semantic migration', 'reload restores the submitted Search');

    // Addresses that arrive through history or an edit are authoritative, also with default (empty) parameters.
    const archiveQuery = value => page.waitForFunction(value => document.querySelector('[data-view="archive"] input[role="combobox"]')?.value === value, value);
    const lastArchive = () => { const query = archiveReads(fixture).at(-1).operation.query; return [query.expression, query.sort, query.direction, query.preferRelevance]; };
    const defaults = ['', api.ArchiveSort.LastTimestamp, api.SortDirection.Desc, true];
    await page.goto(`${origin}/${PAGE}#/archive`); await archiveRows(page).first().waitFor();
    await navLink(page, 'Search').click(); await searchMain(page).waitFor(); await navLink(page, 'Archive').click();
    const archiveMain = page.getByRole('main', { name: 'Archive', exact: true }); await archiveMain.waitFor();
    await archiveMain.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('branch:"branch-3"'); await archiveMain.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'branch:"branch-3"');
    await page.goBack(); await page.goBack(); await page.waitForFunction(() => location.hash === '#/archive');
    await archiveQuery(''); await page.waitForFunction(() => document.querySelector('table[aria-label="Conversations"]')?.getAttribute('aria-busy') === 'false');
    assert.deepEqual(lastArchive(), defaults, 'Back to an earlier unfiltered entry restores the unfiltered Archive');
    assert.equal(await hash(page), '#/archive', 'the earlier entry is not rewritten');
    await page.goForward(); await page.goForward(); await archiveQuery('branch:"branch-3"');
    assert.deepEqual(lastArchive(), ['branch:"branch-3"', api.ArchiveSort.LastTimestamp, api.SortDirection.Desc, true], 'Forward restores the filter');
    await page.evaluate(() => { location.hash = '#/archive?q='; }); await archiveQuery('');
    await page.waitForFunction(() => document.querySelector('table[aria-label="Conversations"]')?.getAttribute('aria-busy') === 'false');
    assert.deepEqual(lastArchive(), defaults, 'clearing the query in the address clears the filter');
  });

  for (const [width, height, theme] of [[1440, 900, 'light'], [1024, 700, 'dark'], [390, 844, 'light']]) {
    await run(`masthead ${width}×${height} ${theme}: one row, sticky, menus operable, no overflow`, { width, height }, fixture => { fixture.archiveRowCount = 60; }, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${origin}/${PAGE}#/access`); await page.getByRole('main', { name: 'Access management', exact: true }).waitFor();
      const masthead = page.getByRole('banner');
      assert.equal(Math.round((await masthead.boundingBox()).height), MASTHEAD_HEIGHT);
      for (const name of NAV) { const link = navLink(page, name); await link.scrollIntoViewIfNeeded(); assert.ok(await link.isVisible(), `${name} is reachable`); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal document overflow');
      assert.deepEqual(await innerScrollers(page), [], 'the document is the only vertical scroller');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(Math.round((await masthead.boundingBox()).y), 0, 'the masthead sticks to the top');

      const trigger = page.getByRole('button', { name: 'alice', exact: true }), menu = await userMenu(page, 'alice');
      for (const item of ['Account settings', 'Access tokens', 'Sign out']) await menu.getByRole('menuitem', { name: item, exact: true }).waitFor();
      const box = await menu.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width, `the user menu stays in the viewport: ${JSON.stringify(box)}`);
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the trigger');

      await page.getByRole('button', { name: 'Theme settings', exact: true }).click();
      await page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Light' : 'Dark', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme === 'dark' ? 'light' : 'dark');

      await page.getByRole('button', { name: 'Connection: Live', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Connection details', exact: true }); await panel.waitFor();
      const details = await panel.boundingBox(); assert.ok(details.x >= 0 && details.x + details.width <= width, `connection details stay in the viewport: ${JSON.stringify(details)}`);
      await page.mouse.click(5, height - 5); await panel.waitFor({ state: 'hidden' });
    });
  }

  await run('account degraded mode: sign in, Access tokens, mint, secret survives blur, acknowledge, revoke, sign out', { width: 1440, height: 900 }, fixture => { fixture.signedIn = false; }, async ({ page, fixture }) => {
    await page.goto(`${origin}/${PAGE}#/activity`);
    const auth = page.locator('main[data-account-auth]');
    await auth.getByRole('heading', { name: /^Sign in/ }).waitFor();
    await auth.getByLabel('Username', { exact: true }).fill('alice'); await auth.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
    await activityReady(page); assert.equal(await hash(page), '#/activity', 'signing in keeps the requested route');

    const menu = await userMenu(page, 'alice'); await menu.getByRole('menuitem', { name: 'Access tokens', exact: true }).click();
    await page.getByRole('heading', { name: 'Access tokens', exact: true }).waitFor();
    assert.equal(await hash(page), '#account/tokens'); assert.deepEqual(await current(page), [], 'no nav item is current on the account page');
    assert.doesNotMatch(await page.getByRole('navigation', { name: 'Account sections', exact: true }).innerText(), /null/, 'absent sections leave no placeholder text');
    const covered = page.locator('main[aria-label="Activity"]'); assert.equal(await covered.count(), 1); assert.equal(await covered.isHidden(), true, 'the account page covers the view, which stays mounted');
    await page.getByRole('button', { name: 'New token', exact: true }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('shell-check');
    await page.getByRole('button', { name: 'Create token', exact: true }).click();
    const secret = page.getByLabel('One-time token secret', { exact: true }); await secret.waitFor();
    assert.notEqual(await secret.inputValue(), SECRET, 'the secret is masked by default');
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('account:invalidate')); });
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    assert.equal(await secret.inputValue(), SECRET, 'the secret survives blur, focus and invalidation');
    await page.getByRole('button', { name: 'I have saved it', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, I have saved it', exact: true }).click(); await secret.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Revoke shell-check', exact: true }).click();
    await page.getByRole('dialog', { name: /Revoke/ }).getByRole('button', { name: 'Revoke token', exact: true }).click();
    await page.getByRole('button', { name: 'Revoke shell-check', exact: true }).waitFor({ state: 'detached' });
    assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/revoke')).length, 1);

    await page.goBack(); await activityReady(page); assert.deepEqual(await current(page), ['Activity']);
    const signOut = await userMenu(page, 'alice'); await signOut.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await auth.getByRole('heading', { name: /^Sign in/ }).waitFor();
    assert.equal(fixture.accountRequests.filter(request => request.path.endsWith('/logout')).length, 1);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Logout).length, 0, 'sign-out belongs to the account module');
    assert.equal(await page.locator('.activity-job-row').count(), 0, 'private content is gone after sign-out');
  });
  assert.ok(cases > 0, 'No shell cases selected');
  console.log(`PASS ${cases} shell cases`);
} finally { await browser.close(); await server.close(); }
