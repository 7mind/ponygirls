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
  {
    // Authorization: the Archive view still opens a session in its own dialog. A successful refresh whose authorized list
    // no longer contains the row clears the row and the open session, without waiting for a forbidden source read.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), fixture = new ChronicleFixture();
    await fixture.install(page);
    await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();
    await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await page.locator('.archive-row .table-title').first().click();
    const dialog = page.getByRole('dialog', { name: 'Source conversation', exact: true }); await dialog.waitFor(); await dialog.locator('[data-message-id]').first().waitFor();
    fixture.archiveExcluded.add(fixture.session.id);
    await page.getByRole('button', { name: 'Refresh archive', exact: true }).evaluate(element => element.click());
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.archive-row, [data-message-id]').count(), 0, 'a successful authorized list shrink clears the excluded row and the session bound to it');
    await context.close();
    console.log('PASS browser: successful membership shrink clears the excluded row and its open session');
  }
} finally { await browser.close(); await server.close(); }
