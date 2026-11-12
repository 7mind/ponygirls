import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateUsage, assistantRecords, DELTA_FOCUS, hash, reportInventory, searchRounds } from './memory.mjs';
import { assertAllowedModel, createRuntime, MODEL_SELECTION, readProviderConfig } from './runtime.mjs';

const raw = name => JSON.stringify({ objectives: [{ objective: name, progress: 'Draft only', issues: [], eta: 'Unknown' }], rules: [] });
const entry = (id, value) => ({ id, type: 'custom', customType: 'cuckoo.report', timestamp: `2026-11-12T00:00:0${id}Z`, parentId: null, data: { version: 4, requestId: `request-${id}`, raw: value, error: null } });

// Behavioral-Active / Blackbox-Atomic: instrument guarantees, not semantic relevance.
test('file bytes and text share ordinary SHA-256 identity', () => {
  assert.equal(hash(Buffer.from('abc')), hash('abc'));
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('search uses only supplied historical rounds, literal words and newest tie breaks', () => {
  const branch = [entry('1', raw('Sensor correction')), entry('2', raw('Payment reconciliation')), entry('3', raw('Sensor observation'))];
  const before = structuredClone(branch);
  const found = searchRounds(branch, 'sensor', 5);
  assert.deepEqual(found.matches.map(match => match.entryId), ['3', '1']);
  assert.equal(found.totalMatches, 2); assert.match(found.notice, /not verified facts or authority/);
  assert.deepEqual(searchRounds(branch, 'payment sensor', 1).matches.map(match => match.entryId), ['3']);
  assert.equal(searchRounds(branch, 'sens', 5).totalMatches, 0);
  assert.equal(searchRounds([], 'sensor', 5).totalMatches, 0);
  assert.deepEqual(branch, before);
});

test('search exposes invalid status, bounds previews and rejects invalid requests', () => {
  const branch = [entry('1', 'sensor '.repeat(1000))];
  const result = searchRounds(branch, 'sensor', 1);
  assert.equal(result.matches[0].status, 'invalid'); assert.equal(result.matches[0].preview.length, 400); assert.equal(result.matches[0].previewTruncated, true);
  assert.equal(reportInventory(branch)[0].raw, branch[0].data.raw);
  for (const query of ['', ' ', '.', 'a'.repeat(401), null]) assert.throws(() => searchRounds(branch, query, 1));
  for (const limit of [0, 6, -1, 1.5, NaN]) assert.throws(() => searchRounds(branch, 'sensor', limit));
});

test('response accounting retains errors, unknown zero usage, tool turns and public text only', () => {
  const usage = { input: 2, output: 3, cacheRead: 4, cacheWrite: 0, totalTokens: 9 };
  const message = { role: 'assistant', provider: 'p', model: 'm', stopReason: 'toolUse', usage, content: [{ type: 'thinking', thinking: 'not public evidence' }, { type: 'text', text: 'Provisional' }, { type: 'toolCall', id: 't1', name: 'fixture_read', arguments: { ids: ['r1'] } }] };
  const entries = [{ id: 'a', type: 'message', message }, { id: 'b', type: 'message', message: { ...message, stopReason: 'error', content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } }];
  const responses = assistantRecords(entries, new Set(['a']), 'update');
  assert.equal(responses[0].checkpoint, true); assert.equal(responses[0].text, 'Provisional'); assert.equal(responses[0].toolCalls.length, 1);
  assert.equal(responses[1].usageKnown, false);
  assert.deepEqual(aggregateUsage(responses), { ...usage, unknownResponses: 1 });
  assert.doesNotMatch(JSON.stringify(responses), /not public evidence/);
});

test('model routing rejects Anthropic and all unregistered substitutions', () => {
  for (const model of MODEL_SELECTION) assert.doesNotThrow(() => assertAllowedModel(model.provider, model.id));
  for (const [provider, id] of [['anthropic', 'claude-fable-5'], ['openai-codex', 'claude'], ['compatible', 'unregistered'], ['other', 'gpt-6.1-sol']]) assert.throws(() => assertAllowedModel(provider, id), /allowlist/);
  assert.doesNotMatch(DELTA_FOCUS, /worker|router|stock|sensor|consent|payment|meeting|2\.1|Wed09/i);
});

test('private provider configuration accepts only HTTPS origin data and an environment-variable name', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cuckoo-provider-config-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'provider.json');
  const valid = { baseUrl: 'https://fixture.invalid/v1/', apiKeyEnv: 'FIXTURE_KEY' };
  writeFileSync(path, JSON.stringify(valid)); assert.deepEqual(readProviderConfig(path), valid);
  for (const value of [{ ...valid, apiKey: 'must-not-store-values' }, { ...valid, apiKeyEnv: '!command' }, { ...valid, baseUrl: 'http://fixture.invalid' }, { ...valid, baseUrl: 'https://user:secret@fixture.invalid' }, { ...valid, baseUrl: 'https://fixture.invalid/?secret=bad' }]) {
    writeFileSync(path, JSON.stringify(value)); assert.throws(() => readProviderConfig(path), /Pilot/);
  }
  for (const text of ['not JSON secret-marker', JSON.stringify({ ...valid, baseUrl: 'secret-marker invalid URL' })]) {
    writeFileSync(path, text);
    assert.throws(() => readProviderConfig(path), error => error.message.startsWith('Pilot ') && !error.message.includes('secret-marker'));
  }
});

test('compatible backend options reach model metadata, not an ignored provider-level field', async () => {
  let options; let provider;
  const runtime = { registerProvider(name, config) { provider = { name, config }; } };
  const sdk = { ModelRuntime: { async create(value) { options = value; return runtime; } } };
  const signal = new AbortController().signal;
  const config = { baseUrl: 'https://fixture.invalid/v1/', apiKeyEnv: 'FIXTURE_KEY' };
  assert.equal(await createRuntime(sdk, '/fixture/auth.json', signal, config), runtime);
  assert.equal(options.modelsPath, null); assert.equal(options.allowModelNetwork, false); assert.equal(options.refreshOnCreate, false);
  assert.equal(provider.config.baseUrl, config.baseUrl); assert.equal(provider.config.apiKey, '$FIXTURE_KEY');
  for (const model of provider.config.models) assert.equal(model.compat.supportsDeveloperRole, false);
});
