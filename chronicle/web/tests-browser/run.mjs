import assert from 'node:assert/strict';
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
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, allowedHosts: ['chronicle.test'], watch: null }, logLevel: 'error' });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP chronicle.test 127.0.0.1', '--no-proxy-server'] });
const errors = [];
async function scene(configure) {
  return sceneAt(origin, true, configure);
}
async function sceneAt(sceneOrigin, waitForArchive, configure) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  const page = await context.newPage(); page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message));
  const fixture = new ChronicleFixture(); if (configure) configure(fixture); await fixture.install(page);
  await page.goto(`${sceneOrigin}/tests-browser/harness.html`);
  if (waitForArchive) await archiveReady(page);
  return { context, page, fixture };
}
async function archiveReady(page) {
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-table[aria-busy="false"]').waitFor();
  await page.locator('.archive-row .table-title').first().waitFor();
}
async function submitExpression(page, expression) {
  await page.getByRole('textbox', { name: 'Search conversations' }).fill(expression);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await archiveReady(page);
}
async function search(page) {
  await page.keyboard.press('Control+k');
  await submitExpression(page, '(original source) mode:hybrid');
}
async function openConversation(page) {
  await page.locator('.archive-row .table-title').first().click();
  await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor();
  await page.locator('.conversation-intro h2').waitFor();
}
async function closeConversation(page) {
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor({ state: 'detached' });
}
async function scrollEnd(page, selector) {
  await page.locator(selector).evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
}
async function refreshArchive(page) {
  // Invoke the polling-path refresh without pretending the modal's inert background is pointer-accessible.
  await page.locator('button[aria-label="Refresh archive"]').evaluate(button => button.click());
  await page.locator('.archive-table[aria-busy="false"]').waitFor();
}
async function loadPassages(page, count) {
  await page.waitForFunction(() => document.querySelectorAll('.passage-list .passage').length > 0);
  while (await page.locator('.passage-list .passage').count() < count) {
    const before = await page.locator('.passage-list .passage').count();
    await scrollEnd(page, '.conversation-passages');
    await page.waitForFunction(previous => document.querySelectorAll('.passage-list .passage').length > previous, before);
  }
}
async function waitForCalls(fixture, predicate, count) {
  const deadline = Date.now() + 10_000;
  while (fixture.calls.filter(predicate).length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fixture.calls.filter(predicate).length >= count, 'expected generated API operation was not observed');
}
try {
  // Regression: neutral task labels replace promotional headings and empty-state slogans.
  // Behavioral-Active Blackbox / Good Communication: rendered UI, controlled API fixture.
  {
    const { context, page } = await scene();
    await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
    await page.locator('.archive-row .table-title').getByText('Following the migration thread', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), '');
    assert.equal(await page.getByRole('dialog').count(), 0, 'the default archive is browsable without an unsolicited source modal');
    assert.equal(await page.getByRole('heading', { name: /Search sessions|No search submitted|No session selected/ }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Chronicle home', exact: true }).textContent(), 'C·chronicle');
    assert.equal(await page.locator('footer.app-footer').innerText(), 'Chronicle');
    await page.getByRole('button', { name: 'access', exact: true }).click();
    await page.getByRole('heading', { name: 'Access management', exact: true, level: 1 }).waitFor();
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    await page.getByRole('heading', { name: 'Ingestion activity', exact: true, level: 1 }).waitFor();
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
  // Specified: Blackbox / Good Communication, real UI + generated codecs with a controlled owner-scoped API.
  {
    const { context, page, fixture } = await scene(fixture => {
      fixture.staticTokens = [new api.TokenInfo('00000000-0000-4000-8000-000000000088', 'Configured collector', [api.Scope.Ingest], '2026-10-24T00:00:00Z', false)];
      fixture.tokens = [new api.TokenInfo('00000000-0000-4000-8000-000000000089', 'Issued collector', [api.Scope.Ingest], '2026-10-24T00:00:00Z', false)];
    });
    await page.getByRole('button', { name: 'access', exact: true }).click();
    const configured = page.locator('.token-row').filter({ hasText: 'Configured collector' });
    await configured.getByText('StaticConfig', { exact: true }).waitFor();
    assert.match(await configured.innerText(), /read only/);
    assert.equal(await configured.locator('button, input, textarea').count(), 0);
    assert.equal(await page.locator('.token-secret').count(), 0);
    const issued = page.locator('.token-row').filter({ hasText: 'Issued collector' });
    await issued.getByText('Issued', { exact: true }).waitFor();
    await issued.getByRole('button', { name: 'Revoke', exact: true }).click();
    await issued.getByText('Revoked', { exact: true }).waitFor();
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_RevokeToken).length, 1);
    await context.close(); console.log('PASS browser: static token metadata has no secret or modification controls; issued revoke preserved');
  }
  {
    const report = new api.CollectorProgressUpdate('alice-private-collector', 9007199254740993n, '00000000-0000-4000-8000-000000000090', api.CollectorPhase.Discovering, '2026-10-26T01:00:00Z', new api.CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, undefined);
    const { context, page, fixture } = await scene(fixture => {
      fixture.collectors = [new api.CollectorStatus(report, '2026-10-26T01:01:00Z', false)];
      fixture.jobs.push(fixture.jobs[0].with({ id: '00000000-0000-4000-8000-000000000091', state: api.JobState.Running, error: undefined, completedWindows: 2, totalWindows: 3 }));
    });
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    const collection = page.getByRole('region', { name: 'Collectors', exact: true });
    const collector = page.locator('.activity-collector-row').filter({ has: page.locator('td[data-column="CollectorId"]').getByText('alice-private-collector', { exact: true }) });
    await collector.locator('.activity-row-details > summary').click();
    await collector.getByText('Discovering · Recent report', { exact: true }).waitFor();
    for (const summary of await page.locator('.activity-job-row .activity-row-details > summary').all()) await summary.click();
    await collector.getByText('Per-run collector counters', { exact: true }).click();
    assert.match(await collector.innerText(), /sequence 9007199254740993/);
    assert.match(await collector.innerText(), /Scanned \/ discovered sessions\n0 \/ 0/);
    await page.getByText('0 / unknown windows processed · job not Complete at this snapshot', { exact: true }).waitFor();
    await page.getByText('2 / 3 windows processed · job not Complete at this snapshot', { exact: true }).waitFor();
    fixture.jobs = fixture.jobs.map(job => job.state === api.JobState.Running ? job.with({ completedWindows: 3, totalWindows: 3 }) : job);
    await page.getByText('3 / 3 windows processed · job not Complete at this snapshot', { exact: true }).waitFor({ timeout: 7000 });
    fixture.jobs = fixture.jobs.map(job => job.state === api.JobState.Running ? job.with({ state: api.JobState.Complete }) : job);
    await page.getByText('3 / 3 windows processed · job complete', { exact: true }).waitFor({ timeout: 7000 });
    const scanning = report.with({ phase: api.CollectorPhase.Scanning, sequence: report.sequence + 1n, counters: report.counters.with({ discovered: 12, scanned: 7, waiting: 2, pending: 4, quarantined: 1, stopped: 1, conflicts: 1, uploadFailures: 2, scannedBytes: 9007199254740995n }) });
    fixture.collectors = [new api.CollectorStatus(scanning, '2026-10-26T01:02:00Z', false)];
    await collector.getByText('Scanning · Recent report', { exact: true }).waitFor({ timeout: 7000 });
    assert.match(await collector.innerText(), /7 \/ 12/);
    assert.match(await collector.innerText(), /9007199254740995 bytes/);
    for (const [label, value] of [['Waiting for quiet', '2'], ['Pending upload queue', '4'], ['Quarantined', '1'], ['Stopped', '1'], ['Conflicts', '1'], ['Upload failures', '2']]) {
      assert.equal(await collector.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText(), value);
    }
    const uploading = scanning.with({ phase: api.CollectorPhase.Uploading, sequence: scanning.sequence + 1n, counters: scanning.counters.with({ enqueued: 2, uploaded: 4 }), totalUploadBytes: 9007199254740999n, uploadedBytes: 9007199254740997n, currentUploadTotalBytes: 4096n });
    fixture.collectors = [new api.CollectorStatus(uploading, '2026-10-26T01:03:00Z', false)];
    await collector.getByText('Uploading · Recent report', { exact: true }).waitFor({ timeout: 7000 });
    assert.match(await collector.innerText(), /9007199254740997 bytes \/ 9007199254740999 bytes/);
    assert.match(await collector.innerText(), /Current payload size \(not acknowledged progress\)\n4096 bytes/);
    assert.doesNotMatch(await collector.innerText(), /%/);
    fixture.collectors = [new api.CollectorStatus(uploading.with({ sequence: uploading.sequence + 1n, currentUploadTotalBytes: undefined }), '2026-10-26T01:04:00Z', false)];
    await collector.getByText('unknown', { exact: true }).waitFor({ timeout: 7000 });
    fixture.collectors = [new api.CollectorStatus(uploading.with({ phase: api.CollectorPhase.Idle, sequence: uploading.sequence + 2n }), '2026-10-26T01:05:00Z', false)];
    await collector.getByText('Idle · Recent report', { exact: true }).waitFor({ timeout: 7000 });
    assert.equal(await collector.getByText('Current payload size (not acknowledged progress)', { exact: true }).count(), 0);
    fixture.collectors = [new api.CollectorStatus(uploading.with({ phase: api.CollectorPhase.Failed, sequence: uploading.sequence + 3n, error: 'progress-upload-failed' }), '2026-10-26T01:06:00Z', true)];
    await collector.getByText('Failed · Stale report (>120s)', { exact: true }).waitFor({ timeout: 7000 });
    await collector.getByText('Collector error: progress-upload-failed', { exact: true }).waitFor();
    assert.match(await collector.innerText(), /Last known snapshot only; current collection progress is unknown/);
    await page.locator('.activity-about > summary').click();
    assert.match(await page.locator('.activity-about-content').innerText(), /not collector or worker health/);
    await page.locator('.activity-about > summary').click();
    fixture.collectionDenied = true;
    await page.getByRole('button', { name: 'Refresh snapshots ↻' }).click();
    await page.getByRole('alert').filter({ hasText: 'Collection status denied' }).waitFor();
    assert.equal(await collection.getByText('alice-private-collector', { exact: true }).count(), 0);
    fixture.collectionDenied = false;
    await page.getByRole('button', { name: 'Refresh snapshots ↻' }).click();
    await collector.locator('td[data-column="CollectorId"]').getByText('alice-private-collector', { exact: true }).waitFor();
    fixture.mode = 'outage'; fixture.restart();
    await collector.waitFor({ state: 'detached', timeout: 5000 });
    fixture.collectors = []; fixture.activityCollectors = []; fixture.activityJobs = [];
    fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read]); fixture.mode = 'normal'; fixture.restart();
    await page.locator('.connection-widget[data-state="live"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    await page.getByRole('heading', { name: 'No matching collectors', exact: true }).waitFor();
    assert.equal(await page.getByText('alice-private-collector', { exact: true }).count(), 0);
    assert.match(await page.getByRole('region', { name: 'Collectors', exact: true }).innerText(), /Collection configuration and progress remain unknown/);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_Activity));
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_ActivityJobs));
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_CollectionStatus || call.operation instanceof api.Operation_IngestStatus).length, 0);
    await context.close(); console.log('PASS browser: 1.3 collector snapshots poll through discovery, scan, ACK upload, idle, failed/stale; authorization, disconnect and account changes clear progress');
  }
  const { Conversation } = await server.ssrLoadModule('/src/Conversation.tsx');
  const initialSource = renderToStaticMarkup(createElement(Conversation, { connection: {}, stats: { activeId: 1, generation: 1 }, user: new ChronicleFixture().user, sessionId: '00000000-0000-4000-8000-000000000001', initialView: undefined, archiveHead: null, select: () => {}, refresh: 0 }));
  assert.match(initialSource, /Rechecking source access/, 'first render must show an explicit loading state, never an empty source body');
  {
    const { context, page, fixture } = await scene();
    await search(page);
    assert.equal(await page.locator('.archive-context [role="status"]').textContent(), '1 conversations · 1 shown');
    await page.locator('.expression-help > summary').click();
    await page.getByText(/This result uses up to 1000 authorized published chunks per distinct text operand/).waitFor();
    assert.match(await page.locator('.expression-help-content').textContent(), /not a row limit.*total is exact under those bounded candidate sets/);
    await submitExpression(page, '(original source) mode:lexical');
    assert.equal(await page.locator('.archive-context [role="status"]').textContent(), '1 conversations · 1 shown');
    assert.equal(await page.getByText(/This result uses up to/).count(), 0);
    assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Search).length, 0, 'archive expressions must not fall back to the legacy search API');
    await context.close(); console.log('PASS browser: ANN candidate-window counts are distinct from exact lexical match totals');
  }
  {
    const { context, page } = await scene(fixture => {
      fixture.jobs.push(new api.JobInfo('00000000-0000-4000-8000-000000000099', fixture.jobs[0].sessionId, 1, api.JobState.Failed, 1, 'superseded-revision', 0, undefined));
    });
    await page.getByRole('button', { name: 'activity', exact: true }).click();
    await page.getByRole('button', { name: 'Retry indexing', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 1, 'current failed jobs retain explicit retry');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const superseded = page.locator('.activity-job-row').filter({ hasText: 'superseded-revision' });
    await superseded.waitFor();
    assert.equal(await superseded.getByRole('button', { name: 'Retry indexing', exact: true }).count(), 0, 'superseded work is terminal, never presented as retryable');
    await superseded.locator('.activity-row-details > summary').click();
    await superseded.getByText('Historical job · not actionable here. This does not describe the current published view.', { exact: true }).waitFor();
    await context.close(); console.log('PASS browser: superseded revisions remain visible in History without an impossible retry action');
  }
  for (const transition of ['logout-bob', 'observed-bob', 'logout-alice']) {
    const { context, page, fixture } = await scene();
    const privateQuery = '(alice-private-migration-phrase) AND project:"alice-private-project" AND branch:"alice-private-branch" AND after:"2026-10-01T10:00:00Z" AND before:"2026-11-01T10:00:00Z" AND tag:"alice-private-tag" mode:semantic';
    const privateDraft = `${privateQuery} AND producer:"alice-private-draft"`;
    await submitExpression(page, privateQuery);
    await page.getByRole('textbox', { name: 'Search conversations' }).fill(privateDraft);
    await openConversation(page);
    if (transition === 'observed-bob') {
      const beforeReconnect = fixture.searchCount; fixture.restart();
      await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeReconnect + 1);
      await page.locator('.conversation-intro h2').waitFor();
      assert.equal(await page.locator('.search-form input').inputValue(), privateDraft, 'same-user reconnect preserves the unsubmitted expression draft');
      assert.equal(fixture.calls.filter(call => call.operation instanceof api.Operation_Archive).at(-1).operation.query.expression, privateQuery, 'same-user reconnect reissues the submitted expression, not its later draft');
    }
    const boundary = fixture.requests.length;
    const nextUser = transition === 'logout-alice' ? 'alice' : 'bob';
    if (transition === 'observed-bob') {
      fixture.user = new api.UserInfo('bob', 'bob', [api.Scope.Read, api.Scope.Raw]); fixture.restart();
    } else {
      await closeConversation(page);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Login', exact: true }).fill(nextUser);
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
      await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    }
    await page.locator('.identity').getByText(nextUser, { exact: true }).waitFor();
    await archiveReady(page); await page.waitForTimeout(150);
    const after = fixture.requests.slice(boundary).filter(request => request.userId === nextUser).map(request => request.envelope.operation);
    assert.ok(after.some(operation => operation instanceof api.Operation_Archive), `${transition}: the new account receives its own default archive`);
    assert.equal(after.filter(operation => operation instanceof api.Operation_Archive && operation.query.expression !== '').length, 0, `${transition}: prior-session text and metadata must never be reissued`);
    assert.equal(after.filter(operation => operation instanceof api.Operation_GetSession).length, 0, `${transition}: prior source selection must not be read in the new account/session`);
    assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), '');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.conversation-intro').count(), 0);
    await context.close(); console.log(`PASS browser: ${transition} clears private expression draft/submitted/selection before any new-session RPC`);
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.resumedSource = true; fixture.annotationCount = 45; fixture.rawDenied = false; });
    await search(page); await openConversation(page);
    await page.locator('#message-m1 pre').waitFor();
    assert.match(await page.locator('#message-m1 pre').textContent(), /original 猫🦄 source/, 'r1 annotation must resolve immutable r1 text, not changed HEAD r2 text with reused message ID');
    assert.ok(fixture.calls.filter(envelope => envelope.operation instanceof api.Operation_GetMessages).every(envelope => envelope.operation.view.revision === 1 && envelope.operation.view.generationId === fixture.viewAt(1).generationId), 'every source request must carry the full generated revision/generation pin');
    await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
    await page.locator('#message-m1 mark').waitFor(); assert.equal(await page.locator('#message-m1 mark').textContent(), '猫🦄');
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    fixture.publishedRevision = 2;
    await loadPassages(page, 45);
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetChunks && call.operation.offset === 40 && call.operation.view.generationId === fixture.viewAt(1).generationId));
    await refreshArchive(page);
    await page.getByText('HEAD r2 / index r2', { exact: true }).waitFor();
    await page.getByText('Viewing source r1', { exact: true }).waitFor();
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetChunks).every(call => call.operation.view.revision === 1 && call.operation.view.generationId === fixture.viewAt(1).generationId), 'publication must not substitute another generation into the pinned annotation list');
    await scrollEnd(page, '.conversation-source');
    await page.locator('#message-m41 pre').waitFor(); assert.match(await page.locator('#message-m41 pre').textContent(), /Synthetic source message 41/);
    await page.getByRole('button', { name: 'Request raw records' }).click();
    await page.locator('.raw-source details summary').click(); await page.locator('.raw-source pre').waitFor();
    assert.equal(await page.locator('.raw-source pre').innerText(), '{"revision":1}');
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetRaw).every(call => call.operation.revision === 1));
    fixture.restart(); await page.getByText('Viewing source r2', { exact: true }).waitFor();
    await page.locator('#message-m1 pre').waitFor(); assert.match(await page.locator('#message-m1 pre').textContent(), /HEAD r2 changed/);
    await context.close(); console.log('PASS browser: source/chunks/raw stay revision/generation-pinned across publication; reconnect reauthorizes the current selected snapshot');
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.resumedSource = true; fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; fixture.rawDenied = false; });
    await search(page); await openConversation(page);
    await page.getByRole('button', { name: 'View latest archived revision', exact: true }).click();
    await page.getByText('Viewing source r2', { exact: true }).waitFor();
    await page.getByText('Archive-only view · no annotations', { exact: true }).waitFor();
    await page.locator('#message-m1 pre').waitFor(); assert.match(await page.locator('#message-m1 pre').textContent(), /HEAD r2 changed/);
    assert.equal(await page.locator('.passage-list .passage').count(), 0);
    await page.getByRole('button', { name: 'Request raw records' }).click(); await page.locator('.raw-source details summary').click();
    assert.equal(await page.locator('.raw-source pre').textContent(), '{"revision":2}');
    fixture.publishedRevision = 2; await refreshArchive(page);
    await page.getByText('HEAD r2 / index r2', { exact: true }).waitFor();
    await page.getByText('Archive-only view · no annotations', { exact: true }).waitFor();
    assert.equal(await page.locator('.passage-list .passage').count(), 0, 'same-revision annotations from a published generation must not enter the archive-only view');
    await page.getByRole('button', { name: 'Reload source snapshot ↻', exact: true }).click();
    await loadPassages(page, 200);
    await page.locator('.passage-list').getByRole('button', { name: /Winning passage beyond the first hundred/ }).waitFor();
    assert.equal(await page.getByText('Archive-only view · no annotations', { exact: true }).count(), 0);
    const latestChunks = fixture.calls.filter(call => call.operation instanceof api.Operation_GetChunks).at(-1).operation;
    assert.equal(latestChunks.view.generationId, fixture.viewAt(2).generationId);
    await context.close(); console.log('PASS browser: explicit latest archive is independent of indexing; generation-mismatched annotations stay hidden until explicit resync');
  }
  for (const kind of ['messages', 'chunks', 'raw']) {
    const { context, page } = await scene(fixture => {
      fixture.resumedSource = true; fixture.rawDenied = false;
      if (kind === 'messages') fixture.messageViewOverride = fixture.viewAt(2);
      if (kind === 'chunks') fixture.chunksViewOverride = fixture.viewAt(2);
      if (kind === 'raw') fixture.rawRevisionOverride = 2;
    });
    await search(page); await openConversation(page);
    if (kind === 'raw') await page.getByRole('button', { name: 'Request raw records' }).click();
    await page.getByRole('alert').filter({ hasText: kind === 'raw' ? 'Raw source revision changed unexpectedly' : 'Source revision or annotation generation changed unexpectedly' }).waitFor();
    assert.equal(await page.locator(kind === 'messages' ? '.original-message' : kind === 'chunks' ? '.passage-list .passage' : '.raw-source pre').count(), 0);
    await context.close(); console.log(`PASS browser: mismatched ${kind} response pin fails closed before rendering source content`);
  }
  {
    const { context, page, fixture } = await scene(fixture => { fixture.annotationCount = 205; fixture.winnerBeyondFirstPage = true; });
    await search(page); await openConversation(page);
    await loadPassages(page, 40);
    assert.equal(await page.locator('.passage-list .passage').count(), 40);
    await loadPassages(page, 200);
    const winner = page.locator('.passage-list').getByRole('button', { name: /Winning passage beyond the first hundred/ });
    await winner.click();
    await page.locator('#message-m65 mark').waitFor();
    assert.equal(await page.locator('#message-m65 mark').textContent(), 'Synthetic');
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_GetChunks && call.operation.offset === 160 && call.operation.limit === 40), 'infinite annotations must use bounded generated pages');
    assert.ok(fixture.calls.some(call => call.operation instanceof api.Operation_LocateMessage && call.operation.messageId === 'm65'), 'off-page navigation uses the generated locator, not a source scan');
    assert.ok(fixture.calls.filter(call => call.operation instanceof api.Operation_GetMessages).every(call => call.operation.limit === 40));
    await page.locator('.passage-list').getByRole('button', { name: /Annotated passage 141\./ }).click();
    await page.locator('#message-m65 mark').waitFor();
    await loadPassages(page, 205);
    assert.equal(await page.locator('.passage-list .passage').count(), 205);
    await scrollEnd(page, '.conversation-passages'); await page.waitForTimeout(200);
    const pages = fixture.calls.filter(call => call.operation instanceof api.Operation_GetChunks).map(call => call.operation.offset);
    assert.deepEqual(pages, [0, 40, 80, 120, 160, 200]);
    assert.equal(await page.getByRole('button', { name: /Next passages|Previous passages/ }).count(), 0, 'scrolling replaces manual pagination without dropping annotation reachability');
    fixture.restart(); await loadPassages(page, 40);
    assert.equal(await page.locator('.passage-list .passage').count(), 40, 'a new authorization generation starts from a fresh bounded annotation page');
    await loadPassages(page, 200);
    await winner.click(); await page.locator('#message-m65 mark').waitFor();
    await context.close(); console.log('PASS browser: all 205 annotations are scroll-reachable in bounded pages; late winner navigates with a pinned locator and original source highlighting');
  }
  const { context, page, fixture } = await scene();
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(shortcut);
    assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).evaluate(element => element === document.activeElement), true);
  }
  await search(page); await openConversation(page);
  await page.locator('.passage-list').getByRole('button', { name: /Keep original source independent/ }).click();
  await page.locator('.transcript mark').first().waitFor();
  assert.equal(await page.locator('.transcript mark').first().textContent(), '猫🦄');
  assert.equal(await page.locator('.original-message script').count(), 0);
  assert.match(await page.locator('#message-m2 pre').textContent(), /<script>alert\("untrusted transcript"\)<\/script>/, 'untrusted source is displayed literally');
  await page.getByRole('button', { name: 'Request raw records' }).click();
  await page.getByRole('alert').filter({ hasText: 'Raw permission denied' }).waitFor();
  assert.equal(await page.locator('.raw-source pre').count(), 0);
  await page.getByRole('button', { name: 'Back to messages' }).click();
  await page.getByRole('button', { name: /A passage on a later bounded source page/ }).click();
  await page.locator('#message-m65 mark').waitFor();
  assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_LocateMessage && envelope.operation.messageId === 'm65'));
  assert.ok(fixture.calls.some(envelope => envelope.operation instanceof api.Operation_GetMessages && envelope.operation.offset === 40 && envelope.operation.limit === 40));
  const before = fixture.searchCount; fixture.blackholeActive();
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, before + 1);
  await page.locator('.connection-widget[data-state="live"]').waitFor();
  await page.locator('.conversation-intro h2').waitFor();
  assert.equal(await page.locator('.search-form input').inputValue(), '(original source) mode:hybrid');
  const beforeRestore = fixture.searchCount;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeRestore + 1);
  await page.locator('.conversation-intro h2').waitFor();
  const beforeRestart = fixture.searchCount; fixture.restart();
  await waitForCalls(fixture, call => call.operation instanceof api.Operation_Archive, beforeRestart + 1);
  await page.locator('.conversation-intro h2').getByText('Following the migration thread', { exact: true }).waitFor();
  await closeConversation(page);
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
  await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.getByRole('button', { name: 'Retry indexing', exact: true }).click();
  await page.locator('.activity-job-row .job-state').getByText('Queued', { exact: true }).waitFor();
  for (const Operation of [api.Operation_MintToken, api.Operation_CreateGroup, api.Operation_Invite, api.Operation_AcceptInvite, api.Operation_RemoveMember, api.Operation_LeaveGroup, api.Operation_DeleteGroup, api.Operation_RetryJob]) assert.ok(fixture.calls.some(call => call.operation instanceof Operation));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'archive', exact: true }).click();
  await archiveReady(page); await openConversation(page);
  assert.match(await page.locator('.dialog-content').innerText(), /Following the migration thread|Rechecking source access|Source content has been cleared/, 'mobile source must show content or explicit pending/error state');
  await page.locator('.conversation-intro').getByRole('heading', { name: 'Following the migration thread' }).waitFor();
  await page.locator('.transcript .original-message pre').first().waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout must not overflow');
  await context.close(); console.log('PASS browser: keyboard search, UTF-8 locator navigation, bounded paging, raw denial, literal source, management forms, indexing retry, silent blackhole resync, lifecycle/server restart, responsive modal');
  for (const mode of ['unauthorized', 'version']) {
    const { context, page, fixture } = await scene(); await search(page); await openConversation(page); fixture.mode = mode; fixture.restart();
    const state = mode === 'version' ? 'update-required' : 'unauthorized';
    await page.locator(`.connection-widget[data-state="${state}"]`).waitFor(); const count = fixture.sockets.length;
    await page.waitForTimeout(1200); assert.equal(fixture.sockets.length, count); assert.equal(await page.locator('.archive-row, .original-message, .passage').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0);
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
    const { context, page, fixture } = await sceneAt(origin, false, fixture => { fixture.signedIn = false; });
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByRole('heading', { name: 'Archive', exact: true, level: 1 }).waitFor();
    assert.deepEqual(await page.locator('.login-story p').allTextContents(), ['Search archived agent sessions and read their source messages.']);
    await page.getByRole('textbox', { name: 'Login', exact: true }).fill('alice');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
    await archiveReady(page);
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
