import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const browser = await chromium.launch({ headless: true });
const errors = [];
async function scene(configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.on('pageerror', error => errors.push(error.message));
  if (configure) configure(fixture);
  await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-row').first().waitFor();
  return { context, page, fixture };
}
async function until(predicate, message) { for (let index = 0; index < 100; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(message); }
async function appendUntil(page, scroller, selector, total) {
  for (let index = 0; index < 20 && await page.locator(selector).count() < total; index++) {
    const before = await page.locator(selector).count(); await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await until(async () => await page.locator(selector).count() > before, `Infinite list did not append beyond ${before}`);
  }
  assert.equal(await page.locator(selector).count(), total);
}
async function run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); console.log(`PASS browser UX: ${name}`); }
try {
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
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetPassages && call.operation.offset === 200 && call.operation.limit === 40));
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
  await run('late HEAD metadata cannot downgrade the pinned source view or explicit latest action', async () => {
    const { context, page, fixture } = await scene();
    const captured = fixture.archiveAt(0), originalArchive = fixture.archiveResult.bind(fixture);
    fixture.headRevision = 3;
    fixture.archiveResult = query => { const result = originalArchive(query); return result.with({ rows: result.rows.map(row => row.head.id === captured.head.id ? captured : row) }); };
    await page.locator('.table-title').first().click();
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    assert.equal(await page.getByText('HEAD r3 / index r1', { exact: true }).count(), 1, 'fresh GetSession HEAD wins over the older table row');
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).every(call => call.operation.view.revision === 1), 'learning a newer HEAD does not automatically navigate the immutable view');
    const before = fixture.searchCount;
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await until(() => Promise.resolve(fixture.searchCount > before), 'Expected table revalidation');
    await page.locator('.archive-table[aria-busy="false"]').waitFor();
    assert.equal(await page.getByText('HEAD r3 / index r1', { exact: true }).count(), 1, 'a revalidated older row cannot downgrade the fresh session HEAD');
    await page.getByRole('button', { name: 'View latest archived revision', exact: true }).click();
    await page.getByText('Viewing source r3', { exact: true }).waitFor();
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetSession && call.operation.view?.revision === 3 && call.operation.view.generationId === undefined), 'explicit latest action requests the actual current archive-only HEAD');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession && call.operation.view?.revision === 2).length, 0, 'the stale table revision is never used as latest');
    await context.close();
  });
  // Regression: an already-authorized GetSession snapshot can lag a later Archive HEAD without changing the immutable source pin.
  await run('newer Archive HEAD wins over a retained or late older GetSession snapshot without auto-pinning', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.headRevision = 3; fixture.sessionHeadSnapshot = 3; });
    await page.locator('.table-title').first().click();
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    await page.getByText('HEAD r3 / index r1', { exact: true }).waitFor();
    fixture.headRevision = 4; fixture.holdSessions = true; fixture.metadata = fixture.metadata.with({ title: 'Delayed HEAD r3 session snapshot' });
    const before = fixture.searchCount;
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await until(() => Promise.resolve(fixture.searchCount > before && fixture.pendingSessions.length === 1), 'Expected newer Archive and held older session revalidation');
    await page.locator('.archive-table[aria-busy="false"]').waitFor();
    assert.match(await page.locator('.provenance').innerText(), /HEAD r4 \/ index r1/, 'newer authorized Archive HEAD must outrank the retained GetSession HEAD r3');
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    fixture.releaseSessions();
    await page.locator('.conversation-intro h2').getByText('Delayed HEAD r3 session snapshot', { exact: true }).waitFor();
    assert.equal(await page.getByText('HEAD r4 / index r1', { exact: true }).count(), 1, 'late GetSession HEAD r3 cannot downgrade the known HEAD r4');
    fixture.headRevision = 2;
    const staleRefresh = fixture.searchCount;
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await until(() => Promise.resolve(fixture.searchCount > staleRefresh), 'Expected older Archive revalidation');
    await page.locator('.archive-table[aria-busy="false"]').waitFor();
    assert.match(await page.locator('.archive-row td[data-column-id="Title"]').first().getAttribute('title'), /HEAD r2/, 'the older authorized Archive HEAD r2 remains in full provenance, not the tag preview');
    assert.match(await page.locator('.provenance').innerText(), /HEAD r4 \/ index r1/, 'later older metadata from both sources cannot forget the highest authorized numeric HEAD r4');
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).every(call => call.operation.view.revision === 1), 'learning HEAD r4 never navigates the immutable source view');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession && call.operation.view?.revision === 4).length, 0);
    await page.getByRole('button', { name: 'View latest archived revision', exact: true }).click();
    await page.getByText('Viewing source r4', { exact: true }).waitFor();
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetSession && call.operation.view?.revision === 4 && call.operation.view.generationId === undefined), 'explicit Latest requests the highest known archive-only HEAD r4, never the retained snapshot r3');
    fixture.sessionHeadSnapshot = 2; fixture.restart();
    await page.getByText('HEAD r2 / index r1', { exact: true }).waitFor();
    assert.equal(await page.getByText('HEAD r4 / index r1', { exact: true }).count(), 0, 'new connection authorization cannot inherit the prior generation\'s high-water mark');
    fixture.mode = 'unauthorized'; fixture.restart();
    await page.locator('main[data-account-auth]').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'authorization invalidation removes the source modal and known HEAD');
    assert.equal(await page.locator('.provenance').count(), 0);
    await context.close();
  });
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
