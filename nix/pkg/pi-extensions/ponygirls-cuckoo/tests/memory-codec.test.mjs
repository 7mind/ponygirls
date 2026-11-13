import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMemoryRecord, MemoryCodecError, textDigest } from '../src/memory-core.ts';

const task = { kind: 'task', id: 'task', taskId: 'task', label: 'Synthetic task', userEntryId: 'user' };
function snapshot(text) {
  const digest = textDigest(text);
  return { kind: 'snapshot', id: 'snapshot', taskId: 'task', purpose: 'artifact', label: 'Historical selection', source: { selector: { entryId: 'unavailable-source', part: 0, start: 0, end: text.length }, role: 'assistant', toolName: null, timestamp: '2026-11-12T00:00:00.000Z', digest }, text, digest, dependsOn: [] };
}
function rejects(record, code) {
  assert.throws(() => decodeMemoryRecord(record), error => error instanceof MemoryCodecError && error.code === code);
}

test('shared structural decoding preserves exact immutable historical records without source lookup', () => {
  assert.deepEqual(decodeMemoryRecord(task), task);
  const original = snapshot(' \t\n\ud800');
  const decoded = decodeMemoryRecord(original);
  assert.deepEqual(decoded, original);
  assert.ok(Object.isFrozen(decoded)); assert.ok(Object.isFrozen(decoded.source.selector));
  original.source.selector.entryId = 'changed-by-caller';
  assert.equal(decoded.source.selector.entryId, 'unavailable-source');
});

test('shared codec errors have typed schema, bounds, reference and integrity categories', () => {
  rejects({ ...task, label: ' \t' }, 'SCHEMA');
  rejects({ ...task, label: '' }, 'BOUNDS');
  rejects({ ...task, label: 'x'.repeat(257) }, 'BOUNDS');
  rejects({ ...task, taskId: 'different' }, 'REFERENCE');
  rejects({ ...snapshot('text'), text: 'changed' }, 'DIGEST');
  rejects(snapshot(''), 'BOUNDS');
  const invalidSelection = snapshot('text'); invalidSelection.source.selector.end++;
  rejects(invalidSelection, 'SCHEMA');
  rejects({ ...snapshot('text'), dependsOn: ['same', 'same'] }, 'REFERENCE');
  rejects({ ...snapshot('text'), purpose: 'evidence', dependsOn: ['prior'] }, 'REFERENCE');
  rejects({ ...task, unexpected: true }, 'SCHEMA');
});
