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
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of Object.entries(version)) {
    const golden = fixture(name);
    assert.equal(JSON.stringify(codec.encode(ctx, codec.decode(ctx, JSON.parse(golden)))), golden, `${directory || '1.7.0/'}${name} golden bytes`);
  }
}
for (const directory of ['v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/', '']) {
  const { CollectorProgressUpdate_JsonCodec } = await import(`../target/codec-js/chronicle/api/${directory}CollectorProgressUpdate.js`);
  const golden = fixture('progress');
  assert.equal(JSON.stringify(CollectorProgressUpdate_JsonCodec.instance.encode(ctx, CollectorProgressUpdate_JsonCodec.instance.decode(ctx, JSON.parse(golden)))), golden);
}
for (const directory of ['v1_4_0/', 'v1_5_0/', 'v1_6_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of [['api14-clients', version.client], ['api14-results', version.server]]) {
    const golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${directory}${name} golden bytes`);
  }
}
for (const directory of ['v1_5_0/', 'v1_6_0/']) {
  const version = await codecs(directory), golden15 = fixture('api15-results');
  const decoded15 = JSON.parse(golden15).map(value => version.server.decode(ctx, value));
  assert.equal(JSON.stringify(decoded15.map(value => version.server.encode(ctx, value))), golden15, `${directory}api15-results golden bytes`);
}
const latest = await codecs('');
// BA specified: retained1.6 and current1.7 exact pinned literal-search contracts.
for (const directory of ['v1_6_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of [['api16-clients', version.client], ['api16-results', version.server]]) {
    const golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${directory}${name} golden bytes`);
  }
}
for (const [name, codec] of [['api17-clients', latest.client], ['api17-results', latest.server]]) {
  const golden = fixture(name);
  const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
  assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${name} golden bytes`);
}
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/']) {
  const retained = await codecs(directory);
  assert.throws(() => retained.client.decode(ctx, JSON.parse(fixture('api16-clients'))[0]), /Unknown ADT branch/);
  assert.throws(() => retained.server.decode(ctx, JSON.parse(fixture('api16-results'))[0]), /Unknown ADT branch/);
}
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/']) {
  const retained = await codecs(directory);
  assert.throws(() => retained.client.decode(ctx, JSON.parse(fixture('api17-clients'))[0]), /Unknown ADT branch/);
  const status = JSON.parse(fixture('api17-results')).find(value => value.result.ReindexStatus);
  assert.throws(() => retained.server.decode(ctx, status), /Unknown ADT branch/);
}
console.log('46 generated TypeScript fixture groups passed; eight API versions, frozen1.0–1.6 contracts,1.7 rebuild/stage/context;26 retained-version branch rejections');
