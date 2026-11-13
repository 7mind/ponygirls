import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../index.ts';
import { registerAuditMemory } from '../audit-memory.ts';
import { readMemory } from '../src/memory-core.ts';

function fixture() {
  const manager = SessionManager.inMemory();
  const tools = new Map(); const handlers = new Map(); const commands = new Map();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) {
      const previous = handlers.get(name);
      handlers.set(name, (event, ctx) => {
        const before = previous === undefined ? undefined : previous(event, ctx);
        const after = handler(event, ctx);
        return after === undefined ? before : after;
      });
    },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut() {}, sendMessage() {},
    appendEntry(type, data) { manager.appendCustomEntry(type, data); },
  };
  const preferences = { path: 'memory:fixture', read: () => ({ enabled: false, policy: { kind: 'window', value: 15 } }), write() { assert.fail('No preference mutation expected'); } };
  const ctx = { sessionManager: manager, isIdle: () => true, mode: 'rpc', model: { provider: 'fixture', id: 'fixture' }, getContextUsage: () => ({ tokens: 20000, contextWindow: 200000, percent: 10 }), ui: { notify() {}, setWidget() {} } };
  registerCuckoo(pi, preferences);
  const defaultToolNames = [...tools.keys()];
  registerAuditMemory(pi);
  handlers.get('session_start')({}, ctx);
  const memory = tools.get('cuckoo_memory');
  assert.ok(memory, 'memory tool must be registered by the extension');
  let calls = 0;
  const call = async input => (await memory.execute(`call-${++calls}`, input, undefined, undefined, ctx)).details;
  const view = () => ({ sessionId: manager.getSessionId(), entries: manager.getEntries(), branch: manager.getBranch() });
  async function seed() {
    manager.appendMessage({ role: 'user', content: 'Synthetic task', timestamp: 1 });
    const task = await call({ action: 'task', label: 'Task' });
    const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '{}' }], timestamp: 2 });
    const artifact = await call({ action: 'snapshot', taskId: task.record.id, purpose: 'artifact', label: 'Artifact', selector: { entryId, part: 0, start: 0, end: 2 }, dependsOn: [] });
    return { action: 'check', taskId: task.record.id, artifactId: artifact.record.id, checkerId: 'json-syntax', evidenceIds: [] };
  }
  return { manager, tools, handlers, commands, ctx, call, view, seed, defaultToolNames };
}

// Specified Behavioral-Active / Blackbox-Group: real native tree and real checker worker.
test('only explicit audit entry registers memory; default recall and deferred isolation remain', () => {
  const f = fixture();
  assert.deepEqual(f.defaultToolNames, ['cuckoo_recall']);
  assert.deepEqual([...f.tools.keys()].sort(), ['cuckoo_memory', 'cuckoo_recall']);
  assert.equal(f.tools.get('cuckoo_recall').annotations.readOnlyHint, true);
  assert.equal(readMemory(f.view(), 'branch').length, 0);
});

test('ordinary native appends keep the check scope stable', { timeout: 10000 }, async () => {
  const f = fixture(); const request = await f.seed();
  const pending = f.call(request);
  f.manager.appendCustomEntry('unrelated-observer', { observed: true });
  const result = await pending;
  assert.equal(result.status, 'recorded'); assert.equal(result.outcome, 'pass');
  assert.equal(readMemory(f.view(), 'branch').filter(item => item.record.kind === 'check-result').length, 1);
});

for (const event of ['session_start', 'session_tree', 'session_shutdown']) {
  test(`${event} fences an existing check even when the native prefix remains`, { timeout: 10000 }, async () => {
    const f = fixture(); const request = await f.seed();
    const pending = f.call(request);
    const start = readMemory(f.view(), 'branch').findLast(item => item.record.kind === 'check-start');
    assert.ok(start);
    if (event === 'session_tree') f.manager.branch(start.entryId);
    f.handlers.get(event)({}, f.ctx);
    const result = await pending;
    assert.equal(result.status, 'scope-changed'); assert.equal(result.lifecycle, 'unresolved');
    assert.equal(result.terminal, null); assert.equal(result.outcome, null);
    const records = readMemory(f.view(), 'branch');
    assert.equal(records.filter(item => item.record.kind === 'check-start').length, 1);
    assert.equal(records.filter(item => item.record.kind === 'check-result').length, 0);
  });
}

test('the actual checkpoint state blocks memory execution as well as the generic tool hook', async () => {
  const f = fixture();
  await f.commands.get('cuckoo').handler('inquire now', f.ctx);
  const before = f.manager.getEntries().length;
  assert.equal(f.handlers.get('tool_call')({ toolName: 'cuckoo_memory' }, f.ctx).block, true);
  await assert.rejects(f.call({ action: 'metadata' }), error => {
    const details = JSON.parse(error.message);
    assert.match(details.message, /JSON only/); assert.equal(details.appendMayHaveCommitted, false);
    return true;
  });
  assert.equal(f.manager.getEntries().length, before);
  assert.equal(readMemory(f.view(), 'branch').length, 0);
});
