// Activity Maintenance (redesign spec §3.1, unit UX-C5): owner-wide retry of failed indexing jobs and the archive rebuild, each
// previewed in the shared confirmation dialog; one scenario script, runnable alone. Cases moved here from activity-tables.mjs,
// rebuild.mjs, goal50.mjs and theme-retry.mjs; the mutation-hook cases (mutations.html) moved from activity-tables.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { advanceClock, advanceClockUntil, connectionConfig, retryBudgetMillis } from './fixture.mjs';
import { Goal50Fixture, NOW } from './goal50-fixture.mjs';
import { REINDEX_STATUS_POLL_MS } from '../src/reindex-status.ts';
import { DESKTOP, PHONE, api, startRig, scene, main, region, navLink, row, detail, button, open, filter, idle, quiesce, largeFixture, scriptJobs, signIn } from './activity-scenes.mjs';

const rig = await startRig('Activity maintenance');
// Synthetic accepted rebuild commands and separately observed finite cohorts (rebuild.mjs); no workers, database or providers run.
class RebuildFixture extends Goal50Fixture {
  archiveRowCount = 3; holdStatus = false; statusReplies = []; statusError = null; statusTransform = result => result; statusCounts = [0n, 0n, 0n, 3n];
  reindexPlan() { const heads = BigInt(this.authorizedRows.length), hash = createHash('sha256').update(JSON.stringify([this.user.id, this.targetProfile, heads.toString()])).digest('hex'); return new api.OwnerReindexPlan(this.targetProfile, this.targetProfile, hash, heads, 0n, heads); }
  handle(operation, envelope, send, entry) {
    if (operation instanceof api.Operation_ApplyOwnerReindex) {
      const plan = this.reindexPlan();
      const reply = operation.confirm && operation.targetProfile === plan.targetProfile && operation.selectionHash === plan.selectionHash ? new api.Result_OwnerReindexed(new api.OwnerReindexResult(envelope.requestId, plan.targetProfile, plan.heads, plan.heads, 0n, 0n)) : new api.Result_Error(new api.Failure('conflict', 'Rebuild selection or fixed target changed; preview again.'));
      this.receipts.set(envelope.requestId, reply); if (!this.reindexDrop) send(reply); return true;
    }
    if (operation instanceof api.Operation_GetReindexStatus) {
      const accepted = this.receipts.get(operation.requestId);
      const result = accepted instanceof api.Result_OwnerReindexed ? this.statusTransform(new api.ReindexStatusResult(operation.requestId, accepted.result.targetProfile, accepted.result.heads, ...this.statusCounts)) : null;
      const reply = () => send(this.statusError !== null || result === null ? new api.Result_Error(new api.Failure(this.statusError ?? 'not-found', 'Rebuild status unavailable')) : new api.Result_ReindexStatus(result));
      if (this.holdStatus) this.statusReplies.push(reply); else reply(); return true;
    }
    return super.handle(operation, envelope, send, entry);
  }
}
const maintenance = page => region(page, 'Maintenance');
const retryTrigger = page => button(maintenance(page), 'Retry all current failed indexing jobs');
const rebuildTrigger = page => button(maintenance(page), 'Rebuild archive index');
const retryDialog = page => page.getByRole('dialog', { name: /^Retry ([\d,]+ )?failed indexing jobs\?$/ });
const rebuildDialog = page => page.getByRole('dialog', { name: 'Rebuild the archive index?', exact: true });
const confirmRetry = dialog => dialog.getByRole('button', { name: /^Retry ([\d,]+ )?jobs$/ });
const confirmRebuild = dialog => button(dialog, 'Rebuild index');
const uncertain = page => page.getByRole('region', { name: 'Uncertain mutation', exact: true });
const retryResult = page => page.getByRole('region', { name: 'Indexing retry result', exact: true });
const progress = page => page.getByRole('region', { name: 'Archive rebuild progress', exact: true });
const countOf = (scope, label) => scope.getByRole('row').filter({ has: scope.page().getByRole('rowheader', { name: label, exact: true }) }).locator('td');
const calls = (fixture, Type) => fixture.calls.filter(call => call.operation instanceof Type);
const POPULATIONS = [['Eligible current failed jobs', 'eligibleCurrentFailed'], ['Historical failed · superseded revision (excluded)', 'supersededRevisionFailed'], ['Historical failed · obsolete profile (excluded)', 'obsoleteProfileFailed'], ['Historical failed · superseded revision and profile (excluded)', 'supersededRevisionAndProfileFailed'], ['Current Queued (unchanged)', 'unchangedQueued'], ['Current Running (unchanged)', 'unchangedRunning'], ['Current Complete (unchanged)', 'unchangedComplete']];
async function previewRetry(page) { await retryTrigger(page).click(); const dialog = retryDialog(page); await dialog.getByRole('checkbox').waitFor(); return dialog; }
async function applyRetry(page) { const dialog = await previewRetry(page); await dialog.getByRole('checkbox').check(); await confirmRetry(dialog).click(); return dialog; }
async function previewRebuild(page) { await rebuildTrigger(page).click(); const dialog = rebuildDialog(page); await dialog.getByRole('checkbox').waitFor(); return dialog; }
async function applyRebuild(page) { const dialog = await previewRebuild(page); await dialog.getByRole('checkbox').check(); await confirmRebuild(dialog).click(); return dialog; }
async function maintenanceScene(options) { const result = await scene(rig, { route: '/activity/maintenance', ...options }); await maintenance(result.page).waitFor(); return result; }
async function rebuildScene(configure, viewport = DESKTOP, scheme = 'light') { return maintenanceScene({ fixture: new RebuildFixture(), configure, viewport, scheme }); }
/** A Running observation: the progress line of the captured cohort. */
const observed = (page, text) => progress(page).getByText(text, { exact: true });
const PENDING = '0 complete · 0 superseded · 0 failed · 3 pending';

try {
  // ── Retry failed indexing jobs ──────────────────────────────────────────
  await rig.run('the retry preview is owner-wide despite list filters, states every population with all i64 digits, and Cancel sends nothing', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: largeFixture });
    await idle(page, 'jobs'); await button(region(page, 'Jobs'), 'History').click(); fixture.jobExpressions.set('tag:"does-not-exist"', []); await filter(page, 'jobs', 'tag:"does-not-exist"');
    await region(page, 'Jobs').getByRole('heading', { name: 'No matching historical jobs', exact: true }).waitFor();
    await open(page, 'Maintenance'); const dialog = await previewRetry(page), counts = fixture.retryPlan().counts;
    for (const [label, field] of POPULATIONS) assert.equal(await countOf(dialog, label).innerText(), counts[field].toString());
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false); assert.equal(await confirmRetry(dialog).isDisabled(), true);
    assert.equal(await button(dialog, 'Cancel').evaluate(element => element === document.activeElement), true, 'Cancel is focused by default');
    await button(dialog, 'Cancel').click(); await dialog.waitFor({ state: 'detached' });
    assert.equal(await retryTrigger(page).evaluate(element => element === document.activeElement), true, 'focus returns to the trigger');
    assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 0); assert.equal(fixture.receipts.size, 0); assert.equal(fixture.bulkApplyExecutions, 0);
    await context.close();
    const huge = 9007199254740993n, formatted = await maintenanceScene({ configure: fixture => { fixture.retryCountsOverride = new api.RetryFailedCounts(huge, huge + 1n, huge + 2n, huge + 3n, huge + 4n, huge + 5n, huge + 6n); } });
    const exact = await previewRetry(formatted.page);
    assert.deepEqual(await exact.locator('tbody td').allTextContents(), Array.from({ length: 7 }, (_, index) => (huge + BigInt(index)).toString()));
    await button(exact, 'Cancel').click(); assert.equal(formatted.fixture.bulkApplyExecutions, 0); await formatted.context.close();
  });

  await rig.run('with zero current failures the retry is disabled with its reason and 58 historical failures stay excluded', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { largeFixture(fixture); fixture.activityJobs = fixture.jobRows.filter(item => item.classification === api.ActivityJobClass.Current && item.job.state !== api.JobState.Failed).concat(fixture.jobRows.filter(item => item.classification !== api.ActivityJobClass.Current).slice(0, 58)); fixture.jobs = fixture.activityJobs.map(item => item.job); fixture.refreshActivityCounts(); } });
    const card = maintenance(page).locator('[data-maintenance="retry"]'); await card.getByText('0 eligible', { exact: true }).waitFor();
    assert.equal(await retryTrigger(page).isDisabled(), true); assert.match(await card.innerText(), /No current failed indexing jobs are eligible\..*Historical failures are excluded/s); assert.match(await card.innerText(), /58 historical failed/);
    assert.equal(calls(fixture, api.Operation_PreviewRetryFailed).length + calls(fixture, api.Operation_ApplyRetryFailed).length, 0);
    await context.close();
  });

  await rig.run('a confirmed retry applies once and reports pre-action counts while the live totals refresh', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: largeFixture });
    const before = new Map(fixture.jobRows.map(item => [item.job.id, JSON.stringify(item)])), eligible = new Set(fixture.jobRows.filter(item => item.retryable).map(item => item.job.id)), plan = fixture.retryPlan();
    await applyRetry(page); await retryResult(page).waitFor(); assert.match(await retryResult(page).innerText(), /not current live job totals/);
    assert.equal(await countOf(retryResult(page), 'Eligible current failed jobs').innerText(), plan.counts.eligibleCurrentFailed.toString());
    const requests = calls(fixture, api.Operation_ApplyRetryFailed); assert.equal(requests.length, 1); assert.equal(fixture.bulkApplyExecutions, 1);
    assert.deepEqual({ hash: requests[0].operation.selectionHash, profile: requests[0].operation.targetProfile, confirm: requests[0].operation.confirm }, { hash: plan.selectionHash, profile: plan.targetProfile, confirm: true });
    for (const item of fixture.jobRows) if (eligible.has(item.job.id)) assert.deepEqual({ state: item.job.state, attempts: item.job.attempts, error: item.job.error, done: item.job.completedWindows, total: item.job.totalWindows }, { state: api.JobState.Queued, attempts: 0, error: undefined, done: 0, total: undefined }); else assert.equal(JSON.stringify(item), before.get(item.job.id), 'historical and non-failed jobs are untouched');
    await maintenance(page).locator('[data-maintenance="retry"]').getByText('0 eligible', { exact: true }).waitFor();
    assert.equal(await countOf(retryResult(page), 'Eligible current failed jobs').innerText(), '41', 'receipt counts stay pre-action facts after the live count becomes zero');
    assert.equal(await retryTrigger(page).isDisabled(), true); await retryDialog(page).waitFor({ state: 'detached' });
    await context.close();
  });

  await rig.run('a lost retry reply is uncertain only at the request deadline, survives theme changes and is reconciled by its receipt without replay', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { fixture.bulkDropReply = true; } });
    await applyRetry(page); await fixture.waitUntil(() => calls(fixture, api.Operation_ApplyRetryFailed).length === 1, 'retry apply was not sent');
    await advanceClock(page, connectionConfig.requestTimeout - 1); assert.equal(await uncertain(page).count(), 0, 'a lost reply is not uncertain before the request deadline');
    await advanceClock(page, 1); await uncertain(page).waitFor(); await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="live"]').count() > 0, retryBudgetMillis(connectionConfig), 'no reconnect');
    assert.equal(await retryDialog(page).count(), 0, 'the reconnect closed the preview; nothing is resubmitted');
    const notice = await uncertain(page).innerText();
    for (const choice of ['Dark', 'Light']) { await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await page.getByRole('menuitemradio', { name: choice, exact: true }).click(); await page.waitForFunction(value => document.documentElement.dataset.themeChoice === value, choice.toLowerCase()); }
    assert.equal(await uncertain(page).innerText(), notice, 'a theme change does not clear the uncertainty'); assert.equal(await retryTrigger(page).isDisabled(), true, 'new writes stay blocked');
    assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 1); assert.equal(fixture.bulkApplyExecutions, 1);
    await button(uncertain(page), 'Look up receipt').click(); await retryResult(page).waitFor();
    assert.match(await retryResult(page).innerText(), /Server retried 1 indexing jobs to Queued/); assert.equal(await uncertain(page).count(), 0);
    const apply = calls(fixture, api.Operation_ApplyRetryFailed)[0], receipt = calls(fixture, api.Operation_Receipt)[0];
    assert.equal(receipt.operation.mutationId, apply.requestId); assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 1); assert.equal(fixture.bulkApplyExecutions, 1);
    await context.close();
  });

  await rig.run('a confirmed-absent retry conflict keeps the uncertainty until a durable receipt proves it terminal', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { fixture.bulkDropBeforeCommit = true; } });
    await applyRetry(page); await fixture.waitUntil(() => calls(fixture, api.Operation_ApplyRetryFailed).length === 1, 'retry apply was not sent');
    await advanceClock(page, connectionConfig.requestTimeout); await uncertain(page).waitFor(); await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="live"]').count() > 0, retryBudgetMillis(connectionConfig), 'no reconnect');
    await retryDialog(page).waitFor({ state: 'detached' });
    await button(uncertain(page), 'Look up receipt').click(); await button(uncertain(page), 'Retry confirmed-absent request').waitFor();
    fixture.bulkDropBeforeCommit = false; fixture.jobFences.set(fixture.jobs[0].id, 42);
    await button(uncertain(page), 'Retry confirmed-absent request').click();
    await page.getByRole('alert').filter({ hasText: /Retry selection changed/i }).waitFor();
    assert.equal(await button(uncertain(page), 'Retry confirmed-absent request').count(), 1, 'one conflict reply cannot prove every delivered same-ID copy is terminal');
    const applies = calls(fixture, api.Operation_ApplyRetryFailed); assert.equal(applies.length, 2); assert.equal(applies[0].requestId, applies[1].requestId); assert.equal(applies[0].operation.selectionHash, applies[1].operation.selectionHash);
    assert.equal(calls(fixture, api.Operation_PreviewRetryFailed).length, 1, 'a recovery conflict requires an explicit new preview'); assert.equal(await retryTrigger(page).isDisabled(), true);
    await button(uncertain(page), 'Look up receipt').click(); await fixture.waitUntil(() => calls(fixture, api.Operation_Receipt).length === 2, 'terminal conflict receipt was not queried');
    await uncertain(page).waitFor({ state: 'detached' }); assert.equal(await retryTrigger(page).isEnabled(), true);
    assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 2); assert.equal(calls(fixture, api.Operation_PreviewRetryFailed).length, 1);
    await context.close();
  });

  await rig.run('a direct retry conflict reads a new plan and needs a renewed explicit confirmation', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { largeFixture(fixture); fixture.bulkConflictOnce = true; } });
    const dialog = await applyRetry(page);
    await fixture.waitUntil(() => calls(fixture, api.Operation_PreviewRetryFailed).length === 2, 'conflict did not request a fresh read-only plan');
    await dialog.getByText('The selection or target profile changed. Review a fresh preview and confirm again; the previous selection has not been resubmitted.', { exact: true }).waitFor();
    await dialog.getByRole('checkbox').waitFor(); assert.equal(await dialog.getByRole('checkbox').isChecked(), false); assert.equal(await confirmRetry(dialog).isDisabled(), true);
    assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 1, 'a conflict never resubmits a stale payload');
    await dialog.getByRole('checkbox').check(); await confirmRetry(dialog).click(); await retryResult(page).waitFor();
    const requests = calls(fixture, api.Operation_ApplyRetryFailed); assert.equal(requests.length, 2); assert.notEqual(requests[0].requestId, requests[1].requestId); assert.notEqual(requests[0].operation.selectionHash, requests[1].operation.selectionHash); assert.equal(fixture.bulkApplyExecutions, 1);
    await context.close();
  });

  await rig.run('Read denials of the retry preview or apply clear the confirmation without inventing authority or mutating', async () => {
    for (const stage of ['preview', 'apply']) {
      const { context, page, fixture } = await maintenanceScene({ configure: fixture => { fixture.bulkPreviewDenied = stage === 'preview'; fixture.bulkApplyDenied = stage === 'apply'; } });
      await retryTrigger(page).click(); const dialog = retryDialog(page);
      if (stage === 'apply') { await dialog.getByRole('checkbox').check(); await confirmRetry(dialog).click(); }
      await page.getByRole('alert').filter({ hasText: 'Browser Read scope required' }).first().waitFor();
      assert.equal(await dialog.getByRole('checkbox').count(), 0); assert.equal(fixture.bulkApplyExecutions, 0); assert.equal(fixture.receipts.size, 0);
      assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, stage === 'apply' ? 1 : 0);
      await context.close();
    }
  });

  await rig.run('an open retry preview keeps its confirmation through a device theme change and sends nothing', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: largeFixture });
    const dialog = await previewRetry(page); await dialog.getByRole('checkbox').check();
    const node = await dialog.elementHandle(), counts = await dialog.locator('table').innerText(), sent = fixture.calls.length;
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await quiesce(page);
    assert.equal(await dialog.getByRole('checkbox').isChecked(), true); assert.equal(await node.evaluate(element => element.isConnected && element.open), true);
    assert.equal(await dialog.locator('table').innerText(), counts); assert.equal(await confirmRetry(dialog).isEnabled(), true);
    assert.equal(fixture.calls.length, sent, 'a theme change queues no application or mutation request');
    await button(dialog, 'Cancel').click(); assert.equal(calls(fixture, api.Operation_ApplyRetryFailed).length, 0);
    await context.close();
  });

  await rig.run('the mutation hook keeps an unverified bulk reply uncertain with its original ID and blocks new writes until its receipt', async () => {
    for (const mismatch of [{ label: 'inner request ID', button: 'Return wrong inner request ID' }, { label: 'target profile', button: 'Return wrong target profile' }, { label: 'result type', button: 'Return wrong result type' }]) {
      const context = await rig.browser.newContext(), page = await context.newPage(); page.on('pageerror', error => rig.errors.push(error.message));
      const output = name => page.locator(`output[aria-label="${name}"]`);
      await page.goto(`${rig.origin}/tests-browser/mutations.html`); await button(page, 'Start apply').click();
      const first = page.getByRole('region', { name: 'Mutation request 0', exact: true }), id = await first.locator('output[aria-label="Request ID"]').textContent();
      await button(first, mismatch.button).click(); await output('Busy').filter({ hasText: /^false$/ }).waitFor();
      await button(page, 'Attempt another write').click();
      assert.deepEqual({ uncertain: await output('Uncertain request').textContent(), delivered: await output('Delivered requests').textContent() }, { uncertain: id, delivered: '1' }, `${mismatch.label}: a delivered but unverifiable reply is not proof of refusal`);
      assert.equal(await output('Uncertain owner').textContent(), 'alice'); assert.equal(await output('Typed result').textContent(), 'none');
      await button(page, 'Look up receipt').click(); const receipt = page.getByRole('region', { name: 'Mutation request 1', exact: true });
      assert.equal(await receipt.locator('output[aria-label="Operation"]').textContent(), 'receipt'); assert.equal(await receipt.locator('output[aria-label="Request ID"]').textContent(), id);
      await button(receipt, 'Return typed success').click(); await output('Uncertain request').filter({ hasText: /^none$/ }).waitFor();
      assert.equal(await output('Typed result').textContent(), `${id}:target-profile:1`); assert.equal(await output('Delivered requests').textContent(), '2', 'recovery is a receipt read, not an Apply replay');
      await context.close();
    }
  });

  await rig.run('the mutation hook drops typed bulk results across security and account changes and ignores late replies', async () => {
    const context = await rig.browser.newContext(), page = await context.newPage(); page.on('pageerror', error => rig.errors.push(error.message)); await page.goto(`${rig.origin}/tests-browser/mutations.html`);
    const typed = page.locator('output[aria-label="Typed result"]'), settled = () => page.locator('output[aria-label="Busy"]').filter({ hasText: /^false$/ }).waitFor();
    async function begin(index) { await button(page, 'Start apply').click(); const request = page.getByRole('region', { name: `Mutation request ${index}`, exact: true }); await request.waitFor(); return request; }
    await button(await begin(0), 'Return typed success').click(); await settled(); assert.notEqual(await typed.textContent(), 'none');
    await button(page, 'Invalidate').click(); assert.equal(await typed.textContent(), 'none');
    const invalidated = await begin(1); await button(page, 'Invalidate').click(); await button(invalidated, 'Return typed success').click(); await settled(); assert.equal(await typed.textContent(), 'none', 'a late previous-security-epoch apply cannot publish counts');
    const previousOwner = await begin(2); await button(page, 'Change account').click(); await button(previousOwner, 'Return typed success').click(); await settled(); assert.equal(await typed.textContent(), 'none', 'a previous-account apply cannot publish counts');
    await button(page, 'Sign in original').click(); const lost = await begin(3); await button(lost, 'Reject uncertain delivery').click(); await settled(); await button(page, 'Look up receipt').click();
    const receipt = page.getByRole('region', { name: 'Mutation request 4', exact: true }); await receipt.waitFor(); await button(page, 'Change account').click(); await button(receipt, 'Return typed success').click(); await settled();
    assert.equal(await typed.textContent(), 'none', 'a previous-account receipt cannot publish counts');
    await button(await begin(5), 'Return typed success').click(); await settled(); assert.notEqual(await typed.textContent(), 'none'); await button(page, 'Sign out').click(); assert.equal(await typed.textContent(), 'none');
    await context.close();
  });

  // ── Rebuild archive index ───────────────────────────────────────────────
  await rig.run('the rebuild preview selects every HEAD for the current pipeline regardless of list filters and keeps the previous publication', async () => {
    const { context, page, fixture } = await scene(rig, { route: '/activity/jobs', configure: fixture => { fixture.archiveRowCount = 1005; } });
    const publication = fixture.view; await idle(page, 'jobs'); await button(region(page, 'Jobs'), 'History').click(); fixture.jobExpressions.set('collector:"not-present"', []); await filter(page, 'jobs', 'collector:"not-present"');
    await region(page, 'Jobs').locator('[data-list-state="empty"]').waitFor(); await open(page, 'Maintenance');
    const dialog = await previewRebuild(page);
    assert.match(await dialog.innerText(), /Conversations\s+1005 archive HEADs/); assert.match(await dialog.innerText(), /Replacement jobs\s+1005/); assert.match(await dialog.innerText(), /Current pipeline target/);
    assert.doesNotMatch(await dialog.innerText(), /New target|changing my target|Already current/); assert.equal(await dialog.locator('select').count(), 0, 'no profile transition is offered');
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false); assert.equal(await confirmRebuild(dialog).isDisabled(), true); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 0);
    await dialog.getByRole('checkbox').check(); await confirmRebuild(dialog).click(); await progress(page).waitFor();
    const applies = calls(fixture, api.Operation_ApplyOwnerReindex); assert.equal(applies.length, 1); assert.equal(applies[0].operation.confirm, true);
    assert.deepEqual({ generation: fixture.view.generationId, revision: fixture.view.revision }, { generation: publication.generationId, revision: publication.revision }, 'the previous publication stays until replacement');
    await context.close();
  });

  await rig.run('an accepted rebuild starts a finite cohort observation, not completion, and returns focus to the re-enabled trigger', async () => {
    const { context, page, fixture } = await rebuildScene(() => {}, PHONE);
    await applyRebuild(page); await progress(page).waitFor(); await observed(page, PENDING).waitFor();
    await rebuildDialog(page).waitFor({ state: 'detached' }); await page.waitForFunction(() => document.activeElement !== null && document.activeElement.textContent === 'Rebuild archive index' && !document.activeElement.disabled);
    const id = calls(fixture, api.Operation_ApplyOwnerReindex)[0].requestId; assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
    assert.equal(calls(fixture, api.Operation_GetReindexStatus)[0].operation.requestId, id); assert.match(await progress(page).innerText(), /Accepted rebuild request/); assert.doesNotMatch(await progress(page).innerText(), /100%|All captured HEADs complete/);
    await open(page, 'Jobs'); await button(row(page, 'jobs', fixture.jobs[0].id), 'Details').click(); await button(detail(page, 'jobs', fixture.jobs[0].id), 'Retry indexing').click();
    await page.getByRole('region', { name: 'Notifications', exact: true }).getByText('Retry indexing job completed.', { exact: true }).waitFor(); assert.match(await progress(page).innerText(), new RegExp(id), 'another mutation does not replace the cohort');
    await context.close();
  });

  await rig.run('cohort status reads are sequential, survive a tab round trip, are scheduled after settlement and stop at a terminal count', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.holdStatus = true; });
    await applyRebuild(page); await fixture.waitCall(api.Operation_GetReindexStatus, 1); await advanceClock(page, REINDEX_STATUS_POLL_MS * 3);
    assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1, 'an unsettled read is never overlapped');
    await navLink(page, 'Archive').click(); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor(); await navLink(page, 'Activity').click(); await maintenance(page).waitFor();
    assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1);
    fixture.holdStatus = false; fixture.statusReplies.shift()(); await observed(page, PENDING).waitFor();
    fixture.statusCounts = [3n, 0n, 0n, 0n]; await advanceClock(page, REINDEX_STATUS_POLL_MS - 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1);
    await advanceClock(page, 1); await observed(page, 'All captured HEADs complete.').waitFor();
    await advanceClock(page, REINDEX_STATUS_POLL_MS * 5); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 2, 'a terminal count stops observation'); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
    await context.close();
  });

  await rig.run('failed, superseded and empty cohorts settle without claiming 100% completion', async () => {
    for (const [name, counts, text] of [['all failed', [0n, 0n, 3n, 0n], 'Cohort settled with failures or superseded HEADs.'], ['superseded', [0n, 3n, 0n, 0n], 'Cohort settled with failures or superseded HEADs.'], ['empty', [0n, 0n, 0n, 0n], 'No eligible HEADs were captured.']]) {
      const { context, page, fixture } = await rebuildScene(fixture => { fixture.statusCounts = counts; if (name === 'empty') { fixture.archiveRows = []; fixture.reindexPlan = () => new api.OwnerReindexPlan(fixture.targetProfile, fixture.targetProfile, 'a'.repeat(64), 0n, 0n, 0n); } });
      await applyRebuild(page); await observed(page, text).waitFor(); assert.doesNotMatch(await progress(page).innerText(), /100%|All captured HEADs complete/, name);
      await advanceClock(page, REINDEX_STATUS_POLL_MS * 2); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1, `${name}: a settled cohort is not read again`);
      await context.close();
    }
  });

  await rig.run('an invalid cohort status stops observation until an explicit read-only check', async () => {
    for (const malformed of ['request', 'target', 'total', 'partition', 'negative']) {
      const { context, page, fixture } = await rebuildScene(fixture => { fixture.statusTransform = result => malformed === 'request' ? result.with({ requestId: 'wrong' }) : malformed === 'target' ? result.with({ targetProfile: 'wrong' }) : malformed === 'total' ? result.with({ total: 4n, pending: 4n }) : malformed === 'partition' ? result.with({ pending: 2n }) : result.with({ failed: -1n, pending: 4n }); });
      await applyRebuild(page); await progress(page).getByRole('alert').waitFor(); await advanceClock(page, REINDEX_STATUS_POLL_MS * 3);
      assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1, `${malformed}: observation stopped`);
      fixture.statusTransform = result => result; await button(progress(page), 'Check rebuild status').click(); await observed(page, PENDING).waitFor();
      assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 2);
      await context.close();
    }
  });

  await rig.run('an uncertain Apply is never polled or repeated, and its receipt starts the observation of its own request', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.reindexDrop = true; });
    await applyRebuild(page); await fixture.waitCall(api.Operation_ApplyOwnerReindex, 1); await advanceClock(page, connectionConfig.requestTimeout + 100);
    await uncertain(page).waitFor(); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 0); await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="live"]').count() > 0, retryBudgetMillis(connectionConfig), 'no reconnect');
    await rebuildDialog(page).waitFor({ state: 'detached' });
    const id = calls(fixture, api.Operation_ApplyOwnerReindex)[0].requestId; fixture.statusError = 'not-found';
    await button(uncertain(page), 'Look up receipt').click(); await progress(page).getByRole('alert').waitFor(); await advanceClock(page, REINDEX_STATUS_POLL_MS * 3);
    assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus)[0].operation.requestId, id);
    await context.close();
  });

  await rig.run('a double confirmation click sends one Apply and an uncertain identity is never polled', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.reindexDrop = true; });
    const dialog = await previewRebuild(page); await dialog.getByRole('checkbox').check(); await confirmRebuild(dialog).evaluate(element => { element.click(); element.click(); });
    await fixture.waitCall(api.Operation_ApplyOwnerReindex, 1); await advanceClock(page, 1000);
    assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 0);
    await context.close();
  });

  await rig.run('a status authority denial clears the private cohort without a later automatic restoration', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.statusError = 'forbidden'; });
    await applyRebuild(page); await fixture.waitCall(api.Operation_GetReindexStatus, 1); await progress(page).waitFor({ state: 'detached' });
    const id = calls(fixture, api.Operation_ApplyOwnerReindex)[0].requestId; assert.equal(await page.getByText(id, { exact: true }).count(), 0);
    await advanceClock(page, REINDEX_STATUS_POLL_MS * 2); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
    await context.close();
  });

  await rig.run('a new rebuild cannot overlap an unsettled earlier status read or queue a hidden one', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.holdStatus = true; });
    await applyRebuild(page); await fixture.waitCall(api.Operation_GetReindexStatus, 1); const firstId = calls(fixture, api.Operation_ApplyOwnerReindex)[0].requestId;
    await rebuildDialog(page).waitFor({ state: 'detached' }); await applyRebuild(page); await fixture.waitCall(api.Operation_ApplyOwnerReindex, 2);
    const secondId = calls(fixture, api.Operation_ApplyOwnerReindex)[1].requestId; assert.notEqual(secondId, firstId);
    await progress(page).getByRole('alert').filter({ hasText: 'prior status read' }).waitFor(); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1);
    fixture.statusReplies.shift()(); await advanceClock(page, REINDEX_STATUS_POLL_MS * 2); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1);
    assert.match(await progress(page).innerText(), new RegExp(secondId)); assert.doesNotMatch(await progress(page).innerText(), new RegExp(firstId));
    await button(progress(page), 'Check rebuild status').click(); await fixture.waitCall(api.Operation_GetReindexStatus, 2);
    assert.equal(calls(fixture, api.Operation_GetReindexStatus)[1].operation.requestId, secondId); fixture.statusReplies.shift()(); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 2);
    await context.close();
  });

  await rig.run('losing authority erases the cohort before a late status of the old owner can return', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.holdStatus = true; });
    await applyRebuild(page); await fixture.waitCall(api.Operation_GetReindexStatus, 1); const id = calls(fixture, api.Operation_ApplyOwnerReindex)[0].requestId;
    fixture.mode = 'unauthorized'; fixture.restart();
    await advanceClockUntil(page, async () => await page.getByRole('heading', { name: /^Sign in/ }).count() > 0, retryBudgetMillis(connectionConfig), 'the sign-in page was not shown');
    assert.equal(await progress(page).count(), 0); fixture.statusReplies.shift()();
    fixture.mode = 'normal'; await signIn(page, 'bob'); await navLink(page, 'Archive').click(); await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
    assert.equal(await page.getByText(id, { exact: true }).count(), 0); await advanceClock(page, REINDEX_STATUS_POLL_MS * 2);
    assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
    await context.close();
  });

  await rig.run('a captured cohort stays complete after later HEADs and another job mutation', async () => {
    const { context, page, fixture } = await rebuildScene(fixture => { fixture.statusCounts = [3n, 0n, 0n, 0n]; });
    await applyRebuild(page); await observed(page, 'All captured HEADs complete.').waitFor();
    fixture.archiveRowCount = 9; await open(page, 'Jobs'); await button(row(page, 'jobs', fixture.jobs[0].id), 'Details').click(); await button(detail(page, 'jobs', fixture.jobs[0].id), 'Retry indexing').click();
    await advanceClock(page, REINDEX_STATUS_POLL_MS * 2); await observed(page, '3 complete · 0 superseded · 0 failed · 0 pending').waitFor();
    assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 1); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
    await context.close();
  });

  await rig.run('a changed selection or target needs a fresh unchecked confirmation without an automatic Apply retry', async () => {
    for (const change of ['target', 'selection']) {
      const { context, page, fixture } = await (change === 'target' ? rebuildScene(() => {}) : maintenanceScene({}));
      const dialog = await previewRebuild(page); await dialog.getByRole('checkbox').check();
      if (change === 'target') fixture.targetProfile = 'changed-current-profile'; else fixture.reindexConflict = true;
      await confirmRebuild(dialog).click(); await dialog.getByRole('alert').waitFor();
      assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1); assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 0); assert.equal(calls(fixture, api.Operation_PreviewOwnerReindex).length, 1);
      await button(dialog, 'Request fresh archive rebuild preview').click(); await dialog.getByRole('checkbox').waitFor();
      assert.equal(await dialog.getByRole('checkbox').isChecked(), false); assert.equal(await confirmRebuild(dialog).isDisabled(), true);
      if (change === 'target') assert.match(await dialog.innerText(), /changed-current-profile/);
      assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1, `${change}: no automatic Apply retry`);
      await context.close();
    }
  });

  await rig.run('a malformed Apply response stays uncertain and never claims that nothing was submitted', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { fixture.reindexMalformed = true; } });
    await applyRebuild(page); await uncertain(page).waitFor();
    assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1); assert.equal(await page.getByText('No new apply was submitted.', { exact: false }).count(), 0);
    await context.close();
  });

  await rig.run('an unknown rebuild delivery keeps its original payload until an explicit stored conflict receipt', async () => {
    const { context, page, fixture } = await maintenanceScene({ configure: fixture => { fixture.reindexDrop = true; } });
    await applyRebuild(page); await fixture.waitCall(api.Operation_ApplyOwnerReindex, 1);
    const original = calls(fixture, api.Operation_ApplyOwnerReindex)[0]; fixture.receipts.delete(original.requestId); fixture.restart();
    await advanceClockUntil(page, async () => await uncertain(page).count() > 0, retryBudgetMillis(connectionConfig), 'the delivery was not uncertain');
    await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="live"]').count() > 0, retryBudgetMillis(connectionConfig), 'no reconnect');
    await rebuildDialog(page).waitFor({ state: 'detached' });
    await button(uncertain(page), 'Look up receipt').click(); await button(uncertain(page), 'Retry confirmed-absent request').waitFor();
    fixture.reindexDrop = false; fixture.reindexConflict = true; await button(uncertain(page), 'Retry confirmed-absent request').click(); await fixture.waitCall(api.Operation_ApplyOwnerReindex, 2);
    assert.equal(await uncertain(page).count(), 1, 'a direct conflict is not final');
    const retry = calls(fixture, api.Operation_ApplyOwnerReindex)[1]; assert.equal(retry.requestId, original.requestId); assert.equal(retry.operation.selectionHash, original.operation.selectionHash);
    await button(uncertain(page), 'Look up receipt').click(); await page.getByText(/confirms that this archive rebuild was rejected/).waitFor();
    assert.equal(await uncertain(page).count(), 0); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 2);
    await context.close();
  });

  await rig.run('a partial rebuild result, direct or through a correlated receipt, stays uncertain instead of accepting an unqueued HEAD', async () => {
    for (const recover of [false, true]) {
      let applySignals = 0;
      const { context, page, fixture } = await maintenanceScene({ configure: fixture => {
        fixture.targetProfile = 'current-profile'; const job = fixture.jobs[0].with({ state: api.JobState.Running, error: undefined }); fixture.jobs = [job]; fixture.activityJobs = [new api.ActivityJob(job, fixture.targetProfile, api.ActivityJobClass.Current, '2030-01-01T00:00:00Z', true, false, fixture.source.collectorNamespace, fixture.jobSession(job), NOW)];
        fixture.signals.on('request', operation => { if (operation instanceof api.Operation_ApplyOwnerReindex) applySignals++; });
        const original = fixture.goal50Operation; fixture.goal50Operation = (operation, envelope, send, entry) => {
          if (!(operation instanceof api.Operation_ApplyOwnerReindex)) return original(operation, envelope, send, entry);
          fixture.signals.emit('request', operation);
          const result = new api.Result_OwnerReindexed(new api.OwnerReindexResult(envelope.requestId, operation.targetProfile, 1n, 0n, 0n, 0n)); fixture.receipts.set(envelope.requestId, result); if (!recover) send(result); return true;
        };
      } });
      const arrived = fixture.waitCall(api.Operation_ApplyOwnerReindex, 1); await applyRebuild(page); await arrived; const apply = calls(fixture, api.Operation_ApplyOwnerReindex)[0];
      if (recover) {
        fixture.restart(); await advanceClockUntil(page, async () => await uncertain(page).count() > 0, retryBudgetMillis(connectionConfig), 'the delivery was not uncertain');
        await advanceClockUntil(page, async () => await page.locator('.connection-widget[data-state="live"]').count() > 0, retryBudgetMillis(connectionConfig), 'no reconnect');
        await button(uncertain(page), 'Look up receipt').click(); await fixture.waitCall(api.Operation_Receipt, 1);
        const receipt = calls(fixture, api.Operation_Receipt)[0]; assert.equal(receipt.operation.mutationId, apply.requestId); assert.notEqual(receipt.requestId, apply.requestId);
      }
      await uncertain(page).waitFor(); assert.equal(await progress(page).count(), 0); assert.equal(await uncertain(page).count(), 1);
      assert.equal(calls(fixture, api.Operation_GetReindexStatus).length, 0); assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 1);
      assert.deepEqual({ state: fixture.activityJobs[0].job.state, lease: fixture.activityJobs[0].leaseActive }, { state: api.JobState.Running, lease: true }); assert.equal(applySignals, 1, 'the intercepted Apply wakes the request observer once');
      await context.close();
    }
  });

  await rig.run('the rebuild dialog opens from the keyboard with Cancel focused, fits the phone viewport, and Escape returns focus to the trigger', async () => {
    const { context, page, fixture } = await rebuildScene(() => {}, PHONE, 'dark');
    await rebuildTrigger(page).focus(); await page.keyboard.press('Enter'); const dialog = rebuildDialog(page); await dialog.getByRole('checkbox').waitFor();
    assert.equal(await button(dialog, 'Cancel').evaluate(element => element === document.activeElement), true);
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= PHONE.width, `dialog inside the viewport: ${JSON.stringify(box)}`);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await rebuildTrigger(page).evaluate(element => element === document.activeElement), true);
    assert.equal(calls(fixture, api.Operation_ApplyOwnerReindex).length, 0);
    await context.close();
  });

  rig.finish();
} finally { await rig.close(); }
