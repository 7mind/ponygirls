import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BaboonCodecContext } from '../target/codec-js/BaboonSharedRuntime.js';
import { ClientEnvelope_JsonCodec } from '../target/codec-js/chronicle/api/ClientEnvelope.js';
import { ServerEnvelope_JsonCodec } from '../target/codec-js/chronicle/api/ServerEnvelope.js';
import { IngestRequest_JsonCodec } from '../target/codec-js/chronicle/api/IngestRequest.js';
for (const [name, codec] of [['client', ClientEnvelope_JsonCodec.instance], ['server', ServerEnvelope_JsonCodec.instance], ['ingest', IngestRequest_JsonCodec.instance]]) {
  const fixture = JSON.parse(readFileSync(new URL(`../server/src/test/fixtures/${name}.json`, import.meta.url), 'utf8'));
  assert.deepEqual(codec.encode(BaboonCodecContext.Default, codec.decode(BaboonCodecContext.Default, fixture)), fixture);
}
console.log('3 generated TypeScript codec fixtures passed (shared with Scala)');
