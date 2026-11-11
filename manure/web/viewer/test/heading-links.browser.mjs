import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; specified heading permalinks.
test('Markdown heading permalinks support direct URLs, clicks and history', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN to an installed Chromium executable');
  const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const filler = '\n\n' + 'Paragraph of document content.\n\n'.repeat(35);
  const markdown = '# Hello *world*!\n\n[Jump](#repeat-1)\n\n<div id="reserved"></div>\n' + filler +
    '## Repeat\n\n### Repeat\n\n#### Repeat-1\n\n##### !!!\n\n###### Café 東京\n' + filler + '## Reserved\n\n## Content\n' + filler + '<h2 id="custom">Authored ID</h2>\n\n[Custom jump](#custom)\n' + filler +
    '## Hello world heading text\n\n<h2 aria-label="Authored section">Visible section</h2>\n\n<h2><img alt="Image section"></h2>\n\n<h2 id="self-topic" aria-labelledby="self-topic">Self title</h2>\n\n<h2 aria-label="">Empty label title</h2>\n';
  const probe = `
    const delay = () => new Promise(resolve => setTimeout(resolve, 50));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    try {
      let article;
      for (let i = 0; i < 100; i++) {
        article = document.querySelector('article.markdown');
        if (article && document.querySelector('#status').textContent === '') break;
        await delay();
      }
      check(article, 'Markdown did not render');
      const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      const expected = ['hello-world','repeat','repeat-1','repeat-1-1','section','café-東京','reserved-1','content-1','custom','hello-world-heading-text','visible-section','section-1','self-topic','empty-label-title'];
      check(JSON.stringify(headings.map(h => h.id)) === JSON.stringify(expected), 'missing or incorrect heading IDs: ' + headings.map(h => h.id));
      check(new Set([...document.querySelectorAll('[id]')].map(n => n.id)).size === document.querySelectorAll('[id]').length, 'duplicate document IDs');
      for (const heading of headings) {
        const link = heading.querySelector('a.heading-anchor');
        check(link && link.hash === '#' + encodeURIComponent(heading.id), 'missing heading permalink');
        check(link.getAttribute('aria-label').includes('Link to section:'), 'missing accessible link label');
        if (heading.getAttribute('aria-label')) {
          check(heading.getAttribute('aria-label') === 'Authored section', 'authored heading label changed');
        } else {
          const label = document.getElementById(heading.getAttribute('aria-labelledby'));
          check(label && heading.contains(label) && !label.contains(link), 'permalink must not change the heading accessible name');
        }
      }
      check(headings[0].querySelector('em').textContent === 'world', 'inline formatting lost');
      const aligned = heading => Math.abs(heading.getBoundingClientRect().top) < 3;
      if (location.hash.includes('%ZZ')) {
        check(!document.querySelector('[role="alert"]'), 'malformed fragment prevented rendering');
      } else {
        check(aligned(headings[5]), 'initial encoded fragment did not scroll after fetch');
      }
      headings[2].querySelector('a.heading-anchor').click();
      await delay();
      check(location.hash === '#repeat-1' && aligned(headings[2]), 'permalink click did not navigate');
      history.back();
      await delay(); await delay();
      if (!location.hash.includes('%ZZ')) check(aligned(headings[5]), 'history back did not restore section');
      article.querySelector('a[href="#repeat-1"]').click();
      await delay();
      check(aligned(headings[2]), 'authored fragment link did not navigate');
      article.querySelector('a[href="#custom"]').click();
      await delay();
      check(aligned(headings[8]), 'existing authored heading ID stopped resolving');
      location.hash = '#unknown';
      await delay();
      check(!document.querySelector('[role="alert"]'), 'unknown fragment prevented rendering');
      document.body.dataset.result = 'pass';
    } catch (error) { document.body.dataset.result = error.message; }
  `;
  const html = template.replaceAll('__MANURE_ASSET_BASE__', '/assets').replaceAll('__MANURE_PATH__', 'readme.md').replaceAll('__MANURE_RAW_URL__', '/__manure/raw/readme.md').replaceAll('__MANURE_DOWNLOAD_URL__', '/download').replaceAll('__MANURE_KIND__', 'markdown').replace('</body>', '<script type="module" src="/probe.js"></script></body>');
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
        res.end(html);
      } else if (req.url === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(probe); }
      else if (req.url === '/__manure/raw/readme.md') { setTimeout(() => res.end(markdown), 100); }
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`, import.meta.url)));
      } else { res.statusCode = 404; res.end(); }
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'manure-headings-'));
  try {
    for (const fragment of ['caf%C3%A9-%E6%9D%B1%E4%BA%AC', '%ZZ']) {
      const { stdout } = await promisify(execFile)(process.env.CHROMIUM_BIN, [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`,
        '--dump-dom', '--virtual-time-budget=10000', `http://127.0.0.1:${server.address().port}/#${fragment}`,
      ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.match(stdout, /data-result="pass"/, stdout.match(/data-result="[^"]*"/)?.[0] || 'heading probe did not finish');
    }
  } finally { await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
});
