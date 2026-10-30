import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BaboonCodecContext } from '../target/codec-js/generated/typescript/BaboonSharedRuntime.js';
const ctx = BaboonCodecContext.Default;
const directories = ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/', 'v1_7_0/', ''];
let fixtureGroups = 0;
let retainedBranchRejections = 0;
const fixture = name => JSON.stringify(JSON.parse(readFileSync(new URL(`../server/src/test/fixtures/${name}.json`, import.meta.url), 'utf8')));
const codecs = async directory => {
  const load = file => import(`../target/codec-js/generated/typescript/chronicle/api/${directory}${file}.js`);
  const [client, server, ingest] = await Promise.all(['ClientEnvelope', 'ServerEnvelope', 'IngestRequest'].map(load));
  return { client: client.ClientEnvelope_JsonCodec.instance, server: server.ServerEnvelope_JsonCodec.instance, ingest: ingest.IngestRequest_JsonCodec.instance };
};
for (const directory of directories) {
  const version = await codecs(directory);
  for (const [name, codec] of Object.entries(version)) {
    const golden = fixture(name);
    assert.equal(JSON.stringify(codec.encode(ctx, codec.decode(ctx, JSON.parse(golden)))), golden, `${directory || '1.8.0/'}${name} golden bytes`);
    fixtureGroups++;
  }
}
for (const directory of ['v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/', 'v1_7_0/', '']) {
  const { CollectorProgressUpdate_JsonCodec } = await import(`../target/codec-js/generated/typescript/chronicle/api/${directory}CollectorProgressUpdate.js`);
  const golden = fixture('progress');
  assert.equal(JSON.stringify(CollectorProgressUpdate_JsonCodec.instance.encode(ctx, CollectorProgressUpdate_JsonCodec.instance.decode(ctx, JSON.parse(golden)))), golden);
  fixtureGroups++;
}
for (const directory of ['v1_4_0/', 'v1_5_0/', 'v1_6_0/', 'v1_7_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of [['api14-clients', version.client], ['api14-results', version.server]]) {
    const golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${directory}${name} golden bytes`);
    fixtureGroups++;
  }
}
for (const directory of ['v1_5_0/', 'v1_6_0/']) {
  const version = await codecs(directory), golden15 = fixture('api15-results');
  const decoded15 = JSON.parse(golden15).map(value => version.server.decode(ctx, value));
  assert.equal(JSON.stringify(decoded15.map(value => version.server.encode(ctx, value))), golden15, `${directory}api15-results golden bytes`);
  fixtureGroups++;
}
const latest = await codecs('');
// BA specified: retained1.6/1.7 and current1.8 exact pinned literal-search contracts.
for (const directory of ['v1_6_0/', 'v1_7_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of [['api16-clients', version.client], ['api16-results', version.server]]) {
    const golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${directory}${name} golden bytes`);
    fixtureGroups++;
  }
}
for (const directory of ['v1_7_0/', '']) {
  const version = await codecs(directory);
  for (const [name, codec] of [['api17-clients', version.client], ['api17-results', version.server]]) {
    const golden = fixture(name);
    const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
    assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${directory}${name} golden bytes`);
    fixtureGroups++;
  }
}
for (const [name, codec, branch, field] of [
  ['api18-clients', latest.client, 'operation', 'preferRelevance'],
  ['api18-results', latest.server, 'result', 'relevanceOrdered'],
]) {
  const golden = fixture(name);
  const decoded = JSON.parse(golden).map(value => codec.decode(ctx, value));
  assert.equal(JSON.stringify(decoded.map(value => codec.encode(ctx, value))), golden, `${name} golden bytes`);
  const flags = decoded.map(value => branch === 'operation' ? value.operation.query[field] : value.result.result[field]);
  assert.deepEqual(flags, [false, true]);
  fixtureGroups++;
}
const { convert__archive_query__from__1_7_0, convert__archive_result__from__1_7_0 } = await import('../target/codec-js/protocol/typescript/conversions.js');
for (const [name, file, codecName, field, payload, upgrade] of [
  ['api18-clients', 'ArchiveQuery', 'ArchiveQuery_JsonCodec', 'preferRelevance', value => value.operation.Archive.query, convert__archive_query__from__1_7_0],
  ['api18-results', 'ArchiveResult', 'ArchiveResult_JsonCodec', 'relevanceOrdered', value => value.result.Archive.result, convert__archive_result__from__1_7_0],
]) {
  const retained = (await import(`../target/codec-js/generated/typescript/chronicle/api/v1_7_0/${file}.js`))[codecName].instance;
  const current = (await import(`../target/codec-js/generated/typescript/chronicle/api/${file}.js`))[codecName].instance;
  for (const envelope of JSON.parse(fixture(name))) {
    const old = { ...payload(envelope) };
    delete old[field];
    const decoded = retained.decode(ctx, old);
    assert.deepEqual(retained.encode(ctx, decoded), old);
    const upgraded = upgrade(decoded);
    assert.equal(upgraded[field], false);
    assert.deepEqual(current.encode(ctx, upgraded), { ...old, [field]: false });
  }
  fixtureGroups++;
}
const { convert__client_envelope__from__1_7_0 } = await import('../target/codec-js/generated/typescript/chronicle/api/from_1_7_0_client-envelope.js');
const { convert__server_envelope__from__1_7_0 } = await import('../target/codec-js/generated/typescript/chronicle/api/from_1_7_0_server-envelope.js');
const retained17 = await codecs('v1_7_0/');
// BA specified: full generated envelope conversions reach both nested archive stub routes.
for (const [name, retained, current, payload, field, upgrade] of [
  ['api18-clients', retained17.client, latest.client, value => value.operation.Archive.query, 'preferRelevance', convert__client_envelope__from__1_7_0],
  ['api18-results', retained17.server, latest.server, value => value.result.Archive.result, 'relevanceOrdered', convert__server_envelope__from__1_7_0],
]) {
  for (const envelope of JSON.parse(fixture(name))) {
    const old = structuredClone(envelope);
    delete payload(old)[field];
    const decoded = retained.decode(ctx, old);
    assert.deepEqual(retained.encode(ctx, decoded), old);
    const upgraded = upgrade(decoded);
    const encoded = current.encode(ctx, upgraded);
    const expected = structuredClone(old);
    payload(expected)[field] = false;
    assert.equal(payload(encoded)[field], false);
    assert.deepEqual(encoded, expected);
    assert.deepEqual(current.encode(ctx, current.decode(ctx, encoded)), expected);
  }
  fixtureGroups++;
}
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/']) {
  const retained = await codecs(directory);
  retainedBranchRejections++;
  assert.throws(() => retained.client.decode(ctx, JSON.parse(fixture('api16-clients'))[0]), /Unknown ADT branch/);
  retainedBranchRejections++;
  assert.throws(() => retained.server.decode(ctx, JSON.parse(fixture('api16-results'))[0]), /Unknown ADT branch/);
}
for (const directory of ['v1_0_0/', 'v1_1_0/', 'v1_2_0/', 'v1_3_0/', 'v1_4_0/', 'v1_5_0/', 'v1_6_0/']) {
  const retained = await codecs(directory);
  retainedBranchRejections++;
  assert.throws(() => retained.client.decode(ctx, JSON.parse(fixture('api17-clients'))[0]), /Unknown ADT branch/);
  const status = JSON.parse(fixture('api17-results')).find(value => value.result.ReindexStatus);
  retainedBranchRejections++;
  assert.throws(() => retained.server.decode(ctx, status), /Unknown ADT branch/);
}
console.log(`${fixtureGroups} generated TypeScript fixture groups passed; ${directories.length} API versions, frozen1.0–1.7 contracts,1.8 archive relevance;${retainedBranchRejections} retained-version branch rejections`);
