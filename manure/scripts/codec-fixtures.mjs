// Behavioral-Active / Blackbox-Group; specified current-codec vectors.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {BaboonCodecContext} from '../web/dashboard/current/BaboonSharedRuntime.js';
import * as api from '../web/dashboard/current/manure/api/index.js';
const ctx = BaboonCodecContext.Default;
assert.deepEqual(readdirSync(new URL('../models/', import.meta.url)).filter(x=>x.endsWith('.baboon')), ['manure.baboon']);
assert.equal(api.ClientEnvelope.BaboonDomainVersion,'1.0.0');
assert.equal(readdirSync(new URL('../generated/typescript/manure/api/',import.meta.url)).some(x=>/^v\d|^from_/.test(x)),false);
let total=0;
for(const [name,codec] of [['commands',api.ClientEnvelope_JsonCodec.instance],['results',api.ServerEnvelope_JsonCodec.instance],['content',api.ContentEnvelope_JsonCodec.instance],['chunks',api.ChunkReceipt_JsonCodec.instance]]) {
  const fixtures=JSON.parse(readFileSync(new URL(`../models/fixtures/${name}.json`,import.meta.url),'utf8'));
  for(const fixture of fixtures) assert.deepEqual(codec.encode(ctx,codec.decode(ctx,fixture)),fixture,`${name}: roundtrip`);
  console.log(`${name}: ${fixtures.length} vectors`);total+=fixtures.length;
}
console.log(`TypeScript generated codec goldens: ${total} vectors passed; sole current API`);

const searchVectors=JSON.parse(readFileSync(new URL('../models/fixtures/results.json',import.meta.url),'utf8'))
  .filter(value=>value.result.SearchResults);
const [published,head]=searchVectors.map(value=>api.ServerEnvelope_JsonCodec.instance.decode(ctx,value).result.page.hits[0]);
assert.equal(published.embeddingProfile,'b'.repeat(64));
assert.equal(published.embeddingSpace,'c'.repeat(64));
assert.equal(head.embeddingProfile,undefined);assert.equal(head.embeddingSpace,undefined);
assert.equal(searchVectors[1].result.SearchResults.page.hits[0].embeddingProfile,null);
assert.equal(searchVectors[1].result.SearchResults.page.hits[0].embeddingSpace,null);
console.log('Search source/generation/policy/profile/space/provenance goldens passed');
