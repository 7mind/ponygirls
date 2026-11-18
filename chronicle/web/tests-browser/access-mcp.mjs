import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, advanceClock, api, connectionConfig, pauseClock } from './fixture.mjs';
import { Goal50Fixture } from './goal50-fixture.mjs';

// Access (groups, memberships, invitations) and the MCP tester: behaviour, authorization fences and the document-scroll model.
// Standalone: one Vite server, one browser, a context per case; timers on the page clock (Goal50 pages), never real-time waits.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set the provisioned PLAYWRIGHT_BROWSERS_PATH; no browser downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, allowedHosts: ['chronicle.test'], watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const origin = `http://127.0.0.1:${address.port}`, MCP_POLL_MS = 2_000, CLOCK_PAST_POLL_MS = 2_100;
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP chronicle.test 127.0.0.1', '--no-proxy-server'] }), errors = [];
const nativeDialogs = [];
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nav = page => page.getByRole('navigation', { name: 'Main navigation', exact: true });
async function open(context, page, fixture, url, view, name) {
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { nativeDialogs.push(dialog.message()); void dialog.dismiss(); });
  await fixture.install(page); await page.goto(url);
  await nav(page).getByRole('link', { name: view, exact: true }).click(); await page.getByRole('main', { name, exact: true }).waitFor();
  return { context, page, fixture };
}
async function accessScene(viewport, originUrl = origin, fixture = new ChronicleFixture()) {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  await page.clock.install();
  return open(context, page, fixture, `${originUrl}/tests-browser/harness.html`, 'Access', 'Access management');
}
/** The MCP tester page; the catalogue may still be pending (a case can hold it). */
async function mcpPage(configure, viewport) {
  const context = await browser.newContext({ viewport }), page = await context.newPage(), fixture = new Goal50Fixture();
  if (configure !== undefined) configure(fixture);
  await page.clock.install();
  return open(context, page, fixture, `${origin}/tests-browser/goal50.html`, 'MCP', 'MCP tester');
}
async function mcpScene(configure, viewport = { width: 1440, height: 1000 }) {
  const scene = await mcpPage(configure, viewport);
  await scene.page.getByRole('region', { name: 'Current MCP test catalog', exact: true }).waitFor();
  return scene;
}
async function group(name, body) { await body(); console.log(`PASS browser access-mcp: ${name}`); }
/** The mutation-feedback fixture page (toasts, notices) on a page clock. */
async function notificationScene(width = 1280, colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme }), page = await context.newPage();
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.clock.install();
  await page.goto(`${origin}/tests-browser/notifications.html`); await page.getByRole('heading', { name: 'Notification fixture', exact: true }).waitFor();
  return { context, page };
}
async function succeed(page) { await page.getByRole('button', { name: 'Retry job', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click(); }
const notifications = page => page.getByRole('region', { name: 'Notifications', exact: true });
const calls = (fixture, Operation) => fixture.calls.filter(call => call.operation instanceof Operation);
const prompt = page => page.getByLabel('Fresh prompt', { exact: true });
const runButton = page => page.getByRole('button', { name: 'Run fresh prompt', exact: true });
const runCard = page => page.getByRole('region', { name: 'MCP run controls', exact: true });
const runState = (page, state) => runCard(page).locator(`[data-run-state="${state}"]`);
const traceItems = page => page.locator('[data-trace-item]');
const finalResponse = page => page.locator('[data-trace-item="response"]').filter({ hasText: /final response$/ });
async function run(page, text) { await prompt(page).fill(text); await runButton(page).click(); }
/** Vertical scrollers other than the document (spec §8 item 1). */
const scrollers = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => {
  const style = getComputedStyle(element);
  return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
}).map(element => element.tagName.toLowerCase() + (element.id === '' ? '' : `#${element.id}`)));
/** Reads answer `Running` with the first trace event only, so a run stays active while its trace is displayed. */
function stayRunning(fixture) {
  const original = fixture.readResult.bind(fixture);
  fixture.readResult = operation => {
    const result = original(operation);
    if (!(result instanceof api.Result_McpTestRun)) return result;
    const first = operation.afterSequence === 0n ? result.result.events.slice(0, 1) : [];
    return new api.Result_McpTestRun(new api.McpTestSnapshot(result.result.instanceId, result.result.runId, api.McpTestState.Running, result.result.observedAt, first, 1n, false, undefined));
  };
}
try {
  // ---- Access
  await group('Access page: document scroller only, account link replaces the token-settings pointer, no native dialogs', async () => {
    const { context, page } = await accessScene({ width: 1440, height: 420 });
    assert.equal(await page.getByRole('heading', { name: 'Access', level: 1, exact: true }).isVisible(), true);
    assert.deepEqual(await scrollers(page), [], 'no nested vertical scroller');
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), 'the document scrolls');
    assert.equal(await page.getByRole('button', { name: 'Open token settings', exact: true }).count(), 0);
    const link = page.getByRole('link', { name: 'Account → Access tokens', exact: true });
    assert.equal(await link.getAttribute('href'), '#account/tokens');
    await link.click(); await page.getByRole('heading', { name: 'Access tokens', exact: true }).waitFor();
    await context.close();
  });
  await group('group mutations: form, toast, invite, join/remove/leave/delete through in-app dialogs that Escape, Cancel and the backdrop never confirm', async () => {
    const { context, page, fixture } = await accessScene({ width: 1440, height: 1000 });
    const article = name => page.getByRole('article', { name, exact: true }), dialog = page.getByRole('dialog');
    async function dismissed(open, how) {
      await open(); await dialog.waitFor();
      if (how === 'Escape') await page.keyboard.press('Escape'); else if (how === 'Cancel') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); else await page.mouse.click(2, 2);
      if (how === 'backdrop') assert.equal(await dialog.isVisible(), true, 'a press on the backdrop leaves the confirmation open'); else await dialog.waitFor({ state: 'detached' });
      if (how === 'backdrop') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(), await dialog.waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: 'New group', exact: true }).click();
    await page.getByLabel('Group name', { exact: true }).fill('Synthetic group'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await article('Synthetic group').waitFor(); await page.getByRole('region', { name: 'Notifications', exact: true }).getByText('Create group completed.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Group name', { exact: true }).count(), 0, 'the form closes once the group exists');
    // join: checkbox gate
    const join = () => page.getByRole('button', { name: 'Review and join…', exact: true }).click();
    await dismissed(join, 'Escape'); await dismissed(join, 'backdrop');
    await join(); await dialog.waitFor();
    const confirmJoin = dialog.getByRole('button', { name: 'Join and share', exact: true });
    assert.equal(await confirmJoin.isDisabled(), true); await dialog.getByRole('checkbox').check(); assert.equal(await confirmJoin.isDisabled(), false);
    await confirmJoin.click(); await page.getByRole('button', { name: 'Review and join…', exact: true }).waitFor({ state: 'detached' });
    assert.equal(calls(fixture, api.Operation_AcceptInvite)[0].operation.confirmSharing, true);
    const input = article('Systems workshop').getByRole('textbox', { name: 'User id to invite', exact: true });
    await input.fill('carol'); await article('Systems workshop').getByRole('button', { name: 'Invite', exact: true }).click();
    await page.getByRole('region', { name: 'Notifications', exact: true }).getByText('Invite member completed.', { exact: true }).waitFor();
    await fixture.waitUntil(() => calls(fixture, api.Operation_Invite).length === 1, 'the invitation was not sent'); assert.equal(calls(fixture, api.Operation_Invite)[0].operation.targetId, 'carol');
    assert.equal(await input.inputValue(), '', 'a sent invitation clears the field');
    // remove / leave / delete
    const remove = () => article('Systems workshop').getByRole('button', { name: 'Remove bob from Systems workshop', exact: true }).click();
    await dismissed(remove, 'Escape'); await dismissed(remove, 'Cancel');
    await remove(); await dialog.getByRole('button', { name: 'Remove member', exact: true }).click();
    await article('Systems workshop').getByRole('button', { name: 'Remove bob from Systems workshop', exact: true }).waitFor({ state: 'detached' });
    const leave = () => article('Research circle').getByRole('button', { name: 'Leave group…', exact: true }).click();
    await dismissed(leave, 'Escape');
    await leave(); await dialog.getByRole('button', { name: 'Leave group', exact: true }).click(); await article('Research circle').waitFor({ state: 'detached' });
    const del = () => article('Synthetic group').getByRole('button', { name: 'Delete group…', exact: true }).click();
    await dismissed(del, 'Escape'); await dismissed(del, 'Cancel'); await dismissed(del, 'backdrop');
    await del(); await dialog.getByRole('button', { name: 'Delete group', exact: true }).click(); await article('Synthetic group').waitFor({ state: 'detached' });
    for (const Operation of [api.Operation_CreateGroup, api.Operation_Invite, api.Operation_AcceptInvite, api.Operation_RemoveMember, api.Operation_LeaveGroup, api.Operation_DeleteGroup]) assert.equal(calls(fixture, Operation).length, 1, `${Operation.name} was sent exactly once`);
    await context.close();
  });
  await group('a rejected group mutation is a persistent notice in the shell, not a toast; the form keeps the name and nothing was replayed', async () => {
    const fixture = new ChronicleFixture(), original = fixture.goal50Operation;
    fixture.goal50Operation = (operation, envelope, send, entry) => {
      if (!(operation instanceof api.Operation_CreateGroup)) return original?.(operation, envelope, send, entry) ?? false;
      send(new api.Result_Error(new api.Failure('forbidden', 'Group creation denied'))); return true;
    };
    const { context, page } = await accessScene({ width: 1440, height: 1000 }, origin, fixture);
    await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Denied group'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Group creation denied' }); await alert.waitFor();
    await page.clock.runFor(MCP_POLL_MS * 5); assert.equal(await alert.isVisible(), true, 'an error never expires');
    assert.equal(await notifications(page).count(), 0); assert.equal(await page.getByLabel('Group name', { exact: true }).inputValue(), 'Denied group');
    assert.equal(await page.getByRole('button', { name: 'Create group', exact: true }).isEnabled(), true); assert.equal(calls(fixture, api.Operation_CreateGroup).length, 1);
    await context.close();
  });
  await group('a group mutation whose reply is lost becomes an uncertain notice: Access stays locked, the receipt lookup and the confirmed-absent retry reuse the request id', async () => {
    const fixture = new ChronicleFixture(), original = fixture.goal50Operation; let dropCreate = true;
    fixture.goal50Operation = (operation, envelope, send, entry) => operation instanceof api.Operation_CreateGroup && dropCreate ? true : original?.(operation, envelope, send, entry) ?? false;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    await pauseClock(page);
    await open(context, page, fixture, `${origin}/tests-browser/harness.html`, 'Access', 'Access management');
    await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Lost acknowledgement'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await advanceClock(page, connectionConfig.requestTimeout - 1); assert.equal(await page.getByRole('region', { name: 'Uncertain mutation', exact: true }).count(), 0, 'no uncertainty before the request deadline');
    await advanceClock(page, 1); const uncertain = page.getByRole('region', { name: 'Uncertain mutation', exact: true }); await uncertain.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Delete group…', exact: true }).first().isDisabled(), true, 'writes stay locked while the outcome is unknown');
    assert.equal(await page.getByRole('button', { name: 'Invite', exact: true }).first().isDisabled(), true);
    await uncertain.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    await page.getByText('No committed receipt was found. You may explicitly retry the same payload with the same request ID.', { exact: true }).waitFor();
    dropCreate = false; await uncertain.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).click();
    await page.getByRole('article', { name: 'Lost acknowledgement', exact: true }).waitFor(); await uncertain.waitFor({ state: 'detached' });
    const sent = calls(fixture, api.Operation_CreateGroup); assert.equal(sent.length, 2); assert.equal(sent[0].requestId, sent[1].requestId, 'the retry reuses the original request id');
    await context.close();
  });
  await group('non-loopback insecure HTTP: group mutations carry UUID request ids without randomUUID', async () => {
    const { context, page, fixture } = await accessScene({ width: 1440, height: 1000 }, `http://chronicle.test:${address.port}`);
    assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })), { secure: false, uuid: 'undefined' });
    await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Private HTTP group'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await page.getByRole('article', { name: 'Private HTTP group', exact: true }).waitFor();
    assert.equal(calls(fixture, api.Operation_CreateGroup).length, 1);
    for (const envelope of fixture.calls) assert.match(envelope.requestId, REQUEST_ID);
    await context.close();
  });

  // ---- MCP tester: shape
  await group('a re-render during a held read keeps the read cursor: the reply is applied and the next read continues after it', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpHoldReads = true; });
    await run(page, 'Hold the first read while the view re-renders');
    await fixture.waitCall(api.Operation_ReadMcpTest, 1);
    await page.getByRole('button', { name: 'Read original run', exact: true }).click();
    fixture.mcpHoldReads = false; for (const reply of fixture.mcpPending.splice(0)) reply();
    await finalResponse(page).waitFor();
    const reads = calls(fixture, api.Operation_ReadMcpTest).map(call => call.operation.afterSequence);
    assert.deepEqual(reads.slice(0, 2), [0n, 40n], `read cursors ${reads}`);
    await context.close();
  });
  await group('MCP page: prompt and Run are visible at 390px, one document scroller, the catalogue stays beside the work column', async () => {
    const narrow = await mcpScene(undefined, { width: 390, height: 844 });
    for (const control of [prompt(narrow.page), runButton(narrow.page)]) {
      const bounds = await control.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844, `Prompt and Run are visible before scrolling: ${JSON.stringify(bounds)}`);
    }
    assert.ok(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await narrow.context.close();
    const { context, page, fixture } = await mcpScene(undefined, { width: 1440, height: 500 });
    await run(page, 'Fill the page'); await finalResponse(page).waitFor();
    assert.deepEqual(await scrollers(page), [], 'no nested vertical scroller');
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight));
    await page.evaluate(() => window.scrollTo(0, 120));
    const offset = await page.evaluate(() => ({ top: document.querySelector('[aria-label="Current MCP test catalog"]').getBoundingClientRect().top, expected: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--masthead-h')) + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-5')) }));
    assert.ok(Math.abs(offset.top - offset.expected) <= 1, `the catalogue sticks under the masthead: ${JSON.stringify(offset)}`);
    assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
    await context.close();
  });
  await group('Runtime limits and the run help stay inside a 320px viewport in both colour schemes and close on Escape', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const { context, page } = await mcpScene(undefined, { width: 320, height: 844 }); await page.emulateMedia({ colorScheme });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const label of ['Runtime limits', 'About running prompts']) {
        const button = page.getByRole('button', { name: label, exact: true }); await button.click();
        const panel = page.locator(`[id="${await button.getAttribute('aria-controls')}"]`); await panel.waitFor();
        const bounds = await panel.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0 && bounds.y + bounds.height <= 844, `${label} remains readable in the viewport: ${JSON.stringify(bounds)}`);
        if (label === 'About running prompts') { const help = await panel.innerText(); for (const disclosure of [/cost/i, /authorized source data/, /never replayed/]) assert.match(help, disclosure); }
        await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
      }
      await context.close();
    }
  });
  await group('MCP validates the scalar UTF-8 prompt limit before Start and displays the declared limits', async () => {
    const { context, page, fixture } = await mcpScene();
    await prompt(page).fill('🦄'.repeat(4097)); assert.equal(await runButton(page).isDisabled(), true); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 0);
    await page.getByRole('button', { name: 'Runtime limits', exact: true }).click();
    const text = await page.getByRole('region', { name: 'Current MCP test catalog', exact: true }).innerText() + await page.getByRole('dialog', { name: 'Runtime limits', exact: true }).innerText();
    for (const value of ['65536', 'MAX', '524288', '131072', '900', '600', 'maximumRequestBytes', 'maximumResultBytes']) assert.ok(text.includes(value), value);
    await context.close();
  });
  await group('the catalogue stays visible and current after an immediate Start and after Complete, also while reads are held', async () => {
    for (const held of [false, true]) {
      const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpHoldReads = held; });
      await page.emulateMedia({ colorScheme: 'dark' });
      const initial = fixture.incarnation; fixture.incarnation = '00000000-0000-4000-8000-000000060099'; fixture.tools.push('fresh_registry_tool');
      await run(page, 'Synthetic fast catalog publication');
      const catalog = page.getByRole('region', { name: 'Current MCP test catalog', exact: true });
      async function verifyCatalog(stage) {
        await catalog.waitFor();
        assert.equal(await catalog.getByRole('group', { name: 'MCP tools', exact: true }).getByRole('button').count(), 4, `the validated catalog stays after ${stage}`);
        const limits = page.getByRole('button', { name: 'Runtime limits', exact: true }); await limits.click();
        const content = await catalog.innerText() + await page.getByRole('dialog', { name: 'Runtime limits', exact: true }).innerText();
        for (const value of [fixture.incarnation, 'declared-model', 'declared-revision', '65536', 'MAX', '524288', '131072', '900', '600']) assert.ok(content.includes(value), `${value} after ${stage}`);
        assert.equal(content.includes(initial), false); await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Runtime limits', exact: true }).waitFor({ state: 'hidden' });
      }
      if (held) { await runState(page, 'Queued').waitFor(); await verifyCatalog('the immediate Start acknowledgement'); fixture.mcpHoldReads = false; for (const reply of fixture.mcpPending.splice(0)) reply(); }
      await finalResponse(page).waitFor(); await verifyCatalog('the Complete snapshot'); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
      await context.close();
    }
  });

  // ---- MCP tester: runs, traces and authorization
  await group('fresh catalog, dynamic tools, full multipart pages and literal output, then terminal reauthorization erases the trace', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.tools.push('new_registry_tool'); });
    assert.equal(await page.getByRole('group', { name: 'MCP tools', exact: true }).getByRole('button').count(), 4);
    await run(page, 'Only this fresh prompt 猫🦄'); await finalResponse(page).waitFor();
    assert.equal(calls(fixture, api.Operation_McpTestTools).length, 2); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
    const reads = calls(fixture, api.Operation_ReadMcpTest);
    assert.equal(reads[0].operation.afterSequence, 0n); assert.equal(reads[1].operation.afterSequence, 40n); assert.ok(reads.every(call => call.operation.limit <= 40));
    const texts = await page.locator('[data-trace-item="tool:call"] pre').allTextContents();
    assert.equal(texts[0], '{"query":"fresh 猫🦄"}'); assert.ok(texts[1].startsWith('{"source":"part1🦄')); assert.ok(texts[1].endsWith('END"}'));
    assert.equal(await page.locator('[data-trace-item="response"] .mcp-response-text').textContent(), '<script>literal-not-executed</script>猫🦄 final response');
    assert.equal(await page.locator('[data-trace-item] script').count(), 0);
    fixture.mcpAuthorityLost = true; await page.clock.runFor(CLOCK_PAST_POLL_MS); assert.ok(CLOCK_PAST_POLL_MS > MCP_POLL_MS);
    await page.getByRole('alert').filter({ hasText: 'MCP source authorization lost' }).waitFor();
    assert.equal(await traceItems(page).count(), 0); assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key !== 'chronicle.theme.preference').length), 0);
    await context.close();
  });
  await group('a mismatched terminal snapshot cannot unlock another cost-bearing Start', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpWrongTerminal = true; });
    await run(page, 'Synthetic identity check');
    await page.getByRole('alert').filter({ hasText: /identity changed/ }).waitFor(); await runState(page, 'Uncertain').waitFor();
    await prompt(page).fill('Do not admit another cost'); assert.equal(await runButton(page).count(), 0, 'no Run while the original run is unresolved');
    assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1); await context.close();
  });
  await group('cancellation that loses authority erases the trace at once, without waiting for a Read', async () => {
    const { context, page, fixture } = await mcpScene(stayRunning);
    await run(page, 'Synthetic cancellation authority'); await runState(page, 'Running').waitFor(); await traceItems(page).first().waitFor();
    fixture.mcpHoldReads = true; fixture.cancelAuthorityLost = true;
    await page.getByRole('button', { name: 'Request cancellation', exact: true }).click(); await runState(page, 'AuthorizationLost').waitFor();
    assert.equal(await traceItems(page).count(), 0); await context.close();
  });
  await group('an unknown Start is never replayed; the ids survive navigation; explicit acknowledgement allows a new cost', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpDropStart = true; fixture.mcpReadFailure = 'mcp-run-not-found'; });
    await run(page, 'First prompt only'); await fixture.waitCall(api.Operation_StartMcpTest, 1);
    const original = calls(fixture, api.Operation_StartMcpTest)[0].operation; fixture.restart();
    await page.getByRole('alert').filter({ hasText: /Outcome unknown/ }).waitFor(); assert.equal(await runButton(page).count(), 0);
    await nav(page).getByRole('link', { name: 'Activity', exact: true }).click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    await nav(page).getByRole('link', { name: 'MCP', exact: true }).click(); await page.getByRole('main', { name: 'MCP tester', exact: true }).waitFor();
    assert.ok((await runCard(page).textContent()).includes(original.runId)); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
    const clear = page.getByRole('button', { name: 'Clear run and trace', exact: true }); assert.equal(await clear.isDisabled(), true, 'clearing an active run needs the acknowledgement');
    await runCard(page).getByRole('checkbox').check(); await clear.click(); await runCard(page).waitFor({ state: 'detached' });
    fixture.mcpDropStart = false; fixture.mcpReadFailure = null; fixture.incarnation = '00000000-0000-4000-8000-000000060001';
    await run(page, 'Second prompt only'); await finalResponse(page).waitFor();
    const next = calls(fixture, api.Operation_StartMcpTest)[1].operation;
    assert.equal(next.prompt, 'Second prompt only'); assert.notEqual(next.runId, original.runId); assert.notEqual(next.instanceId, original.instanceId); assert.equal(calls(fixture, api.Operation_Receipt).length, 0);
    await context.close();
  });
  await group('a changed run retries only the Read, and cancellation reconciles a completion race', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpReadFailure = 'mcp-run-changed'; });
    await run(page, 'Read retry, not model retry'); await page.getByRole('alert').filter({ hasText: /Registry changed/ }).waitFor();
    fixture.mcpReadFailure = null; fixture.mcpHoldReads = true; await page.getByRole('button', { name: 'Read original run', exact: true }).click(); await fixture.waitCall(api.Operation_ReadMcpTest, 2);
    fixture.cancelComplete = true; await page.getByRole('button', { name: 'Request cancellation', exact: true }).click(); await fixture.waitCall(api.Operation_CancelMcpTest, 1);
    fixture.mcpHoldReads = false; for (const reply of fixture.mcpPending.splice(0)) reply();
    await runState(page, 'Complete').waitFor(); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1); await context.close();
  });
  await group('a pending cancellation cannot overlap a new cost-bearing run admission', async () => {
    const { context, page, fixture } = await mcpScene(stayRunning);
    await run(page, 'Running before cancellation'); await runState(page, 'Running').waitFor();
    fixture.holdCancels = true; await page.getByRole('button', { name: 'Request cancellation', exact: true }).click(); await fixture.waitCall(api.Operation_CancelMcpTest, 1);
    await prompt(page).fill('No new admission while old Cancel is pending'); assert.equal(await runButton(page).count(), 0); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
    fixture.cancelPending.shift()(new api.Result_Error(new api.Failure('mcp-run-not-found', 'Original cancel outcome unknown')));
    await runState(page, 'Uncertain').waitFor(); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1); await context.close();
  });
  await group('server MCP context, output, source and deadline errors are explicit, without Start retries or silent truncation', async () => {
    for (const code of ['mcp-request-limit', 'mcp-output-limit', 'mcp-source-limit', 'mcp-deadline']) {
      const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpReadFailure = code; });
      await run(page, `Synthetic ${code}`); await page.getByRole('alert').filter({ hasText: /Outcome unknown/ }).waitFor();
      assert.equal(await traceItems(page).count(), 0); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1); assert.equal(await runButton(page).count(), 0);
      await context.close();
    }
  });
  await group('a security epoch and an account change erase the private prompt and the trace before the retained view refreshes', async () => {
    const { context, page, fixture } = await mcpScene();
    await run(page, 'Private synthetic owner prompt'); await finalResponse(page).waitFor(); await prompt(page).fill('Never retain this unsent prompt');
    fixture.mcpHoldReads = true; fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart();
    await nav(page).getByRole('link', { name: 'Archive', exact: true }).waitFor(); await nav(page).getByRole('link', { name: 'MCP', exact: true }).click(); await page.getByRole('main', { name: 'MCP tester', exact: true }).waitFor();
    assert.equal(await traceItems(page).count(), 0); assert.equal(await prompt(page).inputValue(), ''); assert.equal(await runCard(page).count(), 0); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1);
    await context.close();
  });
  await group('a completed trace is reauthorized and erased even while another tab is selected', async () => {
    const { context, page, fixture } = await mcpScene();
    await run(page, 'Terminal reauthorization across navigation'); await finalResponse(page).waitFor();
    await nav(page).getByRole('link', { name: 'Activity', exact: true }).click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    fixture.mcpAuthorityLost = true; await page.clock.runFor(CLOCK_PAST_POLL_MS); await fixture.waitCall(api.Operation_ReadMcpTest, 3);
    await nav(page).getByRole('link', { name: 'MCP', exact: true }).click(); await page.getByRole('main', { name: 'MCP tester', exact: true }).waitFor();
    assert.equal(await traceItems(page).count(), 0); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 1); await context.close();
  });
  await group('an authority error clears an unsent private prompt as well as the trace', async () => {
    const { context, page, fixture } = await mcpScene();
    await run(page, 'Run then type a separate draft'); await finalResponse(page).waitFor(); await prompt(page).fill('Private unsent draft must erase');
    fixture.mcpAuthorityLost = true; await page.getByRole('button', { name: 'Read original run', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /MCP source authorization lost/ }).waitFor();
    assert.equal(await prompt(page).inputValue(), ''); assert.equal(await traceItems(page).count(), 0); await context.close();
  });
  await group('a fresh-catalog authority denial erases the retained trace before another run Read', async () => {
    const { context, page, fixture } = await mcpScene();
    await run(page, 'Catalog authorization boundary'); await finalResponse(page).waitFor();
    await nav(page).getByRole('link', { name: 'Activity', exact: true }).click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    fixture.mcpHoldReads = true; fixture.catalogDenied = true; await nav(page).getByRole('link', { name: 'MCP', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /MCP tool catalog authority removed/ }).waitFor(); assert.equal(await traceItems(page).count(), 0); await context.close();
  });
  await group('a catalog denial fences a pre-denial captured run Read from restoring the private trace or finality', async () => {
    const { context, page, fixture } = await mcpScene(fixture => { fixture.mcpHoldReads = true; fixture.mcpCaptureReads = true; });
    await run(page, 'Captured authority race'); await fixture.waitCall(api.Operation_ReadMcpTest, 1); const captured = fixture.mcpPending.shift();
    await nav(page).getByRole('link', { name: 'Activity', exact: true }).click(); await page.getByRole('main', { name: 'Activity', exact: true }).waitFor();
    fixture.catalogDenied = true; await nav(page).getByRole('link', { name: 'MCP', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /MCP tool catalog authority removed/ }).waitFor(); captured();
    await runState(page, 'Uncertain').waitFor(); await page.clock.runFor(150); assert.equal(await traceItems(page).count(), 0); await runState(page, 'Uncertain').waitFor(); await context.close();
  });
  await group('an authority denial fences a captured preflight catalog before any cost-bearing Start submission', async () => {
    const { context, page, fixture } = await mcpPage(fixture => { fixture.holdCatalogs = true; }, { width: 1440, height: 1000 });
    await fixture.waitCall(api.Operation_McpTestTools, 1); await prompt(page).fill('Do not submit after newer authority denial'); await runButton(page).click(); await fixture.waitCall(api.Operation_McpTestTools, 2);
    const initial = fixture.catalogPending.shift(), preflight = fixture.catalogPending.shift();
    initial.send(new api.Result_Error(new api.Failure('forbidden', 'Newer authority denial fences pending Start'))); await page.getByRole('alert').filter({ hasText: /Newer authority denial/ }).waitFor();
    preflight.send(new api.Result_McpTestTools(preflight.catalog)); await runButton(page).waitFor(); assert.equal(calls(fixture, api.Operation_StartMcpTest).length, 0); await context.close();
  });
  // ---- Mutation feedback: toasts and persistent notices (MutationToast, MutationNotice)
  await group('routine success is a polite dismissible toast without in-page layout or focus changes', async () => {
    for (const [width, theme] of [[1280, 'light'], [320, 'dark']]) {
      const { context, page } = await notificationScene(width, theme), heading = page.getByRole('heading', { name: 'Notification fixture', exact: true }), before = await heading.boundingBox();
      await succeed(page); const toast = notifications(page); await toast.waitFor();
      assert.equal(await toast.getByRole('status').innerText(), 'Retry indexing job completed.');
      assert.equal(await toast.getByRole('status').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#notices .notice').count(), 0, 'Routine success must not occupy the global in-page notice stack');
      assert.deepEqual(await heading.boundingBox(), before, 'Success must not push the current page down');
      assert.equal(await page.getByRole('button', { name: 'Return success', exact: true }).evaluate(element => element === document.activeElement), true);
      const bounds = await toast.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900);
      await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).click(); await toast.waitFor({ state: 'detached' });
      await succeed(page); await toast.waitFor(); await page.mouse.move(0, 0); await page.clock.runFor(7000); await toast.waitFor({ state: 'detached' });
      await succeed(page); await toast.waitFor(); await page.clock.runFor(3000); await toast.hover(); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true, 'Hover pauses the dismissal timer');
      await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).focus(); await page.mouse.move(0, 0); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true, 'Keyboard focus pauses the dismissal timer');
      await page.getByRole('button', { name: 'Return success', exact: true }).focus(); await page.clock.runFor(7000); await toast.waitFor({ state: 'detached' });
      await context.close();
    }
  });
  await group('late and existing toasts stay visible and keyboard-accessible in a modal in-app dialog', async () => {
    for (const beforeDialog of [false, true]) {
      const { context, page } = await notificationScene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click();
      if (beforeDialog) { await page.getByRole('button', { name: 'Return success', exact: true }).click(); await notifications(page).waitFor(); }
      await page.getByRole('button', { name: 'Open modal', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Modal fixture', exact: true }); await dialog.waitFor();
      if (!beforeDialog) await dialog.getByRole('button', { name: 'Return modal success', exact: true }).click();
      const toast = notifications(page); await toast.waitFor();
      assert.equal(await toast.evaluate(element => element.closest('dialog')?.matches(':modal')), true, 'Notifications must be inside the active modal accessibility tree, not inert beneath its backdrop');
      const dismiss = toast.getByRole('button', { name: 'Dismiss notification', exact: true });
      assert.equal(await dismiss.evaluate(element => { const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element || element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); }), true);
      await dismiss.focus(); await page.clock.runFor(7000); assert.equal(await toast.isVisible(), true); await dismiss.press('Enter'); await toast.waitFor({ state: 'detached' });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await context.close();
    }
  });
  await group('notification authorization boundaries clear current and late successes', async () => {
    for (const boundary of ['Invalidate', 'Change account', 'Sign out']) {
      const { context, page } = await notificationScene(); await succeed(page); await notifications(page).waitFor();
      await page.getByRole('button', { name: boundary, exact: true }).click(); assert.equal(await notifications(page).count(), 0);
      await context.close();
      const late = await notificationScene(); await late.page.getByRole('button', { name: 'Retry job', exact: true }).click();
      await late.page.getByRole('button', { name: boundary, exact: true }).click(); await late.page.getByRole('button', { name: 'Return success', exact: true }).click();
      assert.equal(await notifications(late.page).count(), 0, 'A late result cannot resurrect notifications outside the initiating authorization epoch');
      await late.context.close();
    }
  });
  await group('uncertain and absent-receipt recovery stays durable, owner-bound and never automatically replays', async () => {
    const { context, page } = await notificationScene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click();
    const id = await page.locator('output[aria-label="Request ID"]').textContent();
    await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); const uncertain = page.getByRole('region', { name: 'Uncertain mutation', exact: true }); await uncertain.waitFor();
    await page.clock.runFor(10000); assert.equal(await uncertain.isVisible(), true); assert.equal(await notifications(page).count(), 0);
    await page.getByRole('button', { name: 'Retry job', exact: true }).click(); assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '1');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); assert.equal(await uncertain.getByRole('button', { name: 'Look up receipt', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Sign in original', exact: true }).click(); await uncertain.getByRole('button', { name: 'Look up receipt', exact: true }).click();
    assert.equal(await page.locator('output[aria-label="Request ID"]').textContent(), id); await page.getByRole('button', { name: 'Receipt absent', exact: true }).click();
    await page.getByText('No committed receipt was found. You may explicitly retry the same payload with the same request ID.', { exact: true }).waitFor();
    await page.clock.runFor(10000); assert.equal(await uncertain.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).isVisible(), true); assert.equal(await notifications(page).count(), 0);
    assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '2');
    await uncertain.getByRole('button', { name: 'Retry confirmed-absent request', exact: true }).click(); assert.equal(await page.locator('output[aria-label="Request ID"]').textContent(), id);
    await page.getByRole('button', { name: 'Return success', exact: true }).click(); await uncertain.waitFor({ state: 'detached' }); await notifications(page).waitFor(); await context.close();
  });
  await group('receipt-confirmed success becomes a toast, but a bulk rejection keeps fresh-preview guidance', async () => {
    const { context, page } = await notificationScene(); await page.getByRole('button', { name: 'Retry job', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click();
    await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click(); await notifications(page).waitFor();
    assert.match(await notifications(page).getByRole('status').innerText(), /Retry indexing job committed\. Receipt/); assert.equal(await page.locator('#notices .notice').count(), 0); assert.equal(await page.locator('output[aria-label="Delivered requests"]').textContent(), '2');
    await page.getByRole('button', { name: 'Retry bulk', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Receipt rejected', exact: true }).click();
    const guidance = page.locator('#notices .notice').filter({ hasText: 'confirms that this indexing retry was rejected' }); await guidance.waitFor(); await page.clock.runFor(10000); assert.equal(await guidance.isVisible(), true); assert.equal(await notifications(page).count(), 0); assert.equal(await page.getByRole('region', { name: 'Uncertain mutation', exact: true }).count(), 0); await context.close();
  });
  await group('typed bulk results and unrecoverable token guidance do not expire into toasts', async () => {
    const { context, page } = await notificationScene(); await page.getByRole('button', { name: 'Retry bulk', exact: true }).click(); await page.getByRole('button', { name: 'Return success', exact: true }).click();
    const bulk = page.getByRole('region', { name: 'Indexing retry result', exact: true }); await bulk.waitFor(); await page.clock.runFor(10000); assert.equal(await bulk.isVisible(), true); assert.match(await bulk.innerText(), /does not establish Complete/); assert.equal(await notifications(page).count(), 0);
    await page.getByRole('button', { name: 'Mint token', exact: true }).click(); await page.getByRole('button', { name: 'Lose acknowledgement', exact: true }).click(); await page.getByRole('button', { name: 'Look up receipt', exact: true }).click(); await page.getByRole('button', { name: 'Return token metadata', exact: true }).click();
    await page.getByRole('heading', { name: 'Token committed; secret unavailable', exact: true }).waitFor(); await page.clock.runFor(10000); assert.equal(await page.getByRole('button', { name: 'Revoke unrecoverable token', exact: true }).isVisible(), true); assert.equal(await notifications(page).count(), 0); await context.close();
  });
  assert.deepEqual(nativeDialogs, [], 'no native confirm or alert');
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
