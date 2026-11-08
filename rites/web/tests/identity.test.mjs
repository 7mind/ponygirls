// Identity contract: the UI pins its expected user (X-Rites-User) on every
// authenticated request, verifies the echoed actual user on every
// authenticated response BEFORE consuming the body, and discards all private
// state (open forms, typed secrets, run intents) when the browser cookie is
// switched by another page in the same context.
import assert from 'node:assert/strict';
import { check, scene, triggerPoll, settlePoll, waitForNotice, login, PASSWORDS } from './harness.mjs';

// One browser context (shared cookie jar) with two pages: pageA signed in as
// alice, pageB viewing the same session until it switches accounts.
async function twoPages(browser, origin) {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  pageA.setDefaultTimeout(10_000);
  pageB.setDefaultTimeout(10_000);
  await pageA.goto(`${origin}/`);
  await login(pageA, 'alice', PASSWORDS.alice);
  await pageB.goto(`${origin}/`);
  await pageB.getByText('Signed in as alice', { exact: true }).waitFor();
  return {
    context,
    pageA,
    pageB,
    async close() {
      await context.close();
    },
  };
}

// Switch the shared cookie jar to bob via the real UI on pageB.
async function switchToBob(pageB) {
  await pageB.getByRole('button', { name: 'Sign out', exact: true }).click();
  await pageB.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
  await login(pageB, 'bob', PASSWORDS.bob);
}

export async function run(env, counts) {
  const { browser, origin, fixture } = env;

  await check(counts, 'submitting an open alice form after the cookie switched to bob stores nothing', async () => {
    const pages = await twoPages(browser, origin);
    try {
      const { pageA } = pages;
      await pageA.getByRole('button', { name: 'Credentials', exact: true }).click();
      await pageA.getByRole('table', { name: 'Credentials', exact: true }).waitFor();
      await pageA.getByRole('button', { name: 'New credential', exact: true }).click();
      const dialog = pageA.getByRole('dialog', { name: 'New credential', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Name', { exact: true }).fill('held-mismatch-cred');
      await dialog.getByLabel('Host', { exact: true }).fill('github.com');
      await dialog.locator('input[name="secret"]').fill('mismatch-secret-9');
      // The other page in the same context switches the session to bob.
      await switchToBob(pages.pageB);
      // pageA still shows alice's private UI; submitting sends alice's pinned
      // identity with bob's cookie, which the server must refuse before any
      // effect and the UI must treat as an account change.
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      const notice = await waitForNotice(pageA, 'Account changed');
      assert.ok(notice.includes('different user'), 'notice explains the account change');
      await pageA.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      assert.equal(await pageA.getByRole('dialog').count(), 0, 'no dialogs remain after the account change');
      assert.equal(await pageA.locator('input[name="secret"], input[name="refreshToken"]').count(), 0, 'no credential secret inputs remain after the account change');
      const html = await pageA.content();
      assert.ok(!html.includes('mismatch-secret-9'), 'typed secret never persists in the DOM');
      assert.equal(await pageA.getByText('Not signed in', { exact: true }).isVisible(), true);
      // Server side: the mutation was refused before any effect.
      const mismatches = fixture.db.identityMismatches.filter(m => m.path === '/api/credentials');
      assert.equal(mismatches.length, 1, 'exactly one identity-refused mutation');
      assert.equal(mismatches[0].expected, 'user-alice');
      assert.equal(mismatches[0].actual, 'user-bob');
      const stored = [...fixture.db.credentials.values()].filter(c => c.name === 'held-mismatch-cred');
      assert.equal(stored.length, 0, 'no credential was created under bob from alice form');
    } finally {
      await pages.close();
    }
  });

  await check(counts, 'held response after a cookie switch flips the view exactly when it lands', async () => {
    const pages = await twoPages(browser, origin);
    try {
      const { pageA } = pages;
      await pageA.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await switchToBob(pages.pageB);
      // The next tick's status and repositories refreshes are held at the server.
      fixture.holdNext('/api/status');
      fixture.holdNext('/api/repositories');
      await triggerPoll(pageA);
      // While the (now mismatched) response is in flight, the UI must not
      // silently switch accounts or show another user's data.
      await pageA.waitForTimeout(500);
      assert.ok(await pageA.getByText('Signed in as alice', { exact: true }).isVisible(), 'no silent identity switch while pending');
      assert.ok(await pageA.getByRole('table', { name: 'Repositories', exact: true }).isVisible(), 'stale private view stays until the response settles');
      assert.ok(await pageA.getByRole('row', { name: 'pony/core' }).isVisible(), 'no bob data rendered mid-flight');
      fixture.releaseHeld();
      await waitForNotice(pageA, 'Account changed');
      await pageA.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      assert.equal(await pageA.getByRole('table', { name: 'Repositories', exact: true }).count(), 0, 'private view discarded on mismatch');
      assert.ok(await pageA.getByText('Not signed in', { exact: true }).isVisible());
    } finally {
      fixture.releaseHeld();
      await pages.close();
    }
  });

  await check(counts, 'a sign-out after a cookie switch is refused and re-auth is required', async () => {
    const pages = await twoPages(browser, origin);
    try {
      const { pageA } = pages;
      await pageA.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await switchToBob(pages.pageB);
      await pageA.getByRole('button', { name: 'Sign out', exact: true }).click();
      // pageA pins alice while the cookie is bob: the server refuses the
      // logout and the UI must not pretend the (foreign) session was closed.
      const notice = await waitForNotice(pageA, 'Account changed');
      assert.ok(notice.includes('different user'));
      await pageA.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
      assert.ok(await pages.pageB.getByText('Signed in as bob', { exact: true }).isVisible(), 'bob session untouched');
    } finally {
      await pages.close();
    }
  });

  await check(counts, 'every UI mutation carries X-Rites-User and Content-Type application/json', async () => {
    fixture.reset(); // single-user flow: no earlier checks' mismatches
    const { page, close } = await scene(browser, origin, { user: 'alice' });
    try {
      // Exercise a spread of mutations: credential save, rite save, manual
      // run, and finally sign out.
      await page.getByRole('button', { name: 'Credentials', exact: true }).click();
      await page.getByRole('table', { name: 'Credentials', exact: true }).waitFor();
      await page.getByRole('button', { name: 'New credential', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New credential', exact: true });
      await dialog.waitFor();
      await dialog.getByLabel('Name', { exact: true }).fill('contract-cred');
      await dialog.getByLabel('Host', { exact: true }).fill('github.com');
      await dialog.locator('input[name="secret"]').fill('contract-secret');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await waitForNotice(page, 'Credential saved');

      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Rites', exact: true }).click();
      await page.getByRole('table', { name: 'Rites', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Rites', exact: true })
        .getByRole('row', { name: 'nightly-polish' })
        .getByRole('button', { name: 'Run now', exact: true }).click();
      await waitForNotice(page, 'is Queued');

      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();

      const mutations = fixture.db.calls.filter(c => c.method !== 'GET' && c.path !== '/api/login');
      assert.ok(mutations.length >= 3, 'expected credential save, manual run and logout mutations');
      for (const call of mutations) {
        assert.equal(call.xRitesUser, 'user-alice', `${call.method} ${call.path} must pin the signed-in user`);
        assert.equal(call.contentType, 'application/json', `${call.method} ${call.path} must declare application/json`);
      }
      assert.deepEqual(fixture.db.contractViolations, [], 'no UI-side contract breaches');
      assert.deepEqual(fixture.db.identityMismatches, [], 'no identity mismatches in a single-user flow');
    } finally {
      await close();
    }
  });
}
