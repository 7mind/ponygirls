// Session page (redesign spec §3.1 Session, §5, §8): the routed transcript with its side pane (scroll model B), Find in a
// session, passages, source pins and the session's authorization fences.
// Behavioral-Active Blackbox / Good Communication: the real React app against scripted Chronicle servers (ChronicleFixture
// family); no backend, database or provider runs. Every scenario owns its browser context; the script runs standalone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, advanceClock, advanceClockUntil, api, connectionConfig, pauseClock, retryBudgetMillis } from './fixture.mjs';
import { Goal50Fixture } from './goal50-fixture.mjs';
import { HistoryFixture, FIND_LITERAL } from './history-fixture.mjs';
import { SearchFixture } from './search-fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH to the provisioned browsers; tests never download browsers.');
// A browser download (`<a download>`) bypasses Playwright routing, so the Vite server answers /api/raw: through the handler a
// scenario installs, otherwise as a server without the raw API (404, no Failure body).
const rawServer = { handle: null };
const rawFixture = { name: 'raw-fixture', configureServer(vite) { vite.middlewares.use((request, response, next) => {
  if (!request.url.startsWith('/api/raw/')) { next(); return; }
  if (rawServer.handle !== null) { rawServer.handle(request, response); return; }
  response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
}); } };
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error', plugins: [rawFixture] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const DESKTOP = { width: 1440, height: 900 }, LAPTOP = { width: 1024, height: 700 }, PHONE = { width: 390, height: 844 };
const SCROLL_TOLERANCE = 2, MESSAGE_PAGE = 40, PASSAGE_PAGE = 40, SHORT_PAGE = 7;
const ARCHIVE_REFRESH_MS = 20_000, THEME_KEY = 'chronicle.theme.preference';
let cases = 0;

/** Retired annotation generations (the rebuild fixture's subject), zero-problem publications and a plain literal Find. */
class RetiringFixture extends Goal50Fixture {
  contextZero = true; retiredType = null; holdRetired = false; retiredReplies = [];
  get publishedFormat() { return api.PassageFormat.ContextAwareProblems; }
  handle(operation, envelope, send, entry) {
    if (this.retiredType !== null && operation instanceof this.retiredType && operation.view !== undefined && operation.view.generationId !== undefined) { const reply = () => send(new api.Result_Error(new api.Failure('indexed-view-retired', 'This exact indexed generation has been retired.'))); if (this.holdRetired) this.retiredReplies.push(reply); else reply(); return true; }
    if (operation instanceof api.Operation_GetPassages && this.contextZero) { send(new api.Result_Passages(new api.PassagesResult(operation.view, operation.view.generationId === undefined ? api.PassageFormat.Unindexed : api.PassageFormat.ContextAwareProblems, [], 0n, operation.offset))); return true; }
    if (operation instanceof api.Operation_SearchSessionMessages) { const hits = this.messagesAt(operation.view.revision).flatMap((message, position) => message.text.toLowerCase().includes(operation.literal.toLowerCase()) ? [new api.MessageSearchHit(message.id, position)] : []); send(new api.Result_SessionMessageSearch(new api.SessionMessageSearchResult(operation.view, hits.slice(0, operation.limit), undefined))); return true; }
    return super.handle(operation, envelope, send, entry);
  }
}

/**
 * A server whose page byte bound shortens every message page to SHORT_PAGE messages (GetMessages may return fewer than its
 * limit, at least one where any exist). Eight-line messages (unfolded): a short page fills the transcript pane.
 */
class ShortPageFixture extends ChronicleFixture {
  constructor() {
    super(); this.messageCount = 200;
    this.goal50Operation = (operation, _envelope, send) => {
      if (!(operation instanceof api.Operation_GetMessages)) return false;
      const messages = this.messagesAt(operation.view.revision);
      send(new api.Result_Messages(new api.MessagesResult(messages.slice(operation.offset, operation.offset + Math.min(operation.limit, SHORT_PAGE)), messages.length, operation.offset, operation.view))); return true;
    };
  }
  messagesAt() { return Array.from({ length: this.messageCount }, (_, position) => new api.Message(`m${position + 1}`, undefined, position % 2 === 0 ? 'user' : 'assistant', Array.from({ length: 8 }, (_, line) => `Message ${position + 1}, line ${line + 1}.`).join('\n'), undefined, position)); }
}

/** The view an Archive row opens (its matched or published view, else its HEAD), as address parameters. */
function rowPin(fixture, index) {
  const row = fixture.authorizedRows[index], view = row.matchedView ?? row.publishedView ?? row.head.view;
  return pinQuery(view);
}
function pinQuery(view) { return `rev=${view.revision}${view.generationId === undefined ? '' : `&gen=${view.generationId}`}`; }
const sessionHash = (fixture, query) => `#/session/${fixture.session.id}${query === '' ? '' : `?${query}`}`;

async function scene({ Fixture = ChronicleFixture, page: fixturePage = 'harness.html', viewport = DESKTOP, scheme = 'light', configure = () => {}, before = async () => {}, hash, permissions = [] }) {
  const context = await browser.newContext({ viewport, colorScheme: scheme, permissions }), page = await context.newPage(), fixture = new Fixture(), errors = [], dialogs = [];
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  configure(fixture);
  await before({ context, page, fixture });
  await fixture.install(page);
  await page.goto(`${origin}/tests-browser/${fixturePage}${hash === undefined ? sessionHash(fixture, rowPin(fixture, 0)) : hash(fixture)}`);
  return { context, page, fixture, errors, dialogs };
}
async function run(name, options, body) {
  if (process.env.CHRONICLE_SESSION_CASE !== undefined && !name.includes(process.env.CHRONICLE_SESSION_CASE)) return;
  const current = await scene(options);
  try {
    try { await body(current); } catch (cause) { console.log(`FAIL session: ${name}`); throw cause; }
    assert.deepEqual(current.errors, [], 'no page errors');
    assert.deepEqual(current.dialogs, [], 'no native dialogs (window.confirm/alert/prompt)');
  } finally { await current.context.close(); }
  cases++; console.log(`PASS session: ${name}`);
}

const main = page => page.getByRole('main', { name: 'Session', exact: true });
const transcriptPane = page => page.locator('[data-pane="transcript"]');
const railPane = page => page.locator('[data-pane="rail"]');
const message = (page, id) => page.locator(`#message-${id}`);
const messages = page => transcriptPane(page).locator('[data-message-id]');
const sidePane = page => page.getByRole('complementary', { name: 'Session side pane', exact: true });
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const outlineRows = page => page.getByRole('list', { name: 'Passages', exact: true }).getByRole('listitem').locator('.outline-item');
const outlineRow = (page, name) => page.getByRole('list', { name: 'Passages', exact: true }).getByRole('button', { name });
const finder = page => page.getByRole('search', { name: 'Find in selected history', exact: true });
const findInput = page => page.getByRole('textbox', { name: 'Literal message text', exact: true });
const findStatus = page => finder(page).getByRole('status', { name: 'Find status', exact: true });
const hitList = page => page.getByRole('list', { name: 'Matching messages', exact: true });
const hit = (page, position, id) => hitList(page).getByRole('button', { name: `Message ${position} · ${id}`, exact: true });
const hitButtons = page => hitList(page).getByRole('button');
const visible = page => page.getByRole('status', { name: 'Visible messages', exact: true });
const calls = (fixture, Type) => fixture.calls.filter(call => call.operation instanceof Type);
const hash = page => page.evaluate(() => location.hash);
async function ready(page) { await main(page).waitFor(); await messages(page).first().waitFor(); }
/** Opens a side-pane tab (the pane opens first when closed). */
async function showTab(page, name) {
  if (await sidePane(page).count() === 0) await page.getByRole('button', { name: 'Side pane', exact: true }).click();
  await tab(page, name).click(); await sidePane(page).getByRole('tab', { name: new RegExp(`^${name}`), selected: true }).waitFor();
}
async function infoValue(page, term) {
  await showTab(page, 'Info');
  return sidePane(page).locator('dt').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]').textContent();
}
async function openFind(page) { if (await finder(page).count() === 0) await page.getByRole('button', { name: 'Find', exact: true }).click(); await findInput(page).waitFor(); }
async function find(page, literal) { await openFind(page); await findInput(page).fill(literal); await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); }
async function sessionMenu(page, item) { await page.getByRole('button', { name: 'More session actions', exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); }
async function recheck(page) { await sessionMenu(page, 'Recheck source'); }
/** Scrolls a pane to its end until `selector` matches `count` elements (infinite loading appends; waits on the rendered rows). */
async function loadUntil(page, pane, selector, count) {
  for (let before = await page.locator(selector).count(); before < count; before = await page.locator(selector).count()) {
    await pane.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    await page.waitForFunction(([css, previous]) => document.querySelectorAll(css).length > previous, [selector, before]);
  }
  assert.equal(await page.locator(selector).count(), count);
}
/** Scrolls the transcript pane to its top until message `id` is loaded (each earlier page is prepended above). */
async function loadBackTo(page, id) {
  while (await message(page, id).count() === 0) {
    const before = await messages(page).count();
    await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(previous => document.querySelectorAll('[data-pane="transcript"] [data-message-id]').length > previous, before);
  }
}
/** The shown messages are one run of consecutive positions, each message at its own (`m<n>` at position n - 1). */
async function assertContiguous(page) {
  const rows = await messages(page).evaluateAll(elements => elements.map(element => [element.dataset.messageId, Number(element.dataset.messagePosition)]));
  assert.ok(rows.length > 0, 'messages are shown');
  assert.deepEqual(rows, rows.map((_, index) => [`m${rows[0][1] + index + 1}`, rows[0][1] + index]));
}
/** Message id at the top of the transcript pane. */
function topMessage(page) {
  return transcriptPane(page).evaluate(pane => { const top = pane.getBoundingClientRect().top; const first = [...pane.querySelectorAll('[data-message-id]')].find(element => element.getBoundingClientRect().bottom > top + 8); return first === undefined ? null : first.dataset.messageId; });
}
/** Spec §8.1: the vertical scrollers of the page (open menus excluded by the callers). */
function scrollers(page) {
  return page.evaluate(() => ({
    scrollers: [...document.querySelectorAll('body *')].filter(element => { const style = getComputedStyle(element); return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0; }).map(element => element.getAttribute('data-pane') ?? element.className),
    document: document.scrollingElement.scrollHeight - innerHeight, horizontal: document.scrollingElement.scrollWidth - innerWidth,
  }));
}
/** Scrolls the transcript pane so that the message starts exactly at the pane's top edge. */
async function scrollMessageToTop(page, id) {
  await transcriptPane(page).evaluate((pane, target) => { const element = document.getElementById(`message-${target}`); pane.scrollTo({ top: element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop, behavior: 'instant' }); }, id);
}
/** Waits until the message's top edge is inside the transcript pane (passage navigation scrolls smoothly). */
async function waitShown(page, id) { await page.waitForFunction(target => { const element = document.getElementById(`message-${target}`), pane = document.querySelector('[data-pane="transcript"]'); if (element === null || pane === null) return false; const rect = element.getBoundingClientRect(), bounds = pane.getBoundingClientRect(); return rect.top >= bounds.top - 1 && rect.top < bounds.bottom; }, id); }
async function waitTop(page, id) { await page.waitForFunction(target => { const pane = document.querySelector('[data-pane="transcript"]'); if (pane === null) return false; const top = pane.getBoundingClientRect().top; const first = [...pane.querySelectorAll('[data-message-id]')].find(element => element.getBoundingClientRect().bottom > top + 8); return first !== undefined && first.dataset.messageId === target; }, id); }

try {
  // ── Scroll model B, routing and reading place (fresh checks, spec §8.1, §8.4, §5 rules 3, 5, 8) ──
  await run('the transcript pane and the side pane are the only scrollers; the document never scrolls; closing the side pane leaves one', { configure: fixture => { fixture.annotationCount = 30; } }, async ({ page }) => {
    await ready(page); await outlineRows(page).nth(PASSAGE_PAGE - 11).waitFor();
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript', 'rail'], document: 0, horizontal: 0 });
    const chrome = () => page.evaluate(() => ({ head: document.querySelector('.session-head').getBoundingClientRect().top, position: document.querySelector('[aria-label="Position in the transcript"]').getBoundingClientRect().bottom }));
    const before = await chrome();
    await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: 1500, behavior: 'instant' }));
    assert.deepEqual(await chrome(), before, 'the session header and the position bar stay in place while the transcript scrolls');
    assert.equal(await page.evaluate(() => scrollY), 0);
    const toggle = page.getByRole('button', { name: 'Side pane', exact: true });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'the side pane opens by default at 1440 px');
    await toggle.click(); await sidePane(page).waitFor({ state: 'detached' });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript'], document: 0, horizontal: 0 });
  });
  await run('phone: the side pane covers the transcript, both keep their own scroller, and choosing a passage reveals the transcript', { viewport: PHONE, scheme: 'dark', configure: fixture => { fixture.annotationCount = 30; } }, async ({ page }) => {
    await ready(page);
    assert.equal(await sidePane(page).count(), 0, 'the side pane is closed by default below 1280 px');
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript'], document: 0, horizontal: 0 });
    assert.ok(await transcriptPane(page).evaluate(pane => pane.scrollWidth <= pane.clientWidth + 1), 'the transcript fits its pane: no horizontal scrolling inside it');
    await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await outlineRows(page).nth(20).waitFor();
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript', 'rail'], document: 0, horizontal: 0 });
    await outlineRow(page, /A passage on a later bounded source page/).click();
    await sidePane(page).waitFor({ state: 'detached' }); await message(page, 'm65').locator('mark').waitFor();
    await waitShown(page, 'm65');
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript'], document: 0, horizontal: 0 });
  });
  await run('1024 px: the side pane is closed by default and the page does not scroll', { viewport: LAPTOP }, async ({ page }) => {
    await ready(page);
    assert.equal(await page.getByRole('button', { name: 'Side pane', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await scrollers(page), { scrollers: ['transcript'], document: 0, horizontal: 0 });
  });
  await run('a deep link opens at its message; reading replaces `at`; reload restores it; Back leaves the session in one step; Forward and reopening return to the place', { hash: () => '#/archive' }, async ({ page, fixture }) => {
    await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, `${rowPin(fixture, 0)}&at=m65`));
    await ready(page); await waitTop(page, 'm65');
    assert.equal(calls(fixture, api.Operation_LocateMessage).at(-1).operation.messageId, 'm65', 'the deep link is located in its pinned view');
    const entries = await page.evaluate(() => history.length);
    await message(page, 'm70').waitFor(); await scrollMessageToTop(page, 'm70');
    await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('at') === 'm70');
    assert.equal(await page.evaluate(() => history.length), entries, 'reading replaces the address; it does not push entries');
    await page.reload(); await ready(page); await waitTop(page, 'm70');
    await page.goBack(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    assert.match(await hash(page), /^#\/archive/);
    await page.goForward(); await ready(page); await waitTop(page, 'm70');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, ''));
    await ready(page); await waitTop(page, 'm70');
    assert.match(await hash(page), /at=m70/, 'reopening the session from a list returns to its last reading place');
    const fresh = await page.context().newPage(); await fixture.install(fresh);
    await fresh.goto(`${origin}/tests-browser/harness.html${sessionHash(fixture, rowPin(fixture, 0))}`); await ready(fresh);
    await fresh.getByRole('button', { name: 'Back', exact: true }).click(); await fresh.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    assert.match(await hash(fresh), /^#\/archive/, 'Back from a session opened by an address goes to its parent list');
  });
  await run('the side pane choice is remembered in the address and per browser', {}, async ({ context, page, fixture }) => {
    await ready(page); await sidePane(page).waitFor();
    assert.equal(await tab(page, 'Outline').getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await sidePane(page).waitFor({ state: 'detached' });
    assert.match(await hash(page), /pane=closed/);
    await page.reload(); await ready(page); assert.equal(await sidePane(page).count(), 0);
    const other = await context.newPage(), otherErrors = []; other.on('pageerror', error => otherErrors.push(error.message)); await fixture.install(other);
    await other.goto(`${origin}/tests-browser/harness.html${sessionHash(fixture, rowPin(fixture, 0))}`); await ready(other);
    assert.equal(await sidePane(other).count(), 0, 'a new page of this browser keeps the closed side pane');
    await showTab(other, 'Info'); await other.reload(); await ready(other);
    assert.equal(await tab(other, 'Info').getAttribute('aria-selected'), 'true');
    assert.deepEqual(otherErrors, []);
  });
  await run('Related sessions open as navigation and Back returns to the previous session', { configure: fixture => {
    fixture.archiveRowCount = 2;
    fixture.goal50Operation = (operation, _envelope, send) => { if (!(operation instanceof api.Operation_Related)) return false; send(new api.Result_Related(new api.RelatedResult([new api.SearchHit(fixture.archiveAt(1).head, [], 0.5)]))); return true; };
  } }, async ({ page, fixture }) => {
    await ready(page); await showTab(page, 'Related');
    await sidePane(page).getByRole('link', { name: /Synthetic conversation 002/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Synthetic conversation 002', exact: true }).waitFor();
    assert.match(await hash(page), new RegExp(`#/session/${fixture.archiveAt(1).head.id}`));
    await page.goBack(); await page.getByRole('heading', { level: 1, name: 'Following the migration thread', exact: true }).waitFor();
  });
  await run('the first render shows an explicit loading state, never an empty transcript', { configure: fixture => { fixture.holdSessions = true; } }, async ({ page, fixture }) => {
    await main(page).waitFor(); await page.getByRole('status').filter({ hasText: 'Rechecking source access…' }).waitFor({ state: 'attached' });
    assert.equal(await transcriptPane(page).locator('[aria-busy="true"]').filter({ has: page.getByRole('status').filter({ hasText: 'Rechecking source access…' }) }).count(), 1);
    assert.equal(await messages(page).count(), 0);
    fixture.releaseSessions(); await ready(page);
  });
  await run('the selected passage and its highlight survive a reload through the address', {}, async ({ page }) => {
    await ready(page); await outlineRow(page, /Keep original source independent/).click(); await message(page, 'm1').locator('mark').waitFor();
    await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('passage') !== null);
    await page.reload(); await ready(page); await message(page, 'm1').locator('mark').waitFor();
    assert.equal(await outlineRow(page, /Keep original source independent/).getAttribute('aria-current'), 'true');
  });
  await run('a passage beyond the first outline page is restored through bounded pages after a reload and Back/Forward, also with the outline closed', { hash: () => '#/archive', configure: fixture => { fixture.annotationCount = 205; } }, async ({ page, fixture }) => {
    await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, rowPin(fixture, 0))); await ready(page);
    await loadUntil(page, railPane(page), '[data-passage-id]', 200);
    await outlineRow(page, /Winning passage beyond the first hundred/).click(); await message(page, 'm65').locator('mark').waitFor();
    const selected = () => new URLSearchParams(location.hash.split('?')[1]).get('passage');
    const id = await page.waitForFunction(selected).then(handle => handle.jsonValue());
    await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await sidePane(page).waitFor({ state: 'detached' });
    const before = calls(fixture, api.Operation_GetPassages).length;
    await page.reload(); await ready(page); await message(page, 'm65').locator('mark').waitFor();
    assert.equal(await page.evaluate(selected), id, 'the address keeps the passage while and after it is restored');
    const pages = calls(fixture, api.Operation_GetPassages).slice(before).map(call => call.operation);
    assert.deepEqual(pages.map(operation => operation.offset), [0, 40, 80, 120, 160], 'the saved passage is found through bounded pages, then loading stops');
    assert.ok(pages.every(operation => operation.limit === PASSAGE_PAGE));
    await page.goBack(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.goForward(); await ready(page); await message(page, 'm65').locator('mark').waitFor();
    await page.getByRole('button', { name: 'Side pane', exact: true }).click();
    assert.equal(await outlineRow(page, /Winning passage beyond the first hundred/).getAttribute('aria-current'), 'true');
    assert.equal(await page.evaluate(selected), id);
  });
  await run('the position bar shows the visible range and goes to the start, the end and a message number', {}, async ({ page, fixture }) => {
    await ready(page); await visible(page).filter({ hasText: /^Messages 1–\d+ of 87$/ }).waitFor();
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await message(page, 'm87').waitFor(); await page.getByText('End of session · 87 messages', { exact: true }).waitFor();
    await visible(page).filter({ hasText: /–87 of 87$/ }).waitFor();
    await page.getByRole('button', { name: 'Start', exact: true }).click(); await waitTop(page, 'm1');
    await page.getByRole('button', { name: 'Go to message…', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Message number', exact: true }).fill('50'); await page.getByRole('spinbutton', { name: 'Message number', exact: true }).press('Enter');
    await waitTop(page, 'm50'); await visible(page).filter({ hasText: /^Messages 50–/ }).waitFor();
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.limit === MESSAGE_PAGE), 'the position bar reads bounded message pages');
  });
  await run('short message pages keep one contiguous transcript: a jump reads on to its message, scrolling back fills each earlier page, the position bar finds its message', { Fixture: ShortPageFixture, hash: fixture => sessionHash(fixture, `${rowPin(fixture, 0)}&at=m170`) }, async ({ page, fixture }) => {
    await ready(page); await waitTop(page, 'm170'); await assertContiguous(page);
    await loadBackTo(page, 'm1'); await assertContiguous(page);
    const reads = calls(fixture, api.Operation_GetMessages).length;
    await page.getByRole('button', { name: 'Go to message…', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Message number', exact: true }).fill('125'); await page.getByRole('spinbutton', { name: 'Message number', exact: true }).press('Enter');
    await waitTop(page, 'm125');
    assert.equal(calls(fixture, api.Operation_GetMessages).length, reads, 'a loaded position is found in the loaded pages');
    // The last message is in the page of the jump above, beyond what that jump read.
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await page.getByText('End of session · 200 messages', { exact: true }).waitFor(); await waitShown(page, 'm200'); await assertContiguous(page);
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.limit <= MESSAGE_PAGE), 'message pages stay bounded');
  });

  // ── Transcript rendering: inert untrusted text, exact clipboard and source bytes (was transcript.mjs, run.mjs) ──
  const longText = '# Heading\n' + '\n'.repeat(21000);
  const code = 'const animal = "猫🦄";\nconsole.log(animal);\n';
  const toolLog = Array.from({ length: 600 }, (_, index) => `${index % 2 === 0 ? '+' : '-'}synthetic log line ${index + 1}`).join('\n');
  const text = '# A terminal transcript\r\n\r\nUse **immutable revisions** and `exact bytes`.\r\n1. Deploy\r\n2. Verify\r\n\r\n2 * 3 * 4\r\n\r\n```typescript\r\n' + code + '```\r\n\r\n<script>window.transcriptExecuted = true</script>\r\n[jump](javascript:alert(1))';
  for (const [viewport, scheme] of [[DESKTOP, 'light'], [PHONE, 'dark']]) await run(`${scheme} ${viewport.width}: inert formatted text, exact clipboard, source text, bounded large messages and UTF-8 highlights`, { viewport, scheme, permissions: ['clipboard-read', 'clipboard-write'], configure: fixture => {
    const messagesAt = fixture.messagesAt.bind(fixture);
    fixture.messagesAt = revision => messagesAt(revision).map(item => item.id === 'm2' ? item.with({ text }) : item.id === 'm3' ? item.with({ text: longText }) : item.id === 'm4' ? item.with({ role: 'tool', text: toolLog }) : item);
  } }, async ({ page, fixture }) => {
    await ready(page);
    const item = message(page, 'm2'); await item.waitFor();
    assert.equal(await item.getByRole('heading', { name: 'A terminal transcript', exact: true }).count(), 1);
    assert.equal(await item.getByRole('listitem').count(), 2);
    assert.match(await item.textContent(), /2 \* 3 \* 4/);
    assert.equal(await item.locator('strong').filter({ hasText: 'immutable revisions' }).count(), 1);
    assert.equal(await item.locator('.message-code code').textContent(), code);
    assert.equal(await page.evaluate(() => window.transcriptExecuted), undefined, 'untrusted markup is never executed');
    assert.equal(await item.locator('script, a[href^="javascript:"]').count(), 0);
    const status = item.getByRole('status', { name: 'Clipboard status', exact: true }).first();
    await item.getByRole('button', { name: 'Copy message', exact: true }).click();
    await status.filter({ hasText: 'Message copied' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    await item.getByRole('button', { name: 'Copy code', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    await item.getByRole('button', { name: 'More message actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Source text', exact: true }).click();
    assert.equal(await item.locator('.message-source-text').textContent(), text, 'source text is the exact message');
    await item.getByRole('button', { name: 'More message actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Formatted view', exact: true }).click();
    await item.locator('.message-code').waitFor();
    const roles = await page.evaluate(() => ['m1', 'm2'].map(id => ({ label: document.querySelector(`#message-${id} .msg-role`).textContent, rule: getComputedStyle(document.getElementById(`message-${id}`)).borderLeftColor })));
    assert.notEqual(roles[0].rule, roles[1].rule, 'roles have distinct accents'); assert.deepEqual(roles.map(role => role.label), ['User', 'Assistant'], 'with textual role labels');
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Synthetic clipboard denial', 'NotAllowedError'); } }));
    await item.getByRole('button', { name: 'Copy message', exact: true }).click();
    await item.getByRole('alert').filter({ hasText: 'Clipboard unavailable' }).waitFor();
    assert.equal(await status.textContent(), '');
    await page.evaluate(() => { delete navigator.clipboard.writeText; });
    await item.getByRole('button', { name: 'Copy message', exact: true }).click();
    await item.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    const large = message(page, 'm3');
    assert.ok(await large.locator('.message-content *').count() < 100, 'large formatted messages must not amplify into unbounded DOM trees');
    assert.equal(await large.locator('.message-source-text').textContent(), longText);
    const log = message(page, 'm4'); await log.getByRole('button', { name: /^Tool/ }).click();
    assert.equal(await log.locator('.message-source-text').textContent(), toolLog, 'large tool output keeps its exact text');
    assert.ok(await log.locator('.message-content *').count() < 100, 'large tool output stays a bounded DOM (no per-line elements)');
    await log.getByRole('button', { name: 'Show all 600 lines', exact: true }).click();
    assert.ok(await log.locator('.message-content *').count() < 100); assert.equal(await log.locator('.message-source-text').textContent(), toolLog);
    const bounds = await item.evaluate(element => ({ width: element.scrollWidth, available: element.clientWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(bounds.width <= bounds.available + 1 && bounds.document <= bounds.viewport, JSON.stringify(bounds));
    await showTab(page, 'Outline'); await outlineRow(page, /Keep original source independent/).click();
    await message(page, 'm1').locator('mark').waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
    assert.equal(await message(page, 'm1').locator('.message-source-text').textContent(), fixture.messagesAt(1)[0].text);
  });

  // ── Find in a session (was history-find.mjs): literal, message-level locators of the pinned view, one request at a time ──
  const history = (options = {}) => ({ Fixture: HistoryFixture, page: 'goal50.html', before: async ({ page }) => { await page.clock.install(); }, ...options });
  const findCalls = fixture => calls(fixture, api.Operation_SearchSessionMessages);
  /** Shows the Find tab (which opens the bar), types `literal` and runs it from the start. */
  async function findHits(page, literal) { await showTab(page, 'Find'); await findInput(page).fill(literal); await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); }
  const ariaDisabled = locator => locator.getAttribute('aria-disabled');
  await run('Find searches the whole pinned revision by literal, pages its locators and navigates within the same pin', history(), async ({ page, fixture }) => {
    await ready(page);
    assert.ok(await messages(page).count() < 100); assert.equal(await message(page, 'm131').count(), 0);
    await showTab(page, 'Find'); await findInput(page).fill(FIND_LITERAL);
    assert.equal(findCalls(fixture).length, 0, 'typing does not search');
    await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click();
    const first = hit(page, 131, 'm131'); await first.waitFor();
    const request = findCalls(fixture)[0].operation;
    assert.equal(request.literal, FIND_LITERAL); assert.equal(request.limit, 40); assert.equal(request.view.revision, 2); assert.equal(request.view.generationId, undefined);
    assert.equal(await hitButtons(page).count(), 40);
    assert.equal(await findStatus(page).textContent(), '40 matching messages · more available', 'matching messages, never occurrences or a total');
    fixture.headRevision = 3; fixture.publishedRevision = 3;
    await first.click(); await message(page, 'm131').locator('pre').waitFor();
    assert.equal(await message(page, 'm131').locator('pre').textContent(), fixture.messagesAt(2)[130].text);
    const locate = calls(fixture, api.Operation_LocateMessage).at(-1).operation;
    assert.equal(locate.messageId, 'm131'); assert.equal(locate.view.revision, 2); assert.equal(locate.view.generationId, undefined, 'HEAD/published changes do not repin an active finder');
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.view.revision === 2 && call.operation.view.generationId === undefined));
    assert.equal(await message(page, 'm131').locator('.msg-fold').count(), 0, 'the found message is unfolded');
    assert.match(await message(page, 'm131').locator('.msg-tech').textContent(), /Raw record #7210/);
    assert.equal(await findStatus(page).textContent(), 'Message 1 of 40 matching messages · more available');
    await loadUntil(page, railPane(page), '[aria-label="Matching messages"] li', 45);
    assert.ok(findCalls(fixture)[1].operation.cursor.length > 0); assert.equal(findCalls(fixture)[1].operation.literal, FIND_LITERAL);
    await hit(page, 175, 'm175').waitFor(); await page.getByText('End of matches · 45 matching messages', { exact: true }).waitFor();
    await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('[aria-label="Matching messages"] li').length === 40);
    assert.equal(findCalls(fixture)[2].operation.cursor, undefined, 'Find messages restarts from the first page');
    assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_StartMcpTest), false);
  });
  await run('a `find=` address runs that literal once on arrival and is not kept in the address', history({ hash: fixture => sessionHash(fixture, `${rowPin(fixture, 0)}&pane=find&find=${encodeURIComponent(FIND_LITERAL)}`) }), async ({ page, fixture }) => {
    await ready(page); await hit(page, 131, 'm131').waitFor();
    assert.equal(await findInput(page).inputValue(), FIND_LITERAL); assert.equal(findCalls(fixture).length, 1); assert.equal(findCalls(fixture)[0].operation.literal, FIND_LITERAL);
    assert.equal(new URLSearchParams((await hash(page)).split('?')[1]).get('find'), null);
  });
  await run('Find sends an actual NUL literal unchanged and locates the normalized escaped text', history(), async ({ page, fixture }) => {
    await ready(page); await findHits(page, '\u0000'); await hit(page, 2, 'm2').click();
    assert.equal(findCalls(fixture)[0].operation.literal, '\u0000'); assert.equal(findCalls(fixture)[0].operation.literal.length, 1);
    await message(page, 'm2').locator('pre').filter({ hasText: 'Normalized literal' }).waitFor();
    assert.equal(await message(page, 'm2').locator('pre').textContent(), 'Normalized literal \\u0000 token');
  });
  await run('Find keeps the UTF-8 passage highlights and invents no find offsets', history({ configure: fixture => { fixture.indexed = true; } }), async ({ page }) => {
    await ready(page); await outlineRows(page).first().click(); await message(page, 'm1').locator('mark').waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
    await findHits(page, '猫🦄'); await hit(page, 1, 'm1').click();
    await page.getByRole('status', { name: 'Source navigation status', exact: true }).filter({ hasText: 'message 1 ·' }).waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
  });
  await run('a Find locator denied by access control clears the private draft and the locators', history(), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await hit(page, 131, 'm131').waitFor(); fixture.sourceDenied = true;
    await hit(page, 131, 'm131').click(); await page.getByRole('alert').filter({ hasText: 'Selected source access removed' }).first().waitFor();
    assert.equal(await hitButtons(page).count(), 0); assert.ok(await findInput(page).count() === 0 || await findInput(page).inputValue() === '');
  });
  await run('a mismatched locator clears Find authority without repinning or claiming a match', history(), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await hit(page, 131, 'm131').waitFor(); fixture.locatorPositionOverride = 129;
    await hit(page, 131, 'm131').click(); await page.getByRole('alert').filter({ hasText: 'invalid message position' }).waitFor();
    assert.equal(await hitButtons(page).count(), 0); assert.equal(await findInput(page).inputValue(), ''); assert.equal(await message(page, 'm131').count(), 0);
  });
  await run('a transient locator timeout keeps the valid Find results for an explicit retry', history(), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await hit(page, 131, 'm131').waitFor(); fixture.locatorFailure = 'timeout';
    await hit(page, 131, 'm131').click(); await page.getByRole('alert').filter({ hasText: 'Synthetic locator timeout' }).waitFor();
    assert.equal(await findInput(page).inputValue(), FIND_LITERAL); assert.equal(await hitButtons(page).count(), 40);
  });
  for (const intent of ['reset', 'new-query', 'new-query-mismatch']) await run(`a new Find (${intent}) supersedes an unsettled hit locator and clears seeking`, history({ configure: fixture => { fixture.holdLocators = true; if (intent === 'new-query-mismatch') fixture.locatorPositionOverride = 129; } }), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await hit(page, 131, 'm131').click();
    await page.getByText('Locating the original message…', { exact: true }).waitFor(); assert.equal(fixture.pendingLocators.length, 1);
    if (intent === 'reset') await finder(page).getByRole('button', { name: 'Reset find', exact: true }).click();
    else { await findInput(page).fill('Normalized source'); await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await hit(page, 3, 'm3').waitFor(); }
    assert.equal(await page.getByText('Locating the original message…', { exact: true }).count(), 0, 'a new Find intent clears pending source seeking');
    const messageCalls = calls(fixture, api.Operation_GetMessages).length;
    fixture.releaseLocators(); await page.clock.runFor(100);
    assert.equal(calls(fixture, api.Operation_GetMessages).length, messageCalls, 'a superseded locator cannot move the transcript');
    assert.equal(await message(page, 'm131').count(), 0);
    if (intent !== 'reset') assert.equal(await hit(page, 3, 'm3').count(), 1, 'old navigation cannot clear a newer Find');
  });
  for (const viewport of [DESKTOP, PHONE]) await run(`${viewport.width}: a landed Find message takes visible keyboard focus and its hit stays current in the side pane`, history({ viewport }), async ({ page }) => {
    await ready(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await findHits(page, FIND_LITERAL);
    const target = hit(page, 131, 'm131'); await target.focus(); await target.press('Enter');
    await message(page, 'm131').locator('pre').waitFor(); await page.clock.runFor(50);
    const focus = await page.evaluate(() => { const element = document.activeElement, rect = element.getBoundingClientRect(); return { text: element.textContent.slice(0, 80), top: rect.top, bottom: rect.bottom, height: innerHeight }; });
    assert.ok(focus.top >= 0 && focus.bottom <= focus.height && /message 131/.test(focus.text), `landed focus must be visible on the landed message: ${JSON.stringify(focus)}`);
    assert.equal(await message(page, 'm131').getAttribute('aria-current'), 'location');
    await page.getByRole('status', { name: 'Source navigation status', exact: true }).filter({ hasText: 'message 131' }).waitFor();
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.tagName !== 'BODY'), true);
    if (viewport === PHONE) { assert.equal(await sidePane(page).count(), 0, 'on a phone the chosen hit reveals the transcript'); await page.getByRole('button', { name: 'Side pane', exact: true }).click(); }
    assert.equal(await hit(page, 131, 'm131').getAttribute('aria-current'), 'true', 'the hit list keeps the landed hit current');
    assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), { x: 0, y: 0 });
  });
  await run('keyboard Find and restart keep focus while their request is unsettled', history({ configure: fixture => { fixture.holdFind = true; } }), async ({ page, fixture }) => {
    await ready(page); await showTab(page, 'Find'); await findInput(page).fill(FIND_LITERAL);
    const button = finder(page).getByRole('button', { name: 'Find messages', exact: true });
    for (const count of [1, 2]) {
      await button.focus(); await button.press('Enter'); await fixture.waitCall(api.Operation_SearchSessionMessages, count); await page.clock.runFor(50);
      assert.equal(await button.evaluate(element => element === document.activeElement), true);
      fixture.pendingFind.shift()(); await hitButtons(page).first().waitFor();
    }
    assert.equal(await findStatus(page).count(), 1);
  });
  await run('a same-query Find discarded after passage navigation is explained without stale hits', history({ configure: fixture => { fixture.indexed = true; fixture.holdFind = true; } }), async ({ page, fixture }) => {
    await ready(page); await findHits(page, '猫🦄'); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    await showTab(page, 'Outline'); await outlineRows(page).first().click(); fixture.pendingFind.shift()();
    await findStatus(page).filter({ hasText: 'Find result discarded after source navigation; Find again' }).waitFor();
    await showTab(page, 'Find'); assert.equal(await hitList(page).count(), 0); await sidePane(page).getByText('Matching messages appear here.', { exact: true }).waitFor();
  });
  await run('typing a Find does not cancel an unrelated unsettled passage locator', history({ configure: fixture => { fixture.indexed = true; fixture.holdLocators = true; } }), async ({ page, fixture }) => {
    await ready(page); await outlineRows(page).nth(1).click(); await page.getByText('Locating the original message…', { exact: true }).waitFor();
    await openFind(page); await findInput(page).fill('new Find draft');
    assert.equal(await sidePane(page).locator('.outline-item[aria-current="true"]').count(), 1);
    fixture.releaseLocators(); await message(page, 'm65').locator('pre').waitFor(); assert.equal(await findInput(page).inputValue(), 'new Find draft');
  });
  await run('one unsettled Find request; edit and reset fence late replies; no queued keystroke work; IME Enter', history({ configure: fixture => { fixture.holdFind = true; } }), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    await findInput(page).press('Enter'); await findInput(page).press('Enter'); assert.equal(findCalls(fixture).length, 1);
    await findInput(page).fill('new private query'); fixture.pendingFind.shift()();
    await page.waitForFunction(() => document.querySelector('[aria-label="Find in selected history"] button[type=submit]').getAttribute('aria-disabled') === 'false');
    assert.equal(await page.getByText('Find result discarded after source navigation; Find again', { exact: true }).count(), 0); assert.equal(await hitList(page).count(), 0); assert.equal(findCalls(fixture).length, 1);
    await findInput(page).dispatchEvent('compositionstart'); await findInput(page).press('Enter'); assert.equal(findCalls(fixture).length, 1); await findInput(page).dispatchEvent('compositionend');
    await findInput(page).fill(FIND_LITERAL); await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await fixture.waitCall(api.Operation_SearchSessionMessages, 2);
    await finder(page).getByRole('button', { name: 'Reset find', exact: true }).click(); assert.equal(await findInput(page).inputValue(), ''); fixture.pendingFind.shift()();
    await page.waitForFunction(() => document.querySelector('[aria-label="Find in selected history"] button[type=submit]').getAttribute('aria-disabled') === 'false'); assert.equal(await hitList(page).count(), 0);
  });
  for (const reset of ['recheck', 'reopen', 'tab']) await run(`no overlapping unsettled Find across ${reset}`, history({ configure: fixture => { fixture.holdFind = true; } }), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    if (reset === 'recheck') await recheck(page);
    else {
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
      if (reset === 'tab') { await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Activity', exact: true }).click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor(); }
      await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, ''));
    }
    await ready(page); await openFind(page); await findInput(page).fill(FIND_LITERAL); await findInput(page).press('Enter');
    assert.equal(findCalls(fixture).length, 1, 'a new finder cannot overlap the unsettled old Find');
    fixture.pendingFind.shift()();
    await page.waitForFunction(() => document.querySelector('[aria-label="Find in selected history"] button[type=submit]').getAttribute('aria-disabled') === 'false');
    await showTab(page, 'Find'); assert.equal(await hitList(page).count(), 0);
    await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await fixture.waitCall(api.Operation_SearchSessionMessages, 2); fixture.pendingFind.shift()();
    await hitButtons(page).first().waitFor();
  });
  await run('empty, oversized and invalid scalar literals never issue a Find request', history(), async ({ page, fixture }) => {
    await ready(page); await showTab(page, 'Find');
    for (const literal of ['', '🦄'.repeat(513)]) { await findInput(page).fill(literal); await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await finder(page).getByRole('alert').waitFor(); assert.equal(findCalls(fixture).length, 0); }
    await findInput(page).evaluate(element => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(element, '\ud800'); element.dispatchEvent(new Event('input', { bubbles: true })); });
    await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click(); await finder(page).getByRole('alert').waitFor(); assert.equal(findCalls(fixture).length, 0);
  });
  for (const malformed of ['view', 'duplicate', 'order', 'limit', 'cursor', 'cross-page']) await run(`a malformed ${malformed} Find result is rejected without misleading hits or cursor`, history(), async ({ page, fixture }) => {
    await ready(page);
    if (malformed === 'cross-page') {
      await findHits(page, FIND_LITERAL); await hit(page, 131, 'm131').waitFor();
      fixture.findTransform = result => result.with({ hits: [new api.MessageSearchHit('m131', 130)] });
      await railPane(page).evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    } else {
      fixture.findTransform = result => malformed === 'view' ? result.with({ view: new api.ContentView(99, undefined) }) : malformed === 'duplicate' ? result.with({ hits: [result.hits[0], result.hits[0]] }) : malformed === 'order' ? result.with({ hits: [result.hits[1], result.hits[0]] }) : malformed === 'limit' ? result.with({ hits: [...result.hits, new api.MessageSearchHit('extra', 900)] }) : result.with({ hits: [], nextCursor: 'no-progress' });
      await findHits(page, FIND_LITERAL);
    }
    await finder(page).getByRole('alert').waitFor();
    assert.equal(await hitList(page).count(), 0); assert.equal(await ariaDisabled(finder(page).getByRole('button', { name: 'Next match', exact: true })), 'true');
  });
  for (const change of ['pin', 'session', 'navigation', 'disconnect', 'source-acl', 'same-owner-auth', 'account']) await run(`the private Find draft, results and pending replies are fenced on ${change}`, history({ configure: fixture => { fixture.holdFind = true; if (change === 'navigation') fixture.indexed = true; } }), async ({ page, fixture }) => {
    await ready(page); await findHits(page, FIND_LITERAL); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    if (change === 'pin') await recheck(page);
    else if (change === 'session') { await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor(); await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, '')); }
    else if (change === 'navigation') { await showTab(page, 'Outline'); await outlineRows(page).first().click(); }
    else if (change === 'source-acl') { fixture.sourceDenied = true; fixture.findFailure = 'forbidden'; }
    else if (change === 'disconnect') { fixture.restart(); await page.clock.runFor(200); }
    else { fixture.mode = 'unauthorized'; fixture.restart(); await page.clock.runFor(200); await page.getByRole('heading', { name: /^Sign in/ }).waitFor(); }
    const reply = fixture.pendingFind.shift(); if (reply !== undefined) reply();
    // A denied Find is a denied read of the source: the page leaves the transcript, outline and Find (draft and hits) for its notice.
    if (change === 'source-acl') { await main(page).getByRole('alert').filter({ hasText: 'This session can no longer be read' }).waitFor(); assert.equal(await page.locator('[data-message-id], [data-passage-id], [role="search"][aria-label="Find in selected history"], [aria-label="Matching messages"]').count(), 0); }
    else if (change === 'same-owner-auth' || change === 'account') {
      if (change === 'account') fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]);
      await page.getByLabel('Username', { exact: true }).fill(change === 'account' ? 'bob' : 'alice'); await page.getByLabel('Password', { exact: true }).fill('synthetic-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('navigation', { name: 'Main navigation', exact: true }).waitFor();
      await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, ''));
    }
    if (change !== 'source-acl' && change !== 'navigation') { await ready(page); await openFind(page); assert.equal(await findInput(page).inputValue(), ''); }
    if (change !== 'source-acl') { await showTab(page, 'Find'); assert.equal(await hitList(page).count(), 0); }
  });
  for (const [viewport, scheme] of [[DESKTOP, 'light'], [PHONE, 'dark']]) await run(`${scheme} ${viewport.width}: the Find bar fits, keeps its keyboard order and never highlights invented offsets`, history({ viewport, scheme }), async ({ page }) => {
    await ready(page); await showTab(page, 'Find'); await findInput(page).fill(FIND_LITERAL); await findInput(page).press('Enter');
    await hit(page, 131, 'm131').waitFor();
    await findInput(page).focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await finder(page).getByRole('button', { name: 'Find messages', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await finder(page).getByRole('button', { name: 'Reset find', exact: true }).evaluate(element => element === document.activeElement), true);
    const bounds = await finder(page).evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, document: document.documentElement.scrollWidth }; });
    assert.ok(bounds.left >= 0 && bounds.right <= viewport.width && bounds.document <= viewport.width, JSON.stringify(bounds));
    await hit(page, 131, 'm131').click(); await message(page, 'm131').locator('pre').waitFor();
    assert.equal(await message(page, 'm131').locator('mark').count(), 0, 'Find does not invent substring offsets or highlighting');
  });

  // ── Passages (was ux.mjs, run.mjs, goal50.mjs): bounded infinite outline, pinned locators, UTF-8 span highlights ──
  const passageRows = '[data-passage-id]';
  await run('205 infinite passages, a direct locator beyond 10 000 messages, selection races and transcript-only scrolling', { configure: fixture => { fixture.annotationCount = 205; fixture.messageCount = 12065; fixture.lateMessageId = 'm12065'; } }, async ({ page, fixture }) => {
    await ready(page); await outlineRows(page).first().waitFor(); fixture.holdLocators = true;
    await outlineRow(page, /A passage on a later bounded source page/).click();
    await fixture.waitUntil(() => fixture.pendingLocators.length === 1, 'Expected a held locator');
    await outlineRow(page, /Keep original source independent/).click(); await fixture.waitUntil(() => fixture.pendingLocators.length === 2, 'Expected the second held locator');
    fixture.releaseLocators(); await message(page, 'm1').locator('mark').waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
    assert.equal(calls(fixture, api.Operation_GetMessages).filter(call => call.operation.offset >= 12000).length, 0, 'a newer already-loaded selection cancels an older remote locator (replies are handled in order)');
    await loadUntil(page, railPane(page), passageRows, 205);
    assert.ok(calls(fixture, api.Operation_GetPassages).some(call => call.operation.offset === 200 && call.operation.limit === PASSAGE_PAGE));
    fixture.holdLocators = true; await outlineRow(page, /Winning passage beyond the first hundred/).click();
    await fixture.waitUntil(() => fixture.pendingLocators.length === 1, 'Expected a held direct locator');
    const before = await page.evaluate(() => ({ rail: document.querySelector('[data-pane="rail"]').scrollTop, window: scrollY }));
    fixture.releaseLocators(); await message(page, 'm12065').locator('mark').waitFor();
    assert.equal(await message(page, 'm12065').locator('mark').textContent(), 'Synthetic');
    assert.deepEqual(await page.evaluate(() => ({ rail: document.querySelector('[data-pane="rail"]').scrollTop, window: scrollY })), before, 'passage navigation scrolls only the transcript pane');
    const reads = calls(fixture, api.Operation_GetMessages).map(call => call.operation);
    assert.ok(reads.some(operation => operation.offset === 12040)); assert.ok(reads.length <= 6, 'the locator does not scan through earlier messages');
    assert.ok(reads.every(operation => operation.limit === MESSAGE_PAGE && operation.view.revision === 1 && operation.view.generationId === fixture.view.generationId));
    const loaded = await messages(page).count(); await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(count => document.querySelectorAll('[data-pane="transcript"] [data-message-id]').length > count, loaded);
    assert.equal(await page.getByRole('button', { name: /Next passages|Previous passages|Load more/ }).count(), 0, 'no manual paging controls');
  });
  await run('bounded passage pages reach a late winner with a pinned locator; a reconnect starts from a fresh first page', { configure: fixture => { fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; } }, async ({ page, fixture }) => {
    await ready(page); await loadUntil(page, railPane(page), passageRows, PASSAGE_PAGE); await loadUntil(page, railPane(page), passageRows, 200);
    await outlineRow(page, /Winning passage beyond the first hundred/).click(); await message(page, 'm65').locator('mark').waitFor();
    assert.equal(await message(page, 'm65').locator('mark').textContent(), 'Synthetic');
    assert.ok(calls(fixture, api.Operation_GetPassages).some(call => call.operation.offset === 160 && call.operation.limit === PASSAGE_PAGE));
    assert.ok(calls(fixture, api.Operation_LocateMessage).some(call => call.operation.messageId === 'm65'), 'off-page navigation uses the locator, not a source scan');
    await loadUntil(page, railPane(page), passageRows, 205); await page.getByText('End of outline · 205 passages', { exact: true }).waitFor();
    assert.deepEqual(calls(fixture, api.Operation_GetPassages).map(call => call.operation.offset), [0, 40, 80, 120, 160, 200]);
    // The reconnect remounts the page (the shell shows "Reconnecting" meanwhile): its outline starts from a fresh first page
    // and the passage selected in the address is restored through further bounded pages, without scrolling.
    const reconnect = fixture.calls.length; fixture.restart();
    await outlineRow(page, /Winning passage beyond the first hundred/).and(page.locator('[aria-current="true"]')).waitFor();
    assert.deepEqual(fixture.calls.slice(reconnect).filter(call => call.operation instanceof api.Operation_GetPassages).map(call => [call.operation.offset, call.operation.limit]), [0, 40, 80, 120, 160].map(offset => [offset, PASSAGE_PAGE]));
    await outlineRow(page, /Winning passage beyond the first hundred/).click(); await message(page, 'm65').locator('mark').waitFor();
  });
  const goal50 = (options = {}) => ({ Fixture: Goal50Fixture, page: 'goal50.html', ...options });
  await run('A to B to A are three logical passages with intramessage UTF-8 boundaries over unchanged source', goal50({ configure: fixture => { fixture.passageMode = 'logical'; } }), async ({ page, fixture }) => {
    await ready(page); await outlineRows(page).nth(2).waitFor();
    assert.deepEqual(await outlineRows(page).locator('.outline-title').allTextContents(), ['A problem', 'B problem', 'A problem']);
    await outlineRows(page).nth(1).click();
    await page.getByRole('region', { name: 'Selected passage source spans', exact: true }).getByRole('button', { name: /UTF-8 bytes \[29, 36\)/ }).waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
    assert.equal(await message(page, 'm1').locator('pre').textContent(), fixture.messagesAt(1)[0].text);
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetPassages || call.operation instanceof api.Operation_GetPassageSpans).every(call => call.operation.view.revision === 1 && call.operation.view.generationId === fixture.view.generationId && call.operation.limit === PASSAGE_PAGE));
    assert.equal(calls(fixture, api.Operation_GetChunks).length, 0);
  });
  await run('a long logical passage uses bounded span pages and an exact locator on its past generation', goal50({ configure: fixture => { fixture.passageMode = 'long'; fixture.resumedSource = true; } }), async ({ page, fixture }) => {
    await ready(page); await outlineRows(page).first().click();
    const spans = page.getByRole('region', { name: 'Selected passage source spans', exact: true });
    await spans.getByRole('button', { name: /#0 m1 / }).waitFor(); assert.equal(await spans.locator('li').count(), 40);
    await spans.getByRole('button', { name: 'Next span page', exact: true }).click(); await spans.getByRole('button', { name: /#40 m41 / }).waitFor(); assert.equal(await spans.locator('li').count(), 40);
    await spans.getByRole('button', { name: 'Next span page', exact: true }).click(); await spans.getByRole('button', { name: /#84 m85 / }).click(); await message(page, 'm85').waitFor(); assert.equal(await spans.locator('li').count(), 5);
    const location = calls(fixture, api.Operation_LocateMessage).at(-1).operation; assert.equal(location.messageId, 'm85'); assert.equal(location.view.revision, 1);
    assert.equal(await message(page, 'm85').locator('pre').textContent(), fixture.messagesAt(1)[84].text);
    assert.ok(calls(fixture, api.Operation_GetPassageSpans).every(call => call.operation.limit === PASSAGE_PAGE));
    assert.equal(await infoValue(page, 'Viewing'), 'source r1');
  });
  await run('unverified problem metadata keeps the source readable without a legacy fallback', goal50({ configure: fixture => { fixture.passageMode = 'unverified'; } }), async ({ page, fixture }) => {
    await ready(page); await page.getByText('Problem metadata unavailable. Original source remains readable; no legacy annotation fallback is used.', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Legacy annotations ·/).count(), 0); assert.equal(await page.getByRole('button', { name: 'Read existing annotations', exact: true }).count(), 0);
    assert.equal(calls(fixture, api.Operation_GetChunks).length, 0);
  });
  const retiring = (options = {}) => ({ Fixture: RetiringFixture, page: 'goal50.html', before: async ({ page }) => { await page.clock.install(); }, ...options });
  await run('a zero-problem context-aware publication is indexed, not legacy or unindexed', retiring(), async ({ page, fixture }) => {
    await ready(page); await page.getByText('No problems classified in this published context-aware generation.', { exact: true }).waitFor();
    assert.equal(await page.getByText(/^Unindexed ·/).count(), 0); assert.equal(calls(fixture, api.Operation_GetChunks).length, 0);
  });
  for (const Type of [api.Operation_SearchSessionMessages, api.Operation_LocateMessage, api.Operation_GetPassageSpans]) await run(`a retirement after ${Type.name} moves focus into the notice and keeps keyboard navigation there`, retiring({ configure: fixture => { fixture.contextZero = false; fixture.passageMode = 'logical'; } }), async ({ page, fixture }) => {
    await ready(page);
    if (Type === api.Operation_GetPassageSpans) { const row = outlineRows(page).first(); await row.waitFor(); fixture.retiredType = Type; await row.focus(); await row.press('Enter'); }
    else {
      await showTab(page, 'Find'); await findInput(page).fill('source');
      if (Type === api.Operation_SearchSessionMessages) fixture.retiredType = Type;
      await findInput(page).press('Enter');
      if (Type === api.Operation_LocateMessage) { const target = hit(page, 1, 'm1'); await target.waitFor(); fixture.retiredType = Type; await target.focus(); await target.press('Enter'); }
    }
    const notice = page.getByRole('region', { name: 'Indexed view unavailable', exact: true }); await notice.waitFor();
    const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, insideNotice: document.activeElement.closest('[aria-label="Indexed view unavailable"]') !== null }));
    assert.equal(focus.insideNotice, true, `retired focused content needs an explicit focus destination: ${JSON.stringify(focus)}`);
    await page.keyboard.press('Tab');
    const archived = notice.getByRole('button', { name: 'View archived source r1', exact: true }); assert.equal(await archived.evaluate(button => button === document.activeElement), true);
    await archived.press('Enter'); await ready(page); assert.equal(await infoValue(page, 'Viewing'), 'source r1');
  });
  await run('a retirement does not steal deliberate focus from a surviving control', retiring({ configure: fixture => { fixture.contextZero = false; fixture.passageMode = 'logical'; fixture.holdRetired = true; } }), async ({ page, fixture }) => {
    await ready(page); await showTab(page, 'Find'); await findInput(page).fill('source'); fixture.retiredType = api.Operation_SearchSessionMessages; await findInput(page).press('Enter'); await fixture.waitCall(api.Operation_SearchSessionMessages, 1);
    const back = page.getByRole('button', { name: 'Back', exact: true }); await back.focus(); assert.equal(fixture.retiredReplies.length, 1); fixture.retiredReplies.shift()();
    await page.getByRole('region', { name: 'Indexed view unavailable', exact: true }).waitFor(); assert.equal(await back.evaluate(button => button === document.activeElement), true);
  });
  for (const Type of [api.Operation_GetSession, api.Operation_GetPassages, api.Operation_GetMessages, api.Operation_SearchSessionMessages, api.Operation_LocateMessage, api.Operation_GetPassageSpans]) await run(`a retired indexed pin from ${Type.name} clears the old view and needs an explicit same-revision source action`, retiring({ configure: fixture => { fixture.contextZero = false; fixture.passageMode = 'logical'; if (Type === api.Operation_GetSession || Type === api.Operation_GetPassages || Type === api.Operation_GetMessages) fixture.retiredType = Type; } }), async ({ page, fixture }) => {
    await main(page).waitFor();
    if (Type === api.Operation_SearchSessionMessages || Type === api.Operation_LocateMessage) {
      await ready(page); await showTab(page, 'Find'); await findInput(page).fill('source');
      if (Type === api.Operation_SearchSessionMessages) fixture.retiredType = Type;
      await finder(page).getByRole('button', { name: 'Find messages', exact: true }).click();
      if (Type === api.Operation_LocateMessage) { await hit(page, 1, 'm1').waitFor(); fixture.retiredType = Type; await hit(page, 1, 'm1').click(); }
    } else if (Type === api.Operation_GetPassageSpans) { await ready(page); await outlineRows(page).first().waitFor(); fixture.retiredType = Type; await outlineRows(page).first().click(); }
    await page.getByText('This indexed view is unavailable because its derived generation was retired.', { exact: true }).waitFor();
    assert.equal(await hitList(page).count(), 0); assert.equal(await messages(page).count(), 0); assert.equal(calls(fixture, api.Operation_GetRaw).length, 0);
    await page.getByRole('button', { name: 'View archived source r1', exact: true }).click(); await ready(page);
    assert.equal(await infoValue(page, 'Viewing'), 'source r1');
    const last = calls(fixture, api.Operation_GetMessages).at(-1).operation; assert.equal(last.view.revision, 1); assert.equal(last.view.generationId, undefined);
  });

  // ── Source pins and access (was run.mjs, ux.mjs) ──
  await run('normalized source and passages stay pinned to their revision and generation without raw reads; a reconnect re-reads the same pin', { configure: fixture => { fixture.resumedSource = true; fixture.annotationCount = 45; fixture.rawDenied = false; } }, async ({ page, fixture }) => {
    await ready(page); await message(page, 'm1').locator('pre').waitFor();
    assert.match(await message(page, 'm1').locator('pre').textContent(), /original 猫🦄 source/, 'an r1 annotation resolves immutable r1 text, not changed HEAD r2 text under a reused message id');
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.view.revision === 1 && call.operation.view.generationId === fixture.viewAt(1).generationId));
    await outlineRow(page, /Keep original source independent/).click(); await message(page, 'm1').locator('mark').waitFor();
    assert.equal(await message(page, 'm1').locator('mark').textContent(), '猫🦄');
    fixture.publishedRevision = 2;
    await loadUntil(page, railPane(page), passageRows, 45);
    assert.ok(calls(fixture, api.Operation_GetPassages).every(call => call.operation.view.revision === 1 && call.operation.view.generationId === fixture.viewAt(1).generationId), 'a new publication does not substitute another generation into the pinned outline');
    await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: pane.scrollHeight, behavior: 'instant' }));
    await message(page, 'm41').locator('pre').waitFor(); assert.match(await message(page, 'm41').locator('pre').textContent(), /Synthetic source message 41/);
    assert.equal(await page.getByRole('button', { name: /Request raw records|raw source/i }).count(), 0);
    const reads = calls(fixture, api.Operation_GetMessages).length; fixture.restart();
    await fixture.waitUntil(() => calls(fixture, api.Operation_GetMessages).length > reads, 'Expected the pinned messages to be read again after the reconnect'); await ready(page); assert.match(await message(page, 'm1').locator('pre').textContent(), /original 猫🦄 source/);
    assert.equal(await infoValue(page, 'Viewing'), 'source r1');
    assert.equal(calls(fixture, api.Operation_GetRaw).length, 0, 'the Raw scope does not expose raw dashboard reads');
  });
  await run('the explicit latest archive is independent of indexing; generation-mismatched annotations stay hidden until an explicit recheck', { configure: fixture => { fixture.resumedSource = true; fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; fixture.rawDenied = false; } }, async ({ page, fixture }) => {
    await ready(page); await sessionMenu(page, 'Go to latest archive');
    await page.locator('.session-meta').filter({ hasText: 'source r2' }).waitFor(); await ready(page);
    assert.equal(await infoValue(page, 'Annotations'), 'Archive-only view · no annotations');
    await message(page, 'm1').locator('pre').filter({ hasText: /HEAD r2 changed/ }).waitFor();
    await showTab(page, 'Outline'); await page.getByText('Unindexed · no published passages for this source view.', { exact: true }).waitFor(); assert.equal(await outlineRows(page).count(), 0);
    assert.equal(calls(fixture, api.Operation_GetRaw).length, 0); assert.equal(calls(fixture, api.Operation_GetMessages).at(-1).operation.view.generationId, undefined);
    fixture.publishedRevision = 2; await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: pane.scrollHeight, behavior: 'instant' })); await message(page, 'm41').waitFor();
    assert.equal(await outlineRows(page).count(), 0, 'same-revision annotations of a new publication do not enter the archive-only view');
    await recheck(page); await ready(page);
    await loadUntil(page, railPane(page), passageRows, 200); await outlineRow(page, /Winning passage beyond the first hundred/).waitFor();
    assert.equal(calls(fixture, api.Operation_GetPassages).at(-1).operation.view.generationId, fixture.viewAt(2).generationId);
  });
  for (const rawScope of [false, true]) await run(`normalized-only source with the Raw scope ${rawScope}; a source denial clears the pinned messages without a raw fallback`, { configure: fixture => {
    fixture.user = new api.UserInfo('alice', 'alice', rawScope ? [api.Scope.Read, api.Scope.Raw] : [api.Scope.Read]); fixture.sourceDenied = false;
    fixture.goal50Operation = (operation, _envelope, send) => { if (fixture.sourceDenied && operation instanceof api.Operation_GetMessages) { send(new api.Result_Error(new api.Failure('forbidden', 'Selected normalized source access denied'))); return true; } return false; };
  } }, async ({ page, fixture }) => {
    await ready(page); assert.equal(await page.getByRole('button', { name: /Request raw records|Back to messages|raw source/i }).count(), 0);
    fixture.sourceDenied = true; await recheck(page);
    await page.getByRole('alert').filter({ hasText: 'Selected normalized source access denied' }).waitFor();
    assert.equal(await messages(page).count(), 0); assert.equal(calls(fixture, api.Operation_GetRaw).length, 0);
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.view.revision === 1 && call.operation.view.generationId === fixture.viewAt(1).generationId));
  });
  for (const kind of ['messages', 'chunks']) await run(`a mismatched ${kind} response pin fails closed before rendering source content`, { configure: fixture => { fixture.resumedSource = true; fixture.rawDenied = false; if (kind === 'messages') fixture.messageViewOverride = fixture.viewAt(2); else fixture.chunksViewOverride = fixture.viewAt(2); } }, async ({ page }) => {
    await main(page).waitFor(); await page.getByRole('alert').filter({ hasText: 'Source revision or annotation generation changed unexpectedly' }).first().waitFor();
    assert.equal(await (kind === 'messages' ? messages(page) : outlineRows(page)).count(), 0);
  });
  await run('the highest known HEAD wins over late older snapshots without repinning; a new connection does not inherit it', { configure: fixture => { fixture.headRevision = 3; fixture.sessionHeadSnapshot = 3; } }, async ({ page, fixture }) => {
    await ready(page); assert.equal(await infoValue(page, 'Published'), 'HEAD r3 / index r1');
    fixture.sessionHeadSnapshot = 4; await recheck(page); await ready(page); assert.equal(await infoValue(page, 'Published'), 'HEAD r4 / index r1');
    fixture.sessionHeadSnapshot = 3; const reads = calls(fixture, api.Operation_GetSession).length; await recheck(page);
    await fixture.waitUntil(() => calls(fixture, api.Operation_GetSession).length > reads, 'Expected the session to be read again'); await ready(page);
    assert.equal(await infoValue(page, 'Published'), 'HEAD r4 / index r1', 'a late older snapshot cannot downgrade the known HEAD');
    assert.equal(await infoValue(page, 'Viewing'), 'source r1');
    assert.ok(calls(fixture, api.Operation_GetMessages).every(call => call.operation.view.revision === 1), 'learning HEAD r4 never navigates the pinned view');
    await sessionMenu(page, 'Go to latest archive'); await page.locator('.session-meta').filter({ hasText: 'source r4' }).waitFor();
    assert.ok(calls(fixture, api.Operation_GetSession).some(call => call.operation.view?.revision === 4 && call.operation.view.generationId === undefined), 'Latest requests the highest known archive-only HEAD');
    fixture.sessionHeadSnapshot = 2; fixture.restart(); await page.locator('.session-meta .chip[title*="HEAD r2 "]').waitFor();
    assert.equal(await infoValue(page, 'Published'), 'HEAD r2 / index r1', 'a new connection cannot inherit the earlier high-water mark');
  });
  await run('Info shows the recorded agent and yolo-profile claims of each session', goal50({ configure: fixture => {
    fixture.archiveRows = [fixture.archiveAt(0), fixture.archiveAt(1)].map((row, index) => row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title: index === 0 ? 'Subagent title without recorded ID' : 'Main title with recorded subagent', producer: 'synthetic-harness', model: 'recorded-source-model' }), source: row.head.source.with({ format: index === 0 ? api.SourceFormat.Historian : api.SourceFormat.Pi, subagentId: index === 0 ? undefined : 'recorded-child', discoveryRootId: index === 0 ? 'yolo:Named_1.2' : 'native' }) }) }));
  } }), async ({ page, fixture }) => {
    for (const [index, expected, format] of [[0, 'Main · no recorded subagent ID', 'Historian'], [1, 'Subagent · recorded-child', 'Pi']]) {
      const row = fixture.authorizedRows[index];
      if (index === 1) await page.evaluate(target => { location.hash = target; }, `#/session/${row.head.id}?${rowPin(fixture, 1)}`);
      await page.getByRole('heading', { level: 1, name: row.head.metadata.title, exact: true }).waitFor();
      assert.equal(await infoValue(page, 'Recorded agent'), expected);
      assert.equal(await infoValue(page, 'Recorded yolo profile'), index === 0 ? 'Named_1.2' : 'not recorded');
      assert.equal(await infoValue(page, 'Producer'), 'synthetic-harness'); assert.equal(await infoValue(page, 'Source format'), format); assert.equal(await infoValue(page, 'Recorded source model'), 'recorded-source-model');
    }
  });
  // Raw download (ingest-c spec §1.6): /api/raw answers as the server does (manifest; bytes with its headers; cookie only).
  const RAW_FILES = [Buffer.from('{"type":"session","id":"synthetic-first"}\n'), Buffer.from(`${Array.from({ length: 64 }, (_, n) => `{"n":${n},"text":"猫🦄 synthetic raw line"}\r\n`).join('')}{"tail":"no final newline"}`)];
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  await run('Info links the raw files of the viewed revision, the browser saves their exact bytes, and a revision without raw shows a state', { before: async ({ context, fixture }) => {
    await context.addCookies([{ name: 'chronicle_session', value: 'synthetic', url: origin, httpOnly: true, sameSite: 'Strict' }]);
    fixture.rawRequests = [];
    rawServer.handle = (request, response) => {
      const url = new URL(request.url, origin), [sessionId, revision, file, ...rest] = url.pathname.split('/').slice(3);
      fixture.rawRequests.push(`${request.method} ${url.pathname}${url.search}`);
      const failure = (status, code, message) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ code, message }));
      if (request.headers.cookie !== 'chronicle_session=synthetic') return failure(401, 'unauthorized', 'Sign in');
      if (sessionId !== fixture.session.id || revision !== String(fixture.view.revision) || rest.length > 0) return failure(404, 'not-found', 'Raw source not found');
      if (file === undefined) return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ sessionId, revision: fixture.view.revision, files: RAW_FILES.map((bytes, index) => ({ index, path: `synthetic/part-${index + 1}.jsonl`, sha256: sha256(bytes), bytes: String(bytes.length) })) }));
      const bytes = RAW_FILES[Number(file)];
      if (bytes === undefined) return failure(404, 'not-found', 'Raw source not found');
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="chronicle-${sessionId}-r${revision}-f${file}.jsonl"`, ETag: `"sha256:${sha256(bytes)}"`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(bytes);
    };
  } }, async ({ page, fixture }) => {
    await ready(page);
    assert.deepEqual(fixture.rawRequests, [], 'nothing is read before Info is shown');
    const pinned = fixture.view.revision, base = `/api/raw/${fixture.session.id}`;
    assert.notEqual(pinned, fixture.headRevision, 'the scene views an older revision than HEAD');
    await showTab(page, 'Info');
    const raw = sidePane(page).locator('dt').filter({ hasText: /^Raw$/ }).locator('xpath=following-sibling::dd[1]'), second = raw.getByRole('link', { name: 'Download file 2 of 2', exact: true });
    await second.waitFor();
    assert.deepEqual(await raw.getByRole('link').evaluateAll(links => links.map(link => [link.getAttribute('href'), link.hasAttribute('download')])), [[`${base}/${pinned}/0`, true], [`${base}/${pinned}/1`, true]], 'one download link per file of the pinned revision, not HEAD');
    assert.equal(await raw.textContent(), 'Download file 1 of 2 (42 B)synthetic/part-1.jsonlDownload file 2 of 2 (2.89 KiB)synthetic/part-2.jsonl');
    assert.equal(await raw.getByText('(2.89 KiB)', { exact: true }).getAttribute('title'), '2,961 bytes', 'the exact size is the tooltip');
    const [download] = await Promise.all([page.waitForEvent('download'), second.click()]);
    assert.equal(sha256(await readFile(await download.path())), sha256(RAW_FILES[1]), 'the saved file is byte-exact');
    assert.equal(download.suggestedFilename(), `chronicle-${fixture.session.id}-r${pinned}-f1.jsonl`);
    assert.deepEqual(fixture.rawRequests, [`GET ${base}/${pinned}`, `GET ${base}/${pinned}/1`], 'one manifest read, then the bytes, both with the session cookie');
    await sessionMenu(page, 'Go to latest archive'); await page.locator('.session-meta').filter({ hasText: `source r${fixture.headRevision}` }).waitFor();
    await raw.getByText('Not available for this revision', { exact: true }).waitFor();
    assert.equal(await raw.getByRole('link').count(), 0, 'no link to a revision the server does not offer');
    assert.equal(fixture.rawRequests.at(-1), `GET ${base}/${fixture.headRevision}`, 'the manifest follows the viewed revision');
    rawServer.handle = null;
  });

  // ── Lifecycle: account, connection and background activity (was run.mjs, theme-retry.mjs, refresh-regression.mjs) ──
  for (const mode of ['unauthorized', 'version']) await run(`${mode === 'version' ? 'update-required' : 'unauthorized'} clears the session content and stops without a reconnect loop`, { before: async ({ page }) => { await pauseClock(page); } }, async ({ page, fixture }) => {
    await ready(page); fixture.mode = mode; fixture.restart();
    const terminal = mode === 'version' ? page.locator('.connection-widget[data-state="update-required"]') : page.locator('main[data-account-auth]');
    await advanceClockUntil(page, async () => await terminal.count() === 1, retryBudgetMillis(connectionConfig), 'the connection did not reach its terminal state');
    const sockets = fixture.sockets.length;
    await advanceClock(page, connectionConfig.retryCap + 2 * connectionConfig.connectTimeout);
    assert.equal(fixture.sockets.length, sockets); assert.equal(await page.locator('[data-message-id], [data-passage-id]').count(), 0); assert.equal(await main(page).count(), 0);
  });
  for (const transition of ['logout-bob', 'observed-bob', 'logout-alice']) await run(`${transition}: the previous account's session is never read in the new session`, {}, async ({ page, fixture }) => {
    await ready(page);
    const boundary = fixture.requests.length, nextUser = transition === 'logout-alice' ? 'alice' : 'bob';
    if (transition === 'observed-bob') { fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart(); }
    else {
      await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: /^Sign in/ }).waitFor();
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill(nextUser); await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.getByRole('button', { name: nextUser, exact: true }).waitFor(); await page.getByRole('main', { name: 'Search', exact: true }).waitFor();
    assert.equal(await main(page).count(), 0); assert.match(await hash(page), /^#\/search/, 'the new session starts at the default route');
    assert.equal(fixture.requests.slice(boundary).filter(request => request.userId === nextUser && request.envelope.operation instanceof api.Operation_GetSession).length, 0, 'the prior source selection is not read in the new account or session');
  });
  await run('a silent connection resyncs and the session is read again; page restore and a server restart keep it', { before: async ({ page }) => { await page.clock.install(); } }, async ({ page, fixture }) => {
    await ready(page); const reads = calls(fixture, api.Operation_GetSession).length; fixture.blackholeActive();
    await advanceClock(page, connectionConfig.heartbeatInterval + connectionConfig.pongTimeout);
    await page.locator('.event-log li').filter({ hasText: /STALE \((matching pong deadline|request timeout)\)/ }).waitFor({ state: 'attached' });
    await page.locator('.connection-widget[data-state="live"]').waitFor();
    await fixture.waitUntil(() => calls(fixture, api.Operation_GetSession).length > reads, 'Expected the session to be read again after the resync'); await ready(page);
    const restored = calls(fixture, api.Operation_GetSession).length;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await fixture.waitUntil(() => calls(fixture, api.Operation_GetSession).length > restored, 'Expected the session to be read again after the page restore'); await ready(page);
    const restarted = calls(fixture, api.Operation_GetSession).length; fixture.restart();
    await fixture.waitUntil(() => calls(fixture, api.Operation_GetSession).length > restarted, 'Expected the session to be read again after the restart');
    await page.getByRole('heading', { level: 1, name: 'Following the migration thread', exact: true }).waitFor(); await ready(page);
  });
  await run('a theme change from another tab keeps the session scroll, focus, DOM and pin without requests', { configure: fixture => { fixture.messageCount = 87; }, before: async ({ page }) => { await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') }); await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z')); } }, async ({ context, page, fixture }) => {
    await ready(page); await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: 320, behavior: 'instant' }));
    const first = await messages(page).first().elementHandle(), chip = await page.locator('.session-meta .chip').getAttribute('title'), requests = fixture.calls.length;
    const back = page.getByRole('button', { name: 'Back', exact: true }); await back.focus(); const scroll = await transcriptPane(page).evaluate(pane => pane.scrollTop);
    const other = await context.newPage(); await other.goto(`${origin}/theme-init.js`); await other.evaluate(key => localStorage.setItem(key, 'dark'), THEME_KEY);
    await page.waitForFunction(() => document.documentElement.dataset.themeChoice === 'dark');
    assert.equal(await back.evaluate(element => element === document.activeElement), true);
    assert.equal(await transcriptPane(page).evaluate(pane => pane.scrollTop), scroll);
    assert.equal(await first.evaluate(element => element.isConnected && element === document.querySelector('[data-pane="transcript"] [data-message-id]')), true);
    assert.equal(await page.locator('.session-meta .chip').getAttribute('title'), chip); assert.equal(fixture.calls.length, requests);
  });
  await run('background polling of the retained list and heartbeats leave the session transcript, its scroll and its reads unchanged', { hash: () => '#/archive', before: async ({ page }) => { await page.clock.install(); } }, async ({ page, fixture }) => {
    await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.evaluate(target => { location.hash = target; }, sessionHash(fixture, rowPin(fixture, 0))); await ready(page); await message(page, 'm40').waitFor();
    await transcriptPane(page).evaluate(pane => pane.scrollTo({ top: 1400, behavior: 'instant' }));
    const node = await message(page, 'm1').elementHandle(), top = await transcriptPane(page).evaluate(pane => pane.scrollTop);
    const sourceReads = () => fixture.calls.filter(call => [api.Operation_GetSession, api.Operation_GetMessages, api.Operation_GetPassages, api.Operation_LocateMessage].some(Type => call.operation instanceof Type)).length, before = sourceReads();
    await advanceClock(page, ARCHIVE_REFRESH_MS + connectionConfig.heartbeatInterval);
    assert.equal(await node.evaluate(element => element.isConnected && element === document.getElementById('message-m1')), true);
    assert.ok(Math.abs(await transcriptPane(page).evaluate(pane => pane.scrollTop) - top) <= SCROLL_TOLERANCE);
    assert.equal(sourceReads(), before, 'elapsed time does not re-read or navigate the session');
  });
  // ── Opened from Search (one document: the real Search view links to the page) ──
  const fromSearch = configure => ({ Fixture: SearchFixture, page: 'goal50.html', hash: () => '#/search', configure });
  async function openFromSearch(page, name) {
    const search = page.getByRole('main', { name: 'Search', exact: true });
    await search.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('mode:semantic source'); await search.getByRole('button', { name: 'Search', exact: true }).click();
    await search.locator('[data-row-id]').first().getByRole('link', { name, exact: true }).click(); await main(page).waitFor();
  }
  const pinnedTo = (operation, view) => operation.view !== undefined && operation.view.revision === view.revision && operation.view.generationId === view.generationId;
  // The first match lands on the last bytes of m65, far beyond the folded preview of that long message.
  const LATE_MATCH = 'continued source';
  function lateMatch(fixture) {
    const text = fixture.messagesAt(fixture.view.revision)[64].text, start = Buffer.byteLength(text.slice(0, text.lastIndexOf(LATE_MATCH)));
    fixture.archiveSearchTransform = result => result.with({ evidence: result.evidence.map(evidence => evidence.with({ matches: evidence.matches.map((match, index) => index === 0 ? match.with({ span: new api.Span('m65', start, start + Buffer.byteLength(LATE_MATCH)) }) : match) })) });
  }
  await run('a Search link carries the revision, generation, message, matched bytes and Find text, and the page lands exactly there: unfolded, highlighted, focused', fromSearch(lateMatch), async ({ page, fixture }) => {
    await openFromSearch(page, 'Open at first match'); await ready(page); await waitTop(page, 'm65');
    const landed = message(page, 'm65');
    assert.equal(await landed.locator('mark').textContent(), LATE_MATCH, 'exactly the matched bytes are highlighted');
    assert.equal(await landed.locator('.msg-fold').count(), 0, 'the message is unfolded'); assert.equal(await landed.getByRole('button', { name: 'Show full message', exact: true }).count(), 0);
    assert.equal(await landed.getAttribute('aria-current'), 'location');
    await page.waitForFunction(() => document.activeElement?.classList.contains('find-landing') === true);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Search result · message 65 · m65', 'the landing marker takes the focus');
    assert.match(await page.getByRole('status', { name: 'Source navigation status', exact: true }).textContent(), /^Search result: found matching message 65 · m65/);
    assert.ok(calls(fixture, api.Operation_GetSession).every(call => pinnedTo(call.operation, fixture.view)), 'the session is read at the linked pin only');
    const located = calls(fixture, api.Operation_LocateMessage).at(-1).operation;
    assert.equal(located.messageId, 'm65'); assert.ok(pinnedTo(located, fixture.view), 'the linked message is located in the linked view');
    await fixture.waitCall(api.Operation_SearchSessionMessages, 1); const literal = calls(fixture, api.Operation_SearchSessionMessages)[0].operation;
    assert.equal(literal.literal, 'source'); assert.ok(pinnedTo(literal, fixture.view), 'the Find text runs once on arrival, in the linked view'); assert.equal(await findInput(page).inputValue(), 'source');
    await page.waitForFunction(() => /matching messages/.test(document.querySelector('[aria-label="Find status"]')?.textContent ?? ''));
    assert.match(await findStatus(page).textContent(), /^0 matching messages · end of matches$/, 'the arrival Find keeps its result: the landing at `at` does not discard it');
    assert.doesNotMatch(await hash(page), /find=|span=/, 'the Find text and the matched bytes are not kept in the address');
  });
  await run('a link to a retired generation shows the unavailable state, never stale or default-view content', fromSearch(fixture => { fixture.conversationFailure = operation => operation.view !== undefined && operation.view.generationId !== undefined ? 'indexed-view-retired' : null; }), async ({ page, fixture }) => {
    await openFromSearch(page, 'Search conversation 1'); await main(page).getByRole('region', { name: 'Indexed view unavailable', exact: true }).waitFor();
    assert.equal(await page.locator('[data-message-id]').count(), 0, 'no transcript content');
    assert.deepEqual(calls(fixture, api.Operation_GetSession).map(call => call.operation.view === undefined ? 'default view' : [call.operation.view.revision, call.operation.view.generationId]), [[fixture.view.revision, fixture.view.generationId]], 'no read of another view');
    assert.equal(calls(fixture, api.Operation_GetMessages).length, 0);
    await main(page).getByRole('button', { name: `View archived source r${fixture.view.revision}`, exact: true }).waitFor();
  });
} finally { await browser.close(); await server.close(); }
console.log(`PASS session: ${cases} cases`);
