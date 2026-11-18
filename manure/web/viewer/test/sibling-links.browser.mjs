import { test } from 'node:test';
import { serveUi, UI_BASE } from './shared-ui.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Effectual / Good Communication; sibling-navigation regression.
test('rendered Markdown retains sibling artifact hyperlinks without requesting sibling resources', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN to an installed Chromium executable');
  const current = '/view/11111111111111111111111111111111';
  const sibling = '/view/22222222222222222222222222222222';
  const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const html = template.replaceAll('__MANURE_ASSET_BASE__', '/assets').replaceAll('__MANURE_UI_BASE__', UI_BASE).replaceAll('__MANURE_PATH__', 'docs/readme.md')
    .replaceAll('__MANURE_RAW_URL__', `${current}/__manure/raw/docs/readme.md`).replaceAll('__MANURE_DOWNLOAD_URL__', '/download')
    .replaceAll('__MANURE_CREATED_AT__', '2026-01-02T03:04:05Z').replaceAll('__MANURE_KIND__', 'markdown').replace('</body>', '<script type="module" src="/probe.js"></script></body>');
  const paths = [sibling, sibling + '/', sibling + '#7-limits', sibling + '/docs/guide.md#topic'];
  const probe = `
    const timer = setInterval(() => {
      if (document.querySelector('#status').textContent) return;
      clearInterval(timer);
      try {
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        const article = document.querySelector('article.markdown');
        check(article, 'Markdown did not render');
        const paths = ${JSON.stringify(paths)};
        for (const path of paths) {
          const href = location.origin + path;
          const link = [...article.querySelectorAll('a')].find(node => node.textContent === href);
          check(link && link.getAttribute('href') === href, 'sibling href must survive: ' + href + ' (observed ' + link?.getAttribute('href') + ')');
          check(link.getAttribute('rel') === 'noopener noreferrer', 'sibling links must suppress the referrer');
        }
        for (const label of ['Rooted sibling', 'Raw sibling']) {
          const link = [...article.querySelectorAll('a')].find(node => node.textContent === label);
          check(link && link.getAttribute('href') === location.origin + ${JSON.stringify(sibling)}, label + ' href missing');
        }
        for (const label of ['Relative escape', 'Reserved sibling', 'Management sibling', 'Arbitrary sibling']) {
          const link = [...article.querySelectorAll('a')].find(node => node.textContent === label);
          check(link && !link.hasAttribute('href'), label + ' must remain inert');
        }
        const image = article.querySelector('img[alt="Sibling image"]');
        check(image && !image.hasAttribute('src'), 'sibling image must remain inert');
        document.body.dataset.result = 'pass';
      } catch (error) { document.body.dataset.result = error.message; }
    }, 50);
  `;
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    try {
      if (req.url === current + '/') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
        res.end(html);
      } else if (req.url === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(probe); }
      else if (req.url === `${current}/__manure/raw/docs/readme.md`) {
        const origin = `http://127.0.0.1:${server.address().port}`;
        res.end('# Sibling links\n\n' + paths.map(path => origin + path).join('\n\n') +
          `\n\n[Rooted sibling](${sibling})\n\n<a href="${origin + sibling}">Raw sibling</a>\n\n` +
          `[Relative escape](../../22222222222222222222222222222222/guide.md)\n\n` +
          `[Reserved sibling](${sibling}/__manure/logout)\n\n[Management sibling](${sibling}/api/users)\n\n` +
          '[Arbitrary sibling](/view/other/guide.md)\n\n' + `![Sibling image](${sibling}/image.png)\n`);
      } else if (await serveUi(req, res)) { /* shared design system */ }
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`, import.meta.url)));
      } else { res.statusCode = 404; res.end(); }
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'manure-siblings-'));
  try {
    const { stdout } = await promisify(execFile)(process.env.CHROMIUM_BIN, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`,
      '--dump-dom', '--virtual-time-budget=10000', `http://127.0.0.1:${server.address().port}${current}/`,
    ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.match(stdout, /data-result="pass"/, stdout.match(/data-result="[^"]*"/)?.[0] || 'sibling probe did not finish');
    assert.deepEqual(requests.filter(url => url.startsWith(sibling)), [], 'rendering must not request sibling links or images');
  } finally { await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
});
