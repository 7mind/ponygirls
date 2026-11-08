// Polling must never replace an active form or steal focus.
import assert from 'node:assert/strict';
import { check, scene, triggerPoll, settlePoll } from './harness.mjs';

export async function run(env, counts) {
  const { browser, origin } = env;

  await check(counts, 'polling does not steal focus from a focused table control', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const button = page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Rites', exact: true });
      await button.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Rites');
      for (let i = 0; i < 3; i += 1) {
        await triggerPoll(page);
        await settlePoll(page);
      }
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Rites', 'focused button preserved across polls');
    } finally {
      await close();
    }
  });

  await check(counts, 'polling does not replace an open form or disturb typed input', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('button', { name: 'New repository', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New repository', exact: true });
      await dialog.waitFor();
      const host = dialog.getByLabel('Host', { exact: true });
      await host.fill('github.com');
      await host.focus();
      for (let i = 0; i < 3; i += 1) {
        await triggerPoll(page);
        await settlePoll(page);
      }
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'host', 'focus kept on the open form field');
      assert.equal(await host.inputValue(), 'github.com', 'typed value intact');
      assert.ok(await dialog.isVisible(), 'dialog not closed or replaced by polling');
      // The status area still updates next to the (untouched) dialog.
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'rites view polling preserves focus inside the rites table', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Rites', exact: true }).click();
      await page.getByRole('table', { name: 'Rites', exact: true }).waitFor();
      const history = page.getByRole('table', { name: 'Rites', exact: true })
        .getByRole('row', { name: 'nightly-polish' })
        .getByRole('button', { name: 'History', exact: true });
      await history.focus();
      for (let i = 0; i < 3; i += 1) {
        await triggerPoll(page);
        await settlePoll(page);
      }
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'History', 'rites table focus preserved across polls');
    } finally {
      await close();
    }
  });
}
