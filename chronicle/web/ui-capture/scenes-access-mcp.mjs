// Access and MCP tester (UX-C6), named like the mockup shots (`chronicle-access-<state>[-dark]-<width>.png`, spec §8 item 10).
import { PRIMARY, SECONDARY, PHONE, withScene, gotoTab, settle, inspect } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';
import { Goal50Fixture } from '../tests-browser/goal50-fixture.mjs';
import { toolCatalogFixture } from '../tests/tool-catalog-fixture.ts';

const VARIANTS = [PRIMARY, SECONDARY, PHONE].flatMap(viewport => ['light', 'dark'].map(scheme => ({ viewport, scheme, suffix: scheme === 'dark' ? '-dark' : '', deep: viewport === PRIMARY && scheme === 'light' })));
const named = (base, variant) => `${base}${variant.suffix}-${variant.viewport.tag}.png`;
const MCP_TOOLS = toolCatalogFixture.slice(0, 3).map(tool => tool.name);
const PROMPT = 'Where did we decide the retry cap for the uploader, and why?';
const NOW = '2026-10-26T12:00:00Z';
/** The archive's own fixture has no MCP endpoints; the goal50 fixture scripts the catalogue, runs and reads. */
function mcpFixture(configure) {
  const fixture = new Goal50Fixture(), catalog = fixture.catalog.bind(fixture);
  fixture.tools = MCP_TOOLS;
  fixture.catalog = () => catalog().with({ tools: toolCatalogFixture.slice(0, 3).map(tool => new api.McpToolDefinition(tool.name, tool.description, JSON.stringify(tool.inputSchema))) });
  configure?.(fixture); return fixture;
}
async function openTester(page) { await gotoTab(page, 'mcp'); await page.getByRole('main', { name: 'MCP tester', exact: true }).waitFor(); await page.getByRole('region', { name: 'Current MCP test catalog', exact: true }).waitFor(); }

export function registerAccessMcp(scenario) {
  for (const variant of VARIANTS) {
    const key = `${variant.scheme}-${variant.viewport.tag}`;
    scenario(`access-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
        const capture = (state, shows, reached) => shot('chronicle-access', state, shows, reached, { file: named(`chronicle-access-${state}`, variant) });
        await gotoTab(page, 'access'); await page.getByRole('heading', { name: 'Your groups', exact: true }).waitFor(); await page.getByRole('article').first().waitFor(); await settle(page, 400);
        await capture('default', 'Access: invitations with the sharing warning, then group cards with member tables and invite fields', 'nav link Access');
        await inspect(page, ctx.recorder, `access-${key}`);
        if (!variant.deep) return;
        await shot('chronicle-access', 'default-full', 'Access, whole document', 'same, full-page', { full: true, file: 'chronicle-access-default-full-1440.png' });
        await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).waitFor(); await settle(page);
        await capture('new-group', 'Inline form for a new sharing group', 'New group');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Review and join…' }).first().click(); await page.getByRole('dialog').waitFor(); await settle(page);
        await capture('join', 'Join dialog: sharing explanation and the confirmation checkbox, Join disabled', 'Review and join…');
        await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Delete group…' }).first().click(); await page.getByRole('dialog').waitFor(); await settle(page);
        await capture('delete', 'Delete dialog: consequence and the danger button', 'Delete group…');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Project collaborators');
        await page.getByRole('button', { name: 'Create group', exact: true }).click(); await page.getByRole('region', { name: 'Notifications', exact: true }).waitFor(); await settle(page, 300);
        await capture('toast', 'Toast after creating a group', 'create a group');
        await page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('button', { name: 'Dismiss notification', exact: true }).click();
        const original = fixture.goal50Operation;
        fixture.goal50Operation = (operation, envelope, send, entry) => {
          if (!(operation instanceof api.Operation_CreateGroup)) return original?.(operation, envelope, send, entry) ?? false;
          send(new api.Result_Error(new api.Failure('forbidden', 'Group creation denied: the owner quota of 20 groups is reached'))); return true;
        };
        await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Quota check'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Group creation denied' }).waitFor(); await settle(page, 300);
        await capture('error', 'A rejected mutation: persistent notice above the page, the form keeps its input', 'create a group while the server rejects it');
      });
    });
    scenario(`mcp-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: mcpFixture() }, async ({ page, fixture, shot }) => {
        const capture = (state, shows, reached) => shot('chronicle-mcp', state, shows, reached, { file: named(`chronicle-mcp-${state}`, variant) });
        await openTester(page); await settle(page, 400);
        await capture('default', 'MCP tester: tool catalog beside the prompt card', 'nav link MCP');
        await inspect(page, ctx.recorder, `mcp-${key}`);
        if (!variant.deep) return;
        await page.getByRole('button', { name: MCP_TOOLS[0], exact: true }).click(); await settle(page, 300);
        await capture('schemas', 'First tool expanded in the catalog: description, schema and examples tabs', 'click the first tool row');
        await page.getByRole('button', { name: MCP_TOOLS[0], exact: true }).click();
        await page.getByLabel('Fresh prompt', { exact: true }).fill(PROMPT); await page.getByRole('button', { name: 'Run fresh prompt', exact: true }).click();
        await page.getByRole('region', { name: 'MCP run controls', exact: true }).locator('[data-run-state="Complete"]').waitFor(); await settle(page, 400);
        await capture('complete', 'Completed run: tool rows and the Response block', 'type a prompt + Run fresh prompt');
        await shot('chronicle-mcp', 'complete-full', 'Completed run, whole document', 'same, full-page', { full: true, file: 'chronicle-mcp-complete-full-1440.png' });
      });
      if (!variant.deep) return;
      await withScene(ctx, variant, { fixture: mcpFixture(fixture => {
        const original = fixture.readResult.bind(fixture);
        fixture.readResult = operation => {
          const result = original(operation), first = operation.afterSequence === 0n ? result.result.events.slice(0, 1) : [];
          return new api.Result_McpTestRun(new api.McpTestSnapshot(result.result.instanceId, result.result.runId, api.McpTestState.Running, NOW, first, 1n, false, undefined));
        };
      }) }, async ({ page, shot }) => {
        await openTester(page); await page.getByLabel('Fresh prompt', { exact: true }).fill(PROMPT); await page.getByRole('button', { name: 'Run fresh prompt', exact: true }).click();
        await page.getByRole('region', { name: 'MCP run controls', exact: true }).locator('[data-run-state="Running"]').waitFor(); await page.locator('[data-trace-item]').first().waitFor(); await settle(page, 400);
        await shot('chronicle-mcp', 'running', 'Running run: cancel in the prompt card, waiting indicator', 'Run fresh prompt, reads answered Running', { file: 'chronicle-mcp-running-1440.png' });
      });
    });
  }
}
