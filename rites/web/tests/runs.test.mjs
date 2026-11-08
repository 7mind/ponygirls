// Run history rendering, safe proposal links, manual-run pending state,
// idempotent retry after a lost response, explicit new run, and late-response
// isolation across logout.
import assert from 'node:assert/strict';
import { check, scene, waitForNotice, UUID_RE } from './harness.mjs';

function ritesTable(page) {
  return page.getByRole('table', { name: 'Rites', exact: true });
}

function riteRow(page, id) {
  return ritesTable(page).getByRole('row', { name: id });
}

function runButton(page, riteId) {
  return riteRow(page, riteId).getByRole('button', { name: 'Run now', exact: true });
}

async function openRites(page, repoId) {
  await page.getByRole('table', { name: 'Repositories', exact: true })
    .getByRole('row', { name: repoId })
    .getByRole('button', { name: 'Rites', exact: true }).click();
  await ritesTable(page).waitFor();
}

async function openHistory(page, riteId) {
  await riteRow(page, riteId).getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('table', { name: 'Run history', exact: true }).waitFor();
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'run history shows states, revisions, digests and safe links', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await openHistory(page, 'nightly-polish');
      await page.getByText('Run history for nightly-polish', { exact: true }).waitFor();
      const table = page.getByRole('table', { name: 'Run history', exact: true });
      for (const state of ['Published', 'Failed', 'NoChange', 'Queued']) {
        assert.ok(await table.getByText(state, { exact: true }).first().isVisible(), `state ${state} rendered`);
      }
      assert.ok(await table.getByText('forge-error', { exact: false }).isVisible(), 'failure code rendered');
      assert.ok(await table.getByText('9f2a1c4', { exact: true }).isVisible(), 'base revision rendered');
      assert.ok(await table.getByText('digest-7b3c', { exact: true }).isVisible(), 'prompt digest rendered');
      // http(s) proposal renders as a link; other schemes render as text only.
      const link = table.getByRole('link', { name: 'https://github.example/pony/core/pull/9' });
      await link.waitFor();
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0, 'javascript: URL is never a link');
      assert.equal(await page.locator('a[href^="data:"]').count(), 0, 'data: URL is never a link');
      assert.ok(await table.getByText('javascript:alert(1)').isVisible(), 'unsafe URL visible as plain text');
      assert.ok(await table.getByText('link suppressed: unsupported scheme').first().isVisible(), 'suppression explained');
    } finally {
      await close();
    }
  });

  await check(counts, 'manual run disables the button while the request is pending', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      fixture.setRunDelay(700);
      await runButton(page, 'nightly-polish').click();
      const pending = riteRow(page, 'nightly-polish').getByRole('button', { name: 'Running…', exact: true });
      await pending.waitFor();
      assert.ok(await pending.isDisabled(), 'run control disabled while pending');
      await waitForNotice(page, 'is Queued');
      await runButton(page, 'nightly-polish').waitFor();
    } finally {
      fixture.setRunDelay(0);
      await close();
    }
  });

  await check(counts, 'manual run records a UUID idempotency key and shows the run in history', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await openHistory(page, 'nightly-polish');
      const before = fixture.db.runRequests.length;
      await runButton(page, 'nightly-polish').click();
      await waitForNotice(page, 'is Queued');
      const request = fixture.db.runRequests[fixture.db.runRequests.length - 1];
      assert.equal(fixture.db.runRequests.length, before + 1, 'exactly one run request per click');
      assert.match(request.requestId, UUID_RE, 'idempotency key is a crypto UUID');
      const table = page.getByRole('table', { name: 'Run history', exact: true });
      await table.getByText('Manual', { exact: true }).first().waitFor();
      assert.ok(await table.getByRole('row', { name: /Queued/ }).first().isVisible(), 'queued run listed');
    } finally {
      await close();
    }
  });

  await check(counts, 'lost run response keeps the intent; retry reuses the same request id', async () => {
    fixture.dropNextRunResponses(1);
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await runButton(page, 'nightly-polish').click();
      // The server accepted and recorded the run, then dropped the response.
      const notice = await waitForNotice(page, 'Run outcome unknown');
      assert.ok(notice.includes('retrying reuses the same run request'), 'notice explains exact retry');
      const retryButton = riteRow(page, 'nightly-polish').getByRole('button', { name: 'Retry run', exact: true });
      await retryButton.waitFor();
      const afterFirst = fixture.db.runRequests[fixture.db.runRequests.length - 1];
      assert.match(afterFirst.requestId, UUID_RE);
      await retryButton.click();
      await waitForNotice(page, 'is Queued');
      const last = fixture.db.runRequests[fixture.db.runRequests.length - 1];
      assert.equal(last.requestId, afterFirst.requestId, 'retry reuses the identical idempotency key');
      assert.equal(last.replay, true, 'the retry was served as an idempotent replay, not a second run');
      await runButton(page, 'nightly-polish').waitFor();
      assert.equal(await riteRow(page, 'nightly-polish').getByRole('button', { name: 'Retry run', exact: true }).count(), 0, 'intent cleared once the response is known');
    } finally {
      await close();
    }
  });

  await check(counts, 'explicit "New run" mints a fresh idempotency key after an unknown outcome', async () => {
    fixture.dropNextRunResponses(1);
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await runButton(page, 'nightly-polish').click();
      await waitForNotice(page, 'Run outcome unknown');
      const row = riteRow(page, 'nightly-polish');
      const first = fixture.db.runRequests[fixture.db.runRequests.length - 1];
      await row.getByRole('button', { name: 'New run', exact: true }).click();
      await waitForNotice(page, 'is Queued');
      const second = fixture.db.runRequests[fixture.db.runRequests.length - 1];
      assert.notEqual(second.requestId, first.requestId, 'explicit new run mints a new key');
      assert.match(second.requestId, UUID_RE);
    } finally {
      await close();
    }
  });

  await check(counts, 'a late run response after logout never restores the old session UI', async () => {
    fixture.setRunDelay(600);
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await runButton(page, 'nightly-polish').click();
      // Sign out while the run response is still in flight.
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      // Sign in as a different user before the delayed response can land.
      await page.getByLabel('Login', { exact: true }).fill('bob');
      await page.getByLabel('Password', { exact: true }).fill('pw-bob');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Signed in as bob', { exact: true }).waitFor();
      await page.waitForTimeout(1500); // let the stale response arrive
      assert.ok(await page.getByText('Signed in as bob', { exact: true }).isVisible(), 'session identity intact');
      const notice = await page.locator('#notice').innerText().catch(() => '');
      assert.ok(!notice.includes('Queued'), 'stale run completion is not surfaced to the new session');
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const identity = await page.locator('#identity').innerText();
      assert.ok(identity.includes('bob'), 'view still belongs to bob');
    } finally {
      fixture.setRunDelay(0);
      await close();
    }
  });
}
