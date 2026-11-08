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
  kind: 'Directory', visibility: index === 0 ? 'External' : 'Public', state: 'Ready', createdByUser: long,
  createdAt: '2026-01-01T00:00:00Z', expiresAt: null, totalBytes: '9876543210123', fileCount: 1234567,
  contentUrl: 'http://' + String(index).repeat(32) + '.example.invalid/' }));
const commands = [];
let passwordMode = 'current';
let passwordRequested;
let releasePassword;
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'PUT') {
      let size = 0; for await (const chunk of req) size += chunk.length;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: 'clipboard.txt', offset: '0', length: size, receivedBytes: String(size) }));
    } else if (req.url === '/api/current') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const { requestId, command } = JSON.parse(raw); commands.push(command);
      let result;
      if (command.Whoami) result = { Identity: { principal: { userId: long, tokenId: 'layout', principalType: 'Human' } } };
      else if (command.GetCapabilities) result = { CapabilityInfo: { capabilities: {
        contentMode: 'Subdomain', searchModes: ['Lexical'], metadataOnlySearch: true, chunkBytes: 1048576,
        maxListLimit: 100, maxRequestBodyBytes: '1048576', maxFileBytes: '99999999999999', maxArtifactBytes: '99999999999999',
        maxFilesPerArtifact: 2000000, maxTtlSeconds: 86400, cataloguePolicy: 'layout-fixture' } } };
      else if (command.ListArtifacts) result = { Catalogue: { page: { artifacts, nextCursor: null } } };
      else if (command.InitUpload) result = { UploadInitialized: { artifactId: 'a'.repeat(32), chunkBytes: 1048576,
        contentUrl: 'http://example.invalid/', externalPassword: 'A'.repeat(43) } };
      else if (command.FinishUpload) result = { UploadFinished: { artifactId: 'a'.repeat(32), state: 'Ready', contentUrl: 'http://example.invalid/' } };
      else if (command.GetExternalPassword) {
        if (passwordMode === 'held') {
          passwordRequested();
          await new Promise(resolve => { releasePassword = resolve; });
        }
        result = { ExternalPasswordRetrieved: { externalPassword: passwordMode === 'legacy' ? null : 'B'.repeat(42) + 'A' } };
      }
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
  // Specified Behavioral-Active / Blackbox-Group: clipboard boundary is controlled.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => {
        if (window.denyClipboard) throw new Error('controlled denial');
        window.copied.push(value);
      } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#artifact-list > tr').first().waitFor();
    await page.locator('#upload-external').check();
    await page.locator('#upload-files').setInputFiles({ name: 'clipboard.txt', mimeType: 'text/plain', buffer: Buffer.from('copy me') });
    await page.locator('#upload-submit').click();
    await page.waitForFunction(() => document.querySelector('#upload-list').textContent.includes('ready'));
    const copy = page.locator('#upload-list').getByRole('button', { name: 'Copy password', exact: true });
    assert.equal(await copy.count(), 1, 'issued upload password has an explicit Copy button');
    await copy.click();
    await page.waitForFunction(() => document.querySelector('#upload-status').textContent.includes('Password copied'));
    assert.equal(await page.evaluate(() => window.copied.length === 1 && window.copied[0] === 'A'.repeat(43)), true, 'copies password, not URL');
    await page.evaluate(() => { window.denyClipboard = true; });
    await copy.click();
    await page.waitForFunction(() => document.querySelector('#upload-status').textContent.includes('denied'));
    await page.locator('#upload-list').getByRole('button', { name: 'Dismiss password', exact: true }).click();
    assert.equal(await copy.count(), 0);
    assert.equal(await page.locator('#upload-list code').count(), 0);
    console.log('ok - upload password copying, clipboard denial and dismissal');
    await page.evaluate(() => { window.denyClipboard = false; });
    await page.locator('#artifact-list [data-action=details]').first().click();
    await page.locator('#file-list tr').waitFor();
    const currentPassword = page.getByRole('button', { name: 'Copy current password', exact: true });
    assert.equal(await currentPassword.count(), 1, 'external artifact exposes authenticated current-password copy');
    await currentPassword.click();
    await page.waitForFunction(() => window.copied.length === 2);
    assert.equal(await page.evaluate(() => window.copied[1] === 'B'.repeat(42) + 'A'), true);
    assert.equal(commands.some(command => command.RotateExternalPassword), false, 'copy must not rotate');
    await page.locator('#rotate-dismiss-button').click();
    assert.equal(await page.locator('#rotate-password').textContent(), '');
    passwordMode = 'legacy';
    await currentPassword.click();
    await page.waitForFunction(() => !document.querySelector('#get-password-button').disabled);
    assert.match(await page.locator('#detail-status').textContent(), /Rotate once/, 'legacy password requires explicit rotation');
    assert.equal(await page.locator('#rotate-output').isVisible(), false, 'legacy password is not invented');
    passwordMode = 'held';
    const requested = new Promise(resolve => { passwordRequested = resolve; });
    await Promise.all([requested, currentPassword.click()]);
    await page.locator('#detail-back-button').click();
    const delivered = page.waitForResponse(response => response.url().endsWith('/api/current') && response.request().postDataJSON().command.GetExternalPassword);
    releasePassword();
    await (await delivered).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => !document.querySelector('#dashboard-section').hidden);
    assert.equal(await page.locator('#rotate-password').textContent(), '', 'stale response cannot reveal another detail password');
    assert.equal(await page.evaluate(() => window.copied.length), 2, 'stale response cannot copy password');
    console.log('ok - current password copy without rotation, legacy recovery and stale response fence');
  } finally { await context.close(); }
  for (const width of [1440, 1351, 1350, 1024, 801, 800, 571, 570, 390, 320]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator('#artifact-list > tr').first().waitFor();
      // Specified: a full-width workspace with session controls in the shared topbar.
      const mainBox = await page.locator('#main').boundingBox();
      assert.equal(mainBox.x, 0, 'workspace has no reserved left rail');
      assert.equal(mainBox.width, width, 'workspace uses the viewport width');
      assert.equal(await page.locator('.sidebar, .service-label').count(), 0, 'no obsolete sidebar or service label');
      for (const id of ['whoami', 'whoami-text', 'logout-button']) {
        assert.equal(await page.locator(`#${id}`).count(), 1, 'session control is not duplicated');
        assert.equal(await page.locator(`.topbar #${id}`).isVisible(), true, 'session control lives in topbar');
      }
      assert.equal(await page.locator('#whoami-text').textContent(), long, 'long identity retained');
      const identityBox = await page.locator('#whoami').boundingBox();
      const brandBox = await page.locator('.topbar .brand').boundingBox();
      assert(identityBox.x >= brandBox.x + brandBox.width, 'identity is right of brand');
      const presets = page.getByRole('group', { name: 'Access query presets' });
      assert.equal(await presets.locator('button').count(), 4);
      assert.equal(await page.locator('[data-visibility-preset]').count(), 4, 'no hidden duplicate presets');
      const presetBox = await presets.boundingBox();
      const searchBox = await page.locator('.search-actions').boundingBox();
      assert(presetBox.y >= searchBox.y + searchBox.height, 'presets are under search row');
      assert(presetBox.y - searchBox.y - searchBox.height <= 16, 'presets directly follow search row');
      const listCount = commands.filter(command => command.ListArtifacts).length;
      for (const value of ['internal', 'external', 'public', '']) {
        const preset = presets.locator(`[data-visibility-preset="${value}"]`);
        await preset.focus();
        await page.keyboard.press('Enter');
        assert.equal(await presets.locator('[data-visibility-preset=""]').getAttribute('aria-pressed'), 'true', 'pressed preset continues to describe applied query');
        assert.equal(await presets.locator('[aria-pressed=true]').count(), 1);
        assert.equal(await page.locator('#filter-text').inputValue(), value ? `access:${value} ` : '');
        assert.equal(commands.filter(command => command.ListArtifacts).length, listCount, 'presets only edit draft');
        const box = await preset.boundingBox();
        assert(box.height <= 36 && box.x >= 0 && box.x + box.width <= width, 'compact visible preset');
      }
      await page.locator('#logout-button').focus();
      assert(await page.locator('#logout-button').evaluate(node => node === document.activeElement));
      // The fixture uses Subdomain; also exercise the fixed Path-mode safety notice.
      await page.locator('#path-mode-warning').evaluate(node => { node.hidden = false; });
      const warningBox = await page.locator('#path-mode-warning').boundingBox();
      for (const selector of ['.topbar .brand', '#whoami', '#logout-button']) {
        const box = await page.locator(selector).boundingBox();
        assert(box.x + box.width <= warningBox.x, `${width}/${colorScheme}: ${selector} leaves room for hosting warning`);
      }
      await page.locator('#path-mode-warning').focus();
      assert(await page.locator('#path-mode-warning').evaluate(node => node === document.activeElement), 'hosting warning remains keyboard accessible');
      assert.equal(await page.locator('#results-help').textContent(), 'Sort all matching artifacts by any column. Scroll down within results to load more. All metadata and actions fit the available width.', 'runtime catalogue help describes wrapping, not horizontal scrolling');
      if (out) await page.screenshot({ path: path.join(out, `catalogue-${width}-${colorScheme}.png`), fullPage: true });
      const noOverflow = async selector => {
        const measurements = await page.locator(selector).evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scroll: node.scrollWidth })));
        for (const value of measurements) assert(value.scroll <= value.width + 1, `${width}/${colorScheme} ${selector}: ${JSON.stringify(value)}`);
      };
      await noOverflow('html, .topbar, #whoami, #results-panel, .artifacts, .artifacts th, .artifacts td');
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
      assert.equal(await page.locator('.topbar #whoami').isVisible(), true, 'detail keeps session identity');
      assert.equal(await page.locator('.topbar #logout-button').isVisible(), true, 'detail keeps logout');
      assert.equal(await presets.isVisible(), false, 'catalogue presets do not become detail navigation');
      assert.match(await page.locator('#file-list').textContent(), /file.txt/);
      const download = page.locator('#file-list a, #file-list button').first();
      await download.focus(); assert(await download.evaluate(node => node === document.activeElement));
      assert.deepEqual(errors, []);
      console.log(`ok - catalogue/manifest ${width}px ${colorScheme}: overflow, metadata, keyboard actions and nine sorts`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
