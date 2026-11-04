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
  if (path === 'harness') { await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'archive', exact: true }).click(); await page.locator('.archive-row').first().waitFor(); } else await page.getByRole('heading', { name: 'Notification fixture', exact: true }).waitFor();
  return { context, page, fixture };
}
async function group(name, body) { if (process.env.CHRONICLE_UI_CASE !== undefined && !name.includes(process.env.CHRONICLE_UI_CASE)) return; await body(); console.log(`PASS browser UI controls: ${name}`); }
async function succeed(page) { await page.getByRole('button', { name: 'Retry job', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click(); }
const notifications = page => page.getByRole('region', { name: 'Notifications', exact: true });
try {
  // Specified: Behavioral-Active Blackbox / Good Communication, real Chromium + controlled mutation transport.
  await group('routine success is a polite dismissible toast without in-page layout or focus changes', async () => {
    for (const [width, theme] of [[1280, 'light'], [320, 'dark']]) {
      const { context, page } = await scene('notifications', width, theme), heading = page.getByRole('heading', { name: 'Notification fixture', exact: true }), before = await heading.boundingBox();
      await succeed(page); const toast = notifications(page); await toast.waitFor();
      assert.equal(await toast.getByRole('status').innerText(), 'Retry indexing job completed.');
      assert.equal(await toast.getByRole('status').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#notices .notice').count(), 0, 'Routine success must not occupy the global in-page notice stack');
      assert.deepEqual(await heading.boundingBox(), before, 'Success must not push the current page down');
      assert.equal(await page.getByRole('button', { name: 'Return success', exact: true }).evaluate(element => element === document.activeElement), true);
      const bounds = await toast.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900);
      await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).click(); await toast.waitFor({ state: 'detached' });
      await succeed(page); await toast.waitFor(); await page.mouse.move(0, 0); await page.clock.runFor(7000); await toast.waitFor({ state: 'detached' });
      await succeed(page); await toast.waitFor(); await page.clock.runFor(3000); await toast.hover(); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true, 'Hover pauses the dismissal timer');
      await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).focus(); await page.mouse.move(0, 0); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true, 'Keyboard focus pauses the dismissal timer');
      await page.getByRole('button', { name: 'Return success', exact: true }).focus(); await page.clock.runFor(7000); await toast.waitFor({ state: 'detached' });
      await context.close();
    }
  });
  await group('late and existing toasts stay visible and keyboard-accessible in the native conversation dialog', async () => {
    for (const beforeDialog of [false, true]) {
      const { context, page } = await scene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click();
      if (beforeDialog) { await page.getByRole('button', { name: 'Return success', exact: true }).click(); await notifications(page).waitFor(); }
      await page.getByRole('button', { name: 'Open conversation', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Source conversation', exact: true }); await dialog.waitFor();
      if (!beforeDialog) await dialog.getByRole('button', { name: 'Return modal success', exact: true }).click();
      const toast = notifications(page); await toast.waitFor();
      assert.equal(await toast.evaluate(element => element.closest('dialog')?.matches(':modal')), true, 'Notifications must be inside the active modal accessibility tree, not inert beneath its backdrop');
      const dismiss = toast.getByRole('button', { name: 'Dismiss notification', exact: true });
      assert.equal(await dismiss.evaluate(element => { const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element || element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true);
      await dismiss.focus(); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true); await dismiss.press('Enter'); await toast.waitFor({ state: 'detached' });
      await dialog.getByRole('button', { name: 'Close conversation', exact: true }).click(); await context.close();
    }
  });
  await group('the application retry action reports routine success through the global toast', async () => {
    const { context, page, fixture } = await scene('harness'); await page.getByRole('button', { name: 'activity', exact: true }).click();
    await page.getByRole('button', { name: 'Retry indexing', exact: true }).click(); const toast = notifications(page); await toast.getByRole('status').getByText('Retry indexing job completed.', { exact: true }).waitFor();
    assert.equal(await page.locator('.global-mutation-notices .notice').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_RetryJob).length, 1);
    await page.getByRole('button', { name: 'archive', exact: true }).click(); assert.equal(await toast.isVisible(), true, 'Changing tabs must not promote a success to an in-page notice or reset it');
    await context.close();
  });
  await group('notification authorization boundaries clear current and late successes', async () => {
    for (const boundary of ['Invalidate', 'Change account', 'Sign out']) {
      const { context, page } = await scene(); await succeed(page); await notifications(page).waitFor();
      await page.getByRole('button', { name: boundary, exact: true }).click(); assert.equal(await notifications(page).count(), 0);
      await context.close();
      const late = await scene(); await late.page.getByRole('button', { name: 'Retry job', exact: true }).click();
      await late.page.getByRole('button', { name: boundary, exact: true }).click(); await late.page.getByRole('button', { name: 'Return success', exact: true }).click();
      assert.equal(await notifications(late.page).count(), 0, 'A late result cannot resurrect notifications outside the initiating authorization epoch');
      await late.context.close();
    }
  });
  await group('uncertain and absent-receipt recovery stays durable, owner-bound and never automatically replays', async () => {
    const { context, page } = await scene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click();
    const id = await page.locator('output[aria-label="Request ID"]').textContent();
    await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); const uncertain = page.getByRole('region', { name: 'Uncertain mutation', exact: true }); await uncertain.waitFor();
    await page.clock.runFor(10000); assert.equal(await uncertain.isVisible(), true); assert.equal(await notifications(page).count(), 0);
    await page.getByRole('button', { name: 'Retry job', exact: true }).click(); assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '1');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); assert.equal(await uncertain.getByRole('button', { name: 'Look up receipt', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Sign in original', exact: true }).click(); await uncertain.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    assert.equal(await page.locator('output[aria-label="Request ID"]').textContent(), id); await page.getByRole('button', { name: 'Receipt absent', exact: true }).click();
    await page.getByText('No committed receipt was found. You may explicitly retry the same payload with the same request ID.', { exact: true }).waitFor();
    await page.clock.runFor(10000); assert.equal(await uncertain.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).isVisible(), true); assert.equal(await notifications(page).count(), 0);
    assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '2');
    await uncertain.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).click(); assert.equal(await page.locator('output[aria-label="Request ID"]').textContent(), id);
    await page.getByRole('button', { name: 'Return success', exact: true }).click(); await uncertain.waitFor({ state: 'detached' }); await notifications(page).waitFor(); await context.close();
  });
  await group('receipt-confirmed success becomes a toast, but a bulk rejection keeps fresh-preview guidance', async () => {
    const { context, page } = await scene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click();
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click(); await notifications(page).waitFor();
    assert.match(await notifications(page).getByRole('status').innerText(), /Retry indexing job committed\. Receipt/); assert.equal(await page.locator('#notices .notice').count(), 0); assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '2');
    await page.getByRole('button', { name: 'Retry bulk', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Receipt rejected', exact: true }).click();
    const guidance = page.locator('#notices .notice').filter({ hasText: 'confirms that this indexing retry was rejected' }); await guidance.waitFor(); await page.clock.runFor(10000); assert.equal(await guidance.isVisible(), true); assert.equal(await notifications(page).count(), 0); assert.equal(await page.getByRole('region', { name: 'Uncertain mutation', exact: true }).count(), 0); await context.close();
  });
  await group('typed bulk results and unrecoverable token guidance do not expire into toasts', async () => {
    const { context, page } = await scene(); await page.getByRole('button', { name: 'Retry bulk', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click();
    const bulk = page.getByRole('region', { name: 'Indexing retry result', exact: true }); await bulk.waitFor(); await page.clock.runFor(10000); assert.equal(await bulk.isVisible(), true); assert.match(await bulk.innerText(), /does not establish Complete/); assert.equal(await notifications(page).count(), 0);
    await page.getByRole('button', { name: 'Mint token', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Return token metadata', exact: true }).click();
    await page.getByRole('heading', { name: 'Token committed; secret unavailable', exact: true }).waitFor(); await page.clock.runFor(10000); assert.equal(await page.getByRole('button', { name: 'Revoke unrecoverable token', exact: true }).isVisible(), true); assert.equal(await notifications(page).count(), 0); await context.close();
  });
  await group('all controlled tables expose fitting and columns only inside keyboard-accessible vertical three-dots menus in column headers', async () => {
    for (const width of [1280, 390]) {
      const { context, page, fixture } = await scene('harness', width);
      for (const name of ['Conversations', 'Collectors', 'Indexing jobs']) {
        if (name === 'Collectors') { await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-job-row').first().waitFor(); }
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
