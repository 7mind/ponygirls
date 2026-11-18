import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api, NOW } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set provisioned PLAYWRIGHT_BROWSERS_PATH; no downloads.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const address = server.httpServer.address(); if (address === null || typeof address === 'string') throw new Error('Missing synthetic origin');
const browser = await chromium.launch({ headless: true }), errors = [];
async function scene(configure, viewport, deviceScaleFactor) {
  const context = await browser.newContext({ viewport: viewport === undefined ? { width: 1440, height: 1000 } : viewport, deviceScaleFactor: deviceScaleFactor === undefined ? 1 : deviceScaleFactor }), page = await context.newPage(), fixture = new Goal50Fixture();
  page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); if (configure !== undefined) configure(fixture);
  await page.clock.install(); await fixture.install(page); await page.goto(`http://127.0.0.1:${address.port}/tests-browser/goal50.html`); await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();  await page.locator('.archive-row').first().waitFor(); return { context, page, fixture };
}
async function group(name, body) { if (process.env.CHRONICLE_GOAL50_CASE !== undefined && !name.includes(process.env.CHRONICLE_GOAL50_CASE)) return; await body(); console.log(`PASS browser goal50: ${name}`); }
async function caret(input, position) { await input.evaluate((element, offset) => element.setSelectionRange(offset, offset), position); await input.press('ArrowLeft'); await input.press('ArrowRight'); }
try {
  // Specified: Behavioral-Active Blackbox / Good Communication. Navigation identifies
  // each tab; reference copy stays optional without hiding task or safety controls.
  await group('tab content omits generic banners and retains actionable controls', async () => {
    const { context, page, fixture } = await scene();
    const banned = /Search updates after you pause|Enter searches now|Edits clear results|Semantic and hybrid text searches use query embeddings|The same conversation expression language as Archive|Manage agent tokens and sharing groups|Each explicit Run starts empty model history|Maximum context, source, result, trace and execution limits are declared above|Controls and run identity survive navigation in this tab|Owner-only, all non-tombstone source HEADs/;
    for (const [tab, label] of [['Archive', 'Archive'], ['Search', 'Search']]) {
      await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: tab, exact: true }).click();
      const main = page.getByRole('main');
      assert.doesNotMatch(await main.innerText(), banned, `${tab}: no generic tutorial banner`);
      assert.equal(await main.locator('h1:visible').count(), 0, `${tab}: navigation already names the tab`);
      await page.getByRole('main', { name: label, exact: true }).waitFor();
      if (tab === 'Archive' || tab === 'Search') {
        assert.equal(await main.getByRole('combobox', { name: 'Search conversations', exact: true }).isVisible(), true);
        assert.equal(await main.getByRole('button', { name: 'Search', exact: true }).isEnabled(), true);
        await main.getByRole('button', { name: 'Search syntax', exact: true }).click();
        await main.getByText('mode:lexical', { exact: true }).first().waitFor();
        await page.keyboard.press('Escape');
      }
    }
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_StartMcpTest || call.operation instanceof api.Operation_MintToken || call.operation instanceof api.Operation_ApplyOwnerReindex || call.operation instanceof api.Operation_ApplyRetryFailed).length, 0, 'Reading optional help never executes a task');
    await context.close();
  });
  await group('controlled completion preserves Unicode/midtoken/escaped outside text and changes only the draft', async () => {
    const expression = '猫🦄 AND project:old OR tag:"retained\\:value"', replacement = '"new\\\\path\\\"quoted"', start = expression.indexOf('old'), end = start + 3;
    const { context, page, fixture } = await scene(fixture => { fixture.hintResult = () => new api.ExpressionHintsResult('server-hash', NOW, start, end, [new api.ExpressionHint(api.ExpressionHintKind.Value, 'Exact authorized literal', replacement, replacement.length)], false); });
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = fixture.searchCount;
    await input.fill(expression); await caret(input, start + 1); await page.clock.runFor(200); await page.getByRole('option', { name: /Exact authorized literal/ }).waitFor();
    const query = fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).at(-1).operation.query; assert.equal(query.caretUtf16, start + 1); assert.equal(query.target instanceof api.ExpressionHintTarget_Archive, true);
    await input.press('Enter'); assert.equal(await input.inputValue(), expression.slice(0, start) + replacement + expression.slice(end)); assert.equal(fixture.searchCount, before); assert.equal(await input.evaluate(element => element === document.activeElement), true); assert.equal(await input.evaluate(element => element.selectionStart), start + replacement.length);
    assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_Search), false); await context.close();
  });
  await group('one completion in flight coalesces latest draft and rejects stale responses, with no keystroke searches', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.holdHints = true; fixture.hintResult = query => new api.ExpressionHintsResult('hash', NOW, 0, query.expression.length, [new api.ExpressionHint(api.ExpressionHintKind.Field, `For ${query.expression}`, 'project:', 8)], false); });
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }), before = fixture.searchCount;
    await input.fill('old'); await page.clock.runFor(200); await fixture.waitCall(api.Operation_ExpressionHints, 1); await input.fill('newer'); await input.fill('latest'); await page.clock.runFor(200); assert.equal(fixture.hintPending.length, 1);
    fixture.hintPending.shift()(); await fixture.waitCall(api.Operation_ExpressionHints, 2); assert.equal(await page.getByRole('listbox').count(), 0); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).at(-1).operation.query.expression, 'latest');
    fixture.hintPending.shift()(); await page.getByRole('option', { name: /For latest/ }).waitFor(); assert.equal(fixture.searchCount, before); await context.close();
  });
  await group('completion keyboard arrows Escape normal Tab IME and scalar-safe selection', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.hintResult = query => new api.ExpressionHintsResult('hash', NOW, 0, query.expression.length, ['one', 'two'].map(label => new api.ExpressionHint(api.ExpressionHintKind.Field, label, `${label}:`, 4)), false); });
    const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await input.fill('p'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); await input.press('ArrowDown'); await input.press('Enter'); assert.equal(await input.inputValue(), 'two:');
    await input.fill('q'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); await input.press('Escape'); assert.equal(await page.getByRole('listbox').count(), 0); assert.equal(await input.inputValue(), 'q');
    await input.fill('r'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); await input.press('Tab'); assert.equal(await input.inputValue(), 'r'); assert.equal(await page.getByRole('button', { name: 'Clear Search conversations', exact: true }).evaluate(element => element === document.activeElement), true);
    await input.focus(); await input.dispatchEvent('compositionstart'); await input.fill('猫'); const before = fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).length; await page.clock.runFor(220); assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).length, before); await input.press('Enter'); assert.equal(fixture.searchCount, 1, 'IME Enter does not submit');
    await input.dispatchEvent('compositionend'); await page.clock.runFor(220); await fixture.waitCall(api.Operation_ExpressionHints, before + 1);
    await input.fill('🦄'); await input.evaluate(element => { element.setSelectionRange(1, 1); element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })); }); await page.clock.runFor(220); assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_ExpressionHints).every(call => call.operation.query.expression !== '🦄' || call.operation.query.caretUtf16 !== 1)); await context.close();
  });
  });
  await group('320px light/dark and zoom keep autocomplete surfaces inside viewport', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const { context, page } = await scene(undefined, { width: 320, height: 844 }); await page.emulateMedia({ colorScheme }); const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await input.fill('p'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); let bounds = await page.getByRole('listbox').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320); await input.press('Escape'); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 640, height: 1000 }); await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); const metrics = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth, main: document.querySelector('main').getBoundingClientRect().toJSON(), zoom: getComputedStyle(document.documentElement).zoom })); assert.ok(metrics.document <= metrics.viewport, JSON.stringify(metrics)); await page.getByRole('link', { name: 'Archive', exact: true }).click(); await page.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('zoom'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); bounds = await page.getByRole('listbox').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 640); await context.close();
    }
  });
  await group('account/security changes erase old completion and usage bodies and reject late old-owner hints', async () => {
    const { context, page, fixture } = await scene(fixture => { fixture.holdHints = true; }); const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await input.fill('private-owner-draft'); await page.clock.runFor(200); await fixture.waitCall(api.Operation_ExpressionHints, 1); const old = fixture.hintPending.shift(); fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart(); await page.getByRole('combobox', { name: 'Search conversations', exact: true }).filter({ hasText: '' }).waitFor(); old(); assert.equal(await page.getByRole('listbox').count(), 0); await page.waitForFunction(() => document.querySelector('input[aria-label="Search conversations"]').value === ''); await context.close();
  });
  await group('regression same-text completion applies caret immediately without leaking the command into later typing', async () => {
    const { context, page } = await scene(fixture => { fixture.hintResult = () => new api.ExpressionHintsResult('hash', NOW, 0, 8, [new api.ExpressionHint(api.ExpressionHintKind.Field, 'project:', 'project:', 8)], false); }); const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }); await input.fill('project:'); await caret(input, 3); await page.clock.runFor(200); await page.getByRole('option', { name: /project:/ }).waitFor(); await input.press('Enter'); assert.equal(await input.evaluate(element => element.selectionStart), 8); await input.press('X'); assert.equal(await input.inputValue(), 'project:X'); assert.equal(await input.evaluate(element => element.selectionStart), 9); await context.close();
  });
  await group('inline field shortcuts focus the single authoritative completion input with unique linked IDs', async () => {
    const { context, page, fixture } = await scene(); const before = fixture.searchCount; await page.getByRole('button', { name: 'Add Project filter', exact: true }).click(); const input = page.getByRole('combobox', { name: 'Search conversations', exact: true }); assert.equal(await input.inputValue(), 'project:'); await page.clock.runFor(200); await page.getByRole('listbox').waitFor(); const linked = await input.evaluate(element => ({ id: element.getAttribute('aria-controls'), matching: document.querySelectorAll(`[id="${element.getAttribute('aria-controls')}"]`).length, focused: element === document.activeElement })); assert.equal(linked.matching, 1); assert.equal(linked.focused, true); assert.equal(fixture.searchCount, before); await context.close();
  });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
