import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const browser = await chromium.launch({ headless: true });
const errors = [];
const MIN_TEXT_CONTRAST_RATIO = 4.5;
async function textContrast(locator) {
  return locator.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    const rgba = value => { const parts = value.match(/[\d.]+/g).map(Number); return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]]; };
    const ancestors = []; for (let node = element; node !== null; node = node.parentElement) ancestors.push(node);
    let background = [255, 255, 255];
    for (const node of ancestors.reverse()) { const value = rgba(getComputedStyle(node).backgroundColor); background = background.map((channel, index) => value[index] * value[3] + channel * (1 - value[3])); }
    const color = rgba(getComputedStyle(element).color), foreground = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
    const luminance = channels => channels.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const front = luminance(foreground), back = luminance(background);
    return { color: getComputedStyle(element).color, background, ratio: (Math.max(front, back) + .05) / (Math.min(front, back) + .05) };
  });
}
async function scene(configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new ChronicleFixture();
  page.on('pageerror', error => errors.push(error.message));
  if (configure) configure(fixture);
  await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/harness.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-row').first().waitFor();
  return { context, page, fixture };
}
async function until(predicate, message) { for (let index = 0; index < 100; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(message); }
async function appendUntil(page, scroller, selector, total) {
  for (let index = 0; index < 20 && await page.locator(selector).count() < total; index++) {
    const before = await page.locator(selector).count(); await page.locator(scroller).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await until(async () => await page.locator(selector).count() > before, `Infinite list did not append beyond ${before}`);
  }
  assert.equal(await page.locator(selector).count(), total);
}
async function run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); console.log(`PASS browser UX: ${name}`); }
try {
  await run('owner collectors and Current/History jobs are infinite, lease-aware and prune successful scope changes', async () => {
    const currentFailedId = '00000000-0000-4000-8000-000000090001';
    const { context, page, fixture } = await scene(fixture => {
      const zero = new api.JobCounts(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);
      fixture.activityCollectors = Array.from({ length: 120 }, (_, index) => new api.ActivityCollector(`collector-${String(index).padStart(3, '0')}`, undefined, BigInt(index), 0n, zero, zero));
      const job = (id, revision, state, error) => new api.JobInfo(id, fixture.session.id, revision, state, 1, error, 0, undefined, undefined);
      const activity = (info, profile, classification, expires, active, retryable) => new api.ActivityJob(info, profile, classification, expires, active, retryable, fixture.source.collectorNamespace, fixture.jobSession(info), '2026-10-23T09:31:00Z');
      const failed = activity(job(currentFailedId, 2, api.JobState.Failed, 'Current failed work'), 'target-profile', api.ActivityJobClass.Current, undefined, false, true);
      const running = ['active', 'expired', 'unleased'].map((kind, index) => activity(job(`00000000-0000-4000-8000-${String(90002 + index).padStart(12, '0')}`, 2, api.JobState.Running, kind === 'active' ? 'Previous-attempt synthetic failure' : undefined).with({ attempts: kind === 'active' ? 4 : 1 }), 'target-profile', api.ActivityJobClass.Current, kind === 'unleased' ? undefined : kind === 'active' ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z', kind === 'active', false));
      const history = Array.from({ length: 58 }, (_, index) => activity(job(`00000000-0000-4000-8000-${String(91000 + index).padStart(12, '0')}`, index % 3 === 1 ? 2 : 1, api.JobState.Failed, `Historical failure ${index + 1}`), index % 3 === 0 ? 'target-profile' : 'obsolete-profile', index % 3 === 0 ? api.ActivityJobClass.SupersededRevision : index % 3 === 1 ? api.ActivityJobClass.ObsoleteProfile : api.ActivityJobClass.SupersededRevisionAndProfile, undefined, false, false));
      fixture.activityJobs = [failed, ...running, ...history];
    });
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    const totals = page.getByRole('table', { name: 'All your current and historical indexing jobs', exact: true });
    await totals.waitFor();
    assert.deepEqual(await totals.locator('tbody tr').first().locator('td').allTextContents(), ['4', '0', '3', '1', '0']);
    assert.deepEqual(await totals.locator('tbody tr').nth(1).locator('td').allTextContents(), ['58', '0', '0', '58', '0']);
    assert.match(await page.locator('.activity-overview').innerText(), /1 active · 1 expired · 1 unleased/);
    const runningRows = page.locator('.activity-job-row').filter({ has: page.locator('td[data-column="State"]').getByText('Running', { exact: true }) });
    for (const [index, label] of ['Active lease at snapshot', 'Expired lease at snapshot', 'Unleased · no lease expiry'].entries()) {
      const row = page.locator(`.activity-job-row[data-scroll-anchor="00000000-0000-4000-8000-${String(90002 + index).padStart(12, '0')}"]`);
      await row.getByRole('button', { name: 'Details', exact: true }).click();
      await row.getByText(label, { exact: index === 2 }).waitFor();
      await row.getByRole('button', { name: 'Details', exact: true }).click();
    }
    assert.equal(await runningRows.count(), 3);
    assert.equal(await page.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 1);
    const priorAttempt = page.locator('.activity-job-row').filter({ hasText: 'Previous-attempt synthetic failure' });
    await priorAttempt.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByText('Prior-attempt error: Previous-attempt synthetic failure', { exact: true }).waitFor();
    assert.equal(await page.getByText('Prior-attempt error: Previous-attempt synthetic failure', { exact: true }).count(), 1, 'Running retains prior failure provenance without claiming the current attempt has Failed');
    assert.equal(await priorAttempt.locator('td[data-column="Attempts"]').innerText(), '4');
    await priorAttempt.getByRole('button', { name: 'Details', exact: true }).click();
    const collector = page.locator('.activity-collector-row').first();
    await collector.getByRole('button', { name: 'Details', exact: true }).click();
    assert.match(await collector.innerText(), /No stored report · collection progress unknown/);
    await collector.getByRole('button', { name: 'Details', exact: true }).click();
    await appendUntil(page, '.activity-collector-scroll', '.activity-collector-row', 120);
    assert.ok(new Set(fixture.calls.filter(call => call.operation instanceof api.Operation_Activity && call.operation.query.cursor !== undefined && call.operation.query.limit === 50).map(call => call.operation.query.cursor)).size >= 2, '120 collectors require at least two distinct opaque continuation cursors');
    fixture.activityJobs = fixture.activityJobs.map(item => item.job.id === currentFailedId ? item.with({ classification: api.ActivityJobClass.SupersededRevision, retryable: false }) : item);
    await page.getByRole('button', { name: 'Refresh snapshots ↻', exact: true }).click();
    await page.locator(`.activity-job-row[data-scroll-anchor="${currentFailedId}"]`).waitFor({ state: 'detached' });
    await until(async () => await totals.locator('tbody tr').first().locator('td').first().innerText() === '3', 'Independent collector-summary chain did not finish refreshing');
    assert.deepEqual(await totals.locator('tbody tr').first().locator('td').allTextContents(), ['3', '0', '3', '0', '0']);
    assert.equal(await page.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 0, 'a job that became historical does not silently remain actionable in Current');
    await priorAttempt.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByText('Prior-attempt error: Previous-attempt synthetic failure', { exact: true }).waitFor();
    assert.equal(await page.getByText('Prior-attempt error: Previous-attempt synthetic failure', { exact: true }).count(), 1, 'zero current Failed jobs does not erase a Running job\'s prior-attempt error');
    await priorAttempt.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await appendUntil(page, '.activity-job-scroll', '.activity-job-row', 59);
    assert.equal(await page.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 0, 'historical failures are retained for accounting, never presented as retryable current work');
    assert.match(await page.getByRole('region', { name: 'Historical indexing jobs', exact: true }).innerText(), /Obsolete profile/); assert.match(await page.getByRole('region', { name: 'Historical indexing jobs', exact: true }).innerText(), /Both: superseded revision/);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_ActivityJobs && call.operation.query.scope === api.ActivityJobScope.Historical && call.operation.query.cursor !== undefined && call.operation.query.limit === 50));
    assert.equal(await page.getByRole('navigation', { name: /pages/i }).count(), 0);
    await context.close();
  });
  await run('Activity scope text contrast meets WCAG AA in selected/unselected normal and hover states', async () => {
    const { context, page } = await scene(); await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    const group = page.getByRole('group', { name: 'Indexing job scope', exact: true });
    for (const selected of ['Current', 'History']) {
      await group.getByRole('button', { name: selected, exact: true }).click();
      for (const label of ['Current', 'History']) {
        const button = group.getByRole('button', { name: label, exact: true });
        await page.mouse.move(0, 0); const normal = await textContrast(button); assert.ok(normal.ratio >= MIN_TEXT_CONTRAST_RATIO, `${selected} selected / ${label} normal contrast: ${JSON.stringify(normal)}`);
        await button.hover(); const hover = await textContrast(button); assert.ok(hover.ratio >= MIN_TEXT_CONTRAST_RATIO, `${selected} selected / ${label} hover contrast: ${JSON.stringify(hover)}`);
      }
    }
    await context.close();
  });
  await run('Activity first collector identity, phase/freshness and Current totals are visible at 1440x900', async () => {
    const { context, page } = await scene(fixture => {
      const report = new api.CollectorProgressUpdate(fixture.source.collectorNamespace, 1n, '00000000-0000-4000-8000-000000000090', api.CollectorPhase.Idle, '2026-10-26T11:00:00Z', new api.CollectorCounters(0,0,0,0,0,0,0,0,0,0,0,0,0n), 0n, 0n, undefined, undefined);
      fixture.collectors = [new api.CollectorStatus(report, '2026-10-26T11:59:00Z', false)];
    });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole('link', { name: 'Activity', exact: true }).click();
    const collector = page.locator('.activity-collector-row').first(); await collector.waitFor();
    for (const [label, locator] of [['collector ID', collector.locator('td[data-column="CollectorId"]')], ['phase', collector.locator('td[data-column="Phase"]')], ['freshness', collector.locator('td[data-column="Freshness"]')], ['Current total', collector.locator('td[data-column="CurrentTotal"]')], ['Current done', collector.locator('td[data-column="CurrentComplete"]')], ['Current failed', collector.locator('td[data-column="CurrentFailed"]')]]) {
      const visible = await locator.evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: innerHeight }; });
      assert.ok(visible.top >= 0 && visible.bottom <= visible.height, `${label} must be visible without scrolling: ${JSON.stringify(visible)}`);
    }
    await page.getByRole('button', { name: 'About these snapshots', exact: true }).click();
    assert.match(await page.locator('.activity-about-content').innerText(), /Browser connectivity is not collector or worker health/);
    assert.match(await page.locator('.activity-about-content').innerText(), /Connected pages refresh every 4 seconds/);
    await context.close();
  });
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
