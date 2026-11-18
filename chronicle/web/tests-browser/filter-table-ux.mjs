import assert from 'node:assert/strict';
import { openTableOptions } from './table-controls.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provisioned browsers required; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true }), errors = [], metrics = [];
const output = fileURLToPath(new URL(`../test-results/filter-table-ux/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url)); await mkdir(output, { recursive: true });
async function scene(width, theme, configure) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new Goal50Fixture();
  if (configure !== undefined) configure(fixture);
  const tags = Array.from({ length: 16 }, (_, index) => `tag-${index}-猫🦄-<script>-` + 'long-value-'.repeat(8)), title = 'Literal 猫🦄 <script>not markup</script> ' .repeat(80);
  fixture.archiveRows = fixture.authorizedRows.map((row, index) => index === 0 ? row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title, tags }) }), tags }) : row);
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();  await page.locator('.archive-row').first().waitFor(); return { context, page, fixture };
}
async function group(name, body) { if (process.env.CHRONICLE_FILTER_CASE !== undefined && !name.includes(process.env.CHRONICLE_FILTER_CASE)) return; await body(); console.log(`PASS browser filter-table: ${name}`); }
try {
  await group('Activity metadata clear resets only its own editor', async () => {
    const { context, page, fixture } = await scene(1280, 'dark');
    await page.getByRole('link', { name: 'Activity', exact: true }).click(); const collector = page.getByRole('combobox', { name: 'Search collector metadata', exact: true }), jobs = page.getByRole('combobox', { name: 'Search indexing job metadata', exact: true }); await collector.fill('freshness:stale'); await jobs.fill('status:failed'); await page.getByRole('button', { name: 'Clear Search collector metadata', exact: true }).click(); assert.equal(await collector.inputValue(), ''); assert.equal(await jobs.inputValue(), 'status:failed'); assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).every(call => call.operation.query.expression === '')); await context.close();
  });
  await group('Activity tables fit desktop and expose their table controls', async () => {
    const { context, page, fixture } = await scene(1280, 'light');
    await page.getByRole('link', { name: 'Activity', exact: true }).click(); await page.locator('.activity-job-row').first().waitFor(); for (const name of ['Collectors', 'Indexing jobs']) { const region = page.getByRole('region', { name: `${name} table controls`, exact: true }); assert.equal(await region.count(), 1); const scroll = name === 'Collectors' ? page.locator('.activity-collector-scroll') : page.locator('.activity-job-scroll'); const size = await scroll.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, table: element.querySelector('table').getBoundingClientRect().width, columns: [...element.querySelectorAll('th')].map(cell => ({ id: cell.dataset.columnId, width: cell.getBoundingClientRect().width })), outside: [...element.querySelectorAll('td *,th *')].filter(child => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1 && child.getBoundingClientRect().width > 0).slice(0, 10).map(child => ({ tag: child.tagName, text: child.textContent, right: child.getBoundingClientRect().right, parent: child.parentElement.className })) })); assert.ok(size.scroll <= size.client + 1, `${name}: ${JSON.stringify(size)}`); }
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages || call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_GetPassages).length, 0); await context.close();
  });
  await group('content fitting measures styled monospace identifiers rather than proportional parent text', async () => {
    const { context, page } = await scene(1280, 'light', fixture => { const result = fixture.activityResult(new api.ActivityQuery('', api.ActivityCollectorSort.CollectorId, api.SortDirection.Asc, undefined, 50)); fixture.activityCollectors = [result.collectors[0].with({ collectorId: 'i'.repeat(60) })]; });
    await page.getByRole('link', { name: 'Activity', exact: true }).click(); const code = page.locator('.activity-collector-row td[data-column="CollectorId"] code').first(); await code.waitFor(); await (await openTableOptions(page, 'Collectors')).getByRole('button', { name: 'Fit to content', exact: true }).click();
    const measured = await code.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, font: getComputedStyle(element).font, parentFont: getComputedStyle(element.parentElement).font })); assert.ok(measured.scroll <= measured.client + 1, `Fit must honor the rendered font: ${JSON.stringify(measured)}`); await context.close();
  });
  await group('content fitting follows rendered whitespace collapse in metadata titles', async () => {
    const { context, page } = await scene(1280, 'light', fixture => { fixture.activityJobs = fixture.jobRows.map(row => row.with({ session: row.session.with({ metadata: row.session.metadata.with({ title: 'word\n'.repeat(18) }) }) })); }); await page.getByRole('link', { name: 'Activity', exact: true }).click(); const title = page.locator('.activity-job-title').first(); await title.waitFor(); await (await openTableOptions(page, 'Indexing jobs')).getByRole('button', { name: 'Fit to content', exact: true }).click(); const size = await title.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, whitespace: getComputedStyle(element).whiteSpace })); assert.ok(size.scroll <= size.client + 1, `Fit must follow rendered whitespace: ${JSON.stringify(size)}`); await context.close();
  });
  await group('resized sticky ends do not cover interior columns on narrow viewports', async () => {
    const { context, page, fixture } = await scene(640, 'light'); await page.getByRole('link', { name: 'Activity', exact: true }).click(); const table = page.getByRole('table', { name: 'Collectors', exact: true }); await table.locator('tbody tr').first().waitFor();
    await table.getByRole('separator', { name: 'Resize Collector column', exact: true }).focus(); await table.getByRole('separator', { name: 'Resize Collector column', exact: true }).press('End'); await table.getByRole('separator', { name: 'Resize Actions column', exact: true }).focus(); await table.getByRole('separator', { name: 'Resize Actions column', exact: true }).press('End');
    await page.locator('.activity-collector-scroll').evaluate(element => { element.scrollLeft = element.querySelector('th').getBoundingClientRect().width; }); const before = fixture.calls.filter(call => call.operation instanceof api.Operation_Activity).length;
    await table.getByRole('button', { name: 'Sort by Last reported phase', exact: true }).click({ timeout: 2000 }); await fixture.waitCall(api.Operation_Activity, before + 1); await context.close();
  });
  await group('light and dark narrow Activity layouts contain resize controls and literal long metadata', async () => {
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 1440]) {
      const { context, page } = await scene(width, theme); await page.getByRole('link', { name: 'Activity', exact: true }).click(); await page.locator('.activity-job-row').first().waitFor(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); metrics.push({ theme, width, documentWidth: await page.evaluate(() => document.documentElement.scrollWidth) }); await page.screenshot({ path: `${output}/${theme}-${width}-activity.png` }); await context.close();
    }
  });
  assert.deepEqual(errors, []); await writeFile(`${output}/metrics.json`, JSON.stringify(metrics, null, 2)); console.log(`Filter/table evidence: ${output}`);
} finally { await browser.close(); await server.close(); }
