import test from 'node:test';
import assert from 'node:assert/strict';
import { capsuleSlots } from '../scripts/provider-observation.mjs';

test('controlled provider observation reads strings and actual text-block arrays without changing bytes', () => {
  const text = '# Qualified ontology context\nfixture';
  assert.deepEqual(capsuleSlots({ messages: [{ content: text }, { content: [{ type: 'text', text }] }, { content: null }] }), [text, text]);
  assert.deepEqual(capsuleSlots({ messages: [{ content: [{ type: 'image_url', text }, { type: 'text', text: 'ordinary input' }] }] }), []);
});
