import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { BaboonCodecContext } from '../target/codec-js/generated/typescript/BaboonSharedRuntime.js';
import { ClientEnvelope, ClientEnvelope_JsonCodec } from '../target/codec-js/generated/typescript/chronicle/api/ClientEnvelope.js';
import { ServerEnvelope_JsonCodec } from '../target/codec-js/generated/typescript/chronicle/api/ServerEnvelope.js';
import { IngestRequest_JsonCodec } from '../target/codec-js/generated/typescript/chronicle/api/IngestRequest.js';
import { CollectorProgressUpdate_JsonCodec } from '../target/codec-js/generated/typescript/chronicle/api/CollectorProgressUpdate.js';
const ctx = BaboonCodecContext.Default;
const fixture = name => JSON.stringify(JSON.parse(readFileSync(new URL(`../server/src/test/fixtures/${name}.json`, import.meta.url), 'utf8')));
const apiVersion = ClientEnvelope.BaboonDomainVersion;
assert.deepEqual(readdirSync(new URL('../models/', import.meta.url)).filter(name => name.endsWith('.baboon')), ['chronicle.baboon']);
assert.equal(readdirSync(new URL('../generated/typescript/chronicle/api/', import.meta.url)).some(name => /^v\d|^from_/.test(name)), false);
let fixtureGroups = 0;
for (const [name, codec] of [
  ['client', ClientEnvelope_JsonCodec.instance],
  ['server', ServerEnvelope_JsonCodec.instance],
  ['ingest', IngestRequest_JsonCodec.instance],
  ['progress', CollectorProgressUpdate_JsonCodec.instance],
]) {
  const golden = fixture(name);
  assert.equal(JSON.stringify(codec.encode(ctx, codec.decode(ctx, JSON.parse(golden)))), golden, `${name} golden bytes`);
  fixtureGroups++;
}
// Historical golden files are immutable evidence; exercise only shapes present in the sole current API.
for (const prefix of ['api14', 'api16', 'api17', 'api18', 'api19', 'archive-search']) {
  for (const [suffix, codec] of [['clients', ClientEnvelope_JsonCodec.instance], ['results', ServerEnvelope_JsonCodec.instance]]) {
    const name = `${prefix}-${suffix}`, golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${name} golden bytes`);
    if (prefix === 'api18') assert.deepEqual(decoded.map(value => suffix === 'clients' ? value.operation.query.preferRelevance : value.result.result.relevanceOrdered), [false, true]);
    fixtureGroups++;
  }
}
console.log(`${fixtureGroups} generated TypeScript fixture groups passed; 1 API version (${apiVersion}); no conversion chain`);
