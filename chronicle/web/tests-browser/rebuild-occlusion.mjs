// Behavioral-Active Blackbox / Good Communication; regression: a fixed health
// chip must not intercept a persistent rebuild confirmation's Cancel control.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture } from './goal50-fixture.mjs';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use provisioned browsers; no downloads.');
const phase = process.env.OCCLUSION_PHASE === undefined ? 'current' : process.env.OCCLUSION_PHASE;
const output = fileURLToPath(new URL(`../../../.local/ui-evidence/phase3/occlusion/${phase}/`, import.meta.url)); await mkdir(output, { recursive: true });
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
try {
  for (const width of [320, 390]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }), page = await context.newPage(), fixture = new Goal50Fixture(); fixture.archiveRowCount = 3;
    page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message)); await page.clock.install(); await fixture.install(page);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests-browser/goal50.html`); await page.locator('.archive-row').first().waitFor(); await page.getByRole('button', { name: 'activity', exact: true }).click(); await page.getByRole('button', { name: 'Rebuild archive index', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Archive rebuild preview', exact: true }); await preview.getByRole('checkbox').waitFor();
    // Match the original cropped screenshot's scrolling behavior, then measure
    // actual viewport hit ownership rather than interpreting image pixels.
    await preview.screenshot({ path: `${output}/${theme}-${width}-preview.png` });
    const cancel = preview.getByRole('button', { name: 'Cancel archive rebuild preview', exact: true });
    const geometry = await cancel.evaluate(element => {
      const rect = value => { const r = value.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const button = rect(element), healthElement = document.querySelector('.connection-widget>button'), health = rect(healthElement);
      const intersection = { left: Math.max(button.left, health.left), right: Math.min(button.right, health.right), top: Math.max(button.top, health.top), bottom: Math.min(button.bottom, health.bottom) };
      const intersects = intersection.right > intersection.left && intersection.bottom > intersection.top;
      const points = [];
      for (const offset of [4, 8, 16, 24]) for (const fraction of [.25, .5, .75]) points.push({ x: button.right - offset, y: button.top + button.height * fraction });
      if (intersects) points.push({ x: (intersection.left + intersection.right) / 2, y: (intersection.top + intersection.bottom) / 2 });
      const probes = points.filter(point => point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight).map(point => { const hit = document.elementFromPoint(point.x, point.y); return { ...point, owned: hit === element || element.contains(hit), hit: hit === null ? null : `${hit.tagName}.${hit.className}` }; });
      return { viewport: { width: innerWidth, height: innerHeight }, cancel: button, cancelClientRects: [...element.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })), health, healthPosition: getComputedStyle(healthElement.parentElement).position, intersects, intersection, probes };
    });
    const wrong = geometry.probes.find(probe => !probe.owned), point = wrong === undefined ? geometry.probes[0] : wrong;
    assert.ok(point !== undefined, 'Reproduction requires an in-viewport interior Cancel probe');
    await page.screenshot({ path: `${output}/${theme}-${width}-viewport.png` });
    await page.mouse.click(point.x, point.y);
    const outcome = { previewVisible: await preview.isVisible(), connectionOpened: await page.locator('.health-panel:popover-open').count() > 0 };
    const failures = [];
    try { assert.ok(geometry.probes.every(probe => probe.owned), 'Every interior Cancel probe must hit Cancel, not another control'); } catch (error) { failures.push(error.message); }
    try { assert.equal(outcome.previewVisible, false, 'Clicking the probed Cancel point must cancel the persistent preview'); assert.equal(outcome.connectionOpened, false, 'Cancel click must not open Connection details'); } catch (error) { failures.push(error.message); }
    if (failures.length === 0) {
      const health = page.getByRole('button', { name: /^Connection:/ }); await health.click(); await page.locator('.health-panel:popover-open').waitFor(); await page.keyboard.press('Escape');
      assert.equal(await health.evaluate(element => element === document.activeElement), true, 'Connection status remains accessible with native focus return');
      await health.press('Enter'); await page.locator('.health-panel:popover-open').waitFor(); await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Reserved health placement must retain narrow viewport fit');
    }
    results.push({ width, theme, geometry, clicked: point, outcome, failures }); console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} rebuild occlusion ${theme}-${width}: ${JSON.stringify({ intersects: geometry.intersects, clicked: point, outcome, failures })}`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2)); }
assert.equal(results.length, 4); assert.ok(results.every(result => result.failures.length === 0), 'Cancel must own its interior hit targets at both narrow widths/palettes');
