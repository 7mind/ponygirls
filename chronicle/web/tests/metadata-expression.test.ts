import assert from 'node:assert/strict';
import test from 'node:test';
import { addMetadataFilter, validateMetadataExpression } from '../src/expression.ts';

test('BA: metadata quick filters conjoin the entire Boolean body and quote literal values', () => {
  assert.equal(addMetadataFilter('collector:a OR collector:b', 'phase', 'Uploading'), '(collector:a OR collector:b) AND phase:"Uploading"');
  assert.equal(addMetadataFilter('NOT {project:a OR project:b}', 'profile', 'index/hash'), '(NOT {project:a OR project:b}) AND profile:"index/hash"');
  assert.equal(addMetadataFilter('', 'reason', 'quoted "value"\\tail'), 'reason:"quoted \\"value\\"\\\\tail"');
});
test('BA: Activity has no mode directive in any Boolean position', () => {
  for (const expression of ['mode:lexical', 'MODE : "semantic"', '(mode:hybrid)', 'collector:a OR mode:lexical', 'NOT mode:lexical']) assert.throws(() => validateMetadataExpression(expression), /not supported/);
  for (const expression of ['tag:"mode:semantic"', 'mode\\:lexical', '"mode:hybrid"', 'model:"source-model"']) assert.doesNotThrow(() => validateMetadataExpression(expression));
});
test('BA: metadata composition never silently repairs malformed syntax or claims field policy', () => {
  for (const expression of ['NOT AND collector:a', 'collector:a AND AND status:failed', 'tag:mode:lexical', '(collector:a}']) assert.throws(() => addMetadataFilter(expression, 'status', 'failed'));
  assert.equal(addMetadataFilter('unknown:value', 'collector', 'a'), '(unknown:value) AND collector:"a"', 'field applicability remains server-authoritative');
});
