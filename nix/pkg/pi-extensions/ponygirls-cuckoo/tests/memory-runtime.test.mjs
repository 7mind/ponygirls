import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { NativeMemoryPort, MemoryScopeEpoch, nativeMemoryRuntime } from '../src/memory-runtime.ts';
import { MEMORY_TYPE } from '../src/memory-types.ts';
import { appendMemory, readMemory } from '../src/memory-core.ts';

function task(manager, id) {
  const userEntryId = manager.appendMessage({ role: 'user', content: 'Synthetic task', timestamp: 1 });
  return { id, taskId: id, kind: 'task', label: 'Synthetic task label', userEntryId };
}

test('native port observes its own entry even when a synchronous observer appends afterward', () => {
  const manager = SessionManager.inMemory(); const record = task(manager, 'task-1');
  const pi = { appendEntry(type, data) { manager.appendCustomEntry(type, data); manager.appendCustomEntry('other-extension', { event: 'observed' }); } };
  const port = new NativeMemoryPort(pi, manager); const stored = appendMemory(port, record);
  assert.notEqual(stored.entryId, manager.getLeafId()); assert.equal(stored.branch, 'current');
  assert.equal(manager.getEntry(stored.entryId).customType, MEMORY_TYPE);
  assert.deepEqual(stored.record, record);
  record.label = 'caller mutation';
  assert.throws(() => { stored.record.label = 'returned copy mutation'; }, TypeError);
  assert.equal(manager.getEntry(stored.entryId).data.record.label, 'Synthetic task label');
});

test('native port fails instead of returning a fictional append identity', () => {
  const manager = SessionManager.inMemory(); const record = task(manager, 'task-1');
  const port = new NativeMemoryPort({ appendEntry() {} }, manager);
  assert.throws(() => port.append(record), /exactly once/);
});

test('native port is bound to a session identity, not an in-place fork replacement', () => {
  const manager = SessionManager.inMemory(); const record = task(manager, 'task-1');
  const port = new NativeMemoryPort({ appendEntry(type, data) { manager.appendCustomEntry(type, data); } }, manager);
  const stored = port.append(record); const sourceSession = port.view().sessionId;
  manager.createBranchedSession(stored.entryId);
  assert.notEqual(manager.getSessionId(), sourceSession);
  assert.throws(() => port.view(), /session changed/);
  assert.throws(() => port.append({ ...record, id: 'task-2', taskId: 'task-2' }), /session changed/);
});

test('native metadata survives disk reopen without changing the session source', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cuckoo-memory-native-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(directory, directory); const record = task(manager, 'task-1');
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic output' }], api: 'openai-completions', provider: 'fixture', model: 'fixture', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 2 });
  const port = new NativeMemoryPort({ appendEntry(type, data) { manager.appendCustomEntry(type, data); } }, manager);
  const stored = port.append(record); const reopened = SessionManager.open(manager.getSessionFile());
  assert.deepEqual(reopened.getEntry(stored.entryId).data.record, record);
  assert.equal(reopened.getSessionId(), manager.getSessionId());
  const reopenedPort = new NativeMemoryPort({ appendEntry() { assert.fail('Read must not append'); } }, reopened);
  assert.deepEqual(readMemory(reopenedPort.view(), 'branch').map(item => item.record), [record]);
});

test('scope epochs stay stable across ordinary writes and distinguish navigation/runtime/session changes', () => {
  const epoch = new MemoryScopeEpoch('instance-a'); const before = epoch.key('session-1');
  assert.equal(epoch.key('session-1'), before); epoch.advance(); assert.notEqual(epoch.key('session-1'), before);
  assert.notEqual(epoch.key('session-1'), epoch.key('session-2'));
  assert.notEqual(epoch.key('session-1'), new MemoryScopeEpoch('instance-b').key('session-1'));
  assert.throws(() => new MemoryScopeEpoch(''), /required/);
});

test('native runtime supplies distinct opaque IDs and UTC observation timestamps', () => {
  const runtime = nativeMemoryRuntime(); assert.notEqual(runtime.newId(), runtime.newId());
  const now = runtime.now(); assert.equal(new Date(now).toISOString(), now);
});
