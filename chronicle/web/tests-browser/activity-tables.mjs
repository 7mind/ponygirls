import assert from 'node:assert/strict';
import { ChronicleFixture, api } from './fixture.mjs';

async function until(predicate, message) { for (let attempt = 0; attempt < 150; attempt++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(message); }
function largeFixture(fixture) {
  const total = 330, currentTotal = 165, collectorTotal = 155, states = [api.JobState.Complete, api.JobState.Failed, api.JobState.Queued, api.JobState.Running];
  fixture.activityJobs = Array.from({ length: total }, (_, index) => {
    const current = index < currentTotal, historical = index % 3, revision = current || historical === 1 ? fixture.headRevision : fixture.headRevision - 1;
    const profile = current || historical === 0 ? fixture.targetProfile : 'obsolete-profile', state = current ? states[index % states.length] : api.JobState.Failed;
    const base = fixture.jobAt(index), collectorId = `collector-${String(index % collectorTotal).padStart(3, '0')}`;
    const job = base.job.with({ revision, state, error: state === api.JobState.Failed ? current ? 'current-synthetic-failure' : 'historical-synthetic-failure' : state === api.JobState.Running ? 'prior-attempt-synthetic' : undefined, completedWindows: index % 9, totalWindows: index % 5 === 0 ? undefined : index % 9 + 10 });
    const metadata = fixture.metadata.with({ title: `${revision === fixture.headRevision ? 'Current' : 'Historical'} metadata ${String(index).padStart(3, '0')}`, project: `project-${index % 7}`, gitBranch: `branch-${index % 4}`, tags: [`tag-${index % 5}`] });
    const session = fixture.jobSession(job).with({ metadata, source: base.session.source.with({ collectorNamespace: `${collectorId}/native` }) });
    const classification = current ? api.ActivityJobClass.Current : historical === 0 ? api.ActivityJobClass.SupersededRevision : historical === 1 ? api.ActivityJobClass.ObsoleteProfile : api.ActivityJobClass.SupersededRevisionAndProfile;
    const active = state === api.JobState.Running && index % 3 === 0, expires = state !== api.JobState.Running || index % 3 === 2 ? undefined : active ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z';
    return new api.ActivityJob(job, profile, classification, expires, active, current && state === api.JobState.Failed, collectorId, session, index % 17 === 0 ? undefined : new Date(Date.parse('2026-10-23T09:31:00Z') - Math.floor(index / 2) * 60000).toISOString());
  });
  fixture.jobs = fixture.activityJobs.map(row => row.job);
  fixture.archiveRows = fixture.activityJobs.map((job, index) => { const row = fixture.archiveAt(index), head = row.head.with({ source: job.session.source, metadata: job.job.revision === fixture.headRevision ? job.session.metadata : fixture.metadata.with({ title: `HEAD metadata ${index}` }) }); return row.with({ head, headJob: job.classification === api.ActivityJobClass.Current ? job.job : undefined }); });
  fixture.activityCollectors = Array.from({ length: collectorTotal }, (_, index) => {
    const id = `collector-${String(index).padStart(3, '0')}`, jobs = fixture.activityJobs.filter(row => row.collectorId === id), heads = fixture.archiveRows.filter(row => row.head.source.collectorNamespace === `${id}/native`);
    const phase = [api.CollectorPhase.Idle, api.CollectorPhase.Discovering, api.CollectorPhase.Uploading, api.CollectorPhase.Failed][index % 4], stale = index % 5 === 0;
    const report = new api.CollectorProgressUpdate(id, BigInt(index + 1), `00000000-0000-4000-8000-${String(70000 + index).padStart(12, '0')}`, phase, '2026-10-26T11:50:00Z', new api.CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, phase === api.CollectorPhase.Failed ? 'collector-synthetic-failure' : undefined);
    const status = index % 3 === 0 ? undefined : new api.CollectorStatus(report, stale ? '2026-10-26T11:55:00Z' : `2026-10-26T11:59:${String(index % 10).padStart(2, '0')}Z`, stale);
    return new api.ActivityCollector(id, status, BigInt(heads.length), BigInt(heads.filter(row => row.headJob === undefined).length), fixture.counts(jobs.filter(row => row.classification === api.ActivityJobClass.Current)), fixture.counts(jobs.filter(row => row.classification !== api.ActivityJobClass.Current)));
  });
}
function queuedPublicationFixture(fixture) {
  fixture.publishedRevision = fixture.headRevision;
  const queued = fixture.jobs[0].with({ state: api.JobState.Queued, attempts: 0, error: undefined, completedWindows: 0, totalWindows: undefined });
  const complete = new api.JobInfo('00000000-0000-4000-8000-000000000008', fixture.archiveAt(1).head.id, fixture.headRevision, api.JobState.Complete, 1, undefined, 2, 2);
  fixture.jobs = [queued, complete];
  fixture.activityJobs = [new api.ActivityJob(queued, fixture.targetProfile, api.ActivityJobClass.Current, undefined, false, false, fixture.source.collectorNamespace, fixture.jobSession(queued), '2026-10-23T09:31:00Z'), new api.ActivityJob(complete, fixture.targetProfile, api.ActivityJobClass.Current, '2020-01-01T00:00:00Z', false, false, fixture.source.collectorNamespace, fixture.jobSession(complete), '2026-10-23T09:31:00Z')];
  fixture.jobExpressions.set('lease:unleased', [queued.id]);
}
async function appendUntil(page, scroller, rows, count) {
  await until(async () => { if (await page.locator(rows).count() >= count) return true; await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; }); return false; }, `Expected ${count} rows in ${scroller}`);
}
async function filter(page, name, expression) {
  const editor = page.getByRole('region', { name: `${name} metadata search`, exact: true });
  await editor.getByRole('textbox', { name: `Search ${name.toLowerCase()} metadata`, exact: true }).fill(expression); await editor.getByRole('button', { name: 'Filter', exact: true }).click();
}
async function rowIds(page, selector) { return page.locator(selector).evaluateAll(rows => rows.map(row => row.getAttribute('data-scroll-anchor'))); }
export async function runActivityTableCases({ browser, origin, run, errors }) {
  async function scene(configure) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(), fixture = new ChronicleFixture();
    page.on('pageerror', error => errors.push(error.message)); if (configure !== null) configure(fixture);
    await fixture.install(page); await page.goto(`${origin}/tests-browser/harness.html`); await page.locator('.archive-row').first().waitFor();
    await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.locator('.activity-overview').waitFor();
    return { context, page, fixture };
  }
  for (const mismatch of [{ label: 'inner request ID', button: 'Return wrong inner request ID' }, { label: 'target profile', button: 'Return wrong target profile' }, { label: 'result type', button: 'Return wrong result type' }]) await run(`bulk hook unverified ${mismatch.label} retains original uncertainty and blocks new writes`, async () => {
    const context = await browser.newContext(), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/tests-browser/mutations.html`); await page.getByRole('button', { name: 'Start apply', exact: true }).click();
    const first = page.getByRole('region', { name: 'Mutation request 0', exact: true });
    const id = await first.locator('output[aria-label="Request ID"]').textContent();
    await first.getByRole('button', { name: mismatch.button, exact: true }).click();
    await until(async () => await page.locator('output[aria-label="Busy"]').textContent() === 'false', 'unverified reply did not settle its request');
    await page.getByRole('button', { name: 'Attempt another write', exact: true }).click();
    assert.deepEqual({ uncertain: await page.locator('output[aria-label="Uncertain request"]').textContent(), delivered: await page.locator('output[aria-label="Delivered requests"]').textContent() }, { uncertain: id, delivered: '1' }, 'a delivered but unverifiable reply is not proof of refusal; retain the original payload/ID and block another write');
    assert.equal(await page.locator('output[aria-label="Uncertain owner"]').textContent(), 'alice');
    assert.equal(await page.locator('output[aria-label="Typed result"]').textContent(), 'none');
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Mutation request 1', exact: true });
    assert.equal(await receipt.locator('output[aria-label="Operation"]').textContent(), 'receipt'); assert.equal(await receipt.locator('output[aria-label="Request ID"]').textContent(), id);
    await receipt.getByRole('button', { name: 'Return typed success', exact: true }).click();
    await until(async () => await page.locator('output[aria-label="Uncertain request"]').textContent() === 'none', 'typed receipt did not reconcile the original request');
    assert.equal(await page.locator('output[aria-label="Typed result"]').textContent(), `${id}:target-profile:1`);
    assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '2', 'recovery is a receipt read, not an automatic Apply replay');
    await context.close();
  });
  await run('activity tables request every typed global header sort in both directions with nulls and ties', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    await until(async () => await page.locator('.activity-collector-row').count() === 50 && await page.locator('.activity-job-row').count() === 50, 'initial Activity pages did not load');
    assert.equal(fixture.calls.find(call => call.operation instanceof api.Operation_Activity).operation.query.sort, api.ActivityCollectorSort.CollectorId);
    assert.equal(fixture.calls.find(call => call.operation instanceof api.Operation_Activity).operation.query.direction, api.SortDirection.Asc);
    assert.equal(fixture.calls.find(call => call.operation instanceof api.Operation_ActivityJobs).operation.query.sort, api.ActivityJobSort.LastTimestamp);
    assert.equal(fixture.calls.find(call => call.operation instanceof api.Operation_ActivityJobs).operation.query.direction, api.SortDirection.Desc);
    async function check(tableSelector, rowSelector, scroller, operationType, fields, resultRows) {
      const table = page.locator(tableSelector), headers = await table.locator('thead th[data-sort]').evaluateAll(items => items.map(item => item.getAttribute('data-sort')));
      assert.deepEqual([...headers].sort(), [...fields].sort(), 'every visible data header is a typed server sort');
      assert.equal(await table.locator('thead th:not([data-sort])').innerText(), 'Actions');
      for (const field of fields) for (let toggle = 0; toggle < 2; toggle++) {
        const previous = fixture.calls.filter(call => call.operation instanceof operationType).at(-1).operation.query;
        const direction = previous.sort === field && previous.direction === api.SortDirection.Asc ? api.SortDirection.Desc : api.SortDirection.Asc;
        const before = fixture.calls.length, header = table.locator(`thead th[data-sort="${field}"]`), button = header.getByRole('button');
        await button.click();
        await until(() => fixture.calls.slice(before).some(call => call.operation instanceof operationType && call.operation.query.sort === field && call.operation.query.direction === direction), `${field} sort request missing`);
        const query = fixture.calls.slice(before).find(call => call.operation instanceof operationType && call.operation.query.sort === field && call.operation.query.direction === direction).operation.query;
        assert.equal(query.cursor, undefined, 'a new sort starts at the global beginning, never an old page cursor');
        const expected = resultRows(query);
        await until(async () => JSON.stringify(await rowIds(page, rowSelector)) === JSON.stringify(expected), `${field} rows did not match the globally sorted server page`);
        await page.locator(`${tableSelector}[aria-busy="false"]`).waitFor();
        assert.equal(await header.getAttribute('aria-sort'), direction === api.SortDirection.Asc ? 'ascending' : 'descending');
        assert.equal(await button.evaluate(element => element === document.activeElement), true, 'sort focus survives resource replacement');
        assert.equal(await page.locator(scroller).evaluate(element => element.scrollTop), 0);
      }
    }
    await check('.activity-collector-table', '.activity-collector-row', '.activity-collector-scroll', api.Operation_Activity, Object.values(api.ActivityCollectorSort), query => fixture.activityResult(query).collectors.map(row => row.collectorId));
    await check('.activity-job-table', '.activity-job-row', '.activity-job-scroll', api.Operation_ActivityJobs, Object.values(api.ActivityJobSort), query => fixture.activityJobsResult(query).jobs.map(row => row.job.id));
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await until(async () => (await page.locator('.activity-jobs .eyebrow').textContent()).includes('165 matching historical'), 'history scope did not load');
    for (const field of [api.ActivityJobSort.Revision, api.ActivityJobSort.Profile, api.ActivityJobSort.Classification]) {
      const before = fixture.calls.length; await page.locator(`.activity-job-table th[data-sort="${field}"] button`).click();
      await until(() => fixture.calls.slice(before).some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.sort === field), 'historical sort not requested');
      const query = fixture.calls.slice(before).find(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.sort === field).operation.query;
      await until(async () => JSON.stringify(await rowIds(page, '.activity-job-row')) === JSON.stringify(fixture.activityJobsResult(query).jobs.map(row => row.job.id)), 'historical revision/profile sort did not use its global universe');
    }
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetMessages || call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_GetChunks || call.operation instanceof api.Operation_Search).length, 0, 'table metadata never performs source reads, transcript search, ANN fallback or per-row GetSession');
    await context.close();
  });
  await run('activity tables independently append four pages without duplicates and retain unfiltered owner totals', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    await appendUntil(page, '.activity-collector-scroll', '.activity-collector-row', 155);
    const collectorPosition = await page.locator('.activity-collector-scroll').evaluate(element => element.scrollTop), identities = fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length;
    await appendUntil(page, '.activity-job-scroll', '.activity-job-row', 165);
    if (fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length !== identities) console.log('Synthetic density epoch diagnostics:', await page.locator('.event-log').textContent());
    assert.deepEqual({ position: await page.locator('.activity-collector-scroll').evaluate(element => element.scrollTop), collectors: await page.locator('.activity-collector-row').count(), identities: fixture.calls.filter(call => call.operation instanceof api.Operation_Whoami).length }, { position: collectorPosition, collectors: 155, identities }, 'job infinite scroll must not move collector scroll or force a security-epoch reset');
    assert.equal(new Set(await rowIds(page, '.activity-collector-row')).size, 155); assert.equal(new Set(await rowIds(page, '.activity-job-row')).size, 165);
    assert.ok(new Set(fixture.calls.filter(call => call.operation instanceof api.Operation_Activity).map(call => call.operation.query.cursor)).size >= 4);
    assert.ok(new Set(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).map(call => call.operation.query.cursor)).size >= 4);
    const totals = page.getByRole('table', { name: 'All your current and historical indexing jobs', exact: true });
    assert.deepEqual(await totals.locator('tbody tr td:first-of-type').allTextContents(), ['165', '165']);
    const expression = 'collector:"collector-001" OR collector:"collector-002"'; fixture.collectorExpressions.set(expression, ['collector-001', 'collector-002']);
    await filter(page, 'Collector', expression); await until(async () => await page.locator('.activity-collector-row').count() === 2, 'collector metadata filter did not reset loaded pages');
    assert.match(await page.locator('.activity-collectors .eyebrow').textContent(), /2 matching \/ 155 owner collectors/);
    assert.deepEqual(await totals.locator('tbody tr td:first-of-type').allTextContents(), ['165', '165'], 'owner totals are not the matching collector table totals');
    assert.equal(await page.locator('.activity-job-row').count(), 165, 'collector-table metadata search does not silently filter the independent jobs table');
    await page.getByRole('button', { name: 'History', exact: true }).click(); await appendUntil(page, '.activity-job-scroll', '.activity-job-row', 165);
    assert.equal(await page.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 0, 'historical failure rows are never revived through single-job controls');
    const superseded = fixture.activityJobs.find(row => row.job.revision < fixture.headRevision), historicalRow = page.locator(`.activity-job-row[data-scroll-anchor="${superseded.job.id}"]`);
    assert.equal(await historicalRow.locator('[data-column="Title"]').innerText(), `${superseded.session.metadata.title}\n${superseded.session.metadata.project} · ${superseded.session.metadata.gitBranch}`);
    assert.equal(await historicalRow.locator('[data-column="Revision"]').innerText(), 'r1', 'job revision metadata is not relabelled as current HEAD r2');
    await context.close();
  });
  await run('activity tables compose mode-free metadata filters and clear rejected query results without fallback', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    const body = 'project:"project-1" OR status:failed', expression = `(${body}) AND branch:"branch-1"`;
    fixture.jobExpressions.set(expression, fixture.activityJobs.filter(row => (row.session.metadata.project === 'project-1' || row.job.state === api.JobState.Failed) && row.session.metadata.gitBranch === 'branch-1').map(row => row.job.id));
    const editor = page.getByRole('region', { name: 'Indexing job metadata search', exact: true });
    await page.keyboard.press('Control+k'); assert.equal(await editor.getByRole('textbox', { name: 'Search indexing job metadata', exact: true }).evaluate(element => element === document.activeElement), true);
    await editor.getByRole('textbox', { name: 'Search indexing job metadata', exact: true }).fill(body); await editor.locator('.quick-filters > summary').click();
    await editor.getByRole('combobox', { name: 'Field', exact: true }).selectOption('branch'); await editor.getByRole('combobox', { name: 'Value', exact: true }).fill('branch-1'); await editor.getByRole('button', { name: 'Apply filter', exact: true }).click();
    await until(() => fixture.calls.some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.expression === expression), 'quick filter did not conjoin the entire Boolean metadata body');
    const expected = fixture.activityJobs.filter(row => row.classification === api.ActivityJobClass.Current && fixture.jobExpressions.get(expression).includes(row.job.id));
    await until(async () => await page.locator('.activity-job-row').count() === expected.length, 'metadata results did not load');
    assert.match(await page.locator('.activity-jobs .eyebrow').textContent(), new RegExp(`${expected.length} matching current jobs`));
    const before = fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).length;
    await filter(page, 'Indexing job', '(mode:semantic)'); await page.getByRole('alert').filter({ hasText: 'Search mode directives are not supported' }).waitFor();
    assert.equal(await page.locator('.activity-job-row').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).length, before, 'Activity never requests an inference/search mode or silently strips it');
    fixture.activityFailure = 'Unknown Activity metadata field at character 1'; await filter(page, 'Indexing job', 'unknown:value'); await page.getByRole('alert').filter({ hasText: 'Unknown Activity metadata field at character 1' }).waitFor(); assert.equal(await page.locator('.activity-job-row').count(), 0);
    fixture.activityFailure = null; fixture.jobExpressions.set('transcript-only-needle', []); await filter(page, 'Indexing job', 'transcript-only-needle'); await page.getByRole('heading', { name: 'No matching current jobs', exact: true }).waitFor();
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetRaw || call.operation instanceof api.Operation_GetMessages).length, 0, 'metadata filters never read transcript bodies or fall back to Archive/Search');
    await context.close();
  });
  await run('activity tables reject old cursor replies across expression, scope and collector resets', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    await until(async () => await page.locator('.activity-collector-row').count() === 50 && await page.locator('.activity-job-row').count() === 50, 'initial pages did not load');
    fixture.holdCollectorCursor = true; await page.locator('.activity-collector-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await until(() => fixture.pendingCollectors.length > 0, 'old collector cursor request not captured');
    const expression = 'collector:"collector-153" OR collector:"collector-154"'; fixture.collectorExpressions.set(expression, ['collector-153', 'collector-154']);
    await filter(page, 'Collector', expression); await until(async () => await page.locator('.activity-collector-row').count() === 2, 'new collector query not loaded');
    fixture.releaseCollectors(); await page.waitForTimeout(100);
    assert.deepEqual(await rowIds(page, '.activity-collector-row'), ['collector-153', 'collector-154']); assert.equal(await page.locator('.activity-collector-scroll').evaluate(element => element.scrollTop), 0);
    fixture.holdJobCursor = true; await page.locator('.activity-job-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; }); await until(() => fixture.pendingJobs.length > 0, 'old job cursor request not captured');
    await page.getByRole('button', { name: 'History', exact: true }).click(); await page.getByLabel('Collector ID', { exact: true }).fill('collector-154'); await page.locator('.activity-collector-filter').getByRole('button', { name: 'Apply', exact: true }).click();
    const expected = fixture.activityJobs.filter(row => row.classification !== api.ActivityJobClass.Current && row.collectorId === 'collector-154').map(row => row.job.id);
    await until(async () => JSON.stringify(await rowIds(page, '.activity-job-row')) === JSON.stringify(expected), 'new scope and collector did not replace old pages');
    fixture.releaseJobs(); await page.waitForTimeout(100); assert.deepEqual(await rowIds(page, '.activity-job-row'), expected); assert.equal(await page.locator('.activity-job-scroll').evaluate(element => element.scrollTop), 0);
    const requests = fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.collectorId === 'collector-154');
    assert.equal(requests[0].operation.query.cursor, undefined); assert.equal(requests[0].operation.query.scope, api.ActivityJobScope.Historical);
    await context.close();
  });
  await run('bulk preview is owner-wide despite filters and cancel sends no mutation', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    await page.getByRole('button', { name: 'History', exact: true }).click(); await page.getByLabel('Collector ID', { exact: true }).fill('collector-154'); await page.locator('.activity-collector-filter').getByRole('button', { name: 'Apply', exact: true }).click();
    const expression = 'tag:"does-not-exist"'; fixture.jobExpressions.set(expression, []); await filter(page, 'Indexing job', expression); await page.getByRole('heading', { name: 'No matching historical jobs', exact: true }).waitFor();
    const trigger = page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }); await trigger.click();
    const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').waitFor();
    const counts = fixture.retryPlan().counts;
    for (const [label, expected] of [['Eligible current failed jobs', counts.eligibleCurrentFailed], ['Historical failed · superseded revision (excluded)', counts.supersededRevisionFailed], ['Historical failed · obsolete profile (excluded)', counts.obsoleteProfileFailed], ['Historical failed · superseded revision and profile (excluded)', counts.supersededRevisionAndProfileFailed], ['Current Queued (unchanged)', counts.unchangedQueued], ['Current Running (unchanged)', counts.unchangedRunning], ['Current Complete (unchanged)', counts.unchangedComplete]]) assert.equal(await preview.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).locator('td').innerText(), expected.toString());
    assert.equal(await preview.getByRole('checkbox').isChecked(), false); assert.equal(await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).isDisabled(), true);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); assert.equal(fixture.receipts.size, 0);
    await preview.getByRole('button', { name: 'Cancel retry preview', exact: true }).click(); assert.equal(await preview.count(), 0); assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); assert.equal(fixture.bulkApplyExecutions, 0); await context.close();
  });
  await run('bulk explicit apply retries every owner current failure once and reports pre-action not live counts', async () => {
    const { context, page, fixture } = await scene(largeFixture);
    const before = new Map(fixture.jobRows.map(row => [row.job.id, JSON.stringify(row)])), eligible = new Set(fixture.jobRows.filter(row => row.retryable).map(row => row.job.id)), plan = fixture.retryPlan();
    await page.getByRole('button', { name: 'History', exact: true }).click(); await page.getByLabel('Collector ID', { exact: true }).fill('collector-154'); await page.locator('.activity-collector-filter').getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').check(); await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click();
    const result = page.getByRole('region', { name: 'Indexing retry result', exact: true }); await result.waitFor(); assert.match(await result.innerText(), /not current live job totals/);
    assert.equal(await result.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Eligible current failed jobs', exact: true }) }).locator('td').innerText(), plan.counts.eligibleCurrentFailed.toString());
    assert.equal(fixture.bulkApplyExecutions, 1); const requests = fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed); assert.equal(requests.length, 1); assert.equal(requests[0].operation.selectionHash, plan.selectionHash); assert.equal(requests[0].operation.targetProfile, plan.targetProfile); assert.equal(requests[0].operation.confirm, true);
    for (const row of fixture.jobRows) if (eligible.has(row.job.id)) { assert.equal(row.job.state, api.JobState.Queued); assert.equal(row.job.attempts, 0); assert.equal(row.job.error, undefined); assert.equal(row.job.completedWindows, 0); assert.equal(row.job.totalWindows, undefined); } else assert.equal(JSON.stringify(row), before.get(row.job.id), 'historical and non-failed jobs are untouched');
    const current = page.getByRole('table', { name: 'All your current and historical indexing jobs', exact: true }).getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Current', exact: true }) });
    await until(async () => (await current.locator('td').allTextContents())[3] === '0', 'live current failures did not refresh independently');
    assert.equal(await result.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Eligible current failed jobs', exact: true }) }).locator('td').innerText(), '41', 'receipt counts remain pre-action facts after live count becomes zero');
    assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).isDisabled(), true); await context.close();
  });
  await run('bulk lost success reply reconciles one committed apply through its typed receipt without replay', async () => {
    const { context, page, fixture } = await scene(value => { value.bulkDropReply = true; });
    await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); await page.getByRole('checkbox', { name: /I confirm retrying all/ }).check(); await page.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click();
    await page.getByRole('heading', { name: 'Confirm before repeating', exact: true }).waitFor(); await page.locator('.connection-widget[data-state="live"]').waitFor();
    assert.equal(fixture.bulkApplyExecutions, 1); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 1);
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); const result = page.getByRole('region', { name: 'Indexing retry result', exact: true }); await result.waitFor();
    assert.match(await result.innerText(), /Server retried 1 indexing jobs to Queued/); assert.equal(await page.getByRole('heading', { name: 'Confirm before repeating', exact: true }).count(), 0);
    const apply = fixture.calls.find(call => call.operation instanceof api.Operation_ApplyRetryFailed), receipt = fixture.calls.find(call => call.operation instanceof api.Operation_Receipt);
    assert.equal(receipt.operation.mutationId, apply.requestId); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 1); assert.equal(fixture.bulkApplyExecutions, 1); await context.close();
  });
  await run('bulk direct conflict reads a new plan and requires renewed explicit confirmation', async () => {
    const { context, page, fixture } = await scene(value => { largeFixture(value); value.bulkConflictOnce = true; });
    await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); await page.getByRole('checkbox', { name: /I confirm retrying all/ }).check(); await page.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click();
    await until(() => fixture.calls.filter(call => call.operation instanceof api.Operation_PreviewRetryFailed).length === 2, 'conflict did not request a fresh read-only plan');
    const preview = page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').waitFor(); assert.equal(await preview.getByRole('checkbox').isChecked(), false); assert.equal(await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).isDisabled(), true);
    assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 1, 'conflict never automatically resubmits a stale payload');
    await preview.getByRole('checkbox').check(); await preview.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click(); await page.getByRole('region', { name: 'Indexing retry result', exact: true }).waitFor();
    const requests = fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed); assert.equal(requests.length, 2); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.notEqual(requests[0].operation.selectionHash, requests[1].operation.selectionHash); assert.equal(fixture.bulkApplyExecutions, 1); await context.close();
  });
  await run('bulk zero current failures excludes 58 historical failures and preview preserves all i64 digits', async () => {
    const { context, page, fixture } = await scene(value => {
      largeFixture(value); value.activityJobs = value.jobRows.filter(row => row.classification === api.ActivityJobClass.Current && row.job.state !== api.JobState.Failed).concat(value.jobRows.filter(row => row.classification !== api.ActivityJobClass.Current).slice(0, 58)); value.jobs = value.activityJobs.map(row => row.job); value.refreshActivityCounts();
    });
    await page.getByRole('button', { name: 'History', exact: true }).click(); await appendUntil(page, '.activity-job-scroll', '.activity-job-row', 58);
    assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).isDisabled(), true); assert.match(await page.locator('.retry-failed-action').innerText(), /No current failed indexing jobs are eligible.*Historical failures are excluded/s); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_PreviewRetryFailed || call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); await context.close();
    const huge = 9007199254740993n, formatted = await scene(value => { value.retryCountsOverride = new api.RetryFailedCounts(huge, huge + 1n, huge + 2n, huge + 3n, huge + 4n, huge + 5n, huge + 6n); });
    await formatted.page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); const preview = formatted.page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }); await preview.getByRole('checkbox').waitFor();
    assert.deepEqual(await preview.locator('tbody td').allTextContents(), Array.from({ length: 7 }, (_, index) => (huge + BigInt(index)).toString())); await preview.getByRole('button', { name: 'Cancel retry preview', exact: true }).click(); assert.equal(formatted.fixture.bulkApplyExecutions, 0); await formatted.context.close();
  });
  await run('bulk browser Read denials clear confirmation without inventing authority or mutating', async () => {
    for (const stage of ['preview', 'apply']) {
      const { context, page, fixture } = await scene(value => { value.bulkPreviewDenied = stage === 'preview'; value.bulkApplyDenied = stage === 'apply'; });
      await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click(); if (stage === 'apply') { await page.getByRole('checkbox', { name: /I confirm retrying all/ }).check(); await page.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click(); }
      await page.getByRole('alert').filter({ hasText: 'Browser Read scope required' }).waitFor(); assert.equal(await page.getByRole('checkbox', { name: /I confirm retrying all/ }).count(), 0); assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(fixture.receipts.size, 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, stage === 'apply' ? 1 : 0); await context.close();
    }
  });
  await run('activity tables reject mismatched owner, source, revision or annotation metadata before rendering', async () => {
    for (const mismatch of ['owner', 'source', 'revision', 'generation']) {
      const { context, page, fixture } = await scene(value => {
        const normal = value.activityJobsResult.bind(value), row = value.jobRows[0], session = mismatch === 'owner' ? row.session.with({ ownerId: 'another-owner' }) : mismatch === 'source' ? row.session.with({ id: '00000000-0000-4000-8000-000000009999' }) : row.session.with({ view: new api.ContentView(mismatch === 'revision' ? row.job.revision + 1 : row.job.revision, mismatch === 'generation' ? value.view.generationId : undefined) });
        value.activityJobsResult = query => normal(query).with({ jobs: [row.with({ session })], total: 1n, nextCursor: undefined });
      });
      await page.getByRole('alert').filter({ hasText: 'Activity job metadata does not match its owner, source and job revision' }).waitFor(); assert.equal(await page.locator('.activity-job-row').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_GetSession).length, 0); await context.close();
    }
  });
  await run('bulk hook clears typed results and ignores late apply or receipt results across security and account changes', async () => {
    const context = await browser.newContext(), page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/tests-browser/mutations.html`);
    const typed = page.locator('output[aria-label="Typed result"]'), busy = page.locator('output[aria-label="Busy"]');
    async function settled() { await until(async () => await busy.textContent() === 'false', 'deferred mutation did not settle'); }
    async function begin(index) { await page.getByRole('button', { name: 'Start apply', exact: true }).click(); const request = page.getByRole('region', { name: `Mutation request ${index}`, exact: true }); await request.waitFor(); return request; }
    const first = await begin(0); await first.getByRole('button', { name: 'Return typed success', exact: true }).click(); await settled(); assert.notEqual(await typed.textContent(), 'none');
    await page.getByRole('button', { name: 'Invalidate', exact: true }).click(); assert.equal(await typed.textContent(), 'none');
    const invalidated = await begin(1); await page.getByRole('button', { name: 'Invalidate', exact: true }).click(); await invalidated.getByRole('button', { name: 'Return typed success', exact: true }).click(); await settled(); assert.equal(await typed.textContent(), 'none', 'a late previous-security-epoch apply cannot publish counts');
    const previousOwner = await begin(2); await page.getByRole('button', { name: 'Change account', exact: true }).click(); await previousOwner.getByRole('button', { name: 'Return typed success', exact: true }).click(); await settled(); assert.equal(await typed.textContent(), 'none', 'a previous-account apply cannot publish counts');
    await page.getByRole('button', { name: 'Sign in original', exact: true }).click(); const uncertain = await begin(3); await uncertain.getByRole('button', { name: 'Reject uncertain delivery', exact: true }).click(); await settled(); await page.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Mutation request 4', exact: true }); await receipt.waitFor(); await page.getByRole('button', { name: 'Change account', exact: true }).click(); await receipt.getByRole('button', { name: 'Return typed success', exact: true }).click(); await settled(); assert.equal(await typed.textContent(), 'none', 'a previous-account receipt cannot publish counts');
    const current = await begin(5); await current.getByRole('button', { name: 'Return typed success', exact: true }).click(); await settled(); assert.notEqual(await typed.textContent(), 'none'); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); assert.equal(await typed.textContent(), 'none'); await context.close();
  });
  await run('activity tables without Read scope expose no protected tables or retry action', async () => {
    const context = await browser.newContext(), page = await context.newPage(), fixture = new ChronicleFixture(); page.on('pageerror', error => errors.push(error.message)); fixture.user = fixture.user.with({ scopes: [api.Scope.Ingest] }); await fixture.install(page); await page.goto(`${origin}/tests-browser/harness.html`);
    await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Read scope is required to view your activity' }).waitFor();
    assert.equal(await page.locator('.activity-table').count(), 0); assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Activity || call.operation instanceof api.Operation_ActivityJobs || call.operation instanceof api.Operation_PreviewRetryFailed || call.operation instanceof api.Operation_ApplyRetryFailed).length, 0); await context.close();
  });
  await run('activity truth lease cells agree with details and lease-unleased metadata filtering', async () => {
    const { context, page, fixture } = await scene(queuedPublicationFixture), id = fixture.jobs[0].id;
    const row = page.locator(`.activity-job-row[data-scroll-anchor="${id}"]`); await row.waitFor();
    const before = await row.locator('[data-column="LeaseState"]').innerText(); await row.locator('.activity-row-details > summary').click();
    const details = await row.locator('.activity-job-lease').innerText(); await row.locator('.activity-row-details > summary').click();
    const retained = await page.locator('.activity-job-row[data-scroll-anchor="00000000-0000-4000-8000-000000000008"] [data-column="LeaseState"]').innerText();
    await filter(page, 'Indexing job', 'lease:unleased'); await until(async () => await page.locator('.activity-job-row').count() === 1, 'unleased metadata filter did not return the queued row');
    await page.locator('.activity-job-table th[data-sort="LeaseState"] button').click(); await until(() => fixture.calls.some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.expression === 'lease:unleased' && call.operation.query.sort === api.ActivityJobSort.LeaseState), 'lease sort did not keep the metadata predicate');
    assert.deepEqual({ cellBefore: before, detailsUnleased: details.startsWith('Unleased'), retainedNonRunningLease: retained, filteredIds: await rowIds(page, '.activity-job-row'), cellAfter: await row.locator('[data-column="LeaseState"]').innerText() }, { cellBefore: 'Unleased', detailsUnleased: true, retainedNonRunningLease: 'Inactive', filteredIds: [id], cellAfter: 'Unleased' });
    await context.close();
  });
  await run('activity truth queued progress cannot attribute absence of an existing publication', async () => {
    const { context, page, fixture } = await scene(queuedPublicationFixture), queued = fixture.jobRows[0];
    assert.equal(queued.job.state, api.JobState.Queued); assert.equal(queued.session.indexedRevision, queued.job.revision, 'the fixture retains publication at the queued job revision');
    const row = page.locator(`.activity-job-row[data-scroll-anchor="${queued.job.id}"]`); await row.locator('.activity-row-details > summary').click(); const progress = await row.locator('.activity-window-progress').innerText();
    assert.doesNotMatch(progress, /not published by this job/i, 'the Activity DTO cannot attribute publication or its absence to this logical job'); assert.match(progress, /job not Complete at this snapshot/);
    await context.close();
  });
  await run('activity tables expose dense globally sortable metadata tables', async () => {
    const { context, page } = await scene(null);
    assert.equal(await page.getByRole('table', { name: 'Collectors', exact: true }).count(), 1, 'collector metadata is a table rather than a large card list');
    assert.equal(await page.getByRole('table', { name: 'Indexing jobs', exact: true }).count(), 1, 'job metadata is a table rather than a large card list');
    await context.close();
  });
  await run('bulk confirmed-absent retry conflict retains uncertainty pending durable receipt proof', async () => {
    const { context, page, fixture } = await scene(value => { value.bulkDropBeforeCommit = true; });
    await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).click();
    await page.getByRole('region', { name: 'Retry failed indexing preview', exact: true }).waitFor();
    await page.getByRole('checkbox', { name: /I confirm retrying all/ }).check();
    await page.getByRole('button', { name: 'Confirm retry indexing jobs', exact: true }).click();
    await page.getByRole('heading', { name: 'Confirm before repeating', exact: true }).waitFor();
    await page.locator('.connection-widget[data-state="live"]').waitFor();
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    await page.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).waitFor();
    fixture.bulkDropBeforeCommit = false; fixture.jobFences.set(fixture.jobs[0].id, 42);
    await page.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /Retry selection changed/i }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).count(), 1, 'one conflict reply cannot prove every delivered same-ID copy is terminal');
    assert.equal(fixture.bulkApplyExecutions, 0);
    const applies = fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed);
    assert.equal(applies.length, 2); assert.equal(applies[0].requestId, applies[1].requestId);
    assert.equal(applies[0].operation.selectionHash, applies[1].operation.selectionHash);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_PreviewRetryFailed).length, 1, 'a global recovery conflict requires an explicit new preview, not an unrelated automatic preview');
    assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).isDisabled(), true, 'new writes stay blocked until a durable receipt reconciles the request');
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    await until(() => fixture.calls.filter(call => call.operation instanceof api.Operation_Receipt).length === 2, 'terminal conflict receipt was not queried');
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('heading', { name: 'Confirm before repeating', exact: true }).count(), 0, 'only the durable terminal conflict receipt ends uncertainty');
    assert.equal(await page.getByRole('button', { name: 'Retry all current failed indexing jobs', exact: true }).isEnabled(), true);
    assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ApplyRetryFailed).length, 2);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_PreviewRetryFailed).length, 1, 'rejected global recovery requires an explicit fresh preview');
    await context.close();
  });
}
