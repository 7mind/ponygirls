// Shared account dialog (shared/account-web/account.js + account.css) as embedded in the Chronicle dashboard.
import { VARIANTS, withScene, gotoTab, settle, inspect, sleep } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';

const dialog = page => page.getByRole('dialog', { name: 'Account settings', exact: true });
async function openSettings(page) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await dialog(page).waitFor(); }
async function openLoaded(page) { await openSettings(page); await page.getByLabel('Token name', { exact: true }).waitFor(); await settle(page, 300); }
const GET_ACCOUNT = '**/api/account/v1';
const manyTokens = fixture => { fixture.tokens = Array.from({ length: 30 }, (_, i) => new api.TokenInfo(`00000000-0000-4000-8000-${String(300000 + i).padStart(12, '0')}`, `${['laptop-cli', 'ci-upload', 'notebook', 'temporary token for the demo of the dashboard to the storage team on Thursday'][i % 4]}-${i + 1}`, i % 3 === 0 ? [api.Scope.Ingest] : [api.Scope.Read, api.Scope.Raw], `2026-10-${String(1 + i % 28).padStart(2, '0')}T10:00:00Z`, i % 5 === 4)); };

export function registerAccount(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`account-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
        await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor();
        await openLoaded(page);
        await shot('account', 'token-list', 'Account settings dialog with the token form and a list of 2 configured and 5 issued tokens (one revoked)', 'masthead > Settings');
        await inspect(page, ctx.recorder, `account-dialog-${key}`);
        await dialog(page).evaluate(element => { element.scrollTop = element.scrollHeight; }); await settle(page);
        await shot('account', 'token-list-scrolled', 'Same dialog scrolled to the bottom of the token list (dialog itself scrolls; max-height 100dvh-1.5rem)', 'scroll the dialog');
      });
    });
  }
  scenario('account-flows', async ctx => {
    const confirms = [];
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, shot }) => {
      page.on('dialog', async native => { confirms.push({ type: native.type(), message: native.message() }); await native.accept(); });
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openLoaded(page);
      const name = page.getByLabel('Token name', { exact: true });
      await name.fill('ci-bot-for-nightly-exports'); await page.getByRole('checkbox', { name: 'Raw' }).check(); await settle(page, 200);
      await shot('account', 'form-filled', 'Token form with a name and the Read+Raw permissions checked (Raw forces Read)', 'type a name, tick Raw');
      await name.fill('   '); await page.getByRole('button', { name: 'Create access token' }).click(); await settle(page, 500);
      const whitespace = await page.evaluate(() => ({ status: document.querySelector('.account-status').textContent, error: document.querySelector('.account-error').textContent, errorHidden: document.querySelector('.account-error').hidden, focused: document.activeElement.name ?? document.activeElement.tagName }));
      await ctx.recorder.dump('account-whitespace-name', whitespace);
      await shot('account', 'validation-whitespace-name', 'Create pressed with a whitespace-only name: nothing visible happens (no message), focus returns to the field', 'name "   " > Create access token');
      await name.fill('ci-bot-for-nightly-exports');
      await page.getByRole('button', { name: 'Create access token' }).click(); await page.getByLabel('One-time token secret').waitFor(); await settle(page, 400);
      await shot('account', 'secret-shown', 'Issued token: one-time secret panel at the top of the dialog (secret selected, Copy / Dismiss)', 'Create access token');
      await dialog(page).evaluate(element => { element.scrollTop = 0; });
      await page.getByRole('button', { name: 'Dismiss secret' }).click(); await settle(page, 400);
      await shot('account', 'after-dismiss', 'After dismissing the secret: the new token is in the list', 'Dismiss secret');
      const revoke = page.getByRole('button', { name: /^Revoke / }).first(); await revoke.scrollIntoViewIfNeeded(); await revoke.hover(); await settle(page, 200);
      await shot('account', 'revoke-hover', 'Revoke button about to be pressed: confirmation will be a native window.confirm which screenshots cannot show (message recorded in inventory/account-native-confirms.json)', 'hover a Revoke button');
      await revoke.click(); await page.locator('.account-status', { hasText: 'revoked' }).waitFor(); await settle(page, 400);
      await shot('account', 'revoked', 'After accepting the native confirm: "Access token revoked." status line, token shows a Revoked badge', 'Revoke > accept native confirm');
      await ctx.recorder.dump('account-native-confirms', confirms);
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(manyTokens) }, async ({ page, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openLoaded(page);
      await shot('account', 'long-list', 'Dialog with 32 tokens: the form is pushed out of sight by the list, dialog scrolls as one page', 'fixture with 30 issued tokens');
      await dialog(page).evaluate(element => { element.scrollTop = element.scrollHeight / 2; }); await settle(page);
      await shot('account', 'long-list-mid', 'Long list scrolled to the middle (no sticky header, no search, no pagination)', 'scroll the dialog');
      await inspect(page, ctx.recorder, 'account-dialog-long-list');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(), install: async page => { await page.route(GET_ACCOUNT, async route => { if (route.request().method() === 'GET') await sleep(4000); await route.fallback(); }); } }, async ({ page, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openSettings(page); await page.getByText('Loading account settings…').waitFor(); await settle(page, 300);
      await shot('account', 'loading', 'Dialog while the account read is in flight: heading and a "Loading account settings…" line only', 'delay GET /api/account/v1 by 4 s');
    });
    for (const [label, status, shows] of [['error-500', 500, 'Account read fails with HTTP 500: error line plus a "Retry loading settings" button'], ['error-401', 401, 'Account read answered 401: "session no longer authorized" error']]) {
      await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(), install: async page => { await page.route(GET_ACCOUNT, route => route.request().method() === 'GET' ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'x', message: 'x' } }) }) : route.fallback()); } }, async ({ page, shot }) => {
        await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openSettings(page); await page.locator('.account-error:not([hidden])').waitFor(); await settle(page, 300);
        await shot('account', label, shows, `GET /api/account/v1 -> ${status}`);
      });
    }
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(), install: async page => { await page.route('**/api/account/v1/tokens/*/revoke', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })); } }, async ({ page, shot }) => {
      page.on('dialog', native => native.accept());
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openLoaded(page);
      await page.getByRole('button', { name: /^Revoke / }).first().click(); await page.locator('.account-error:not([hidden])').waitFor(); await settle(page, 300);
      await shot('account', 'error-revoke-403', 'Revoke answered 403: error message and "could not be confirmed" status', 'POST revoke -> 403');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.mintUncertain = true; }) }, async ({ page, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor(); await openLoaded(page);
      await page.getByLabel('Token name', { exact: true }).fill('lost-reply-token'); await page.getByRole('button', { name: 'Create access token' }).click(); await page.locator('.account-uncertain [role=alert]').waitFor(); await settle(page, 400);
      await shot('account', 'uncertain-mint', 'Mint request lost its reply: uncertain-outcome warning, create disabled, acknowledge disabled until the list is refreshed', 'fixture aborts the mint POST');
      await page.getByRole('button', { name: 'Refresh token list' }).click(); await settle(page, 700);
      await shot('account', 'uncertain-mint-refreshed', 'After "Refresh token list": acknowledge button becomes available', 'click Refresh token list');
    });
  });
}
