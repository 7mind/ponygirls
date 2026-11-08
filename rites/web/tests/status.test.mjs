// Service status must be visible, must visibly fail when unreachable, and
// must never present stale success values as fresh. Includes the real-deadline
// chunked-body regression: 200 headers + partial JSON then a stalled stream
// must settle at the production 10 s deadline (no shortened timer).
import assert from 'node:assert/strict';
import { check, scene, triggerPoll, settlePoll } from './harness.mjs';

async function statusRegionText(page) {
  return page.locator('#status-region').innerText();
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'status values render on the repositories view', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
      assert.ok((await statusRegionText(page)).includes('queued runs: 2'));
      assert.ok((await statusRegionText(page)).includes('active runs: 1'));
    } finally {
      await close();
    }
  });

  await check(counts, 'status failure (503) is shown as an error, not stale success', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
      fixture.setStatusMode('fail');
      await triggerPoll(page);
      await settlePoll(page);
      await page.getByText('Status unavailable.', { exact: false }).waitFor();
      const text = await statusRegionText(page);
      assert.ok(text.includes('status-unavailable'), 'error shows the server failure code');
      assert.ok(!text.includes('scheduler enabled'), 'stale success values must not remain visible');
      assert.ok(!text.includes('queued runs:'), 'stale counts must not remain visible');
    } finally {
      fixture.setStatusMode('ok');
      await close();
    }
  });

  await check(counts, 'chunked-body stall settles at the real 10s deadline', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
      fixture.setStatusMode('chunked-stall');
      const startedAt = Date.now();
      await triggerPoll(page);
      await page.getByText('Status unavailable.', { exact: false }).waitFor({ timeout: 13_000 });
      const elapsed = Date.now() - startedAt;
      const text = await statusRegionText(page);
      assert.ok(elapsed >= 9_500, `deadline must be the real 10s, settled after ${elapsed}ms`);
      assert.ok(text.includes('timeout'), 'the settled outcome names the timeout');
      assert.ok(!text.includes('scheduler enabled'), 'no stale success while unreachable');
      assert.ok(!text.includes('queued runs:'), 'no stale counts while unreachable');
    } finally {
      fixture.setStatusMode('ok');
      await close();
    }
  });

  await check(counts, 'oversized response body is capped and reported', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
      fixture.setStatusMode('huge');
      await triggerPoll(page);
      await page.getByText('Status unavailable.', { exact: false }).waitFor({ timeout: 13_000 });
      const text = await statusRegionText(page);
      assert.ok(text.includes('response-too-large'), 'byte cap surfaces the specific failure');
      assert.ok(!text.includes('scheduler enabled'), 'no stale success after the cap');
    } finally {
      fixture.setStatusMode('ok');
      await close();
    }
  });
}
