// Layout quiescence of Chronicle's table and list views (UX-JIT, layout-quiescence.mjs): with scrollbars that take space,
// at 100 % and 125 % display scaling, around the window height where each view starts to scroll, the scroll geometry must
// settle and stay unchanged. Runnable alone; the page clock is paused, so no polling changes the content while it is sampled.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { SearchFixture } from './search-fixture.mjs';
import { pauseClock } from './fixture.mjs';
import { LAYOUT_SCALES, launchWithScrollbars, layoutContext, resizeWindow, assertQuiescentAroundThreshold } from './layout-quiescence.mjs';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const origin = `http://127.0.0.1:${address.port}`, PAGE = 'tests-browser/goal50.html';
// Window size while a view loads; each view is then checked around its own scroll threshold at the same width.
const WIDTH = 1440, LOAD_HEIGHT = 900;
// Data that fits on one page of each list, so the content does not grow when a taller window shows the list's end.
const ARCHIVE_ROWS = 10, SEARCH_ROWS = 4, PASSAGES = 30;
const main = (page, name) => page.getByRole('main', { name, exact: true });
const region = (page, name) => main(page, 'Activity').getByRole('region', { name, exact: true });
const VIEWS = [
  { name: 'Archive', route: () => '#/archive', configure: fixture => { fixture.archiveRowCount = ARCHIVE_ROWS; }, scroller: null, ready: async page => {
    await main(page, 'Archive').locator('[data-list-state="end"]').waitFor(); await main(page, 'Archive').locator('table[data-list="archive"][aria-busy="false"]').waitFor();
  } },
  { name: 'Search results', route: () => '#/search', configure: fixture => { fixture.archiveSearchCount = SEARCH_ROWS; }, scroller: null, ready: async page => {
    await main(page, 'Search').getByRole('combobox', { name: 'Search conversations', exact: true }).fill('mode:semantic source');
    await main(page, 'Search').getByRole('button', { name: 'Search', exact: true }).click(); await main(page, 'Search').locator('[data-list-foot="end"]').waitFor();
  } },
  { name: 'Activity overview', route: () => '#/activity', configure: () => {}, scroller: null, ready: page => region(page, 'Overview').getByRole('table', { name: 'Job totals', exact: true }).waitFor() },
  { name: 'Activity jobs', route: () => '#/activity/jobs', configure: () => {}, scroller: null, ready: async page => {
    await region(page, 'Jobs').locator('[data-list-state="end"]').waitFor(); await main(page, 'Activity').locator('table[data-list="activity-jobs"][aria-busy="false"]').waitFor();
  } },
  { name: 'Activity maintenance', route: () => '#/activity/maintenance', configure: () => {}, scroller: null, ready: page => region(page, 'Maintenance').getByRole('button', { name: 'Rebuild archive index', exact: true }).waitFor() },
  { name: 'Access', route: () => '#/access', configure: () => {}, scroller: null, ready: page => main(page, 'Access management').getByText('Systems workshop', { exact: true }).first().waitFor() },
  { name: 'Session side pane', route: fixture => { const row = fixture.authorizedRows[0], view = row.matchedView ?? row.publishedView ?? row.head.view; return `#/session/${row.head.id}?rev=${view.revision}${view.generationId === undefined ? '' : `&gen=${view.generationId}`}`; },
    configure: fixture => { fixture.annotationCount = PASSAGES; }, scroller: '[data-pane="rail"]', ready: async page => {
      await main(page, 'Session').locator('[data-pane="transcript"] [data-message-id]').first().waitFor(); await page.locator('[data-pane="rail"] [data-passage-id]').first().waitFor();
    } },
];
const errors = [];
async function check(browser, scale, view) {
  const label = `${view.name} at ${scale * 100} %`;
  if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !label.includes(process.env.CHRONICLE_BROWSER_CASE)) return 0;
  const context = await layoutContext(browser, {}), page = await context.newPage(), fixture = new SearchFixture();
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  try {
    view.configure(fixture);
    await pauseClock(page); await fixture.install(page);
    await resizeWindow(page, WIDTH, LOAD_HEIGHT);
    await page.goto(`${origin}/${PAGE}${view.route(fixture)}`);
    await view.ready(page);
    const sizes = await assertQuiescentAroundThreshold(page, label, { width: WIDTH, scroller: view.scroller });
    console.log(`PASS browser layout stability: ${label} (${sizes.map(([w, h]) => `${w}x${h}`).join(', ')})`);
    return 1;
  } finally { await context.close(); }
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const browsers = await Promise.all(LAYOUT_SCALES.map(scale => launchWithScrollbars(chromium, scale, { executablePath: undefined, args: [] })));
try {
  // Every view and scale runs in its own page at the same time; frames, not wall time, bound each check.
  const outcomes = await Promise.allSettled(LAYOUT_SCALES.flatMap((scale, index) => VIEWS.map(view => check(browsers[index], scale, view))));
  const failures = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
  assert.deepEqual(failures, [], 'every view settles at every size');
  assert.ok(outcomes.some(outcome => outcome.value === 1), 'No cases selected');
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await Promise.all(browsers.map(browser => browser.close())); await server.close(); }
