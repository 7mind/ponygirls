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
const browser = await chromium.launch({ headless: true }), errors = [];
async function scene(configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.on('pageerror', error => errors.push(error.message));
  if (configure !== undefined) configure(fixture);
  await page.clock.install();
  await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/live-archive.html`);
  await page.locator('.archive-row').first().waitFor();
  return { context, page, fixture };
}
const archiveCalls = fixture => fixture.calls.filter(call => call.operation instanceof api.Operation_Archive);
async function until(predicate, message) { for (let index = 0; index < 100; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(message); }
async function run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); console.log(`PASS browser live Archive: ${name}`); }
try {
  await run('typing applies the complete original expression without Search', async () => {
    const { context, page, fixture } = await scene();
    const before = archiveCalls(fixture).length;
    await page.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('mode:lexical migration');
    await until(() => archiveCalls(fixture).length > before, 'Typing did not apply the Archive expression without Search.');
    const applied = archiveCalls(fixture).slice(before);
    assert.equal(applied.length, 1); assert.equal(applied[0].operation.query.expression, 'mode:lexical migration');
    assert.equal(applied[0].operation.query.cursor, undefined); assert.equal(applied[0].operation.query.limit, 50);
    await page.waitForTimeout(500); assert.equal(archiveCalls(fixture).length, before + 1, 'Unchanged draft must not apply twice.');
    await context.close();
  });
  await run('debounce uses the latest complete draft and Enter or clear cannot double-submit', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = archiveCalls(fixture).length;
    await input.fill('mode:lexical a'); await page.clock.runFor(200);
    await input.fill('mode:lexical ab'); await page.clock.runFor(349); assert.equal(archiveCalls(fixture).length, before);
    await page.clock.runFor(1); await until(() => archiveCalls(fixture).length === before + 1, 'Latest debounced draft did not execute.');
    assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, 'mode:lexical ab');
    await input.fill('mode:lexical enter'); await page.clock.runFor(349); await input.press('Enter');
    await until(() => archiveCalls(fixture).length === before + 2, 'Enter did not flush the current draft.');
    await page.clock.runFor(500); assert.equal(archiveCalls(fixture).length, before + 2, 'Flushed timer submitted twice.');
    await input.fill('mode:lexical discarded'); await page.clock.runFor(349);
    await page.getByRole('button', { name: 'Clear Search conversations', exact: true }).click();
    assert.equal(await input.inputValue(), ''); await until(() => archiveCalls(fixture).length === before + 3, 'Clear did not immediately browse.');
    assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, '');
    await page.clock.runFor(500); assert.equal(archiveCalls(fixture).length, before + 3); assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await context.close();
  });
  await run('held work coalesces typing, sort and refresh into only the latest unsent read', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = archiveCalls(fixture).length;
    fixture.holdArchive = true;
    for (const text of ['mode:lexical a', 'mode:lexical b', 'mode:lexical c']) {
      await input.fill(text); await page.clock.runFor(350);
      await until(async () => await page.locator('.archive > p[role="status"]').count() === 0, 'Draft did not reach applied state.');
    }
    assert.equal(archiveCalls(fixture).length, before + 1, 'Typing sent an overlapping Archive read.');
    await page.getByRole('button', { name: 'Sort by Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).click();
    assert.equal(archiveCalls(fixture).length, before + 1, JSON.stringify({ failure: 'Sort or refresh bypassed the active read.', reads: archiveCalls(fixture).slice(before).map(call => call.operation.query.toJSON()), browserNow: await page.evaluate(() => Date.now()), alerts: await page.getByRole('alert').allTextContents() }));
    const row = fixture.archiveAt(0); fixture.archiveRows = [row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title: 'Latest applied query only' }) }) })];
    fixture.holdArchive = false; fixture.releaseArchive();
    await page.getByRole('button', { name: 'Latest applied query only', exact: true }).waitFor();
    await page.waitForTimeout(100);
    const reads = archiveCalls(fixture).slice(before);
    assert.deepEqual(reads.map(call => call.operation.query.expression), ['mode:lexical a', 'mode:lexical c']);
    assert.equal(reads[1].operation.query.sort, api.ArchiveSort.Title); assert.equal(reads[1].operation.query.cursor, undefined);
    await context.close();
  });
  await run('composition withholds automatic and explicit Search while clear stays immediate', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = archiveCalls(fixture).length;
    await input.dispatchEvent('compositionstart'); await input.fill('mode:lexical interim'); await page.clock.runFor(500); await input.press('Enter');
    const search = page.getByRole('button', { name: 'Search', exact: true });
    if (!await search.isDisabled()) await search.click();
    await page.waitForTimeout(50); assert.equal(archiveCalls(fixture).length, before, 'Interim composition was executed.');
    await input.dispatchEvent('compositionend'); await page.clock.runFor(350);
    await until(() => archiveCalls(fixture).length === before + 1, 'Completed composition did not execute.');
    await input.dispatchEvent('compositionstart'); await input.fill('mode:lexical unfinished');
    await page.getByRole('button', { name: 'Clear Search conversations', exact: true }).click();
    await until(() => archiveCalls(fixture).length === before + 2, 'Clear was blocked by composition.');
    assert.equal(await input.inputValue(), ''); assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, '');
    await context.close();
  });
  await run('published format warning is independent of current job state and never inferred', async () => {
    const { context, page, fixture } = await scene(fixture => {
      fixture.archiveRows = Array.from({ length: 5 }, (_, index) => {
        const row = fixture.archiveAt(index), publishedRevision = index === 0 || index === 3 ? row.head.revision : row.head.revision - 1;
        const publishedView = index === 4 ? undefined : new api.ContentView(publishedRevision, `00000000-0000-4000-8000-${String(52000 + index).padStart(12, '0')}`);
        const state = index === 0 || index === 3 ? api.JobState.Complete : index === 4 ? api.JobState.Queued : api.JobState.Failed;
        const job = new api.JobInfo(`00000000-0000-4000-8000-${String(61000 + index).padStart(12, '0')}`, row.head.id, row.head.revision, state, 1, state === api.JobState.Failed ? 'model-output' : undefined, 0, 1);
        return row.with({ head: row.head.with({ indexedRevision: publishedView === undefined ? undefined : publishedRevision }), publishedView, headJob: job, publishedFormat: index < 2 ? api.PassageFormat.LegacyAnnotations : index === 2 ? api.PassageFormat.ContiguousProblems : undefined });
      });
    });
    assert.equal(await page.locator('.legacy-index-warning').count(), 2, 'Explicit legacy publications need a visible table warning.');
    for (let index = 0; index < 5; index++) {
      const row = fixture.archiveRows[index], status = page.locator(`.archive-row[data-session-id="${row.head.id}"] td[data-column-id="Status"]`);
      assert.equal(await status.locator('.legacy-index-warning').count(), index < 2 ? 1 : 0);
      await status.getByText(row.headJob.state, { exact: true }).waitFor();
      if (index < 2) assert.match(await status.locator('.legacy-index-warning').getAttribute('title'), new RegExp(`Published r${row.publishedView.revision}.*legacy`, 'i'));
    }
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetPassages).length, 0, 'Rendering list provenance must not read source/passage pages.');
    await context.close();
  });
  await run('partial drafts retain authoritative errors and explicit Search sends original diagnostics without fallback', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = archiveCalls(fixture).length;
    for (const draft of ['project:', '"unfinished', 'cats OR', 'after:2026-10-27T12:30:', '"bad\\q" AND', '(cats']) {
      await input.fill(draft); await page.clock.runFor(500); assert.equal(archiveCalls(fixture).length, before, `Incomplete draft executed: ${draft}`);
    }
    fixture.archiveFailure = 'Synthetic original-expression validation';
    await input.fill('mystery:keep-original'); await page.clock.runFor(350); await page.getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).waitFor();
    assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, 'mystery:keep-original'); assert.equal(await page.locator('.archive-row').count(), 0);
    const incomplete = '"bad\\q" AND'; await input.fill(incomplete); await page.clock.runFor(500);
    assert.equal(archiveCalls(fixture).length, before + 1); assert.equal(await page.getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).count(), 1);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await until(() => archiveCalls(fixture).length === before + 2, 'Explicit partial draft did not reach server diagnostics.');
    assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, incomplete);
    await page.clock.runFor(500); assert.equal(archiveCalls(fixture).length, before + 2);
    fixture.archiveFailure = null; const completeDate = 'after:2026-10-27T12:30:45+05:30'; await input.fill(completeDate); await page.clock.runFor(350);
    await page.locator('.archive-row').first().waitFor(); assert.equal(archiveCalls(fixture).at(-1).operation.query.expression, completeDate);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'Synthetic original-expression validation' }).count(), 0);
    await context.close();
  });
  await run('tab remount and clear preserve the active permit and supersede only unsent reads', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = archiveCalls(fixture).length;
    fixture.holdArchive = true; await input.fill('mode:lexical held-a'); await input.press('Enter');
    await until(() => archiveCalls(fixture).length === before + 1, 'First held read did not start.');
    await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-job-row').first().waitFor();
    await page.getByRole('button', { name: 'archive', exact: true }).click(); await input.waitFor();
    await input.fill('mode:lexical queued-b'); await input.press('Enter'); await page.waitForTimeout(100);
    assert.equal(archiveCalls(fixture).length, before + 1, 'A tab remount released the unsettled request permit.');
    fixture.holdArchive = false; fixture.releaseArchive(); await page.locator('.archive-row').first().waitFor();
    assert.deepEqual(archiveCalls(fixture).slice(before).map(call => call.operation.query.expression), ['mode:lexical held-a', 'mode:lexical queued-b']);
    fixture.holdArchive = true; await input.fill('mode:lexical held-c'); await input.press('Enter');
    await until(() => archiveCalls(fixture).length === before + 3, 'Second held read did not start.');
    await input.fill('mode:lexical discarded-d'); await page.clock.runFor(350);
    await page.getByRole('button', { name: 'Clear Search conversations', exact: true }).click(); await page.clock.runFor(500);
    assert.equal(archiveCalls(fixture).length, before + 3, 'Clear bypassed active physical work.');
    fixture.holdArchive = false; fixture.releaseArchive(); await page.locator('.archive-row').first().waitFor();
    await until(() => archiveCalls(fixture).length === before + 4, 'The latest empty browse did not dispatch.');
    assert.deepEqual(archiveCalls(fixture).slice(before).map(call => call.operation.query.expression), ['mode:lexical held-a', 'mode:lexical queued-b', 'mode:lexical held-c', '']);
    await context.close();
  });
  await run('terminal authentication expiry clears an unsent draft before same-owner sign-in', async () => {
    const { context, page, fixture } = await scene();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 50));
    const expression = 'mode:lexical PRIVATE_SAME_OWNER_UNSENT_DRAFT';
    await page.getByRole('combobox', { name: 'Search conversations', exact: true }).fill(expression);
    fixture.mode = 'unauthorized'; await page.getByRole('button', { name: 'Refresh archive', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in →', exact: true }).waitFor();
    await page.getByLabel('Login', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    await page.locator('.archive-row').first().waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), '', 'A new session retained the old unsent private draft.');
    await page.clock.runFor(500); assert.equal(archiveCalls(fixture).filter(call => call.operation.query.expression === expression).length, 0, 'A prior-session draft was automatically replayed.');
    await context.close();
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
