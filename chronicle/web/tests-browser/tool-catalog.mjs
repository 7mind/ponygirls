import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
import { toolCatalogFixture } from '../tests/tool-catalog-fixture.ts';

// The MCP tool catalogue: rows, schemas, request examples, tab keyboard, current-definition replacement and authority loss.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Provision PLAYWRIGHT_BROWSERS_PATH; no browser downloads.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const origin = `http://127.0.0.1:${address.port}`, browser = await chromium.launch({ headless: true }), errors = [];
const MIN_TEXT_CONTRAST = 4.5;
async function scene(viewport) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new Goal50Fixture();
  const catalog = fixture.catalog.bind(fixture);
  fixture.catalog = () => catalog().with({ tools: toolCatalogFixture.map(tool => new api.McpToolDefinition(tool.name, tool.description, JSON.stringify(tool.inputSchema))) });
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install(); await fixture.install(page); await page.goto(`${origin}/tests-browser/goal50.html`);
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'MCP', exact: true }).click();
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
const toolRow = (page, name) => page.getByRole('group', { name: 'MCP tools', exact: true }).getByRole('button', { name, exact: true });
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
function plain(tool) { return { name: tool.name, description: tool.description, inputSchemaJson: JSON.stringify(tool.inputSchema) }; }
function luminance(rgb) { const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => { const channel = Number(value) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; }
try {
  await group('actual tools expand to pretty schemas and synthetic request examples without changing the prompt or executing tools', async () => {
    const { context, page, fixture } = await scene({ width: 1440, height: 1000 });
    const tools = page.getByRole('group', { name: 'MCP tools', exact: true });
    assert.equal(await tools.getByRole('button').count(), toolCatalogFixture.length);
    assert.equal(await tab(page, 'Schema').count(), 0, 'every tool row starts collapsed');
    await page.getByLabel('Fresh prompt', { exact: true }).fill('Unsubmitted synthetic draft');
    for (const tool of toolCatalogFixture) {
      await toolRow(page, tool.name).click(); assert.equal(await toolRow(page, tool.name).getAttribute('aria-expanded'), 'true');
      assert.equal(await tools.locator('[aria-expanded="true"]').count(), 1, 'one row is open at a time');
      await tab(page, 'Schema').click();
      assert.equal(await page.getByRole('tabpanel', { name: 'Schema', exact: true }).locator('pre').textContent(), JSON.stringify(tool.inputSchema, null, 2));
      await tab(page, 'Examples').click();
      const examples = page.getByRole('tabpanel', { name: 'Examples', exact: true }), request = JSON.parse(await examples.locator('pre').textContent());
      assert.equal(request.jsonrpc, '2.0'); assert.equal(request.method, 'tools/call'); assert.equal(request.params.name, tool.name);
      for (const key of tool.inputSchema.required) assert.ok(key in request.params.arguments);
      assert.ok(Object.keys(request.params.arguments).every(key => key in tool.inputSchema.properties));
      assert.match(await examples.textContent(), /not executed/);
    }
    await toolRow(page, toolCatalogFixture.at(-1).name).click(); assert.equal(await tab(page, 'Schema').count(), 0, 'a second press collapses the row');
    assert.equal(await page.getByLabel('Fresh prompt', { exact: true }).inputValue(), 'Unsubmitted synthetic draft');
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_StartMcpTest).length, 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search || call.operation instanceof api.Operation_GetSession || call.operation instanceof api.Operation_GetMessages || call.operation instanceof api.Operation_GetChunks).length, 0);
    await context.close();
  });
  await group('tabs expose linked panels, one roving tab stop and Arrow/Home/End focus navigation', async () => {
    const { context, page } = await harness({ width: 1200, height: 900 }, 'light');
    await toolRow(page, 'search_sessions').click();
    const schema = tab(page, 'Schema'), examples = tab(page, 'Examples');
    assert.equal(await schema.getAttribute('tabindex'), '0'); assert.equal(await examples.getAttribute('tabindex'), '-1'); await schema.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await examples.getAttribute('aria-selected'), 'true'); assert.equal(await examples.evaluate(element => element === document.activeElement), true);
    const panel = page.getByRole('tabpanel', { name: 'Examples', exact: true }); assert.equal(await panel.getAttribute('id'), await examples.getAttribute('aria-controls')); assert.equal(await panel.getAttribute('aria-labelledby'), await examples.getAttribute('id'));
    assert.equal(await page.getByRole('tabpanel').count(), 1);
    await page.keyboard.press('Home'); assert.equal(await schema.getAttribute('aria-selected'), 'true'); await page.keyboard.press('End'); assert.equal(await examples.getAttribute('aria-selected'), 'true'); await page.keyboard.press('ArrowLeft'); assert.equal(await schema.getAttribute('aria-selected'), 'true');
    await context.close();
  });
  await group('selected tabs retain text contrast while hovered under either palette', async () => {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await harness({ width: 1200, height: 900 }, theme);
      await toolRow(page, 'search_sessions').click();
      for (const name of ['Examples', 'Schema']) {
        const selected = tab(page, name); await selected.click(); await selected.hover();
        const colors = await selected.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element.closest('.card')).backgroundColor }));
        const a = luminance(colors.color), b = luminance(colors.background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        assert.ok(ratio >= MIN_TEXT_CONTRAST, `${theme} hovered ${name}: contrast ${ratio} is below ${MIN_TEXT_CONTRAST}`);
      }
      await context.close();
    }
  });
  await group('current definitions replace stale objects, keep a valid open row and never restore a removed one', async () => {
    const { context, page } = await harness({ width: 1200, height: 900 }, 'light');
    const definitions = toolCatalogFixture.map(plain);
    await toolRow(page, 'get_session').click(); await tab(page, 'Examples').click();
    const replacement = definitions.map(tool => tool.name === 'get_session' ? { ...tool, description: 'Updated current description' } : tool);
    await page.evaluate(definitions => window.catalogControls.replace(definitions), replacement); await page.getByText('Updated current description', { exact: true }).waitFor();
    assert.equal(await toolRow(page, 'get_session').getAttribute('aria-expanded'), 'true'); assert.equal(await tab(page, 'Examples').getAttribute('aria-selected'), 'true');
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions.filter(tool => tool.name !== 'get_session'));
    await toolRow(page, 'search_sessions').waitFor(); assert.equal(await page.getByRole('tab').count(), 0, 'a removed open row leaves every row collapsed');
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions); await toolRow(page, 'get_session').waitFor();
    assert.equal(await toolRow(page, 'get_session').getAttribute('aria-expanded'), 'false', 'a removed selection is never restored');
    await page.evaluate(() => window.catalogControls.clear()); await page.getByText('Catalog cleared', { exact: true }).waitFor(); assert.equal(await page.getByRole('group', { name: 'MCP tools', exact: true }).count(), 0);
    await page.evaluate(definitions => window.catalogControls.replace(definitions), definitions); await toolRow(page, 'search_sessions').click();
    assert.equal(await tab(page, 'Schema').getAttribute('aria-selected'), 'true'); await context.close();
  });
  await group('catalog authority loss erases the rows and their hidden content without Start', async () => {
    const { context, page, fixture } = await scene({ width: 1440, height: 1000 });
    await toolRow(page, toolCatalogFixture[0].name).click(); await tab(page, 'Examples').click(); fixture.catalogDenied = true; fixture.restart();
    await page.getByRole('alert').filter({ hasText: 'MCP tool catalog authority removed' }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'MCP tools', exact: true }).count(), 0); assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_StartMcpTest).length, 0); await context.close();
  });
  await group('long Unicode schemas render literally, unknown tools do not invent examples and nothing overflows narrow viewports', async () => {
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
      const { context, page } = await harness({ width, height: 1000 }, theme);
      const name = 'future_tool_猫🦄_' + 'long_name_'.repeat(12), text = 'x'.repeat(6000) + '<script>window.catalogInjected=true</script>猫🦄';
      const schema = { type: 'object', description: text, properties: {}, additionalProperties: false };
      await page.evaluate(tool => window.catalogControls.replace([tool]), { name, description: '<script>Literal description</script>猫🦄', inputSchemaJson: JSON.stringify(schema) });
      await toolRow(page, name).click();
      assert.equal(await page.getByRole('tabpanel', { name: 'Schema', exact: true }).locator('pre').textContent(), JSON.stringify(schema, null, 2)); assert.equal(await page.evaluate(() => window.catalogInjected), undefined);
      await tab(page, 'Examples').click(); await page.getByText(/No curated example is available/).waitFor(); assert.equal(await page.getByRole('tabpanel', { name: 'Examples', exact: true }).locator('pre').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}px: no horizontal overflow`);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => /(auto|scroll)/.test(getComputedStyle(element).overflowY + getComputedStyle(element).overflowX) && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)).length), 0, 'long text wraps; nothing becomes an inner scroller');
      await context.close();
    }
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
