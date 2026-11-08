// Login, logout, keyboard usability and session-expiry behavior.
import assert from 'node:assert/strict';
import { check, scene, PASSWORDS, waitForNotice, triggerPoll, settlePoll } from './harness.mjs';

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'login screen shows heading and version', async () => {
    const { page, close } = await scene(browser, origin, {});
    try {
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      await page.getByText('Rites 0.2.0 (minimum 0.2.0)', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Login', { exact: true }).count(), 1);
      assert.equal(await page.getByLabel('Password', { exact: true }).count(), 1);
      assert.ok(await page.getByText('Not signed in', { exact: true }).isVisible());
    } finally {
      await close();
    }
  });

  await check(counts, 'wrong password shows inline error and clears the password', async () => {
    const { page, close } = await scene(browser, origin, {});
    try {
      await page.getByLabel('Login', { exact: true }).fill('alice');
      await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Invalid login or password.', { exact: true }).waitFor();
      const password = page.getByLabel('Password', { exact: true });
      assert.equal(await password.inputValue(), '', 'password field must be cleared after a failed attempt');
      assert.ok(await page.getByText('Not signed in', { exact: true }).isVisible());
    } finally {
      await close();
    }
  });

  await check(counts, 'keyboard-only login works (Tab and Enter)', async () => {
    const { page, close } = await scene(browser, origin, {});
    try {
      await page.locator('a.brand').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'login', 'Tab reaches the login field');
      await page.keyboard.type('alice');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'password', 'Tab reaches the password field');
      await page.keyboard.type(PASSWORDS.alice);
      await page.keyboard.press('Enter');
      await page.getByText('Signed in as alice', { exact: true }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'successful login shows identity, nav and repository table', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      for (const tab of ['Repositories', 'Credentials', 'Users']) {
        assert.ok(await page.getByRole('button', { name: tab, exact: true }).isVisible(), `nav button ${tab}`);
      }
      await page.getByText('scheduler enabled', { exact: true }).waitFor();
      await page.getByText('queued runs: 2', { exact: true }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'logout returns to the login view with no private data', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      await page.getByText('Not signed in', { exact: true }).waitFor();
      assert.equal(await page.getByRole('table', { name: 'Repositories', exact: true }).count(), 0, 'repository table must be gone');
      assert.equal(await page.getByRole('dialog').count(), 0, 'no dialogs remain after logout');
      assert.equal(await page.locator('input[name="secret"], input[name="refreshToken"]').count(), 0, 'no credential secret inputs remain after logout');
    } finally {
      await close();
    }
  });

  await check(counts, 'session loss flips to login with an expiry notice', async () => {
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      fixture.dropSession('user-alice');
      await triggerPoll(page);
      await settlePoll(page);
      const text = await waitForNotice(page, 'Session expired.');
      assert.ok(text.includes('Sign in again'), 'notice explains next step');
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      assert.equal(await page.getByRole('table', { name: 'Repositories', exact: true }).count(), 0, 'private view cleared on session loss');
    } finally {
      await close();
    }
  });

  await check(counts, 'unreachable backend at boot shows a visible error and Retry', async () => {
    const { page, close } = await scene(browser, origin, {});
    try {
      await page.route('**/api/me', route => route.abort());
      await page.reload();
      await page.getByRole('heading', { name: 'Unable to reach Rites', exact: true }).waitFor();
      await page.getByText('The Rites service could not be contacted.', { exact: false }).waitFor();
      await page.unroute('**/api/me');
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
    } finally {
      await close();
    }
  });
}
