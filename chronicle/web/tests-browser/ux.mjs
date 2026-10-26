import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const browser = await chromium.launch({ headless: true });
const errors = [];
async function scene(configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.on('pageerror', error => errors.push(error.message));
  if (configure) configure(fixture);
  await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`);
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-row').first().waitFor();
  return { context, page, fixture };
}
async function until(predicate, message) { for (let index = 0; index < 100; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(message); }
async function search(page, expression) { await page.getByRole('textbox', { name: 'Search conversations', exact: true }).fill(expression); await page.getByRole('button', { name: 'Search', exact: true }).click(); }
async function appendUntil(page, scroller, selector, total) {
  for (let index = 0; index < 20 && await page.locator(selector).count() < total; index++) {
    const before = await page.locator(selector).count(); await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await until(async () => await page.locator(selector).count() > before, `Infinite list did not append beyond ${before}`);
  }
  assert.equal(await page.locator(selector).count(), total);
}
async function run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); console.log(`PASS browser UX: ${name}`); }
try {
  // Specified: Behavioral-Active Blackbox / Good Communication, controlled synthetic WS corpus.
  await run('initial unindexed browse, 3+ pages and every global server sort', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    const first = fixture.calls.find(call => call.operation instanceof api.Operation_Archive).operation.query;
    assert.equal(first.expression, ''); assert.equal(first.sort, api.ArchiveSort.LastTimestamp); assert.equal(first.direction, api.SortDirection.Desc);
    assert.ok(fixture.calls[0].operation instanceof api.Operation_Hello); assert.deepEqual(fixture.calls[0].operation.versions, ['1.3.0']);
    assert.equal(await page.getByRole('heading', { level: 1 }).count(), 0); assert.equal(await page.getByRole('radio').count(), 0);
    await appendUntil(page, '.archive-table-scroll', '.archive-row', 180);
    assert.equal(new Set(await page.locator('.archive-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-session-id')))).size, 180);
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).every(call => call.operation.query.limit <= 100));
    assert.ok(await page.getByText('Not indexed', { exact: false }).count() > 0, 'raw-only HEADs are browsable before indexing');
    await search(page, 'original source'); await until(() => Promise.resolve(fixture.calls.some(call => call.operation instanceof api.Operation_Archive && call.operation.query.expression === 'original source')), 'Text query not sent');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).at(-1).operation.query.sort, api.ArchiveSort.LastTimestamp, 'text queries do not silently switch to relevance');
    const sorts = [['Last activity', api.ArchiveSort.LastTimestamp], ['Conversation', api.ArchiveSort.Title], ['User', api.ArchiveSort.Owner], ['Project', api.ArchiveSort.Project], ['Branch', api.ArchiveSort.Branch], ['Producer', api.ArchiveSort.Producer], ['Format', api.ArchiveSort.Format], ['Model', api.ArchiveSort.Model], ['Index status', api.ArchiveSort.Status], ['Messages', api.ArchiveSort.MessageCount], ['Tags', api.ArchiveSort.Tags]];
    for (const [label, sort] of sorts) {
      const before = fixture.calls.length; await page.getByRole('button', { name: `Sort by ${label}`, exact: true }).click();
      await until(() => Promise.resolve(fixture.calls.slice(before).some(call => call.operation instanceof api.Operation_Archive)), 'Sort query not sent');
      await page.locator('.archive-table[aria-busy="false"]').waitFor();
      const query = fixture.calls.slice(before).find(call => call.operation instanceof api.Operation_Archive).operation.query;
      assert.equal(query.sort, sort); assert.equal(query.cursor, undefined); assert.equal(query.expression, 'original source');
      const expected = fixture.archiveResult(query).rows.map(row => row.head.id), actual = await page.locator('.archive-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-session-id')));
      assert.deepEqual(actual, expected, `${label} is globally ordered by the server, not sorted within the prior page`);
      assert.equal(await page.locator('.archive-table-scroll').evaluate(element => element.scrollTop), 0, 'new sort resets the page chain and scroll origin');
    }
    await context.close();
  });
  await run('late old-cursor append cannot cross query/sort reset', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    fixture.holdArchiveCursor = true;
    await page.locator('.archive-table-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await until(() => Promise.resolve(fixture.pendingArchive.length > 0), 'Expected held cursor request');
    const replacement = fixture.archiveAt(0).with({ head: fixture.archiveAt(0).head.with({ metadata: fixture.metadata.with({ title: 'New query result only' }) }) });
    fixture.archiveRows = [replacement]; await search(page, 'changed query');
    await page.getByRole('button', { name: 'New query result only', exact: true }).waitFor();
    fixture.releaseArchive(); await page.waitForTimeout(100);
    assert.equal(await page.locator('.archive-row').count(), 1); assert.equal(await page.getByText('Synthetic conversation 051', { exact: true }).count(), 0);
    assert.equal(await page.locator('.archive-table-scroll').evaluate(element => element.scrollTop), 0);
    await context.close();
  });
  await run('mode-aware quick filters, compact help and query errors never silently fall back', async () => {
    const { context, page, fixture } = await scene();
    await page.keyboard.press('Control+k'); assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('textbox', { name: 'Search conversations' }).fill('(A OR B) mode : lexical');
    await page.locator('.quick-filters > summary').click(); await page.getByLabel('Attribute', { exact: true }).selectOption('project'); await page.getByLabel('Value', { exact: true }).fill('chronicle');
    await page.getByRole('button', { name: 'Apply filter', exact: true }).click();
    await until(() => Promise.resolve(fixture.calls.some(call => call.operation instanceof api.Operation_Archive && call.operation.query.expression === 'mode : lexical ((A OR B)) AND project:"chronicle"')), 'Quick filter did not conjoin the complete expression');
    const before = fixture.searchCount; await page.getByRole('textbox', { name: 'Search conversations' }).fill('A OR B mode:lexical'); await page.locator('.quick-filters > summary').click(); await page.getByLabel('Value', { exact: true }).fill('chronicle'); await page.getByRole('button', { name: 'Apply filter', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'outer AND directive' }).waitFor(); assert.equal(fixture.searchCount, before, 'invalid global mode placement is not quietly repaired');
    await page.locator('.quick-filters > summary').click(); await page.locator('.expression-help > summary').click();
    assert.match(await page.locator('.expression-help-content').innerText(), /NOT text/); assert.match(await page.locator('.expression-help-content').innerText(), /literal substring/); assert.match(await page.locator('.expression-help-content').innerText(), /not proof/);
    await page.locator('.expression-help > summary').click();
    fixture.archiveFailure = 'Unknown field at character 1'; await search(page, 'unknown:value'); await page.getByRole('alert').filter({ hasText: 'Unknown field at character 1' }).waitFor(); assert.equal(await page.locator('.archive-row').count(), 0);
    fixture.archiveFailure = 'Semantic model unavailable'; await search(page, 'mode:semantic missing-model'); await page.getByRole('alert').filter({ hasText: 'Semantic model unavailable' }).waitFor(); assert.equal(await page.locator('.archive-row').count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search).length, 0, 'new Archive never falls back to the old Search operation');
    await context.close();
  });
  await run('multi-page refresh prunes revoked IDs, preserves focus/anchor and stages arrivals without prepend', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.archiveRowCount = 180; });
    await appendUntil(page, '.archive-table-scroll', '.archive-row', 150);
    await page.locator('.archive-table-scroll').evaluate(element => { element.scrollTop = 1200; });
    const anchor = await page.evaluate(() => { const pane = document.querySelector('.archive-table-scroll'), bounds = pane.getBoundingClientRect(), row = [...pane.querySelectorAll('.archive-row')].find(item => item.getBoundingClientRect().top >= bounds.top + 40); window.tableProbe = { node: row, top: row.getBoundingClientRect().top, id: row.getAttribute('data-session-id') }; row.querySelector('button').focus({ preventScroll: true }); return window.tableProbe.id; });
    const old = fixture.authorizedRows, first = old[0].head.id, revoked = old[4].head.id;
    const arrival = fixture.archiveAt(999).with({ lastTimestamp: '2026-10-27T00:00:00Z', head: fixture.archiveAt(999).head.with({ metadata: fixture.metadata.with({ title: 'New arrival awaiting explicit display' }) }) });
    fixture.archiveRows = [arrival, ...old]; fixture.archiveExcluded.add(revoked);
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await page.getByRole('button', { name: 'Updates available · show latest', exact: true }).waitFor();
    assert.equal(await page.locator(`.archive-row[data-session-id="${revoked}"]`).count(), 0, 'successful list authorization shrink removes old IDs without waiting for an error');
    assert.equal(await page.getByRole('button', { name: 'New arrival awaiting explicit display', exact: true }).count(), 0, 'polling never prepends new arrivals while reading');
    assert.equal(await page.locator('.archive-row').first().getAttribute('data-session-id'), first);
    assert.equal(await page.evaluate(() => window.tableProbe.node === document.querySelector(`.archive-row[data-session-id="${window.tableProbe.id}"]`)), true);
    assert.equal(await page.locator(`.archive-row[data-session-id="${anchor}"] button`).evaluate(element => element === document.activeElement), true);
    assert.ok(await page.evaluate(() => Math.abs(window.tableProbe.top - window.tableProbe.node.getBoundingClientRect().top) <= 1), 'removal preserves the surviving visible row anchor');
    fixture.archiveExcluded.add(arrival.head.id); const beforeRefresh = fixture.searchCount; await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await until(() => Promise.resolve(fixture.searchCount >= beforeRefresh + 3), 'Latest authoritative loaded-chain refresh did not complete');
    await page.locator('.archive-table[aria-busy="false"]').waitFor();
    if (await page.getByRole('button', { name: 'Updates available · show latest', exact: true }).count() > 0) await page.getByRole('button', { name: 'Updates available · show latest', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'New arrival awaiting explicit display', exact: true }).count(), 0, 'applying the latest chain cannot resurrect a now-excluded staged arrival');
    await context.close();
  });
  await run('205 infinite passages, >10k direct locator, selection race cancellation and right-pane-only scroll', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.annotationCount = 205; fixture.messageCount = 12065; fixture.lateMessageId = 'm12065'; });
    await page.locator('.table-title').first().click(); await page.locator('#message-m1 pre').waitFor();
    fixture.holdLocators = true;
    await page.locator('.passage-list').getByRole('button', { name: /A passage on a later bounded source page/ }).click();
    await until(() => Promise.resolve(fixture.pendingLocators.length === 1), 'Expected held locator');
    await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
    fixture.releaseLocators(); await page.locator('#message-m1 mark').waitFor(); await page.waitForTimeout(100);
    assert.equal(await page.locator('#message-m1 mark').textContent(), '猫🦄'); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages && call.operation.offset >= 12000).length, 0, 'a newer already-loaded selection cancels an older remote locator');
    await appendUntil(page, '.conversation-passages', '.passage-list .passage', 205);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetChunks && call.operation.offset === 200 && call.operation.limit === 40));
    fixture.holdLocators = true; await page.locator('.passage-list').getByRole('button', { name: /Winning passage beyond the first hundred/ }).click();
    await until(() => Promise.resolve(fixture.pendingLocators.length === 1), 'Expected held direct locator');
    const before = await page.evaluate(() => ({ left: document.querySelector('.conversation-passages').scrollTop, window: scrollY, body: document.body.style.top }));
    fixture.releaseLocators(); await page.locator('#message-m12065 mark').waitFor(); await page.waitForTimeout(400);
    assert.equal(await page.locator('#message-m12065 mark').textContent(), 'Synthetic');
    const after = await page.evaluate(() => ({ left: document.querySelector('.conversation-passages').scrollTop, window: scrollY, body: document.body.style.top })); assert.deepEqual(after, before, 'passage navigation scrolls only the right pane, never the left pane or background document');
    const reads = fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).map(call => call.operation);
    assert.ok(reads.some(operation => operation.offset === 12040)); assert.ok(reads.length <= 6, 'locator navigation does not scan through earlier 10k messages'); assert.ok(reads.every(operation => operation.limit === 40 && operation.view.revision === 1 && operation.view.generationId === fixture.view.generationId));
    const initialMessages = await page.locator('.original-message').count(); await page.locator('.conversation-source').evaluate(element => { element.scrollTop = 0; }); await until(async () => await page.locator('.original-message').count() > initialMessages, 'Infinite earlier messages did not prepend');
    assert.equal(await page.getByRole('navigation', { name: /pages/i }).count(), 0, 'source and annotation lists have no manual paging controls');
    await context.close();
  });
  await run('owner collectors and Current/History jobs are infinite, lease-aware and prune successful scope changes', async () => {
    const currentFailedId = '00000000-0000-4000-8000-000000090001';
    const { context, page, fixture } = await scene(fixture => {
      const zero = new api.JobCounts(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);
      fixture.activityCollectors = Array.from({ length: 120 }, (_, index) => new api.ActivityCollector(`collector-${String(index).padStart(3, '0')}`, undefined, BigInt(index), 0n, zero, zero));
      const job = (id, revision, state, error) => new api.JobInfo(id, fixture.session.id, revision, state, 1, error, 0, undefined);
      const failed = new api.ActivityJob(job(currentFailedId, 2, api.JobState.Failed, 'Current failed work'), 'target-profile', api.ActivityJobClass.Current, undefined, false, true);
      const running = ['active', 'expired', 'unleased'].map((kind, index) => new api.ActivityJob(job(`00000000-0000-4000-8000-${String(90002 + index).padStart(12, '0')}`, 2, api.JobState.Running, undefined), 'target-profile', api.ActivityJobClass.Current, kind === 'unleased' ? undefined : kind === 'active' ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z', kind === 'active', false));
      const history = Array.from({ length: 58 }, (_, index) => new api.ActivityJob(job(`00000000-0000-4000-8000-${String(91000 + index).padStart(12, '0')}`, index % 3 === 1 ? 2 : 1, api.JobState.Failed, `Historical failure ${index + 1}`), index % 3 === 0 ? 'target-profile' : 'obsolete-profile', index % 3 === 0 ? api.ActivityJobClass.SupersededRevision : index % 3 === 1 ? api.ActivityJobClass.ObsoleteProfile : api.ActivityJobClass.SupersededRevisionAndProfile, undefined, false, false));
      fixture.activityJobs = [failed, ...running, ...history];
    });
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    const totals = page.getByRole('table', { name: 'All your current and historical indexing jobs', exact: true });
    await totals.waitFor();
    assert.deepEqual(await totals.locator('tbody tr').first().locator('td').allTextContents(), ['4', '0', '3', '1', '0']);
    assert.deepEqual(await totals.locator('tbody tr').nth(1).locator('td').allTextContents(), ['58', '0', '0', '58', '0']);
    assert.match(await page.locator('.activity-overview').innerText(), /1 active · 1 expired · 1 unleased/);
    await page.getByText('Active lease at snapshot', { exact: false }).waitFor(); await page.getByText('Expired lease at snapshot', { exact: false }).waitFor(); await page.getByText('Unleased · no lease expiry', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry job', exact: true }).count(), 1);
    assert.match(await page.locator('.activity-collector-card').first().innerText(), /No stored report · collection progress unknown/);
    await appendUntil(page, '.activity-collector-scroll', '.activity-collector-card', 120);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_Activity && call.operation.query.cursor === '100' && call.operation.query.limit === 50));
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === currentFailedId ? item.with({ classification: api.ActivityJobClass.SupersededRevision, retryable: false }) : item);
    await page.getByRole('button', { name: 'Refresh snapshots ↻', exact: true }).click();
    await page.locator(`.activity-job-row[data-scroll-anchor="${currentFailedId}"]`).waitFor({ state: 'detached' });
    assert.deepEqual(await totals.locator('tbody tr').first().locator('td').allTextContents(), ['3', '0', '3', '0', '0']);
    assert.equal(await page.getByRole('button', { name: 'Retry job', exact: true }).count(), 0, 'a job that became historical does not silently remain actionable in Current');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await appendUntil(page, '.activity-job-scroll', '.activity-job-row', 59);
    assert.equal(await page.getByRole('button', { name: 'Retry job', exact: true }).count(), 0, 'historical failures are retained for accounting, never presented as retryable current work');
    assert.match(await page.getByRole('region', { name: 'Historical indexing jobs', exact: true }).innerText(), /Obsolete profile/); assert.match(await page.getByRole('region', { name: 'Historical indexing jobs', exact: true }).innerText(), /Both: superseded revision/);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.scope === api.ActivityJobScope.Historical && call.operation.query.cursor === '50'));
    assert.equal(await page.getByRole('navigation', { name: /pages/i }).count(), 0);
    await context.close();
  });
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
