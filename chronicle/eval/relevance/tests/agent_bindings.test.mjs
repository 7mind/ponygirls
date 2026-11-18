import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyCatalogV3 } from '../agent_protocol_v3.mjs';

const fixture = JSON.parse(readFileSync(new URL('./data/recorded-agent-catalog.json', import.meta.url), 'utf8'));
const captured = fixture.catalog;
const input = { agentModel: captured.model, agentRevision: captured.modelRevision,
  agentMaximumOutputTokens: captured.maximumOutputTokens, agentReasoningPolicy: captured.reasoningPolicy, catalogVariant: 'baseline' };
const verify = (catalog, bindings) => verifyCatalogV3(catalog, bindings, bindings.catalogVariant);

test('actual public catalog modelRevision and declared max metadata pass V3 catalog verification; high is rejected', () => {
  assert.equal(Object.hasOwn(captured, 'modelRevision'), true);
  assert.equal(Object.hasOwn(captured, 'revision'), false);
  assert.doesNotThrow(() => verify(captured, input));
  const high = structuredClone(captured); high.reasoningPolicy = 'high';
  assert.throws(() => verify(high, { ...input, agentReasoningPolicy: 'high' }));
});
test('missing, mismatched or mistyped actual agent metadata fails catalog verification', () => {
  for (const [field, values] of [
    ['modelRevision', [undefined, 'different-revision', 1017]],
    ['maximumOutputTokens', [undefined, 32768, '65536']],
    ['reasoningPolicy', [undefined, 'high', 1]],
  ]) {
    for (const value of values) {
      const catalog = structuredClone(captured); catalog[field] = value;
      assert.throws(() => verify(catalog, input), undefined, `${field}=${value} must be rejected`);
    }
  }
});
test('new expected agent bindings are required with exact types', () => {
  for (const [field, values] of [
    ['agentRevision', [undefined, '', 1017]],
    ['agentMaximumOutputTokens', [undefined, 0, '65536']],
    ['agentReasoningPolicy', [undefined, '', 1]],
  ]) {
    for (const value of values) {
      const bindings = { ...input, [field]: value };
      assert.throws(() => verify(captured, bindings), undefined, `${field}=${value} must be rejected`);
    }
  }
});
