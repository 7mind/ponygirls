// Behavioral-Active / Blackbox-Group; regression: catalogue and manifest overflow.
// The browser runs the shipped UI/codecs against a controlled current-API boundary.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../web/dashboard/', import.meta.url));
const require = createRequire(path.join(process.env.MANURE_PLAYWRIGHT_CORE_PATH, 'package.json'));
const { chromium } = require('playwright-core');
const long = 'long-unbroken-metadata-'.repeat(18);
const artifacts = [0, 1].map(index => ({ artifactId: String(index).repeat(32), name: long + index,
  kind: 'Directory', visibility: 'Public', state: 'Ready', createdByUser: long,
  createdAt: '2026-01-01T00:00:00Z', expiresAt: null, totalBytes: '9876543210123', fileCount: 1234567,
  contentUrl: 'http://' + String(index).repeat(32) + '.example.invalid/' }));
const commands = [];
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/current') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const { requestId, command } = JSON.parse(raw); commands.push(command);
      let result;
      if (command.Whoami) result = { Identity: { principal: { userId: long, tokenId: 'layout', principalType: 'Human' } } };
      else if (command.GetCapabilities) result = { CapabilityInfo: { capabilities: {
        contentMode: 'Subdomain', searchModes: ['Lexical'], metadataOnlySearch: true, chunkBytes: 1048576,
        maxListLimit: 100, maxRequestBodyBytes: '1048576', maxFileBytes: '99999999999999', maxArtifactBytes: '99999999999999',
        maxFilesPerArtifact: 2000000, maxTtlSeconds: 86400, cataloguePolicy: 'layout-fixture' } } };
      else if (command.ListArtifacts) result = { Catalogue: { page: { artifacts, nextCursor: null } } };
      else if (command.GetArtifact) result = { ArtifactInfo: { artifact: artifacts[0] } };
      else if (command.GetManifest) result = { ArtifactManifest: { manifest: { artifactId: artifacts[0].artifactId, state: 'Ready',
        files: [{ File: { path: long + '/file.txt', size: '9876543210123', sha256: 'a'.repeat(64) } }] } } };
      else throw new Error('Unexpected command: ' + Object.keys(command));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ requestId, result }));
    } else {
      const name = req.url === '/' ? 'index.html' : req.url.slice(1);
      assert(!name.includes('..'));
      res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile(path.join(root, name)));
    }
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.MANURE_CHROMIUM_BIN, args: ['--no-sandbox', '--no-proxy-server'] });
const out = process.env.MANURE_UX_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
try {
  for (const width of [1440, 1351, 1350, 1024, 801, 800, 571, 570, 390, 320]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#artifact-list > tr').first().waitFor();
      if (out) await page.screenshot({ path: path.join(out, `catalogue-${width}-${colorScheme}.png`), fullPage: true });
      const noOverflow = async selector => {
        const measurements = await page.locator(selector).evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scroll: node.scrollWidth })));
        for (const value of measurements) assert(value.scroll <= value.width + 1, `${width}/${colorScheme} ${selector}: ${JSON.stringify(value)}`);
      };
      await noOverflow('html, #results-panel, .artifacts, .artifacts th, .artifacts td');
      assert.equal(await page.getByRole('table').count(), 1, 'responsive layout retains table semantics');
      assert.equal(await page.getByRole('columnheader').count(), 10, 'all accessible column headers retained');
      assert.equal(await page.getByRole('cell').count(), 20, 'all accessible metadata cells retained');
      assert.equal(await page.getByRole('row').count(), 3, 'header and data row semantics retained');
      const snapshot = await page.locator('.artifacts').ariaSnapshot();
      for (const role of ['table', 'rowgroup', 'row', 'columnheader', 'cell']) assert(snapshot.includes('- ' + role), `accessible ${role} preserved`);
      for (const sort of ['name', 'kind', 'visibility', 'state', 'total_bytes', 'file_count', 'created_at', 'expires_at', 'created_by_user']) {
        const button = page.locator(`[data-sort="${sort}"]`);
        await button.focus();
        const response = page.waitForResponse(res => res.url().endsWith('/api/current') && res.request().postDataJSON().command.ListArtifacts);
        await page.keyboard.press('Enter'); await response;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForFunction(key => document.querySelector(`[data-sort="${key}"]`).closest('th').getAttribute('aria-sort') !== 'none', sort);
        await page.waitForFunction(() => document.querySelector('#list-status').textContent.includes('shown') && document.querySelectorAll('#artifact-list > tr').length === 2);
        assert.equal(commands.at(-1).ListArtifacts.query.sort, sort.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join(''), 'sort sends selected key');
      }
      for (let index = 0; index < 2; index++) for (const action of ['details', 'open', 'delete']) {
        await page.keyboard.press('Tab');
        const focused = page.locator(':focus');
        assert.equal(await focused.getAttribute('data-action'), action, 'Tab reaches each row action in order');
        const box = await focused.boundingBox();
        const panel = await page.locator('#results-panel').boundingBox();
        const header = await page.locator('.artifacts thead').boundingBox();
        assert(box.y >= Math.max(0, panel.y) && box.y + box.height <= Math.min(1000, panel.y + panel.height) + 1, 'keyboard focus visible in scrollport');
        assert(box.y >= header.y + header.height - 1, 'sticky sort controls do not obscure keyboard focus');
      }
      for (const row of await page.locator('#artifact-list > tr').all()) {
        assert.equal(await row.locator('td').count(), 10, 'all metadata retained');
        assert.equal(await row.locator('.owner-cell').textContent(), long);
        for (const action of ['open', 'delete', 'details']) {
          const button = row.locator(`[data-action="${action}"]`);
          await button.scrollIntoViewIfNeeded(); await button.focus();
          assert(await button.evaluate(node => node === document.activeElement));
          const box = await button.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1, `${action} within viewport`);
        }
      }
      await page.locator('#artifact-list [data-action=details]').first().click();
      await page.locator('#file-list tr').waitFor();
      if (out) await page.screenshot({ path: path.join(out, `manifest-${width}-${colorScheme}.png`), fullPage: true });
      await noOverflow('html, .manifest-panel, .manifest-panel table, .manifest-panel td');
      assert.match(await page.locator('#file-list').textContent(), /file.txt/);
      const download = page.locator('#file-list a, #file-list button').first();
      await download.focus(); assert(await download.evaluate(node => node === document.activeElement));
      assert.deepEqual(errors, []);
      console.log(`ok - catalogue/manifest ${width}px ${colorScheme}: overflow, metadata, keyboard actions and nine sorts`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
