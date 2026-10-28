// Behavioral-Active Blackbox / Good Communication. Regression: sticky cells obscured
// transient details; independent disclosures also accumulated over other controls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const output = fileURLToPath(new URL('../test-results/popup-regression/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const browser = await chromium.launch({ headless: true });
const results = [];
async function geometry(panel) {
  return panel.evaluate(element => {
    const rect = element.getBoundingClientRect(), probes = [];
    // Keep the original right-edge reproduction probes, plus a grid over the panel.
    const points = [16, 48, 80].filter(offset => offset < rect.height).map(offset => [rect.right - 8, rect.top + offset]);
    for (const x of [.1, .5, .9]) for (const y of [.1, .5, .9]) points.push([rect.left + rect.width * x, rect.top + rect.height * y]);
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(x, y);
      probes.push({ x, y, owned: hit !== null && element.contains(hit), hit: hit === null ? null : `${hit.tagName}.${hit.className}` });
    }
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, probes };
  });
}
async function assertGeometry(panel) {
  const measured = await geometry(panel);
  assert.ok(measured.probes.length > 0, 'Reproduction requires visible panel probes');
  assert.ok(measured.probes.every(probe => probe.owned), `Details obscured by another element: ${JSON.stringify(measured)}`);
  assert.ok(measured.left >= 7.5 && measured.top >= 7.5 && measured.right <= measured.viewportWidth - 7.5 && measured.bottom <= measured.viewportHeight - 7.5, `Panel must fit viewport: ${JSON.stringify(measured)}`);
  return measured;
}
try {
  for (const width of [1440, 1280, 390, 320]) for (const theme of ['light', 'dark']) {
    const name = `${theme}-${width}`, context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const page = await context.newPage(), fixture = new Goal50Fixture(), errors = [];
    page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
    fixture.activityJobs = Array.from({ length: 24 }, (_, index) => {
      const row = fixture.jobAt(index), job = row.job.with({ revision: fixture.headRevision });
      return row.with({ job, profile: fixture.targetProfile, classification: api.ActivityJobClass.Current, session: fixture.jobSession(job) });
    });
    fixture.jobs = fixture.activityJobs.map(row => row.job);
    await page.clock.install(); await fixture.install(page);
    // Exercise both the genuine entry and a synthetic harness with identical App.
    await page.goto(`http://127.0.0.1:${address.port}/${width === 1440 || width === 390 ? 'index.html' : 'tests-browser/goal50.html'}`);
    await page.locator('.archive-row').first().waitFor();
    const layout = await page.evaluate(() => ({ masthead: document.querySelector('.masthead').getBoundingClientRect().height, archivePadding: getComputedStyle(document.querySelector('.archive')).padding, document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.document <= width, `Page overflow: ${JSON.stringify(layout)}`);
    if (width > 640) { assert.equal(layout.masthead, 58); assert.equal(layout.archivePadding, '14px 22px 0px'); }
    async function open(trigger) {
      // Bottom sheets intentionally cover the fixed health pill; exercise its
      // keyboard/focus transition there, without force-clicking through content.
      if (width <= 640 && (await trigger.getAttribute('aria-label'))?.startsWith('Connection:')) { await trigger.focus(); await trigger.press('Enter'); }
      else await trigger.click();
      await page.waitForFunction(() => document.querySelectorAll('.transient-popover:popover-open').length === 1);
      await page.waitForFunction(element => element.getAttribute('aria-expanded') === 'true', await trigger.elementHandle());
      const panel = page.locator('.transient-popover:popover-open'); await assertGeometry(panel);
      return panel;
    }
    const syntax = page.getByRole('button', { name: 'Search syntax', exact: true });
    const themeButton = page.getByRole('button', { name: 'Theme settings', exact: true });
    const health = page.getByRole('button', { name: /^Connection:/ });
    const archiveColumns = page.getByRole('region', { name: 'Conversations table controls', exact: true }).getByRole('button', { name: 'Columns', exact: true });
    await open(syntax); await open(archiveColumns); await open(themeButton); await open(health); await open(syntax);
    const search = page.getByRole('combobox', { name: 'Search conversations', exact: true });
    await search.focus(); assert.equal(await page.locator('.transient-popover:popover-open').count(), 0); assert.equal(await search.evaluate(element => element === document.activeElement), true);
    await open(syntax); await page.locator('.archive-row .table-title').first().click(); await page.locator('dialog[open]').waitFor(); assert.equal(await page.locator('.transient-popover:popover-open').count(), 0); await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
    await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-job-row').nth(23).waitFor();
    const usage = page.getByText('Model usage and indexing settings', { exact: true }); await usage.click();
    const usageDisclosure = page.locator('.model-usage');
    const collectorDetails = page.locator('.activity-collector-row .activity-row-details').first().getByRole('button', { name: 'Details', exact: true });
    const jobDetails = page.locator('.activity-job-row .activity-row-details').first().getByRole('button', { name: 'Details', exact: true });
    const jobPanel = page.locator('.activity-job-row .activity-detail-panel').first();
    const columns = page.getByRole('region', { name: 'Indexing jobs table controls', exact: true }).getByRole('button', { name: 'Columns', exact: true });
    await page.locator('.activity-jobs').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await open(jobDetails); const jobGeometry = await assertGeometry(jobPanel);
    await page.screenshot({ path: `${output}/${name}-job.png` });
    // Original regression assertion: a later sticky Actions cell must not win hit tests.
    assert.ok(jobGeometry.probes.every(probe => probe.owned));
    await open(columns); assert.equal(await jobPanel.isVisible(), false, 'Opening Columns must dismiss preceding Details');
    await open(collectorDetails); const collectorGeometry = await assertGeometry(page.locator('.activity-collector-row .activity-detail-panel').first());
    await page.screenshot({ path: `${output}/${name}-collector.png` });
    for (const trigger of [page.getByRole('button', { name: 'About these snapshots', exact: true }), page.getByRole('region', { name: 'Collector metadata search', exact: true }).getByRole('button', { name: 'Metadata fields', exact: true }), page.getByRole('button', { name: 'About owner-wide indexing retries', exact: true }), themeButton, health, page.getByRole('region', { name: 'Indexing job metadata search', exact: true }).getByRole('button', { name: 'Metadata fields', exact: true }), jobDetails]) await open(trigger);
    assert.equal(await usageDisclosure.evaluate(element => element.open), true, 'Persistent Model usage disclosure must stay open');
    if (width <= 640) { assert.ok(jobGeometry.height <= 750); await jobPanel.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(await jobPanel.isVisible(), false); }
    else await jobDetails.press('Escape');
    // Native keyboard activation, tab order, Escape and focus return.
    await columns.focus(); await columns.press('Enter'); await page.locator('.table-column-panel:popover-open').waitFor();
    await page.keyboard.press('Tab'); assert.equal(await page.locator('.table-column-panel:popover-open').evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); assert.equal(await columns.evaluate(element => element === document.activeElement), true);
    await columns.press('Space'); await page.locator('.table-column-panel:popover-open').waitFor(); await page.keyboard.press('Escape');
    await open(columns); await page.mouse.click(2, 2);
    await page.waitForFunction(() => document.querySelectorAll('.transient-popover:popover-open').length === 0);
    await page.waitForFunction(element => element.getAttribute('aria-expanded') === 'false', await columns.elementHandle());
    assert.equal(await columns.getAttribute('aria-expanded'), 'false', 'Native outside light-dismiss synchronizes aria-expanded');
    await open(columns);
    const metadataInput = page.getByRole('combobox', { name: 'Search indexing job metadata', exact: true });
    await metadataInput.click(); assert.equal(await page.locator('.transient-popover:popover-open').count(), 0); assert.equal(await metadataInput.evaluate(element => element === document.activeElement), true, 'Outside click must keep focus on clicked input');
    if (width === 1440) {
      await page.setViewportSize({ width, height: 800 });
      await columns.evaluate(element => { window.scrollBy(0, element.getBoundingClientRect().top - 400); }); await page.clock.runFor(50);
      const scrollingPanel = await open(columns);
      const scrollTarget = await scrollingPanel.evaluate(element => { const maximum = element.scrollHeight - element.clientHeight; if (maximum <= 0) throw new Error('Scroll regression requires constrained popup'); element.scrollTop = Math.min(80, maximum); return element.scrollTop; });
      await page.clock.runFor(50);
      assert.equal(await scrollingPanel.evaluate(element => element.scrollTop), scrollTarget, 'Scrolling popup contents must not reset scroll position during anchor measurement');
      await columns.press('Escape'); await page.setViewportSize({ width, height: 1000 }); await page.clock.runFor(50);
    }
    // Scrolling an anchor out of its actual table closes the popup, not just clips it.
    await open(jobDetails); await page.locator('.activity-job-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; }); await page.clock.runFor(50); await jobPanel.waitFor({ state: 'hidden' });
    await page.locator('.activity-job-scroll').evaluate(element => { element.scrollTop = 0; }); await page.clock.runFor(50);
    await open(jobDetails); const originalPanel = await jobPanel.elementHandle();
    const openJobId = await page.locator('.activity-job-row').first().getAttribute('data-scroll-anchor');
    fixture.activityJobs = fixture.activityJobs.map(row => row.job.id === openJobId ? row.with({ job: row.job.with({ completedWindows: 91, totalWindows: 99 }) }) : row);
    await page.clock.runFor(4100); await jobPanel.getByText(/91 \/ 99 windows processed/).waitFor();
    assert.equal(await jobPanel.evaluate((element, original) => element === original, originalPanel), true, 'Polling must update the stable open panel, not remount it');
    assert.equal(await jobDetails.getAttribute('aria-expanded'), 'true'); await assertGeometry(jobPanel);
    fixture.activityJobs = fixture.activityJobs.filter(row => row.job.id !== openJobId); fixture.jobs = fixture.activityJobs.map(row => row.job);
    await page.clock.runFor(4100); await page.waitForFunction(() => document.querySelectorAll('.activity-job-row').length === 23); assert.equal(await page.locator('.transient-popover:popover-open').count(), 0, 'Removed row must not leave an orphan popup');
    assert.deepEqual(errors, [], 'Synthetic page must have no runtime errors');
    results.push({ theme, width, passed: true, layout, jobGeometry, collectorGeometry }); console.log(`PASS popup ${name}: clipping/grid, all transient transitions, keyboard/focus, live update/removal, persistent disclosure`);
    await context.close();
  }
} finally { await browser.close(); await server.close(); await writeFile(`${output}/results.json`, `${JSON.stringify(results, null, 2)}\n`); }
assert.equal(results.length, 8);
