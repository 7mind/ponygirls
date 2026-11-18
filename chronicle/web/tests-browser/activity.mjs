// Activity view (redesign spec §3.1, unit UX-C5): Overview, Collectors, Jobs and Model usage; one scenario script, runnable
// alone. Cases moved here from activity-tables.mjs, ux.mjs, run.mjs, goal50.mjs, usage-presentation.mjs, filter-table-ux.mjs,
// source-filters.mjs, rebuild.mjs, prior-error-regression.mjs and ui-controls.mjs, plus the fresh checks of spec §8 items 1–5,
// 7 and 9. Maintenance (retry and rebuild) is activity-maintenance.mjs.
import assert from 'node:assert/strict';
import { ChronicleFixture, advanceClock, advanceClockUntil, connectionConfig, retryBudgetMillis } from './fixture.mjs';
import { NOW } from './goal50-fixture.mjs';
import { ACTIVITY_POLL_INTERVAL_MS } from '../src/progress.ts';
import {
  DESKTOP, LAPTOP, PHONE, PAGE_SIZE, MASTHEAD_H, SUBNAV_H, VIEWBAR_H, SCROLL_TOLERANCE, api, startRig, scene, main, region, sections, tab, navLink, table, rows, row, detail, cell,
  rowIds, idle, listState, status, combobox, button, hashParam, activityQueries, quiesce, open, filter, appendUntil, scrollers, horizontalOverflow, showAllColumns, largeFixture, scriptJobs,
} from './activity-scenes.mjs';

const rig = await startRig('Activity');
const FAILED = 'status:"failed"', STALE = 'freshness:"stale"', MIN_TEXT_CONTRAST = 4.5;
const sourceReads = fixture => fixture.calls.filter(call => [api.Operation_GetSession, api.Operation_GetMessages, api.Operation_GetRaw, api.Operation_GetChunks, api.Operation_Search].some(Type => call.operation instanceof Type)).length;
async function poll(page) { await advanceClock(page, ACTIVITY_POLL_INTERVAL_MS); }
async function expand(page, kind, id) { await button(row(page, kind, id), 'Details').click(); await detail(page, kind, id).waitFor(); return detail(page, kind, id); }
// The overview's lease/failure fixture of ux.mjs: one current failure, three Running jobs (active, expired, unleased), 58 historical failures, 120 collectors without a report.
const CURRENT_FAILED = '00000000-0000-4000-8000-000000090001', runningId = index => `00000000-0000-4000-8000-${String(90002 + index).padStart(12, '0')}`;
function leaseFixture(fixture) {
  const zero = new api.JobCounts(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);
  fixture.activityCollectors = Array.from({ length: 120 }, (_, index) => new api.ActivityCollector(`collector-${String(index).padStart(3, '0')}`, undefined, BigInt(index), 0n, zero, zero));
  const job = (id, revision, state, error) => new api.JobInfo(id, fixture.session.id, revision, state, 1, error, 0, undefined, undefined);
  const activity = (info, profile, classification, expires, active, retryable) => new api.ActivityJob(info, profile, classification, expires, active, retryable, fixture.source.collectorNamespace, fixture.jobSession(info), '2026-10-23T09:31:00Z');
  const failed = activity(job(CURRENT_FAILED, 2, api.JobState.Failed, 'Current failed work'), 'target-profile', api.ActivityJobClass.Current, undefined, false, true);
  const running = ['active', 'expired', 'unleased'].map((kind, index) => activity(job(runningId(index), 2, api.JobState.Running, kind === 'active' ? 'Previous-attempt synthetic failure' : undefined).with({ attempts: kind === 'active' ? 4 : 1 }), 'target-profile', api.ActivityJobClass.Current, kind === 'unleased' ? undefined : kind === 'active' ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z', kind === 'active', false));
  const history = Array.from({ length: 58 }, (_, index) => activity(job(`00000000-0000-4000-8000-${String(91000 + index).padStart(12, '0')}`, index % 3 === 1 ? 2 : 1, api.JobState.Failed, `Historical failure ${index + 1}`), index % 3 === 0 ? 'target-profile' : 'obsolete-profile', index % 3 === 0 ? api.ActivityJobClass.SupersededRevision : index % 3 === 1 ? api.ActivityJobClass.ObsoleteProfile : api.ActivityJobClass.SupersededRevisionAndProfile, undefined, false, false));
  fixture.activityJobs = [failed, ...running, ...history];
  scriptJobs(fixture, FAILED, item => item.job.state === api.JobState.Failed);
  scriptJobs(fixture, 'lease:"expired"', item => item.job.state === api.JobState.Running && item.leaseExpiresAt !== undefined && !item.leaseActive);
}

try {
  await rig.run('the sub-navigation routes five sections, each with the document as its only scroller and sticky chrome', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity', configure: largeFixture });
    await region(page, 'Overview').waitFor();
    assert.deepEqual(await sections(page).locator('a[aria-current="page"]').allInnerTexts(), ['Overview']);
    for (const [name, hash] of [['Collectors', '#/activity/collectors'], ['Jobs', '#/activity/jobs'], ['Model usage', '#/activity/usage'], ['Maintenance', '#/activity/maintenance'], ['Overview', '#/activity']]) {
      await open(page, name); assert.equal(await page.evaluate(() => location.hash), hash);
      assert.equal(await sections(page).locator('a[aria-current="page"]').count(), 1); assert.match(await sections(page).locator('a[aria-current="page"]').innerText(), new RegExp(`^${name}`));
      assert.deepEqual(await scrollers(page), [], `${name}: no inner scroller`);
      if (name === 'Collectors') assert.ok(await rows(page, 'collectors').first().evaluate(element => element.getBoundingClientRect().bottom <= innerHeight), 'the first collector row is visible at 1440x900 without scrolling (data starts high)');
    }
    // Reference copy stays optional; the snapshot controls and both maintenance actions stay reachable (goal50 "tab content").
    assert.equal(await button(main(page), 'Refresh snapshots').isVisible(), true); assert.equal(await button(main(page), 'About these snapshots').isVisible(), true);
    await open(page, 'Jobs'); await appendUntil(page, 'jobs', PAGE_SIZE * 3);
    assert.deepEqual(await scrollers(page), []); assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight));
    await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForFunction(() => scrollY === 1500);
    const tops = await page.evaluate(() => ({ subnav: document.querySelector('.activity-subnav').getBoundingClientRect().top, viewbar: document.querySelector('[data-view="activity-jobs"] [data-view-bar]').getBoundingClientRect().top, header: document.querySelector('table[data-list="activity-jobs"] thead th').getBoundingClientRect().top }));
    assert.deepEqual(tops, { subnav: MASTHEAD_H, viewbar: MASTHEAD_H + SUBNAV_H, header: MASTHEAD_H + SUBNAV_H + VIEWBAR_H }, 'sub-navigation, view bar and table header stack under the masthead');
    await open(page, 'Maintenance');
    for (const name of ['Retry all current failed indexing jobs', 'Rebuild archive index']) assert.equal(await button(region(page, 'Maintenance'), name).isVisible(), true);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed || call.operation instanceof api.Operation_ApplyOwnerReindex || call.operation instanceof api.Operation_PreviewRetryFailed || call.operation instanceof api.Operation_PreviewOwnerReindex).length, 0, 'navigating never previews or applies');
    await context.close();
  });

  await rig.run('the laptop and phone widths keep the lists tables without sideways document overflow, light and dark', async () => {
    for (const [viewport, scheme] of [[LAPTOP, 'light'], [PHONE, 'dark']]) {
      const { context, page } = await scene(rig, { route: '/activity', viewport, scheme, configure: fixture => { largeFixture(fixture); fixture.activityJobs = fixture.activityJobs.map((item, index) => index === 1 ? item.with({ session: item.session.with({ metadata: item.session.metadata.with({ title: 'Literal 猫🦄 <script>not markup</script> '.repeat(40), gitBranch: 'long-value-'.repeat(12) }) }) }) : item); } });
      await region(page, 'Overview').locator('.tile-value').first().waitFor(); assert.equal(await horizontalOverflow(page), false, `${viewport.width} Overview`);
      for (const name of ['Collectors', 'Jobs', 'Model usage', 'Maintenance']) { await open(page, name); assert.equal(await horizontalOverflow(page), false, `${viewport.width} ${name}`); assert.deepEqual(await scrollers(page), [], `${viewport.width} ${name}`); }
      await open(page, 'Jobs'); assert.equal(await table(page, 'jobs').evaluate(element => getComputedStyle(element).display), 'table');
      assert.equal(await rows(page, 'jobs').first().locator('a.cell-title').evaluate(element => element.textContent.includes('<script>') && element.children.length === 0), true, 'metadata stays literal text');
      await context.close();
    }
  });

  await rig.run('the overview counts owner-wide totals, orders what needs attention by severity and links each item to the list that explains it', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity', configure: fixture => { leaseFixture(fixture); const stale = new api.CollectorStatus(new api.CollectorProgressUpdate('collector-007', 1n, '00000000-0000-4000-8000-000000000097', api.CollectorPhase.Idle, '2026-10-26T11:00:00Z', new api.CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, undefined), '2026-10-26T11:01:00Z', true); fixture.activityCollectors = fixture.activityCollectors.map(item => item.collectorId === 'collector-007' ? item.with({ status: stale }) : item); } });
    const overview = region(page, 'Overview'), totals = overview.getByRole('table', { name: 'Job totals', exact: true });
    await totals.waitFor();
    assert.deepEqual(await totals.locator('tbody tr').first().locator('td').allTextContents(), ['4', '0', '3', '1', '0']);
    assert.deepEqual(await totals.locator('tbody tr').nth(1).locator('td').allTextContents(), ['58', '0', '0', '58', '0']);
    assert.match(await overview.innerText(), /current: 1 active · 1 expired · 1 unleased/);
    await overview.locator('[data-attention="stale"]').first().waitFor();
    const unscheduled = fixture.activityResult(new api.ActivityQuery('', api.ActivityCollectorSort.CollectorId, api.SortDirection.Asc, undefined, 1)).headsWithoutTargetJob > 0n;
    assert.deepEqual(await overview.locator('[data-list="attention"] [data-attention]').evaluateAll(items => items.map(item => item.dataset.attention)), ['failed', 'expired', 'stale', ...(unscheduled ? ['unscheduled'] : [])], 'most severe first');
    assert.match(await tab(page, 'Jobs').innerText(), /1 failed/); assert.match(await tab(page, 'Collectors').innerText(), /1 stale/);
    await overview.locator('[data-list="attention"] [data-attention="failed"]').click();
    await region(page, 'Jobs').waitFor(); await idle(page, 'jobs');
    assert.equal(await hashParam(page, 'q'), FAILED); assert.deepEqual(await rowIds(page, 'jobs'), [CURRENT_FAILED], 'the failed item opens the current failed jobs');
    await page.goBack(); await region(page, 'Overview').waitFor();
    await region(page, 'Overview').locator('[data-list="attention"] [data-attention="expired"]').click(); await idle(page, 'jobs');
    assert.deepEqual(await rowIds(page, 'jobs'), [runningId(1)]);
    await page.goBack(); await region(page, 'Overview').locator('[data-list="attention"] [data-attention="stale"]').click(); await region(page, 'Collectors').waitFor(); await idle(page, 'collectors');
    assert.equal(await hashParam(page, 'q'), STALE); assert.deepEqual(await rowIds(page, 'collectors'), ['collector-007']);
    assert.equal(sourceReads(fixture), 0, 'the overview reads no source');
    await context.close();
  });

  await rig.run('collectors append four pages by document scroll without duplicates, end with a marker and filter by metadata without touching owner totals', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: largeFixture });
    await idle(page, 'collectors'); assert.match(await status(page, 'collectors').textContent(), /155 collectors · 50 loaded/);
    assert.match(await (await expand(page, 'collectors', 'collector-000')).innerText(), /No stored report · collection progress unknown/); await button(row(page, 'collectors', 'collector-000'), 'Details').click();
    await appendUntil(page, 'collectors', 155);
    await listState(page, 'collectors', 'end').waitFor(); assert.equal(await listState(page, 'collectors', 'end').innerText(), 'End of list · 155 collectors');
    assert.match(await status(page, 'collectors').textContent(), /155 collectors · all loaded/);
    assert.equal(new Set(await rowIds(page, 'collectors')).size, 155);
    assert.ok(new Set(activityQueries(fixture, api.Operation_Activity).filter(query => query.expression === '' && query.limit === PAGE_SIZE).map(query => query.cursor)).size >= 4);
    const expression = 'collector:"collector-001" OR collector:"collector-002"'; fixture.collectorExpressions.set(expression, ['collector-001', 'collector-002']);
    await filter(page, 'collectors', expression); await row(page, 'collectors', 'collector-001').waitFor(); await idle(page, 'collectors');
    assert.deepEqual(await rowIds(page, 'collectors'), ['collector-001', 'collector-002']); assert.match(await status(page, 'collectors').textContent(), /^2 of 155 collectors · all loaded$/);
    assert.equal(await hashParam(page, 'q'), expression, 'the submitted expression is in the address');
    await open(page, 'Overview'); const totals = region(page, 'Overview').getByRole('table', { name: 'Job totals', exact: true });
    assert.deepEqual(await totals.locator('tbody tr td:first-of-type').allTextContents(), ['165', '165'], 'owner totals are not the matching collector totals');
    await open(page, 'Collectors'); assert.deepEqual(await rowIds(page, 'collectors'), ['collector-001', 'collector-002'], 'the filter survives a section round trip');
    await button(region(page, 'Collectors'), 'Clear Search collector metadata').click(); await idle(page, 'collectors');
    assert.equal(await combobox(page, 'collectors').inputValue(), ''); assert.equal(await hashParam(page, 'q'), null);
    await context.close();
  });

  await rig.run('collector details follow polled snapshots through discovery, scan, acknowledged upload, idle and failed/stale; denial, disconnect and account changes clear them', async () => {
    const report = new api.CollectorProgressUpdate('alice-private-collector', 9007199254740993n, '00000000-0000-4000-8000-000000000090', api.CollectorPhase.Discovering, '2026-10-26T01:00:00Z', new api.CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, undefined);
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: fixture => { fixture.collectors = [new api.CollectorStatus(report, '2026-10-26T01:01:00Z', false)]; } });
    const id = 'alice-private-collector', details = await expand(page, 'collectors', id);
    await details.getByText('Discovering · Recent report', { exact: true }).waitFor(); await details.getByText('Per-run collector counters', { exact: true }).click();
    assert.match(await details.innerText(), /sequence 9007199254740993/);
    const counter = label => details.locator(`[data-counter="${label}"] dd`);
    assert.equal(await counter('Scanned / discovered sessions').innerText(), '0 / 0');
    const scanning = report.with({ phase: api.CollectorPhase.Scanning, sequence: report.sequence + 1n, counters: report.counters.with({ discovered: 12, scanned: 7, waiting: 2, pending: 4, quarantined: 1, stopped: 1, conflicts: 1, uploadFailures: 2, scannedBytes: 9007199254740995n }) });
    fixture.collectors = [new api.CollectorStatus(scanning, '2026-10-26T01:02:00Z', false)]; await poll(page);
    await details.getByText('Scanning · Recent report', { exact: true }).waitFor();
    assert.equal(await counter('Scanned / discovered sessions').innerText(), '7 / 12'); assert.equal(await counter('Scanned bytes').innerText(), '9007199254740995 bytes');
    for (const [label, value] of [['Waiting for quiet', '2'], ['Pending upload queue', '4'], ['Quarantined', '1'], ['Stopped', '1'], ['Conflicts', '1'], ['Upload failures', '2']]) assert.equal(await counter(label).innerText(), value);
    const uploading = scanning.with({ phase: api.CollectorPhase.Uploading, sequence: scanning.sequence + 1n, counters: scanning.counters.with({ enqueued: 2, uploaded: 4 }), totalUploadBytes: 9007199254740999n, uploadedBytes: 9007199254740997n, currentUploadTotalBytes: 4096n });
    fixture.collectors = [new api.CollectorStatus(uploading, '2026-10-26T01:03:00Z', false)]; await poll(page);
    await details.getByText('Uploading · Recent report', { exact: true }).waitFor();
    assert.equal(await counter('Acknowledged bytes / queued payload bytes').innerText(), '9007199254740997 bytes / 9007199254740999 bytes');
    assert.equal(await counter('Current payload size (not acknowledged progress)').innerText(), '4096 bytes'); assert.doesNotMatch(await details.innerText(), /%/);
    fixture.collectors = [new api.CollectorStatus(uploading.with({ sequence: uploading.sequence + 1n, currentUploadTotalBytes: undefined }), '2026-10-26T01:04:00Z', false)]; await poll(page);
    await counter('Current payload size (not acknowledged progress)').filter({ hasText: /^unknown$/ }).waitFor();
    fixture.collectors = [new api.CollectorStatus(uploading.with({ phase: api.CollectorPhase.Idle, sequence: uploading.sequence + 2n }), '2026-10-26T01:05:00Z', false)]; await poll(page);
    await details.getByText('Idle · Recent report', { exact: true }).waitFor(); assert.equal(await counter('Current payload size (not acknowledged progress)').count(), 0);
    fixture.collectors = [new api.CollectorStatus(uploading.with({ phase: api.CollectorPhase.Failed, sequence: uploading.sequence + 3n, error: 'progress-upload-failed' }), '2026-10-26T01:06:00Z', true)]; await poll(page);
    await details.getByText('Failed · Stale report', { exact: true }).waitFor(); await details.getByText('Collector error: progress-upload-failed', { exact: true }).waitFor();
    assert.match(await details.innerText(), /Last known snapshot only; current collection progress is unknown/);
    await button(main(page), 'About these snapshots').click();
    const about = main(page).getByRole('dialog', { name: 'About these snapshots', exact: true }); await about.waitFor();
    assert.match(await about.innerText(), /Browser connectivity is not collector or worker health/); assert.match(await about.innerText(), /Missing, Idle or stale reports do not establish collection completion/);
    await page.keyboard.press('Escape'); await about.waitFor({ state: 'hidden' });
    fixture.collectionDenied = true; await button(main(page), 'Refresh snapshots').click();
    await region(page, 'Collectors').getByRole('alert').filter({ hasText: 'Collection status denied' }).waitFor();
    assert.equal(await region(page, 'Collectors').getByText(id, { exact: true }).count(), 0, 'a denied snapshot shows no previous private rows');
    fixture.collectionDenied = false; await button(region(page, 'Collectors'), 'Retry').click(); await row(page, 'collectors', id).waitFor();
    fixture.mode = 'outage'; fixture.restart(); await row(page, 'collectors', id).waitFor({ state: 'detached' });
    fixture.collectors = []; fixture.activityCollectors = []; fixture.activityJobs = [];
    fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read]); fixture.mode = 'normal'; fixture.restart();
    await advanceClockUntil(page, async () => await page.getByRole('button', { name: 'bob', exact: true }).count() > 0, retryBudgetMillis(connectionConfig), 'the new owner was not shown');
    await navLink(page, 'Activity').click(); await open(page, 'Collectors');
    await region(page, 'Collectors').getByRole('heading', { name: 'No matching collectors', exact: true }).waitFor();
    assert.equal(await page.getByText(id, { exact: true }).count(), 0); assert.match(await status(page, 'collectors').textContent(), /^0 collectors · all loaded$/);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_CollectionStatus || call.operation instanceof api.Operation_IngestStatus).length, 0);
    await context.close();
  });

  await rig.run('a timer pause alone renews the authorization epoch without moving the document or the rows', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: largeFixture });
    await idle(page, 'collectors'); const before = fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length, ids = await rowIds(page, 'collectors');
    // One jump of a pong deadline: longer than the timer-pause threshold, so the transport treats it as a long resume.
    await page.clock.fastForward(connectionConfig.pongTimeout);
    await fixture.waitUntil(() => fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length > before, 'a timer pause alone must refresh the authorization');
    await idle(page, 'collectors'); assert.deepEqual(await rowIds(page, 'collectors'), ids); assert.equal(await page.evaluate(() => scrollY), 0);
    await context.close();
  });

  await rig.run('every visible header requests its typed server order in both directions from the first page', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: largeFixture });
    async function check(kind, Type, fields, expected) {
      await showAllColumns(page, kind); await idle(page, kind);
      const headers = await table(page, kind).locator('thead th[data-sort]').evaluateAll(items => items.map(item => item.dataset.sort));
      assert.deepEqual([...headers].sort(), [...fields].sort(), 'every data header is a typed server sort');
      for (const field of fields) for (let toggle = 0; toggle < 2; toggle++) {
        const previous = activityQueries(fixture, Type).filter(query => query.limit === PAGE_SIZE).at(-1), direction = previous.sort === field && previous.direction === api.SortDirection.Asc ? api.SortDirection.Desc : api.SortDirection.Asc;
        const before = fixture.calls.length, header = table(page, kind).locator(`thead th[data-sort="${field}"]`), sort = header.locator('button.th-sort');
        await sort.click();
        await fixture.waitUntil(() => fixture.calls.slice(before).some(call => call.operation instanceof Type && call.operation.query.sort === field && call.operation.query.direction === direction), `${field} ${direction} not requested`);
        const query = fixture.calls.slice(before).find(call => call.operation instanceof Type && call.operation.query.sort === field).operation.query;
        assert.equal(query.cursor, undefined, 'a new order starts at the global beginning, never an old page cursor');
        const ids = expected(query); await row(page, kind, ids[0]).and(rows(page, kind).first()).waitFor(); await idle(page, kind);
        assert.deepEqual(await rowIds(page, kind), ids, `${field} ${direction} rows follow the server order`);
        assert.equal(await header.getAttribute('aria-sort'), direction === api.SortDirection.Asc ? 'ascending' : 'descending');
        assert.equal(await sort.evaluate(element => element === document.activeElement), true, 'focus stays on the sort control');
      }
    }
    await idle(page, 'collectors');
    await check('collectors', api.Operation_Activity, Object.values(api.ActivityCollectorSort), query => fixture.activityResult(query).collectors.map(item => item.collectorId));
    await open(page, 'Jobs');
    await check('jobs', api.Operation_ActivityJobs, Object.values(api.ActivityJobSort), query => fixture.activityJobsResult(query).jobs.map(item => item.job.id));
    await button(region(page, 'Jobs'), 'History').click(); await status(page, 'jobs').filter({ hasText: /165 historical jobs/ }).waitFor();
    for (const field of [api.ActivityJobSort.Revision, api.ActivityJobSort.Profile, api.ActivityJobSort.Classification]) {
      const before = fixture.calls.length; await table(page, 'jobs').locator(`thead th[data-sort="${field}"] button.th-sort`).click();
      await fixture.waitUntil(() => fixture.calls.slice(before).some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.sort === field), 'historical sort not requested');
      const query = fixture.calls.slice(before).find(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.sort === field).operation.query, ids = fixture.activityJobsResult(query).jobs.map(item => item.job.id);
      assert.equal(query.scope, api.ActivityJobScope.Historical); await row(page, 'jobs', ids[0]).and(rows(page, 'jobs').first()).waitFor(); await idle(page, 'jobs'); assert.deepEqual(await rowIds(page, 'jobs'), ids);
    }
    assert.equal(sourceReads(fixture), 0, 'list metadata never reads source, searches transcripts or reads sessions per row');
    await context.close();
  });

  await rig.run('jobs append by document scroll, keep Current and History apart, and never offer retry for historical failures', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: largeFixture });
    await idle(page, 'jobs'); const identities = fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length; await appendUntil(page, 'jobs', 165);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length, identities, 'infinite scrolling never forces a security-epoch reset');
    await listState(page, 'jobs', 'end').waitFor(); assert.equal(await listState(page, 'jobs', 'end').innerText(), 'End of list · 165 current jobs');
    assert.equal(new Set(await rowIds(page, 'jobs')).size, 165);
    assert.ok(new Set(activityQueries(fixture, api.Operation_ActivityJobs).map(query => query.cursor)).size >= 4);
    await page.evaluate(() => window.scrollTo(0, 0));
    await button(region(page, 'Jobs'), 'History').click(); await status(page, 'jobs').filter({ hasText: /^165 historical jobs/ }).waitFor(); await idle(page, 'jobs');
    assert.equal(await hashParam(page, 'scope'), 'history');
    await appendUntil(page, 'jobs', 165);
    const superseded = fixture.activityJobs.find(item => item.job.revision < fixture.headRevision);
    assert.equal(await cell(page, 'jobs', superseded.job.id, 'Title').innerText(), `${superseded.session.metadata.title}\n${superseded.session.metadata.project} · ${superseded.session.metadata.gitBranch}`);
    assert.equal(await cell(page, 'jobs', superseded.job.id, 'Revision').innerText(), 'r1', 'job revision metadata is not relabelled as the current HEAD r2');
    const historical = await expand(page, 'jobs', superseded.job.id);
    await historical.getByText('Historical job · not actionable here. This does not describe the current published view.', { exact: true }).waitFor();
    assert.match(await historical.innerText(), /Superseded revision/);
    assert.equal(await region(page, 'Jobs').getByRole('button', { name: 'Retry indexing', exact: true }).count(), 0, 'a historical failure is never offered a single-job retry');
    await button(region(page, 'Jobs'), 'Current').click(); await status(page, 'jobs').filter({ hasText: /^165 current jobs/ }).waitFor();
    const failed = fixture.activityJobs.find(item => item.retryable);
    assert.equal(await (await expand(page, 'jobs', failed.job.id)).getByRole('button', { name: 'Retry indexing', exact: true }).count(), 1, 'a current failure keeps its explicit retry');
    await context.close();
  });

  await rig.run('job details agree with the cells on leases, windows, prior attempts and failure stages, and follow polled progress', async () => {
    const stages = [api.IndexingFailureStage.Annotation, api.IndexingFailureStage.Embedding, api.IndexingFailureStage.Publication, undefined];
    const stageIds = stages.map((_, index) => `00000000-0000-4000-8000-${String(92000 + index).padStart(12, '0')}`);
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: fixture => {
      leaseFixture(fixture);
      const extra = stages.map((stage, index) => { const job = fixture.jobs[0].with({ id: stageIds[index], state: index === 1 ? api.JobState.Running : api.JobState.Failed, error: `retained-${index}`, failureStage: stage, completedWindows: 2, totalWindows: 3 }); return new api.ActivityJob(job, fixture.targetProfile, api.ActivityJobClass.Current, undefined, false, index !== 1, fixture.source.collectorNamespace, fixture.jobSession(job), '2026-10-24T09:31:00Z'); });
      const queued = fixture.jobs[0].with({ id: '00000000-0000-4000-8000-000000093000', state: api.JobState.Queued, attempts: 0, error: undefined, completedWindows: 0, totalWindows: undefined });
      fixture.publishedRevision = fixture.headRevision;
      fixture.activityJobs = [...fixture.activityJobs, ...extra, new api.ActivityJob(queued, fixture.targetProfile, api.ActivityJobClass.Current, undefined, false, false, fixture.source.collectorNamespace, fixture.jobSession(queued), '2026-10-22T09:31:00Z')];
      scriptJobs(fixture, 'lease:"unleased"', item => item.leaseExpiresAt === undefined && item.classification === api.ActivityJobClass.Current);
    } });
    await idle(page, 'jobs');
    for (const [index, label] of ['Active lease at snapshot', 'Expired lease at snapshot', 'Unleased · no lease expiry'].entries()) {
      const id = runningId(index); assert.equal(await cell(page, 'jobs', id, 'LeaseState').innerText(), ['Active', 'Expired', 'Unleased'][index]);
      assert.match(await (await expand(page, 'jobs', id)).innerText(), new RegExp(label)); await button(row(page, 'jobs', id), 'Details').click();
    }
    const prior = await expand(page, 'jobs', runningId(0));
    const priorText = prior.getByText('Previous-attempt synthetic failure', { exact: true });
    assert.match(await prior.innerText(), /Prior attempt\s+Previous-attempt synthetic failure · prior-attempt failure stage unknown \(not recorded\)/);
    assert.equal(await cell(page, 'jobs', runningId(0), 'Attempts').innerText(), '4'); assert.equal(await cell(page, 'jobs', runningId(0), 'Reason').innerText(), 'Prior: Previous-attempt synthetic failure');
    const priorColor = await priorText.evaluate(element => getComputedStyle(element).color);
    const failure = await expand(page, 'jobs', stageIds[0]);
    assert.notEqual(priorColor, await failure.getByText('retained-0', { exact: true }).evaluate(element => getComputedStyle(element).color), 'a prior-attempt error is not styled as the current failure');
    for (const [index, stage] of stages.entries()) {
      const text = await (index === 0 ? failure : await expand(page, 'jobs', stageIds[index])).innerText();
      assert.match(text, new RegExp(`${index === 1 ? 'prior-attempt failure stage' : 'failure stage'} ${stage === undefined ? 'unknown \\(not recorded\\)' : stage}`));
    }
    const queuedDetail = await expand(page, 'jobs', '00000000-0000-4000-8000-000000093000');
    assert.match(await queuedDetail.innerText(), /0 \/ unknown windows processed · job not Complete at this snapshot/); assert.doesNotMatch(await queuedDetail.innerText(), /not published by this job/i, 'the Activity data cannot attribute publication to this job');
    const running = await expand(page, 'jobs', stageIds[1]); assert.match(await running.innerText(), /2 \/ 3 windows processed · job not Complete at this snapshot/);
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === stageIds[1] ? item.with({ job: item.job.with({ completedWindows: 3 }) }) : item); await poll(page);
    await running.getByText(/3 \/ 3 windows processed · job not Complete at this snapshot/).waitFor();
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === stageIds[1] ? item.with({ job: item.job.with({ state: api.JobState.Complete }) }) : item); await poll(page);
    await running.getByText(/3 \/ 3 windows processed · job complete/).waitFor();
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === CURRENT_FAILED ? item.with({ classification: api.ActivityJobClass.SupersededRevision, retryable: false }) : item); await poll(page);
    await row(page, 'jobs', CURRENT_FAILED).waitFor({ state: 'detached' }); assert.match(await tab(page, 'Jobs').textContent(), /^Jobs3 failed$/, 'a job that became historical leaves the current failures');
    await filter(page, 'jobs', 'lease:"unleased"'); await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'lease:"unleased"'); await idle(page, 'jobs');
    const unleased = fixture.jobRows.filter(item => item.leaseExpiresAt === undefined && item.classification === api.ActivityJobClass.Current).map(item => item.job.id);
    assert.deepEqual([...await rowIds(page, 'jobs')].sort(), [...unleased].sort());
    const before = fixture.calls.length; await table(page, 'jobs').locator('thead th[data-sort="LeaseState"] button.th-sort').click();
    await fixture.waitUntil(() => fixture.calls.slice(before).some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.expression === 'lease:"unleased"' && call.operation.query.sort === api.ActivityJobSort.LeaseState), 'the lease order kept the predicate');
    await context.close();
  });

  await rig.run('job metadata filters compose with shortcuts and Ctrl K, reject search modes and unknown fields without fallback, and end in the empty state', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: fixture => { largeFixture(fixture); fixture.activityJobs = fixture.activityJobs.map((item, index) => index % 2 === 0 ? item.with({ session: item.session.with({ source: item.session.source.with({ format: api.SourceFormat.Historian, discoveryRootId: 'yolo:JobRevision' }) }) }) : item); } });
    await idle(page, 'jobs');
    const body = 'project:"project-1" OR status:failed', expression = `(${body}) AND branch:"branch-1"`;
    scriptJobs(fixture, expression, item => (item.session.metadata.project === 'project-1' || item.job.state === api.JobState.Failed) && item.session.metadata.gitBranch === 'branch-1');
    await page.keyboard.press('Control+k'); assert.equal(await combobox(page, 'jobs').evaluate(element => element === document.activeElement), true, 'Ctrl K focuses the job expression');
    await combobox(page, 'jobs').fill(body); await button(region(page, 'Jobs'), 'Add Branch filter').click();
    assert.equal(await combobox(page, 'jobs').inputValue(), `(${body}) AND branch:`, 'a field shortcut conjoins the whole Boolean body');
    await combobox(page, 'jobs').fill('producer:"synthetic-harness" OR format:"historian"'); await button(region(page, 'Jobs'), 'Subagents').click();
    assert.equal(await combobox(page, 'jobs').inputValue(), '(producer:"synthetic-harness" OR format:"historian") AND agent:"subagent"', 'a preset conjoins the recorded-agent claim');
    for (const name of ['Add Agent filter', 'Add Recorded yolo profile filter']) assert.equal(await button(region(page, 'Jobs'), name).count(), 1);
    await filter(page, 'jobs', expression); await fixture.waitUntil(() => activityQueries(fixture, api.Operation_ActivityJobs).some(query => query.expression === expression), 'expression not requested');
    const expected = fixture.jobRows.filter(item => item.classification === api.ActivityJobClass.Current && fixture.jobExpressions.get(expression).includes(item.job.id));
    await status(page, 'jobs').filter({ hasText: new RegExp(`^${expected.length} current jobs`) }).waitFor(); assert.equal(await rows(page, 'jobs').count(), expected.length);
    const profile = 'yolo-profile:JobRevision'; scriptJobs(fixture, profile, item => item.session.source.discoveryRootId === 'yolo:JobRevision');
    await filter(page, 'jobs', profile); await status(page, 'jobs').filter({ hasText: /^83 current jobs/ }).waitFor(); await idle(page, 'jobs');
    assert.match(await (await expand(page, 'jobs', (await rowIds(page, 'jobs'))[0])).innerText(), /pi \/ Historian · model .*yolo profile JobRevision/s, 'recorded identity claims come from source provenance, never title heuristics');
    const before = activityQueries(fixture, api.Operation_ActivityJobs).length;
    await filter(page, 'jobs', '(mode:semantic)'); await region(page, 'Jobs').getByRole('alert').filter({ hasText: 'Search mode directives are not supported' }).waitFor();
    assert.equal(await rows(page, 'jobs').count(), 0); assert.equal(activityQueries(fixture, api.Operation_ActivityJobs).length, before, 'Activity never requests a search mode or silently strips it');
    fixture.activityFailure = 'Unknown Activity metadata field at character 1'; await filter(page, 'jobs', 'unknown:value');
    await region(page, 'Jobs').getByRole('alert').filter({ hasText: 'Unknown Activity metadata field at character 1' }).waitFor(); assert.equal(await rows(page, 'jobs').count(), 0);
    fixture.activityFailure = null; fixture.jobExpressions.set('transcript-only-needle', []); await filter(page, 'jobs', 'transcript-only-needle');
    const empty = listState(page, 'jobs', 'empty'); await empty.getByRole('heading', { name: 'No matching current jobs', exact: true }).waitFor();
    await button(empty, 'Look in History').click(); await empty.getByRole('heading', { name: 'No matching historical jobs', exact: true }).waitFor(); assert.equal(await hashParam(page, 'scope'), 'history');
    await button(empty, 'Clear filter').click(); await rows(page, 'jobs').first().waitFor(); assert.equal(await combobox(page, 'jobs').inputValue(), '');
    // Clearing one editor leaves the other (filter-table-ux "clear resets only its own editor").
    await combobox(page, 'jobs').fill('status:failed'); await open(page, 'Collectors'); await combobox(page, 'collectors').fill('freshness:stale');
    await button(region(page, 'Collectors'), 'Clear Search collector metadata').click(); assert.equal(await combobox(page, 'collectors').inputValue(), '');
    await open(page, 'Jobs'); assert.equal(await combobox(page, 'jobs').inputValue(), 'status:failed', 'the job draft survives the section round trip and the other editor\'s clear');
    assert.equal(sourceReads(fixture), 0, 'metadata filters never read transcript bodies or fall back to Archive/Search');
    await context.close();
  });

  await rig.run('both metadata editors use their own provider-free completion targets and a scope change dismisses old suggestions', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: fixture => { fixture.holdHints = false; } });
    fixture.holdHints = false; const hints = () => fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).map(call => call.operation.query);
    await idle(page, 'collectors'); await combobox(page, 'collectors').fill('col'); await advanceClock(page, 200); await page.getByRole('listbox').waitFor();
    assert.ok(hints().at(-1).target instanceof api.ExpressionHintTarget_ActivityCollectors);
    await open(page, 'Jobs'); await combobox(page, 'jobs').fill('status:'); await advanceClock(page, 200); await page.getByRole('listbox').waitFor();
    assert.ok(hints().at(-1).target instanceof api.ExpressionHintTarget_ActivityJobs); assert.equal(hints().at(-1).target.scope, api.ActivityJobScope.Current);
    await button(region(page, 'Jobs'), 'History').click(); assert.equal(await page.getByRole('listbox').count(), 0, 'a scope change dismisses the old suggestions');
    await combobox(page, 'jobs').focus(); await advanceClock(page, 200); await page.getByRole('listbox').waitFor(); assert.equal(hints().at(-1).target.scope, api.ActivityJobScope.Historical);
    assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_Search), false); assert.ok(activityQueries(fixture, api.Operation_ActivityJobs).every(query => query.expression === ''), 'typing never submits');
    await context.close();
  });

  await rig.run('stale cursor replies are dropped across expression and scope changes', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: largeFixture });
    await idle(page, 'collectors'); fixture.holdCollectorCursor = true;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await fixture.waitUntil(() => activityQueries(fixture, api.Operation_Activity).some(query => query.cursor !== undefined), 'old collector cursor request not sent'); assert.equal(fixture.pendingCollectors.length, 1);
    const expression = 'collector:"collector-153" OR collector:"collector-154"'; fixture.collectorExpressions.set(expression, ['collector-153', 'collector-154']);
    await filter(page, 'collectors', expression); await row(page, 'collectors', 'collector-153').waitFor(); await idle(page, 'collectors');
    fixture.releaseCollectors(); await quiesce(page); assert.deepEqual(await rowIds(page, 'collectors'), ['collector-153', 'collector-154'], 'a late page of the old query is dropped');
    await open(page, 'Jobs'); fixture.holdJobCursor = true;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await fixture.waitUntil(() => activityQueries(fixture, api.Operation_ActivityJobs).some(query => query.cursor !== undefined), 'old job cursor request not sent'); assert.equal(fixture.pendingJobs.length, 1);
    const scoped = 'collector:"collector-154"'; scriptJobs(fixture, scoped, item => item.collectorId === 'collector-154');
    await button(region(page, 'Jobs'), 'History').click(); await filter(page, 'jobs', scoped);
    const expected = fixture.jobRows.filter(item => item.classification !== api.ActivityJobClass.Current && item.collectorId === 'collector-154').map(item => item.job.id);
    await row(page, 'jobs', expected[0]).waitFor(); await idle(page, 'jobs'); fixture.releaseJobs(); await quiesce(page);
    assert.deepEqual(await rowIds(page, 'jobs'), expected, 'a late page of the old scope is dropped');
    const first = activityQueries(fixture, api.Operation_ActivityJobs).find(query => query.expression === scoped);
    assert.equal(first.cursor, undefined); assert.equal(first.scope, api.ActivityJobScope.Historical); assert.equal(first.collectorId, undefined, 'the collector restriction is part of the expression');
    await context.close();
  });

  await rig.run('job rows with a mismatched owner, source, revision or annotation generation are rejected before rendering', async () => {
    for (const mismatch of ['owner', 'source', 'revision', 'generation']) {
      const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: fixture => {
        const normal = fixture.activityJobsResult.bind(fixture), item = fixture.jobRows[0];
        const session = mismatch === 'owner' ? item.session.with({ ownerId: 'another-owner' }) : mismatch === 'source' ? item.session.with({ id: '00000000-0000-4000-8000-000000009999' }) : item.session.with({ view: new api.ContentView(mismatch === 'revision' ? item.job.revision + 1 : item.job.revision, mismatch === 'generation' ? fixture.view.generationId : undefined) });
        fixture.activityJobsResult = query => normal(query).with({ jobs: [item.with({ session })], total: 1n, nextCursor: undefined });
      } });
      await region(page, 'Jobs').getByRole('alert').filter({ hasText: 'Activity job metadata does not match its owner, source and job revision' }).waitFor();
      assert.equal(await rows(page, 'jobs').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession).length, 0);
      await context.close();
    }
  });

  await rig.run('a collector links to its jobs through a removable expression chip, a job links to its conversation, and Back restores rows, scroll and focus', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/collectors', configure: fixture => {
      largeFixture(fixture);
      const chip = 'collector:"collector-001"', failedChip = `(${FAILED}) AND ${chip}`;
      scriptJobs(fixture, chip, item => item.collectorId === 'collector-001'); scriptJobs(fixture, failedChip, item => item.collectorId === 'collector-001' && item.job.state === api.JobState.Failed);
      scriptJobs(fixture, FAILED, item => item.job.state === api.JobState.Failed);
    } });
    await idle(page, 'collectors');
    await row(page, 'collectors', 'collector-001').getByRole('link', { name: 'Jobs of collector-001', exact: true }).click();
    await region(page, 'Jobs').waitFor(); await idle(page, 'jobs');
    assert.equal(await hashParam(page, 'q'), 'collector:"collector-001"');
    const own = fixture.jobRows.filter(item => item.collectorId === 'collector-001' && item.classification === api.ActivityJobClass.Current).map(item => item.job.id);
    assert.deepEqual([...await rowIds(page, 'jobs')].sort(), [...own].sort());
    const remove = button(region(page, 'Jobs'), 'Remove collector filter collector-001'); await remove.waitFor();
    await page.goBack(); await region(page, 'Collectors').waitFor();
    const failedLink = cell(page, 'collectors', 'collector-001', 'CurrentFailed').getByRole('link'); await failedLink.click(); await idle(page, 'jobs');
    assert.equal(await hashParam(page, 'q'), `(${FAILED}) AND collector:"collector-001"`); assert.ok((await rowIds(page, 'jobs')).every(id => fixture.jobRows.find(item => item.job.id === id).job.state === api.JobState.Failed));
    await remove.click(); await page.waitForFunction(value => new URLSearchParams(location.hash.split('?')[1]).get('q') === value, FAILED); await idle(page, 'jobs');
    assert.equal(await combobox(page, 'jobs').inputValue(), FAILED, 'removing the chip keeps the rest of the expression'); assert.equal(await remove.count(), 0);
    await button(region(page, 'Jobs'), 'Clear Search indexing job metadata').click(); await idle(page, 'jobs');
    await appendUntil(page, 'jobs', PAGE_SIZE * 3);
    await page.evaluate(() => window.scrollTo(0, 2400)); await page.waitForFunction(() => scrollY === 2400);
    const target = await rows(page, 'jobs').evaluateAll(items => items.find(item => item.getBoundingClientRect().top > innerHeight / 2).dataset.rowId), link = row(page, 'jobs', target).locator('a.cell-title');
    assert.equal(await link.getAttribute('href'), `#/session/${fixture.jobRows.find(item => item.job.id === target).job.sessionId}`);
    await link.click(); await page.waitForFunction(() => location.hash.startsWith('#/session/'));
    await page.evaluate(() => history.back()); await region(page, 'Jobs').waitFor({ state: 'visible' });
    await page.waitForFunction(tolerance => Math.abs(scrollY - 2400) <= tolerance, SCROLL_TOLERANCE);
    assert.equal(await rows(page, 'jobs').count(), PAGE_SIZE * 3, 'Back keeps the loaded rows');
    assert.equal(await link.evaluate(element => element === document.activeElement), true, 'focus returns to the originating row');
    await navLink(page, 'Archive').click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor();
    await navLink(page, 'Activity').click(); await region(page, 'Jobs').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => location.hash), '#/activity/jobs', 'the masthead link returns to the last shown section');
    await page.waitForFunction(tolerance => Math.abs(scrollY - 2400) <= tolerance, SCROLL_TOLERANCE); assert.equal(await rows(page, 'jobs').count(), PAGE_SIZE * 3, 'a tab round trip keeps the loaded rows');
    await button(region(page, 'Jobs'), 'History').click(); await table(page, 'jobs').locator('thead th[data-sort="Attempts"] button.th-sort').click(); await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('sort') === 'Attempts');
    await page.reload(); await region(page, 'Jobs').waitFor(); await idle(page, 'jobs');
    assert.deepEqual({ scope: await button(region(page, 'Jobs'), 'History').getAttribute('aria-pressed'), sort: await table(page, 'jobs').locator('thead th[data-sort="Attempts"]').getAttribute('aria-sort') }, { scope: 'true', sort: 'ascending' }, 'reload restores section, scope and order');
    await context.close();
  });

  await rig.run('a remote reorder while scrolled shows the pill and leaves rows and scroll until it is applied', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: largeFixture });
    await idle(page, 'jobs'); await appendUntil(page, 'jobs', PAGE_SIZE * 2);
    await page.evaluate(() => window.scrollTo(0, 1200)); await page.waitForFunction(() => scrollY === 1200);
    const before = await rowIds(page, 'jobs'), moved = before.at(-1);
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === moved ? item.with({ lastTimestamp: '2029-12-31T00:00:00Z' }) : item); await poll(page);
    const pill = button(region(page, 'Jobs'), 'Updated jobs · show latest'); await pill.waitFor();
    assert.deepEqual(await rowIds(page, 'jobs'), before, 'rows stay until the update is applied'); assert.equal(await page.evaluate(() => scrollY), 1200);
    await pill.click(); await rows(page, 'jobs').first().and(row(page, 'jobs', moved)).waitFor(); assert.equal(await pill.count(), 0);
    await context.close();
  });

  await rig.run('a single-job retry reports success through the toast and the next snapshot shows the job Queued', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs' });
    const id = fixture.jobs[0].id; await idle(page, 'jobs');
    await button(await expand(page, 'jobs', id), 'Retry indexing').click();
    await page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('status').getByText('Retry indexing job completed.', { exact: true }).waitFor();
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_RetryJob).length, 1); assert.equal(await page.locator('.global-mutation-notices .notice').count(), 0);
    await cell(page, 'jobs', id, 'State').getByText('Queued', { exact: true }).waitFor();
    await context.close();
  });

  await rig.run('without Read scope no protected list, count or retry action is shown or read', async () => {
    const fixture = new ChronicleFixture(); fixture.user = fixture.user.with({ scopes: [api.Scope.Ingest] });
    const { context, page } = await scene(rig, { route: '/activity/jobs', fixture });
    await main(page).getByRole('alert').filter({ hasText: 'Read scope is required to view your activity' }).waitFor();
    assert.equal(await main(page).getByRole('table').count(), 0); assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).count(), 0);
    assert.equal(fixture.calls.filter(call => [api.Operation_Activity, api.Operation_ActivityJobs, api.Operation_PreviewRetryFailed, api.Operation_ApplyRetryFailed, api.Operation_ModelUsage].some(Type => call.operation instanceof Type)).length, 0);
    await context.close();
  });

  await rig.run('the column menus open from the keyboard, protect required columns, change only the presentation and return focus', async () => {
    // Fitting measures the rendered text: a monospace collector ID and a title whose newlines collapse (filter-table-ux.mjs).
    const long = { collectors: fixture => { const result = fixture.activityResult(new api.ActivityQuery('', api.ActivityCollectorSort.CollectorId, api.SortDirection.Asc, undefined, PAGE_SIZE)); fixture.activityCollectors = [result.collectors[0].with({ collectorId: 'i'.repeat(40) })]; },
      jobs: fixture => { fixture.activityJobs = fixture.jobRows.map(item => item.with({ session: item.session.with({ metadata: item.session.metadata.with({ title: 'word\n'.repeat(18) }) }) })); } };
    for (const [viewport, kind] of [[DESKTOP, 'collectors'], [DESKTOP, 'jobs'], [PHONE, 'jobs']]) {
      const { context, page, fixture } = await scene(rig, { route: `/activity/${kind}`, viewport, configure: long[kind] });
      await idle(page, kind); const name = { collectors: 'Collectors', jobs: 'Indexing jobs' }[kind], scope = region(page, { collectors: 'Collectors', jobs: 'Jobs' }[kind]);
      const trigger = button(scope, `${name} table options`), menu = page.getByRole('menu', { name: `${name} table options`, exact: true }), headers = () => table(page, kind).locator('thead th').count();
      const sent = fixture.calls.length, compact = await headers();
      await trigger.focus(); await page.keyboard.press('Enter'); await menu.waitFor();
      assert.equal(await menu.locator('[role="menuitemcheckbox"]').first().evaluate(element => element === document.activeElement), true, 'the first item takes focus');
      assert.equal(await menu.getByRole('menuitemcheckbox', { name: kind === 'jobs' ? 'Conversation' : 'Collector', exact: true }).getAttribute('aria-disabled'), 'true', 'the required column cannot be hidden');
      await menu.getByRole('menuitem', { name: 'Show all columns', exact: true }).click(); assert.ok(await headers() > compact);
      await trigger.click(); await menu.getByRole('menuitem', { name: 'Fit columns to content', exact: true }).click();
      const fitted = await rows(page, kind).first().locator('.cell-title').evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      assert.ok(fitted.scroll <= fitted.client + 1, `fit to content follows the rendered text: ${JSON.stringify(fitted)}`);
      await trigger.click(); await menu.getByRole('menuitem', { name: 'Reset columns', exact: true }).click(); assert.equal(await headers(), compact);
      await trigger.click(); await menu.waitFor(); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the trigger');
      assert.equal(await horizontalOverflow(page), false);
      assert.equal(fixture.calls.slice(sent).filter(call => !(call.operation instanceof api.Operation_Ping)).length, 0, 'presentation controls never sort, search, read source or write');
      await context.close();
    }
  });

  await rig.run('the job scope control keeps WCAG AA text contrast selected and unselected, at rest and on hover', async () => {
    const { context, page } = await scene(rig, { route: '/activity/jobs' });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await idle(page, 'jobs');
    const group = region(page, 'Jobs').getByRole('group', { name: 'Indexing job scope', exact: true });
    const contrast = locator => locator.evaluate(element => {
      const rgba = value => { const parts = value.match(/[\d.]+/g).map(Number); return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]]; };
      const ancestors = []; for (let node = element; node !== null; node = node.parentElement) ancestors.push(node);
      let background = [255, 255, 255];
      for (const node of ancestors.reverse()) { const value = rgba(getComputedStyle(node).backgroundColor); background = background.map((channel, index) => value[index] * value[3] + channel * (1 - value[3])); }
      const color = rgba(getComputedStyle(element).color), foreground = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
      const luminance = channels => channels.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const front = luminance(foreground), back = luminance(background);
      return (Math.max(front, back) + .05) / (Math.min(front, back) + .05);
    });
    for (const selected of ['Current', 'History']) {
      await button(group, selected).click();
      for (const label of ['Current', 'History']) {
        await page.mouse.move(0, 0); assert.ok(await contrast(button(group, label)) >= MIN_TEXT_CONTRAST, `${selected} selected / ${label} at rest`);
        await button(group, label).hover(); assert.ok(await contrast(button(group, label)) >= MIN_TEXT_CONTRAST, `${selected} selected / ${label} on hover`);
      }
    }
    await context.close();
  });

  await rig.run('model usage shows exactly four purposes with unknown, no-report, zero, N/A and i64 values, explains them in a popover and lists the settings', async () => {
    for (const scheme of ['light', 'dark']) {
      const { context, page, fixture } = await scene(rig, { route: '/activity/usage', scheme, configure: fixture => {
        const base = fixture.usage(), empty = new api.TokenRateWindow(0n, 0n, 0n, undefined, 51586n), unknown = new api.TokenRateWindow(0n, 0n, 1n, undefined, undefined), zero = new api.TokenRateWindow(0n, 1n, 0n, 0, 0n);
        fixture.usage = () => base.with({ samples: base.samples.map(sample => sample.purpose === api.ModelPurpose.Annotation ? sample.with({ inFlight: 2, finishedCalls: 0n, failedCalls: 0n, cancelledCalls: 0n, invalidUsageCalls: 0n, input: empty, output: empty, reasoningSubset: empty }) : sample.purpose === api.ModelPurpose.DocumentEmbedding ? sample.with({ inFlight: 0, finishedCalls: 1n, input: unknown }) : sample.purpose === api.ModelPurpose.QueryEmbedding ? sample.with({ inFlight: 0, finishedCalls: 1n, input: zero }) : sample) });
      } });
      const usage = region(page, 'Model usage'), table = usage.getByRole('table', { name: 'Completed model call usage', exact: true }); await table.waitFor();
      assert.equal(await table.locator('tbody tr').count(), 4);
      const purpose = name => table.locator(`tbody tr[data-purpose="${name}"]`), cells = name => purpose(name).locator('td');
      assert.match(await purpose(api.ModelPurpose.Annotation).locator('th').innerText(), /Annotation\s+0 reported calls · last sample 51586 ms ago/, 'an old last sample stays visible while the window has no reports');
      assert.equal(await cells(api.ModelPurpose.Annotation).first().innerText(), '2', 'requests in flight now are counted although the window has no reports');
      assert.match(await cells(api.ModelPurpose.Annotation).nth(1).innerText(), /—\s+No reports in this window/, 'no reports is not an unknown or zero rate');
      assert.match(await cells(api.ModelPurpose.DocumentEmbedding).nth(1).innerText(), /^Unknown/); assert.equal(await cells(api.ModelPurpose.DocumentEmbedding).nth(2).innerText(), 'n/a');
      assert.match(await cells(api.ModelPurpose.QueryEmbedding).nth(1).innerText(), /^0 TPS/);
      assert.match(await cells(api.ModelPurpose.McpTest).nth(1).innerText(), /9007199254740993 tokens · 1 unknown/, 'i64 token counts keep every digit');
      assert.match(await usage.innerText(), /covered 9990 ms/); assert.doesNotMatch(await usage.innerText(), /In flight counts|Unknown is unavailable/, 'the measurement reference is optional, not a banner before the data');
      await usage.getByRole('heading', { name: 'Indexing settings', exact: true }).waitFor(); assert.equal(await usage.locator('input').count(), 0);
      assert.match(await usage.locator('dl').innerText(), /Annotation sessions\s+2\s+Embedding requests\s+3\s+Embedding batch size\s+8/);
      await button(usage, 'About usage measurements').click(); const about = usage.getByRole('dialog', { name: 'About usage measurements', exact: true }); await about.waitFor();
      for (const text of [/Finished includes failed and cancelled/, /malformed provider usage, not annotation validation/, /Last reported samples may be older than the window/, /Unknown is unavailable, not zero/, /Reasoning is included in output/]) assert.match(await about.innerText(), text);
      await page.keyboard.press('Escape'); await about.waitFor({ state: 'hidden' });
      assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ModelUsage).length, 1, 'one read until the clock reaches the next poll');
      await context.close();
    }
  });

  await rig.run('usage coalesces slow polls, and an authority error or an account change erases earlier samples', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/usage', configure: fixture => { fixture.holdUsage = true; } });
    const usage = region(page, 'Model usage'), table = usage.getByRole('table', { name: 'Completed model call usage', exact: true });
    await fixture.waitCall(api.Operation_ModelUsage, 1); await advanceClock(page, ACTIVITY_POLL_INTERVAL_MS * 2 + 100);
    assert.equal(fixture.usagePending.length, 1, 'a slow read is never overlapped');
    fixture.holdUsage = false; fixture.usagePending.shift()(); await table.waitFor();
    fixture.usageDenied = true; await advanceClock(page, ACTIVITY_POLL_INTERVAL_MS + 100);
    await usage.getByRole('alert').filter({ hasText: 'Usage authority removed' }).waitFor(); assert.equal(await table.count(), 0);
    fixture.usageDenied = false; await advanceClock(page, ACTIVITY_POLL_INTERVAL_MS + 100); await table.waitFor();
    fixture.holdUsage = true; fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart();
    await table.waitFor({ state: 'detached' });
    await advanceClockUntil(page, async () => await page.getByRole('button', { name: 'bob', exact: true }).count() > 0, retryBudgetMillis(connectionConfig), 'the new owner was not shown'); assert.equal(await page.getByRole('table', { name: 'Completed model call usage', exact: true }).count(), 0, 'a new account never sees the previous samples');
    await context.close();
  });

  rig.finish();
} finally { await rig.close(); }
