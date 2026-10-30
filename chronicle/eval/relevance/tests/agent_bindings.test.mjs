import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as protocol from '../live_protocol.mjs';

const fixture = JSON.parse(readFileSync(new URL('./data/recorded-agent-catalog.json', import.meta.url), 'utf8'));
const captured = fixture.catalog;
const input = { agentModel: captured.model, agentRevision: captured.modelRevision,
  agentMaximumOutputTokens: captured.maximumOutputTokens, agentReasoningPolicy: captured.reasoningPolicy };
const source = readFileSync(new URL('../agent_probe.mjs', import.meta.url), 'utf8');
const begin = source.indexOf('  assert.equal(catalog.model, input.agentModel);');
const end = source.indexOf('  for (const task of input.tasks)', begin);
assert.ok(begin >= 0 && end > begin);
const guard = new Function('assert', 'catalog', 'input', 'verifyAgentCatalog', 'start', source.slice(begin, end) + '\nstart();');
function beforeStart(catalog, bindings) {
  let starts = 0;
  guard(assert, catalog, bindings, protocol.verifyAgentCatalog, () => { starts += 1; });
  return starts;
}

test('actual public catalog modelRevision and declared high/max metadata pass the pre-Start guards', () => {
  assert.equal(Object.hasOwn(captured, 'modelRevision'), true);
  assert.equal(Object.hasOwn(captured, 'revision'), false);
  assert.equal(beforeStart(captured, input), 1);
  const high = structuredClone(captured); high.reasoningPolicy = 'high';
  assert.equal(beforeStart(high, { ...input, agentReasoningPolicy: 'high' }), 1);
});
test('missing, mismatched or mistyped actual agent metadata fails before Start', () => {
  for (const [field, values] of [
    ['modelRevision', [undefined, 'different-revision', 1017]],
    ['maximumOutputTokens', [undefined, 32768, '65536']],
    ['reasoningPolicy', [undefined, 'high', 1]],
  ]) {
    for (const value of values) {
      const catalog = structuredClone(captured); catalog[field] = value;
      assert.throws(() => beforeStart(catalog, input), undefined, `${field}=${value} must be rejected before Start`);
    }
  }
});
test('new expected agent bindings are required with exact types before Start', () => {
  for (const [field, values] of [
    ['agentRevision', [undefined, '', 1017]],
    ['agentMaximumOutputTokens', [undefined, 0, '65536']],
    ['agentReasoningPolicy', [undefined, '', 1]],
  ]) {
    for (const value of values) {
      const bindings = { ...input, [field]: value };
      assert.throws(() => beforeStart(captured, bindings), undefined, `${field}=${value} must be rejected before Start`);
    }
  }
});
