// Activity claim order (indexing claim-order spec §7, approved mockup of 25 Nov): the owner's per-class strip, the Class,
// Waiting since and Why-not-running columns with every reason, "N ahead" as a count with its footnote, and the legend.
// Runnable alone; the page clock is paused at 2030-01-01T00:00:01Z, so the fixture's times precede it.
import assert from 'node:assert/strict';
import { LAPTOP, api, startRig, scene, main, region, table, rows, row, cell, detail, button, idle, open, activityQueries, horizontalOverflow, scrollers } from './activity-scenes.mjs';

const rig = await startRig('Activity claim order');
const id = n => `00000000-0000-4000-8000-${String(95000 + n).padStart(12, '0')}`;
const ROWS = {
  held: id(1), bulk: id(2), large: id(3), expired: id(4), running: id(5), fresh: id(6), blocked: id(7), exhausted: id(8), off: id(9), unclassified: id(10),
};
/** Jobs of one owner in every state the mockup shows, plus the remaining reasons; the server's summary of them. */
function claimFixture(fixture, { order = api.ActivityClaimOrder.Waiting, summary = true } = {}) {
  const large = order === api.ActivityClaimOrder.Waiting ? new api.ActivityJobWaiting_AwaitingLargeLane() : new api.ActivityJobWaiting_AwaitingLargePermit();
  const job = (key, state, attempts, error, done, total) => new api.JobInfo(ROWS[key], fixture.session.id, fixture.headRevision, state, attempts, error, done, total, undefined);
  const make = (key, title, info, options) => {
    const { lease, active = false, since, waiting, ahead } = options, bulk = Object.hasOwn(options, 'bulk') ? options.bulk : false, session = fixture.jobSession(info);
    return new api.ActivityJob(info, fixture.targetProfile, api.ActivityJobClass.Current, lease, active, false, fixture.source.collectorNamespace, session.with({ metadata: session.metadata.with({ title, project: 'demo-project', gitBranch: 'main' }) }), undefined, since, bulk, waiting, ahead);
  };
  fixture.activityJobs = [
    make('held', 'Session F', job('held', api.JobState.Queued, 3, 'model-http', 40, 160), { lease: '2030-01-01T00:16:00Z', since: '2029-12-31T21:26:00Z', waiting: new api.ActivityJobWaiting_Held('2030-01-01T00:16:00Z') }),
    make('bulk', 'Session B', job('bulk', api.JobState.Queued, 1, undefined, 0, 48), { since: '2029-12-31T22:06:00Z', bulk: true, waiting: new api.ActivityJobWaiting_Queued(), ahead: 41n }),
    make('large', 'Session C', job('large', api.JobState.Queued, 1, undefined, 0, 1013), { since: '2029-12-31T22:48:00Z', bulk: true, waiting: large, ahead: 2n }),
    make('expired', 'Session D', job('expired', api.JobState.Running, 2, undefined, 88, 240), { lease: '2029-12-31T23:40:00Z', since: '2029-12-31T23:17:00Z', waiting: new api.ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), ahead: 1n }),
    make('running', 'Session E', job('running', api.JobState.Running, 1, undefined, 120, 300), { lease: '2030-01-01T00:05:00Z', active: true, since: '2029-12-31T23:44:00Z' }),
    make('fresh', 'Session A', job('fresh', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2029-12-31T23:55:00Z', waiting: new api.ActivityJobWaiting_Queued(), ahead: 3n }),
    make('blocked', 'Session G', job('blocked', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2029-12-31T23:57:00Z', waiting: new api.ActivityJobWaiting_BlockedByOlderRevision(6) }),
    make('exhausted', 'Session H', job('exhausted', api.JobState.Running, 5, undefined, 3, 9), { lease: '2029-12-31T23:00:00Z', since: '2029-12-31T20:00:00Z', waiting: new api.ActivityJobWaiting_LeaseExhaustedPending() }),
    make('off', 'Session I', job('off', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2029-12-31T23:58:00Z', waiting: new api.ActivityJobWaiting_IndexingOff() }),
    make('unclassified', 'Session J', job('unclassified', api.JobState.Queued, 0, undefined, 0, undefined), { since: undefined, bulk: undefined, waiting: new api.ActivityJobWaiting_Queued(), ahead: order === api.ActivityClaimOrder.Waiting ? undefined : 7n }),
  ];
  fixture.jobs = fixture.activityJobs.map(item => item.job);
  const zero = new api.ActivityClassQueue(0n, 0n, 0n, 0n, undefined);
  fixture.claimQueue = summary ? new api.ActivityQueue(order, new api.ActivityClassQueue(6n, 2n, 1n, 1n, '2029-12-31T20:00:00Z'), new api.ActivityClassQueue(2n, 2n, 0n, 0n, '2029-12-31T22:06:00Z'), new api.ActivityClassQueue(1n, 1n, 0n, 0n, undefined), 1n, 2n) : undefined;
}
const why = (page, key) => cell(page, 'jobs', ROWS[key], 'Waiting');
const text = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim();

try {
  await rig.run('the job list opens oldest wait first with the Class, State, Waiting since and Why-not-running columns of the mockup', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: fixture => claimFixture(fixture) });
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    const query = activityQueries(fixture, api.Operation_ActivityJobs).at(-1);
    assert.deepEqual([query.sort, query.direction], [api.ActivityJobSort.WaitingSince, api.SortDirection.Asc], 'the default order is the oldest wait first');
    const shown = await table(page, 'jobs').locator('thead th[data-column-id]').evaluateAll(items => items.map(item => item.dataset.columnId));
    assert.deepEqual(shown, ['Title', 'Class', 'State', 'WaitingSince', 'Waiting', 'CompletedWindows', 'LeaseState', 'Attempts', 'actions']);
    assert.equal(await table(page, 'jobs').locator('thead th[data-column-id="WaitingSince"]').getAttribute('aria-sort'), 'ascending');
    assert.equal(await table(page, 'jobs').locator('thead th[data-column-id="Class"] button.th-sort').count(), 0, 'the server has no class order: the header is a label');
    const order = fixture.activityJobsResult(query).jobs.map(item => item.job.id);
    assert.deepEqual(await rows(page, 'jobs').evaluateAll(items => items.map(item => item.dataset.rowId)), order);
    assert.equal(order.at(-1), ROWS.unclassified, 'a job without a waiting time sorts last');
    assert.deepEqual([await text(cell(page, 'jobs', ROWS.fresh, 'Class')), await text(cell(page, 'jobs', ROWS.bulk, 'Class')), await text(cell(page, 'jobs', ROWS.unclassified, 'Class'))], ['fresh', 'bulk', '—']);
    assert.equal(await horizontalOverflow(page), false); assert.deepEqual(await scrollers(page), []);
    await context.close();
  });

  await rig.run('every waiting reason is worded as the mockup, an ended lease never reads as running and "N ahead" is a count with its footnote', async () => {
    const { context, page } = await scene(rig, { route: '/activity/jobs', configure: fixture => claimFixture(fixture) });
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    assert.match(await text(why(page, 'fresh')), /^Queued · 3 ahead¹ in the fresh queue Claimable · a free fresh lane takes the oldest first$/);
    assert.match(await text(why(page, 'bulk')), /^Queued · 41 ahead¹ in the bulk queue Claimable · bulk lane first; fresh lanes borrow when idle$/);
    assert.match(await text(why(page, 'large')), /^Waiting for the large-job lane · 2 large jobs ahead¹ Sized 1,013 windows · runs only on the large-job lane$/);
    assert.match(await text(why(page, 'expired')), /^Lease ended \d\d:\d\d · 1 ahead¹ in the fresh queue Worker stopped renewing · any lane may reclaim it$/);
    assert.equal(await text(cell(page, 'jobs', ROWS.expired, 'State')), 'Lease expired — waiting to be reclaimed');
    assert.equal(await cell(page, 'jobs', ROWS.expired, 'State').locator('.status-run').count(), 0, 'an ended lease is never shown as running');
    assert.match(await text(why(page, 'exhausted')), /^Lease ended \d\d:\d\d · attempt limit reached/);
    assert.match(await text(why(page, 'running')), /^Running · windows 120\/300 Lease active until \d\d:\d\d · not waiting$/);
    assert.equal(await text(cell(page, 'jobs', ROWS.running, 'State')), 'Running');
    assert.match(await text(why(page, 'held')), /^Retrying after \d\d:\d\d \(back-off\) Prior: model-http · rejoins the fresh order at \d\d:\d\d$/);
    assert.equal(await text(cell(page, 'jobs', ROWS.held, 'State')), 'Held');
    assert.match(await text(why(page, 'blocked')), /^Waiting for older revision r6 \(still running\) Joins the fresh order when r6 ends$/);
    assert.equal(await text(cell(page, 'jobs', ROWS.blocked, 'State')), 'Blocked');
    assert.match(await text(why(page, 'off')), /^Indexing is turned off for your account/);
    assert.match(await text(why(page, 'unclassified')), /^Queued Claimable/, 'no position where the order in force has none');
    const mark = why(page, 'fresh').locator('.ahead');
    assert.match(await mark.getAttribute('title'), /^3 jobs \(of all owners\) will be claimed before this one in the fresh order\. An order, not a time estimate/);
    assert.equal(await mark.getAttribute('tabindex'), '0', 'the explanation is reachable from the keyboard');
    const notes = region(page, 'Jobs').getByRole('region', { name: 'Claim-order notes', exact: true });
    assert.match(await text(notes), /“N ahead” counts the jobs, of all owners, that will be claimed before this one in its order — an order, not a time estimate; .* Other owners' jobs are counted, never named\./);
    assert.match(await text(notes), /fresh uploads and individual retries bulk retry-all and rebuild Large-job lane the one lane that runs jobs indexing more than 100 windows Waiting since when the job joined its order/);
    assert.equal(await why(page, 'fresh').locator('a.fn-ref').getAttribute('href'), '#claim-order-ahead');
    await button(row(page, 'jobs', ROWS.large), 'Details').click(); await detail(page, 'jobs', ROWS.large).waitFor();
    assert.match(await text(detail(page, 'jobs', ROWS.large)), /Claim order Large-job lane · oldest waiting since first, then source ID · 2 large jobs ahead \(all owners; not named\) Waiting since .* Class bulk: retry-all and rebuild/);
    await context.close();
  });

  await rig.run('the strip counts the owner’s own jobs per class and the large-job lane, and is absent without a server summary', async () => {
    const { context, page } = await scene(rig, { route: '/activity/jobs', configure: fixture => claimFixture(fixture) });
    const strip = main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true });
    await strip.getByRole('table', { name: 'Claim-order counts per class', exact: true }).waitFor();
    const counts = await strip.locator('tbody tr').evaluateAll(items => items.map(item => [item.dataset.class, ...[...item.querySelectorAll('td.col-num')].map(td => td.textContent)]));
    assert.deepEqual(counts, [['fresh', '6', '2', '1', '1'], ['bulk', '2', '2', '0', '0'], ['unclassified', '1', '1', '0', '0']]);
    assert.match(await text(strip), /Order Oldest waiting first within each class Running 1 of your jobs Large-job lane 1 of your jobs waits for it · 2 large jobs ahead¹ Not counted Running jobs with a valid lease; superseded and obsolete jobs \(History\)/);
    await context.close();
    const bare = await scene(rig, { route: '/activity/jobs', configure: fixture => claimFixture(fixture, { summary: false }) });
    await idle(bare.page, 'jobs'); await rows(bare.page, 'jobs').first().waitFor();
    assert.equal(await main(bare.page).getByRole('region', { name: 'Your jobs in the claim order', exact: true }).count(), 0, 'no strip without the server summary');
    assert.match(await text(why(bare.page, 'fresh')), /^Queued · 3 ahead¹ in the claim order/, 'without the summary the order is not named');
    await bare.context.close();
  });

  await rig.run('under today’s source-id order the permit reason and the claim order are named, never a class queue', async () => {
    const { context, page } = await scene(rig, { route: '/activity/jobs', configure: fixture => claimFixture(fixture, { order: api.ActivityClaimOrder.SourceId }) });
    const strip = main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true });
    await strip.waitFor(); await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    assert.match(await text(strip), /Order Owner, then source ID \(today's order\)/); assert.match(await text(strip), /1 of your jobs waits for it · 2 ahead¹/);
    assert.match(await text(why(page, 'large')), /^Waiting for the large-job permit · 2 ahead¹ in the claim order Sized 1,013 windows · only a lane holding the large-job permit takes it$/);
    assert.match(await text(why(page, 'fresh')), /^Queued · 3 ahead¹ in the claim order Claimable · claimed in owner, then source order$/);
    assert.match(await text(why(page, 'unclassified')), /^Queued · 7 ahead¹ in the claim order/);
    await context.close();
  });

  await rig.run('at laptop width the strip stacks and the list keeps the reason column without sideways overflow', async () => {
    const { context, page } = await scene(rig, { route: '/activity/jobs', viewport: LAPTOP, configure: fixture => claimFixture(fixture) });
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    await main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true }).waitFor();
    assert.equal(await horizontalOverflow(page), false); assert.equal(await why(page, 'fresh').isVisible(), true);
    await open(page, 'Overview'); await open(page, 'Jobs');
    assert.equal(await region(page, 'Jobs').isVisible(), true);
    await context.close();
  });

  rig.finish();
} finally { await rig.close(); }
