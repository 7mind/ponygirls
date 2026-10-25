import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyPolicy } from '../src/privacy.ts';

test('BA custom/unknown object data survives while image-generation bytes and embedded JSON secrets do not', () => {
  const policy = privacyPolicy({ fieldNames: ['privateField'], textPatterns: [] });
  const original = { type: 'custom', data: { count: 42, ordinary: 'retained' }, unknown: { retained: true } };
  assert.deepEqual(policy.redact(original), { value: original, changed: false });
  const redacted = policy.redact({ type: 'function_call', arguments: '{"password":"SYNTHETIC_PASSWORD","privateField":"PRIVATE","ordinary":"kept"}', nested: { type: 'image_generation_call', result: 'BINARY_PAYLOAD' } });
  assert.equal(redacted.changed, true);
  assert.doesNotMatch(JSON.stringify(redacted.value), /SYNTHETIC_PASSWORD|PRIVATE|BINARY_PAYLOAD/);
  assert.match(JSON.stringify(redacted.value), /kept/);
});

test('BA configured text redactions also apply to sanitized git remotes', () => {
  const cleaned = privacyPolicy({ fieldNames: [], textPatterns: ['private-repo'] }).redact({ gitRemote: 'https://example.invalid/private-repo.git' });
  assert.doesNotMatch(JSON.stringify(cleaned.value), /private-repo/);
});
