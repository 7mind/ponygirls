import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true }), errors = [];
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
async function scene(path = 'notifications', width = 1280, colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme }), page = await context.newPage();
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.clock.install();
  const fixture = new ChronicleFixture(); if (path === 'harness') await fixture.install(page);
  await page.goto(`${origin}/tests-browser/${path}.html`);
  if (path === 'harness') { await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); } else await page.getByRole('heading', { name: 'Notification fixture', exact: true }).waitFor();
  return { context, page, fixture };
}
async function group(name, body) { if (process.env.CHRONICLE_UI_CASE !== undefined && !name.includes(process.env.CHRONICLE_UI_CASE)) return; await body(); console.log(`PASS browser UI controls: ${name}`); }
const notifications = page => page.getByRole('region', { name: 'Notifications', exact: true });
try {
  // Specified: Behavioral-Active Blackbox / Good Communication, real Chromium + controlled mutation transport.
  await group('the application retry action reports routine success through the global toast', async () => {
    const { context, page, fixture } = await scene('harness'); await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'Retry indexing', exact: true }).click(); const toast = notifications(page); await toast.getByRole('status').getByText('Retry indexing job completed.', { exact: true }).waitFor();
    assert.equal(await page.locator('.global-mutation-notices .notice').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_RetryJob).length, 1);
    await page.getByRole('link', { name: 'Archive', exact: true }).click(); assert.equal(await toast.isVisible(), true, 'Changing tabs must not promote a success to an in-page notice or reset it');
    await context.close();
  });
  await group('all controlled tables expose fitting and columns only inside keyboard-accessible vertical three-dots menus in column headers', async () => {
    for (const width of [1280, 390]) {
      const { context, page, fixture } = await scene('harness', width);
      for (const name of ['Conversations', 'Collectors', 'Indexing jobs']) {
        if (name === 'Collectors') { await page.getByRole('link', { name: 'Activity', exact: true }).click(); await page.locator('.activity-job-row').first().waitFor(); }
        const controls = page.getByRole('region', { name: `${name} table controls`, exact: true }), table = page.getByRole('table', { name, exact: true });
        assert.equal(await controls.getByRole('button').count(), 1, 'Only the menu trigger is exposed in the column header');
        const trigger = controls.getByRole('button', { name: `${name} table options`, exact: true }); assert.equal(await trigger.innerText(), '⋮'); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(await table.locator('thead th').getByRole('button', { name: `${name} table options`, exact: true }).count(), 1);
        const bar = await controls.boundingBox(), button = await trigger.boundingBox(); assert.ok(Math.abs(bar.x + bar.width - button.x - button.width) <= 2, 'Table menu is aligned at the right edge');
        async function revealHeaderMenu() {
          await trigger.scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
          await controls.getByRole('button', { name: 'Fit to width', exact: true }).waitFor();
        }
        const before = fixture.calls.length; await trigger.focus(); await trigger.press('Enter'); await controls.getByRole('button', { name: 'Fit to width', exact: true }).waitFor(); await page.waitForFunction(name => document.querySelector(`button[aria-label="${name} table options"]`)?.getAttribute('aria-expanded') === 'true', name);
        await controls.getByRole('button', { name: 'Fit to content', exact: true }).click();
        // Content fitting can move the header offscreen; the clipped popover must
        // dismiss rather than float detached. Bring its actual header back.
        await revealHeaderMenu();
        await controls.getByRole('button', { name: 'Fit to width', exact: true }).click();
        const columns = controls.locator('summary').filter({ hasText: /^Columns$/ }); await columns.focus(); await columns.press('Enter');
        assert.equal(await controls.getByRole('checkbox', { disabled: true }).count() > 0, true, 'Required columns remain protected');
        const compact = await table.locator('thead th').count(); await controls.getByRole('button', { name: 'Show all columns', exact: true }).click(); assert.ok(await table.locator('thead th').count() > compact);
        await revealHeaderMenu();
        await controls.getByRole('button', { name: 'Compact columns', exact: true }).click(); assert.equal(await table.locator('thead th').count(), compact);
        await revealHeaderMenu();
        await columns.focus(); await columns.press('Escape'); await controls.getByRole('button', { name: 'Fit to width', exact: true }).waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
        await trigger.click(); await page.getByRole('combobox', { name: name === 'Conversations' ? 'Search conversations' : name === 'Collectors' ? 'Search collector metadata' : 'Search indexing job metadata', exact: true }).focus(); await page.waitForFunction(name => document.querySelector(`button[aria-label="${name} table options"]`)?.getAttribute('aria-expanded') === 'false', name);
        assert.equal(fixture.calls.slice(before).filter(call => !(call.operation instanceof api.Operation_Ping)).length, 0, 'Presentation controls must not sort, search, read source content or write');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await context.close();
    }
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
