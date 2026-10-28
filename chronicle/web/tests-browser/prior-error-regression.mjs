// Behavioral-Active Blackbox / Good Communication; regression: retained errors are provenance, not current failure.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const page = await context.newPage(), fixture = new Goal50Fixture();
    fixture.jobs = [api.JobState.Queued, api.JobState.Running, api.JobState.Complete, api.JobState.Failed].map((state, index) => fixture.jobs[0].with({ id: `00000000-0000-4000-8000-${String(91000 + index).padStart(12, '0')}`, state, error: `retained-${state}` }));
    await fixture.install(page);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`);
    await page.locator('.archive-row').first().waitFor();
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    for (const job of fixture.jobs) {
      const row = page.locator(`.activity-job-row[data-scroll-anchor="${job.id}"]`);
      await row.getByText('Details', { exact: true }).click();
      const panel = row.locator('.activity-detail-panel');
      const error = panel.getByText(new RegExp(`retained-${job.state}$`));
      await error.waitFor();
      const presentation = await error.evaluate(element => ({ text: element.textContent, color: getComputedStyle(element).color, failure: getComputedStyle(document.querySelector('.state-failed')).color }));
      try {
        assert.equal(presentation.text, `${job.state === api.JobState.Failed ? 'Job error' : 'Prior-attempt error'}: retained-${job.state}`);
        if (job.state !== api.JobState.Failed) assert.notEqual(presentation.color, presentation.failure, 'Prior-attempt error must not use failure color');
        else assert.equal(presentation.color, presentation.failure, 'Failed keeps current-failure styling');
        console.log(`PASS ${theme} ${job.state}: retained error presentation`);
      } catch (error) { failures.push(`${theme} ${job.state}: ${error.message}`); console.log(`FAIL ${failures.at(-1)}`); }
      await row.getByText('Details', { exact: true }).click();
    }
    await context.close();
  }
} finally { await browser.close(); await server.close(); }
assert.deepEqual(failures, []);
