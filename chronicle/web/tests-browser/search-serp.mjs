// Search view (redesign spec §3.1 Search, §8 checks 1–4, 7, 9): compact hits, expansion in place, infinite loading with an end
// marker, stale-while-editing, the authority fences of source reads and the session links. Behavioral-Active Blackbox / Good
// Communication: the real React app and production browser transport against a scripted Chronicle server (SearchFixture), not
// backend ranking or SQL. Every wait is for rendered state; page time moves only through the page clock.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { SearchFixture, api } from './search-fixture.mjs';
import { advanceClock, advanceClockUntil, retryBudgetMillis } from './fixture.mjs';
import { connectionConfig } from '../src/transport/types.ts';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`, PAGE = 'tests-browser/goal50.html';
const browser = await chromium.launch({ headless: true }), results = [], errors = [], dialogs = [];
const SEARCH_TEXT = 'mode:semantic source', FIRST_BATCH = 10, TOTAL_ROWS = 23, MASTHEAD_HEIGHT = 48, SCROLL_TOLERANCE = 2, SCROLLED_TO = 1500;
const TITLE = index => `Search conversation ${index}`;
async function scene(configure, { width = 1440, height = 1000, theme = 'light', text = SEARCH_TEXT } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme }), page = await context.newPage(), fixture = new SearchFixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  if (configure) configure(fixture);
  await page.clock.install(); await fixture.install(page); await page.goto(`${origin}/${PAGE}`);
  await searchMain(page).waitFor();
  if (text !== null) await input(page).fill(text);
  return { context, page, fixture };
}
const calls = (fixture, Type) => fixture.calls.filter(call => call.operation instanceof Type).map(call => call.operation);
const searchMain = page => page.getByRole('main', { name: 'Search', exact: true });
const input = page => searchMain(page).getByRole('combobox', { name: 'Search conversations', exact: true });
const submit = page => searchMain(page).getByRole('button', { name: 'Search', exact: true }).click();
const rows = page => page.locator('[data-row-id]');
const hits = scope => scope.locator('[data-hit="match"]');
const hitGroups = scope => scope.locator('[data-match-kind]');
const bar = page => page.locator('[data-view-bar]');
const link = (scope, name) => scope.getByRole('link', { name, exact: true });
async function ready(page) { await hits(page).first().waitFor(); }
async function barText(page, expected) {
  await page.waitForFunction(text => document.querySelector('[data-view-bar] [role="status"]')?.textContent === text, expected);
}
async function loadRows(page, count) {
  while (await rows(page).count() < count && await page.locator('[data-list-foot="end"]').count() === 0) {
    const before = await rows(page).count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(n => document.querySelectorAll('[data-row-id]').length > n || document.querySelector('[data-list-foot="end"]') !== null, before);
  }
}
const loadAll = page => loadRows(page, Number.POSITIVE_INFINITY);
const expand = row => row.getByRole('button', { name: 'Context', exact: true }).click();
const scrollers = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => {
  const style = getComputedStyle(element);
  return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
}).map(element => element.tagName));
const scrollAt = async (page, top) => { await page.evaluate(y => window.scrollTo(0, y), top); await page.waitForFunction(y => scrollY === y, top); };
function withSpan(result, span) {
  return result.with({ page: result.page.with({ rows: result.page.rows.slice(0, 1), total: 1n, nextCursor: undefined }), evidence: [result.evidence[0].with({ matches: [result.evidence[0].matches[0].with({ span })] })] });
}
function mixedPins(result) {
  return result.with({ evidence: result.evidence.map((evidence, index) => evidence.with({ matches: [evidence.matches[0], evidence.matches[1].with({ view: result.page.rows[index].head.view, kind: api.ArchiveMatchKind.Literal, operand: 'Separate', summary: undefined })] })) });
}
async function group(name, body) {
  if (process.env.CHRONICLE_SEARCH_CASE !== undefined && !name.includes(process.env.CHRONICLE_SEARCH_CASE)) return;
  await body(); results.push(name); console.log(`PASS search: ${name}`); }
try {
  await group('infinite loading appends cursor batches without duplicates, in server order, and ends with a marker; the query construction is explicit and unchanged', async () => {
    const { page, fixture, context } = await scene();
    assert.equal(await page.locator('[data-state="intro"]').count(), 1, 'first render explains Search');
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0);
    await submit(page); await ready(page);
    assert.equal(await rows(page).count(), FIRST_BATCH); await barText(page, `${TOTAL_ROWS} conversations · ${FIRST_BATCH} loaded`);
    await loadAll(page);
    const ids = await rows(page).evaluateAll(elements => elements.map(element => element.dataset.rowId)), titles = await rows(page).evaluateAll(elements => elements.map(element => element.querySelector('h2').textContent));
    assert.equal(ids.length, TOTAL_ROWS); assert.equal(new Set(ids).size, TOTAL_ROWS, 'no duplicates across appended pages');
    assert.deepEqual(titles, Array.from({ length: TOTAL_ROWS }, (_, index) => TITLE(index + 1)), 'server order is kept');
    await barText(page, `${TOTAL_ROWS} conversations · ${TOTAL_ROWS} loaded`);
    assert.equal(await page.locator('[data-list-foot="end"]').textContent(), `End of results · ${TOTAL_ROWS} conversations`);
    const queries = calls(fixture, api.Operation_ArchiveSearch).map(operation => operation.query);
    assert.deepEqual(queries.map(query => query.cursor), [undefined, '10', '20']);
    for (const query of queries) { assert.equal(query.expression, SEARCH_TEXT); assert.equal(query.limit, 10); assert.equal(query.sort, api.ArchiveSort.LastTimestamp); assert.equal(query.direction, api.SortDirection.Desc); assert.equal(query.preferRelevance, true); }
    assert.equal(await page.getByRole('button', { name: /Result page|Source span|Load more/ }).count(), 0, 'no numbered pages, no numbered spans, no load-more button');
    assert.equal(await page.getByRole('navigation', { name: /Result pages|Source spans/ }).count(), 0);
    await context.close();
  });
  await group('a failed append keeps the loaded rows and offers Retry; Retry continues from the same cursor', async () => {
    const { page, fixture, context } = await scene();
    await submit(page); await ready(page); fixture.archiveSearchFailure = 'unavailable';
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const notice = searchMain(page).getByRole('alert').filter({ hasText: 'Could not load more results' }); await notice.waitFor();
    assert.equal(await rows(page).count(), FIRST_BATCH); await barText(page, `${TOTAL_ROWS} conversations · ${FIRST_BATCH} loaded`);
    assert.equal(await page.locator('[data-list-foot="end"]').count(), 0);
    const attempts = calls(fixture, api.Operation_ArchiveSearch).length; await advanceClock(page, 5000);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, attempts, 'a failed append is not retried automatically');
    fixture.archiveSearchFailure = null; await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('[data-row-id]').length > count, FIRST_BATCH);
    assert.deepEqual(calls(fixture, api.Operation_ArchiveSearch).map(operation => operation.query.cursor).slice(0, 3), [undefined, '10', '10']);
    await loadAll(page); assert.equal(await rows(page).count(), TOTAL_ROWS); await context.close();
  });
  await group('the document is the only vertical scroller; the view bar sticks under the masthead', async () => {
    const { page, context } = await scene();
    await submit(page); await ready(page); await loadAll(page);
    assert.deepEqual(await scrollers(page), [], 'no nested scroller');
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), true);
    await scrollAt(page, SCROLLED_TO);
    const masthead = await page.getByRole('banner').boundingBox(), viewBar = await bar(page).boundingBox();
    assert.equal(Math.round(masthead.height), MASTHEAD_HEIGHT);
    assert.equal(Math.round(viewBar.y), MASTHEAD_HEIGHT, 'the view bar sticks directly under the masthead');
    await context.close();
  });
  await group('loaded rows, scroll and the opener survive a session round trip and a tab round trip; reload restores the query', async () => {
    const { page, fixture, context } = await scene();
    await submit(page); await ready(page); await loadRows(page, 2 * FIRST_BATCH); await scrollAt(page, SCROLLED_TO);
    const reads = calls(fixture, api.Operation_ArchiveSearch).length;
    const opener = await page.evaluate(() => {
      const links = [...document.querySelectorAll('[data-focus-key^="open:"]')].filter(element => { const rect = element.getBoundingClientRect(); return rect.top > 200 && rect.bottom < innerHeight; });
      return { key: links[0].dataset.focusKey, id: links[0].closest('[data-row-id]').dataset.rowId };
    });
    await page.locator(`[data-focus-key="${opener.key}"]`).click();
    await page.waitForFunction(id => location.hash.startsWith(`#/session/${id}?`), opener.id);
    assert.match(await page.evaluate(() => location.hash), /\?at=m65&find=source&rev=\d+$/, 'Open at first match carries message, Find text and revision');
    await page.goBack(); await searchMain(page).waitFor();
    assert.equal(await rows(page).count(), 2 * FIRST_BATCH, 'the loaded batches survive');
    await page.waitForFunction(([top, tolerance]) => Math.abs(scrollY - top) <= tolerance, [SCROLLED_TO, SCROLL_TOLERANCE]);
    await page.waitForFunction(key => document.activeElement?.dataset.focusKey === key, opener.key);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, reads, 'returning reads nothing again');
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Search', exact: true }).click(); await searchMain(page).waitFor();
    assert.equal(await rows(page).count(), 2 * FIRST_BATCH); assert.equal(await input(page).inputValue(), SEARCH_TEXT);
    await page.waitForFunction(([top, tolerance]) => Math.abs(scrollY - top) <= tolerance, [SCROLLED_TO, SCROLL_TOLERANCE]);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, reads);
    await page.reload(); await searchMain(page).waitFor(); await ready(page);
    assert.equal(await input(page).inputValue(), SEARCH_TEXT); assert.equal(await rows(page).count(), FIRST_BATCH);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, reads + 1); assert.equal(calls(fixture, api.Operation_ArchiveSearch).at(-1).query.expression, SEARCH_TEXT);
    await context.close();
  });
  await group('shared full Archive expressions, mode directives and cursor batches remain explicitly submitted', async () => {
    const { page, fixture, context } = await scene();
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0);
    await page.keyboard.press('Control+k'); assert.equal(await input(page).evaluate(element => element === document.activeElement), true);
    const expression = 'mode:lexical (project:"chronicle" OR project:"other") AND NOT tag:"archived" AND branch:"feature/x" AND user:"alice" AND producer:"pi" AND format:Pi AND model:"model" AND agent:subagent AND yolo-profile:"work" AND status:failed AND after:"2026-10-01" AND before:"2026-10-24" AND "source"';
    fixture.archiveSearchScope = api.ArchiveTextScope.ExactLexical;
    await input(page).fill(expression); await page.clock.runFor(1000);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0); await submit(page); await ready(page);
    const query = calls(fixture, api.Operation_ArchiveSearch).at(-1).query;
    assert.equal(query.expression, expression); assert.equal(query.limit, 10); assert.equal(query.cursor, undefined); assert.equal(query.preferRelevance, true);
    await barText(page, `${TOTAL_ROWS} conversations · ${FIRST_BATCH} loaded`);
    await bar(page).getByRole('button', { name: 'How these results were found', exact: true }).click();
    const info = page.getByRole('dialog', { name: 'How these results were found', exact: true }); await info.getByText('exact lexical and metadata').waitFor();
    assert.equal(await info.getByText('Candidates', { exact: true }).count(), 0, 'exact lexical retrieval has no candidate bound'); await page.keyboard.press('Escape');
    await loadRows(page, 2 * FIRST_BATCH); assert.equal(calls(fixture, api.Operation_ArchiveSearch).at(-1).query.cursor, '10');
    for (const value of ['mode:lexical changed', '(tag:"architecture" OR tag:"migration") AND NOT producer:"codex"', 'after:"2026-10-02" before:"2026-10-25"']) {
      const before = calls(fixture, api.Operation_ArchiveSearch).length;
      await input(page).fill(value); await page.clock.runFor(1000); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, before);
      await submit(page); await ready(page); await barText(page, `${TOTAL_ROWS} conversations · ${FIRST_BATCH} loaded`);
      const last = calls(fixture, api.Operation_ArchiveSearch).at(-1).query; assert.equal(last.expression, value); assert.equal(last.cursor, undefined);
    }
    for (const mode of ['semantic', 'hybrid']) {
      fixture.archiveSearchScope = api.ArchiveTextScope.BoundedCandidateSets; fixture.archiveSearchCount = mode === 'semantic' ? 12 : 1003;
      await input(page).fill(`mode:${mode} source`); await submit(page); await ready(page);
      await barText(page, `${fixture.archiveSearchCount} conversations · ${FIRST_BATCH} loaded`);
      await bar(page).getByRole('button', { name: 'How these results were found', exact: true }).click();
      await page.getByText('Up to 1000 published chunks per text operand, not a row cap. Hybrid also includes exact lexical HEAD matches.').waitFor();
      await page.keyboard.press('Escape');
      if (mode === 'semantic') { await loadAll(page); assert.equal(await rows(page).count(), 12); assert.equal(await page.locator('[data-list-foot="end"]').textContent(), 'End of results · 12 conversations'); }
      else assert.equal(await page.locator('[data-list-foot="end"]').count(), 0, 'a long list is not at its end');
    }
    assert.equal(calls(fixture, api.Operation_Search).length, 0, 'The full DSL never falls back to the narrower MCP Search operation');
    await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    assert.equal(await page.getByRole('main', { name: 'Archive', exact: true }).getByRole('combobox', { name: 'Search conversations', exact: true }).inputValue(), '');
    await context.close();
  });
  await group('editing keeps the previous results dimmed and labelled until the query is submitted', async () => {
    const { page, fixture, context } = await scene();
    await submit(page); await ready(page); const list = page.locator('[data-list="results"]');
    assert.equal(await list.getAttribute('data-state'), 'current');
    await input(page).fill(`${SEARCH_TEXT} more`);
    await barText(page, 'Query edited · Enter to update'); assert.equal(await list.getAttribute('data-state'), 'stale'); assert.equal(await rows(page).count(), FIRST_BATCH);
    await page.clock.runFor(1000); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 1, 'typing alone submits nothing');
    await input(page).fill(SEARCH_TEXT); await barText(page, `${TOTAL_ROWS} conversations · ${FIRST_BATCH} loaded`); assert.equal(await list.getAttribute('data-state'), 'current');
    await input(page).fill(`${SEARCH_TEXT} more`); await input(page).press('Enter'); await page.waitForFunction(() => document.querySelector('[data-list="results"]')?.dataset.state === 'current');
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).at(-1).query.expression, `${SEARCH_TEXT} more`); await context.close();
  });
  await group('first render offers example queries that run when chosen', async () => {
    const { page, fixture, context } = await scene(undefined, { text: null });
    const example = 'tag:flaky after:2026-11-01'; await searchMain(page).getByRole('button', { name: example, exact: true }).click(); await ready(page);
    assert.equal(await input(page).inputValue(), example); assert.equal(calls(fixture, api.Operation_ArchiveSearch)[0].query.expression, example);
    assert.equal(await page.locator('[data-state="intro"]').count(), 0); await context.close();
  });
  await group('shared authorized completion accepts a mode directive into the draft without executing Search', async () => {
    const { page, fixture, context } = await scene(f => { f.hintResult = query => new api.ExpressionHintsResult('synthetic-server-hash', new Date().toISOString(), 0, query.expression.length, query.expression === 'mode:' ? [new api.ExpressionHint(api.ExpressionHintKind.Value, 'mode:lexical', 'mode:lexical ', 13)] : [], false); });
    await input(page).fill('mode:'); await page.clock.runFor(251); await page.getByRole('option', { name: /mode:lexical/ }).waitFor(); await input(page).press('Enter');
    assert.equal(await input(page).inputValue(), 'mode:lexical '); await page.clock.runFor(1000); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0);
    assert.ok(calls(fixture, api.Operation_ExpressionHints).every(operation => operation.query.target instanceof api.ExpressionHintTarget_Archive));
    await submit(page); await ready(page); assert.equal(calls(fixture, api.Operation_ArchiveSearch)[0].query.expression, 'mode:lexical '); await context.close();
  });
  await group('shared field shortcuts preserve global mode and grouped Boolean body; clear is an edit, not an implicit Search', async () => {
    const { page, fixture, context } = await scene();
    await input(page).fill('mode:semantic (A OR B)'); await page.getByRole('button', { name: 'Add Tag filter', exact: true }).click();
    assert.equal(await input(page).inputValue(), 'mode:semantic ((A OR B)) AND tag:'); await input(page).press('End'); await input(page).pressSequentially('"architecture"'); await page.clock.runFor(1000);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0); await submit(page); await ready(page);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch)[0].query.expression, 'mode:semantic ((A OR B)) AND tag:"architecture"');
    await page.getByRole('button', { name: 'Clear Search conversations', exact: true }).click(); await page.clock.runFor(1000);
    assert.equal(await input(page).inputValue(), ''); await barText(page, 'Query edited · Enter to update'); assert.equal(await rows(page).count(), FIRST_BATCH, 'the cleared query keeps its results, dimmed');
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 1); await context.close();
  });
  await group('metadata and negative criteria keep unindexed rows without fabricated snippets and link the explicit HEAD revision', async () => {
    const { page, fixture, context } = await scene(f => {
      f.archiveSearchScope = api.ArchiveTextScope.ExactLexical; f.archiveSearchRelevance = false;
      f.archiveSearchTransform = result => result.with({ page: result.page.with({ rows: result.page.rows.map(row => row.with({ head: row.head.with({ indexedRevision: undefined }), publishedView: undefined, matchedView: undefined })) }), evidence: result.evidence.map(evidence => evidence.with({ matches: [] })) });
    });
    await input(page).fill('project:"chronicle" AND NOT tag:"archived"'); await submit(page); await rows(page).first().waitFor();
    assert.equal(calls(fixture, api.Operation_ReadMessageContext).length, 0); assert.equal(await page.locator('[data-hit]').count(), 0);
    const first = rows(page).first(); assert.match(await first.textContent(), /not indexed.*No positive source spans/s);
    assert.equal(await first.getByRole('link', { name: 'Open at first match' }).count(), 0, 'nothing to open at without a match');
    assert.equal(await link(first, TITLE(1)).getAttribute('href'), `#/session/${fixture.session.id}?rev=${fixture.session.revision}`); await context.close();
  });
  await group('mixed HEAD literals and published semantic witnesses keep independent context reads and session links', async () => {
    const { page, fixture, context } = await scene(f => { f.archiveSearchTransform = mixedPins; });
    await submit(page); await ready(page);
    const first = rows(page).first();
    const literal = first.locator(`[data-match-kind="${api.ArchiveMatchKind.Literal}"]`), published = first.locator(`[data-match-kind="${api.ArchiveMatchKind.Semantic}"]`);
    await literal.locator('mark').first().waitFor(); assert.equal(await literal.locator('mark').first().textContent(), 'Separate ');
    const reads = calls(fixture, api.Operation_ReadMessageContext).filter(read => read.sessionId === fixture.session.id);
    assert.ok(reads.some(read => read.view.revision === fixture.session.revision && read.view.generationId === undefined), 'the literal witness is read at the HEAD pin');
    assert.ok(reads.some(read => read.view.revision === fixture.view.revision && read.view.generationId === fixture.view.generationId), 'the semantic witness is read at its published pin');
    assert.match(await hits(literal).getAttribute('href'), new RegExp(`\\?at=m66&find=Separate&rev=${fixture.session.revision}$`));
    assert.match(await hits(published).getAttribute('href'), new RegExp(`\\?at=m65&find=source&rev=${fixture.view.revision}$`))
    assert.notEqual(fixture.session.revision, fixture.view.revision); await context.close();
  });
  await group('expanded hits show the messages between non-adjacent matches', async () => {
    const { page, context } = await scene(f => { f.archiveSearchTransform = result => result.with({ evidence: result.evidence.map(evidence => evidence.with({ matches: [evidence.matches[0], evidence.matches[1].with({ span: new api.Span('m80', 0, 3) })] })) }); });
    await submit(page); await ready(page); const first = rows(page).first();
    assert.equal(await first.getByText(/messages between/).count(), 0, 'collapsed results show no gap'); await expand(first);
    await first.getByText('⋯ 14 messages between', { exact: true }).waitFor(); await context.close();
  });
  await group('large Archive totals retain exact decimal digits rather than legacy i32 or ANN-window caps', async () => {
    const { page, context } = await scene(f => { f.archiveSearchTransform = result => result.with({ page: result.page.with({ total: 9007199254740993n }) }); });
    await submit(page); await ready(page); await barText(page, `9007199254740993 conversations · ${FIRST_BATCH} loaded`); await context.close();
  });
  await group('malformed evidence identity fails at the result boundary before any source read', async () => {
    const { page, fixture, context } = await scene(f => { f.archiveSearchTransform = result => result.with({ evidence: [result.evidence[0].with({ sessionId: '00000000-0000-4000-8000-000000099999' }), ...result.evidence.slice(1)] }); });
    await submit(page); await searchMain(page).getByRole('alert').filter({ hasText: 'source identity' }).waitFor(); assert.equal(await rows(page).count(), 0);
    assert.equal(calls(fixture, api.Operation_ReadMessageContext).length, 0); assert.equal(calls(fixture, api.Operation_Search).length, 0); await context.close();
  });
  for (const failure of ['invalid', 'unavailable']) await group(`expression ${failure} is shown without client rewriting or legacy Search fallback; the query is kept and Retry resubmits it`, async () => {
    const { page, fixture, context } = await scene(f => { f.archiveSearchFailure = failure; }), expression = 'A OR B mode:lexical';
    await input(page).fill(expression); await submit(page); const notice = searchMain(page).getByRole('alert').filter({ hasText: 'Synthetic expression search unavailable' }); await notice.waitFor();
    assert.equal(calls(fixture, api.Operation_ArchiveSearch)[0].query.expression, expression); assert.equal(calls(fixture, api.Operation_Search).length, 0); assert.equal(await rows(page).count(), 0);
    assert.equal(await input(page).inputValue(), expression); await barText(page, 'Not loaded');
    fixture.archiveSearchFailure = null; await notice.getByRole('button', { name: 'Retry', exact: true }).click(); await ready(page);
    assert.equal(calls(fixture, api.Operation_ArchiveSearch).at(-1).query.expression, expression); await context.close();
  });
  await group('hits are the original exact spans with their roles; annotations are labelled generated; bounded same-pin continuation without whole-session reads', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0);
    const first = rows(page).first(), group1 = hitGroups(first).nth(0), group2 = hitGroups(first).nth(1), hit = hits(group1).first();
    assert.doesNotMatch(await searchMain(page).innerText(), /representative source is not proof|Highlighted bytes are the returned source span|generation 0000|UTF-8 bytes \[/, 'identifiers and byte ranges are not on the result');
    assert.equal(await hit.locator('[data-role]').textContent(), 'user'); assert.equal(await hit.locator('mark').textContent(), 'Exact 猫🦄 matched'); assert.equal(await hit.locator('[data-hit-text] + span').textContent(), 'message 65');
    assert.match(await first.textContent(), /Generated annotation · GENERATED summary not source/); assert.doesNotMatch(await first.textContent(), /POISON joined chunk text/);
    assert.equal(await first.locator('script').count(), 0); assert.match(await hit.locator('[data-hit-text]').textContent(), /<script>literal\(\)<\/script>/);
    let request = calls(fixture, api.Operation_ReadMessageContext)[0]; assert.deepEqual(request.anchor.toJSON(), fixture.hit.chunks[0].spans[0].toJSON()); assert.equal(request.afterBytes, 512); assert.equal(request.beforeBytes, 0);
    assert.equal(await hits(group2).locator('[data-role]').textContent(), 'assistant'); assert.equal(await hits(group2).locator('mark').textContent(), 'Separate ');
    const firstText = await hit.locator('[data-hit-text]').textContent(), end = Buffer.byteLength(firstText);
    await expand(first); await group1.getByRole('button', { name: 'Later context', exact: true }).click();
    await page.waitForFunction(text => document.querySelector('[data-match-kind] [data-hit-text]')?.textContent !== text, firstText);
    request = calls(fixture, api.Operation_ReadMessageContext).at(-1); assert.equal(request.anchor.start, end); assert.equal(request.anchor.end, end); assert.equal(request.afterBytes, 2048); assert.equal(request.beforeBytes, 0);
    assert.equal(await group1.locator('[data-hit-text]').first().textContent(), Buffer.from(fixture.messagesAt(1)[64].text).subarray(end, end + 2048).toString()); assert.equal(await group1.locator('mark').count(), 0, 'nearby continuation is not labelled matched source');
    assert.equal(await hits(group1).count(), 0, 'the moved window holds context only');
    assert.ok(calls(fixture, api.Operation_ReadMessageContext).every(operation => operation.view.revision === 1 && operation.view.generationId === fixture.view.generationId && operation.beforeBytes + operation.afterBytes <= 2048));
    await first.getByRole('button', { name: 'Collapse', exact: true }).click(); await hits(group1).first().waitFor(); assert.equal(await hits(group1).locator('mark').textContent(), 'Exact 猫🦄 matched', 'collapsing returns to the matched passage');
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0); await context.close();
  });
  await group('keyboard reaches Open at first match; the session route carries the match and Back returns focus to the opener', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    const reads = calls(fixture, api.Operation_ArchiveSearch).length, open = rows(page).first().getByRole('link', { name: 'Open at first match' });
    await open.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(id => location.hash.startsWith(`#/session/${id}?`), fixture.session.id); assert.match(await page.evaluate(() => location.hash), /\?at=m65&find=source&rev=1$/);
    await page.goBack(); await searchMain(page).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Open at first match'); assert.equal(await rows(page).count(), FIRST_BATCH); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, reads);
    await context.close();
  });
  await group('IME Enter and Search withhold execution until composition ends', async () => {
    const { page, fixture, context } = await scene();
    await input(page).dispatchEvent('compositionstart'); await input(page).fill('猫'); await input(page).press('Enter'); assert.equal(await searchMain(page).getByRole('button', { name: 'Search', exact: true }).isDisabled(), true); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 0);
    await input(page).dispatchEvent('compositionend'); await input(page).press('Enter'); await ready(page); assert.equal(calls(fixture, api.Operation_ArchiveSearch).length, 1); await context.close();
  });
  await group('stale search replies cannot replace the results of a newer submission', async () => {
    const { page, fixture, context } = await scene(f => { f.holdSearch = true; });
    await submit(page); await fixture.waitCall(api.Operation_ArchiveSearch, 1); fixture.archiveSearchCount = 5;
    await input(page).fill('new query'); await submit(page); await fixture.waitCall(api.Operation_ArchiveSearch, 2);
    const [older, newer] = fixture.pendingSearch.splice(0); fixture.holdSearch = false; newer(); await ready(page); await barText(page, '5 conversations · 5 loaded');
    older(); await expand(rows(page).first()); await hitGroups(rows(page).first()).first().getByRole('button', { name: 'Later context', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-match-kind] [data-hit="context"]') !== null);
    await barText(page, '5 conversations · 5 loaded'); assert.equal(await rows(page).count(), 5); await context.close();
  });
  await group('stale context replies cannot resurrect a prior window of the same hit', async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    const first = rows(page).first(), group1 = hitGroups(first).first(), reads = calls(fixture, api.Operation_ReadMessageContext).length; fixture.holdContext = true;
    await expand(first); await group1.getByRole('button', { name: 'Later context', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, reads + 1);
    await first.getByRole('button', { name: 'Collapse', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, reads + 2);
    const [later, matched] = fixture.pendingContext.splice(0, 2); fixture.holdContext = false; matched(); await hits(group1).first().waitFor(); later();
    await loadRows(page, 2 * FIRST_BATCH);
    assert.equal(await hits(group1).locator('mark').textContent(), 'Exact 猫🦄 matched', 'the late reply of the abandoned window was dropped'); await context.close();
  });
  for (const failure of ['forbidden', 'indexed-view-retired', 'wrong-pin', 'wrong-session', 'wrong-anchor']) await group(`source ${failure} clears the affected result without fallback and leaves others alone`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page);
    if (failure === 'wrong-pin') fixture.contextTransform = result => result.with({ view: fixture.viewAt(2) });
    else if (failure === 'wrong-session') fixture.contextTransform = result => result.with({ sessionId: '00000000-0000-4000-8000-000000099999' });
    else if (failure === 'wrong-anchor') fixture.contextTransform = result => result.with({ anchor: result.anchor.with({ start: 1 }) });
    else fixture.contextFailure = failure;
    const first = rows(page).first(); await expand(first); await hitGroups(first).first().getByRole('button', { name: 'Later context', exact: true }).click(); await first.getByRole('alert').waitFor();
    assert.equal(await first.locator('[data-hit]').count(), 0); assert.equal(await link(first, TITLE(1)).count(), 0, 'an unavailable result cannot be opened from its title'); assert.equal(await first.locator('h2 [aria-disabled="true"]').count(), 1);
    assert.ok(await hits(rows(page).nth(1)).count() > 0, 'other results keep their hits'); assert.equal(await link(rows(page).nth(1), TITLE(2)).count(), 1);
    assert.equal(calls(fixture, api.Operation_GetSession).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).length, 0); await context.close();
  });
  await group('BOM scalars remain literal in valid Search snippets', async () => {
    const failures = [];
    for (const [name, text, start, end] of [['leading BOM', '\uFEFFx', 0, 4], ['highlight segment BOM', 'a\uFEFFx', 1, 5], ['plain segment BOM', 'a\uFEFFx', 0, 1]]) {
      const { page, context } = await scene(fixture => {
        const messagesAt = fixture.messagesAt.bind(fixture);
        fixture.messagesAt = revision => messagesAt(revision).map(message => message.id === 'm65' ? message.with({ text }) : message);
        fixture.archiveSearchTransform = result => withSpan(result, new api.Span('m65', start, end));
      });
      await submit(page); const row = rows(page).first(); await row.locator('[data-hit], [role="alert"]').first().waitFor();
      const unavailable = await row.getByRole('alert').count(), snippet = unavailable === 0 ? await row.locator('[data-hit-text]').first().textContent() : null, mark = unavailable === 0 ? await row.locator('mark').first().textContent() : null;
      const expectedSnippet = Buffer.from(text).subarray(start).toString(), expectedMark = Buffer.from(text).subarray(start, end).toString();
      if (unavailable !== 0 || snippet !== expectedSnippet || mark !== expectedMark) failures.push({ name, unavailable, snippet, mark, expectedSnippet, expectedMark });
      await context.close();
    }
    assert.deepEqual(failures, [], 'Valid BOM scalars must neither be rejected nor stripped from highlighted or plain segments');
  });
  await group('invalid source scalar endpoints fail closed at the context reply boundary', async () => {
    const failures = [];
    for (const [name, span] of [['full anchor', new api.Span('m1', 1, 2)], ['full anchor end', new api.Span('m1', 0, 1)], ['partial preview', new api.Span('m1', 1, 2050)], ['non-scalar excerpt', new api.Span('m1', 0, 1)]]) {
      const known = errors.length;
      const { page, context } = await scene(fixture => {
        fixture.archiveSearchTransform = result => withSpan(result, span);
        fixture.contextTransform = result => result.with({ excerpts: [new api.ContextExcerpt(new api.PassageSourceSpan('m1', 0, 0, 4), 'user', name === 'non-scalar excerpt' ? '\ud800x' : '猫x')], previous: undefined, next: undefined });
      });
      await submit(page); await rows(page).first().getByRole('alert').waitFor();
      const pageErrors = errors.slice(known), unavailable = await rows(page).first().getByRole('alert').count();
      if (pageErrors.length !== 0 || unavailable !== 1) failures.push({ name, pageErrors, unavailable });
      assert.equal(await page.locator('[data-hit]').count(), 0); await context.close();
    }
    assert.deepEqual(failures, [], 'Invalid scalar boundaries must yield an explicit source-unavailable result, never an uncaught render exception');
  });
  for (const change of ['disconnect', 'identity']) await group(`${change} clears results and fences pending replies`, async () => {
    const { page, fixture, context } = await scene(); await submit(page); await ready(page); fixture.holdContext = true;
    const first = rows(page).first(); await expand(first); await hitGroups(first).first().getByRole('button', { name: 'Later context', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMessageContext, 21);
    if (change === 'identity') fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read]);
    fixture.restart(); await advanceClockUntil(page, async () => await page.locator('[data-state="intro"]').count() > 0, retryBudgetMillis(connectionConfig), 'Search shows its first render again after the reconnect');
    fixture.pendingContext.splice(0).forEach(reply => reply()); await page.clock.runFor(100);
    assert.equal(await page.locator('[data-hit]').count(), 0); assert.equal(await rows(page).count(), 0); assert.equal(await page.getByRole('dialog').count(), 0); await context.close();
  });
  await group('an oversized historical source span explicitly labels its partial bounded preview', async () => {
    const { page, fixture, context } = await scene(f => { f.archiveSearchTransform = result => withSpan(result, new api.Span('m65', 0, 22000)); });
    await submit(page); await ready(page); await rows(page).first().getByText('Partial preview · source span exceeds 2048 bytes.', { exact: true }).waitFor();
    const request = calls(fixture, api.Operation_ReadMessageContext)[0]; assert.equal(request.anchor.start, request.anchor.end); assert.equal(Buffer.byteLength(await rows(page).first().locator('[data-hit-text]').first().textContent()), 512); await context.close();
  });
  for (const [width, theme] of [[1024, 'light'], [1024, 'dark'], [390, 'light'], [390, 'dark']]) await group(`layout ${width}px ${theme}: no horizontal overflow and no clipped hits`, async () => {
    const { page, context } = await scene(undefined, { width, height: width === 390 ? 844 : 700, theme }); await submit(page); await ready(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal document overflow');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-hit]')].every(element => element.getBoundingClientRect().right <= innerWidth)), true, 'every hit fits the viewport'); await context.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, [], 'no native dialogs');
  console.log(`Search browser: ${results.length} groups passed`);
} finally { await browser.close(); await server.close(); }
