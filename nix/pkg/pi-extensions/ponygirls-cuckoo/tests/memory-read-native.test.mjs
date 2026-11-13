import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { appendMemory, makeTask, makeSnapshot } from '../src/memory-core.ts';
import { queryMemory } from '../src/memory-read.ts';

function branchedFixture() {
  const manager = SessionManager.inMemory(); let sequence = 0;
  const runtime = { newId: () => `memory-${++sequence}`, now: () => '2026-11-12T00:00:00.000Z' };
  const port = {
    view() { return { sessionId: manager.getSessionId(), entries: manager.getEntries(), branch: manager.getBranch() }; },
    append(record) {
      const entryId = manager.appendCustomEntry('cuckoo.memory', { version: 1, record });
      return { entryId, timestamp: manager.getEntry(entryId).timestamp, branch: 'current', record };
    },
  };
  manager.appendMessage({ role: 'user', content: 'Synthetic task', timestamp: 1 });
  const task = appendMemory(port, makeTask(port.view(), 'Task label', runtime));
  const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'historical selection' }], timestamp: 2 });
  const snapshot = appendMemory(port, makeSnapshot(port.view(), task.record.id, 'artifact', 'Earlier artifact', { entryId, part: 0, start: 0, end: 20 }, [], runtime));
  manager.branch(task.entryId);
  return { manager, port, task, snapshot };
}

test('read IDs and cursors enforce their shared 128-code-unit limit before lookup', () => {
  const f = branchedFixture(); const oversized = 'x'.repeat(129);
  for (const request of [
    { kind: 'list-records', taskId: oversized },
    { kind: 'list-records', cursor: oversized },
    { kind: 'list-sources', cursor: oversized },
    { kind: 'inspect', id: oversized },
    { kind: 'snapshot-text', id: oversized },
    { kind: 'source-text', selector: { entryId: oversized, part: 0, start: 0, end: 1 } },
  ]) assert.throws(() => queryMemory(f.port.view(), request), /128/);
});

// Regression-origin Behavioral-Active / Blackbox-Group with the real native session tree.
test('inspection honors explicit branch scope and defaults to the current branch', () => {
  const f = branchedFixture(); const id = f.snapshot.record.id;
  assert.throws(() => queryMemory(f.port.view(), { kind: 'inspect', id, scope: 'branch' }), /Record not found/);
  assert.throws(() => queryMemory(f.port.view(), { kind: 'inspect', id }), /Record not found/);
  const historical = queryMemory(f.port.view(), { kind: 'inspect', id, scope: 'session' });
  assert.equal(historical.branch, 'other'); assert.equal(historical.status, null);
  assert.equal(historical.textAction.scope, 'session');
});

test('exact snapshot text requires explicit session scope for an alternative branch', () => {
  const f = branchedFixture(); const id = f.snapshot.record.id;
  assert.throws(() => queryMemory(f.port.view(), { kind: 'snapshot-text', id }), /Record not found/);
  const page = queryMemory(f.port.view(), { kind: 'snapshot-text', id, scope: 'session' });
  assert.equal(page.branch, 'other'); assert.equal(page.text, 'historical selection');
});

test('invalid alternative-branch memory does not contaminate a current-branch read', () => {
  const f = branchedFixture();
  f.manager.branch(f.snapshot.entryId);
  const bad = f.manager.appendCustomEntry('cuckoo.memory', { version: 99, record: {} });
  f.manager.branch(f.task.entryId);
  const result = queryMemory(f.port.view(), { kind: 'list-records', scope: 'branch' });
  assert.deepEqual(result.records.map(record => record.id), [f.task.record.id]);
  assert.throws(() => queryMemory(f.port.view(), { kind: 'list-records', scope: 'session' }), error => error.message.includes(bad));
});
