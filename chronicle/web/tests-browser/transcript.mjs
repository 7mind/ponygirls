// Behavioral-Active Blackbox / Good Communication: controlled transcript and clipboard.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture } from './fixture.mjs';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const output = fileURLToPath(new URL('../test-results/transcript/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
const longText = '# Heading\n' + '\n'.repeat(21000);
const code = 'const animal = "猫🦄";\nconsole.log(animal);\n';
const text = '# A terminal transcript\r\n\r\nUse **immutable revisions** and `exact bytes`.\r\n1. Deploy\r\n2. Verify\r\n\r\n2 * 3 * 4\r\n\r\n```typescript\r\n' + code + '```\r\n\r\n<script>window.transcriptExecuted = true</script>\r\n[jump](javascript:alert(1))';
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(), fixture = new ChronicleFixture();
    page.on('pageerror', error => errors.push(error.message));
    const messagesAt = fixture.messagesAt.bind(fixture);
    fixture.messagesAt = revision => messagesAt(revision).map(message => message.id === 'm2' ? message.with({ text }) : message.id === 'm3' ? message.with({ text: longText }) : message);
    await fixture.install(page);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`);
    await page.locator('.archive-row .table-title').first().click();
    const message = page.locator('#message-m2'); await message.waitFor();
    assert.equal(await message.getByRole('heading', { name: 'A terminal transcript', exact: true }).count(), 1);
    assert.equal(await message.getByRole('listitem').count(), 2);
    assert.match(await message.textContent(), /2 \* 3 \* 4/);
    await message.getByRole('button', { name: 'Copy message', exact: true }).click();
    await message.getByRole('status', { name: 'Clipboard status', exact: true }).filter({ hasText: 'Message copied' }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    await message.getByRole('button', { name: 'Copy code', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    assert.equal(await message.locator('strong').filter({ hasText: 'immutable revisions' }).count(), 1);
    assert.equal(await message.locator('.message-code code').textContent(), code);
    assert.match(await message.locator('.message-content').evaluate(element => getComputedStyle(element).fontFamily), /mono/i);
    assert.equal(await page.evaluate(() => window.transcriptExecuted), undefined);
    assert.equal(await message.locator('script, a[href^="javascript:"]').count(), 0);
    await message.getByRole('button', { name: 'Source text', exact: true }).click();
    assert.equal(await message.locator('.message-source-text').textContent(), text);
    await message.getByRole('button', { name: 'Formatted view', exact: true }).click();
    await message.locator('.message-code').waitFor();
    const colors = await page.evaluate(() => ['m1', 'm2'].map(id => getComputedStyle(document.querySelector(`#message-${id}`)).borderLeftColor));
    assert.notEqual(colors[0], colors[1], 'Roles have distinct color accents, with textual role labels retained');
    await message.screenshot({ path: `${output}/${theme}-${width}.png` });
    await message.getByRole('button', { name: 'Copy message', exact: true }).click();
    await message.locator('.message-content-actions').getByRole('status', { name: 'Clipboard status', exact: true }).filter({ hasText: 'Message copied' }).waitFor();
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new DOMException('Synthetic clipboard denial', 'NotAllowedError'); } }));
    await message.getByRole('button', { name: 'Copy message', exact: true }).click();
    await message.getByRole('alert').filter({ hasText: 'Clipboard unavailable' }).waitFor();
    assert.equal(await message.locator('.message-content-actions').getByRole('status', { name: 'Clipboard status', exact: true }).textContent(), '');
    assert.equal(await message.getByRole('button', { name: 'Copy message', exact: true }).textContent(), 'Copy message');
    await page.evaluate(() => { delete navigator.clipboard.writeText; });
    await message.getByRole('button', { name: 'Copy message', exact: true }).click();
    await message.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    const longMessage = page.locator('#message-m3');
    assert.ok(await longMessage.locator('.message-content *').count() < 100, 'Large formatted messages must not amplify into unbounded DOM trees');
    assert.equal(await longMessage.locator('.message-source-text').textContent(), longText);
    const bounds = await message.evaluate(element => ({ width: element.scrollWidth, available: element.clientWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(bounds.width <= bounds.available + 1 && bounds.document <= bounds.viewport, JSON.stringify(bounds));
    await page.locator('.passage-list .passage').first().click();
    await page.locator('#message-m1 mark').waitFor();
    assert.equal(await page.locator('#message-m1 mark').textContent(), '猫🦄');
    assert.equal(await page.locator('#message-m1 .message-source-text').textContent(), fixture.messagesAt(1)[0].text);
    results.push(`${theme} ${width}: monospace, inert markup, exact clipboard, source highlights and geometry`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
}
console.log(`PASS transcript: ${results.length} scenarios`);
