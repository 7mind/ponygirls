import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, artifactResourceUrl, markdownLinkUrl, boundedBytes, graphSource, diagramCount, wholeLines, leadingBytes, lineRange, lineFragment } from '../src/safety.js';
// Behavioral / Active / Blackbox / Atomic; specified safety contracts.
test('only local HTTP(S) asset URLs are accepted', () => {
  const base = 'https://artifacts.example/view/id/docs/readme.md';
  assert.equal(localUrl('../photo.svg',base),'https://artifacts.example/view/id/photo.svg');
  for (const value of ['javascript:alert(1)','data:text/html,x','https://evil.example/x','//evil.example/x']) assert.equal(localUrl(value,base),null);
});
test('malformed URLs are rejected without aborting the document', () => {
  assert.equal(localUrl('http://[broken', 'https://artifacts.example/'), null);
});
test('artifact resources cannot request management or sibling mounts', () => {
  const base = 'https://artifacts.example/view/abc/docs/README.md';
  const mount = '/view/abc';
  assert.equal(artifactResourceUrl('../photo.svg',base,mount),'https://artifacts.example/view/abc/photo.svg');
  assert.equal(artifactResourceUrl('#heading',base,mount),`${base}#heading`);
  for (const value of ['/api/users','/view/other/image.png','../../../api/users','../__manure/logout','/view/abc/%2fapi/x','/view/abc/%5f%5fmanure/x','/view/abc/%61pi/users','http://[broken']) assert.equal(artifactResourceUrl(value,base,mount),null, value);
  assert.equal(artifactResourceUrl('/__manure/logout','https://artifact.example/docs/a.md',''),null);
  assert.equal(artifactResourceUrl('/api/users','https://artifact.example/docs/a.md',''),null);
});
test('legal manifest resource names retain single-pass percent and nested-directory semantics', () => {
  const base = 'https://artifacts.example/view/abc/docs/README.md';
  const mount = '/view/abc';
  for (const name of ['CPU 90%.svg', '%2f.svg', '__manure/chart.svg']) {
    const encoded = name.split('/').map(encodeURIComponent).join('/');
    assert.equal(artifactResourceUrl(encoded,base,mount),new URL(encoded,base).href,name);
  }
  assert.equal(artifactResourceUrl('/view/chart.svg','https://artifact.example/docs/a.md',''),'https://artifact.example/view/chart.svg');
});
// Regression: the automatic-resource policy previously stripped safe hyperlink hrefs.
test('Markdown links allow external HTTP(S) navigation without allowing external resources', () => {
  const base = 'https://artifacts.example/view/abc/docs/README.md';
  const mount = '/view/abc';
  for (const value of ['https://example.com/review/182749', 'http://example.com/review/182749', '//example.com/review/182749']) {
    assert.equal(markdownLinkUrl(value,base,mount),new URL(value,base).href,value);
    assert.equal(artifactResourceUrl(value,base,mount),null,value);
  }
});
test('Markdown links preserve fragments and confine absolute and relative same-origin navigation', () => {
  const base = 'https://artifacts.example/view/abc/docs/README.md';
  const mount = '/view/abc';
  assert.equal(markdownLinkUrl('#heading',base,mount),'#heading');
  for (const value of ['../photo.svg', './CPU%2090%25.md', 'https://artifacts.example/view/abc/guide.md']) {
    assert.equal(markdownLinkUrl(value,base,mount),new URL(value,base).href,value);
  }
  for (const path of ['/api/users', '/view/other/image.png', '/view/abc/__manure/logout', '/view/abc/%5f%5fmanure/logout',
    '/view/abc/%61pi/users', '/view/abc/%2fapi/users', '/view/abc/%5capi/users', '/view/abc/bad%00name']) {
    for (const value of [path, new URL(path,base).href]) assert.equal(markdownLinkUrl(value,base,mount),null,value);
  }
  for (const value of ['/api/users', 'https://artifact.example/__manure/logout']) {
    assert.equal(markdownLinkUrl(value,'https://artifact.example/docs/README.md',''),null,value);
  }
});
// Regression: path-hosted sibling artifact URLs are navigation, not automatic resources.
test('Markdown links allow explicit canonical sibling artifact navigation but not relative escapes or resources', () => {
  const current = '11111111111111111111111111111111';
  const sibling = '22222222222222222222222222222222';
  const mount = `/view/${current}`;
  const base = `https://artifacts.example${mount}/docs/README.md`;
  for (const suffix of ['', '/', '#7-limits', '/?view=1#7-limits', '/docs/guide%20name.md#topic']) {
    const path = `/view/${sibling}${suffix}`;
    for (const value of [path, `https://artifacts.example${path}`, `//artifacts.example${path}`]) {
      assert.equal(markdownLinkUrl(value,base,mount),new URL(value,base).href,value);
      assert.equal(artifactResourceUrl(value,base,mount),null,value);
    }
  }
  for (const value of [`../../${sibling}/guide.md`, `../../../view/${sibling}/guide.md`,
    '/view/other/guide.md', `/view/${sibling.slice(1)}/`, `/view/${sibling}2/`, '/view/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/',
    `/view/%32${sibling.slice(1)}/`, `/view/${sibling}/api/users`, `/view/${sibling}/%61pi/users`,
    `/view/${sibling}/__manure/logout`, `/view/${sibling}/%5f%5fmanure/logout`,
    `/view/${sibling}/%2fapi/users`, `/view/${sibling}/%5capi/users`, `/view/${sibling}/bad%00name`]) {
    assert.equal(markdownLinkUrl(value,base,mount),null,value);
  }
  const subdomainBase = `https://${current}.artifacts.example/docs/README.md`;
  const subdomainSibling = `https://${sibling}.artifacts.example/guide.md`;
  assert.equal(markdownLinkUrl(subdomainSibling,subdomainBase,''),subdomainSibling);
  assert.equal(artifactResourceUrl(subdomainSibling,subdomainBase,''),null);
});
test('Markdown links reject non-HTTP(S) schemes, userinfo, controls and malformed URLs', () => {
  const base = 'https://artifacts.example/view/abc/README.md';
  for (const value of ['javascript:alert(1)', 'data:text/html,unsafe', 'vbscript:unsafe', 'file:///tmp/unsafe',
    'blob:https://example.com/unsafe', 'mailto:review@example.com', 'https://user:pass@example.com/review',
    'https://user@example.com/review', 'https://exa\tmple.com/review', 'https://example.com/\nreview',
    'java\r\nscript:alert(1)', '#heading\t', 'http://[broken']) {
    assert.equal(markdownLinkUrl(value,base,'/view/abc'),null,value);
  }
});
test('whole-document diagram count is bounded', () => {
  assert.doesNotThrow(() => diagramCount(32));
  assert.throws(() => diagramCount(33), /32 diagrams/);
});
test('configuration and excessive diagram text are rejected', () => {
  assert.equal(graphSource('graph TD; A-->B'),'graph TD; A-->B');
  for (const value of ['%%{init: {securityLevel: "loose"}}%%','---\nconfig:\n---', 'a'.repeat(50001)]) assert.throws(() => graphSource(value));
});
test('streaming response cap is enforced without Content-Length', async () => {
  assert.deepEqual(await boundedBytes(new Response('hello'),5),new TextEncoder().encode('hello'));
  await assert.rejects(boundedBytes(new Response('hello'),4),/too large/);
  await assert.rejects(boundedBytes(new Response('error',{status:403}),100),/403/);
  await assert.rejects(boundedBytes(new Response('x',{headers:{'content-length':'500'}}),4),/too large/);
});
const utf8 = text => new TextEncoder().encode(text);
const decoded = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
test('a cut-off text keeps its whole lines and never half a character', () => {
  assert.equal(decoded(wholeLines(utf8('one\ntwo\nthr'))), 'one\ntwo\n');
  assert.equal(decoded(wholeLines(utf8('one\ntwo\n'))), 'one\ntwo\n');
  // Every cut inside "é" (2 bytes), "東" (3 bytes) and "😀" (4 bytes) drops the split character.
  for (const [character, size] of [['é', 2], ['東', 3], ['😀', 4]]) {
    const bytes = utf8(`ab${character}`);
    assert.equal(bytes.length, 2 + size);
    for (let cut = 3; cut < bytes.length; cut++) assert.equal(decoded(wholeLines(bytes.subarray(0, cut))), 'ab', `${character} cut at ${cut}`);
    assert.equal(decoded(wholeLines(bytes)), `ab${character}`);
    assert.equal(decoded(wholeLines(utf8(`x\ny${character}`).subarray(0, 4))), 'x\n', 'the incomplete last line goes with the split character');
  }
  assert.equal(decoded(wholeLines(utf8('a single line without an end'))), 'a single line without an end');
  assert.equal(wholeLines(utf8('é').subarray(0, 1)).length, 0);
  assert.equal(wholeLines(new Uint8Array(0)).length, 0);
  assert.throws(() => decoded(wholeLines(Uint8Array.of(0x61, 0x80, 0x80, 0x80, 0x80))), 'invalid UTF-8 is left for the decoder to reject');
});
test('a file within the limit is fetched once; a larger one is fetched again as its first bytes', async () => {
  const text = 'line one\nline two\nline three\n';
  const asked = [];
  const server = headers => {
    asked.push(headers);
    const range = headers.Range && /^bytes=0-(\d+)$/.exec(headers.Range);
    const body = range ? text.slice(0, Number(range[1]) + 1) : text;
    return new Response(body, {status: range ? 206 : 200, headers: {'content-length': String(body.length)}});
  };
  const small = await leadingBytes(server, 100);
  assert.deepEqual([decoded(small.bytes), small.truncated, small.total], [text, false, null]);
  assert.deepEqual(asked, [{}]);
  asked.length = 0;
  const exact = await leadingBytes(server, text.length);
  assert.deepEqual([decoded(exact.bytes), exact.truncated], [text, false]);
  asked.length = 0;
  const large = await leadingBytes(server, 22);
  assert.deepEqual([decoded(large.bytes), large.truncated, large.total], ['line one\nline two\n', true, text.length]);
  assert.deepEqual(asked, [{}, {Range: 'bytes=0-21'}]);
});
test('a failed download, an ignored byte range and an oversized range answer are errors', async () => {
  await assert.rejects(leadingBytes(() => new Response('gone', {status: 404}), 10), /HTTP 404/);
  const whole = () => new Response('x'.repeat(50), {headers: {'content-length': '50'}});
  await assert.rejects(leadingBytes(whole, 10), /HTTP 200 for a byte range/);
  const tooMuch = headers => new Response('x'.repeat(50), {status: headers.Range ? 206 : 200, headers: {'content-length': '50'}});
  await assert.rejects(leadingBytes(tooMuch, 10), /too large/);
  await assert.rejects(leadingBytes(() => new Response('x'.repeat(50)), 10), /too large/, 'without a declared length the stream cap applies');
});
test('line fragments address one line or an inclusive range within the text', () => {
  assert.deepEqual(lineRange('#L12', 40), {first: 12, last: 12});
  assert.deepEqual(lineRange('#L12-L18', 40), {first: 12, last: 18});
  assert.deepEqual(lineRange('#L18-L12', 40), {first: 12, last: 18});
  assert.deepEqual(lineRange('#L30-L99', 40), {first: 30, last: 40}, 'a range is cut at the last line');
  for (const hash of ['', '#', '#L', '#L0', '#L01', '#l12', '#L12-', '#L12-18', '#L12-L0', '#L41', '#L41-L50', '#heading', '#L12x', '#L1-L2-L3']) assert.equal(lineRange(hash, 40), null, hash);
  assert.equal(lineFragment(7, 7), '#L7');
  assert.equal(lineFragment(9, 3), '#L3-L9');
  assert.deepEqual(lineRange(lineFragment(3, 9), 40), {first: 3, last: 9});
});
