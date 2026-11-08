// Repositories: role-aware controls, own-credential binding, create/edit,
// conflict feedback, delete and server-side authority (403).
import assert from 'node:assert/strict';
import { check, scene, waitForNotice } from './harness.mjs';

function repoRow(page, id) {
  return page.getByRole('table', { name: 'Repositories', exact: true }).getByRole('row', { name: id });
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'owner sees management controls, editor does not', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const owned = repoRow(page, 'pony/core');
      assert.ok(await owned.getByText('Owner', { exact: true }).isVisible(), 'own repo shows Owner role');
      for (const name of ['Edit', 'Grants', 'Delete']) {
        assert.ok(await owned.getByRole('button', { name, exact: true }).isVisible(), `owner can ${name}`);
      }
      const edited = repoRow(page, 'internal/ops');
      assert.ok(await edited.getByText('Editor', { exact: true }).isVisible(), 'granted role shown');
      for (const name of ['Edit', 'Grants', 'Delete']) {
        assert.equal(await edited.getByRole('button', { name, exact: true }).count(), 0, `editor cannot ${name} another owner's repo`);
      }
    } finally {
      await close();
    }
  });

  await check(counts, 'viewer sees read-only rows', async () => {
    const { page, close } = await scene(browser, origin, { user: 'carol' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const row = repoRow(page, 'pony/core');
      assert.ok(await row.getByText('Viewer', { exact: true }).isVisible());
      assert.ok(await row.getByRole('button', { name: 'Rites', exact: true }).isVisible(), 'viewer can open rites');
      for (const name of ['Edit', 'Grants', 'Delete']) {
        assert.equal(await row.getByRole('button', { name, exact: true }).count(), 0, `viewer cannot ${name}`);
      }
    } finally {
      await close();
    }
  });

  await check(counts, 'repository form binds only the user own credentials', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('button', { name: 'New repository', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New repository', exact: true });
      await dialog.waitFor();
      const options = await dialog.getByLabel('Credential (your own only)')
        .locator('option').allInnerTexts();
      assert.ok(options.some(t => t.includes('alice-github')), 'own credential offered');
      assert.ok(options.every(t => !t.includes('bob-gitlab')), "other users' credentials are never offered");
    } finally {
      await close();
    }
  });

  await check(counts, 'create repository with a fresh id and own credential', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('button', { name: 'New repository', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New repository', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Repository ID').fill('brand/new');
      await dialog.getByLabel('Host').fill('github.com');
      await dialog.getByLabel('Project').fill('brand/new');
      await dialog.getByLabel('Base branch').fill('main');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await waitForNotice(page, 'Repository saved');
      assert.ok(await repoRow(page, 'brand/new').isVisible(), 'new repository row appears');
    } finally {
      await close();
    }
  });

  await check(counts, 'edit repository keeps the id immutable and updates fields', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await repoRow(page, 'pony/core').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit repository pony/core', exact: true });
      await dialog.waitFor();
      const idField = dialog.getByLabel('Repository ID');
  assert.equal(await idField.isEditable(), false, 'id immutable on edit');
  assert.notEqual(await idField.getAttribute('readonly'), null, 'id field is readonly on edit');
      await dialog.getByLabel('Base branch').fill('develop');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await waitForNotice(page, 'Repository saved');
      assert.ok(await repoRow(page, 'pony/core').getByText('develop', { exact: true }).isVisible(), 'branch updated');
    } finally {
      await close();
    }
  });

  await check(counts, 'revision conflict on repository edit offers reload', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await repoRow(page, 'pony/core').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit repository pony/core', exact: true });
      await dialog.waitFor();
      fixture.bumpRepository('pony/core'); // concurrent server-side change
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      const text = await waitForNotice(page, 'revision conflict');
      assert.ok(text.includes('Reload'));
      await page.getByRole('button', { name: 'Reload', exact: true }).click();
      const noticeAfterReload = await page.locator('#notice').innerText();
      assert.equal(noticeAfterReload.trim(), '', 'notice cleared after reload');
      assert.ok(await repoRow(page, 'pony/core').isVisible(), 'list still healthy after reload');
    } finally {
      await close();
    }
  });

  await check(counts, 'server-side authority change surfaces a 403 with the failure code', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await repoRow(page, 'pony/core').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit repository pony/core', exact: true });
      await dialog.waitFor();
      // Ownership is transferred server-side without a revision bump, so the
      // (stale) owner UI still offers the form but the server must refuse.
      fixture.setOwner('pony/core', 'user-bob');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await dialog.getByText('forbidden', { exact: false }).waitFor();
      assert.ok(await dialog.isVisible(), 'dialog stays open so nothing is lost');
    } finally {
      fixture.setOwner('pony/core', 'user-alice');
      await close();
    }
  });

  await check(counts, 'delete repository removes the row after confirmation', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const row = repoRow(page, 'brand/new');
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete repository brand/new', exact: true });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Delete repository', exact: true }).click();
      await row.waitFor({ state: 'detached' });
    } finally {
      await close();
    }
  });
}
