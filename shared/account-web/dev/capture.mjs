// Renders every harness scenario to PNG, named like the mockup shots (account-<surface>-<state>[-variant]-<width>.png),
// and prints the vertical scroll containers of each render (DOM measurement, spec §8 item 1).
//   nix develop .#chronicle --command node shared/account-web/dev/capture.mjs [outDir] [name-prefix…]
// Default outDir: .local/overhaul-20261117/ux/account/after under the main checkout (ACCOUNT_CAPTURE_DIR overrides).
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { startDevServer } from './serve.mjs';
import { SCENARIOS } from './scenarios.js';

const require = createRequire(new URL('../../../chronicle/web/package.json', import.meta.url));
const { chromium } = require('playwright-core');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned Chromium environment (nix develop .#chronicle); no browser downloads.');

const DEFAULT_OUT = '/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/ux/account/after';
const WIDE = { w: 1440, h: 900 }, NARROW = { w: 1024, h: 700 }, PHONE = { w: 390, h: 844 };
const READY_TIMEOUT_MS = 10_000;
const LONG_LIST_SCROLL_PX = 700;
// Main states also rendered at 1024×700, 390×844 and in dark (spec: 1440 for all; 1024, 390 and dark for the main ones).
const MAIN = ['login-default', 'signup-default', 'settings-tokens', 'settings-tokens-secret', 'users-default'];

const shots = [];
for (const name of SCENARIOS.keys()) shots.push({ file: `account-${name}-${WIDE.w}`, scenario: name, ...WIDE, theme: 'light', app: 'chronicle', scroll: 0 });
for (const name of MAIN) {
  shots.push({ file: `account-${name}-${NARROW.w}`, scenario: name, ...NARROW, theme: 'light', app: 'chronicle', scroll: 0 });
  shots.push({ file: `account-${name}-${PHONE.w}`, scenario: name, ...PHONE, theme: 'light', app: 'chronicle', scroll: 0 });
  shots.push({ file: `account-${name}-dark-${WIDE.w}`, scenario: name, ...WIDE, theme: 'dark', app: 'chronicle', scroll: 0 });
}
shots.push(
  { file: 'account-login-default-haystack-1440', scenario: 'login-default', ...WIDE, theme: 'light', app: 'haystack', scroll: 0 },
  { file: 'account-login-default-manure-1440', scenario: 'login-default', ...WIDE, theme: 'light', app: 'manure', scroll: 0 },
  { file: 'account-settings-tokens-haystack-1440', scenario: 'settings-tokens', ...WIDE, theme: 'light', app: 'haystack', scroll: 0 },
  { file: 'account-settings-tokens-manure-1440', scenario: 'settings-tokens-secret', ...WIDE, theme: 'light', app: 'manure', scroll: 0 },
  { file: 'account-settings-tokens-long-scrolled-1440', scenario: 'settings-tokens-long', ...WIDE, theme: 'light', app: 'chronicle', scroll: LONG_LIST_SCROLL_PX });

const args = process.argv.slice(2);
const out = resolve(process.env.ACCOUNT_CAPTURE_DIR ?? args[0] ?? DEFAULT_OUT);
const prefixes = args.slice(1);
const wanted = shots.filter(shot => prefixes.length === 0 || prefixes.some(prefix => shot.file.startsWith(prefix)));
await mkdir(out, { recursive: true });
const server = await startDevServer({ port: 0 });
const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const shot of wanted) {
    const context = await browser.newContext({ viewport: { width: shot.w, height: shot.h }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${server.origin}/?scenario=${shot.scenario}&app=${shot.app}&theme=${shot.theme}`);
      await page.waitForFunction(() => document.documentElement.dataset.harnessReady === 'true', null, { timeout: READY_TIMEOUT_MS });
      if (shot.scroll > 0) await page.evaluate(top => window.scrollTo(0, top), shot.scroll);
      await page.evaluate(() => document.fonts.ready);
      const scrollers = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0;
      }).map(element => element.tagName.toLowerCase() + (element.className ? `.${String(element.className).split(' ').join('.')}` : '')));
      const documentScrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight);
      const horizontal = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1);
      await page.screenshot({ path: join(out, `${shot.file}.png`) });
      if (errors.length > 0) failures++;
      console.log(`${shot.file} | document ${documentScrolls ? 'scrolls' : 'fits'} | inner scrollers: ${scrollers.join(' ; ') || 'none'}${horizontal ? ' | H-OVERFLOW' : ''}${errors.length > 0 ? ` | ERRORS ${errors.join(' / ')}` : ''}`);
    } catch (cause) {
      failures++;
      console.log(`${shot.file} | FAILED ${cause.message.split('\n')[0]}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await server.close(); }
console.log(`${wanted.length - failures} of ${wanted.length} captures written to ${out}`);
if (failures > 0) process.exitCode = 1;

