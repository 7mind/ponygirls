// Behavioral-Active Blackbox / Good Communication: rendered tabs with controlled local transport.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const output = fileURLToPath(new URL('../test-results/tab-layout/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true }), errors = [], results = [];
const tabs = ['archive', 'search', 'activity', 'access', 'mcp'];
const junk = [
  'Search updates after you pause',
  'Semantic and hybrid text searches use query embeddings; suggestions do not.',
  'The same conversation expression language as Archive',
  'Manage agent tokens and sharing groups.',
  'Each explicit Run starts empty model history',
];
async function visit(page, tab) {
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: tab, exact: true }).click();
  if (tab === 'activity') await page.locator('.activity-job-row').first().waitFor();
  if (tab === 'access') await page.getByRole('heading', { name: 'Agent tokens', exact: true }).waitFor();
  if (tab === 'mcp') await page.getByRole('region', { name: 'Current MCP test catalog', exact: true }).waitFor();
}
async function metrics(page) {
  return page.locator('main').evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight), outerWidth: box.width, top: box.top + parseFloat(style.paddingTop), documentWidth: document.documentElement.scrollWidth, viewport: innerWidth };
  });
}
try {
  for (const width of [1920, 1440, 850, 768, 390, 320]) for (const theme of ['light', 'dark']) {
    const height = width <= 640 ? 844 : 1000;
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme }), page = await context.newPage(), fixture = new Goal50Fixture();
    page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install(); await fixture.install(page);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`);
    await page.locator('.archive-row').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const archive = await metrics(page), gutter = width <= 640 ? 10 : width <= 850 ? 14 : 22;
    assert.equal(archive.left, gutter); assert.equal(archive.right, width - gutter);
    for (const tab of tabs) {
      await visit(page, tab);
      if (tab === 'mcp' && width <= 640) {
        const run = await page.getByRole('button', { name: 'Run fresh prompt', exact: true }).boundingBox();
        assert.ok(run !== null && run.y + run.height <= height, `Optional tool reference must not push Run below the initial viewport: ${JSON.stringify(run)}`);
      }
      const current = await metrics(page);
      results.push({ tab, width, theme, ...current });
      assert.equal(current.left, archive.left, `${tab} ${width}: left content edge must match Archive`);
      assert.equal(current.right, archive.right, `${tab} ${width}: right content edge must match Archive`);
      assert.equal(current.outerWidth, archive.outerWidth, `${tab} ${width}: outer workspace must match Archive`);
      assert.equal(current.top, archive.top, `${tab} ${width}: top content gutter must match Archive`);
      assert.ok(current.documentWidth <= width, `${tab} ${width}: no document-level overflow: ${JSON.stringify(current)}`);
      assert.equal(await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: tab, exact: true }).getAttribute('aria-current'), 'page');
      if ([1920, 390, 320].includes(width)) await page.screenshot({ path: `${output}/${theme}-${width}-${tab}.png`, fullPage: true });
    }
    for (const tab of tabs) {
      await visit(page, tab);
      for (const text of junk) assert.equal(await page.locator('main').getByText(text, { exact: false }).count(), 0, `${tab}: redundant copy retained: ${text}`);
      assert.equal(await page.locator('main h1').evaluateAll(elements => elements.filter(element => { const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1; }).length), 0, `${tab}: navigation already identifies this tab`);
    }
    assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_StartMcpTest || call.operation instanceof api.Operation_ApplyRetryFailed || call.operation instanceof api.Operation_ApplyOwnerReindex || call.operation instanceof api.Operation_MintToken), false, 'Reviewing tabs must not start a model run or mutate the archive');
    await context.close();
    console.log(`PASS tab layout: ${theme} ${width}, all five tabs`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
}
