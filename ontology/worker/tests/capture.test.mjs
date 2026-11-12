import test from 'node:test';
import assert from 'node:assert/strict';
import { captureEntry, captureSourceId } from '../.cache/worker/src/capture.js';

const attachment = { sessionId: 'native-session', branch: 'attachment-branch', epoch: '00000000-0000-4000-8000-000000000001' };
const ids = { requestId: '00000000-0000-4000-8000-000000000002', eventId: '00000000-0000-4000-8000-000000000003' };
const entry = message => ({ id: 'entry-a', parentId: null, type: 'message', message });
const capture = value => captureEntry('scope', attachment, value, ids, [], { maxTextBytes: 4096 });

test('capture source identity matches the JVM UUID.nameUUIDFromBytes convention', () => {
  assert.equal(captureSourceId('collector-credential', '00000000-0000-4000-8000-000000000001'), '9bf375de-29a0-3d44-8f77-25d2f28ad7be');
});
test('native user role remains a report with unknown lineage and no host observation', () => {
  const value = capture(entry({ role: 'user', content: 'A request', timestamp: 123 }));
  assert.equal(value.origin, 'UserMessage');
  assert.deepEqual(JSON.parse(value.text), { role: 'user', content: 'A request' });
  assert.equal(value.metadata.observedAt, undefined);
  assert.equal(value.occurrenceContext.origin.context.lineage, 'Unknown');
  assert.equal(value.occurrenceContext.origin.context.rootSessionId, undefined);
  assert.equal(value.contributionContext, undefined);
  assert.equal(value.observation.constructor.name, 'Observation_None');
});
test('derived entries and system state never feed primary capture', () => {
  for (const role of ['custom', 'system', 'compactionSummary', 'branchSummary', 'bashExecution']) {
    assert.equal(capture(entry({ role, content: 'derived content' })), null);
  }
  assert.equal(capture({ ...entry(null), type: 'custom_message' }), null);
});
test('text blocks retain order and nontext content is explicitly omitted', () => {
  const value = capture(entry({ role: 'assistant', stopReason: 'stop', content: [
    { type: 'text', text: 'one' }, { type: 'thinking', thinking: 'not captured' },
    { type: 'text', text: 'two' }, { type: 'toolCall', arguments: { secret: 'not captured' } },
  ] }));
  assert.deepEqual(JSON.parse(value.text).content, [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]);
  assert(value.metadata.omissions.includes('omitted-block:thinking'));
  assert(value.metadata.omissions.includes('omitted-block:toolCall'));
  assert(!value.text.includes('not captured'));
});
test('partial assistant and error tool reports retain their reported outcome qualification', () => {
  const assistant = capture(entry({ role: 'assistant', stopReason: 'aborted', content: [{ type: 'text', text: 'partial' }] }));
  assert.deepEqual(JSON.parse(assistant.text).outcome, { stopReason: 'aborted' });
  const tool = capture(entry({ role: 'toolResult', isError: true, content: [{ type: 'text', text: 'tool failed' }] }));
  assert.deepEqual(JSON.parse(tool.text).outcome, { isError: true });
  assert.equal(tool.observation.constructor.name, 'Observation_None');
});
test('unfinished and oversized entries fail rather than silently truncating', () => {
  assert.throws(() => capture(entry({ role: 'assistant', stopReason: 'pending', content: [] })), /unfinished/);
  assert.throws(() => captureEntry('scope', attachment, entry({ role: 'user', content: '😀' }), ids, [], { maxTextBytes: 1 }), /capacity/);
});
