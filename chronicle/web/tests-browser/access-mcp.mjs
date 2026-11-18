import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set the provisioned PLAYWRIGHT_BROWSERS_PATH; no browser downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const browser = await chromium.launch({ headless: true }), errors = [];
async function scene(configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), fixture = new Goal50Fixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  if (configure !== undefined) configure(fixture);
  await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/goal50.html`);
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'MCP', exact: true }).click();
  await page.getByLabel('Fresh prompt', { exact: true }).waitFor();
  return { context, page, fixture };
}
async function group(name, body) { await body(); console.log(`PASS browser access-mcp: ${name}`); }
try {
  await group('a re-render during a held read keeps the read cursor: the reply is applied and the next read continues after it', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.mcpHoldReads = true; });
    await page.getByLabel('Fresh prompt', { exact: true }).fill('Hold the first read while the view re-renders');
    await page.getByRole('button', { name: 'Run fresh prompt', exact: true }).click();
    await fixture.waitCall(api.Operation_ReadMcpTest, 1);
    await page.getByRole('button', { name: 'Read original run', exact: true }).click();
    fixture.mcpHoldReads = false; for (const reply of fixture.mcpPending.splice(0)) reply();
    await page.locator('.mcp-trace pre').filter({ hasText: /final response$/ }).waitFor();
    const reads = fixture.calls.filter(call => call.operation instanceof api.Operation_ReadMcpTest).map(call => call.operation.afterSequence);
    assert.deepEqual(reads.slice(0, 2), [0n, 40n], `read cursors ${reads}`);
    await context.close();
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
