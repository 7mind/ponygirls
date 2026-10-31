// Specified: Behavioral-Active Blackbox / Good Communication, controlled UI protocol fixture.
// These exercise the production browser transport against a hand-written fixture, not backend ranking or SQL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { SearchFixture, api } from './search-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const output = fileURLToPath(new URL('../test-results/search-serp/', import.meta.url)); await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
async function scene(configure, width = 1440, theme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new SearchFixture();
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); if (configure) configure(fixture);
  await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`);
  await page.locator('.archive-row').first().waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'search', exact: true }).click();
  return { context, page, fixture };
}
const calls = (fixture, Type) => fixture.calls.filter(call => call.operation instanceof Type).map(call => call.operation);
const submit = page => page.getByRole('button', { name: 'Search published conversations', exact: true }).click();
async function ready(page) { await page.locator('.search-card .search-excerpt').first().waitFor(); }
async function group(name, body) { await body(); results.push(name); console.log(`PASS search SERP: ${name}`); }
try {
  await group('Archive default preserved; explicit query/mode/structured filters reset paging without Archive DSL', async () => {
    const { page, fixture, context } = await scene();
    assert.equal(calls(fixture, api.Operation_Search).length, 0);
    await page.keyboard.press('Control+k'); assert.equal(await page.getByLabel('Query', { exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByLabel('Query', { exact: true }).fill('project:literal OR source');
    await page.getByLabel('Search mode').selectOption('Lexical'); await page.getByLabel('Project', { exact: true }).fill('chronicle'); await page.getByLabel('Tag', { exact: true }).fill('architecture');
    await page.getByLabel('From date (UTC)', { exact: true }).fill('2026-10-01'); await page.getByLabel('Through date (UTC)', { exact: true }).fill('2026-10-23');
    assert.equal(calls(fixture, api.Operation_Search).length, 0); await submit(page); await ready(page);
    let query = calls(fixture, api.Operation_Search).at(-1).query;
    assert.equal(query.query, 'project:literal OR source'); assert.equal(query.mode, api.SearchMode.Lexical); assert.equal(query.limit, 10); assert.equal(query.offset, 0); assert.equal(query.filter.project, 'chronicle'); assert.deepEqual(query.filter.tags, ['architecture']); assert.equal(query.filter.after, '2026-10-01T00:00:00.000Z'); assert.equal(query.filter.before, '2026-10-23T23:59:59.999Z');
    assert.match(await page.locator('.search-count').textContent(), /23 exact matching conversations/);
    await page.getByRole('button', { name: 'Next results', exact: true }).click(); await page.getByRole('button', { name: 'Search conversation 11', exact: true }).waitFor(); assert.equal(calls(fixture, api.Operation_Search).at(-1).query.offset, 10);
    for (const [label, value] of [['Query', 'changed'], ['Project', 'other'], ['Tag', 'other-tag'], ['From date (UTC)', '2026-10-02'], ['Through date (UTC)', '2026-10-24']]) {
      await page.getByLabel(label, { exact: true }).fill(value); assert.equal(await page.locator('.search-card').count(), 0); await submit(page); await ready(page); assert.equal(calls(fixture, api.Operation_Search).at(-1).query.offset, 0);
    }
    for (const mode of ['Semantic', 'Hybrid']) {
      await page.getByLabel('Search mode').selectOption(mode); assert.equal(await page.locator('.search-card').count(), 0); await submit(page); await ready(page);
      assert.match(await page.locator('.search-count').textContent(), /12 conversations in the retrieved candidate window · not a corpus count · ranking limit 12 candidate chunks/);
      await page.getByRole('button', { name: 'Next results', exact: true }).click(); await page.getByRole('button', { name: 'Search conversation 11', exact: true }).waitFor(); assert.equal(await page.locator('.search-card').count(), 2); assert.equal(await page.getByRole('button', { name: 'Next results', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Previous results', exact: true }).click(); await ready(page);
    }
    assert.ok(calls(fixture, api.Operation_Search).every(operation => operation.query.mode === api.SearchMode.Lexical || operation.query.offset < 12));
    await page.getByRole('navigation').getByRole('button', { name: 'archive', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); assert.equal(await page.getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), '');
    await context.close();
  });
  await group('original exact spans, distinct roles and ranges, bounded same-pin continuation without whole-session reads', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0);
    const card = page.locator('.search-card').first(), excerpt = card.locator('.search-excerpt').first();
    assert.equal(await excerpt.locator('strong').textContent(), 'user'); assert.equal(await excerpt.locator('mark').textContent(), 'Exact 猫🦄 matched');
    assert.match(await card.textContent(), /Generated annotation: GENERATED summary not source/); assert.doesNotMatch(await card.textContent(), /POISON joined chunk text/);
    assert.equal(await card.locator('script').count(), 0); assert.match(await excerpt.locator('pre').textContent(), /<script>literal\(\)<\/script>/);
    let request = calls(fixture, api.Operation_ReadMessageContext)[0]; assert.deepEqual(request.anchor.toJSON(), fixture.hit.chunks[0].spans[0].toJSON()); assert.equal(request.afterBytes, 512); assert.equal(request.beforeBytes, 0);
    const firstText = await excerpt.locator('pre').textContent(), end = Buffer.byteLength(firstText);
    await card.getByRole('button', { name: 'Later context', exact: true }).click(); await page.waitForFunction(n => document.querySelector('.search-card .search-excerpt pre')?.textContent.length > n, firstText.length);
    request = calls(fixture, api.Operation_ReadMessageContext).at(-1); assert.equal(request.anchor.start, end); assert.equal(request.anchor.end, end); assert.equal(request.afterBytes, 2048); assert.equal(request.beforeBytes, 0);
    assert.equal(await card.locator('.search-excerpt pre').first().textContent(), Buffer.from(fixture.messagesAt(1)[64].text).subarray(end, end + 2048).toString()); assert.equal(await card.locator('mark').count(), 0, 'nearby continuation is not labeled matched source');
    await card.getByRole('button', { name: 'Next source span', exact: true }).click(); await card.locator('.search-excerpt strong').filter({ hasText: /^assistant$/ }).first().waitFor();
    assert.equal(await card.locator('.search-excerpt pre').first().textContent(), fixture.messagesAt(1)[65].text); assert.ok(await card.locator('.search-excerpt').count() > 1); assert.equal(await card.locator('.search-excerpt').first().locator('mark').textContent(), 'Separate ');
    assert.ok(calls(fixture, api.Operation_ReadMessageContext).every(operation => operation.view.revision === 1 && operation.view.generationId === fixture.view.generationId && operation.beforeBytes + operation.afterBytes <= 2048));
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0); await context.close();
  });
  await group('keyboard opens exact pinned late message, highlights UTF-8 span, focuses landing and restores opener', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    const title = page.getByRole('button', { name: 'Search conversation 1', exact: true }); await title.focus(); await page.keyboard.press('Enter');
    const message = page.locator('#message-m65[aria-current=location]'); await message.waitFor();
    assert.equal(await message.locator('mark').textContent(), 'Exact 猫🦄 matched'); assert.equal(await message.locator('details').evaluate(element => element.open), true); assert.match(await message.locator('pre').textContent(), /source r1/);
    await page.waitForFunction(() => document.activeElement?.classList.contains('find-landing'));
    assert.match(await page.getByRole('status', { name: 'Source navigation status', exact: true }).textContent(), /Search result: found matching message 65/);
    const locate = calls(fixture, api.Operation_LocateMessage).at(-1); assert.equal(locate.messageId, 'm65'); assert.equal(locate.view.revision, 1); assert.equal(locate.view.generationId, fixture.view.generationId);
    assert.ok(calls(fixture, api.Operation_GetMessages).some(operation => operation.offset === 40)); assert.ok(calls(fixture, api.Operation_GetMessages).every(operation => operation.view.revision === 1 && operation.limit === 40));
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); assert.equal(await title.evaluate(element => element === document.activeElement), true); await context.close();
  });
  await group('IME Enter and Search withhold execution until composition ends', async () => {
    const { page, fixture, context } = await scene(), input = page.getByLabel('Query', { exact: true });
    await input.dispatchEvent('compositionstart'); await input.fill('猫'); await input.press('Enter'); await submit(page); assert.equal(calls(fixture, api.Operation_Search).length, 0);
    await input.dispatchEvent('compositionend'); await input.press('Enter'); await ready(page); assert.equal(calls(fixture, api.Operation_Search).length, 1); await context.close();
  });
  await group('stale search and context replies cannot resurrect edited query or prior span', async () => {
    const { page, fixture, context } = await scene(f => { f.holdSearch = true; }); await submit(page); await fixture.waitCall(api.Operation_Search, 1);
    await page.getByLabel('Query', { exact: true }).fill('new query'); fixture.pendingSearch.shift()(); await page.clock.runFor(100); assert.equal(await page.locator('.search-card').count(), 0);
    fixture.holdSearch = false; fixture.holdContext = true; await submit(page); await fixture.waitCall(api.Operation_ReadMessageContext, 10);
    const card = page.locator('.search-card').first(); await card.getByRole('button', { name: 'Next source span', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, 11);
    const old = fixture.pendingContext.splice(0, 10); fixture.pendingContext.shift()(); await card.locator('.search-excerpt').first().waitFor(); old.forEach(reply => reply()); await page.clock.runFor(100);
    assert.equal(await card.locator('.search-excerpt pre').first().textContent(), fixture.messagesAt(1)[65].text); await context.close();
  });
  for (const failure of ['forbidden', 'indexed-view-retired', 'wrong-pin', 'wrong-session', 'wrong-anchor']) await group(`source ${failure} clears applicable excerpts without fallback`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    if (failure === 'wrong-pin') fixture.contextTransform = result => result.with({ view: fixture.viewAt(2) });
    else if (failure === 'wrong-session') fixture.contextTransform = result => result.with({ sessionId: '00000000-0000-4000-8000-000000099999' });
    else if (failure === 'wrong-anchor') fixture.contextTransform = result => result.with({ anchor: result.anchor.with({ start: 1 }) });
    else fixture.contextFailure = failure;
    const card = page.locator('.search-card').first(); await card.getByRole('button', { name: 'Later context', exact: true }).click(); await card.getByRole('alert').waitFor(); assert.equal(await card.locator('.search-excerpt').count(), 0); assert.equal(await card.getByRole('button', { name: 'Search conversation 1', exact: true }).isDisabled(), true);
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0); await context.close();
  });
  for (const failure of ['forbidden', 'indexed-view-retired']) await group(`conversation ${failure} invalidates earlier card excerpts`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page); fixture.conversationFailure = failure;
    await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Pinned conversation source access removed' }).waitFor();
    assert.equal(await page.locator('.search-excerpt').count(), 0, 'A newly denied or retired pinned source cannot remain cached in its background SERP card');
    await context.close();
  });
  await group('current context denial invalidates an already-open matching conversation', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    fixture.holdContext = true; fixture.contextFailure = 'forbidden';
    await page.locator('.search-card').first().getByRole('button', { name: 'Later context', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, 11);
    await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
    fixture.pendingContext.shift()(); await page.locator('.notice.error').filter({ hasText: 'Synthetic source unavailable' }).waitFor();
    console.log(`Context denial after modal opened: originalMessages=${await page.locator('.original-message').count()}`);
    assert.equal(await page.locator('.original-message').count(), 0, 'A current context denial for the exact same session/view must invalidate the matching open source conversation');
    await context.close();
  });
  await group('BOM scalars remain literal in valid Search snippets and pinned conversation highlighting', async () => {
    const failures = [];
    for (const [name, text, start, end] of [['leading BOM', '\uFEFFx', 0, 4], ['highlight segment BOM', 'a\uFEFFx', 1, 5], ['plain segment BOM', 'a\uFEFFx', 0, 1]]) {
      const { page, context } = await scene(fixture => {
        const messagesAt = fixture.messagesAt.bind(fixture);
        fixture.messagesAt = revision => messagesAt(revision).map(message => message.id === 'm65' ? message.with({ text }) : message);
        fixture.searchTransform = result => result.with({ hits: [result.hits[0].with({ chunks: [result.hits[0].chunks[0].with({ spans: [new api.Span('m65', start, end)] })] })] });
      });
      await submit(page); await page.waitForFunction(() => document.querySelector('.search-card .search-excerpt') !== null || document.querySelector('.search-card .notice.error') !== null);
      const card = page.locator('.search-card').first(), unavailable = await card.locator('.notice.error').count();
      const snippet = await card.locator('.search-excerpt pre').first().count() === 0 ? null : await card.locator('.search-excerpt pre').first().textContent();
      const expectedSnippet = Buffer.from(text).subarray(start).toString(), expectedMark = Buffer.from(text).subarray(start, end).toString(), mark = await card.locator('mark').count() === 0 ? null : await card.locator('mark').textContent();
      let body = null, bodyMark = null;
      if (await card.getByRole('button', { name: 'Search conversation 1', exact: true }).isEnabled()) {
        await card.getByRole('button', { name: 'Search conversation 1', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
        body = await page.locator('#message-m65 pre').textContent(); bodyMark = await page.locator('#message-m65 mark').textContent();
      }
      console.log(`BOM ${name}: ${JSON.stringify({ unavailable, snippet, mark, body, bodyMark })}`);
      if (unavailable !== 0 || snippet !== expectedSnippet || mark !== expectedMark || body !== text || bodyMark !== expectedMark) failures.push({ name, unavailable, snippet, mark, body, bodyMark, text, expectedSnippet, expectedMark });
      await context.close();
    }
    assert.deepEqual(failures, [], 'Valid BOM scalars must neither be rejected nor stripped from source, highlighted or plain segments');
  });
  await group('invalid source scalar endpoints fail closed at the context reply boundary', async () => {
    const failures = [];
    for (const [name, span] of [['full anchor', new api.Span('m1', 1, 2)], ['full anchor end', new api.Span('m1', 0, 1)], ['partial preview', new api.Span('m1', 1, 2050)], ['non-scalar excerpt', new api.Span('m1', 0, 1)]]) {
      const startErrors = errors.length;
      const { page, context } = await scene(fixture => {
        fixture.searchTransform = result => result.with({ hits: [result.hits[0].with({ chunks: [result.hits[0].chunks[0].with({ spans: [span] })] })] });
        fixture.contextTransform = result => result.with({ excerpts: [new api.ContextExcerpt(new api.PassageSourceSpan('m1', 0, 0, 4), 'user', name === 'non-scalar excerpt' ? '\ud800x' : '猫x')], previous: undefined, next: undefined });
      });
      await submit(page);
      const deadline = Date.now() + 10000;
      while (errors.length === startErrors && await page.locator('.search-card .notice.error').count() === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const pageErrors = errors.slice(startErrors), unavailable = await page.locator('.search-card .notice.error').count();
      console.log(`Malformed ${name}: pageErrors=${JSON.stringify(pageErrors)}, unavailable=${unavailable}`);
      if (pageErrors.length !== 0 || unavailable !== 1) failures.push({ name, pageErrors, unavailable });
      assert.equal(await page.locator('.search-excerpt').count(), 0); await context.close();
    }
    assert.deepEqual(failures, [], 'Invalid scalar boundaries must yield an explicit source-unavailable card, never an uncaught render exception');
  });
  await group('nested Find retirement and authority denial clear cached Search excerpts', async () => {
    const failures = [];
    for (const failure of ['indexed-view-retired', 'forbidden', 'not-found']) {
      const { page, fixture, context } = await scene(); await submit(page); await ready(page);
      await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
      fixture.findFailure = failure;
      await page.getByLabel('Literal message text', { exact: true }).fill('matched source'); await page.getByRole('button', { name: 'Find messages', exact: true }).click();
      await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
      await page.waitForFunction(() => [...document.querySelectorAll('[role=alert]')].some(element => element.textContent.includes('Nested Find source unavailable')) || document.querySelector('[aria-label="Indexed view unavailable"]') !== null);
      const retained = await page.locator('.search-excerpt').count();
      await page.keyboard.press('Escape');
      const afterEscape = await page.locator('.search-excerpt').count();
      console.log(`Nested Find ${failure}: retained=${retained}, afterEscape=${afterEscape}`);
      if (retained !== 0 || afterEscape !== 0) failures.push({ failure, retained, afterEscape });
      assert.equal(calls(fixture, api.Operation_GetSession).some(operation => operation.view === undefined), false, 'No HEAD fallback');
      await context.close();
    }
    assert.deepEqual(failures, [], 'Nested pinned-read unavailability must clear previously authorized Search excerpts, including after Escape');
  });
  for (const failure of ['indexed-view-retired', 'forbidden', 'not-found']) await group(`unmounted nested Find ${failure} cannot clear a newly opened source`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
    fixture.holdFind = true; fixture.findFailure = failure;
    await page.getByLabel('Literal message text', { exact: true }).fill('matched source'); await page.getByRole('button', { name: 'Find messages', exact: true }).click(); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Search conversation 2', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
    fixture.pendingFind.shift()(); await page.clock.runFor(100);
    assert.equal(await page.getByRole('dialog').count(), 1); assert.ok(await page.locator('.original-message').count() > 0); assert.equal(await page.locator('.search-card').count(), 10);
    assert.equal(await page.locator('.notice.error').filter({ hasText: 'Nested Find source unavailable' }).count(), 0);
    await context.close();
  });
  await group('another current source context denial cannot clear an unrelated pinned conversation', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    fixture.holdContext = true; fixture.contextFailure = 'forbidden';
    await page.locator('.search-card').nth(1).getByRole('button', { name: 'Later context', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, 11);
    await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click(); await page.locator('#message-m65[aria-current=location]').waitFor();
    fixture.pendingContext.shift()(); await page.locator('.search-card').nth(1).locator('.notice.error').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1); assert.ok(await page.locator('.original-message').count() > 0); assert.equal(await page.locator('.search-card').first().locator('.notice.error').count(), 0);
    await context.close();
  });
  await group('wrong-pin initial locator never lands or applies highlight', async () => {
    const { page, context } = await scene(fixture => { fixture.locatorWrongPin = true; }); await submit(page); await ready(page); await page.getByRole('button', { name: 'Search conversation 1', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Source revision or annotation generation changed' }).waitFor(); assert.equal(await page.locator('.original-message[aria-current=location]').count(), 0); assert.equal(await page.locator('.original-message mark').count(), 0); assert.equal(await page.locator('#message-m65').count(), 0); await context.close();
  });
  for (const change of ['disconnect', 'identity']) await group(`${change} clears source and fences pending replies`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page); fixture.holdContext = true;
    await page.locator('.search-card').first().getByRole('button', { name: 'Later context', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, 11);
    if (change === 'identity') fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read]);
    fixture.restart(); await page.clock.runFor(1000); await page.getByRole('navigation').waitFor(); fixture.pendingContext.splice(0).forEach(reply => reply()); await page.clock.runFor(100);
    assert.equal(await page.locator('.search-excerpt').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0); await context.close();
  });
  await group('oversized historical source span explicitly labels partial bounded preview', async () => {
    const { page, fixture, context } = await scene(f => { f.searchTransform = result => result.with({ hits: result.hits.slice(0, 1).map(hit => hit.with({ chunks: [hit.chunks[0].with({ spans: [new api.Span('m65', 0, 22000)] })] })) }); });
    await submit(page); await ready(page); assert.match(await page.locator('.search-card').textContent(), /Partial preview.*not the full match/); const request = calls(fixture, api.Operation_ReadMessageContext)[0]; assert.equal(request.anchor.start, request.anchor.end); assert.equal(Buffer.byteLength(await page.locator('.search-excerpt pre').textContent()), 512); await context.close();
  });
  for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) await group(`responsive ${width}px ${theme}`, async () => {
    const { page, context } = await scene(undefined, width, theme); await submit(page); await ready(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal document overflow');
    await page.screenshot({ path: `${output}/${width}-${theme}.png`, fullPage: true }); await context.close();
  });
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2)); console.log(`Search SERP browser: ${results.length} groups passed`);
} finally { await browser.close(); await server.close(); }
