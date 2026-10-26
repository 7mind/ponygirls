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
    await context.close();
    console.log('PASS browser: resource refresh, identity, invalidation and stale-response lifecycle');
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const fixture = new ChronicleFixture();
  await fixture.install(page);
  await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`);
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('original source');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.search-hit').click();
  await page.locator('#message-m1 pre').waitFor();
  await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
  await page.locator('#message-m1 mark').waitFor();
  await page.waitForTimeout(400);
  const before = fixture.searchCount;
  await page.evaluate(() => {
    window.scrollTo({ top: 1400, behavior: 'instant' });
    const hit = document.querySelector('.search-hit'), message = document.querySelector('#message-m1');
    if (hit === null || message === null || window.scrollY < 400) throw new Error('Refresh reproduction precondition failed');
    const original = Element.prototype.scrollIntoView;
    const probe = { hit, message, top: window.scrollY, scrollCalls: 0 };
    window.refreshProbe = probe;
    Element.prototype.scrollIntoView = function (...args) { probe.scrollCalls++; return original.apply(this, args); };
  });
  for (let attempt = 0; fixture.searchCount === before && attempt < 230; attempt++) await page.waitForTimeout(100);
  assert.ok(fixture.searchCount > before, 'periodic Archive poll must have run');
  await page.locator('#message-m1 mark').waitFor();
  await page.waitForTimeout(400);
  const observed = await page.evaluate(() => ({
    sameRow: window.refreshProbe.hit === document.querySelector('.search-hit'),
    sameMessage: window.refreshProbe.message === document.querySelector('#message-m1'),
    sameScroll: Math.abs(window.refreshProbe.top - window.scrollY) <= 1,
    scrollCalls: window.refreshProbe.scrollCalls,
  }));
  assert.deepEqual(observed, { sameRow: true, sameMessage: true, sameScroll: true, scrollCalls: 0 }, 'same-account periodic refresh must preserve rendered nodes and user scroll, and must not perform passage navigation');
  await context.close();
  console.log('PASS browser: periodic authorized refresh preserves DOM identity and user scroll');
} finally { await browser.close(); await server.close(); }
