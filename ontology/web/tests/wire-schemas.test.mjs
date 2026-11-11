import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import * as C from '../.cache/fixtures/web/src/contracts.js';
import { wirePlan } from '../.cache/fixtures/generated/typescript/GeneratedWirePlan.js';
import { WireValidation } from '../.cache/fixtures/web/src/wire-validation.js';
import { extractRegistry } from '../.cache/schema-builder/scripts/schema-registry.js';
import { compilePlan } from '../.cache/schema-builder/scripts/schema-plan.js';
import { schemaFor, serialize } from '../.cache/schema-builder/scripts/schema-json.js';

const bytes = file => readFile(new URL(file, import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const rawBytes = await bytes('../../generated/schema-input/ontology_api/v0_1_0/openapi.json');
const raw = JSON.parse(rawBytes);
const fixtures = JSON.parse(await bytes('../../generated/wire/ontology-wire-fixtures.json'));
const validation = new WireValidation(wirePlan);
const codecMap = new Map(Object.entries(C).filter(([name]) => name.endsWith('_JsonCodec')).map(([, value]) => {
  const codec = value.instance;
  return [codec.baboonTypeIdentifier(), codec];
}));
const ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, allErrors: true });
const validators = new Map(wirePlan.registry.map(entry => [entry.typeId, ajv.compile(JSON.parse(serialize(schemaFor(wirePlan, entry.typeId))))]));

function bothReject(type, value) {
  const id = `ontology.api/:#${type}`;
  const codec = codecMap.get(id); const schema = validators.get(id);
  assert(codec !== undefined && schema !== undefined);
  assert.throws(() => validation.normalize(codec, value));
  assert.equal(schema(value), false);
}

test('checked registry and plan reproduce from current model and raw compiler artifact', async () => {
  const registry = extractRegistry(C, raw);
  assert.deepEqual(registry, wirePlan.registry);
  const model = await bytes('../../models/ontology.baboon');
  assert.equal(hash(model), wirePlan.modelDigest);
  assert.equal(hash(rawBytes), wirePlan.rawDigest);
  assert.deepEqual(compilePlan(registry, raw, { compilerDigest: wirePlan.compilerDigest, modelDigest: hash(model), rawDigest: hash(rawBytes) }), wirePlan);
});

test('portable MCP files reproduce with exact mathematical i64 bounds', async () => {
  for (const [tool, root] of [['find', 'FindRequest'], ['read', 'ReadRequest'], ['apply', 'ApplyRequest']]) {
    const expected = serialize(schemaFor(wirePlan, `ontology.api/:#${root}`)) + '\n';
    assert.equal((await bytes(`../../generated/wire/ontology-mcp-${tool}.json`)).toString(), expected);
  }
  const schema = serialize(schemaFor(wirePlan, 'ontology.api/:#ApplyRequest'));
  assert(schema.includes('"maximum":9223372036854775807'));
  assert(schema.includes('"minimum":-9223372036854775808'));
});

test('all registered codecs and every ADT member have executable roundtrip/schema fixtures', () => {
  assert.deepEqual(new Set(fixtures.map(value => value.typeId)), new Set(wirePlan.registry.map(value => value.typeId)));
  for (const fixture of fixtures) {
    const codec = codecMap.get(fixture.typeId); const validate = validators.get(fixture.typeId);
    assert(codec !== undefined && validate !== undefined);
    assert.equal(validate(fixture.wire), true, `${fixture.typeId}/${fixture.label}: ${ajv.errorsText(validate.errors)}`);
    const normalized = validation.normalize(codec, fixture.wire);
    assert.deepEqual(normalized, fixture.wire);
    assert.deepEqual(codec.encode(C.BaboonCodecContext.Default, codec.decode(C.BaboonCodecContext.Default, normalized)), fixture.wire);
  }
  for (const entry of wirePlan.registry.filter(value => value.parent === value.typeId)) {
    for (const member of wirePlan.registry.filter(value => value.parent === entry.typeId && value.tag !== null)) {
      assert(fixtures.some(value => value.typeId === entry.typeId && value.label === `variant:${member.tag}`));
    }
  }
});

test('unsupported component constructs and metadata disagreements fail generation', () => {
  const extra = structuredClone(raw);
  extra.components.schemas.ontology_api_Unregistered = { type: 'object' };
  assert.throws(() => extractRegistry(C, extra));
  const mismatch = structuredClone(raw);
  mismatch.components.schemas.ontology_api_Content.oneOf.pop();
  assert.throws(() => extractRegistry(C, mismatch));
  for (const mutation of [
    schema => { schema.properties.revision.format = 'int128'; },
    schema => { schema.properties.id.maxLength = 100; },
    schema => { schema.properties.id = { $ref: 'https://untrusted.invalid/schema' }; },
  ]) {
    const changed = structuredClone(raw);
    mutation(changed.components.schemas.ontology_api_Ref);
    assert.throws(() => compilePlan(wirePlan.registry, changed, { compilerDigest: wirePlan.compilerDigest, modelDigest: wirePlan.modelDigest, rawDigest: wirePlan.rawDigest }));
  }
  class WrongVersion {
    static BaboonDomainVersion = 'future';
    static BaboonDomainIdentifier = C.Ref_JsonCodec.BaboonDomainIdentifier;
    static BaboonTypeIdentifier = C.Ref_JsonCodec.BaboonTypeIdentifier;
    static get instance() { return C.Ref_JsonCodec.instance; }
  }
  assert.throws(() => extractRegistry({ ...C, Ref_JsonCodec: WrongVersion }, raw));
  const cyclic = structuredClone(raw);
  cyclic.components.schemas.ontology_api_Ref = { $ref: '#/components/schemas/ontology_api_Ref' };
  assert.throws(() => compilePlan(wirePlan.registry, cyclic, { compilerDigest: wirePlan.compilerDigest, modelDigest: wirePlan.modelDigest, rawDigest: wirePlan.rawDigest }));
});

test('closed nullable and ADT shapes reject missing extra ambiguous and malformed values', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  bothReject('Ack', { ok: 'true' });
  bothReject('Ack', { ok: true, extra: 1 });
  bothReject('Ref', { id, revision: '1' });
  bothReject('Ref', { id, revision: 1.5 });
  bothReject('Ref', { id: '1-1-1-1-1', revision: 1 });
  bothReject('Ref', { id, revision: 2147483648 });
  bothReject('Actor', { id: 'actor', kind: 'Undeclared' });
  bothReject('Identity', { actor: { id: 42, kind: 'Human' }, scopes: [], capabilities: [] });
  bothReject('Observation', {});
  bothReject('Observation', { None: {}, Unknown: {} });
  bothReject('Observation', { None: { extra: true } });
  bothReject('Observation', { Unknown: {} });
  const valid = { scope: 's', requestId: id, expectedGeneration: '0', operations: [], contributionContext: null };
  const { contributionContext, ...missing } = valid;
  bothReject('ApplyRequest', missing);
  bothReject('ApplyRequest', { ...valid, operations: 'not-an-array' });
  bothReject('ApplyRequest', { ...valid, contributionContext: { origin: { Unknown: { reason: 1 } }, reportedInherited: [] } });
});

for (const [ending, suffix] of [['LF', '\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
  const id = '00000000-0000-4000-8000-000000000001';
  const cases = [
    ['i64', 'ontology.api/:#ApplyRequest', { scope: 's', requestId: id, expectedGeneration: '1' + suffix, operations: [], contributionContext: null }],
    ['uuid', 'ontology.api/:#Ref', { id: id + suffix, revision: 1 }],
  ];
  for (const [type, typeId, value] of cases) {
    test(`${type} runtime rejects a trailing ${ending} inside its JSON string`, () => {
      const codec = codecMap.get(typeId); assert(codec !== undefined);
      assert.throws(() => validation.normalize(codec, value));
    });
    test(`${type} emitted schema rejects a trailing ${ending} inside its JSON string`, () => {
      const validate = validators.get(typeId); assert(validate !== undefined);
      assert.equal(validate(value), false);
    });
  }
}

test('i64 normalization is exact and only applies at schema-identified positions', () => {
  const request = expectedGeneration => ({ scope: 's', requestId: '00000000-0000-4000-8000-000000000001', expectedGeneration, operations: [], contributionContext: null });
  const codec = C.ApplyRequest.jsonCodec();
  const validate = validators.get(codec.baboonTypeIdentifier());
  assert(validate !== undefined);
  for (const value of [0n, -1n, 1n, -(1n << 63n), (1n << 63n) - 1n]) {
    assert.equal(validation.normalize(codec, request(value)).expectedGeneration, value.toString());
    assert.equal(validation.normalize(codec, request(value.toString())).expectedGeneration, value.toString());
    assert.equal(validate(request(value.toString())), true);
  }
  assert.equal(validation.normalize(codec, request(-0)).expectedGeneration, '0');
  assert.equal(validation.normalize(codec, request('-0')).expectedGeneration, '0');
  assert.equal(validate(request('-0')), true);
  for (const value of [-(1n << 63n) - 1n, 1n << 63n]) {
    assert.throws(() => validation.normalize(codec, request(value)));
    bothReject('ApplyRequest', request(value.toString()));
  }
  for (const value of ['01', '-01', '+1', ' 1', '1 ', '0x10', '1e0', '']) bothReject('ApplyRequest', request(value));
  assert.throws(() => validation.normalize(codec, request(2 ** 63)));
  assert.throws(() => validation.normalize(C.Actor.jsonCodec(), { id: 9007199254740993n, kind: 'Human' }));
  const numeric = { ok: true };
  assert.deepEqual(validation.normalize(C.Ack.jsonCodec(), numeric), numeric);
});
