import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture } from './fixture.mjs';

// Regression: Behavioral-Active Blackbox / Good Communication; synthetic source only.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; browser downloads are disabled.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const browser = await chromium.launch({ headless: true });
try {
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/resources.html`);
    const request = id => page.getByRole('region', { name: `Request ${id}`, exact: true });
    const data = page.getByLabel('Resource data', { exact: true }), error = page.getByLabel('Resource error', { exact: true });
    await request(0).getByRole('button', { name: 'Resolve', exact: true }).click();
    await data.filter({ hasText: /^response-0$/ }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await request(1).waitFor();
    assert.equal(await data.textContent(), 'response-0', 'same-identity refresh retains authorized data');
    assert.equal(await page.getByLabel('Resource loading', { exact: true }).textContent(), 'false');
    assert.equal(await page.getByLabel('Resource refreshing', { exact: true }).textContent(), 'true');
    await page.getByRole('button', { name: 'Change identity', exact: true }).click();
    await request(2).waitFor();
    assert.equal(await data.textContent(), 'empty', 'identity changes clear before resolving the new read');
    await request(1).getByRole('button', { name: 'Resolve', exact: true }).click();
    assert.equal(await data.textContent(), 'empty', 'late prior-identity success is ignored');
    await request(2).getByRole('button', { name: 'Resolve', exact: true }).click();
    await data.filter({ hasText: /^response-2$/ }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await request(3).waitFor();
    await page.getByRole('button', { name: 'Invalidate', exact: true }).click();
    assert.equal(await data.textContent(), 'empty', 'explicit invalidation clears protected data immediately');
    await request(3).getByRole('button', { name: 'Reject', exact: true }).click();
    assert.equal(await error.textContent(), 'none', 'late rejection cannot mutate invalidated state');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await request(4).getByRole('button', { name: 'Reject', exact: true }).click();
    await error.filter({ hasText: /^failure-4$/ }).waitFor();
    assert.equal(await data.textContent(), 'empty', 'current denied/failed reads do not retain prior data');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await request(5).getByRole('button', { name: 'Resolve', exact: true }).click();
    await data.filter({ hasText: /^response-5$/ }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await request(6).waitFor();
    assert.equal(await data.textContent(), 'response-5');
    await request(6).getByRole('button', { name: 'Reject', exact: true }).click();
    await error.filter({ hasText: /^failure-6$/ }).waitFor();
    assert.equal(await data.textContent(), 'empty', 'a failed current refresh clears previously retained non-null data');
    await context.close();
    console.log('PASS browser: resource refresh, identity, invalidation and stale-response lifecycle');
  }
  {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/resources.html?infinite`);
    const request = id => page.getByRole('region', { name: `Page request ${id}`, exact: true });
    await request(0).getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByRole('button', { name: 'Load edge', exact: true }).click(); await request(1).waitFor();
    await page.getByRole('button', { name: 'Arrivals refresh', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('section[aria-label^="Page request"]').count(), 2, 'polling must coalesce behind an in-flight page rather than repeatedly aborting long loaded-chain refreshes');
    await request(1).getByRole('button', { name: 'Resolve', exact: true }).click();
    await request(2).getByRole('button', { name: 'Resolve', exact: true }).click();
    await request(3).getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByLabel('Pending updates', { exact: true }).filter({ hasText: /^true$/ }).waitFor();
    await context.close();
  }
  {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/resources.html?infinite`);
    const request = id => page.getByRole('region', { name: `Page request ${id}`, exact: true });
    const ids = () => page.locator('[data-item-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-item-id')));
    await request(0).getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByRole('button', { name: 'Load edge', exact: true }).click();
    await request(1).getByRole('button', { name: 'Resolve', exact: true }).click();
    assert.deepEqual(await ids(), ['alice-a', 'alice-b', 'alice-c', 'alice-d']);
    await page.evaluate(() => { const pane = document.querySelector('.fixture-pages'); pane.scrollTop = 200; window.anchorProbe = { node: document.querySelector('[data-item-id="alice-c"]'), top: document.querySelector('[data-item-id="alice-c"]').getBoundingClientRect().top }; });
    await page.getByRole('button', { name: 'alice-c', exact: true }).focus();
    await page.getByRole('button', { name: 'Arrivals refresh', exact: true }).click();
    await request(2).getByRole('button', { name: 'Resolve', exact: true }).click();
    await request(3).waitFor();
    assert.deepEqual(await ids(), ['alice-a', 'alice-b', 'alice-c', 'alice-d'], 'refresh commits its loaded page chain atomically');
    await page.getByRole('button', { name: 'alice-c', exact: true }).focus();
    await request(3).getByRole('button', { name: 'Resolve', exact: true }).evaluate(element => element.click());
    await page.getByLabel('Pending updates', { exact: true }).filter({ hasText: /^true$/ }).waitFor();
    assert.deepEqual(await ids(), ['alice-a', 'alice-b', 'alice-c'], 'fresh chain prunes excluded tail but does not prepend an arrival');
    assert.equal(await page.evaluate(() => window.anchorProbe.node === document.querySelector('[data-item-id="alice-c"]')), true);
    assert.equal(await page.getByRole('button', { name: 'alice-c', exact: true }).evaluate(element => element === document.activeElement), true, 'surviving focus is retained');
    assert.ok(await page.evaluate(() => Math.abs(window.anchorProbe.top - document.querySelector('[data-item-id="alice-c"]').getBoundingClientRect().top) <= 1), 'surviving row anchor is retained across authoritative removal');
    await page.getByRole('button', { name: 'Shrink refresh', exact: true }).click();
    await request(4).getByRole('button', { name: 'Resolve', exact: true }).click();
    await request(5).getByRole('button', { name: 'Resolve', exact: true }).click();
    assert.deepEqual(await ids(), ['alice-a', 'alice-c'], 'successful authorization shrink removes an old interior ID');
    await page.getByRole('button', { name: 'Apply updates', exact: true }).click();
    assert.deepEqual(await ids(), ['alice-a', 'alice-c', 'alice-e'], 'applying latest candidates cannot resurrect a revoked prior candidate');
    await page.getByRole('button', { name: 'Arrivals refresh', exact: true }).click();
    await request(6).getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByLabel('Page error', { exact: true }).filter({ hasText: /^failure-6$/ }).waitFor();
    assert.deepEqual(await ids(), [], 'read failure clears visible and staged protected data');
    assert.equal(await page.getByLabel('Pending updates', { exact: true }).textContent(), 'false');
    await context.close();
  }
  {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/resources.html?infinite`);
    const request = id => page.getByRole('region', { name: `Page request ${id}`, exact: true });
    await request(0).getByRole('button', { name: 'Resolve', exact: true }).click();
    await page.getByRole('button', { name: 'Load edge', exact: true }).click(); await request(1).waitFor();
    await page.getByRole('button', { name: 'Change identity', exact: true }).click();
    await request(2).getByRole('button', { name: 'Resolve', exact: true }).click();
    await request(1).getByRole('button', { name: 'Resolve', exact: true }).click();
    assert.deepEqual(await page.locator('[data-item-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-item-id'))), ['bob-a', 'bob-b'], 'late old cursor append cannot cross identity/key boundaries');
    await page.getByRole('button', { name: 'Arrivals refresh', exact: true }).click(); await request(3).waitFor();
    await page.getByRole('button', { name: 'Invalidate', exact: true }).click();
    await request(3).getByRole('button', { name: 'Reject', exact: true }).click();
    assert.equal(await page.locator('[data-item-id]').count(), 0); assert.equal(await page.getByLabel('Page error', { exact: true }).textContent(), 'none');
    await context.close();
  }
  console.log('PASS browser: infinite chain atomic refresh, authoritative shrink, no prepend, focus/anchor continuity and stale cursor/identity/error guards');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/resources.html?dialog`);
    const opener = page.getByRole('button', { name: 'Open conversation', exact: true });
    await opener.waitFor();
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
    const top = await page.evaluate(() => window.scrollY);
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Synthetic conversation', exact: true });
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds !== null && Math.abs(bounds.width - viewport.width * .9) <= 1 && Math.abs(bounds.height - viewport.height * .9) <= 1, 'dialog occupies 90vw by 90vh');
    assert.equal(await page.getByRole('button', { name: 'Close conversation', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByText('Last dialog details', { exact: true }).evaluate(element => element === document.activeElement), true, 'reverse keyboard traversal includes native summary controls');
    assert.ok(await page.getByText('Last dialog details', { exact: true }).evaluate(element => { const target = element.getBoundingClientRect(), pane = element.closest('.conversation-source').getBoundingClientRect(); return target.top >= pane.top - 1 && target.bottom <= pane.bottom + 1; }), 'wrapped keyboard focus is visible inside its own pane');
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Close conversation', exact: true }).evaluate(element => element === document.activeElement), true, 'native modal traps forward keyboard traversal');
    const scrolling = await page.evaluate(() => {
      const passages = document.querySelector('.conversation-passages'), source = document.querySelector('.conversation-source');
      passages.scrollTop = 100; source.scrollTop = 300;
      return { passages: passages.scrollTop, source: source.scrollTop, body: document.body.style.position, window: window.scrollY, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(scrolling, { passages: 100, source: 300, body: 'fixed', window: 0, overflow: false }, 'panes scroll independently without scrolling or overflowing the locked page');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.scrollY), top, 'closing restores the original page scroll');
    assert.equal(await opener.evaluate(element => element === document.activeElement), true, 'closing restores the opener focus');
    await opener.click(); await dialog.waitFor();
    await page.mouse.click(2, 2); await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.scrollY), top, 'backdrop close restores page scroll');
    await context.close();
  }
  console.log('PASS browser: 90vw/90vh modal, focus trap, escape/backdrop, focus/scroll restore and independent responsive panes');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const fixture = new ChronicleFixture();
  await fixture.install(page);
  await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`);
  await page.getByRole('combobox', { name: 'Search conversations' }).fill('original source');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.archive-row .table-title').first().click();
  await page.locator('#message-m1 pre').waitFor();
  await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
  await page.locator('#message-m1 mark').waitFor();
  await page.waitForTimeout(400);
  const before = fixture.searchCount;
  fixture.holdMessages = true;
  await page.evaluate(() => {
    const pane = document.querySelector('.conversation-source'); pane.scrollTo({ top: 1400, behavior: 'instant' });
    const hit = document.querySelector('.archive-row'), message = document.querySelector('#message-m1');
    if (hit === null || message === null || pane.scrollTop < 400) throw new Error('Refresh reproduction precondition failed');
    const original = Element.prototype.scrollIntoView, scroll = pane.scrollTo;
    const probe = { hit, message, pane, top: pane.scrollTop, scrollCalls: 0 };
    window.refreshProbe = probe;
    Element.prototype.scrollIntoView = function (...args) { probe.scrollCalls++; return original.apply(this, args); };
    pane.scrollTo = function (...args) { probe.scrollCalls++; return scroll.apply(this, args); };
  });
  for (let attempt = 0; fixture.searchCount === before && attempt < 230; attempt++) await page.waitForTimeout(100);
  assert.ok(fixture.searchCount > before, 'periodic Archive poll must have run');
  await page.locator('.transcript[aria-busy="true"]').waitFor();
  assert.ok(fixture.pendingMessages.length > 0, 'hold the refreshed source response before checking continuity');
  fixture.releaseMessages();
  await page.locator('.transcript[aria-busy="false"]').waitFor();
  const observed = await page.evaluate(() => ({
    sameRow: window.refreshProbe.hit === document.querySelector('.archive-row'),
    sameMessage: window.refreshProbe.message === document.querySelector('#message-m1'),
    sameScroll: Math.abs(window.refreshProbe.top - window.refreshProbe.pane.scrollTop) <= 1,
    scrollCalls: window.refreshProbe.scrollCalls,
  }));
  assert.deepEqual(observed, { sameRow: true, sameMessage: true, sameScroll: true, scrollCalls: 0 }, 'same-account periodic refresh must preserve rendered nodes and user scroll, and must not perform passage navigation');
  fixture.archiveExcluded.add(fixture.session.id);
  await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
  await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.locator('.archive-row, .conversation-intro, .original-message').count(), 0, 'successful authorized list shrink clears the excluded row and bound dialog without waiting for a forbidden error');
  await page.locator('.connection-widget[data-state="live"]').waitFor();
  await context.close();
  console.log('PASS browser: periodic authorized refresh preserves DOM identity/scroll; successful membership shrink clears excluded row and modal');
} finally { await browser.close(); await server.close(); }
