import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

// Behavioral / Active / Blackbox / Atomic; specified original-source ranges.
function copies(text) {
  const rendered = renderMarkdown(text);
  assert.equal((rendered.html.match(/data-manure-source=/g) || []).length, rendered.sources.length);
  for (const source of rendered.sources) {
    assert.ok(source.start >= 0 && source.end <= text.length && source.start < source.end);
  }
  return rendered.sources.map(source => ({kind:source.kind, text:text.slice(source.start, source.end)}));
}
const section = text => ({kind:'section', text});
const table = text => ({kind:'table', text});

test('sections include their heading and descendants, but not the next peer or ancestor', () => {
  const child = '## Child\r\n\r\n### Deep\r\n\r\nRaw **text** [link][ref].\r\n\r\n[ref]: /ref\r\n\r\n';
  const first = '# Héllo 東京\r\n\r\n' + child;
  const next = '# Next\r\n\r\nTail without newline';
  assert.deepEqual(copies('Preamble\r\n\r\n' + first + next), [section(first), section(child), section(child.slice(child.indexOf('###'))), section(next)]);
});

test('setext, ATX closing markers, empty titles and level six headings retain syntax', () => {
  const text = 'Title\n=====\n\n## Child ##\n\n###### Deep\n\n##\n\nEnd';
  assert.deepEqual(copies(text), [section(text), section('## Child ##\n\n###### Deep\n\n'), section('###### Deep\n\n'), section('##\n\nEnd')]);
});

test('quoted and list sections stop at their owning container and keep original prefixes', () => {
  const quoted = '> ## Quote\r\n>\r\n> body\r\n';
  const list = '- ## Item\r\n\r\n  ### Nested\r\n\r\n  Text\r\n';
  assert.deepEqual(copies(quoted + '\r\nOutside\r\n\r\n' + list + '\r\n- Next item\r\n'), [section(quoted), section(list), section('  ### Nested\r\n\r\n  Text\r\n')]);
});

test('repeated tables and heading-like code are bound by positions, not text searches', () => {
  const source = '| *H* | Code |\n| --- | --- |\n| one | `two` |\n';
  const text = '```md\n# Fake\n' + source + '```\n\n# Real\n\n' + source + '\n' + source;
  assert.deepEqual(copies(text), [section('# Real\n\n' + source + '\n' + source), table(source), table(source)]);
});

test('table source includes indentation, quote/list markers, alignment and escaped pipes', () => {
  const quoted = '> | A \\| B |\n> | :---: |\n> | `raw` |\n';
  const listed = '- Item\n\n  | C |\n  | --- |\n  | D |\n';
  assert.deepEqual(copies(quoted + '\n' + listed), [table(quoted), table(listed.slice(listed.indexOf('  |')))]);
});

for (const [name, prefix] of [['quote', '> '], ['list', '  '], ['tab', '\t']]) {
  test(`nested raw HTML ${name} positions refer to the original CRLF source`, () => {
    const heading = prefix + '<h2 title="a > b">HTML <em>title</em></h2>\r\n';
    const rawTable = prefix + '<table>\r\n' + prefix + '<tr><td>🦄</td></tr>\r\n' + prefix + '</table>';
    const opener = name === 'list' || name === 'tab' ? '- <div>\r\n' : '> <div>\r\n';
    const text = opener + heading + rawTable + '\r\n' + prefix + '</div>\r\n\r\nOutside';
    assert.deepEqual(copies(text), [section(heading + rawTable + '\r\n'), table(rawTable)]);
  });
}

test('raw HTML inline headings do not copy preceding sibling markup or a parent closing tag', () => {
  const text = '<div><p>Before</p><h2>One</h2><p>Body</p><h2>Two</h2>Tail</div>';
  assert.deepEqual(copies(text), [section('<h2>One</h2><p>Body</p>'), section('<h2>Two</h2>Tail')]);
});

test('browser-repaired unclosed HTML containers do not truncate a child closing tag', () => {
  const text = '<div><h2>H</h2><div>body</div>';
  assert.deepEqual(copies(text), [section('<h2>H</h2><div>body</div>')]);
});

test('raw HTML section boundaries retain trailing non-rendered reference definitions', () => {
  const sectionText = '## H\n\n[link][ref]\n\n[ref]: /target\n\n';
  assert.deepEqual(copies('<div>\n\n' + sectionText + '</div>'), [section(sectionText)]);
  assert.deepEqual(copies('<div>\n\n' + sectionText), [section(sectionText)]);
});

test('implicitly closed HTML list items stop before their next sibling', () => {
  assert.deepEqual(copies('<ul><li><h2>A</h2><li>B</ul>'), [section('<h2>A</h2>')]);
});

test('authored mapping attributes cannot redirect source copies', () => {
  const text = '<h2 data-manure-source="99" data-manure-generated="0">Title</h2>\n\n<table data-manure-source="0"><tr><td>X</td></tr></table>';
  assert.deepEqual(copies(text), [section(text), table(text.slice(text.indexOf('<table')))]);
  const rendered = renderMarkdown(text);
  assert.doesNotMatch(rendered.html, /data-manure-generated/);
  assert.equal(rendered.html, renderMarkdown(text).html, 'private per-render markers must not leak');
});

test('footnote-like syntax retains the existing reference-link dialect without synthetic headings', () => {
  const text = '# Title\n\nText[^n].\n\n[^n]: Note\n';
  assert.deepEqual(copies(text), [section(text)]);
  const rendered = renderMarkdown(text);
  assert.match(rendered.html, /<a href="Note">\^n<\/a>/);
  assert.doesNotMatch(rendered.html, /footnote-label/);
});

test('GFM task states remain static while uploaded input HTML is not promoted to a task', () => {
  const rendered = renderMarkdown('- [x] Done\n- [ ] Pending\n\n<input type="checkbox" checked>');
  assert.match(rendered.html, /role="img" aria-label="Completed task">☑/);
  assert.match(rendered.html, /role="img" aria-label="Incomplete task">☐/);
  assert.equal((rendered.html.match(/<input/g) || []).length, 1, 'uploaded input remains for the sanitizer to forbid');
});
