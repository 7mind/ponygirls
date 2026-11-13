import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../index.ts';
import { inertNetworkServices } from './fixtures/task-network.mjs';
import auditMemoryMigrationNotice from '../audit-memory.ts';
import { readMemory } from '../src/memory-core.ts';
import { DEFAULT_FEATURES } from '../src/features.ts';

function fixture(enabled) {
  const manager = SessionManager.inMemory();
  const tools = new Map(); const active = new Set(); const handlers = new Map(); const commands = new Map(); const notices = [];
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); if (tool.defaultActive !== false) active.add(tool.name); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active.clear(); for (const name of names) active.add(name); },
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    registerShortcut() {}, sendMessage() {},
    appendEntry(type, data) { manager.appendCustomEntry(type, data); },
  };
  let saved = { enabled, policy: { kind: 'window', value: 15 }, features: { ...DEFAULT_FEATURES, evidence: true, corrections: true, verifiers: true, reader: true } };
  const preferences = { path: 'memory:fixture', read: () => structuredClone(saved), write(value) { saved = structuredClone(value); } };
  const ctx = { cwd: '/fixture', isProjectTrusted: () => false, sessionManager: manager, isIdle: () => true, mode: 'rpc', model: { provider: 'fixture', id: 'fixture' }, getContextUsage: () => ({ tokens: 20000, contextWindow: 200000, percent: 10 }), ui: { notify: (...args) => notices.push(args), setWidget() {} } };
  registerCuckoo(pi, preferences, inertNetworkServices());
  handlers.get('session_start')({}, ctx);
  const memory = tools.get('cuckoo_memory');
  assert.ok(memory, 'normal extension registers the gated memory tool');
  let calls = 0;
  const call = async input => (await memory.execute(`call-${++calls}`, input, undefined, undefined, ctx)).details;
  const view = () => ({ sessionId: manager.getSessionId(), entries: manager.getEntries(), branch: manager.getBranch() });
  const command = value => commands.get('cuckoo').handler(value, ctx);
  async function seed() {
    manager.appendMessage({ role: 'user', content: 'Synthetic task', timestamp: 1 });
    const task = await call({ action: 'task', label: 'Task' });
    const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '{}' }], timestamp: 2 });
    const artifact = await call({ action: 'snapshot', taskId: task.record.id, purpose: 'artifact', label: 'Artifact', selector: { entryId, part: 0, start: 0, end: 2 }, dependsOn: [] });
    return { action: 'check', taskId: task.record.id, artifactId: artifact.record.id, checkerId: 'json-syntax', evidenceIds: [] };
  }
  return { manager, tools, active, handlers, commands, ctx, call, view, seed, command, notices };
}

// Specified Behavioral-Active / Blackbox-Group: real native tree and real checker worker.
test('master off hides memory and denies direct execution without affecting passive recall', async () => {
  const f = fixture(false);
  assert.deepEqual([...f.active], ['cuckoo_recall']);
  await assert.rejects(f.call({ action: 'metadata' }), /disabled/);
  assert.equal(readMemory(f.view(), 'branch').length, 0);
  await f.command('on'); assert.ok(f.active.has('cuckoo_memory'));
  await f.command('off'); assert.equal(f.active.has('cuckoo_memory'), false);
  assert.ok(f.active.has('cuckoo_recall'));
});

test('feature switches gate every local action family independently', async () => {
  const f = fixture(true); const request = await f.seed();
  await f.command('feature reader off');
  await assert.rejects(f.call({ action: 'inspect', id: request.artifactId }), /disabled/);
  assert.equal((await f.call({ action: 'list-sources' })).kind, 'list-sources');
  await f.command('feature verifiers off');
  await assert.rejects(f.call(request), /disabled/);
  await assert.rejects(f.call({ action: 'checkers' }), /disabled/);
  await f.command('feature evidence off');
  await assert.rejects(f.call({ action: 'task', label: 'Not allowed' }), /disabled/);
  await f.command('feature reader on');
  assert.ok(f.active.has('cuckoo_memory'));
  assert.equal((await f.call({ action: 'inspect', id: request.artifactId })).recordKind, 'snapshot');
  await assert.rejects(f.call(request), /disabled/);
});

test('disabling correction creation preserves the status of already corrected artifacts', async () => {
  const f = fixture(true); const request = await f.seed();
  const user = f.manager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'user');
  const evidence = await f.call({ action: 'snapshot', taskId: request.taskId, purpose: 'evidence', label: 'Synthetic evidence', selector: { entryId: user.id, part: 0, start: 0, end: user.message.content.length }, dependsOn: [] });
  await f.call({ action: 'correct', taskId: request.taskId, targetIds: [request.artifactId], replacementIds: [], evidenceIds: [evidence.record.id], reason: 'Withdraw the synthetic artifact.' });
  await f.command('feature corrections off');
  assert.equal((await f.call({ action: 'inspect', id: request.artifactId })).status, 'superseded');
  await assert.rejects(f.call({ action: 'correct', taskId: request.taskId, targetIds: [request.artifactId], replacementIds: [], evidenceIds: [evidence.record.id], reason: 'No new correction allowed.' }), /disabled/);
});

test('ordinary native appends keep the check scope stable', { timeout: 10000 }, async () => {
  const f = fixture(true); const request = await f.seed();
  const pending = f.call(request);
  f.manager.appendCustomEntry('unrelated-observer', { observed: true });
  const result = await pending;
  assert.equal(result.status, 'recorded'); assert.equal(result.outcome, 'pass');
  assert.equal(readMemory(f.view(), 'branch').filter(item => item.record.kind === 'check-result').length, 1);
});

for (const event of ['session_start', 'session_tree', 'session_shutdown']) {
  test(`${event} fences an existing check even when the native prefix remains`, { timeout: 10000 }, async () => {
    const f = fixture(true); const request = await f.seed();
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

test('disabling then re-enabling cannot publish a check from the former configuration', { timeout: 10000 }, async () => {
  const f = fixture(true); const request = await f.seed();
  const pending = f.call(request);
  await f.command('feature verifiers off'); await f.command('feature verifiers on');
  const result = await pending;
  assert.equal(result.status, 'scope-changed'); assert.equal(result.terminal, null);
  assert.equal(readMemory(f.view(), 'branch').filter(item => item.record.kind === 'check-result').length, 0);
});

test('refresh preserves independent tool choices and does not resurrect an explicitly deselected memory tool', async () => {
  const f = fixture(true); f.active.add('unrelated_tool'); f.active.delete('cuckoo_memory');
  f.handlers.get('turn_start')({}, f.ctx);
  assert.equal(f.active.has('cuckoo_memory'), false); assert.equal(f.active.has('unrelated_tool'), true);
  await f.command('off'); await f.command('on');
  assert.equal(f.active.has('cuckoo_memory'), true); assert.equal(f.active.has('unrelated_tool'), true);
});

test('legacy audit entry only reports migration and cannot bypass feature controls', () => {
  const handlers = []; const notices = []; let tools = 0;
  auditMemoryMigrationNotice({ registerTool() { tools++; }, on(_name, callback) { handlers.push(callback); } });
  for (const handler of handlers) handler({}, { ui: { notify: message => notices.push(message) } });
  assert.equal(tools, 0); assert.match(notices[0], /settings.*enables no tools/);
});

test('the actual checkpoint state blocks memory execution as well as the generic tool hook', async () => {
  const f = fixture(true);
  await f.command('inquire now');
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
