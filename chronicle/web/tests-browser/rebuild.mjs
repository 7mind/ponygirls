// Behavioral-Active Blackbox / Good Communication. Retired indexed generations of a source conversation; the rebuild
// command and cohort cases moved to activity-maintenance.mjs. No workers, database or providers run.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use provisioned browsers; no downloads.');
class RebuildFixture extends Goal50Fixture {
  archiveRowCount = 3; contextZero = true; retiredType = null; holdRetired = false; retiredReplies = [];
  get publishedFormat() { return api.PassageFormat.ContextAwareProblems; }
  handle(operation, envelope, send, entry) {
    if (this.retiredType !== null && operation instanceof this.retiredType && operation.view !== undefined && operation.view.generationId !== undefined) { const reply = () => send(new api.Result_Error(new api.Failure('indexed-view-retired', 'This exact indexed generation has been retired.'))); if (this.holdRetired) this.retiredReplies.push(reply); else reply(); return true; }
    if (operation instanceof api.Operation_GetPassages) { const all = operation.view.generationId === undefined || this.contextZero ? [] : this.passages(operation.view); send(new api.Result_Passages(new api.PassagesResult(operation.view, operation.view.generationId === undefined ? api.PassageFormat.Unindexed : api.PassageFormat.ContextAwareProblems, all.slice(operation.offset, operation.offset + operation.limit), BigInt(all.length), operation.offset))); return true; }
    if (operation instanceof api.Operation_SearchSessionMessages) { const hits = this.messagesAt(operation.view.revision).flatMap((message, position) => message.text.toLowerCase().includes(operation.literal.toLowerCase()) ? [new api.MessageSearchHit(message.id, position)] : []); send(new api.Result_SessionMessageSearch(new api.SessionMessageSearchResult(operation.view, hits.slice(0, operation.limit), undefined))); return true; }
    return super.handle(operation, envelope, send, entry);
  }
}
const output = fileURLToPath(new URL('../test-results/rebuild/', import.meta.url)); await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen(); const browser = await chromium.launch({ headless: true }), results = [], errors = [];
async function scene(configure, width, theme) { const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new RebuildFixture(); page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); configure(fixture); await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor(); return { context, page, fixture }; }
async function source(s) { await s.page.locator('.archive-row .table-title').first().click(); }
async function group(name, body) { if (process.env.REBUILD_CASE !== undefined && !name.includes(process.env.REBUILD_CASE)) return; await body(); results.push(name); console.log(`PASS rebuild: ${name}`); }
try {
  await group('zero-problem context-aware publication is indexed, not legacy or unindexed', async () => { const s = await scene(() => {}, 1440, 'light'); await source(s); await s.page.getByText('No problems classified in this published context-aware generation.', { exact: true }).waitFor(); assert.equal(await s.page.getByText(/^Unindexed ·/).count(), 0); assert.equal(await s.page.locator('.legacy-index-warning').count(), 0); assert.equal(s.fixture.calls.some(c => c.operation instanceof api.Operation_GetChunks), false); await s.context.close(); });
  for (const Type of [api.Operation_SearchSessionMessages, api.Operation_LocateMessage, api.Operation_GetPassageSpans]) await group(`retirement focus recovery after ${Type.name} keeps keyboard navigation in the notice`, async () => {
    const s = await scene(f => { f.contextZero = false; f.passageMode = 'logical'; }, 1440, 'light');
    await source(s);
    const finder = s.page.getByRole('region', { name: 'Find in selected history', exact: true });
    if (Type === api.Operation_GetPassageSpans) {
      const passage = s.page.locator('.passage-list .passage').first(); await passage.waitFor(); s.fixture.retiredType = Type; await passage.focus(); await passage.press('Enter');
    } else {
      await finder.getByRole('textbox').fill('source');
      if (Type === api.Operation_SearchSessionMessages) s.fixture.retiredType = Type;
      await finder.getByRole('textbox').press('Enter');
      if (Type === api.Operation_LocateMessage) { const hit = finder.getByRole('button', { name: 'Message 1 · m1', exact: true }); await hit.waitFor(); s.fixture.retiredType = Type; await hit.focus(); await hit.press('Enter'); }
    }
    const notice = s.page.getByRole('region', { name: 'Indexed view unavailable', exact: true }); await notice.waitFor();
    const focus = await s.page.evaluate(() => ({ tag: document.activeElement.tagName, insideNotice: document.activeElement.closest('[aria-label="Indexed view unavailable"]') !== null }));
    assert.equal(focus.insideNotice, true, `Retired focused content needs an explicit focus destination: ${JSON.stringify(focus)}`);
    await s.page.keyboard.press('Tab');
    const archived = notice.getByRole('button', { name: 'View archived source r1', exact: true }); assert.equal(await archived.evaluate(button => button === document.activeElement), true);
    await archived.press('Enter'); await s.page.getByText('Viewing source r1', { exact: true }).waitFor(); await s.page.locator('.original-message').first().waitFor();
    await s.context.close();
  });
  await group('retirement focus recovery does not steal deliberate focus from a surviving control', async () => {
    const s = await scene(f => { f.contextZero = false; f.passageMode = 'logical'; f.holdRetired = true; }, 1440, 'light'); await source(s);
    const finder = s.page.getByRole('region', { name: 'Find in selected history', exact: true }); await finder.getByRole('textbox').fill('source'); s.fixture.retiredType = api.Operation_SearchSessionMessages; await finder.getByRole('textbox').press('Enter'); await s.fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    const close = s.page.getByRole('button', { name: 'Close conversation', exact: true }); await close.focus(); assert.equal(s.fixture.retiredReplies.length, 1); s.fixture.retiredReplies.shift()();
    await s.page.getByRole('region', { name: 'Indexed view unavailable', exact: true }).waitFor(); assert.equal(await close.evaluate(button => button === document.activeElement), true); await s.context.close();
  });
  for (const Type of [api.Operation_GetSession, api.Operation_GetPassages, api.Operation_GetMessages, api.Operation_SearchSessionMessages, api.Operation_LocateMessage, api.Operation_GetPassageSpans]) await group(`retired indexed pin from ${Type.name} clears old view and needs explicit same-revision source action`, async () => { const s = await scene(f => { f.contextZero = false; f.passageMode = 'logical'; }, 1440, 'light'); if (Type === api.Operation_GetSession || Type === api.Operation_GetPassages || Type === api.Operation_GetMessages) s.fixture.retiredType = Type; await source(s); if (Type === api.Operation_SearchSessionMessages || Type === api.Operation_LocateMessage) { const finder = s.page.getByRole('region', { name: 'Find in selected history', exact: true }); await finder.getByRole('textbox').fill('source'); if (Type === api.Operation_SearchSessionMessages) s.fixture.retiredType = Type; await finder.getByRole('button', { name: 'Find messages', exact: true }).click(); if (Type === api.Operation_LocateMessage) { await finder.getByRole('button', { name: 'Message 1 · m1', exact: true }).waitFor(); s.fixture.retiredType = Type; await finder.getByRole('button', { name: 'Message 1 · m1', exact: true }).click(); } } else if (Type === api.Operation_GetPassageSpans) { await s.page.locator('.passage-list .passage').first().waitFor(); s.fixture.retiredType = Type; await s.page.locator('.passage-list .passage').first().click(); }
    await s.page.getByText('This indexed view is unavailable because its derived generation was retired.', { exact: true }).waitFor(); assert.equal(await s.page.locator('.find-hits button').count(), 0); assert.equal(await s.page.locator('.original-message').count(), 0); assert.equal(s.fixture.calls.some(c => c.operation instanceof api.Operation_GetRaw), false); await s.page.getByRole('button', { name: 'View archived source r1', exact: true }).click(); await s.page.getByText('Viewing source r1', { exact: true }).waitFor(); await s.page.locator('.original-message').first().waitFor(); const last = s.fixture.calls.filter(c => c.operation instanceof api.Operation_GetMessages).at(-1).operation; assert.equal(last.view.revision, 1); assert.equal(last.view.generationId, undefined); await s.context.close(); });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2)); }
