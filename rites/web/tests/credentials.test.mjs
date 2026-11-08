// Credentials: write-only secrets (static token AND OAuth access/refresh
// tokens), Token vs OAuth modes, expiry/refresh metadata, conflicts, and the
// rule that secrets never appear in the DOM or responses.
import assert from 'node:assert/strict';
import { check, scene, waitForNotice } from './harness.mjs';

function credentialRow(page, name) {
  return page.getByRole('table', { name: 'Credentials', exact: true }).getByRole('row', { name });
}

async function openCredentials(page) {
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await page.getByRole('table', { name: 'Credentials', exact: true }).waitFor();
}

function secretInput(page) {
  return page.getByRole('dialog').locator('input[name="secret"]');
}

function refreshInput(page) {
  return page.getByRole('dialog').locator('input[name="refreshToken"]');
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'credential list shows metadata (mode, expiry, health) without secret material', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      const tokenRow = credentialRow(page, 'alice-github');
      assert.ok(await tokenRow.getByText('Token', { exact: true }).isVisible(), 'token mode badge');
      const oauthRow = credentialRow(page, 'alice-gitlab-oauth');
      assert.ok(await oauthRow.getByText('OAuth', { exact: true }).isVisible(), 'oauth mode badge');
      assert.ok(await oauthRow.getByText('2026-12-01T00:00:00Z', { exact: true }).isVisible(), 'expiry metadata shown');
      assert.ok(await oauthRow.getByText('Healthy', { exact: true }).isVisible(), 'refresh health shown');
      const html = await page.content();
      assert.ok(!html.includes('seed-alice-secret'), 'token secret never reaches the page');
      assert.ok(!html.includes('seed-alice-oauth-access'), 'access token never reaches the page');
      assert.ok(!html.includes('seed-alice-oauth-refresh'), 'refresh token never reaches the page');
    } finally {
      await close();
    }
  });

  await check(counts, 'uncertain refresh health carries owner-replace guidance', async () => {
    const { page, close } = await scene(browser, origin, { user: 'bob' });
    try {
      await openCredentials(page);
      const row = credentialRow(page, 'bob-gitlab');
      assert.ok(await row.getByText('Uncertain', { exact: true }).isVisible(), 'refresh health rendered');
      assert.ok(await row.getByText('owner: replace', { exact: true }).isVisible(), 'owner guidance rendered');
      await page.getByText('never displayed or retrievable', { exact: false }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'create token credential sends mode Token and never echoes the secret', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      await page.getByRole('button', { name: 'New credential', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New credential', exact: true });
      await dialog.waitFor();
      assert.equal(await secretInput(page).inputValue(), '', 'secret starts blank');
      await dialog.getByLabel('Name').fill('fresh-token');
      await dialog.getByLabel('Host').fill('github.com');
      await secretInput(page).fill('super-secret-xyz');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await waitForNotice(page, 'Credential saved');
      const save = fixture.lastCredentialSave();
      assert.equal(save?.body?.mode, 'Token', 'mode is required and sent');
      assert.equal(save?.body?.secret, 'super-secret-xyz');
      assert.ok(save?.body?.refreshToken == null, 'no refresh token in token mode');
      const html = await page.content();
      assert.ok(!html.includes('super-secret-xyz'), 'secret must never appear in the rendered DOM');
      assert.equal(await page.locator('input[type="password"]').count(), 0, 'secret input cleared and gone after submit');
      assert.ok(await credentialRow(page, 'fresh-token').isVisible(), 'new credential listed');
    } finally {
      await close();
    }
  });

  await check(counts, 'create OAuth credential: GitLab locked, client referenced by id, both tokens write-only', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      await page.getByRole('button', { name: 'New credential', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New credential', exact: true });
      await dialog.waitFor();
      const mode = dialog.getByLabel('Mode');
      await mode.selectOption('Oauth');
      const forge = dialog.getByLabel('Forge');
      assert.ok(await forge.isDisabled(), 'forge locked to GitLab in OAuth mode');
      assert.equal(await forge.inputValue(), 'Gitlab', 'GitLab-only in OAuth mode');
      const clientOptions = await dialog.getByLabel('OAuth client').locator('option').allInnerTexts();
      assert.ok(clientOptions.some(t => t.includes('Operations GitLab client')), 'operator-configured client listed by label');
      assert.ok(await refreshInput(page).isVisible(), 'refresh token field appears in OAuth mode');
      await dialog.getByLabel('Name').fill('gitlab-oauth-x');
      await dialog.getByLabel('Host').fill('gitlab.example');
      await secretInput(page).fill('oauth-access-xyz');
      await refreshInput(page).fill('oauth-refresh-xyz');
      await dialog.getByLabel('Access token expiry (UTC)').fill('2026-12-31T00:00:00Z');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await waitForNotice(page, 'Credential saved');
      const save = fixture.lastCredentialSave();
      assert.equal(save?.body?.mode, 'Oauth');
      assert.equal(save?.body?.oauthClientId, 'oauth-client-gitlab-main', 'client referenced by opaque id');
      assert.equal(save?.body?.forge, 'Gitlab');
      assert.equal(save?.body?.secret, 'oauth-access-xyz', 'access token sent once via the request');
      assert.equal(save?.body?.refreshToken, 'oauth-refresh-xyz', 'refresh token sent once via the request');
      assert.equal(save?.body?.expiresAt, '2026-12-31T00:00:00Z');
      const html = await page.content();
      assert.ok(!html.includes('oauth-access-xyz'), 'access token never rendered');
      assert.ok(!html.includes('oauth-refresh-xyz'), 'refresh token never rendered');
      const row = credentialRow(page, 'gitlab-oauth-x');
      assert.ok(await row.getByText('OAuth', { exact: true }).isVisible(), 'row shows OAuth mode');
      assert.ok(await row.getByText('2026-12-31T00:00:00Z', { exact: true }).isVisible(), 'row shows expiry');
    } finally {
      await close();
    }
  });

  await check(counts, 'editing an OAuth credential leaves both tokens blank and requires re-entry', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      await credentialRow(page, 'alice-gitlab-oauth').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit credential alice-gitlab-oauth', exact: true });
      await dialog.waitFor();
      assert.equal(await secretInput(page).inputValue(), '', 'access token blank on edit');
      assert.equal(await refreshInput(page).inputValue(), '', 'refresh token blank on edit');
      assert.equal(await dialog.getByLabel('Access token expiry (UTC)').inputValue(), '2026-12-01T00:00:00Z', 'expiry prefilled (metadata)');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      // Both write-only tokens are empty: the browser blocks the submit with
      // native required-field validation before any request is sent.
      const missing = await page.getByRole('dialog').evaluate(root => ({
        secret: root.querySelector('input[name="secret"]')?.validity.valueMissing ?? null,
        refresh: root.querySelector('input[name="refreshToken"]')?.validity.valueMissing ?? null,
      }));
      assert.ok(missing.secret && missing.refresh, `both tokens must be re-entered (got ${JSON.stringify(missing)})`);
      await secretInput(page).fill('renewed-access');
      await refreshInput(page).fill('renewed-refresh');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await waitForNotice(page, 'Credential saved');
      const html = await page.content();
      assert.ok(!html.includes('renewed-access'), 'renewed access token never rendered');
      assert.ok(!html.includes('renewed-refresh'), 'renewed refresh token never rendered');
    } finally {
      await close();
    }
  });

  await check(counts, 'Escape clears both tokens and removes the dialog', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      await page.getByRole('button', { name: 'New credential', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New credential', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Mode').selectOption('Oauth');
      await secretInput(page).fill('never-submitted-access');
      await refreshInput(page).fill('never-submitted-refresh');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      const html = await page.content();
      assert.ok(!html.includes('never-submitted-access'), 'access token cleared from the DOM on dialog close');
      assert.ok(!html.includes('never-submitted-refresh'), 'refresh token cleared from the DOM on dialog close');
      const stray = await page.locator('input[type="password"]').evaluateAll(els =>
        els.map(e => `${e.getAttribute('name')}@${e.closest('dialog') ? 'dialog' : 'page'}`));
      assert.deepEqual(stray, [], 'password inputs removed with the dialog');
    } finally {
      await close();
    }
  });

  await check(counts, 'revision conflict on edit surfaces a reload affordance and clears typed secrets', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      const credId = [...fixture.db.credentials.values()].find(c => c.name === 'alice-github').id;
      await credentialRow(page, 'alice-github').getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit credential alice-github', exact: true });
      await dialog.waitFor();
      fixture.bumpCredential(credId); // someone else changed it server-side
      await secretInput(page).fill('conflicted-secret');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      const text = await waitForNotice(page, 'revision conflict');
      assert.ok(text.includes('Reload'), 'notice offers a reload action');
      await page.getByRole('button', { name: 'Reload', exact: true }).click();
      const noticeAfterReload = await page.locator('#notice').innerText();
      assert.equal(noticeAfterReload.trim(), '', 'notice cleared after reload');
      assert.equal(await page.getByRole('dialog').count(), 0, 'conflicted dialog closed');
      const html = await page.content();
      assert.ok(!html.includes('conflicted-secret'), 'secret from the failed submit never persisted');
    } finally {
      await close();
    }
  });

  await check(counts, 'deleting an already-deleted credential reports 404 without breaking', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      const credId = [...fixture.db.credentials.values()].find(c => c.name === 'alice-github').id;
      await credentialRow(page, 'alice-github').getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete credential alice-github', exact: true });
      await dialog.waitFor();
      fixture.removeCredential(credId); // removed elsewhere before the confirm
      await dialog.getByRole('button', { name: 'Delete credential', exact: true }).click();
      await waitForNotice(page, 'already deleted');
    } finally {
      await close();
    }
  });

  await check(counts, 'delete credential removes the row after confirmation', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await openCredentials(page);
      const row = credentialRow(page, 'fresh-token');
      await row.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Delete credential fresh-token', exact: true });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Delete credential', exact: true }).click();
      await row.waitFor({ state: 'detached' });
    } finally {
      await close();
    }
  });
}
