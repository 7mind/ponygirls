// Shared account page (shared/account-web) in the Chronicle outlet: token states that need a scripted server
// reply. The outlet's first render, form, secret and long list are in scenes-shell.mjs. The document is the
// only scroller; there is no account dialog any more.
import { PRIMARY, withScene, settle, sleep } from './lib.mjs';
import { seededFixture } from './seed.mjs';

const GET_ACCOUNT = '**/api/account/v1';
const ACCOUNT_DELAY_MS = 4000;
const variant = { viewport: PRIMARY, scheme: 'light', suffix: '', deep: true };
async function tokens(page) { await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menuitem', { name: 'Access tokens', exact: true }).click(); await page.getByRole('heading', { name: 'Access tokens', exact: true }).waitFor(); }

export function registerAccount(scenario) {
  scenario('account-flows', async ctx => {
    await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
      await tokens(page); await page.getByRole('button', { name: /^Revoke / }).first().click(); await page.getByRole('dialog').waitFor(); await settle(page, 300);
      await shot('account', '', 'Revoke confirmation: in-app dialog naming the token', 'Revoke <token>', { file: 'account-settings-tokens-revoke-1440.png' });
    });
    await withScene(ctx, variant, { fixture: seededFixture(fixture => { fixture.mintUncertain = true; }) }, async ({ page, shot }) => {
      await tokens(page); await page.getByRole('button', { name: 'New token', exact: true }).first().click(); await page.getByLabel('Name', { exact: true }).fill('lost-reply-token');
      await page.getByRole('button', { name: 'Create token', exact: true }).click(); await page.getByRole('button', { name: 'Refresh list and check', exact: true }).waitFor(); await settle(page, 300);
      await shot('account', '', 'Mint reply lost: one warning with "Refresh list and check" in place of the form', 'fixture aborts the mint POST', { file: 'account-settings-tokens-uncertain-1440.png' });
    });
    await withScene(ctx, variant, { fixture: seededFixture(), install: async page => { await page.route(GET_ACCOUNT, async route => { if (route.request().method() === 'GET') await sleep(ACCOUNT_DELAY_MS); await route.fallback(); }); } }, async ({ page, shot }) => {
      await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menuitem', { name: 'Access tokens', exact: true }).click(); await settle(page, 500);
      await shot('account', '', 'Access tokens while the account read is in flight', `delay GET /api/account/v1 by ${ACCOUNT_DELAY_MS} ms`, { file: 'account-settings-tokens-loading-1440.png' });
    });
    await withScene(ctx, variant, { fixture: seededFixture(), install: async page => { await page.route(GET_ACCOUNT, route => route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'unavailable' } }) }) : route.fallback()); } }, async ({ page, shot }) => {
      await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menuitem', { name: 'Access tokens', exact: true }).click(); await page.locator('[data-account-outlet] .notice').first().waitFor(); await settle(page, 300);
      await shot('account', '', 'Account read fails with HTTP 500', 'GET /api/account/v1 -> 500', { file: 'account-settings-tokens-error-1440.png' });
    });
  });
}
