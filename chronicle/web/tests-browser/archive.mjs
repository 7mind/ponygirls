// Archive view (redesign spec §3.1, unit UX-C2): one scenario script, runnable alone. Cases moved here from ux.mjs,
// live-archive.mjs, filter-table-ux.mjs, source-filters.mjs, run.mjs and refresh-regression.mjs, plus the fresh checks of
// spec §8 items 1–5, 7 and 9. Every scene pauses the page clock before loading: debounce, polling, hint and reconnect timers
// fire only when a case advances the clock, so "nothing was sent" is asserted after advancing it (reliability report §7).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
import { advanceClock, advanceClockUntil, connectionConfig, pauseClock, retryBudgetMillis } from './fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const origin = `http://127.0.0.1:${address.port}`, PAGE = 'tests-browser/goal50.html';
const browser = await chromium.launch({ headless: true }), errors = [];
const DESKTOP = { width: 1440, height: 900 }, WIDE = { width: 1280, height: 900 }, LAPTOP = { width: 1024, height: 700 }, PHONE = { width: 390, height: 844 };
// Application constants the cases depend on (Archive.tsx, ExpressionInput.tsx) and the shared token heights (tokens.css).
const PAGE_SIZE = 50, DEBOUNCE_MS = 350, REFRESH_MS = 20_000, HINT_DEBOUNCE_MS = 180, MASTHEAD_H = 48, VIEWBAR_H = 56;
const SCROLL_TOLERANCE = 2, MAX_APPENDS = 20, QUIESCE_TASKS = 20;

async function sceneAt(viewport, scheme, configure) {
  const context = await browser.newContext({ viewport, colorScheme: scheme }), page = await context.newPage(), fixture = new Goal50Fixture();
  page.on('pageerror', error => errors.push(error.message));
  // Spec §8 item 7: the view never opens a native dialog.
  await page.addInitScript(() => { for (const name of ['alert', 'confirm', 'prompt']) window[name] = () => { throw new Error(`native ${name}() called`); }; });
  // Completion hints stay unanswered unless a case asks for them: an open suggestion list takes Enter and Escape.
  fixture.holdHints = true;
  if (configure !== undefined) configure(fixture);
  await pauseClock(page); await fixture.install(page); await page.goto(`${origin}/${PAGE}#/archive`);
  await main(page).waitFor();
  return { context, page, fixture };
}
async function scene(configure) { const result = await sceneAt(DESKTOP, 'light', configure); await rows(result.page).first().waitFor(); await idle(result.page); return result; }
async function run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); console.log(`PASS browser Archive: ${name}`); }

const main = page => page.getByRole('main', { name: 'Archive', exact: true });
const table = page => main(page).getByRole('table', { name: 'Conversations', exact: true });
const rows = page => table(page).locator('tbody tr[data-row-id]');
const rowIds = page => rows(page).evaluateAll(items => items.map(item => item.dataset.rowId));
const idle = page => main(page).locator('table[data-list="archive"][aria-busy="false"]').waitFor();
const query = page => main(page).getByRole('combobox', { name: 'Search conversations', exact: true });
const button = (page, name) => main(page).getByRole('button', { name, exact: true });
const listState = (page, state) => main(page).locator(`[data-list-state="${state}"]`);
const counter = page => main(page).getByRole('status', { name: 'Archive status', exact: true });
const orderToggle = page => main(page).getByRole('group', { name: 'Result order', exact: true });
const relevance = page => orderToggle(page).getByRole('button', { name: 'Relevance', exact: true });
const pill = page => button(page, 'Updates available · show latest');
const navLink = (page, name) => page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name, exact: true });
const archiveQueries = fixture => fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).map(call => call.operation.query);
const headerSorts = page => table(page).locator('thead th').evaluateAll(items => Object.fromEntries(items.map(item => [item.dataset.columnId, item.getAttribute('aria-sort')])));
const columnHeaders = (sort, state) => Object.fromEntries(api.ArchiveSort_values.map(value => [value, value === sort ? state : null]));
function assertArchiveQuery(actual, expected, message) { assert.deepEqual({ expression: actual.expression, sort: actual.sort, direction: actual.direction, cursor: actual.cursor, preferRelevance: actual.preferRelevance }, { cursor: undefined, ...expected }, message); }
const BROWSE = { expression: '', sort: api.ArchiveSort.LastTimestamp, direction: api.SortDirection.Desc, preferRelevance: true };
// Lets the page run its queued tasks (renders, effects, socket sends) without advancing the paused clock.
async function quiesce(page) { await page.evaluate(rounds => new Promise(resolve => { const channel = new MessageChannel(); let left = rounds; channel.port1.onmessage = () => { if (--left === 0) resolve(); else channel.port2.postMessage(0); }; channel.port2.postMessage(0); }), QUIESCE_TASKS); }
async function submit(page, expression) { await query(page).fill(expression); await button(page, 'Search').click(); }
// Waits for the rendered first rows of a result, then compares them in full.
async function rowsRendered(page, expected) {
  await table(page).locator(`tbody tr:nth-child(1)[data-row-id="${expected[0]}"]`).waitFor();
  await table(page).locator(`tbody tr:nth-child(${expected.length})[data-row-id="${expected.at(-1)}"]`).waitFor();
  await idle(page);
  assert.deepEqual((await rowIds(page)).slice(0, expected.length), expected);
}
// Runs act(), waits for the first Archive read it causes and for that read's rendered rows.
async function archiveRead(page, fixture, act) {
  const before = archiveQueries(fixture).length; await act();
  await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'Archive read not sent');
  const sent = archiveQueries(fixture)[before]; await rowsRendered(page, fixture.archiveResult(sent).rows.map(row => row.head.id));
  return sent;
}
async function appendUntil(page, total) {
  for (let step = 0; step < MAX_APPENDS && await rows(page).count() < total; step++) {
    const before = await rows(page).count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await rows(page).nth(before).waitFor();
  }
  await idle(page);
  assert.equal(await rows(page).count(), total);
}
async function tableOptions(page) { await button(page, 'Conversations table options').click(); const menu = page.getByRole('menu', { name: 'Conversations table options', exact: true }); await menu.waitFor(); return menu; }
async function chooseTableOption(page, name) { const menu = await tableOptions(page); await menu.getByRole('menuitem', { name, exact: true }).click(); await menu.waitFor({ state: 'hidden' }); }
const scrollers = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => { const style = getComputedStyle(element); return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0; }).map(element => element.tagName));
const horizontalOverflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function signIn(page, login) {
  await page.getByLabel('Username', { exact: true }).fill(login); await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: login, exact: true }).waitFor();
}

try {
  await run('browse loads batches by document scroll, ends with a marker and orders every column on the server', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    assertArchiveQuery(archiveQueries(fixture)[0], BROWSE, 'the first read browses by last activity and prefers relevance for text');
    assert.ok(fixture.calls[0].operation instanceof api.Operation_Hello); assert.deepEqual(fixture.calls[0].operation.versions, [api.ClientEnvelope.BaboonDomainVersion]);
    await counter(page).filter({ hasText: /^180 conversations · 50 loaded$/ }).waitFor();
    await appendUntil(page, 180);
    assert.equal(new Set(await rowIds(page)).size, 180, 'appends add no duplicates');
    await listState(page, 'end').filter({ hasText: /^End of list · 180 conversations$/ }).waitFor();
    await counter(page).filter({ hasText: /^180 conversations · all loaded$/ }).waitFor();
    assert.ok(archiveQueries(fixture).every(sent => sent.limit === PAGE_SIZE));
    for (const name of [/^Result page/, /^Source span/, /Load more/]) assert.equal(await page.getByRole('button', { name }).count(), 0, `no ${name} control`);
    assert.ok(await table(page).getByText('Unscheduled', { exact: true }).count() > 0, 'raw-only HEADs remain browsable before indexing');
    await chooseTableOption(page, 'Show all columns'); assert.equal(await table(page).locator('thead th').count(), 11);
    assertArchiveQuery(await archiveRead(page, fixture, () => submit(page, 'original source')), { ...BROWSE, expression: 'original source' }, 'text queries request relevance by default');
    for (const [label, sort] of [['Last activity', api.ArchiveSort.LastTimestamp], ['Conversation', api.ArchiveSort.Title], ['User', api.ArchiveSort.Owner], ['Project', api.ArchiveSort.Project], ['Branch', api.ArchiveSort.Branch], ['Producer', api.ArchiveSort.Producer], ['Format', api.ArchiveSort.Format], ['Model', api.ArchiveSort.Model], ['Index status', api.ArchiveSort.Status], ['Messages', api.ArchiveSort.MessageCount], ['Tags', api.ArchiveSort.Tags]]) {
      const sent = await archiveRead(page, fixture, () => button(page, `Sort by ${label}`).click());
      assert.equal(sent.sort, sort); assert.equal(sent.cursor, undefined, `${label} restarts the chain`); assert.equal(sent.expression, 'original source');
    }
    await context.close();
  });

  await run('one document scroller, sticky view bar and header, no sideways overflow at 1440, 1024 and 390 in both themes', async () => {
    for (const [viewport, scheme] of [[DESKTOP, 'light'], [DESKTOP, 'dark'], [LAPTOP, 'light'], [PHONE, 'light'], [PHONE, 'dark']]) {
      const { context, page } = await sceneAt(viewport, scheme, fixture => { fixture.archiveRowCount = 120; fixture.holdHints = false; }); await rows(page).first().waitFor();
      await appendUntil(page, 2 * PAGE_SIZE);
      const where = `${viewport.width}px ${scheme}`;
      assert.deepEqual(await scrollers(page), [], `${where}: no inner vertical scroller`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), `${where}: the document scrolls`);
      assert.equal(await horizontalOverflow(page), false, `${where}: no sideways document overflow`);
      await page.evaluate(() => window.scrollTo(0, 1500));
      const geometry = await page.evaluate(() => {
        const masthead = document.querySelector('header').getBoundingClientRect(), viewbar = document.querySelector('form[role="search"]').parentElement.getBoundingClientRect();
        return { masthead: masthead.bottom, viewbar: viewbar.top, viewbarBottom: viewbar.bottom, header: document.querySelector('table[data-list="archive"] th').getBoundingClientRect().top };
      });
      assert.equal(geometry.masthead, MASTHEAD_H, `${where}: the masthead sticks`);
      if (viewport === PHONE) assert.equal(geometry.header, MASTHEAD_H, `${where}: the table header sticks under the masthead (the view bar wraps and scrolls away)`);
      else { assert.equal(geometry.viewbar, MASTHEAD_H, `${where}: the view bar sticks under the masthead`); assert.equal(geometry.header, MASTHEAD_H + VIEWBAR_H, `${where}: the table header sticks under the view bar`); }
      assert.equal(await table(page).locator('thead th').count(), viewport === PHONE ? 2 : 6, `${where}: the table stays a table`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await button(page, 'Add Tag filter').click(); assert.equal(await query(page).inputValue(), 'tag:');
      await advanceClock(page, HINT_DEBOUNCE_MS + 20); await main(page).getByRole('listbox').waitFor();
      assert.equal(await horizontalOverflow(page), false, `${where}: suggestions stay inside the viewport`);
      await query(page).press('Escape');
      await context.close();
    }
  });

  await run('a failed append keeps the loaded rows and offers Retry', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 120; });
    fixture.archiveFailure = 'Synthetic append failure';
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await listState(page, 'append-error').filter({ hasText: 'Synthetic append failure' }).waitFor();
    assert.equal(await rows(page).count(), PAGE_SIZE, 'the loaded rows stay'); assert.equal(await main(page).getByRole('alert').count(), 1);
    fixture.archiveFailure = null; await listState(page, 'append-error').getByRole('button', { name: 'Retry', exact: true }).click();
    await rows(page).nth(PAGE_SIZE).waitFor(); await idle(page);
    assert.equal(await rows(page).count(), 2 * PAGE_SIZE); assert.equal(await listState(page, 'append-error').count(), 0);
    await context.close();
  });

  await run('loaded rows, scroll and the originating row focus survive opening and closing a conversation, a tab round trip and an address without the query', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    await appendUntil(page, 3 * PAGE_SIZE);
    await page.evaluate(() => window.scrollTo(0, 2000)); await quiesce(page);
    const scrollY = await page.evaluate(() => window.scrollY), reads = archiveQueries(fixture).length;
    const opened = await rows(page).evaluateAll(items => items.find(item => item.getBoundingClientRect().top > 300).dataset.rowId), link = table(page).locator(`tr[data-row-id="${opened}"]`).getByRole('link');
    const dialog = page.getByRole('dialog', { name: 'Source conversation', exact: true });
    await link.click(); await dialog.waitFor(); assert.equal(await page.evaluate(() => location.hash), '#/archive', 'the source dialog keeps the list route');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); await quiesce(page);
    assert.equal(await rows(page).count(), 3 * PAGE_SIZE, 'closing keeps the loaded rows');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollY) <= SCROLL_TOLERANCE, 'closing restores the document scroll');
    assert.equal(await link.evaluate(element => element === document.activeElement), true, 'focus returns to the originating row');
    await navLink(page, 'Search').click(); await page.getByRole('main', { name: 'Search', exact: true }).waitFor();
    await navLink(page, 'Archive').click(); await main(page).waitFor(); await quiesce(page);
    assert.equal(await rows(page).count(), 3 * PAGE_SIZE, 'a tab round trip keeps the loaded rows');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - scrollY) <= SCROLL_TOLERANCE, 'a tab round trip restores the document scroll');
    assert.equal(await link.evaluate(element => element === document.activeElement), true, 'a tab round trip returns focus to the originating row');
    assert.equal(archiveQueries(fixture).length, reads, 'returning reads nothing again');
    // The settled chain of a query is kept per owner: an address back to the unfiltered list shows its rows while they are read again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await archiveRead(page, fixture, () => submit(page, 'project:"Project 1"'));
    fixture.holdArchive = true; const filtered = archiveQueries(fixture).length;
    await page.evaluate(() => { location.hash = '#/archive'; }); await table(page).locator(`tbody tr:nth-child(${3 * PAGE_SIZE})`).waitFor();
    await fixture.waitUntil(() => archiveQueries(fixture).length === filtered + 1, 'the restored chain was not revalidated'); await quiesce(page);
    assert.equal(await query(page).inputValue(), ''); assert.equal(await rows(page).count(), 3 * PAGE_SIZE, 'the restored rows are shown before their read returns');
    fixture.holdArchive = false; fixture.releaseArchive(); await fixture.waitUntil(() => archiveQueries(fixture).length === filtered + 3, 'the restored chain was not read again'); await idle(page);
    assert.equal(await rows(page).count(), 3 * PAGE_SIZE);
    await context.close();
  });

  await run('live refresh while scrolled announces arrivals with the pill, keeps rows, scroll, anchor and focus, and prunes revoked rows', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    await appendUntil(page, 3 * PAGE_SIZE);
    await page.evaluate(() => window.scrollTo(0, 3000)); await quiesce(page);
    const anchor = await page.evaluate(() => { const header = document.querySelector('table[data-list="archive"] th').getBoundingClientRect().bottom; const row = [...document.querySelectorAll('table[data-list="archive"] tbody tr[data-row-id]')].find(item => item.getBoundingClientRect().top >= header + 40); window.archiveProbe = { node: row, top: row.getBoundingClientRect().top, id: row.dataset.rowId }; row.querySelector('a').focus({ preventScroll: true }); return row.dataset.rowId; });
    const scrollY = await page.evaluate(() => window.scrollY), old = fixture.authorizedRows, first = old[0].head.id;
    const arrival = fixture.archiveAt(999).with({ lastTimestamp: '2026-10-27T00:00:00Z', head: fixture.archiveAt(999).head.with({ metadata: fixture.metadata.with({ title: 'New arrival awaiting explicit display' }) }) });
    async function refresh() { const before = archiveQueries(fixture).length; await button(page, 'Refresh archive').evaluate(element => element.click()); await fixture.waitUntil(() => archiveQueries(fixture).length >= before + 3, 'the loaded chain was not read again'); await idle(page); }
    fixture.archiveRows = [arrival, ...old]; await refresh(); await pill(page).waitFor();
    assert.equal(await table(page).getByRole('link', { name: 'New arrival awaiting explicit display', exact: true }).count(), 0, 'polling never inserts arrivals while reading');
    assert.equal(await rows(page).first().getAttribute('data-row-id'), first);
    assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'the announced change does not move the document');
    const revoked = old[4].head.id; fixture.archiveExcluded.add(revoked); await refresh();
    await table(page).locator(`tr[data-row-id="${revoked}"]`).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.archiveProbe.node === document.querySelector(`tr[data-row-id="${window.archiveProbe.id}"]`)), true, 'surviving rows keep their DOM nodes');
    assert.ok(await page.evaluate(() => Math.abs(window.archiveProbe.top - window.archiveProbe.node.getBoundingClientRect().top) <= 1), 'removing a row above keeps the visible anchor in place');
    assert.equal(await table(page).locator(`tr[data-row-id="${anchor}"] a`).evaluate(element => element === document.activeElement), true, 'focus stays on the surviving row');
    await pill(page).click(); await table(page).locator(`tbody tr:nth-child(1)[data-row-id="${arrival.head.id}"]`).waitFor();
    fixture.archiveExcluded.add(arrival.head.id); await refresh();
    if (await pill(page).count() > 0) await pill(page).click();
    await table(page).locator(`tr[data-row-id="${arrival.head.id}"]`).waitFor({ state: 'detached' });
    await context.close();
  });

  await run('a conversation opened from the list closes when an authorized refresh stops listing it', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 3; });
    const dialog = page.getByRole('dialog', { name: 'Source conversation', exact: true });
    const [opened] = await rowIds(page); await table(page).locator(`tr[data-row-id="${opened}"]`).getByRole('link').click(); await dialog.waitFor();
    fixture.archiveExcluded.add(opened); await button(page, 'Refresh archive').evaluate(element => element.click());
    await dialog.waitFor({ state: 'detached' }); await table(page).locator(`tr[data-row-id="${opened}"]`).waitFor({ state: 'detached' });
    await context.close();
  });

  await run('periodic refresh keeps rendered rows and removes a row the server stops authorizing', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 3; });
    const [kept, removed] = await rowIds(page), node = await table(page).locator(`tr[data-row-id="${kept}"]`).elementHandle();
    let reads = archiveQueries(fixture).length; await advanceClock(page, REFRESH_MS);
    await fixture.waitUntil(() => archiveQueries(fixture).length > reads, 'the periodic refresh did not run'); await idle(page);
    assert.equal(await node.evaluate(element => element.isConnected), true, 'an unchanged refresh keeps the row node');
    fixture.archiveExcluded.add(removed); reads = archiveQueries(fixture).length; await advanceClock(page, REFRESH_MS);
    await table(page).locator(`tr[data-row-id="${removed}"]`).waitFor({ state: 'detached' });
    assert.equal(await node.evaluate(element => element.isConnected), true); assert.ok(archiveQueries(fixture).length > reads);
    await context.close();
  });

  await run('a late cursor page of an old query never joins the rows of a new query', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    fixture.holdArchiveCursor = true; const before = archiveQueries(fixture).length;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'expected a held cursor read'); assert.equal(fixture.pendingArchive.length, 1);
    const replacement = fixture.archiveAt(0).with({ head: fixture.archiveAt(0).head.with({ metadata: fixture.metadata.with({ title: 'New query result only' }) }) });
    fixture.archiveRows = [replacement]; await submit(page, 'changed query'); fixture.releaseArchive();
    await table(page).getByRole('link', { name: 'New query result only', exact: true }).waitFor(); await idle(page); await quiesce(page);
    assert.equal(await rows(page).count(), 1); assert.equal(await table(page).getByText('Synthetic conversation 051', { exact: true }).count(), 0);
    await context.close();
  });

  await run('shortcuts compose the full Boolean draft, help explains the syntax and query errors never fall back', async () => {
    const { context, page, fixture } = await scene(undefined);
    await page.keyboard.press('Control+k'); assert.equal(await query(page).evaluate(element => element === document.activeElement), true, 'Ctrl K focuses the query');
    const project = button(page, 'Add Project filter'); assert.equal(await project.count(), 1, 'Project is an inline shortcut');
    await query(page).fill('(A OR B) mode:lexical'); let before = archiveQueries(fixture).length; await project.click();
    const draft = 'mode:lexical ((A OR B)) AND project:'; assert.equal(await query(page).inputValue(), draft);
    assert.equal(await query(page).evaluate(element => element === document.activeElement && element.selectionStart === element.value.length), true);
    await advanceClock(page, DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before, 'an inserted field neither searches nor waits to');
    const literal = JSON.stringify('猫🦄 branch" OR tag:escape\\path'); await submit(page, draft + literal);
    await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'Search was not sent'); assert.equal(archiveQueries(fixture).at(-1).expression, draft + literal);
    before = archiveQueries(fixture).length; await query(page).fill('A OR B mode:lexical'); await project.click();
    await main(page).getByRole('alert').filter({ hasText: 'outer AND directive' }).waitFor(); assert.equal(await query(page).inputValue(), 'A OR B mode:lexical', 'invalid mode placement is not repaired');
    await query(page).fill(''); assert.equal(await main(page).getByRole('alert').count(), 0, 'a shortcut error does not survive a changed draft');
    await button(page, 'Main agents').click(); assert.equal(await query(page).inputValue(), 'agent:"main"');
    await query(page).fill('project:"x" OR tag:"y"'); await button(page, 'Subagents').click(); assert.equal(await query(page).inputValue(), '(project:"x" OR tag:"y") AND agent:"subagent"');
    await query(page).fill(''); await button(page, 'More filter fields').click();
    const fields = page.getByRole('menu', { name: 'Insert a field', exact: true }); await fields.getByRole('menuitem', { name: 'Add Recorded yolo profile filter', exact: true }).click();
    assert.equal(await query(page).inputValue(), 'yolo-profile:');
    await button(page, 'Search syntax').click();
    const help = await page.locator('.expression-help-content:visible').innerText();
    for (const pattern of [/NOT text/, /literal substring/, /not proof/, /recorded subagent ID/, /yolo-profile:.*case-sensitive.*recorded source-root claim, not launch attestation/s]) assert.match(help, pattern);
    await page.keyboard.press('Escape');
    await archiveRead(page, fixture, () => submit(page, '(original source) mode:hybrid'));
    await counter(page).filter({ hasText: /^1 conversation · all loaded$/ }).waitFor();
    await button(page, 'Search syntax').click(); await page.getByText(/This result uses up to 1000 authorized published chunks per distinct text operand/).waitFor();
    assert.match(await page.locator('.expression-help-content:visible').textContent(), /not a row limit.*total is exact under those bounded candidate sets/);
    await page.keyboard.press('Escape');
    await archiveRead(page, fixture, () => submit(page, '(original source) mode:lexical'));
    await counter(page).filter({ hasText: /^1 conversation · all loaded$/ }).waitFor(); assert.equal(await page.getByText(/This result uses up to/).count(), 0, 'exact lexical totals carry no candidate-window note');
    for (const failure of ['Unknown field at character 1', 'Semantic model unavailable']) {
      fixture.archiveFailure = failure; await submit(page, failure === 'Semantic model unavailable' ? 'mode:semantic missing-model' : 'unknown:value');
      await main(page).getByRole('alert').filter({ hasText: failure }).waitFor(); assert.equal(await rows(page).count(), 0);
    }
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search).length, 0, 'the Archive never falls back to the old Search operation');
    await context.close();
  });

  await run('clear and Escape reset only the query, after suggestions close and outside IME composition', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.holdHints = false; });
    await query(page).fill('project:chronicle'); await button(page, 'Search').click(); await fixture.waitUntil(() => archiveQueries(fixture).at(-1).expression === 'project:chronicle', 'Search was not sent');
    const clear = button(page, 'Clear Search conversations'), before = archiveQueries(fixture).length; assert.equal(await clear.count(), 1);
    await clear.click(); await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'Clear did not browse');
    assert.equal(await query(page).inputValue(), ''); assert.equal(archiveQueries(fixture).at(-1).expression, ''); assert.equal(await query(page).evaluate(element => element === document.activeElement), true);
    await query(page).fill('previous query'); await button(page, 'Search').click(); await query(page).fill(''); await clear.click(); await query(page).pressSequentially('pr');
    assert.equal(await query(page).inputValue(), 'pr', 'clearing an empty draft leaves no caret command for later typing');
    await query(page).fill('p'); await advanceClock(page, HINT_DEBOUNCE_MS + 20); await main(page).getByRole('listbox').waitFor();
    const reads = archiveQueries(fixture).length; await query(page).press('Escape'); assert.equal(await query(page).inputValue(), 'p'); await quiesce(page); assert.equal(archiveQueries(fixture).length, reads);
    await query(page).press('Escape'); assert.equal(await query(page).inputValue(), '');
    await query(page).dispatchEvent('compositionstart'); await query(page).fill('猫'); await query(page).press('Escape'); assert.equal(await query(page).inputValue(), '猫'); await query(page).dispatchEvent('compositionend');
    await context.close();
  });

  await run('column choice, fit modes and resizing never read, survive refresh and reload, and pin Conversation when columns exceed the width', async () => {
    const tags = Array.from({ length: 16 }, (_, index) => `tag-${index}-猫🦄-<script>-` + 'long-value-'.repeat(8)), title = 'Literal 猫🦄 <script>not markup</script> '.repeat(80);
    const { context, page, fixture } = await sceneAt(WIDE, 'light', fixture => { fixture.archiveRows = [fixture.archiveAt(0), fixture.archiveAt(1)].map((row, index) => index === 0 ? row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title, tags }) }), tags }) : row); });
    await rows(page).first().waitFor(); await idle(page);
    assert.equal(await horizontalOverflow(page), false, 'the default columns fit');
    const preview = rows(page).first().locator('td[data-column-id="Title"] .row-tags');
    assert.equal(await preview.getAttribute('title'), tags.join(', ')); assert.equal(await table(page).locator('script').count(), 0, 'metadata is literal text');
    await preview.getByText('+13', { exact: true }).waitFor();
    const resizer = table(page).getByRole('separator', { name: 'Resize Conversation column', exact: true }), width = Number(await resizer.getAttribute('aria-valuenow')), reads = archiveQueries(fixture).length;
    await resizer.focus(); await resizer.press('ArrowRight'); assert.ok(Number(await resizer.getAttribute('aria-valuenow')) > width); 
    const box = await resizer.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 35, box.y + box.height / 2); await page.mouse.up();
    const resized = Number(await resizer.getAttribute('aria-valuenow')); await quiesce(page); assert.equal(archiveQueries(fixture).length, reads, 'resizing reads nothing');
    await button(page, 'Refresh archive').click(); await fixture.waitUntil(() => archiveQueries(fixture).length > reads, 'Refresh did not read'); await idle(page);
    assert.equal(Number(await resizer.getAttribute('aria-valuenow')), resized, 'a refresh keeps the resized width');
    await chooseTableOption(page, 'Show all columns'); assert.equal(await table(page).locator('thead th').count(), 11); assert.equal(await button(page, 'Sort by Tags').count(), 1);
    await chooseTableOption(page, 'Reset columns'); assert.equal(await table(page).locator('thead th').count(), 6);
    const menu = await tableOptions(page); await menu.getByRole('menuitemcheckbox', { name: 'Producer', exact: true }).click();
    assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Producer', exact: true }).getAttribute('aria-checked'), 'true', 'choosing a column keeps the menu open');
    assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Conversation', exact: true }).getAttribute('aria-disabled'), 'true'); await page.keyboard.press('Escape');
    assert.equal(await table(page).locator('thead th').count(), 7);
    await page.evaluate(() => document.fonts.load('13px Inter'));
    await chooseTableOption(page, 'Fit columns to content'); assert.ok(Number(await resizer.getAttribute('aria-valuenow')) >= width);
    const numbers = await rows(page).locator('td[data-column-id="MessageCount"]').evaluateAll(cells => cells.map(cell => ({ scroll: cell.scrollWidth, client: cell.clientWidth, numeric: getComputedStyle(cell).fontVariantNumeric })));
    for (const cell of numbers) assert.ok(cell.numeric === 'tabular-nums' && cell.scroll <= cell.client, `fitting honours tabular numerals: ${JSON.stringify(cell)}`);
    await chooseTableOption(page, 'Fit columns to width'); assert.equal(await horizontalOverflow(page), false);
    await page.reload(); await main(page).waitFor(); await rows(page).first().waitFor();
    assert.equal(await table(page).locator('thead th').count(), 7, 'the column choice is remembered per browser');
    await page.setViewportSize(LAPTOP); await chooseTableOption(page, 'Show all columns');
    assert.equal(await horizontalOverflow(page), true, 'more columns than fit scroll the document sideways');
    await page.evaluate(() => window.scrollTo(400, 0));
    assert.equal(await rows(page).first().locator('td[data-column-id="Title"]').evaluate(cell => Math.round(cell.getBoundingClientRect().left)), 0, 'the Conversation column stays pinned');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages || call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_GetPassages).length, 0);
    await context.close();
  });

  await run('the table options menu is keyboard operable, closes on Escape or focus elsewhere and reads nothing', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 3; });
    const trigger = button(page, 'Conversations table options'), menu = page.getByRole('menu', { name: 'Conversations table options', exact: true }), before = fixture.calls.length;
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await trigger.focus(); await trigger.press('Enter'); await menu.waitFor();
    assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Last activity', exact: true }).evaluate(element => element === document.activeElement), true, 'the first item takes focus');
    await page.keyboard.press('End'); assert.equal(await menu.getByRole('menuitem', { name: 'Reset columns', exact: true }).evaluate(element => element === document.activeElement), true);
    const producer = menu.getByRole('menuitemcheckbox', { name: 'Producer', exact: true }); await producer.focus(); await page.keyboard.press('Enter');
    assert.equal(await producer.getAttribute('aria-checked'), 'true'); assert.equal(await table(page).locator('thead th').count(), 7);
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the trigger');
    await trigger.click(); await menu.waitFor(); await query(page).focus(); await menu.waitFor({ state: 'hidden' });
    await quiesce(page); assert.equal(fixture.calls.slice(before).filter(call => !(call.operation instanceof api.Operation_Ping)).length, 0, 'presentation controls read nothing');
    await context.close();
  });

  await run('phone widths start with two columns and still offer every column with its server sort', async () => {
    const { context, page, fixture } = await sceneAt(PHONE, 'light', fixture => { fixture.archiveRowCount = 60; }); await rows(page).first().waitFor(); await idle(page);
    assert.equal(await table(page).locator('thead th').count(), 2); assert.equal(await horizontalOverflow(page), false);
    const menu = await tableOptions(page);
    for (const name of ['Producer', 'Index status']) await menu.getByRole('menuitemcheckbox', { name, exact: true }).click();
    await page.keyboard.press('Escape'); assert.equal(await table(page).locator('thead th').count(), 4);
    const sent = await archiveRead(page, fixture, () => button(page, 'Sort by Producer').click());
    assert.equal(sent.sort, api.ArchiveSort.Producer); assert.equal(sent.cursor, undefined);
    assert.equal(await table(page).locator(`th[data-column-id="${api.ArchiveSort.Producer}"]`).getAttribute('aria-sort'), 'ascending');
    await rows(page).first().locator(`td[data-column-id="${api.ArchiveSort.Producer}"]`).getByText(fixture.archiveResult(sent).rows[0].head.metadata.producer, { exact: true }).waitFor();
    await page.reload(); await main(page).waitFor(); await rows(page).first().waitFor();
    assert.equal(await table(page).locator('thead th').count(), 4, 'the phone column choice is remembered');
    await page.setViewportSize(DESKTOP); assert.equal(await table(page).locator('thead th').count(), 6, 'the wide column choice is separate');
    await context.close();
  });

  await run('empty and error states open the existing search syntax help and connection details', async () => {
    const { context, page, fixture } = await scene(undefined);
    fixture.archiveRows = []; await submit(page, 'project:"atlantis"'); await listState(page, 'empty').waitFor();
    assert.equal(await main(page).getByRole('button', { name: 'Search syntax', exact: true }).count(), 1, 'one Search syntax control');
    await listState(page, 'empty').getByRole('button', { name: 'Show search syntax', exact: true }).click();
    assert.match(await page.locator('.expression-help-content:visible').innerText(), /NOT text/); await page.keyboard.press('Escape');
    fixture.archiveFailure = 'Synthetic archive outage'; await button(page, 'Refresh archive').click();
    const notice = main(page).getByRole('alert').filter({ hasText: 'Synthetic archive outage' }); await notice.waitFor();
    await notice.getByRole('button', { name: 'Connection details', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connection details', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Connection details', exact: true }).waitFor({ state: 'hidden' });
    await context.close();
  });

  await run('text queries default to server relevance; the order toggle and headers follow the result flag', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; }); await chooseTableOption(page, 'Show all columns');
    assert.equal(await orderToggle(page).count(), 0, 'a browse has no order toggle'); assert.deepEqual(await headerSorts(page), columnHeaders(api.ArchiveSort.LastTimestamp, 'descending'));
    const text = await archiveRead(page, fixture, () => submit(page, 'original source'));
    assertArchiveQuery(text, { ...BROWSE, expression: 'original source' }, 'the remembered tuple and preference travel with the text');
    assert.equal(await relevance(page).getAttribute('aria-pressed'), 'true'); assert.deepEqual(await headerSorts(page), columnHeaders(undefined, null), 'relevance-ordered results claim no column order');
    assert.equal((await rowIds(page))[0], fixture.archiveAt(9).head.id, 'a higher-scored older conversation precedes newer rows');
    await appendUntil(page, 180);
    assert.deepEqual(await rowIds(page), fixture.archiveResult(text.with({ limit: 180 })).rows.map(row => row.head.id), 'relevance pages append in one server order');
    const pages = archiveQueries(fixture).filter(sent => sent.expression === 'original source');
    assert.ok(pages.filter(sent => sent.cursor !== undefined).length >= 3); assert.ok(pages.every(sent => sent.preferRelevance && sent.sort === api.ArchiveSort.LastTimestamp && sent.direction === api.SortDirection.Desc), 'cursor reads keep the first page binding');
    for (const expression of ['project:"chronicle"', 'NOT original', 'mode:lexical']) {
      assertArchiveQuery(await archiveRead(page, fixture, () => submit(page, expression)), { ...BROWSE, expression }, `${expression} sends the unchanged preference`);
      assert.deepEqual(await headerSorts(page), columnHeaders(api.ArchiveSort.LastTimestamp, 'descending'), `${expression} without positive text shows the column order`);
      assert.equal(await orderToggle(page).count(), 0, `${expression}: no toggle without text`);
    }
    assertArchiveQuery(await archiveRead(page, fixture, () => button(page, 'Clear Search conversations').click()), BROWSE);
    await context.close();
  });

  await run('a manual column order is kept across text, mode, refresh and paging until relevance is requested', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    await archiveRead(page, fixture, () => submit(page, 'original source'));
    for (const [label, sort, direction, state] of [['Last activity', api.ArchiveSort.LastTimestamp, api.SortDirection.Desc, 'descending'], ['Last activity', api.ArchiveSort.LastTimestamp, api.SortDirection.Asc, 'ascending'], ['Conversation', api.ArchiveSort.Title, api.SortDirection.Asc, 'ascending'], ['Conversation', api.ArchiveSort.Title, api.SortDirection.Desc, 'descending']]) {
      assertArchiveQuery(await archiveRead(page, fixture, () => button(page, `Sort by ${label}`).click()), { expression: 'original source', sort, direction, preferRelevance: false }, `${label} ${state} is one manual choice`);
      assert.equal(await table(page).locator(`th[data-column-id="${sort}"]`).getAttribute('aria-sort'), state);
      assert.equal(await relevance(page).getAttribute('aria-pressed'), 'false'); assert.equal(await orderToggle(page).getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true');
    }
    const manual = { sort: api.ArchiveSort.Title, direction: api.SortDirection.Desc, preferRelevance: false };
    for (const expression of ['migration thread', 'mode:lexical migration']) assertArchiveQuery(await archiveRead(page, fixture, () => submit(page, expression)), { ...manual, expression });
    assertArchiveQuery(await archiveRead(page, fixture, () => button(page, 'Refresh archive').click()), { ...manual, expression: 'mode:lexical migration' }, 'refresh keeps the manual order');
    await appendUntil(page, 180);
    assert.ok(archiveQueries(fixture).filter(sent => sent.cursor !== undefined && sent.expression === 'mode:lexical migration').every(sent => !sent.preferRelevance && sent.sort === api.ArchiveSort.Title && sent.direction === api.SortDirection.Desc));
    await page.evaluate(() => window.scrollTo(0, 0));
    assertArchiveQuery(await archiveRead(page, fixture, () => relevance(page).click()), { ...manual, expression: 'mode:lexical migration', preferRelevance: true }, 'requesting relevance keeps the stored column tuple');
    assert.deepEqual(await table(page).locator('thead th[aria-sort]').count(), 0); assert.equal(await relevance(page).getAttribute('aria-pressed'), 'true');
    const before = archiveQueries(fixture).length; await relevance(page).click(); await quiesce(page); assert.equal(archiveQueries(fixture).length, before, 'the active preference sends no read');
    assertArchiveQuery(await archiveRead(page, fixture, () => orderToggle(page).getByRole('button', { name: 'Conversation', exact: true }).click()), { ...manual, expression: 'mode:lexical migration' }, 'the column side of the toggle restores the manual order');
    await archiveRead(page, fixture, () => relevance(page).click());
    assertArchiveQuery(await archiveRead(page, fixture, () => submit(page, 'project:"chronicle"')), { ...manual, expression: 'project:"chronicle"', preferRelevance: true });
    assert.equal(await table(page).locator(`th[data-column-id="${api.ArchiveSort.Title}"]`).getAttribute('aria-sort'), 'descending', 'metadata-only results reveal the remembered column order');
    await context.close();
  });

  for (const transition of ['logout', 'expiry', 'owner']) await run(`a manual order survives a tab round trip and a same-owner reconnect; ${transition} restores relevance`, async () => {
    const { context, page, fixture } = await scene(undefined);
    await archiveRead(page, fixture, () => submit(page, 'original source'));
    const manual = { expression: 'original source', sort: api.ArchiveSort.Title, direction: api.SortDirection.Asc, preferRelevance: false };
    assertArchiveQuery(await archiveRead(page, fixture, () => button(page, 'Sort by Conversation').click()), manual);
    const beforeTabs = archiveQueries(fixture).length;
    await navLink(page, 'Activity').click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor(); await navLink(page, 'Archive').click(); await main(page).waitFor(); await quiesce(page);
    assert.equal(await table(page).locator(`th[data-column-id="${api.ArchiveSort.Title}"]`).getAttribute('aria-sort'), 'ascending'); assert.equal(archiveQueries(fixture).length, beforeTabs, 'a tab round trip keeps the loaded Archive');
    let boundary = archiveQueries(fixture).length; fixture.restart();
    await advanceClockUntil(page, () => archiveQueries(fixture).length > boundary, retryBudgetMillis(connectionConfig), 'no Archive read after the reconnect'); await idle(page);
    assertArchiveQuery(archiveQueries(fixture)[boundary], manual, 'a same-owner reconnect keeps the manual order');
    const nextUser = transition === 'owner' ? 'bob' : 'alice'; boundary = fixture.requests.length;
    if (transition === 'owner') { fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart(); await advanceClockUntil(page, async () => await page.getByRole('button', { name: 'bob', exact: true }).count() > 0, retryBudgetMillis(connectionConfig), 'the new owner was not shown'); }
    else {
      if (transition === 'logout') { await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click(); }
      else { fixture.mode = 'unauthorized'; await button(page, 'Refresh archive').click(); }
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); boundary = fixture.requests.length; await signIn(page, nextUser);
    }
    assert.equal(await navLink(page, 'Search').getAttribute('aria-current'), 'page', 'a new session starts at the default route');
    await navLink(page, 'Archive').click(); await rows(page).first().waitFor(); await idle(page);
    const reads = fixture.requests.slice(boundary).filter(request => request.userId === nextUser && request.envelope.operation instanceof api.Operation_Archive).map(request => request.envelope.operation.query);
    assert.ok(reads.length > 0); for (const sent of reads) assertArchiveQuery(sent, BROWSE, `${transition} resets every Archive intent before the next read`);
    assert.equal(await orderToggle(page).count(), 0);
    await context.close();
  });

  await run('an Archive frame without a boolean relevance flag stops the protocol and clears rows', async () => {
    const { context, page, fixture } = await scene(undefined);
    fixture.archiveRelevanceMissing = true; await button(page, 'Refresh archive').click();
    await page.locator('.connection-widget[data-state="protocol-error"]').waitFor();
    assert.equal(await rows(page).count(), 0, 'malformed Archive metadata cannot keep or render rows'); assert.equal(await orderToggle(page).count(), 0);
    await context.close();
  });

  await run('typing applies the complete original expression after the debounce, once', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    await query(page).fill('mode:lexical migration'); await advanceClock(page, DEBOUNCE_MS);
    await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'typing did not apply the expression');
    const applied = archiveQueries(fixture).slice(before); assert.equal(applied.length, 1);
    assert.equal(applied[0].expression, 'mode:lexical migration'); assert.equal(applied[0].cursor, undefined); assert.equal(applied[0].limit, PAGE_SIZE);
    await advanceClock(page, DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before + 1, 'an unchanged draft is not applied twice');
    await context.close();
  });

  await run('the debounce uses the latest complete draft and Enter or clear cannot submit twice', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    await query(page).fill('mode:lexical a'); await advanceClock(page, 200);
    await query(page).fill('mode:lexical ab'); await advanceClock(page, DEBOUNCE_MS - 1); await quiesce(page); assert.equal(archiveQueries(fixture).length, before);
    await advanceClock(page, 1); await fixture.waitUntil(() => archiveQueries(fixture).length === before + 1, 'the latest draft did not apply');
    assert.equal(archiveQueries(fixture).at(-1).expression, 'mode:lexical ab');
    await query(page).fill('mode:lexical enter'); await advanceClock(page, DEBOUNCE_MS - 1); await query(page).press('Enter');
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 2, 'Enter did not apply the draft');
    await advanceClock(page, DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before + 2, 'the flushed timer did not submit again');
    await query(page).fill('mode:lexical discarded'); await advanceClock(page, DEBOUNCE_MS - 1); await button(page, 'Clear Search conversations').click();
    assert.equal(await query(page).inputValue(), ''); await fixture.waitUntil(() => archiveQueries(fixture).length === before + 3, 'Clear did not browse at once');
    assert.equal(archiveQueries(fixture).at(-1).expression, '');
    await advanceClock(page, DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before + 3); assert.equal(await query(page).evaluate(element => element === document.activeElement), true);
    await context.close();
  });

  await run('held work coalesces typing, sort and refresh into only the latest unsent read', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    fixture.holdArchive = true;
    for (const text of ['mode:lexical a', 'mode:lexical b', 'mode:lexical c']) { await query(page).fill(text); await advanceClock(page, DEBOUNCE_MS); await counter(page).locator('[data-state="pending"]').waitFor({ state: 'detached' }); }
    await quiesce(page); assert.equal(archiveQueries(fixture).length, before + 1, 'typing sent an overlapping Archive read');
    await button(page, 'Sort by Conversation').click(); await button(page, 'Refresh archive').click(); await quiesce(page);
    assert.equal(archiveQueries(fixture).length, before + 1, 'sort or refresh bypassed the active read');
    const row = fixture.archiveAt(0); fixture.archiveRows = [row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title: 'Latest applied query only' }) }) })];
    fixture.holdArchive = false; fixture.releaseArchive();
    await table(page).getByRole('link', { name: 'Latest applied query only', exact: true }).waitFor(); await idle(page); await quiesce(page);
    const reads = archiveQueries(fixture).slice(before);
    assert.deepEqual(reads.map(sent => sent.expression), ['mode:lexical a', 'mode:lexical c']); assert.equal(reads[1].sort, api.ArchiveSort.Title); assert.equal(reads[1].cursor, undefined);
    await context.close();
  });

  await run('composition withholds automatic and explicit Search while clear stays immediate', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    await query(page).dispatchEvent('compositionstart'); await query(page).fill('mode:lexical interim'); await advanceClock(page, 2 * DEBOUNCE_MS); await query(page).press('Enter');
    assert.equal(await button(page, 'Search').isDisabled(), true, 'Search waits for the composition'); await quiesce(page); assert.equal(archiveQueries(fixture).length, before, 'an interim composition was executed');
    await query(page).dispatchEvent('compositionend'); await advanceClock(page, DEBOUNCE_MS);
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 1, 'the completed composition did not apply');
    await query(page).dispatchEvent('compositionstart'); await query(page).fill('mode:lexical unfinished'); await button(page, 'Clear Search conversations').click();
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 2, 'Clear was blocked by the composition');
    assert.equal(await query(page).inputValue(), ''); assert.equal(archiveQueries(fixture).at(-1).expression, '');
    await context.close();
  });

  await run('index status is the job state as dot and label, read from the list without source or passage reads', async () => {
    const states = [api.JobState.Complete, api.JobState.Failed, api.JobState.Failed, api.JobState.Complete, api.JobState.Queued];
    const { context, page, fixture } = await scene(fixture => {
      fixture.archiveRows = states.map((state, index) => {
        const row = fixture.archiveAt(index), publishedRevision = state === api.JobState.Complete ? row.head.revision : row.head.revision - 1;
        const publishedView = state === api.JobState.Queued ? undefined : new api.ContentView(publishedRevision, `00000000-0000-4000-8000-${String(52000 + index).padStart(12, '0')}`);
        const job = new api.JobInfo(`00000000-0000-4000-8000-${String(61000 + index).padStart(12, '0')}`, row.head.id, row.head.revision, state, 1, state === api.JobState.Failed ? 'model-output' : undefined, 0, 1, undefined);
        return row.with({ head: row.head.with({ indexedRevision: publishedView === undefined ? undefined : publishedRevision }), publishedView, headJob: job, publishedFormat: publishedView === undefined ? undefined : api.PassageFormat.ContextAwareProblems });
      });
    });
    for (const [index, state] of states.entries()) await table(page).locator(`tr[data-row-id="${fixture.archiveRows[index].head.id}"] td[data-column-id="Status"]`).getByText(state, { exact: true }).waitFor();
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetPassages).length, 0, 'list provenance reads no source or passage pages');
    await context.close();
  });

  await run('partial drafts keep authoritative errors; explicit Search sends the original expression without a fallback', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    for (const draft of ['project:', '"unfinished', 'cats OR', 'after:2026-10-27T12:30:', '"bad\\q" AND', '(cats']) { await query(page).fill(draft); await advanceClock(page, 2 * DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before, `incomplete draft executed: ${draft}`); }
    fixture.archiveFailure = 'Synthetic original-expression validation';
    await query(page).fill('mystery:keep-original'); await advanceClock(page, DEBOUNCE_MS); await main(page).getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).waitFor();
    assert.equal(archiveQueries(fixture).at(-1).expression, 'mystery:keep-original'); assert.equal(await rows(page).count(), 0);
    const incomplete = '"bad\\q" AND'; await query(page).fill(incomplete); await advanceClock(page, 2 * DEBOUNCE_MS); await quiesce(page);
    assert.equal(archiveQueries(fixture).length, before + 1); assert.equal(await main(page).getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).count(), 1);
    await button(page, 'Search').click(); await fixture.waitUntil(() => archiveQueries(fixture).length === before + 2, 'the explicit partial draft did not reach the server');
    assert.equal(archiveQueries(fixture).at(-1).expression, incomplete); await advanceClock(page, 2 * DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).length, before + 2);
    fixture.archiveFailure = null; const completeDate = 'after:2026-10-27T12:30:45+05:30'; await query(page).fill(completeDate); await advanceClock(page, DEBOUNCE_MS);
    await rows(page).first().waitFor(); assert.equal(archiveQueries(fixture).at(-1).expression, completeDate);
    assert.equal(await main(page).getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).count(), 0);
    await context.close();
  });

  await run('a tab round trip and clear keep the active request permit and supersede only unsent reads', async () => {
    const { context, page, fixture } = await scene(undefined), before = archiveQueries(fixture).length;
    fixture.holdArchive = true; await query(page).fill('mode:lexical held-a'); await query(page).press('Enter');
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 1, 'the first held read did not start');
    await navLink(page, 'Activity').click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    await navLink(page, 'Archive').click(); await main(page).waitFor();
    await query(page).fill('mode:lexical queued-b'); await query(page).press('Enter'); await quiesce(page);
    assert.equal(archiveQueries(fixture).length, before + 1, 'a tab round trip released the unsettled request permit');
    fixture.holdArchive = false; fixture.releaseArchive(); await fixture.waitUntil(() => archiveQueries(fixture).length === before + 2, 'the queued read did not dispatch'); await idle(page);
    assert.deepEqual(archiveQueries(fixture).slice(before).map(sent => sent.expression), ['mode:lexical held-a', 'mode:lexical queued-b']);
    fixture.holdArchive = true; await query(page).fill('mode:lexical held-c'); await query(page).press('Enter');
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 3, 'the second held read did not start');
    await query(page).fill('mode:lexical discarded-d'); await advanceClock(page, DEBOUNCE_MS - 1);
    await button(page, 'Clear Search conversations').click(); await advanceClock(page, DEBOUNCE_MS); await quiesce(page);
    assert.equal(archiveQueries(fixture).length, before + 3, 'clear bypassed the active read');
    fixture.holdArchive = false; fixture.releaseArchive();
    await fixture.waitUntil(() => archiveQueries(fixture).length === before + 4, 'the latest empty browse did not dispatch'); await idle(page);
    assert.deepEqual(archiveQueries(fixture).slice(before).map(sent => sent.expression), ['mode:lexical held-a', 'mode:lexical queued-b', 'mode:lexical held-c', '']);
    await context.close();
  });

  await run('terminal authentication expiry clears an unsent draft before the same owner signs in again', async () => {
    const { context, page, fixture } = await scene(undefined), expression = 'mode:lexical PRIVATE_SAME_OWNER_UNSENT_DRAFT';
    await query(page).fill(expression);
    fixture.mode = 'unauthorized'; await button(page, 'Refresh archive').click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await signIn(page, 'alice');
    await navLink(page, 'Archive').click(); await rows(page).first().waitFor();
    assert.equal(await query(page).inputValue(), '', 'a new session does not keep the old unsent private draft');
    await advanceClock(page, 2 * DEBOUNCE_MS); await quiesce(page); assert.equal(archiveQueries(fixture).filter(sent => sent.expression === expression).length, 0, 'a prior-session draft was replayed');
    await context.close();
  });

  await run('held relevance and column changes coalesce into the latest read and reject the old relevance cursor page', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    await archiveRead(page, fixture, async () => { await query(page).fill('mode:lexical migration'); await query(page).press('Enter'); });
    assert.equal(await relevance(page).getAttribute('aria-pressed'), 'true'); assert.equal(await table(page).locator('thead th[aria-sort]').count(), 0);
    fixture.holdArchiveCursor = true; const before = archiveQueries(fixture).length;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await fixture.waitUntil(() => archiveQueries(fixture).length > before, 'expected a held relevance cursor read'); assert.equal(fixture.pendingArchive.length, 1);
    await button(page, 'Sort by Conversation').click(); await relevance(page).click(); await button(page, 'Refresh archive').click(); await quiesce(page);
    assert.equal(archiveQueries(fixture).length, before + 1, 'sort, relevance or refresh sent an interim read while the cursor read held the permit');
    fixture.releaseArchive(); await fixture.waitUntil(() => archiveQueries(fixture).length === before + 2, 'the latest coalesced read did not dispatch');
    const [held, latest] = archiveQueries(fixture).slice(before);
    await rowsRendered(page, fixture.archiveResult(latest).rows.map(row => row.head.id));
    assert.notEqual(held.cursor, undefined); assert.equal(held.preferRelevance, true); assert.equal(held.sort, api.ArchiveSort.LastTimestamp); assert.equal(held.direction, api.SortDirection.Desc);
    assertArchiveQuery(latest, { expression: 'mode:lexical migration', sort: api.ArchiveSort.Title, direction: api.SortDirection.Asc, preferRelevance: true });
    assert.equal(await rows(page).count(), PAGE_SIZE, 'the superseded cursor page was not appended to the latest first page');
    assert.equal(await relevance(page).getAttribute('aria-pressed'), 'true');
    await context.close();
  });

  assert.deepEqual(errors, [], 'no uncaught browser application errors and no native dialogs');
} finally { await browser.close(); await server.close(); }
