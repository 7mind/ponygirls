// Grant management: owner-only, role changes, grant removal (role null),
// current-revision continuity and conflicts.
import assert from 'node:assert/strict';
import { check, scene, waitForNotice } from './harness.mjs';

function grantRow(page, login) {
  return page.getByRole('table', { name: 'Repository grants', exact: true }).getByRole('row', { name: login });
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'grants dialog lists grants; owner row is immutable', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Grants', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Grants for pony/core', exact: true });
      await dialog.waitFor();
      const ownerRow = grantRow(page, 'alice');
      assert.ok(await ownerRow.getByText('Owner', { exact: true }).isVisible());
      assert.ok(await ownerRow.getByText('Owner is immutable', { exact: true }).isVisible(), 'owner row has no change controls');
      assert.equal(await ownerRow.getByRole('button', { name: 'Remove', exact: true }).count(), 0);
      assert.equal(await grantRow(page, 'bob').getByRole('button', { name: 'Apply', exact: true }).count(), 1, 'non-owner rows are changeable');
      assert.equal(await grantRow(page, 'carol').getByRole('button', { name: 'Remove', exact: true }).count(), 1);
    } finally {
      await close();
    }
  });

  await check(counts, 'changing a role applies immediately with a fresh server revision', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Grants', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Grants for pony/core', exact: true });
      await dialog.waitFor();
      const row = grantRow(page, 'carol');
      await row.getByLabel('Role for carol').selectOption('Editor');
      await row.getByRole('button', { name: 'Apply', exact: true }).click();
      await row.locator('.badge', { hasText: 'Editor' }).waitFor();
      assert.ok(await row.locator('.badge', { hasText: 'Editor' }).isVisible(), 'role badge updated in place');
    } finally {
      await close();
    }
  });

  await check(counts, 'removing a grant (role null) drops the row', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Grants', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Grants for pony/core', exact: true });
      await dialog.waitFor();
      const row = grantRow(page, 'carol');
      await row.getByRole('button', { name: 'Remove', exact: true }).click();
      await row.waitFor({ state: 'detached' });
      assert.equal(await grantRow(page, 'carol').count(), 0, 'grant row removed');
    } finally {
      await close();
    }
  });

  await check(counts, 'adding a grant lists the user with the chosen role', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Grants', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Grants for pony/core', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('User to grant').selectOption({ label: 'carol' });
      await dialog.getByLabel('Role for new grant').selectOption('Viewer');
      await dialog.getByRole('button', { name: 'Add grant', exact: true }).click();
      const row = grantRow(page, 'carol');
      await row.locator('.badge', { hasText: 'Viewer' }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'repository editing uses the current revision after grant changes', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      // The seed grants already bumped the repository revision several times
      // in earlier checks; editing must still succeed without a conflict.
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit repository pony/core', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Base branch', { exact: true }).fill('trunk');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      const notice = await waitForNotice(page, 'Repository saved');
      assert.equal(notice.includes('conflict'), false, 'no spurious conflict');
    } finally {
      await close();
    }
  });

  await check(counts, 'grant conflict (concurrent revision bump) offers reload', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Grants', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Grants for pony/core', exact: true });
      await dialog.waitFor();
      fixture.bumpRepository('pony/core'); // concurrent change invalidates the revision
      const row = grantRow(page, 'bob');
      await row.getByRole('button', { name: 'Remove', exact: true }).click();
      const text = await waitForNotice(page, 'revision conflict');
      assert.ok(text.includes('Reload'));
    } finally {
      await close();
    }
  });
}
