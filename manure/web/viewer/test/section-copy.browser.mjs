import { test } from 'node:test';
import { serveUi, UI_BASE } from './shared-ui.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; specified source copying and table links.
test('section and table controls copy original source and navigate stable fragments', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN');
  const table = '| Name | Value |\r\n| :--- | ---: |\r\n| *raw* | `one` |\r\n';
  const nested = '> ### Quoted\r\n>\r\n> | Q |\r\n> | - |\r\n> | nested |\r\n';
  const parent = '# Parent *title*\r\n\r\nOriginal [reference][ref].\r\n\r\n## Child\r\n\r\n' + table + '\r\n' + nested + '\r\n[ref]: /local\r\n\r\n';
  const wide = '| ' + Array(30).fill('Column').join(' | ') + ' |\r\n| ' + Array(30).fill('---').join(' | ') + ' |\r\n| ' + Array(30).fill('Value').join(' | ') + ' |\r\n';
  const text = '<script>window.uploadExecuted=true</script>\r\n<img src="https://example.invalid/blocked" onerror="window.uploadExecuted=true">\r\n<div id="table-1"></div>\r\n\r\n' + parent + '# Next\r\n\r\n' + table + '\r\n<h2 id="authored">HTML section</h2>\r\n\r\n<table id="custom-table"><tr><th>HTML</th></tr><tr><td>Raw</td></tr></table>\r\n\r\n' + 'Tail paragraph.\r\n\r\n'.repeat(60) + wide;
  const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const html = template.replaceAll('__MANURE_ASSET_BASE__', '/assets').replaceAll('__MANURE_UI_BASE__', UI_BASE).replaceAll('__MANURE_PATH__', 'readme.md').replaceAll('__MANURE_RAW_URL__', '/__manure/raw/readme.md').replaceAll('__MANURE_DOWNLOAD_URL__', '/download').replaceAll('__MANURE_CREATED_AT__', '2026-01-02T03:04:05Z').replaceAll('__MANURE_KIND__', 'markdown').replace('</body>', '<script type="module" src="/probe.js"></script></body>');
  const probe = `
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const delay = () => new Promise(resolve => setTimeout(resolve, 50));
    try {
      for (let i = 0; i < 100 && document.querySelector('#status').textContent; i++) await delay();
      const article = document.querySelector('article.markdown');
      check(article && !article.querySelector('[role=alert]'), 'preview did not render');
      check(!window.uploadExecuted && !article.querySelector('script,img[src]'), 'uploaded scripts and remote resources remain inert');
      const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      const copies = headings.map(heading => heading.querySelector('button.copy-section'));
      check(copies.every(Boolean), 'every section needs a copy button');
      const tables = [...article.querySelectorAll('table')];
      const wrappers = tables.map(table => table.closest('.markdown-table'));
      check(wrappers.every(Boolean), 'every table needs an anchored wrapper');
      check(JSON.stringify(tables.map(table => table.id)) === JSON.stringify(['table-1-1','table-2','table-3','custom-table','table-5']), 'unique stable table IDs: ' + tables.map(table => table.id));
      check(new Set([...document.querySelectorAll('[id]')].map(node => node.id)).size === document.querySelectorAll('[id]').length, 'duplicate IDs');
      // Tables scroll to just below the sticky viewer bar (their scroll-margin-top).
      const aligned = wrapper => Math.abs(wrapper.getBoundingClientRect().top - parseFloat(getComputedStyle(wrapper).scrollMarginTop)) < 3;
      check(aligned(wrappers[2]), 'initial table fragment did not scroll its table and controls into view');
      let copied;
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async value => {copied=value;}}});
      const copy = async (button, expected) => {
        check(button && button.type === 'button' && button.getAttribute('aria-label'), 'accessible copy button');
        button.focus(); button.click(); await delay();
        check(copied === expected, 'wrong raw copy: ' + JSON.stringify(copied) + ' expected ' + JSON.stringify(expected));
        check(!button.disabled, 'copy remains retryable');
        check(document.querySelector('#toasts').textContent.includes('copied'), 'success feedback');
      };
      await copy(copies[0], ${JSON.stringify(parent)});
      await copy(copies[2], ${JSON.stringify(nested)});
      await copy(wrappers[0].querySelector('button.copy-table'), ${JSON.stringify(table)});
      await copy(wrappers[1].querySelector('button.copy-table'), ${JSON.stringify('> | Q |\r\n> | - |\r\n> | nested |\r\n')});
      await copy(wrappers[2].querySelector('button.copy-table'), ${JSON.stringify(table)});
      await copy(wrappers[3].querySelector('button.copy-table'), '<table id="custom-table"><tr><th>HTML</th></tr><tr><td>Raw</td></tr></table>');
      for (let i = 0; i < tables.length; i++) {
        const link = wrappers[i].querySelector('a.table-anchor');
        check(link && link.getAttribute('aria-label') && link.hash === '#' + encodeURIComponent(tables[i].id), 'accessible table link');
      }
      wrappers[0].querySelector('a.table-anchor').click(); await delay();
      check(location.hash === '#table-1-1' && aligned(wrappers[0]), 'table link navigation');
      history.back(); await delay(); await delay();
      check(location.hash === '#table-3' && aligned(wrappers[2]), 'table history navigation');
      navigator.clipboard.writeText = async () => {throw new Error('denied');};
      copies[0].click(); await delay();
      check(document.querySelector('#toasts').textContent.includes('Could not copy') && !copies[0].disabled, 'denied clipboard feedback and retry');
      Object.defineProperty(navigator, 'clipboard', {value:undefined});
      wrappers[0].querySelector('button.copy-table').click(); await delay();
      check(document.querySelector('#toasts').textContent.includes('Raw'), 'unavailable clipboard guidance');
      check(headings[0].querySelector('em').textContent === 'title', 'heading formatting retained');
      document.body.dataset.result = 'pass';
    } catch (error) { document.body.dataset.result = error.message; }
  `;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"); res.end(html); }
      else if (req.url === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(probe); }
      else if (req.url === '/__manure/raw/readme.md') res.end(text);
      else if (await serveUi(req, res)) { /* shared design system */ }
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`, import.meta.url)));
      } else { res.statusCode = 404; res.end(); }
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const width of [1200, 360]) {
      const profile = await mkdtemp(join(tmpdir(), 'manure-copy-'));
      try {
        const { stdout } = await promisify(execFile)(process.env.CHROMIUM_BIN, [
          '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`,
          `--window-size=${width},900`, '--dump-dom', '--virtual-time-budget=10000', `http://127.0.0.1:${server.address().port}/#table-3`,
        ], { timeout:30000, maxBuffer:4 * 1024 * 1024 });
        assert.match(stdout, /data-result="pass"/, stdout.match(/data-result="[^"]*"/)?.[0] || 'copy probe did not finish');
      } finally { await rm(profile, {recursive:true, force:true}); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
