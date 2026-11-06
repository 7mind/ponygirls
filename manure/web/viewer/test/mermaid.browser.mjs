import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication (local HTTP + real Chromium).
// Regression: sanitized Mermaid SVG must retain text labels without foreignObject.
test('real Mermaid labels survive sanitization as SVG text', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN to an installed Chromium executable');
  const template = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const probe = `
    const timer = setInterval(async () => {
      const img = document.querySelector('img[alt="Rendered diagram"]');
      if (!img) return;
      clearInterval(timer);
      const svg = new DOMParser().parseFromString(await (await fetch(img.src)).text(),'image/svg+xml');
      document.body.dataset.labels = [...svg.querySelectorAll('text')].map(n => n.textContent).join('|');
      document.body.dataset.foreignObjects = svg.querySelectorAll('foreignObject').length;
    }, 50);
  `;
  const html = template.replaceAll('__MANURE_ASSET_BASE__','/assets').replaceAll('__MANURE_PATH__','readme.md').replaceAll('__MANURE_RAW_URL__','/__manure/raw/readme.md').replaceAll('__MANURE_DOWNLOAD_URL__','/__manure/files/readme.md/content').replaceAll('__MANURE_KIND__','markdown').replace('</body>','<script type="module" src="/probe.js"></script></body>');
  const server = createServer(async (req,res) => {
    try {
      if (req.url === '/') {
        res.setHeader('content-type','text/html');
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
        res.end(html);
      }
      else if (req.url === '/probe.js') {res.setHeader('content-type','text/javascript'); res.end(probe);}
      else if (req.url === '/__manure/raw/readme.md') {res.end('```mermaid\nflowchart LR\n Start --> Finish\n```');}
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type',req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`,import.meta.url)));
      } else {res.statusCode = 404; res.end();}
    } catch {res.statusCode=500; res.end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const profile = await mkdtemp(join(tmpdir(),'manure-mermaid-'));
  try {
    const {stdout} = await promisify(execFile)(process.env.CHROMIUM_BIN,[
      '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,
      '--dump-dom','--virtual-time-budget=10000',`http://127.0.0.1:${server.address().port}/`,
    ],{timeout:30000,maxBuffer:4 * 1024 * 1024});
    const labels = stdout.match(/data-labels="([^"]*)"/)?.[1];
    assert.ok(labels?.includes('Start') && labels.includes('Finish'),`Expected SVG text labels Start/Finish, got ${JSON.stringify(labels)}`);
    assert.match(stdout,/data-foreign-objects="0"/);
  } finally {await new Promise(resolve => server.close(resolve)); await rm(profile,{recursive:true,force:true});}
});
