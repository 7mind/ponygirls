// Behavioral-Active Blackbox / Good Communication: controlled local websocket
// fixtures verify UI contracts; no claim about backend SQL, codegen or providers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { HistoryFixture, FIND_LITERAL, api } from './history-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const output = fileURLToPath(new URL('../test-results/history-find/', import.meta.url)); await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
async function scene(configure, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new HistoryFixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); configure(fixture);
  await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.locator('.archive-row').first().waitFor(); await page.locator('.archive-row .table-title').first().click(); await page.locator('.original-message').first().waitFor();
  const finder = page.getByRole('region', { name: 'Find in selected history', exact: true }), input = page.getByRole('textbox', { name: 'Literal message text', exact: true });
  return { context, page, fixture, finder, input };
}
async function group(name, body) { if (process.env.HISTORY_CASE !== undefined && !name.includes(process.env.HISTORY_CASE)) return; await body(); results.push(name); console.log(`PASS history find: ${name}`); }
const calls = fixture => fixture.calls.filter(call => call.operation instanceof api.Operation_SearchSessionMessages);
async function find(scene, literal) { await scene.input.fill(literal); await scene.finder.getByRole('button', { name: 'Find messages', exact: true }).click(); }
try {
  await group('whole unindexed selected revision, literal fragments beyond100, paged locators and same-pin source navigation', async () => {
    const s = await scene(() => {}, 1440, 'light'), { context, page, fixture, finder, input } = s;
    assert.ok(await page.locator('.original-message').count() < 100); assert.equal(await page.locator('#message-m131').count(), 0);
    await input.fill(FIND_LITERAL); assert.equal(calls(fixture).length, 0, 'Typing must not issue SQL');
    await finder.getByRole('button', { name: 'Find messages', exact: true }).click();
    const first = finder.getByRole('button', { name: 'Message 131 · m131', exact: true }); await first.waitFor();
    const request = calls(fixture)[0].operation; assert.equal(request.literal, FIND_LITERAL); assert.equal(request.limit, 40); assert.equal(request.view.revision, 2); assert.equal(request.view.generationId, undefined);
    assert.equal(await finder.locator('.find-hits button').count(), 40); assert.match(await finder.textContent(), /40 matching messages on page 1/); assert.doesNotMatch(await finder.textContent(), /45 matching|45 occurrences/);
    // HEAD/published changes must not silently repin this active finder.
    fixture.headRevision = 3; fixture.publishedRevision = 3;
    await first.click(); await page.locator('#message-m131 pre').waitFor();
    assert.equal(await page.locator('#message-m131 pre').textContent(), fixture.messagesAt(2)[130].text);
    const locate = fixture.calls.filter(call => call.operation instanceof api.Operation_LocateMessage).at(-1).operation;
    assert.equal(locate.messageId, 'm131'); assert.equal(locate.view.revision, 2); assert.equal(locate.view.generationId, undefined);
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).every(call => call.operation.view.revision === 2 && call.operation.view.generationId === undefined));
    assert.equal(await page.locator('#message-m131 details').evaluate(element => element.open), true, 'Find selection expands normalized text, never raw records');
    await page.locator('#message-m131 summary').click(); assert.equal(await page.locator('#message-m131 details').evaluate(element => element.open), false);
    await first.click(); await page.waitForFunction(() => document.querySelector('#message-m131 details').open);
    assert.match(await page.locator('#message-m131 header').textContent(), /Raw record #7210/);
    await finder.getByRole('button', { name: 'Next matches', exact: true }).click(); await finder.getByRole('button', { name: 'Message 171 · m171', exact: true }).waitFor(); assert.equal(await finder.locator('.find-hits button').count(), 5);
    assert.ok(calls(fixture)[1].operation.cursor.length > 0); assert.equal(calls(fixture)[1].operation.literal, FIND_LITERAL);
    await finder.getByRole('button', { name: 'Restart find', exact: true }).click(); await first.waitFor(); assert.equal(calls(fixture)[2].operation.cursor, undefined);
    assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_StartMcpTest), false);
    const related = page.getByText('Related sessions', { exact: true }); await related.scrollIntoViewIfNeeded(); await related.click(); assert.equal(await page.locator('.related').evaluate(element => element.getBoundingClientRect().top < document.querySelector('.transcript').getBoundingClientRect().top), true);
    await context.close();
  });
  await group('actual NUL literal reaches the wire unchanged and locates normalized escaped text', async () => {
    const s = await scene(() => {}, 1440, 'light'); await find(s, '\u0000');
    await s.finder.getByRole('button', { name: 'Message 2 · m2', exact: true }).click();
    assert.equal(calls(s.fixture)[0].operation.literal, '\u0000'); assert.equal(calls(s.fixture)[0].operation.literal.length, 1);
    assert.equal(await s.page.locator('#message-m2 pre').textContent(), 'Normalized literal \\u0000 token'); await s.context.close();
  });
  await group('Find preserves existing UTF8 annotation highlights, without inventing find offsets', async () => {
    const s = await scene(fixture => { fixture.indexed = true; }, 1440, 'light');
    await s.page.locator('.passage-list .passage').first().click(); await s.page.locator('#message-m1 mark').waitFor(); assert.equal(await s.page.locator('#message-m1 mark').textContent(), '猫🦄');
    await find(s, '猫🦄'); await s.finder.getByRole('button', { name: 'Message 1 · m1', exact: true }).click();
    assert.equal(await s.page.locator('#message-m1 mark').textContent(), '猫🦄'); await s.context.close();
  });
  await group('Find locator ACL denial clears retained private draft and locators', async () => {
    const s = await scene(() => {}, 1440, 'light'); await find(s, FIND_LITERAL); await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).waitFor(); s.fixture.sourceDenied = true;
    await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).click(); await s.page.getByRole('alert').filter({ hasText: 'Selected source access removed' }).waitFor();
    assert.equal(await s.page.locator('.find-hits button').count(), 0); assert.ok(await s.input.count() === 0 || await s.input.inputValue() === ''); await s.context.close();
  });
  await group('mismatched source locator clears Find authority without repinning or claiming a match', async () => {
    const s = await scene(() => {}, 1440, 'light'); await find(s, FIND_LITERAL); await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).waitFor(); s.fixture.locatorPositionOverride = 129;
    await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).click(); await s.page.getByRole('alert').filter({ hasText: 'invalid message position' }).waitFor();
    assert.equal(await s.page.locator('.find-hits button').count(), 0); assert.equal(await s.input.inputValue(), ''); assert.equal(await s.page.locator('#message-m131').count(), 0); await s.context.close();
  });
  await group('transient hit-locator timeout keeps the valid Find page available for explicit retry', async () => {
    const s = await scene(() => {}, 1440, 'light'); await find(s, FIND_LITERAL); await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).waitFor(); s.fixture.locatorFailure = 'timeout';
    await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).click(); await s.page.getByRole('alert').filter({ hasText: 'Synthetic locator timeout' }).waitFor(); assert.equal(await s.input.inputValue(), FIND_LITERAL); assert.equal(await s.finder.locator('.find-hits button').count(), 40); await s.context.close();
  });
  for (const intent of ['reset', 'new-query', 'new-query-mismatch']) await group(`new Find ${intent} supersedes an unsettled hit locator and clears seeking`, async () => {
    const s = await scene(fixture => { fixture.holdLocators = true; if (intent === 'new-query-mismatch') fixture.locatorPositionOverride = 129; }, 1440, 'light'); await find(s, FIND_LITERAL); await s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).click();
    await s.page.getByText('Locating the original message…', { exact: true }).waitFor(); assert.equal(s.fixture.pendingLocators.length, 1);
    if (intent === 'reset') await s.finder.getByRole('button', { name: 'Reset find', exact: true }).click(); else { await find(s, 'Normalized source'); await s.finder.getByRole('button', { name: 'Message 3 · m3', exact: true }).waitFor(); }
    assert.equal(await s.page.getByText('Locating the original message…', { exact: true }).count(), 0, 'New Find intent must clear pending source seeking');
    const messageCalls = s.fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).length;
    s.fixture.releaseLocators(); await s.page.clock.runFor(100);
    assert.equal(s.fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).length, messageCalls, 'Superseded locator cannot move the source page');
    assert.equal(await s.page.locator('#message-m131').count(), 0);
    if (intent !== 'reset') assert.equal(await s.finder.getByRole('button', { name: 'Message 3 · m3', exact: true }).count(), 1, 'Old navigation cannot clear a newer Find page'); await s.context.close();
  });
  for (const width of [1440, 390]) await group(`landed Find message has visible keyboard focus and a route back at ${width}`, async () => {
    const s = await scene(() => {}, width, 'light'); await s.page.emulateMedia({ reducedMotion: 'reduce' }); await find(s, FIND_LITERAL); const hit = s.finder.getByRole('button', { name: 'Message 131 · m131', exact: true });
    const background = await s.page.evaluate(() => ({ x: scrollX, y: scrollY })); await hit.focus(); await hit.press('Enter'); await s.page.locator('#message-m131 pre').waitFor(); await s.page.clock.runFor(50);
    const focus = await s.page.evaluate(() => { const element = document.activeElement, rect = element.getBoundingClientRect(); return { tag: element.tagName, text: element.textContent.slice(0, 80), top: rect.top, bottom: rect.bottom, height: innerHeight }; });
    assert.ok(focus.top >= 0 && focus.bottom <= focus.height, `Landed focus must not remain offscreen: ${JSON.stringify(focus)}`);
    assert.equal(await s.page.locator('#message-m131').getAttribute('aria-current'), 'location'); await s.page.getByRole('status', { name: 'Source navigation status', exact: true }).filter({ hasText: 'message 131' }).waitFor(); await s.page.screenshot({ path: `${output}/landed-light-${width}.png` });
    await s.page.keyboard.press('Tab'); assert.equal(await s.page.evaluate(() => document.activeElement.tagName !== 'BODY'), true);
    await s.page.getByRole('button', { name: 'Back to Find results', exact: true }).click(); assert.equal(await hit.evaluate(element => element === document.activeElement), true); assert.deepEqual(await s.page.evaluate(() => ({ x: scrollX, y: scrollY })), background); await s.context.close();
  });
  await group('keyboard Find Next Restart keep focus while their RPC is unsettled', async () => {
    const s = await scene(fixture => { fixture.holdFind = true; }, 1440, 'light'); await s.input.fill(FIND_LITERAL);
    for (const [index, name] of ['Find messages', 'Next matches', 'Restart find'].entries()) {
      const button = s.finder.getByRole('button', { name, exact: true }); await button.focus(); await button.press('Enter'); await s.fixture.waitCall(api.Operation_SearchSessionMessages, index + 1); await s.page.clock.runFor(50);
      const focus = await s.page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent.slice(0, 80) })); console.log('Find busy focus observation:', name, JSON.stringify(focus)); assert.equal(await button.evaluate(element => element === document.activeElement), true, JSON.stringify(focus));
      s.fixture.pendingFind.shift()(); await s.page.waitForFunction(() => document.querySelectorAll('.session-find .find-hits button').length > 0);
    }
    assert.equal(await s.finder.getByRole('status', { name: 'Find status', exact: true }).count(), 1); await s.context.close();
  });
  await group('same-query Find discarded after annotation navigation is explained without stale hits', async () => {
    const s = await scene(fixture => { fixture.indexed = true; fixture.holdFind = true; }, 1440, 'light'); await find(s, '猫🦄'); await s.fixture.waitCall(api.Operation_SearchSessionMessages, 1); await s.page.locator('.passage-list .passage').first().click(); s.fixture.pendingFind.shift()();
    await s.finder.getByRole('status', { name: 'Find status', exact: true }).filter({ hasText: 'Find result discarded after source navigation; Find again' }).waitFor(); assert.equal(await s.finder.locator('.find-hits button').count(), 0); await s.context.close();
  });
  await group('typing Find does not cancel an unrelated held annotation locator', async () => {
    const s = await scene(fixture => { fixture.indexed = true; fixture.holdLocators = true; }, 1440, 'light'); await s.page.locator('.passage-list .passage').nth(1).click(); await s.page.getByText('Locating the original message…', { exact: true }).waitFor(); await s.input.fill('new Find draft');
    assert.equal(await s.page.locator('.selected-passage').count(), 1); s.fixture.releaseLocators(); await s.page.locator('#message-m65 pre').waitFor(); assert.equal(await s.input.inputValue(), 'new Find draft'); await s.context.close();
  });
  await group('single unsettled request, edit/reset fences late replies, no queued keystroke work and IME Enter', async () => {
    const s = await scene(fixture => { fixture.holdFind = true; }, 1440, 'light'), { context, page, fixture, finder, input } = s;
    await find(s, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 1); await input.press('Enter'); await input.press('Enter'); assert.equal(calls(fixture).length, 1);
    await input.fill('new private query'); fixture.pendingFind.shift()(); await finder.getByRole('button', { name: 'Find messages', exact: true }).waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('.session-find button[type=submit]').getAttribute('aria-disabled') === 'false'); assert.equal(await finder.getByText('Find result discarded after source navigation; Find again', { exact: true }).count(), 0); assert.equal(await finder.locator('.find-hits button').count(), 0); assert.equal(calls(fixture).length, 1);
    await input.dispatchEvent('compositionstart'); await input.press('Enter'); assert.equal(calls(fixture).length, 1); await input.dispatchEvent('compositionend');
    await find(s, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 2); await finder.getByRole('button', { name: 'Reset find', exact: true }).click(); assert.equal(await input.inputValue(), ''); fixture.pendingFind.shift()(); await page.waitForFunction(() => document.querySelector('.session-find button[type=submit]').getAttribute('aria-disabled') === 'false'); assert.equal(await finder.locator('.find-hits button').count(), 0);
    await context.close();
  });
  for (const reset of ['reload', 'reopen', 'tab']) await group(`no overlapping unsettled Find across ${reset}`, async () => {
    const s = await scene(fixture => { fixture.holdFind = true; }, 1440, 'light'); await find(s, FIND_LITERAL); await s.fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    if (reset === 'reload') await s.page.getByRole('button', { name: 'Reload source snapshot ↻', exact: true }).click();
    else { await s.page.getByRole('button', { name: 'Close conversation', exact: true }).click(); if (reset === 'tab') { await s.page.getByRole('button', { name: 'activity', exact: true }).click(); await s.page.locator('.activity-overview').waitFor(); await s.page.getByRole('button', { name: 'archive', exact: true }).click(); } await s.page.locator('.archive-row .table-title').first().click(); }
    await s.page.getByRole('textbox', { name: 'Literal message text', exact: true }).fill(FIND_LITERAL); await s.page.getByRole('textbox', { name: 'Literal message text', exact: true }).press('Enter'); assert.equal(calls(s.fixture).length, 1, 'New finder cannot overlap the unsettled old Find');
    s.fixture.pendingFind.shift()(); await s.page.waitForFunction(() => document.querySelector('.session-find button[type=submit]').getAttribute('aria-disabled') === 'false'); assert.equal(await s.page.locator('.find-hits button').count(), 0);
    await s.page.getByRole('region', { name: 'Find in selected history', exact: true }).getByRole('button', { name: 'Find messages', exact: true }).click(); await s.fixture.waitCall(api.Operation_SearchSessionMessages, 2); s.fixture.pendingFind.shift()(); await s.context.close();
  });
  await group('invalid scalar, empty and UTF8 byte bounds never issue a Find request', async () => {
    const s = await scene(() => {}, 1440, 'light');
    for (const literal of ['', '🦄'.repeat(513)]) { await find(s, literal); await s.finder.getByRole('alert').waitFor(); assert.equal(calls(s.fixture).length, 0); }
    await s.input.evaluate(element => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(element, '\ud800'); element.dispatchEvent(new Event('input', { bubbles: true })); }); await s.finder.getByRole('button', { name: 'Find messages', exact: true }).click(); assert.equal(calls(s.fixture).length, 0);
    await s.context.close();
  });
  for (const malformed of ['view', 'duplicate', 'order', 'limit', 'cursor', 'cross-page']) await group(`rejects malformed ${malformed} result without misleading hits or cursor`, async () => {
    const s = await scene(() => {}, 1440, 'light'), { fixture, finder } = s;
    if (malformed === 'cross-page') { await find(s, FIND_LITERAL); await finder.getByRole('button', { name: 'Message 131 · m131', exact: true }).waitFor(); fixture.findTransform = result => result.with({ hits: [new api.MessageSearchHit('m131', 130)] }); await finder.getByRole('button', { name: 'Next matches', exact: true }).click(); }
    else { fixture.findTransform = result => malformed === 'view' ? result.with({ view: new api.ContentView(99, undefined) }) : malformed === 'duplicate' ? result.with({ hits: [result.hits[0], result.hits[0]] }) : malformed === 'order' ? result.with({ hits: [result.hits[1], result.hits[0]] }) : malformed === 'limit' ? result.with({ hits: [...result.hits, new api.MessageSearchHit('extra', 900)] }) : result.with({ hits: [], nextCursor: 'no-progress' }); await find(s, FIND_LITERAL); }
    await finder.getByRole('alert').waitFor(); assert.equal(await finder.locator('.find-hits button').count(), 0); assert.equal(await finder.getByRole('button', { name: 'Next matches', exact: true }).isDisabled(), true); await s.context.close();
  });
  for (const change of ['pin', 'session', 'navigation', 'disconnect', 'source-acl', 'same-owner-auth', 'account']) await group(`private draft/results and pending replies fenced on ${change}`, async () => {
    const s = await scene(fixture => { fixture.holdFind = true; }, 1440, 'light'), { page, fixture, finder, input } = s;
    await find(s, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    if (change === 'pin') await page.getByRole('button', { name: 'Reload source snapshot ↻', exact: true }).click();
    else if (change === 'session') { await page.getByRole('button', { name: 'Close conversation', exact: true }).click(); await page.locator('.archive-row .table-title').first().click(); }
    else if (change === 'navigation') await page.getByRole('button', { name: 'Request raw records', exact: true }).click();
    else if (change === 'source-acl') { fixture.sourceDenied = true; fixture.findFailure = 'forbidden'; }
    else if (change === 'disconnect') { fixture.restart(); await page.clock.runFor(200); }
    else { fixture.mode = 'unauthorized'; fixture.restart(); await page.clock.runFor(200); await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor(); }
    const reply = fixture.pendingFind.shift(); if (reply !== undefined) reply();
    if (change === 'source-acl') { await finder.getByRole('alert').waitFor(); assert.equal(await input.inputValue(), ''); }
    else if (change === 'pin' || change === 'session' || change === 'disconnect') { await page.getByRole('textbox', { name: 'Literal message text', exact: true }).waitFor(); assert.equal(await page.getByRole('textbox', { name: 'Literal message text', exact: true }).inputValue(), ''); }
    else if (change === 'same-owner-auth' || change === 'account') { await page.getByLabel('Login', { exact: true }).fill(change === 'account' ? 'bob' : 'alice'); await page.getByLabel('Password', { exact: true }).fill('synthetic-password'); await page.getByRole('button', { name: 'Sign in →', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); await page.locator('.archive-row .table-title').first().click(); assert.equal(await page.getByRole('textbox', { name: 'Literal message text', exact: true }).inputValue(), ''); }
    assert.equal(await page.locator('.find-hits button').count(), 0); await s.context.close();
  });
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) await group(`${theme} ${width} geometry, keyboard and focus`, async () => {
    const s = await scene(() => {}, width, theme), { page, finder, input } = s;
    await input.fill(FIND_LITERAL); await input.press('Enter'); const hit = finder.getByRole('button', { name: 'Message 131 · m131', exact: true }); await hit.waitFor();
    await input.focus(); await page.keyboard.press('Tab'); assert.equal(await finder.getByRole('button', { name: 'Find messages', exact: true }).evaluate(element => element === document.activeElement), true);
    const bounds = await finder.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth, document: document.documentElement.scrollWidth }; }); assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.document <= width, JSON.stringify(bounds));
    await finder.screenshot({ path: `${output}/${theme}-${width}.png` }); await hit.click(); await page.locator('#message-m131 pre').waitFor(); assert.equal(await page.locator('#message-m131 mark').count(), 0, 'Find must not invent substring offsets/highlighting'); await s.context.close();
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2)); }
