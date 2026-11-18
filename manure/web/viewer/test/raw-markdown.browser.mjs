import { test } from 'node:test';
import { serveUi, UI_BASE } from './shared-ui.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; specified source-view
// behavior, with a controlled clipboard boundary for success/denial coverage.
for (const scenario of ['markdown', 'render-failure', 'image']) {
  test(`raw Markdown controls: ${scenario}`, async () => {
    assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN');
    const text = scenario === 'render-failure' ? '```mermaid\na-->b\n```\n'.repeat(33) : '# Héllo\r\n\r\n> quote\r\n- item\r\n\tindent\r\n```html\r\n<script>window.uploadExecuted=true</script>\r\n```\r\n<img src="https://example.invalid/unwanted">\r\n';
    const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
    const html = template.replaceAll('__MANURE_ASSET_BASE__', '/assets').replaceAll('__MANURE_UI_BASE__', UI_BASE).replaceAll('__MANURE_PATH__', 'readme.md').replaceAll('__MANURE_RAW_URL__', '/__manure/raw/readme.md').replaceAll('__MANURE_DOWNLOAD_URL__', '/download').replaceAll('__MANURE_CREATED_AT__', '2026-01-02T03:04:05Z').replaceAll('__MANURE_KIND__', scenario === 'image' ? 'image' : 'markdown').replace('</body>', '<script type="module" src="/probe.js"></script></body>');
    const probe = `const check = (value, message) => { if (!value) throw new Error(message); };
      const timer = setInterval(async () => {
        if (document.querySelector('#status').textContent) return;
        clearInterval(timer);
        try {
          const copy = document.querySelector('#copy-raw');
          const modes = document.querySelector('[role=group][aria-label="Markdown view"]');
          if (${JSON.stringify(scenario)} === 'image') {
            check(copy.hidden, 'copy must be hidden for images');
            check(modes.hidden, 'no Markdown view switch for images');
          } else {
            const [rendered, raw] = [...modes.querySelectorAll('button')];
            check(!modes.hidden && rendered.textContent === 'Rendered' && raw.textContent === 'Raw', 'Rendered | Raw switch');
            const panels = [document.getElementById('markdown-preview'), document.getElementById('markdown-source')];
            check(!panels[0].hidden && panels[1].hidden && rendered.getAttribute('aria-pressed') === 'true', 'rendered initially selected');
            raw.click();
            check(panels[0].hidden && !panels[1].hidden && raw.getAttribute('aria-pressed') === 'true', 'raw selected');
            check(panels[1].textContent === ${JSON.stringify(text)}, 'raw text must be exact, including CRLF');
            check(!panels[1].querySelector('img,script'), 'source must be inert');
            check(panels[1].querySelector('.source-code'), 'fences highlighted');
            rendered.click();
            check(!panels[0].hidden && panels[1].hidden, 'switch returns to the rendered view');
            const toast = () => document.querySelector('#toasts').textContent;
            let copied;
            Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text => {copied=text;}}});
            copy.click(); await new Promise(resolve => setTimeout(resolve, 0));
            check(copied === ${JSON.stringify(text)}, 'copy must preserve raw text');
            check(toast() === 'Raw Markdown copied.', 'success feedback');
            navigator.clipboard.writeText = async () => {throw new Error('denied');};
            copy.click(); await new Promise(resolve => setTimeout(resolve, 0));
            check(toast().includes('Could not copy'), 'denial feedback');
            check(!copy.disabled, 'copy can retry');
            Object.defineProperty(navigator, 'clipboard', {value:undefined});
            copy.click(); await new Promise(resolve => setTimeout(resolve, 0));
            check(toast().includes('Raw'), 'manual copy guidance');
            raw.click();
            check(!panels[1].hidden && panels[1].textContent === ${JSON.stringify(text)}, 'raw survives copy failure');
            check(!window.uploadExecuted, 'uploaded scripts never execute');
            if (${JSON.stringify(scenario)} === 'render-failure') check(panels[0].querySelector('[role=alert]'), 'preview error remains visible in the rendered view');
          }
          check(document.querySelector('#download').getAttribute('href').endsWith('/download'), 'download retained');
          document.body.dataset.result = 'passed';
        } catch(error) { document.body.dataset.result = error.message; }
      }, 50);`;
    let fetches = 0;
    const server = createServer(async (req, res) => {
      try {
        if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(html); }
        else if (req.url === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(probe); }
        else if (req.url === '/__manure/raw/readme.md') { fetches++; res.end(text); }
        else if (await serveUi(req, res)) { /* shared design system */ }
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
          res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
          res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`, import.meta.url)));
        } else { res.statusCode = 404; res.end(); }
      } catch { res.statusCode = 500; res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = await mkdtemp(join(tmpdir(), 'manure-raw-'));
    try {
      const { stdout } = await promisify(execFile)(process.env.CHROMIUM_BIN, [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`,
        '--dump-dom', '--virtual-time-budget=10000', `http://127.0.0.1:${server.address().port}/`,
      ], { timeout:30000, maxBuffer:4 * 1024 * 1024 });
      assert.match(stdout, /data-result="passed"/, stdout.match(/data-result="[^"]*"/)?.[0] || 'probe did not finish');
      assert.equal(fetches, 1, 'tabs and copy must reuse fetched text');
    } finally { await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive:true, force:true}); }
  });
}
