// Activity claim order (indexing claim-order spec §7, approved mockup of 25 Nov): the owner's per-class strip, the Class,
// Waiting since and Why-not-running columns with every reason, "N ahead" as a count with its footnote, and the legend.
// Runnable alone; the page clock is paused at 2030-01-01T18:00:00Z (CLAIM_NOW), the fixture's times are the mockup's of that day.
import assert from 'node:assert/strict';
import { LAPTOP, api, startRig, scene, main, region, table, rows, row, cell, detail, button, idle, open, jobQueries, horizontalOverflow, scrollers } from './activity-scenes.mjs';

const rig = await startRig('Activity claim order');
const CLAIM_NOW = Date.parse('2030-01-01T18:00:00Z');
/** The jobs view over `claimFixture`, its page clock paused at CLAIM_NOW. */
function claimScene(options = {}, viewport = undefined) {
  return scene(rig, { route: '/activity/jobs', ...(viewport === undefined ? {} : { viewport }), clock: false, configure: async (fixture, page) => { claimFixture(fixture, options); await page.clock.install({ time: CLAIM_NOW }); await page.clock.pauseAt(CLAIM_NOW + 1000); } });
}
/** Whether every element of `locator` shows its whole content (nothing cut by its cell or itself). */
const unclipped = locator => locator.evaluateAll(items => items.every(item => { const cell = item.closest('td') ?? item, box = item.getBoundingClientRect(), frame = cell.getBoundingClientRect(); return item.scrollWidth <= item.clientWidth + 1 && cell.scrollWidth <= cell.clientWidth + 1 && box.right <= frame.right + 1 && box.width > 0; }));
const id = n => `00000000-0000-4000-8000-${String(95000 + n).padStart(12, '0')}`;
const ROWS = {
  held: id(1), bulk: id(2), large: id(3), expired: id(4), running: id(5), fresh: id(6), blocked: id(7), exhausted: id(8), off: id(9), unclassified: id(10), historical: id(11), unleased: id(12), finished: id(13),
};
/** Jobs of one owner in every state the mockup shows, plus the remaining reasons; the server's summary of them. */
function claimFixture(fixture, { order = api.ActivityClaimOrder.Waiting, jobsOrder = undefined, summaryOrder = order } = {}) {
  const large = order === api.ActivityClaimOrder.Waiting ? new api.ActivityJobWaiting_AwaitingLargeLane() : new api.ActivityJobWaiting_AwaitingLargePermit();
  const job = (key, state, attempts, error, done, total) => new api.JobInfo(ROWS[key], fixture.session.id, fixture.headRevision, state, attempts, error, done, total, undefined);
  const make = (key, title, info, options) => {
    const { lease, active = false, since, waiting, ahead, classification = api.ActivityJobClass.Current } = options, bulk = Object.hasOwn(options, 'bulk') ? options.bulk : false, session = fixture.jobSession(info);
    // The job list's row as every client reads it, and its claim-order entry beside it (ActivityClaimOrderJobs).
    fixture.claimEntries.set(info.id, new api.ActivityJobClaimOrder(info.id, since, bulk, waiting, ahead));
    return new api.ActivityJob(info, fixture.targetProfile, classification, lease, active, false, fixture.source.collectorNamespace, session.with({ metadata: session.metadata.with({ title, project: 'demo-project', gitBranch: 'main' }) }), undefined);
  };
  fixture.activityJobs = [
    make('held', 'Session F', job('held', api.JobState.Queued, 3, 'model-http', 40, 160), { lease: '2030-01-01T18:30:00Z', since: '2030-01-01T14:40:00Z', waiting: new api.ActivityJobWaiting_Held('2030-01-01T18:30:00Z') }),
    make('bulk', 'Session B', job('bulk', api.JobState.Queued, 1, undefined, 0, 48), { since: '2030-01-01T15:20:00Z', bulk: true, waiting: new api.ActivityJobWaiting_Queued(), ahead: 41n }),
    make('large', 'Session C', job('large', api.JobState.Queued, 1, undefined, 0, 1013), { since: '2030-01-01T16:02:00Z', bulk: true, waiting: large, ahead: 2n }),
    make('expired', 'Session D', job('expired', api.JobState.Running, 2, undefined, 88, 240), { lease: '2030-01-01T16:54:00Z', since: '2030-01-01T16:31:00Z', waiting: new api.ActivityJobWaiting_LeaseExpiredAwaitingReclaim(), ahead: 1n }),
    make('running', 'Session E', job('running', api.JobState.Running, 1, undefined, 120, 300), { lease: '2030-01-01T18:19:00Z', active: true, since: '2030-01-01T16:58:00Z' }),
    make('fresh', 'Session A', job('fresh', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2030-01-01T17:09:00Z', waiting: new api.ActivityJobWaiting_Queued(), ahead: 3n }),
    make('blocked', 'Session G', job('blocked', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2030-01-01T17:11:00Z', waiting: new api.ActivityJobWaiting_BlockedByOlderRevision(6) }),
    make('exhausted', 'Session H', job('exhausted', api.JobState.Running, 5, undefined, 3, 9), { lease: '2030-01-01T15:00:00Z', since: '2030-01-01T13:00:00Z', waiting: new api.ActivityJobWaiting_LeaseExhaustedPending() }),
    make('off', 'Session I', job('off', api.JobState.Queued, 0, undefined, 0, undefined), { since: '2030-01-01T17:30:00Z', waiting: new api.ActivityJobWaiting_IndexingOff() }),
    // A historical (superseded) attempt whose lease ended: no scheduler reason, and not running either.
    make('historical', 'Session K', job('historical', api.JobState.Running, 1, undefined, 2, 9).with({ revision: fixture.headRevision - 1 }), { lease: '2030-01-01T17:00:00Z', since: '2030-01-01T12:00:00Z', classification: api.ActivityJobClass.SupersededRevision }),
    make('unleased', 'Session L', job('unleased', api.JobState.Running, 1, undefined, 0, undefined), { since: '2030-01-01T17:40:00Z', waiting: new api.ActivityJobWaiting_RunningWithoutLease() }),
    // Finished before the claim order was installed: no class, and no start ever records one.
    make('finished', 'Session M', job('finished', api.JobState.Complete, 1, undefined, 9, 9), { since: undefined, bulk: undefined }),
    make('unclassified', 'Session J', job('unclassified', api.JobState.Queued, 0, undefined, 0, undefined), { since: undefined, bulk: undefined, waiting: new api.ActivityJobWaiting_Queued(), ahead: order === api.ActivityClaimOrder.Waiting ? undefined : 7n }),
  ];
  fixture.jobs = fixture.activityJobs.map(item => item.job); fixture.jobsClaimOrder = jobsOrder;
  fixture.claimQueue = new api.ActivityQueue(summaryOrder, new api.ActivityClassQueue(6n, 2n, 1n, 1n, '2030-01-01T13:00:00Z'), new api.ActivityClassQueue(2n, 2n, 0n, 0n, '2030-01-01T15:20:00Z'), new api.ActivityClassQueue(1n, 1n, 0n, 0n, undefined), 1n, 2n);
}
const why = (page, key) => cell(page, 'jobs', ROWS[key], 'Waiting');
const text = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim();

try {
  await rig.run('the job list opens oldest wait first with the Class, State, Waiting since and Why-not-running columns of the mockup', async () => {
    const { context, page, fixture } = await claimScene();
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    const query = jobQueries(fixture).at(-1);
    assert.deepEqual([query.sort, query.direction], [api.ActivityClaimOrderSort.WaitingSince, api.SortDirection.Asc], 'the default order is the oldest wait first');
    // The list is the claim-order read: never the existing job list, whose replies stay those every older client validates.
    const sent = fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityClaimOrderJobs).at(-1).operation.query;
    assert.deepEqual([sent.order, sent.jobs.sort], [api.ActivityClaimOrderSort.WaitingSince, api.ActivityJobSort.LastTimestamp]);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).length, 0);
    const shown = await table(page, 'jobs').locator('thead th[data-column-id]').evaluateAll(items => items.map(item => item.dataset.columnId));
    assert.deepEqual(shown, ['Title', 'Class', 'State', 'WaitingSince', 'Waiting', 'CompletedWindows', 'LeaseState', 'Attempts', 'actions']);
    assert.equal(await table(page, 'jobs').locator('thead th[data-column-id="WaitingSince"]').getAttribute('aria-sort'), 'ascending');
    // Class and Why not running order on the server (B6): each header requests its order and the rows follow it.
    for (const [column, sort] of [['Class', api.ActivityClaimOrderSort.JobClass], ['Waiting', api.ActivityClaimOrderSort.WaitingReason]]) {
      const before = fixture.calls.length; await table(page, 'jobs').locator(`thead th[data-column-id="${column}"] button.th-sort`).click();
      await fixture.waitUntil(() => jobQueries({ calls: fixture.calls.slice(before) }).some(query => query.sort === sort), `${sort} not requested`);
      const sent = jobQueries({ calls: fixture.calls.slice(before) }).find(query => query.sort === sort), expected = fixture.activityJobsResult(sent).jobs.map(item => item.job.id);
      await row(page, 'jobs', expected[0]).and(rows(page, 'jobs').first()).waitFor(); await idle(page, 'jobs');
      assert.deepEqual(await rows(page, 'jobs').evaluateAll(items => items.map(item => item.dataset.rowId)), expected, `${sort} rows`);
      assert.equal(await table(page, 'jobs').locator(`thead th[data-column-id="${column}"]`).getAttribute('aria-sort'), 'ascending');
    }
    await table(page, 'jobs').locator('thead th[data-column-id="WaitingSince"] button.th-sort').click(); await idle(page, 'jobs');
    const order = fixture.activityJobsResult(query).jobs.map(item => item.job.id);
    assert.deepEqual(await rows(page, 'jobs').evaluateAll(items => items.map(item => item.dataset.rowId)), order);
    assert.deepEqual(order.slice(-2).sort(), [ROWS.unclassified, ROWS.finished].sort(), 'a job without a waiting time sorts last');
    assert.deepEqual([await text(cell(page, 'jobs', ROWS.fresh, 'Class')), await text(cell(page, 'jobs', ROWS.bulk, 'Class')), await text(cell(page, 'jobs', ROWS.unclassified, 'Class'))], ['fresh', 'bulk', 'unclassified']);
    assert.match(await cell(page, 'jobs', ROWS.unclassified, 'Class').locator('.chip').getAttribute('title'), /^unclassified: queued before the claim order was installed; the next server start classifies it while it is unfinished$/);
    // A job that finished before the claim order was installed is never classified: its class is "not recorded".
    assert.equal(await text(cell(page, 'jobs', ROWS.finished, 'Class')), 'not recorded');
    assert.equal(await cell(page, 'jobs', ROWS.finished, 'Class').locator('span').getAttribute('title'), 'Class not recorded: the job finished before the claim order was installed');
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="Class"] .chip')), true, 'every class label is whole');
    // Windows: the whole count and total, also an unknown total (1440 px).
    assert.deepEqual(await Promise.all(['running', 'large', 'fresh'].map(key => text(cell(page, 'jobs', ROWS[key], 'CompletedWindows')))), ['120 / 300', '0 / 1013', '0 / unknown']);
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="CompletedWindows"]')), true, 'no window count is cut');
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="LeaseState"] > span')), true, 'no lease state is cut');
    // Waiting since: the time and how long it has waited, both shown whole.
    // A running job joined its order at 16:58; it is not waiting, and its claim time is not recorded: the join time only.
    assert.match(await text(cell(page, 'jobs', ROWS.running, 'WaitingSince')), /^\d\d:\d\d$/);
    assert.match(await text(cell(page, 'jobs', ROWS.held, 'WaitingSince')), / waiting 3 h 20 min$/);
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="WaitingSince"] .waited-for')), true, 'every waiting duration is whole');
    assert.equal(await horizontalOverflow(page), false); assert.deepEqual(await scrollers(page), []);
    await context.close();
  });

  await rig.run('every waiting reason is worded as the mockup, an ended lease never reads as running and "N ahead" is a count with its footnote', async () => {
    const { context, page } = await claimScene();
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
    assert.match(await text(why(page, 'unleased')), /^Running without a lease No claim takes a job without a lease · retry it$/);
    assert.equal(await text(cell(page, 'jobs', ROWS.unleased, 'State')), 'Running without a lease');
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="Waiting"] .why-main, td[data-column-id="Waiting"] .cell-sub > span')), true, 'every reason is shown whole at 1440 px');
    const mark = why(page, 'fresh').locator('.ahead');
    assert.match(await mark.getAttribute('title'), /^3 jobs \(of all owners\) will be claimed before this one in the fresh order\. An order, not a time estimate/);
    assert.equal(await mark.getAttribute('tabindex'), '0', 'the explanation is reachable from the keyboard');
    const notes = region(page, 'Jobs').getByRole('region', { name: 'Claim-order notes', exact: true });
    assert.match(await text(notes), /“N ahead” counts the jobs, of all owners, that will be claimed before this one in its order — an order, not a time estimate; .* Other owners' jobs are counted, never named\./);
    assert.match(await text(notes), /fresh uploads and individual retries bulk retry-all and rebuild unclassified queued before the claim order was installed; the next server start classifies it while it is unfinished Large-job lane the one lane that runs jobs indexing more than 100 windows Waiting since when the job joined its order/);
    // The footnote mark shows the note in place: the route stays the job list (B5), from a row and from the strip.
    for (const mark of [why(page, 'fresh').getByRole('button', { name: 'About ahead counts', exact: true }), main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true }).getByRole('button', { name: 'About ahead counts', exact: true })]) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await mark.click();
      await page.waitForFunction(() => document.activeElement?.id === 'claim-order-ahead');
      assert.equal(await page.evaluate(() => location.hash), '#/activity/jobs', 'the route is kept');
      assert.equal(await region(page, 'Jobs').isVisible(), true);
      assert.equal(await notes.locator('#claim-order-ahead').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), true, 'the note is in view');
    }
    await button(row(page, 'jobs', ROWS.large), 'Details').click(); await detail(page, 'jobs', ROWS.large).waitFor();
    assert.match(await text(detail(page, 'jobs', ROWS.large)), /Claim order Large-job lane · oldest waiting since first, then source ID · 2 large jobs ahead \(all owners; not named\) Waiting since .* Class bulk: retry-all and rebuild/);
    await context.close();
  });

  await rig.run('the strip counts the owner’s own jobs per class and the large-job lane from the claim-order summary', async () => {
    const { context, page, fixture } = await claimScene();
    const strip = main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true });
    await strip.getByRole('table', { name: 'Claim-order counts per class', exact: true }).waitFor();
    const counts = await strip.locator('tbody tr').evaluateAll(items => items.map(item => [item.dataset.class, ...[...item.querySelectorAll('td.col-num')].map(td => td.textContent)]));
    assert.deepEqual(counts, [['fresh', '6', '2', '1', '1'], ['bulk', '2', '2', '0', '0'], ['unclassified', '1', '1', '0', '0']]);
    // Oldest waiting: the time and the duration, both visible at 1440 px.
    const oldest = await strip.locator('td.claim-oldest').evaluateAll(items => items.map(item => item.innerText.replace(/\s+/g, ' ').trim()));
    assert.match(oldest[0], /^\S.* · 5 h$/); assert.match(oldest[1], /^\S.* · 2 h 40 min$/); assert.equal(oldest[2], '—');
    assert.equal(await strip.locator('td.claim-oldest .waited-for').first().isVisible(), true);
    assert.equal(await unclipped(strip.locator('td.claim-oldest .waited-for')), true, 'the waiting duration is not cut off');
    assert.match(await text(strip), /Order Oldest waiting first within each class Running 1 of your jobs Large-job lane 1 of your jobs waits for it · 2 large jobs ahead¹ Not counted Running jobs with a valid lease; superseded and obsolete jobs \(History\)/);
    // The counts are the claim-order summary's (its own operation); the Activity summary keeps its reply.
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_ActivityClaimOrderSummary));
    await context.close();
  });

  await rig.run('under today’s source-id order the permit reason and the claim order are named, never a class queue', async () => {
    const { context, page } = await claimScene({ order: api.ActivityClaimOrder.SourceId });
    const strip = main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true });
    await strip.waitFor(); await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    assert.match(await text(strip), /Order Owner, then source ID \(today's order\)/); assert.match(await text(strip), /1 of your jobs waits for it · 2 ahead¹/);
    assert.match(await text(why(page, 'large')), /^Waiting for the large-job permit · 2 ahead¹ Sized 1,013 windows · only the permit lane takes it$/);
    assert.match(await text(why(page, 'fresh')), /^Queued · 3 ahead¹ in the claim order Claimable · owner, then source order$/);
    assert.match(await text(why(page, 'unclassified')), /^Queued · 7 ahead¹ in the claim order/);
    assert.equal(await unclipped(table(page, 'jobs').locator('td[data-column-id="Waiting"] .why-main, td[data-column-id="Waiting"] .cell-sub > span')), true, 'every reason is shown whole at 1440 px');
    await context.close();
  });

  await rig.run('at laptop width the strip stacks and the list keeps the reason column without sideways overflow', async () => {
    const { context, page } = await claimScene({}, LAPTOP);
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    await main(page).getByRole('region', { name: 'Your jobs in the claim order', exact: true }).waitFor();
    assert.equal(await horizontalOverflow(page), false); assert.equal(await why(page, 'fresh').isVisible(), true);
    await open(page, 'Overview'); await open(page, 'Jobs');
    assert.equal(await region(page, 'Jobs').isVisible(), true);
    await context.close();
  });

  await rig.run('a Running job is shown running only with a valid lease: a historical attempt whose lease ended is not, and the Overview counts active leases (B1)', async () => {
    const { context, page } = await claimScene();
    await idle(page, 'jobs'); await button(region(page, 'Jobs'), 'History').click(); await row(page, 'jobs', ROWS.historical).waitFor(); await idle(page, 'jobs');
    assert.equal(await text(cell(page, 'jobs', ROWS.historical, 'State')), 'Not running · lease ended');
    assert.equal(await cell(page, 'jobs', ROWS.historical, 'State').locator('.status-run').count(), 0, 'no active-running badge');
    assert.equal(await text(why(page, 'historical')), '—', 'no scheduler reason for a historical job');
    await open(page, 'Overview');
    const tile = region(page, 'Overview').locator('a.tile').filter({ hasText: /^Running/ });
    assert.match(await text(tile), /^Running 1 active lease · 3 more stored Running without one$/);
    assert.match(await text(region(page, 'Overview').locator('#activity-job-totals').locator('..')), /unfiltered totals of stored states/);
    await context.close();
  });

  await rig.run('a rank is worded by the claim order of the list that produced it, not by a summary not yet read (B6)', async () => {
    const { context, page } = await claimScene({ summaryOrder: api.ActivityClaimOrder.SourceId, jobsOrder: api.ActivityClaimOrder.Waiting });
    await idle(page, 'jobs'); await rows(page, 'jobs').first().waitFor();
    assert.match(await text(why(page, 'fresh')), /^Queued · 3 ahead¹ in the fresh queue/);
    await button(row(page, 'jobs', ROWS.large), 'Details').click(); await detail(page, 'jobs', ROWS.large).waitFor();
    assert.match(await text(detail(page, 'jobs', ROWS.large)), /Claim order Large-job lane · oldest waiting since first/);
    await context.close();
  });

  rig.finish();
} finally { await rig.close(); }
