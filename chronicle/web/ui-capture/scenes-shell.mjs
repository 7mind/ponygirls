// Shell (masthead, menus, routes) and the shared account page in its outlet, named like the mockup shots
// (`<app>-<view>-<state>[-dark]-<width>.png`, spec §8 item 10) so that each pairs with its mockup for `look`.
import { PRIMARY, SECONDARY, PHONE, withScene, gotoTab, archiveReady, settle, inspect } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';

const SHELL_VARIANTS = [PRIMARY, SECONDARY, PHONE].flatMap(viewport => ['light', 'dark'].map(scheme => ({ viewport, scheme, suffix: scheme === 'dark' ? '-dark' : '', deep: viewport === PRIMARY && scheme === 'light' })));
const named = (base, variant) => `${base}${variant.suffix}-${variant.viewport.tag}.png`;
const LONG_TOKEN_LIST = 30;
const manyTokens = fixture => { fixture.tokens = Array.from({ length: LONG_TOKEN_LIST }, (_, i) => new api.TokenInfo(`00000000-0000-4000-8000-${String(300000 + i).padStart(12, '0')}`, `collector-${String(i + 1).padStart(2, '0')}`, i % 3 === 0 ? [api.Scope.Ingest] : [api.Scope.Read], new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), i % 7 === 6)); };
async function userMenu(page) { await page.getByRole('button', { name: 'alice', exact: true }).click(); await page.getByRole('menu', { name: 'alice', exact: true }).waitFor(); }
async function tokens(page) { await userMenu(page); await page.getByRole('menuitem', { name: 'Access tokens', exact: true }).click(); await page.getByRole('heading', { name: 'Access tokens', exact: true }).waitFor(); await page.locator('table[data-list="tokens"] tr[data-row-id]').first().waitFor(); }

export function registerShell(scenario) {
  for (const variant of SHELL_VARIANTS) {
    const key = `${variant.scheme}-${variant.viewport.tag}`;
    scenario(`shell-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
        const capture = (base, shows, reached) => shot(base, '', shows, reached, { file: named(base, variant) });
        await gotoTab(page, 'archive'); await archiveReady(page); await settle(page, 400);
        await capture('chronicle-archive', 'Archive (old view insides) under the new shell: masthead with nav links, connection, theme and user menus', 'nav link Archive');
        await gotoTab(page, 'search'); await page.getByRole('main', { name: 'Search', exact: true }).waitFor(); await settle(page, 400);
        await capture('chronicle-search-default', 'Search (old view insides) under the new shell before a query', 'nav link Search');
        await userMenu(page); await settle(page);
        await capture('chronicle-shell-user-menu', 'User menu: signed-in identity, Account settings, Access tokens, Sign out', 'masthead user button');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Theme settings', exact: true }).click(); await settle(page);
        await capture('chronicle-shell-theme-menu', 'Theme menu: System / Light / Dark', 'masthead theme button');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^Connection: / }).click(); await page.getByRole('dialog', { name: 'Connection details', exact: true }).waitFor(); await settle(page);
        await capture('chronicle-shell-connection', 'Connection details popover under the masthead indicator', 'masthead connection indicator');
        await page.keyboard.press('Escape');
        await tokens(page); await settle(page, 400);
        await capture('account-settings-tokens', 'Account page in the outlet: Access tokens section (degraded mode: no profile/policy endpoints)', 'user menu > Access tokens');
        if (variant.deep) await inspect(page, ctx.recorder, 'account-outlet-tokens');
      });
      await withScene(ctx, variant, { fixture: seededFixture(fixture => { fixture.signedIn = false; }), waitSignedIn: false }, async ({ page, shot }) => {
        await page.locator('main[data-account-auth] form[data-account-login]').waitFor(); await settle(page, 400);
        await shot('account-login', '', 'Signed-out page: shared login card in the auth mount (degraded mode: no sign-up or recovery links)', 'open / while signed out', { file: named('account-login-default', variant) });
      });
    });
  }
  scenario('shell-account-outlet', async ctx => {
    const variant = SHELL_VARIANTS[0];
    await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
      await tokens(page);
      await page.getByRole('button', { name: 'New token', exact: true }).first().click(); await page.getByLabel('Name', { exact: true }).fill('nightly-export'); await settle(page);
      await shot('account', '', 'New token form above the table', 'New token', { file: 'account-settings-tokens-new-1440.png' });
      await page.getByRole('button', { name: 'Create token', exact: true }).click(); await page.getByLabel('One-time token secret', { exact: true }).waitFor(); await settle(page, 400);
      await shot('account', '', 'One-time secret panel in place of the form, masked', 'Create token', { file: 'account-settings-tokens-secret-1440.png' });
    });
    await withScene(ctx, variant, { fixture: seededFixture(manyTokens) }, async ({ page, shot }) => {
      await tokens(page); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2)); await settle(page, 400);
      await shot('account', '', `${LONG_TOKEN_LIST} issued tokens: the document scrolls, section header and table header stick`, 'scroll the document', { file: 'account-settings-tokens-long-scrolled-1440.png' });
      await inspect(page, ctx.recorder, 'account-outlet-long-list');
    });
  });
}
