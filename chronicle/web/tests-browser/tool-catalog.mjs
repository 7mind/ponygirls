import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
import { toolCatalogFixture } from '../tests/tool-catalog-fixture.ts';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provision PLAYWRIGHT_BROWSERS_PATH; no browser downloads.');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/tool-catalog', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const origin = `http://127.0.0.1:${address.port}`, browser = await chromium.launch({ headless: true }), errors = [];
async function scene(viewport, configure) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new Goal50Fixture();
  const catalog = fixture.catalog.bind(fixture);
  fixture.catalog = () => catalog().with({ tools: toolCatalogFixture.map(tool => new api.McpToolDefinition(tool.name, tool.description, JSON.stringify(tool.inputSchema))) });
  configure(fixture); page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install(); await fixture.install(page); await page.goto(`${origin}/tests-browser/goal50.html`);
  await page.locator('.archive-row').first().waitFor(); await page.getByRole('button', { name: 'mcp', exact: true }).click();
  await page.getByRole('region', { name: 'Current MCP test catalog', exact: true }).waitFor();
  return { context, page, fixture };
}
async function group(name, body) { await body(); console.log(`PASS browser tool-catalog: ${name}`); }
async function harness(viewport, theme) {
  const context = await browser.newContext({ viewport, colorScheme: theme }), page = await context.newPage();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(theme => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = theme; }); }, theme);
  await page.goto(`${origin}/tests-browser/catalog.html`); await page.getByRole('group', { name: 'MCP tools', exact: true }).waitFor();
  return { context, page };
}
function plain(tool) { return { name: tool.name, description: tool.description, inputSchemaJson: JSON.stringify(tool.inputSchema) }; }
function luminance(rgb) { const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => { const channel = Number(value) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; }
try {
  await group('actual tools select pretty schemas and synthetic request examples without changing the prompt or executing tools', async () => {
    const { context, page, fixture } = await scene({ width: 1440, height: 1000 }, () => {});
    const catalog = page.getByRole('region', { name: 'Current MCP test catalog', exact: true });
    assert.equal(await catalog.getByRole('tab', { name: 'SCHEMA', exact: true }).count(), 1, 'Tool catalog requires a Schema tab in the right-hand inspector');
    assert.equal(await catalog.getByRole('tab', { name: 'EXAMPLES', exact: true }).count(), 1, 'Tool catalog requires an Examples tab');
    const tools = catalog.getByRole('group', { name: 'MCP tools', exact: true });
    assert.equal(await tools.getByRole('button').count(), toolCatalogFixture.length);
    await page.getByLabel('Fresh prompt', { exact: true }).fill('Unsubmitted synthetic draft');
    for (const tool of toolCatalogFixture) {
      await tools.getByRole('button', { name: tool.name, exact: true }).click(); await catalog.getByRole('tab', { name: 'SCHEMA', exact: true }).click();
      const schema = catalog.getByRole('tabpanel', { name: 'SCHEMA', exact: true });
      assert.equal(await schema.locator('pre').textContent(), JSON.stringify(tool.inputSchema, null, 2));
      assert.equal(await tools.getByRole('button', { name: tool.name, exact: true }).getAttribute('aria-pressed'), 'true');
      await catalog.getByRole('tab', { name: 'EXAMPLES', exact: true }).click();
      const examples = catalog.getByRole('tabpanel', { name: 'EXAMPLES', exact: true }), request = JSON.parse(await examples.locator('pre').textContent());
      assert.equal(request.jsonrpc, '2.0'); assert.equal(request.method, 'tools/call'); assert.equal(request.params.name, tool.name);
      for (const key of tool.inputSchema.required) assert.ok(key in request.params.arguments);
      assert.ok(Object.keys(request.params.arguments).every(key => key in tool.inputSchema.properties));
      assert.match(await examples.textContent(), /not executed/);
    }
    assert.equal(await page.getByLabel('Fresh prompt', { exact: true }).inputValue(), 'Unsubmitted synthetic draft');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_StartMcpTest).length, 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetMessages || call.operation instanceof api.Operation_GetChunks).length, 0);
    await page.screenshot({ path: resolve(output, 'desktop-examples.png'), animations: 'disabled' }); await context.close();
  });
  await group('tabs expose linked panels, one roving tab stop and Arrow/Home/End focus navigation', async () => {
    const { context, page } = await harness({ width: 1200, height: 900 }, 'light');
    const schema = page.getByRole('tab', { name: 'SCHEMA', exact: true }), examples = page.getByRole('tab', { name: 'EXAMPLES', exact: true });
    assert.equal(await schema.getAttribute('tabindex'), '0'); assert.equal(await examples.getAttribute('tabindex'), '-1'); await schema.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await examples.getAttribute('aria-selected'), 'true'); assert.equal(await examples.evaluate(element => element === document.activeElement), true);
    let panel = page.getByRole('tabpanel', { name: 'EXAMPLES', exact: true }); assert.equal(await panel.getAttribute('id'), await examples.getAttribute('aria-controls')); assert.equal(await panel.getAttribute('aria-labelledby'), await examples.getAttribute('id'));
    assert.equal(await page.getByRole('tabpanel').count(), 1); await page.keyboard.press('Home'); assert.equal(await schema.getAttribute('aria-selected'), 'true'); await page.keyboard.press('End'); assert.equal(await examples.getAttribute('aria-selected'), 'true'); await page.keyboard.press('ArrowLeft'); assert.equal(await schema.getAttribute('aria-selected'), 'true');
    await context.close();
  });
  await group('regression selected tabs retain text contrast while hovered under either palette', async () => {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await harness({ width: 1200, height: 900 }, theme);
      for (const name of ['EXAMPLES', 'SCHEMA']) {
        const tab = page.getByRole('tab', { name, exact: true }); await tab.click(); await tab.hover();
        await tab.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
        const colors = await tab.evaluate(element => { const style = getComputedStyle(element); return { color: style.color, background: style.backgroundColor }; });
        const a = luminance(colors.color), b = luminance(colors.background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        assert.ok(ratio >= 4.5, `${theme} hovered ${name}: contrast ${ratio} is below 4.5`);
      }
      await context.close();
    }
  });
  await group('current definitions replace stale objects, preserve valid selection and never restore a removed selection', async () => {
    const { context, page } = await harness({ width: 1200, height: 900 }, 'light');
    const definitions = toolCatalogFixture.map(plain), tools = page.getByRole('group', { name: 'MCP tools', exact: true });
    await tools.getByRole('button', { name: 'get_session', exact: true }).click(); await page.getByRole('tab', { name: 'EXAMPLES', exact: true }).click();
    const replacement = definitions.map(tool => tool.name === 'get_session' ? { ...tool, description: 'Updated current description' } : tool);
    await page.evaluate(definitions => window.catalogControls.replace(definitions), replacement); await page.getByText('Updated current description', { exact: true }).waitFor();
    assert.equal(await tools.getByRole('button', { name: 'get_session', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await page.getByRole('tab', { name: 'EXAMPLES', exact: true }).getAttribute('aria-selected'), 'true');
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions.filter(tool => tool.name !== 'get_session'));
    await page.waitForFunction(() => document.querySelector('.tool-catalog-list button[aria-pressed=true]').textContent === 'search_sessions');
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions); await tools.getByRole('button', { name: 'get_session', exact: true }).waitFor(); assert.equal(await tools.getByRole('button', { name: 'search_sessions', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.catalogControls.clear()); await page.getByText('Catalog cleared', { exact: true }).waitFor(); assert.equal(await page.locator('.tool-catalog').count(), 0);
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions); await page.getByRole('tab', { name: 'SCHEMA', exact: true }).waitFor(); assert.equal(await page.getByRole('tab', { name: 'SCHEMA', exact: true }).getAttribute('aria-selected'), 'true'); await context.close();
  });
  await group('catalog authority loss erases both panels and their hidden content without Start', async () => {
    const { context, page, fixture } = await scene({ width: 1440, height: 1000 }, () => {});
    await page.getByRole('tab', { name: 'EXAMPLES', exact: true }).click(); fixture.catalogDenied = true; fixture.restart();
    await page.getByRole('alert').filter({ hasText: 'MCP tool catalog authority removed' }).waitFor();
    assert.equal(await page.locator('.tool-catalog').count(), 0); assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_StartMcpTest).length, 0); await context.close();
  });
  await group('long Unicode schemas render literally, unknown tools do not invent examples and panes reflow within narrow viewports', async () => {
    const records = [];
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
      const { context, page } = await harness({ width, height: 1000 }, theme);
      const name = 'future_tool_猫🦄_' + 'long_name_'.repeat(12), text = 'x'.repeat(6000) + '<script>window.catalogInjected=true</script>猫🦄';
      const schema = { type: 'object', description: text, properties: {}, additionalProperties: false };
      await page.evaluate(tool => window.catalogControls.replace([tool]), { name, description: '<script>Literal description</script>猫🦄', inputSchemaJson: JSON.stringify(schema) });
      await page.getByRole('button', { name, exact: true }).waitFor(); const pre = page.getByRole('tabpanel', { name: 'SCHEMA', exact: true }).locator('pre');
      assert.equal(await pre.textContent(), JSON.stringify(schema, null, 2)); assert.equal(await page.evaluate(() => window.catalogInjected), undefined);
      const layout = await page.evaluate(() => { const list = document.querySelector('.tool-catalog-list').getBoundingClientRect(), inspector = document.querySelector('.tool-catalog-inspector').getBoundingClientRect(), pre = document.querySelector('.tool-catalog-panel:not([hidden]) pre'); return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, sideBySide: list.right <= inspector.left + 1, stacked: list.bottom <= inspector.top + 1, preScrolls: pre.scrollWidth > pre.clientWidth }; });
      assert.ok(layout.documentWidth <= width); assert.equal(layout.sideBySide, width > 720); assert.equal(layout.stacked, width <= 720); assert.equal(layout.preScrolls, true);
      await page.screenshot({ path: resolve(output, `${theme}-${width}-schema.png`), animations: 'disabled' });
      await page.getByRole('tab', { name: 'EXAMPLES', exact: true }).click(); await page.getByText(/No curated example is available/).waitFor(); assert.equal(await page.getByRole('tabpanel', { name: 'EXAMPLES', exact: true }).locator('pre').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); records.push({ theme, width, ...layout }); await context.close();
    }
    await writeFile(resolve(output, 'metrics.json'), JSON.stringify({ syntheticOnly: true, providerCalls: 0, records }, null, 2));
  });
  assert.deepEqual(errors, []);
  console.log(`Catalog evidence: ${output}`);
} finally { await browser.close(); await server.close(); }
