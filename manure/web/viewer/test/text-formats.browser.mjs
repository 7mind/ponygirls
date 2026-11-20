import { test } from 'node:test';
import { serveShell, SHELL_BASE, UNTIL } from './shared-ui.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; the built viewer in Chromium against a local file server
// that answers byte ranges like the Manure raw route. Clipboard is a controlled boundary.
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self'; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'";
const E = '\x1b';

/** Loads `file` (name, viewer kind, bytes) at `hash` and runs `probe` in the page; returns the requests for the raw file. */
async function view({ name, kind, bytes, hash = '', type = 'text/plain; charset=utf-8' }, probe) {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN');
  const template = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const rawUrl = `/__manure/raw/${encodeURIComponent(name)}`;
  const html = template.replaceAll('__MANURE_ASSET_BASE__', '/assets').replaceAll('__MANURE_SHELL_BASE__', SHELL_BASE).replaceAll('__MANURE_PATH__', name)
    .replaceAll('__MANURE_RAW_URL__', rawUrl).replaceAll('__MANURE_DOWNLOAD_URL__', '/download').replaceAll('__MANURE_CREATED_AT__', '2026-01-02T03:04:05Z')
    .replaceAll('__MANURE_KIND__', kind).replaceAll('__MANURE_ROOT_URL__', '/').replaceAll('__MANURE_ARTIFACT_NAME__', name)
    .replaceAll('__MANURE_SIZE__', `${bytes.length} B`).replaceAll('__MANURE_TYPE__', 'File').replace('</body>', '<script type="module" src="/probe.js"></script></body>');
  const script = `const check = (value, message) => { if (!value) throw new Error(message); };
    const same = (actual, expected, message) => { if (actual !== expected) throw new Error(message + ': ' + JSON.stringify(String(actual).slice(0, 300)) + ' instead of ' + JSON.stringify(String(expected).slice(0, 300))); };
    ${UNTIL}
    const $ = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const labelled = label => $('[aria-label="' + label + '"]');
    const toast = () => $('#toasts').textContent;
    const modes = () => { const group = $('#view-mode'); const [rendered, raw] = [...group.querySelectorAll('button')]; return { group, rendered, raw }; };
    const pressed = button => button.getAttribute('aria-pressed') === 'true';
    const marked = view => [...view.children].flatMap((line, index) => line.classList.contains('is-target') ? [index + 1] : []);
    const copied = async () => { let text; Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async value => { text = value; }}}); $('#copy-raw').click(); await until(() => text !== undefined, 'copy raw did not write'); return text; };
    (async () => {
      try {
        await until(() => !$('#status').textContent, 'preview did not finish loading');
        ${probe}
        document.body.dataset.result = 'passed';
      } catch (error) { document.body.dataset.result = error.message; }
    })();`;
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.setHeader('content-security-policy', CSP); res.end(html); }
      else if (req.url === '/probe.js') { res.setHeader('content-type', 'text/javascript'); res.end(script); }
      else if (req.url === rawUrl) {
        requests.push(req.headers.range || 'whole');
        res.setHeader('content-type', type);
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (!range) { res.setHeader('content-length', bytes.length); res.end(bytes); return; }
        const start = Number(range[1]), end = Math.min(bytes.length, range[2] === '' ? bytes.length : Number(range[2]) + 1);
        res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${end - 1}/${bytes.length}`); res.setHeader('content-length', end - start);
        res.end(bytes.subarray(start, end));
      }
      else if (await serveShell(req, res)) { /* shared design system */ }
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`, import.meta.url)));
      } else { res.statusCode = 404; res.end(); }
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'manure-text-'));
  try {
    const { stdout } = await promisify(execFile)(process.env.CHROMIUM_BIN, [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${profile}`,
      '--dump-dom', '--virtual-time-budget=20000', `http://127.0.0.1:${server.address().port}/${hash}`,
    ], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    assert.match(stdout, /data-result="passed"/, stdout.match(/data-result="[^"]*"/)?.[0] || 'probe did not finish');
  } finally { await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
  return requests;
}
const file = (name, kind, text) => ({ name, kind, bytes: Buffer.from(text, 'utf8') });
const js = value => JSON.stringify(value);

const PYTHON = '#!/usr/bin/env python3\n"""Doc\nstring."""\nimport json\n\n\ndef load(path):\n    return json.loads(path)  # <b>not markup</b>\n\twith_tab = "é 東京"\r\nlast = 1';

test('source code: highlighted, exact text, counted lines, exact copy, selection without line numbers', async () => {
  const requests = await view(file('tool.py', 'text', PYTHON), `
    const text = ${js(PYTHON)};
    const view = labelled('File text');
    same(view.textContent, text, 'the view is the exact file text');
    same(view.children.length, 10, 'one block per line');
    check(all('[aria-label="File text"] .hljs-keyword').some(node => node.textContent === 'def'), 'keywords are highlighted');
    check(all('[aria-label="File text"] .hljs-string').some(node => node.textContent.includes('Doc')), 'a multi-line string is highlighted on its lines');
    check(!view.querySelector('b'), 'markup in the file stays text');
    same(getComputedStyle(view.querySelector('.hljs-keyword')).color !== getComputedStyle(view).color, true, 'the highlight stylesheet applies');
    same($('#meta-extra').textContent, '10 lines', 'meta line');
    check($('#view-mode').hidden, 'no view switch for a plain source file');
    same(await copied(), text, 'copy raw');
    await until(() => toast() === 'File text copied.', 'copy feedback');
    const selection = getSelection(); selection.selectAllChildren(view);
    same(selection.toString().replace(/\\r\\n/g, '\\n'), text.replace(/\\r\\n/g, '\\n'), 'selected text has no line numbers and no doubled line breaks');
    const numbers = all('[aria-label="File text"] a.ln');
    same(numbers.length, 10, 'a gutter link per line');
    check(numbers.every(link => link.textContent === '' && link.tabIndex === -1 && link.getAttribute('aria-hidden') === 'true'), 'gutter links carry no text and take no tab stop');
    same(getComputedStyle(numbers[6], '::before').content, 'counter(line)', 'the number is generated content');
  `);
  assert.deepEqual(requests, ['whole'], 'a file within the limit is fetched once');
});

test('line links: fragment on load, click, shift-click range, history navigation', async () => {
  const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  await view({ ...file('notes.txt', 'text', text), hash: '#L120-L122' }, `
    const view = labelled('File text');
    same(marked(view).join(), '120,121,122', 'the addressed lines are marked on load');
    const box = view.children[119].getBoundingClientRect();
    check(box.top >= 0 && box.bottom <= innerHeight, 'the first addressed line is scrolled into sight');
    const number = n => view.children[n - 1].querySelector('a.ln');
    same(number(5).getAttribute('href'), '#L5', 'each number links its own line');
    number(5).dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
    same(location.hash, '#L5', 'a click addresses the line');
    same(marked(view).join(), '5', 'and marks only it');
    number(8).dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, shiftKey:true}));
    same(location.hash, '#L5-L8', 'a shift-click extends from the clicked line');
    same(marked(view).join(), '5,6,7,8', 'range marked');
    number(2).dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, shiftKey:true}));
    same(location.hash, '#L2-L5', 'a range extends upwards from the same anchor');
    const open = new MouseEvent('click', {bubbles:true, cancelable:true, ctrlKey:true});
    number(9).dispatchEvent(open);
    check(!open.defaultPrevented && location.hash === '#L2-L5', 'a modified click keeps its browser meaning');
    location.hash = '#L290';
    await until(() => marked(view).join() === '290', 'a changed fragment marks its line');
    const late = view.children[289].getBoundingClientRect();
    check(late.top >= 0 && late.bottom <= innerHeight, 'and scrolls to it');
    location.hash = '#L999';
    await until(() => marked(view).length === 0, 'a line past the end marks nothing');
    location.hash = '#L299-L400';
    await until(() => marked(view).join() === '299,300', 'a range is cut at the last line');
  `);
});

test('diff: line classes, totals, exact text', async () => {
  const diff = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n keep\n--- removed line that looks like a header\n+new\n tail\n\\ No newline at end of file\n';
  await view(file('fix.diff', 'text', diff), `
    const view = labelled('File text');
    same(view.textContent, ${js(diff)}, 'exact text');
    same([...view.children].map(line => line.className).join('|'), 'diff-file|diff-file|diff-file|diff-file|diff-hunk||diff-del|diff-add||diff-note', 'line classes');
    same($('#meta-extra').textContent, '1 file \u00b7 +1 \u22121 \u00b7 10 lines', 'totals in the meta line');
    check(!view.querySelector('[class^=hljs]'), 'a diff is coloured by its lines, not by a grammar');
    const colour = name => getComputedStyle(view.querySelector('.' + name)).backgroundColor;
    check(colour('diff-add') !== colour('diff-del') && colour('diff-add') !== 'rgba(0, 0, 0, 0)', 'additions and deletions have their grounds');
  `);
});

test('JSON: formatted by default with stored lexemes, raw on demand and for line links', async () => {
  const json = '{"a":[1,2.50,{"b":null}],"big":12345678901234567890,"s":"\\u00e9"}';
  const formatted = '{\n  "a": [\n    1,\n    2.50,\n    {\n      "b": null\n    }\n  ],\n  "big": 12345678901234567890,\n  "s": "\\u00e9"\n}\n';
  const probe = initial => `
    const { group, rendered, raw } = modes();
    check(!group.hidden && group.getAttribute('aria-label') === 'JSON view', 'JSON view switch');
    same(rendered.textContent + '|' + raw.textContent, 'Formatted|Raw', 'switch labels');
    const [formattedView, rawView] = [labelled('Formatted JSON'), labelled('File text')];
    same(formattedView.textContent, ${js(formatted)}, 'formatted text keeps every lexeme');
    same(rawView.textContent, ${js(json)}, 'raw text is exact');
    check(!formattedView.querySelector('.ln') && formattedView.classList.contains('no-lines'), 'the formatted view has no file line numbers');
    check(formattedView.querySelector('.hljs-attr') && rawView.querySelector('.hljs-attr'), 'both views are highlighted');
    same($('#meta-extra').textContent, 'valid JSON \u00b7 1 line', 'meta line');
    ${initial}
    same(await copied(), ${js(json)}, 'copy raw copies the stored text in either view');
  `;
  await view(file('metrics.json', 'text', json), probe(`
    check(pressed(rendered) && !formattedView.hidden && rawView.hidden, 'formatted first');
    raw.click();
    check(pressed(raw) && formattedView.hidden && !rawView.hidden, 'raw on demand');
    rendered.click();
    check(pressed(rendered) && !formattedView.hidden && rawView.hidden, 'and back');
    rawView.querySelector('a.ln');
    location.hash = '#L1';
    await until(() => pressed(raw) && !rawView.hidden && marked(rawView).join() === '1', 'a line link switches to the raw text');`));
  await view({ ...file('metrics.json', 'text', json), hash: '#L1' }, probe(`
    check(pressed(raw) && formattedView.hidden && !rawView.hidden && marked(rawView).join() === '1', 'a line link opens the raw text');`));
});

test('JSON that is not valid, JSON Lines and a notebook', async () => {
  const broken = '{\n  "a": 1,\n}\n';
  await view(file('broken.json', 'text', broken), `
    check($('#view-mode').hidden, 'no switch without a formatted view');
    const note = $('.view-note');
    same(note.querySelector('.notice-title').textContent, 'Not valid JSON', 'note title');
    check(note.textContent.includes('a member name was expected') && note.textContent.includes('The raw text is shown.'), 'note text: ' + note.textContent);
    const link = note.querySelector('a');
    same(link.textContent + ' ' + link.getAttribute('href'), 'line 3, column 1 #L3', 'the fault position links its line');
    same(labelled('File text').textContent, ${js(broken)}, 'raw text shown');
    check(!labelled('File text').hidden && !labelled('Formatted JSON'), 'only the raw view exists');
    location.hash = '#L3';
    await until(() => marked(labelled('File text')).join() === '3', 'the link marks the line');
  `);
  const lines = '{"n":1,"ok":true}\n\n[1,2]\n';
  await view(file('events.jsonl', 'text', lines), `
    same(labelled('Formatted JSON').textContent, '{\\n  "n": 1,\\n  "ok": true\\n}\\n[\\n  1,\\n  2\\n]\\n', 'every record formatted');
    same(labelled('File text').textContent, ${js(lines)}, 'raw');
    same($('#meta-extra').textContent, '2 records \u00b7 3 lines', 'meta line');
  `);
  await view(file('events.ndjson', 'text', '{"n":1}\n{"n":2,}\n'), `
    same($('.view-note .notice-title').textContent, 'Not valid JSON', 'note');
    same($('.view-note a').getAttribute('href'), '#L2', 'the faulty record is named by its line');
  `);
  await view(file('analysis.ipynb', 'text', '{"cells":[],"nbformat":4}'), `
    same(labelled('Formatted JSON').textContent, '{\\n  "cells": [],\\n  "nbformat": 4\\n}\\n', 'a notebook is JSON');
  `);
});

test('CSV and TSV: table by default, numeric columns, quoted cells, raw text, faults', async () => {
  const csv = 'name,score,note\r\nalpha,1.50,"said ""hi"", twice"\r\nbeta,-2,"two\nlines"\r\ngamma,,\r\n';
  await view(file('results.csv', 'text', csv), `
    const { group, rendered, raw } = modes();
    same(group.getAttribute('aria-label') + '|' + rendered.textContent, 'CSV view|Table', 'switch');
    const table = labelled('CSV table');
    check(pressed(rendered) && !table.closest('.data-view').hidden && labelled('File text').hidden, 'table first');
    same([...table.tHead.rows[0].cells].map(cell => cell.textContent).join('|'), 'Row|name|score|note', 'header');
    same([...table.tBodies[0].rows].map(row => [...row.cells].map(cell => cell.textContent).join('|')).join('/'), '1|alpha|1.50|said "hi", twice/2|beta|-2|two\\nlines/3|gamma||', 'cells');
    check(table.tBodies[0].rows[0].cells[2].classList.contains('num') && !table.tBodies[0].rows[0].cells[1].classList.contains('num'), 'the numeric column is marked');
    same(getComputedStyle(table.tBodies[0].rows[0].cells[2]).textAlign, 'right', 'numbers are right-aligned');
    same($('#meta-extra').textContent, '3 rows \u00b7 3 columns \u00b7 5 lines', 'meta line');
    raw.click();
    check(!labelled('File text').hidden && table.closest('.data-view').hidden, 'raw on demand');
    same(labelled('File text').textContent, ${js(csv)}, 'raw text is exact');
    check(!$('.data-foot'), 'nothing is cut');
  `);
  await view(file('ids.tsv', 'text', 'id\ttext\n7\t"a\tb"\n'), `
    same([...labelled('TSV table').tBodies[0].rows[0].cells].map(cell => cell.textContent).join('|'), '1|7|a\\tb', 'tab-separated cells');
  `);
  const tall = 'n,square\n' + Array.from({ length: 2500 }, (_, i) => `${i},${i * i}`).join('\n') + '\n';
  await view(file('tall.csv', 'text', tall), `
    same(labelled('CSV table').tBodies[0].rows.length, 2000, 'the table shows a leading part');
    same($('.data-foot').textContent, 'First 2,000 of 2,500 rows are shown as a table. Raw has every line.', 'the cut is stated');
    same($('#meta-extra').textContent, '2,500 rows \u00b7 2 columns \u00b7 2,501 lines', 'meta counts every row');
    same(labelled('File text').children.length, 2501, 'raw has every line');
  `);
  await view(file('open.csv', 'text', 'a,b\n1,"never closed\n2,3\n'), `
    check($('#view-mode').hidden && !labelled('CSV table'), 'no table for a faulty file');
    same($('.view-note .notice-title').textContent, 'Not shown as a table', 'note');
    check($('.view-note').textContent.includes('starts on line 2 is not closed'), 'note text');
    same($('.view-note a').getAttribute('href'), '#L2', 'the fault links its line');
    check(!labelled('File text').hidden, 'raw text shown');
  `);
});

test('log with ANSI escapes: rendered colours by default, exact raw text, line links in both views', async () => {
  const log = `${E}[2m06:02${E}[0m ${E}[32m\u2714 ok${E}[0m\n${E}[2K${E}[1;31merror${E}[0m at <x>\n${E}]0;title\x07plain\n`;
  await view({ ...file('build.log', 'text', log), hash: '#L2' }, `
    const { group, rendered, raw } = modes();
    same(group.getAttribute('aria-label') + '|' + rendered.textContent, 'Log view|Rendered', 'switch');
    const [shown, source] = [labelled('Rendered log'), labelled('File text')];
    check(pressed(rendered) && !shown.hidden && source.hidden, 'rendered first, also with a line link');
    same(shown.textContent, '06:02 \u2714 ok\\nerror at <x>\\nplain\\n', 'escape sequences are not text of the rendered view');
    same(shown.querySelector('.ansi-fg-2').textContent, '\u2714 ok', 'colour run');
    same(shown.querySelector('.ansi-bold.ansi-fg-1').textContent, 'error', 'bold red run');
    check(getComputedStyle(shown.querySelector('.ansi-fg-1')).color !== getComputedStyle(shown).color, 'the palette stylesheet applies');
    same(marked(shown).join() + ';' + marked(source).join(), '2;2', 'the addressed line is marked in both views');
    same(source.textContent, ${js(log)}, 'raw text is exact, escapes included');
    same(source.querySelectorAll('.ctl-esc').length, 8, 'every escape character is marked in the raw view');
    same($('#meta-extra').textContent, 'ANSI colours \u00b7 3 lines', 'meta line');
    raw.click();
    check(shown.hidden && !source.hidden, 'raw on demand');
    same(await copied(), ${js(log)}, 'copy raw keeps the escapes');
  `);
  await view(file('quiet.log', 'text', 'no escapes [31m here\n'), `
    check($('#view-mode').hidden && !labelled('Rendered log'), 'a log without escapes has one view');
    same($('#meta-extra').textContent, '1 line', 'meta line');
  `);
});

test('a text file over the limit shows its leading whole lines with a note; markup-free and countable', async () => {
  const line = 'x'.repeat(98) + '\u00e9\n'; // 101 bytes
  const text = line.repeat(26000); // 2,626,000 bytes
  const kept = Math.floor(2 * 1024 * 1024 / 101);
  const requests = await view(file('crawl.log', 'text', text), `
    const view = labelled('File text');
    same(view.children.length, ${kept}, 'whole lines up to the limit');
    same(view.textContent.length, ${kept * 100}, 'no cut line and no cut character');
    check(view.textContent.endsWith('\u00e9\\n'), 'the shown text ends at a line end');
    const note = $('.view-note');
    same(note.querySelector('.notice-title').textContent, 'Showing the first 2.0 MiB of 2.5 MiB', 'note title');
    check(note.textContent.includes('The preview ends at line ${kept.toLocaleString('en-US')}.'), 'note names the last line: ' + note.textContent);
    check(note.querySelector('a[download]').getAttribute('href').endsWith('/download'), 'the note offers the original');
    same($('#meta-extra').textContent, 'first ${kept.toLocaleString('en-US')} lines', 'meta line');
    same((await copied()).length, ${kept * 100}, 'copy raw copies the shown part');
    await until(() => toast() === 'Shown part of the file copied.', 'and says so');
  `);
  assert.deepEqual(requests, ['whole', 'bytes=0-2097151'], 'the oversized file is asked for again as its first bytes');
});

test('source text above the highlighting limit is plain and says so', async () => {
  const text = 'def f():\n    return "value"\n'.repeat(22000); // about 590 KiB
  await view(file('big.py', 'text', text), `
    const view = labelled('File text');
    same(view.textContent.length, ${text.length}, 'whole text');
    check(!view.querySelector('[class^=hljs]'), 'not highlighted');
    same($('#meta-extra').textContent, 'not highlighted above 512 KiB \u00b7 44,000 lines', 'meta line');
  `);
});

test('unknown types: text content opens as text (named files highlighted), other content gets a download card', async () => {
  const makefile = 'NODE ?= node\n\nall: dist/viewer.js\n\tnpm run build\n';
  await view(file('Makefile', 'unknown', makefile), `
    same(labelled('File text').textContent, ${js(makefile)}, 'text');
    check(labelled('File text').querySelector('[class^=hljs]'), 'a well-known name is highlighted');
    check(!$('#copy-raw').hidden, 'copy raw offered');
  `);
  await view(file('run-20261120', 'unknown', 'plain \u00e9 text\n'), `
    same(labelled('File text').textContent, 'plain \u00e9 text\\n', 'text without a known name');
    check(!labelled('File text').querySelector('[class^=hljs]'), 'and without a grammar');
  `);
  for (const bytes of [Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00]), Buffer.from([0xff, 0xfe, 0x41, 0x80]), Buffer.concat([Buffer.from('text then\n'), Buffer.from([0x00])])]) {
    await view({ name: 'model.safetensors', kind: 'unknown', bytes, type: 'application/octet-stream' }, `
      same($('#content h2').textContent, 'No preview for this file type', 'card');
      check($('#content .empty a[download]').getAttribute('href').endsWith('/download'), 'download offered');
      check(!labelled('File text') && $('#copy-raw').hidden && $('#view-mode').hidden, 'no text view and no text controls');
      check(!$('[role=alert]'), 'not an error');
    `);
  }
  await view({ name: 'notes.txt', kind: 'text', bytes: Buffer.from([0x61, 0xff, 0x62]) }, `
    check($('[role=alert]').textContent.includes('Preview unavailable'), 'a text type that is not UTF-8 is a preview failure');
  `);
});

test('Markdown code blocks: highlighted by info string, diff by lines, plain when unknown, Copy code', async () => {
  const markdown = '# T\n\n```python\ndef f():\n    return "<b>"\n```\n\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n```\nplain <i>text</i>\n```\n\n```nolang\nx = 1\n```\n\n    indented code\n\n<pre><code>raw <em>html</em> block</code></pre>\n';
  await view(file('report.md', 'markdown', markdown), `
    const blocks = all('article.markdown pre > code');
    same(blocks.length, 6, 'code blocks');
    const [python, diff, plain, unknown, indented, html] = blocks;
    same(python.textContent, 'def f():\\n    return "<b>"\\n', 'highlighting keeps the code text');
    same(python.querySelector('.hljs-keyword').textContent, 'def', 'python is highlighted');
    check(!python.querySelector('b'), 'code stays text');
    same([...diff.children].map(line => line.className).join('|'), 'line diff-hunk|line diff-del|line diff-add', 'a diff block is coloured by its lines');
    same(diff.textContent, '@@ -1 +1 @@\\n-old\\n+new\\n', 'diff text kept');
    same(getComputedStyle(diff.children[1]).display, 'block', 'diff lines are blocks');
    check(!plain.children.length && !unknown.children.length && !indented.children.length, 'blocks without a known language stay plain');
    same(html.querySelector('em').textContent, 'html', 'authored markup inside raw HTML code is left alone');
    const copies = all('article.markdown .markdown-code > .code-controls > button.copy-code');
    same(copies.length, 5, 'Copy on every code block of the document, not on raw HTML');
    check(copies.every(button => button.getAttribute('aria-label') === 'Copy code'), 'accessible name');
    same(getComputedStyle(copies[0].parentElement).opacity, '0', 'the control shows on hover or focus only');
    copies[1].focus();
    same(getComputedStyle(copies[1].parentElement).opacity, '1', 'keyboard focus reveals it');
    const box = copies[1].getBoundingClientRect(), block = diff.parentElement.getBoundingClientRect();
    check(box.bottom <= block.top + 1, 'the control sits above the block, not over the code');
    let text; Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async value => { text = value; }}});
    copies[0].click();
    await until(() => toast() === 'Code copied.', 'copy feedback');
    same(text, 'def f():\\n    return "<b>"\\n', 'the code without its fence');
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    $('#toasts').replaceChildren(); copies[3].click();
    await until(() => toast().includes('Could not copy. Select the text'), 'denial feedback');
    same($('#meta-extra').textContent, '1 section \u00b7 24 lines', 'markdown meta unchanged');
  `);
});

test('audio plays in the native player and reports its duration; an unplayable file fails visibly', async () => {
  const rate = 8000, seconds = 2, samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  await view({ name: 'tone.wav', kind: 'audio', bytes: wav, type: 'audio/wav' }, `
    const player = $('#content .stage > audio.stage-audio');
    check(player && player.controls, 'native audio player with controls');
    same(new URL(player.src).pathname, '/__manure/raw/tone.wav', 'it plays the raw file');
    await until(() => $('#file-facts').textContent !== '', 'metadata loads under the viewer policy');
    same($('#file-facts').textContent, ' \u00b7 0:02', 'duration in the meta line');
    check($('#copy-raw').hidden && $('#view-mode').hidden, 'no text controls');
  `);
  await view({ name: 'broken.mp4', kind: 'video', bytes: Buffer.from('this is not a video'), type: 'video/mp4' }, `
    await until(() => $('[role=alert]'), 'an unplayable file is reported');
    check($('[role=alert]').textContent.includes('The browser cannot play this video file.'), 'failure text: ' + $('[role=alert]').textContent);
    check($('[role=alert] a[download]'), 'the original stays downloadable');
  `);
});
