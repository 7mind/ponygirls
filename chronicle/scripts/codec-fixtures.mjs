import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BaboonCodecContext } from '../target/codec-js/BaboonSharedRuntime.js';
const ctx = BaboonCodecContext.Default;
const fixture = name => JSON.stringify(JSON.parse(readFileSync(new URL(`../server/src/test/fixtures/${name}.json`, import.meta.url), 'utf8')));
const codecs = async directory => {
  const load = file => import(`../target/codec-js/chronicle/api/${directory}${file}.js`);
  const [client, server, ingest] = await Promise.all(['ClientEnvelope', 'ServerEnvelope', 'IngestRequest'].map(load));
  return { client: client.ClientEnvelope_JsonCodec.instance, server: server.ServerEnvelope_JsonCodec.instance, ingest: ingest.IngestRequest_JsonCodec.instance };
};
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of Object.entries(version)) {
    const golden = fixture(name);
    assert.equal(JSON.stringify(codec.encode(ctx, codec.decode(ctx, JSON.parse(golden)))), golden, `${directory || '1.4.0/'}${name} golden bytes`);
  }
}
for (const directory of ['v1_2_0/', 'v1_3_0/', '']) {
  const { CollectorProgressUpdate_JsonCodec } = await import(`../target/codec-js/chronicle/api/${directory}CollectorProgressUpdate.js`);
  const golden = fixture('progress');
  assert.equal(JSON.stringify(CollectorProgressUpdate_JsonCodec.instance.encode(ctx, CollectorProgressUpdate_JsonCodec.instance.decode(ctx, JSON.parse(golden)))), golden);
}
const latest = await codecs('');
for (const [name, codec] of [['api14-clients', latest.client], ['api14-results', latest.server]]) {
  const golden = fixture(name);
  const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
  assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${name} golden bytes`);
}
console.log('20 generated TypeScript fixture groups passed: five API versions, retained progress and additive1.4 contracts (shared Scala goldens)');
