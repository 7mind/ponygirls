import { VARIANTS, withScene, gotoTab, activityReady, settle, inspect, scrollTo, scrollEnd } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';

const COLLECTORS = '.activity-collector-scroll', JOBS = '.activity-job-scroll';
async function activity(page) { await gotoTab(page, 'activity'); await activityReady(page); await settle(page, 600); }
const editor = (page, name) => page.getByRole('region', { name: `${name} metadata search`, exact: true });
async function filter(page, name, expression) {
  const region = editor(page, name);
  await region.getByRole('combobox', { name: `Search ${name.toLowerCase()} metadata`, exact: true }).fill(expression); await region.getByRole('button', { name: 'Filter', exact: true }).click(); await settle(page, 700);
}

export function registerActivity(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`activity-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
        await activity(page);
        await shot('activity', 'first-render', 'Activity tab as first rendered: heading actions, totals card, retry/rebuild actions, model-usage disclosure, then two bordered scroll regions', 'click nav "activity"');
        await shot('activity', 'first-render', 'Activity, whole document (full-page capture): totals, collectors table and jobs table stacked', 'same, full-page', { full: true });
        await inspect(page, ctx.recorder, `activity-${key}`);
        if (!variant.deep) return;
        // ---- scroll situations
        await page.locator('.activity-collectors').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollTo(0, document.querySelector('.activity-collectors').getBoundingClientRect().top + scrollY - 80)); await settle(page);
        await shot('activity', 'page-scrolled-collectors', 'Page scrolled so the Collectors table fills the viewport (its inner height is clamp(240px,43vh,470px))', 'window.scrollTo to the collectors section');
        await scrollTo(page, COLLECTORS, 400);
        await shot('activity', 'collectors-inner-scrolled', 'Collectors table scrolled inside its own region while the page is also scrolled', 'scroll .activity-collector-scroll');
        await page.evaluate(() => scrollTo(0, document.querySelector('.activity-jobs').getBoundingClientRect().top + scrollY - 60)); await settle(page);
        await shot('activity', 'page-scrolled-jobs', 'Page scrolled to the Indexing jobs section', 'window.scrollTo to the jobs section');
        for (let i = 0; i < 3; i++) await scrollEnd(page, JOBS);
        await shot('activity', 'jobs-after-infinite-load', `Jobs table scrolled to the end repeatedly: ${await page.locator('.activity-job-row').count()} job rows loaded`, 'scrollTop=scrollHeight x3 on .activity-job-scroll');
        await page.evaluate(() => scrollTo(0, 0)); await scrollTo(page, JOBS, 0);
        const m = await page.evaluate(() => { const rect = sel => document.querySelector(sel).getBoundingClientRect(); return { viewportHeight: innerHeight, docHeight: document.documentElement.scrollHeight, collectors: { top: Math.round(rect('.activity-collector-scroll').top + scrollY), height: Math.round(rect('.activity-collector-scroll').height) }, jobs: { top: Math.round(rect('.activity-job-scroll').top + scrollY), height: Math.round(rect('.activity-job-scroll').height) } }; });
        await ctx.recorder.dump('activity-geometry-1440x900', { ...m, note: 'measured via getBoundingClientRect at scrollY=0' });
        // ---- popovers & panels
        await page.getByRole('button', { name: 'About these snapshots' }).click(); await page.waitForTimeout(300);
        await shot('activity', 'about-popover', 'About these snapshots popover (560 px wide, three dense paragraphs)', 'click "About these snapshots"'); await page.keyboard.press('Escape');
        await page.getByText('Model usage and indexing settings').click(); await page.locator('.usage-table').waitFor(); await settle(page, 600);
        await shot('activity', 'model-usage-open', 'Model usage and indexing settings disclosure expanded: purpose table with TPS and token sub-lines', 'click the "Model usage…" summary');
        await shot('activity', 'model-usage-open', 'Same, full page', 'same, full-page', { full: true });
        await page.getByText('Model usage and indexing settings').click();
        await page.getByRole('button', { name: 'Retry all current failed indexing jobs' }).click(); await page.locator('.retry-failed-preview form').waitFor(); await settle(page, 400);
        await shot('activity', 'retry-failed-preview', 'Retry-all-failed preview opened inline inside the totals card: counts table, confirmation checkbox, confirm / cancel', 'click "Retry all current failed"');
        await page.getByRole('button', { name: 'Cancel retry preview' }).click();
        await page.getByRole('button', { name: 'Rebuild archive index' }).click(); await page.locator('[aria-label="Archive rebuild preview"] form').waitFor(); await settle(page, 400);
        await shot('activity', 'rebuild-preview', 'Rebuild-archive-index preview opened inline', 'click "Rebuild archive index"');
        await page.getByRole('button', { name: /Cancel/ }).first().click().catch(() => null);
        // ---- table controls and filters
        await page.getByRole('button', { name: 'Collectors table options' }).click(); await page.waitForTimeout(300);
        await shot('activity', 'collectors-table-options', 'Collectors table options popover', 'click the three-dot control in the Collectors table header'); await page.keyboard.press('Escape');
        await page.locator('.activity-collector-row').first().getByRole('button', { name: /Details/ }).first().click().catch(() => null); await page.waitForTimeout(400);
        await shot('activity', 'collector-details-popover', 'Collector row details popover (last report, per-run counters)', 'click Details in the first collector row'); await page.keyboard.press('Escape');
        await page.locator('.activity-job-row').first().scrollIntoViewIfNeeded();
        await page.locator('.activity-job-row').first().getByRole('button', { name: 'Details' }).click().catch(() => null); await page.waitForTimeout(400);
        await shot('activity', 'job-details-popover', 'Job row details popover (revision metadata, lease, failure stage)', 'click Details in the first job row'); await page.keyboard.press('Escape');
        await filter(page, 'Collector', 'freshness:stale');
        await shot('activity', 'collectors-filtered-stale', 'Collectors filtered to stale reports', 'collector filter "freshness:stale"');
        await filter(page, 'Indexing job', 'status:failed');
        await page.getByRole('button', { name: 'History', exact: true }).click(); await settle(page, 800);
        await page.locator('.activity-jobs').scrollIntoViewIfNeeded();
        await shot('activity', 'jobs-history-failed', 'Jobs table filtered to failed jobs in History scope', 'job filter "status:failed" + scope History');
        await page.getByRole('button', { name: 'Current', exact: true }).click(); await filter(page, 'Indexing job', '');
        await page.locator('.activity-collector-row').first().getByRole('button').last().click().catch(() => null); await settle(page, 700);
        await shot('activity', 'collector-selected', 'A collector selected from its row: jobs table scoped to it (collector note and filter box)', 'row action button of the first collector');
        // ---- column chooser makes both tables wide
        await page.evaluate(() => scrollTo(0, 0));
        for (const name of ['Collectors', 'Indexing jobs']) { await page.getByRole('button', { name: `${name} table options` }).click(); const open = page.locator('.transient-popover:popover-open'); await open.getByText('Columns', { exact: true }).click(); await open.getByRole('button', { name: 'Show all columns' }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
        await shot('activity', 'all-columns', 'All columns shown in both tables (collectors still filtered to stale reports from an earlier step): sticky first and Actions columns', 'both table options > Columns > Show all columns');
        await inspect(page, ctx.recorder, 'activity-all-columns');
        await page.locator(JOBS).evaluate(element => { element.scrollLeft = element.scrollWidth / 2; element.scrollTop = 300; });
        await page.locator('.activity-jobs').scrollIntoViewIfNeeded(); await settle(page, 500);
        await shot('activity', 'jobs-wide-scrolled', 'Wide jobs table scrolled diagonally inside its region', 'scrollLeft/scrollTop on .activity-job-scroll');
      });
    });
  }
  scenario('activity-states', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.user = new api.UserInfo('alice', 'alice', [api.Scope.Ingest]); }) }, async ({ page, shot }) => {
      await gotoTab(page, 'activity'); await page.locator('.notice.error').waitFor(); await settle(page, 400);
      await shot('activity', 'no-read-scope', 'Activity for a user without Read scope: only an error notice', 'sign in as alice with scope Ingest only');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await activity(page);
      fixture.activityFailure = 'Metadata expression is invalid at offset 12.'; await page.getByRole('button', { name: /Refresh snapshots/ }).click(); await page.locator('.notice.error').first().waitFor(); await settle(page, 500);
      await shot('activity', 'error', 'Activity after the server starts rejecting both queries: error notices over empty tables', 'fixture returns Failure; click Refresh snapshots');
      fixture.activityFailure = null;
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.activityCollectors = []; f.activityJobs = []; f.jobs = []; }) }, async ({ page, shot }) => {
      await gotoTab(page, 'activity'); await page.getByText('No matching collectors').waitFor(); await settle(page, 500);
      await shot('activity', 'empty', 'Activity with no collectors or jobs: two "No matching …" blanks with the decorative glyph', 'fixture returns empty owner');
    });
  });
}
