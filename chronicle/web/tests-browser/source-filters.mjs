// Behavioral-Active Blackbox / Good Communication. Verifies request expressions
// and recorded provenance only; this fixture does not claim to implement SQL filters.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen(); const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new Goal50Fixture(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  fixture.archiveRows = [fixture.archiveAt(0), fixture.archiveAt(1)].map((row, index) => row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title: index === 0 ? 'Subagent title without recorded ID' : 'Main title with recorded subagent', producer: 'synthetic-harness', model: 'recorded-source-model' }), source: row.head.source.with({ subagentId: index === 0 ? undefined : 'recorded-child', discoveryRootId: index === 0 ? 'yolo:Named_1.2' : 'native' }) }) }));
  fixture.activityJobs = fixture.jobRows.map(item => item.with({ session: item.session.with({ source: item.session.source.with({ discoveryRootId: 'yolo:JobRevision' }) }) }));
  await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.locator('.archive-row').first().waitFor();
  const search = page.getByRole('combobox', { name: 'Search conversations', exact: true });
  await page.getByRole('button', { name: 'Main agents', exact: true }).click(); assert.equal(await search.inputValue(), 'agent:"main"'); await search.press('Enter');
  await page.waitForFunction(() => document.querySelector('.archive-context [role=status]').textContent.includes('shown'));
  assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).at(-1).operation.query.expression, 'agent:"main"');
  await search.fill('project:"x" OR tag:"y"'); await page.getByRole('button', { name: 'Subagents', exact: true }).click(); const archiveExpression = '(project:"x" OR tag:"y") AND agent:"subagent"'; assert.equal(await search.inputValue(), archiveExpression); await search.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.archive-table').getAttribute('aria-busy') || document.querySelector('.archive-table').getAttribute('aria-busy') === 'false');
  assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).at(-1).operation.query.expression, archiveExpression);
  assert.equal(await page.getByRole('button', { name: 'Add Recorded yolo profile filter', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Search syntax', exact: true }).click(); assert.match(await page.locator('.expression-help-content').textContent(), /recorded subagent ID/); assert.match(await page.locator('.expression-help-content').textContent(), /yolo-profile:.*case-sensitive.*recorded claim/s); await search.fill(''); await search.press('Enter');
  for (const [title, expected] of [['Subagent title without recorded ID', 'Main · no recorded subagent ID'], ['Main title with recorded subagent', 'Subagent · recorded-child']]) {
    await page.getByRole('button', { name: title, exact: true }).click(); await page.getByText('Provenance & metadata', { exact: true }).click();
    assert.equal(await page.locator('.provenance-details .recorded-agent').textContent(), expected); assert.equal(await page.locator('.provenance-details dt').filter({ hasText: /^Recorded yolo profile$/ }).locator('xpath=following-sibling::dd[1]').textContent(), title.startsWith('Subagent') ? 'Named_1.2' : 'not recorded'); assert.match(await page.locator('.provenance-details').textContent(), /Producer.*synthetic-harness.*Source format.*Pi.*Recorded source model.*recorded-source-model/s); await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
  }
  await page.getByRole('button', { name: 'activity', exact: true }).click(); const editor = page.getByRole('region', { name: 'Indexing job metadata search', exact: true }), input = editor.getByRole('combobox');
  const jobExpression = '(producer:"synthetic-harness" OR format:"pi") AND agent:"subagent"'; fixture.jobExpressions.set(jobExpression, fixture.jobs.map(job => job.id));
  await input.fill('producer:"synthetic-harness" OR format:"pi"'); await editor.getByRole('button', { name: 'Subagents', exact: true }).click(); assert.equal(await input.inputValue(), jobExpression); await editor.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.activity-job-table').getAttribute('aria-busy') === 'false'); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).at(-1).operation.query.expression, jobExpression);
  assert.equal(await editor.getByRole('button', { name: 'Add Agent filter', exact: true }).count(), 1);
  assert.equal(await editor.getByRole('button', { name: 'Add Recorded yolo profile filter', exact: true }).count(), 1);
  const profileExpression = 'yolo-profile:JobRevision'; fixture.jobExpressions.set(profileExpression, fixture.jobs.map(job => job.id)); await input.fill(profileExpression); await editor.getByRole('button', { name: 'Filter', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.activity-job-table').getAttribute('aria-busy') === 'false');
  assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ActivityJobs).at(-1).operation.query.expression, profileExpression);
  await page.locator('.activity-job-row').first().getByRole('button', { name: 'Details', exact: true }).click(); assert.match(await page.locator('.activity-job-row').first().locator('.activity-detail-panel').textContent(), /Recorded yolo profileJobRevision/);
  assert.deepEqual(errors, []); await context.close(); console.log('PASS source filters: agent/profile expressions and recorded identity claims, never title heuristics');
} finally { await browser.close(); await server.close(); }
