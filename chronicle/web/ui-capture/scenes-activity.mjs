// Activity (UX-C5, spec §3.1): the states of the mockup `chronicle-activity.html`, named like its shots
// (`chronicle-activity-<state>[-dark]-<width>.png`, spec §8 item 10) so that each pairs with its mockup for `look`.
import { PRIMARY, SECONDARY, PHONE, withScene, nav, settle, inspect } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';

const variantOf = (viewport, scheme) => ({ viewport, scheme, suffix: '', deep: false });
const named = (state, variant) => `chronicle-activity-${state}${variant.scheme === 'dark' ? '-dark' : ''}-${variant.viewport.tag}.png`;
const main = page => page.getByRole('main', { name: 'Activity', exact: true });
const section = (page, name) => main(page).getByRole('region', { name, exact: true });
const tab = (page, name) => main(page).getByRole('navigation', { name: 'Activity sections', exact: true }).getByRole('link', { name: new RegExp(`^${name}`) });
const rows = (page, list) => main(page).locator(`table[data-list="${list}"] tbody tr[data-row-id]`);
const idle = (page, list) => main(page).locator(`table[data-list="${list}"][aria-busy="false"]`).waitFor({ state: 'attached' });
// Expressions the Overview and the cross-links apply (Overview.tsx, Collectors.tsx): the scripted server answers them.
const FAILED = 'status:"failed"', RUNNING = 'status:"running"', COLLECTOR = 'ci-runner-02';
function scripted(fixture) {
  const ids = predicate => fixture.activityJobs.filter(predicate).map(item => item.job.id);
  fixture.jobExpressions.set(FAILED, ids(item => item.job.state === api.JobState.Failed));
  fixture.jobExpressions.set(RUNNING, ids(item => item.job.state === api.JobState.Running));
  const collector = fixture.activityCollectors[2].collectorId;
  fixture.jobExpressions.set(`collector:${JSON.stringify(collector)}`, ids(item => item.collectorId === collector));
  fixture.jobExpressions.set(`(${FAILED}) AND collector:${JSON.stringify(collector)}`, ids(item => item.collectorId === collector && item.job.state === api.JobState.Failed));
  fixture.jobExpressions.set(`(${FAILED}) AND collector:"laptop-a"`, []);
  return collector;
}
async function overview(page) { await nav(page, 'activity').click(); await section(page, 'Overview').locator('.tile-value').first().waitFor(); await main(page).locator('[data-attention]').first().waitFor(); }
async function list(page, name, listName) { await tab(page, name).click(); await section(page, name).waitFor(); await rows(page, listName).first().waitFor(); await idle(page, listName); }
async function filterJobs(page, expression) {
  await section(page, 'Jobs').getByRole('combobox', { name: 'Search indexing job metadata', exact: true }).fill(expression);
  await section(page, 'Jobs').getByRole('button', { name: 'Filter', exact: true }).click();
  await page.waitForFunction(value => new URLSearchParams(location.hash.split('?')[1]).get('q') === value, expression); await idle(page, 'activity-jobs');
}
const blur = page => page.evaluate(() => { document.activeElement.blur(); });

export function registerActivity(scenario) {
  for (const [viewport, scheme] of [[PRIMARY, 'light'], [SECONDARY, 'light'], [PHONE, 'light'], [PRIMARY, 'dark']]) {
    const variant = variantOf(viewport, scheme);
    scenario(`activity-${scheme}-${viewport.tag}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture(scripted) }, async ({ page, shot }) => {
        await overview(page); await settle(page, 300);
        await shot('activity', '', 'Activity Overview: tiles, needs attention, job totals, collectors and model usage', 'nav link Activity', { file: named('overview', variant) });
        await inspect(page, ctx.recorder, `activity-overview-${scheme}-${viewport.tag}`);
        await list(page, 'Jobs', 'activity-jobs'); await blur(page); await settle(page, 300);
        await shot('activity', '', 'Jobs: scope, query bar, counter, shortcut row and the document table', 'sub-navigation Jobs', { file: named('jobs', variant) });
        await inspect(page, ctx.recorder, `activity-jobs-${scheme}-${viewport.tag}`);
      });
    });
  }
  scenario('activity-states', async ctx => {
    const variant = variantOf(PRIMARY, 'light');
    await withScene(ctx, variant, { fixture: seededFixture(scripted) }, async ({ page, fixture, shot }) => {
      const collector = fixture.activityCollectors[2].collectorId;
      await overview(page);
      await list(page, 'Collectors', 'activity-collectors'); await blur(page); await settle(page, 300);
      await shot('activity', '', 'Collectors: one list in the document, freshness and current job counts per collector', 'sub-navigation Collectors', { file: named('collectors', variant) });
      await section(page, 'Collectors').getByRole('button', { name: 'Stale', exact: true }).click(); await section(page, 'Collectors').getByRole('button', { name: 'Filter', exact: true }).click();
      await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'freshness:"stale"'); await idle(page, 'activity-collectors'); await blur(page); await settle(page, 300);
      await shot('activity', '', 'Collectors filtered to stale reports by the Stale shortcut', 'shortcut Stale + Filter', { file: named('collectors-stale', variant) });
      await section(page, 'Collectors').getByRole('button', { name: 'Clear Search collector metadata', exact: true }).click(); await idle(page, 'activity-collectors');
      await rows(page, 'activity-collectors').nth(1).getByRole('button', { name: 'Details', exact: true }).click(); await main(page).locator('tr.row-detail').waitFor(); await settle(page, 300);
      await shot('activity', '', 'A collector row expanded in place: last report, run counters, leases, Jobs of this collector', 'Details of the second collector', { file: named('collector-detail', variant) });
      await list(page, 'Jobs', 'activity-jobs');
      await page.evaluate(() => window.scrollTo(0, 1500)); await settle(page, 400);
      await shot('activity', '', 'Jobs scrolled 1500 px: masthead, sub-navigation, view bar and table header stick', 'window.scrollTo(0, 1500)', { file: named('jobs-scrolled', variant) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await rows(page, 'activity-jobs').nth(2).getByRole('button', { name: 'Details', exact: true }).click(); await main(page).locator('tr.row-detail').waitFor(); await settle(page, 300);
      await shot('activity', '', 'A job row expanded in place: error and stage, revision, windows, lease, collector link, metadata, actions', 'Details of the third job', { file: named('job-detail', variant) });
      await rows(page, 'activity-jobs').nth(2).getByRole('button', { name: 'Details', exact: true }).click();
      await filterJobs(page, FAILED); await blur(page); await settle(page, 300);
      await shot('activity', '', 'Jobs filtered to failed current jobs', 'expression status:"failed"', { file: named('jobs-failed', variant) });
      await page.evaluate(id => { location.hash = `#/activity/jobs?q=${encodeURIComponent(`collector:${JSON.stringify(id)}`)}`; }, collector); await section(page, 'Jobs').locator('.activity-chip').waitFor(); await idle(page, 'activity-jobs'); await settle(page, 300);
      await shot('activity', '', 'Jobs of one collector: the collector restriction is a removable chip of the expression', 'a collector\'s Jobs link', { file: named('jobs-collector', variant) });
      const last = fixture.activityJobs.findLastIndex(item => item.collectorId === collector);
      fixture.activityJobs = fixture.activityJobs.map((item, index) => index === last ? item.with({ lastTimestamp: '2030-01-01T00:00:00Z' }) : item);
      await main(page).getByRole('button', { name: 'Refresh snapshots', exact: true }).click(); await section(page, 'Jobs').getByRole('button', { name: 'Updated jobs · show latest', exact: true }).waitFor(); await page.mouse.move(700, 24); await blur(page); await settle(page, 300);
      await shot('activity', '', 'A new snapshot reorders the list: the pill announces it, the rows stay until it is applied', 'change a job, Refresh snapshots', { file: named('jobs-updates', variant) });
      await filterJobs(page, `(${FAILED}) AND collector:"laptop-a"`); await section(page, 'Jobs').locator('[data-list-state="empty"]').waitFor(); await blur(page); await settle(page, 300);
      await shot('activity', '', 'No matching current jobs: Look in History and Clear filter', 'an unmatched expression', { file: named('empty', variant) });
      await tab(page, 'Model usage').click(); await page.getByRole('table', { name: 'Completed model call usage', exact: true }).waitFor(); await settle(page, 300);
      await shot('activity', '', 'Model usage: the measures per purpose and the indexing settings', 'sub-navigation Model usage', { file: named('usage', variant) });
      await tab(page, 'Maintenance').click(); await section(page, 'Maintenance').waitFor(); await settle(page, 300);
      await shot('activity', '', 'Maintenance: retry failed jobs and rebuild the archive index as cards with scope figures', 'sub-navigation Maintenance', { file: named('maintenance', variant) });
      await section(page, 'Maintenance').getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click();
      const retry = page.getByRole('dialog', { name: /^Retry \d+ failed indexing jobs\?$/ }); await retry.getByRole('checkbox').waitFor(); await settle(page, 300);
      await shot('activity', '', 'Retry preview dialog: exact populations and the confirmation checkbox, Cancel focused', 'Retry all current failed indexing jobs', { file: named('retry-confirm', variant) });
      await retry.getByRole('button', { name: 'Cancel', exact: true }).click(); await retry.waitFor({ state: 'detached' });
      await section(page, 'Maintenance').getByRole('button', { name: 'Rebuild archive index', exact: true }).click();
      const rebuild = page.getByRole('dialog', { name: 'Rebuild the archive index?', exact: true }); await rebuild.getByRole('checkbox').waitFor(); await settle(page, 300);
      await shot('activity', '', 'Rebuild preview dialog: captured HEADs, replacement jobs, current target and the confirmation checkbox', 'Rebuild archive index', { file: named('rebuild-confirm', variant) });
      await rebuild.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
    await withScene(ctx, variant, { fixture: seededFixture(scripted) }, async ({ page, fixture, shot }) => {
      await page.evaluate(() => { location.hash = '#/activity/jobs'; }); await rows(page, 'activity-jobs').first().waitFor();
      fixture.activityFailure = 'The server answered with an error (activity-unavailable). Nothing was changed.';
      await main(page).getByRole('button', { name: 'Refresh snapshots', exact: true }).click(); await section(page, 'Jobs').getByRole('alert').waitFor(); await settle(page, 300);
      await shot('activity', '', 'Load failure: inline danger notice with Retry instead of an empty table frame', 'the server fails Activity reads; Refresh snapshots', { file: named('error', variant) });
      fixture.activityFailure = null;
    });
  });
}
