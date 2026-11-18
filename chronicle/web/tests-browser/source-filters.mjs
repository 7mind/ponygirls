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
  fixture.archiveRows = [fixture.archiveAt(0), fixture.archiveAt(1)].map((row, index) => row.with({ head: row.head.with({ metadata: row.head.metadata.with({ title: index === 0 ? 'Subagent title without recorded ID' : 'Main title with recorded subagent', producer: 'synthetic-harness', model: 'recorded-source-model' }), source: row.head.source.with({ format: index === 0 ? api.SourceFormat.Historian : api.SourceFormat.Pi, subagentId: index === 0 ? undefined : 'recorded-child', discoveryRootId: index === 0 ? 'yolo:Named_1.2' : 'native' }) }) }));
  await fixture.install(page); await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();  await page.locator('.archive-row').first().waitFor();
  for (const [title, expected, format] of [['Subagent title without recorded ID', 'Main · no recorded subagent ID', 'Historian'], ['Main title with recorded subagent', 'Subagent · recorded-child', 'Pi']]) {
    await page.getByRole('link', { name: title, exact: true }).click(); await page.getByRole('button', { name: 'Provenance & metadata', exact: true }).click();
    assert.equal(await page.locator('.provenance-details .recorded-agent').textContent(), expected); assert.equal(await page.locator('.provenance-details dt').filter({ hasText: /^Recorded yolo profile$/ }).locator('xpath=following-sibling::dd[1]').textContent(), title.startsWith('Subagent') ? 'Named_1.2' : 'not recorded'); assert.match(await page.locator('.provenance-details').textContent(), new RegExp(`Producer.*synthetic-harness.*Source format.*${format}.*Recorded source model.*recorded-source-model`, 's')); await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
  }
  assert.deepEqual(errors, []); await context.close(); console.log('PASS source filters: recorded identity claims in source provenance, never title heuristics');
} finally { await browser.close(); await server.close(); }
