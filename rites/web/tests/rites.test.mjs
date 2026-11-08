// Rites CRUD, model selection, cron scheduling, role-aware controls, XSS-safe
// rendering of server-provided ids, and server-side authority on runs.
import assert from 'node:assert/strict';
import { check, scene, waitForNotice } from './harness.mjs';

function ritesTable(page) {
  return page.getByRole('table', { name: 'Rites', exact: true });
}

function riteRow(page, id) {
  return ritesTable(page).getByRole('row', { name: id });
}

async function openRites(page, repoId) {
  await page.getByRole('table', { name: 'Repositories', exact: true })
    .getByRole('row', { name: repoId })
    .getByRole('button', { name: 'Rites', exact: true }).click();
  await ritesTable(page).waitFor();
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'rites list renders server-provided ids as text only', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      const xssRow = riteRow(page, 'xss');
      assert.ok(await xssRow.isVisible(), 'the markup-bearing rite id is visible');
      assert.equal(await page.locator('img').count(), 0, 'no img element is injected from server data');
      const injected = await page.evaluate(() => window.__xss);
      assert.equal(injected, undefined, 'no script from the rite id executed');
      assert.ok(await riteRow(page, 'nightly-polish').getByText('0 2 * * *').isVisible(), 'schedule shown as UTC cron');
      assert.ok(await riteRow(page, 'weekly-report').getByText('disabled', { exact: true }).isVisible());
    } finally {
      await close();
    }
  });

  await check(counts, 'new rite form offers the models from GET /api/models', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await page.getByRole('button', { name: 'New rite', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New rite for pony/core', exact: true });
      await dialog.waitFor();
      const options = await dialog.getByLabel('Model').locator('option').allInnerTexts();
      assert.ok(options.some(t => t.includes('synthetic/polish-x')), 'model options include provider/model');
      assert.ok(options.some(t => t.includes('synthetic/quick-x')));
    } finally {
      await close();
    }
  });

  await check(counts, 'invalid schedule is rejected by the server and shown with its code', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await page.getByRole('button', { name: 'New rite', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New rite for pony/core', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Rite ID').fill('daily-check');
      await dialog.getByLabel('Schedule (UTC cron)').fill('nope');
      await dialog.getByLabel('Prompt path').fill('prompts/daily.txt');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await dialog.getByText('invalid-schedule', { exact: false }).waitFor();
      assert.ok(await dialog.isVisible(), 'dialog stays open after the server rejection');
    } finally {
      await close();
    }
  });

  await check(counts, 'create rite with a valid schedule', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await page.getByRole('button', { name: 'New rite', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New rite for pony/core', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Rite ID').fill('daily-check');
      await dialog.getByLabel('Schedule (UTC cron)').fill('0 9 * * 1-5');
      await dialog.getByLabel('Prompt path').fill('prompts/daily.txt');
      await dialog.getByLabel('Model').selectOption('model-quick');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await waitForNotice(page, 'Rite saved');
      assert.ok(await riteRow(page, 'daily-check').isVisible(), 'new rite listed');
    } finally {
      await close();
    }
  });

  await check(counts, 'edit rite keeps the id immutable and updates the schedule', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      await riteRow(page, 'nightly-polish').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit rite nightly-polish', exact: true });
      await dialog.waitFor();
      const idField = dialog.getByLabel('Rite ID');
  assert.equal(await idField.isEditable(), false, 'rite id immutable on edit');
  assert.notEqual(await idField.getAttribute('readonly'), null, 'rite id field is readonly on edit');
      assert.equal(await dialog.getByLabel('Schedule (UTC cron)').inputValue(), '0 2 * * *', 'schedule prefilled');
      await dialog.getByLabel('Schedule (UTC cron)').fill('15 4 * * *');
      await dialog.getByLabel('Enabled').uncheck();
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await waitForNotice(page, 'Rite saved');
      const row = riteRow(page, 'nightly-polish');
      await row.getByText('15 4 * * *').waitFor();
      assert.ok(await row.getByText('disabled', { exact: true }).isVisible(), 'enabled toggle persisted');
    } finally {
      await close();
    }
  });

  await check(counts, 'viewer role is fully read-only on rites', async () => {
    const { page, close } = await scene(browser, origin, { user: 'carol' });
    try {
      await openRites(page, 'pony/core');
      await ritesTable(page).waitFor();
      await page.getByText('Read-only access: viewer role.', { exact: true }).waitFor();
      for (const name of ['New rite', 'Run now', 'Edit', 'Delete']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `viewer cannot ${name}`);
      }
      assert.equal(await riteRow(page, 'nightly-polish').getByRole('button', { name: 'History', exact: true }).count(), 1, 'viewer can read history');
    } finally {
      await close();
    }
  });

  await check(counts, 'editor role manages rites and manual runs', async () => {
    const { page, close } = await scene(browser, origin, { user: 'bob' });
    try {
      await openRites(page, 'pony/core');
      await ritesTable(page).waitFor();
      assert.equal(await page.getByRole('button', { name: 'New rite', exact: true }).count(), 1);
      assert.ok(await riteRow(page, 'nightly-polish').getByRole('button', { name: 'Run now', exact: true }).isVisible());
    } finally {
      await close();
    }
  });

  await check(counts, 'stale editor role gets a 403 with the failure code on manual run', async () => {
    const { page, close } = await scene(browser, origin, { user: 'bob' });
    try {
      await openRites(page, 'pony/core');
      await ritesTable(page).waitFor();
      // Server demotes bob to Viewer without a revision bump; the loaded UI is
      // stale but the server must refuse the run.
      fixture.setRole('pony/core', 'user-bob', 'Viewer', true);
      await riteRow(page, 'nightly-polish').getByRole('button', { name: 'Run now', exact: true }).click();
      const text = await waitForNotice(page, 'Manual run failed');
      assert.ok(text.includes('forbidden'), 'server failure code shown');
    } finally {
      fixture.setRole('pony/core', 'user-bob', 'Editor', true);
      await close();
    }
  });

  await check(counts, 'delete rite removes the row after confirmation', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openRites(page, 'pony/core');
      const row = riteRow(page, 'daily-check');
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete rite daily-check', exact: true });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Delete rite', exact: true }).click();
      await row.waitFor({ state: 'detached' });
    } finally {
      await close();
    }
  });
}
