import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, artifactResourceUrl, boundedBytes, graphSource, diagramCount } from '../src/safety.js';
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
  for (const value of ['/api/users','/view/other/image.png','../../../api/users','../__manure/logout','/view/abc/%2fapi/x','/view/abc/%255f_manure/x','http://[broken']) assert.equal(artifactResourceUrl(value,base,mount),null, value);
  assert.equal(artifactResourceUrl('/__manure/logout','https://artifact.example/docs/a.md',''),null);
  assert.equal(artifactResourceUrl('/api/users','https://artifact.example/docs/a.md',''),null);
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
