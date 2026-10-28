// Behavioral-Active Blackbox / Good Communication; specified: rolling eviction
// can leave an old last-known sample while requests are currently in flight.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen(); const browser = await chromium.launch({ headless: true });
const output = fileURLToPath(new URL('../test-results/usage-presentation/', import.meta.url)); await mkdir(output, { recursive: true });
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new Goal50Fixture(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = fixture.usage(), empty = new api.TokenRateWindow(0n, 0n, 0n, undefined, 51586n), unknown = new api.TokenRateWindow(0n, 0n, 1n, undefined, undefined), zero = new api.TokenRateWindow(0n, 1n, 0n, 0, 0n);
    fixture.usage = () => base.with({ samples: base.samples.map(sample => sample.purpose === api.ModelPurpose.Annotation ? sample.with({ inFlight: 2, finishedCalls: 0n, failedCalls: 0n, cancelledCalls: 0n, invalidUsageCalls: 0n, input: empty, output: empty, reasoningSubset: empty }) : sample.purpose === api.ModelPurpose.DocumentEmbedding ? sample.with({ inFlight: 0, finishedCalls: 1n, failedCalls: 0n, cancelledCalls: 0n, invalidUsageCalls: 0n, input: unknown }) : sample.purpose === api.ModelPurpose.QueryEmbedding ? sample.with({ inFlight: 0, finishedCalls: 1n, failedCalls: 0n, cancelledCalls: 0n, invalidUsageCalls: 0n, input: zero }) : sample.with({ inFlight: 0, finishedCalls: 3n, failedCalls: 1n, cancelledCalls: 1n, invalidUsageCalls: 1n, input: zero, output: zero, reasoningSubset: zero })) });
    await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.locator('.archive-row').first().waitFor(); await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.getByText('Model usage and indexing settings', { exact: true }).click();
    const table = page.getByRole('table', { name: 'Completed model call usage', exact: true }); await table.waitFor();
    const annotation = table.locator('tbody tr').filter({ hasText: 'Annotation' }), input = annotation.locator('td').nth(1);
    // Fail first against the previous presentation: zero reports is not Unknown throughput.
    assert.equal(await input.locator('strong').textContent(), 'No reports in this window');
    assert.equal(await annotation.locator('td').first().textContent(), '2');
    assert.equal(await annotation.locator('td').last().textContent(), '0 / 0 / 0 / 0');
    assert.match(await input.textContent(), /Last reported sample age 51586 ms/);
    assert.equal(await table.getByRole('columnheader', { name: 'In flight now', exact: true }).count(), 1);
    assert.equal(await table.locator('tbody tr').filter({ hasText: 'DocumentEmbedding' }).locator('td').nth(1).locator('strong').textContent(), 'Unknown');
    assert.equal(await table.locator('tbody tr').filter({ hasText: 'QueryEmbedding' }).locator('td').nth(1).locator('strong').textContent(), '0 TPS');
    assert.equal(await table.locator('tbody tr').filter({ hasText: 'DocumentEmbedding' }).locator('td').nth(2).textContent(), 'N/A');
    const explanation = await page.locator('.model-usage').textContent();
    assert.match(explanation, /Finished includes failed and cancelled/); assert.match(explanation, /malformed provider-reported usage, not annotation validation/); assert.match(explanation, /sample age may exceed the window/);
    assert.deepEqual(errors, []); await page.locator('.model-usage').screenshot({ path: `${output}/${theme}.png` }); await context.close(); console.log(`PASS usage presentation ${theme}: instantaneous, empty rolling window, old sample, unknown, known zero, N/A`);
  }
} finally { await browser.close(); await server.close(); }
