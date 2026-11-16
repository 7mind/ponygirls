import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, artifactResourceUrl, markdownLinkUrl, boundedBytes, graphSource, diagramCount } from '../src/safety.js';
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
