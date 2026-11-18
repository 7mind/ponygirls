import { PRIMARY, VARIANTS, withScene, gotoTab, settle, inspect, sleep } from './lib.mjs';
import { seededFixture } from './seed.mjs';

export function registerOther(scenario) {
  // ---- login (shared account module in the auth mount; mockup-named shots are in scenes-shell.mjs)
  scenario('login-flows', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.signedIn = false; }), waitSignedIn: false }, async ({ page, shot }) => {
      await page.locator('main[data-account-auth] form[data-account-login]').waitFor();
      await page.getByLabel('Username', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.locator('[data-account-login-error]:not([hidden])').waitFor(); await settle(page, 300);
      await shot('login', 'error', 'Login error under the card heading', 'submit wrong password', { file: 'account-login-error-1440.png' });
    });
  });
  // ---- masthead / chrome / global states
  scenario('chrome', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor();
      await page.keyboard.press('Tab'); await settle(page, 200);
      await shot('chrome', 'skip-link-focus', 'First Tab press: skip-to-content link appears at the top left', 'press Tab once on a fresh page');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor();
      await page.getByRole('button', { name: 'Theme settings' }).click(); await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click(); await settle(page, 500);
      await shot('chrome', 'forced-dark-archive', 'Archive after choosing Dark in the theme menu (class/data-theme path, as opposed to the OS colour-scheme path in the -dark captures)', 'Theme menu > Dark');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.mode = 'version'; }), waitSignedIn: false }, async ({ page, shot }) => {
      await page.getByRole('heading', { name: 'Dashboard update required' }).waitFor(); await settle(page, 400);
      await shot('chrome', 'update-required', 'Terminal state "Dashboard update required"', 'server answers version-mismatch');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.whoamiFailure = 'Identity service temporarily unavailable.'; }), waitSignedIn: false }, async ({ page, shot }) => {
      await page.getByRole('heading', { name: 'Session unavailable' }).waitFor(); await settle(page, 500);
      await shot('chrome', 'session-unavailable', 'State "Session unavailable": whoami failed, retry button, no navigation', 'whoami returns an error');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.archive-row').first().waitFor();
      fixture.blackholeActive(); await page.waitForFunction(() => /stale|retrying|connecting|offline/.test(document.querySelector('.connection-widget')?.getAttribute('data-state') ?? ''), null, { timeout: 40000 }).catch(() => null); await settle(page, 500);
      await shot('chrome', 'connection-lost', 'Masthead connection indicator after the active socket stops answering (content stays on screen)', 'server stops answering pings');
    });
  });
}
