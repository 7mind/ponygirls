import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { ChronicleFixture, api } from './fixture.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!browsers) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH to the provisioned Playwright 1.64.1 browsers; tests never download browsers.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, allowedHosts: ['chronicle.test'] }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP chronicle.test 127.0.0.1', '--no-proxy-server'] });
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const errors = [];
async function scene(configure) {
  return sceneAt(origin, true, configure);
}
async function sceneAt(sceneOrigin, waitForArchive, configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const fixture = new ChronicleFixture(); if (configure) configure(fixture); await fixture.install(page);
  await page.goto(`${sceneOrigin}/tests-browser/harness.html`);
  if (waitForArchive) await page.getByRole('heading', { name: 'Search sessions' }).waitFor();
  return { context, page, fixture };
}
async function search(page) {
  await page.keyboard.press('Control+k'); await page.getByRole('textbox', { name: 'Search conversations' }).fill('original source');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.search-hit').getByRole('heading', { name: 'Following the migration thread', exact: true }).waitFor();
}
try {
  // Regression: neutral task labels replace promotional headings and empty-state slogans.
  // Behavioral-Active Blackbox / Good Communication: rendered UI, controlled API fixture.
  {
    const { context, page } = await scene();
    await page.getByRole('heading', { name: 'Search sessions', exact: true, level: 1 }).waitFor();
    await page.getByRole('heading', { name: 'No search submitted', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'No session selected', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Chronicle home', exact: true }).textContent(), 'C·chronicle');
    assert.equal(await page.locator('footer.app-footer').innerText(), 'Chronicle');
    await page.getByRole('button', { name: 'access', exact: true }).click();
    await page.getByRole('heading', { name: 'Access management', exact: true, level: 1 }).waitFor();
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    await page.getByRole('heading', { name: 'Indexing jobs', exact: true, level: 1 }).waitFor();
    await context.close(); console.log('PASS browser: neutral task headings, empty states and branding');
  }
  // Regression: loopback HTTP is trustworthy; non-loopback HTTP is not.
  // Blackbox / Good Communication: real Chromium origin security + controlled API fixture.
  {
    const { context, page, fixture } = await sceneAt(`http://chronicle.test:${address.port}`, false, undefined);
    assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues })), { secure: false, uuid: 'undefined', random: 'function' });
    await page.locator('.connection-widget[data-state="live"]').waitFor({ timeout: 5000 });
    await search(page);
    await page.getByRole('button', { name: 'access', exact: true }).click();
    await page.getByRole('textbox', { name: 'Token name' }).fill('Private HTTP token');
    await page.getByRole('button', { name: 'Mint token ↗' }).click();
    await page.getByRole('heading', { name: 'Save your token now.' }).waitFor({ timeout: 5000 });
    assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_Hello));
    assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_MintToken));
    for (const envelope of fixture.calls) assert.match(envelope.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await context.close(); console.log('PASS browser: non-loopback insecure HTTP supports Hello, reads and mutation UUIDs without randomUUID');
  }
  const { Conversation } = await server.ssrLoadModule('/src/Conversation.tsx');
  const initialSource = renderToStaticMarkup(createElement(Conversation, { connection: {}, stats: { activeId: 1, generation: 1 }, user: new ChronicleFixture().user, sessionId: '00000000-0000-4000-8000-000000000001', select: () => {}, close: () => {}, refresh: 0, match: null }));
  assert.match(initialSource, /Rechecking source access/, 'first render must show an explicit loading state, never an empty source body');
  {
    const { context, page } = await scene();
    await search(page);
    assert.equal(await page.locator('.results-panel .section-heading [role="status"]').textContent(), '1 RANKED CANDIDATES');
    assert.match(await page.locator('.result-context').textContent(), /up to 2000 chunks/);
    assert.match(await page.locator('.result-context').textContent(), /not the archive total/);
    await page.getByRole('radio', { name: 'Lexical', exact: true }).check();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('.results-panel .section-heading [role="status"]').filter({ hasText: /^1 RESULTS$/ }).waitFor();
    assert.doesNotMatch(await page.locator('.result-context').textContent(), /not the archive total/);
    await context.close(); console.log('PASS browser: ANN candidate-window counts are distinct from exact lexical match totals');
  }
  {
    const { context, page } = await scene(fixture => {
      fixture.jobs.push(new api.JobInfo('00000000-0000-4000-8000-000000000099', fixture.jobs[0].sessionId, 1, api.JobState.Failed, 1, 'superseded-revision', 0, undefined));
    });
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    const superseded = page.locator('.job-row').filter({ hasText: 'superseded-revision' });
    await superseded.waitFor();
    assert.equal(await superseded.getByRole('button', { name: 'Retry job', exact: true }).count(), 0, 'superseded work is terminal, never presented as retryable');
    assert.equal(await page.getByRole('button', { name: 'Retry job', exact: true }).count(), 1, 'current failed jobs retain explicit retry');
    await context.close(); console.log('PASS browser: superseded revisions remain visible without an impossible retry action');
  }
  for (const transition of ['logout-bob', 'observed-bob', 'logout-alice']) {
    const { context, page, fixture } = await scene();
    const privateQuery = 'alice-private-migration-phrase';
    await page.getByRole('textbox', { name: 'Search conversations' }).fill(privateQuery);
    await page.getByRole('radio', { name: 'Semantic', exact: true }).check();
    await page.locator('.filters > summary').click();
    await page.getByLabel('Project', { exact: true }).fill('alice-private-project');
    await page.getByLabel('Git branch', { exact: true }).fill('alice-private-branch');
    await page.getByLabel('After', { exact: true }).fill('2026-10-01T10:00');
    await page.getByLabel('Before', { exact: true }).fill('2026-11-01T10:00');
    await page.getByLabel('Tags · comma-separated', { exact: true }).fill('alice-private-tag');
    await page.locator('.filters > summary').click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.locator('.search-hit').click(); await page.locator('.conversation-intro h2').waitFor();
    if (transition === 'observed-bob') {
      const beforeReconnect = fixture.searchCount; fixture.restart(); await page.waitForTimeout(500);
      await page.getByRole('textbox', { name: 'Search conversations' }).waitFor();
      assert.ok(fixture.searchCount > beforeReconnect, 'same-user reconnect must reissue its own submitted snapshot');
      assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), privateQuery);
      assert.equal(await page.getByRole('radio', { name: 'Semantic', exact: true }).isChecked(), true);
      await page.locator('.filters > summary').click();
      for (const [label, value] of [['Project', 'alice-private-project'], ['Git branch', 'alice-private-branch'], ['After', '2026-10-01T10:00'], ['Before', '2026-11-01T10:00'], ['Tags · comma-separated', 'alice-private-tag']]) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
      await page.locator('.filters > summary').click(); await page.locator('.conversation-intro h2').waitFor();
    }
    const boundary = fixture.requests.length;
    const nextUser = transition === 'logout-alice' ? 'alice' : 'bob';
    if (transition === 'observed-bob') {
      fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart();
    } else {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Login', exact: true }).fill(nextUser);
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    }
    await page.locator('.identity').getByText(nextUser, { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search conversations' }).waitFor(); await page.waitForTimeout(150);
    const after = fixture.requests.slice(boundary).filter(request => request.userId === nextUser).map(request => request.envelope.operation);
    assert.equal(after.filter(operation => operation instanceof api.Operation_Search && operation.query.query === privateQuery).length, 0, `${transition}: private prior-session query must never be reissued`);
    assert.equal(after.filter(operation => operation instanceof api.Operation_Facets && operation.filter.project === 'alice-private-project').length, 0, `${transition}: private prior-session filters must never be reissued`);
    assert.equal(after.filter(operation => operation instanceof api.Operation_GetSession).length, 0, `${transition}: prior source selection must not be read in the new account/session`);
    assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), '');
    await page.locator('.filters > summary').click();
    for (const label of ['Project', 'Git branch', 'After', 'Before', 'Tags · comma-separated']) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('radio', { name: 'Hybrid', exact: true }).isChecked(), true);
    assert.equal(await page.locator('.search-hit').count(), 0); assert.equal(await page.locator('.conversation-intro').count(), 0);
    await context.close(); console.log(`PASS browser: ${transition} clears private draft/submitted/selection before any new-session RPC`);
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.resumedSource = true; fixture.annotationCount = 45; fixture.rawDenied = false; });
    await search(page); await page.locator('.search-hit').click();
    await page.locator('#message-m1 pre').waitFor();
    assert.match(await page.locator('#message-m1 pre').textContent(), /original 猫🦄 source/, 'r1 annotation must resolve immutable r1 text, not changed HEAD r2 text with reused message ID');
    assert.ok(fixture.calls.filter(envelope => envelope.operation instanceof api.Operation_GetMessages).every(envelope => envelope.operation.view?.revision === 1 && envelope.operation.view.generationId === fixture.viewAt(1).generationId), 'every source request must carry the full generated revision/generation pin');
    await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
    await page.locator('#message-m1 mark').waitFor(); assert.equal(await page.locator('#message-m1 mark').textContent(), '猫🦄');
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    fixture.publishedRevision = 2;
    const annotationPages = page.getByRole('navigation', { name: 'Annotation pages' });
    await annotationPages.getByRole('button', { name: 'Next passages →', exact: true }).click();
    await annotationPages.getByText('21–40 / 45', { exact: true }).waitFor();
    await search(page); await page.getByText('Head r2 / index r2', { exact: true }).waitFor();
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Matching search passages' }).count(), 0, 'new search winners from revision2 must not appear in the pinned revision1 view');
    await page.getByRole('navigation', { name: 'Source message pages' }).getByRole('button', { name: 'Later →', exact: true }).click();
    await page.locator('#message-m41 pre').waitFor(); assert.match(await page.locator('#message-m41 pre').textContent(), /Synthetic source message 41/);
    await page.getByRole('button', { name: 'Request raw records' }).click();
    await page.locator('.raw-source details summary').click(); await page.locator('.raw-source pre').waitFor();
    assert.equal(await page.locator('.raw-source pre').innerText(), '{"revision":1}');
    fixture.restart(); await page.getByText('Viewing source r2', { exact: true }).waitFor();
    await page.locator('#message-m1 pre').waitFor(); assert.match(await page.locator('#message-m1 pre').textContent(), /HEAD r2 changed/);
    await context.close(); console.log('PASS browser: source/chunks/raw stay revision-pinned across publication and switch only on resync');
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.resumedSource = true; fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; fixture.rawDenied = false; });
    await search(page); await page.locator('.search-hit').click();
    await page.getByRole('button', { name: 'View latest archived revision', exact: true }).click();
    await page.getByText('Viewing source r2', { exact: true }).waitFor();
    await page.getByText('Unindexed archive view · no annotations', { exact: true }).waitFor();
    await page.locator('#message-m1 pre').waitFor(); assert.match(await page.locator('#message-m1 pre').textContent(), /HEAD r2 changed/);
    assert.equal(await page.locator('.matched-passages').count(), 0);
    assert.equal(await page.locator('.passage-list .passage').count(), 0);
    await page.getByRole('button', { name: 'Request raw records' }).click(); await page.locator('.raw-source details summary').click();
    assert.equal(await page.locator('.raw-source pre').textContent(), '{"revision":2}');
    fixture.publishedRevision = 2; await search(page);
    await page.getByText('Head r2 / index r2', { exact: true }).waitFor();
    await page.getByText('Unindexed archive view · no annotations', { exact: true }).waitFor();
    assert.equal(await page.locator('.matched-passages').count(), 0, 'same-revision search winner from another generation must not enter the archive-only view');
    assert.equal(await page.locator('.passage-list .passage').count(), 0);
    await page.getByRole('button', { name: 'Reload source snapshot ↻', exact: true }).click();
    await page.getByRole('navigation', { name: 'Annotation pages' }).getByText('1–20 / 205', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Matching search passages' }).getByRole('button', { name: /Winning passage beyond the first hundred/ }).waitFor();
    assert.equal(await page.getByText('Unindexed archive view · no annotations', { exact: true }).count(), 0);
    await context.close(); console.log('PASS browser: explicit latest archive is independent of indexing; revision/generation-mismatched winners stay hidden until explicit resync');
  }
  for (const kind of ['messages', 'chunks', 'raw']) {
    const { context, page } = await scene(fixture => {
      fixture.resumedSource = true; fixture.rawDenied = false;
      if (kind === 'messages') fixture.messageViewOverride = fixture.viewAt(2);
      if (kind === 'chunks') fixture.chunksViewOverride = fixture.viewAt(2);
      if (kind === 'raw') fixture.rawRevisionOverride = 2;
    });
    await search(page); await page.locator('.search-hit').click();
    if (kind === 'raw') await page.getByRole('button', { name: 'Request raw records' }).click();
    await page.getByRole('alert').filter({ hasText: kind === 'raw' ? 'Raw source revision changed unexpectedly' : 'Source revision or annotation generation changed unexpectedly' }).waitFor();
    assert.equal(await page.locator(kind === 'messages' ? '.original-message' : kind === 'chunks' ? '.passage-list .passage' : '.raw-source pre').count(), 0);
    await context.close(); console.log(`PASS browser: mismatched ${kind} response pin fails closed before rendering source content`);
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; });
    await search(page); await page.locator('.search-hit').click();
    const matched = page.getByRole('region', { name: 'Matching search passages' });
    await matched.getByRole('button', { name: /Winning passage beyond the first hundred/ }).waitFor({ timeout: 5000 });
    await matched.getByRole('button', { name: /Winning passage beyond the first hundred/ }).click();
    await page.locator('#message-m65 mark').waitFor();
    assert.equal(await page.locator('#message-m65 mark').textContent(), 'Synthetic');
    const pages = page.getByRole('navigation', { name: 'Annotation pages' });
    await pages.getByText('1–20 / 205', { exact: true }).waitFor();
    assert.equal(await pages.getByRole('button', { name: '← Previous passages', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.passage-list .passage').count(), 20);
    for (let pageIndex = 1; pageIndex <= 8; pageIndex++) {
      await pages.getByRole('button', { name: 'Next passages →', exact: true }).click();
      await pages.getByText(`${pageIndex * 20 + 1}–${Math.min(pageIndex * 20 + 20, 205)} / 205`, { exact: true }).waitFor();
    }
    await page.locator('.passage-list').getByRole('button', { name: /Winning passage beyond the first hundred/ }).waitFor();
    assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_GetChunks && envelope.operation.offset === 160 && envelope.operation.limit === 20), 'annotation pages must use the generated paginated operation');
    await pages.getByRole('button', { name: '← Previous passages', exact: true }).click(); await pages.getByText('141–160 / 205', { exact: true }).waitFor();
    await page.locator('.passage-list').getByRole('button', { name: /Annotated passage 141/ }).click();
    await page.locator('#message-m65 mark').waitFor();
    for (const offset of [160, 180, 200]) {
      await pages.getByRole('button', { name: 'Next passages →', exact: true }).click();
      await pages.getByText(`${offset + 1}–${Math.min(offset + 20, 205)} / 205`, { exact: true }).waitFor();
    }
    assert.equal(await page.locator('.passage-list .passage').count(), 5);
    assert.equal(await pages.getByRole('button', { name: 'Next passages →', exact: true }).isDisabled(), true);
    fixture.restart(); await pages.getByText('1–20 / 205', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Matching search passages' }).getByRole('button', { name: /Winning passage beyond the first hundred/ }).click();
    await page.locator('#message-m65 mark').waitFor();
    await context.close(); console.log('PASS browser: 205 annotations use bounded pages; off-page search winner remains navigable with original source highlighting');
  }
  const { context, page, fixture } = await scene();
  await page.keyboard.press('Control+k'); assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).evaluate(element => element === document.activeElement), true);
  await search(page);
  await page.getByRole('button', { name: /Pi.*Following the migration thread/s }).click();
  await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
  await page.locator('.transcript mark').first().waitFor();
  assert.equal(await page.locator('.transcript mark').first().textContent(), '猫🦄');
  assert.equal(await page.locator('.original-message script').count(), 0);
  await page.getByRole('button', { name: 'Request raw records' }).click();
  await page.getByRole('alert').filter({ hasText: 'Raw permission denied' }).waitFor();
  assert.equal(await page.locator('.raw-source pre').count(), 0);
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await page.getByRole('button', { name: /A passage on a later bounded source page/ }).click();
  await page.locator('#message-m65 mark').waitFor();
  assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_GetMessages && envelope.operation.offset === 0 && envelope.operation.limit === 100));
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.screenshot({ path: new URL('../test-results/archive-desktop.png', import.meta.url).pathname, fullPage: true });
  const before = fixture.searchCount; fixture.blackholeActive();
  await page.waitForFunction(() => document.querySelector('.connection-widget')?.getAttribute('data-state') === 'live');
  await page.waitForFunction(() => document.querySelectorAll('.search-hit').length === 1);
  await page.waitForTimeout(1500); assert.ok(fixture.searchCount > before, 'silent blackhole must reauthorize and refetch whole search snapshot');
  assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), 'original source');
  const beforeRestore = fixture.searchCount;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForTimeout(300); assert.ok(fixture.searchCount > beforeRestore, 'BFCache lifecycle restore must reauthorize and refetch snapshots');
  fixture.restart(); await page.waitForTimeout(900); await page.getByRole('heading', { name: 'Following the migration thread', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'access', exact: true }).click();
  await page.getByRole('textbox', { name: 'Token name' }).fill('Synthetic collector'); await page.getByRole('button', { name: 'Mint token ↗' }).click();
  await page.getByRole('heading', { name: 'Save your token now.' }).waitFor();
  assert.equal(await page.locator('.token-secret').textContent(), 'synthetic-secret-shown-once');
  await page.getByRole('button', { name: 'I have saved it · dismiss' }).click(); assert.equal(await page.locator('.token-secret').count(), 0);
  await page.getByRole('textbox', { name: 'New group name' }).fill('Synthetic group'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic group', exact: true }).waitFor();
  const owner = page.locator('.group-card').filter({ has: page.getByRole('heading', { name: 'Systems workshop' }) });
  await owner.getByRole('textbox', { name: 'Existing user ID' }).fill('carol'); await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  await page.getByRole('checkbox', { name: /I understand: joining shares ALL/ }).first().check();
  await page.getByRole('button', { name: 'Accept invitation & share' }).first().click();
  await owner.getByRole('button', { name: 'Remove', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('.group-card').filter({ has: page.getByRole('heading', { name: 'Research circle' }) }).getByRole('button', { name: 'Leave group', exact: true }).click();
  await page.locator('.group-card').filter({ has: page.getByRole('heading', { name: 'Synthetic group', exact: true }) }).getByRole('button', { name: 'Delete group', exact: true }).click();
  await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.getByRole('button', { name: 'Retry job', exact: true }).click();
  await page.getByText('◷ Queued', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'archive', exact: true }).click(); await page.getByRole('heading', { name: 'Source conversation' }).waitFor();
  assert.match(await page.locator('.source-panel').innerText(), /Following the migration thread|Rechecking source access|Source content has been cleared/, 'mobile source must show content or explicit pending/error state');
  await page.locator('.conversation-intro').getByRole('heading', { name: 'Following the migration thread' }).waitFor();
  await page.locator('.transcript .original-message pre').first().waitFor();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.screenshot({ path: new URL('../test-results/archive-mobile.png', import.meta.url).pathname, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout must not overflow');
  await context.close(); console.log('PASS browser: keyboard search, UTF-8 source navigation, bounded paging, raw denial, literal source, management forms, indexing retry, silent blackhole resync, server restart, responsive screenshots');
  for (const mode of ['unauthorized', 'version']) {
    const { context, page, fixture } = await scene(); fixture.mode = mode; fixture.restart();
    const state = mode === 'version' ? 'update-required' : 'unauthorized';
    await page.locator(`.connection-widget[data-state="${state}"]`).waitFor(); const count = fixture.sockets.length;
    await page.waitForTimeout(1200); assert.equal(fixture.sockets.length, count); assert.equal(await page.locator('.search-hit').count(), 0);
    await context.close(); console.log(`PASS browser: ${state} clears protected content and stops without loop`);
  }
  {
    const { context, page, fixture } = await scene(); fixture.mode = 'outage'; fixture.restart();
    await page.locator('.connection-widget[data-state="stopped"]').waitFor(); const count = fixture.sockets.length;
    await page.waitForTimeout(1000); assert.equal(fixture.sockets.length, count);
    fixture.mode = 'normal'; await page.getByLabel('Connection: stopped').click(); await page.getByRole('button', { name: 'Try again manually' }).click();
    await page.locator('.connection-widget[data-state="live"]').waitFor();
    await page.evaluate(() => { document.dispatchEvent(new Event('resume')); }); await page.waitForTimeout(300);
    assert.ok(fixture.sockets.length > count); await context.close(); console.log('PASS browser: finite retries → stopped → manual recovery; resume replacement');
  }
  {
    const { context, page, fixture } = await scene(); fixture.mintUncertain = true;
    await page.getByRole('button', { name: 'access', exact: true }).click(); await page.getByRole('textbox', { name: 'Token name' }).fill('Uncertain collector'); await page.getByRole('button', { name: 'Mint token ↗' }).click();
    await page.getByRole('heading', { name: 'Confirm before repeating' }).waitFor();
    await page.getByRole('button', { name: 'Look up receipt' }).click();
    await page.getByRole('heading', { name: 'Token committed; secret unavailable' }).waitFor();
    assert.equal(fixture.calls.filter(envelope => envelope.operation instanceof api.Operation_MintToken).length, 1);
    assert.equal(await page.locator('.token-secret').count(), 0);
    await page.getByRole('button', { name: 'Revoke unrecoverable token', exact: true }).click(); await page.getByText('Revoked', { exact: true }).waitFor();
    await context.close(); console.log('PASS browser: uncertain token mint never replayed, receipt resolved, lost secret requires revoke/remint');
  }
  {
    const context = await browser.newContext(); const page = await context.newPage();
    const fixture = new ChronicleFixture(); fixture.signedIn = false; await fixture.install(page);
    await page.goto(`${origin}/tests-browser/harness.html`);
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByRole('heading', { name: 'Archive', exact: true, level: 1 }).waitFor();
    assert.deepEqual(await page.locator('.login-story p').allTextContents(), ['Search archived agent sessions and read their source messages.']);
    await page.getByRole('textbox', { name: 'Login', exact: true }).fill('alice');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    await page.getByRole('heading', { name: 'Search sessions' }).waitFor();
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'chronicle_session' && cookie.httpOnly));
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    fixture.dropLogout = true; await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Confirm before repeating' }).waitFor({ timeout: 5000 });
    await context.close(); console.log('PASS browser: generated HTTP login uses only cookie; uncertain logout is visible outside management tabs');
  }
  {
    const { context, page, fixture } = await scene(); fixture.mintUncertain = true;
    await page.getByRole('button', { name: 'access', exact: true }).click();
    await page.getByRole('textbox', { name: 'Token name' }).fill('Private token metadata');
    await page.getByRole('button', { name: 'Mint token ↗' }).click();
    await page.getByRole('heading', { name: 'Confirm before repeating' }).waitFor();
    await page.getByRole('button', { name: 'Look up receipt' }).click();
    await page.getByRole('heading', { name: 'Token committed; secret unavailable' }).waitFor();
    fixture.mode = 'unauthorized'; fixture.restart();
    await page.locator('.connection-widget[data-state="unauthorized"]').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Token committed; secret unavailable' }).count(), 0, 'forbidden token metadata must not remain visible after auth denial');
    await context.close(); console.log('PASS browser: auth denial also hides token-recovery metadata');
  }
  assert.deepEqual(errors, [], 'no uncaught browser application errors');
} finally { await browser.close(); await server.close(); }
