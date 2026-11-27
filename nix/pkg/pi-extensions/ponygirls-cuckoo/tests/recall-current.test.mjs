import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../index.ts';
import { inertNetworkServices } from './fixtures/task-network.mjs';
import { EDIT_TYPE, MAX_CLOSED_SHOWN, currentSet, editRecord, knownIds, nextNumbers } from '../src/current.ts';
import { REPORT_TYPE, capturedCheckpoint } from '../src/report.ts';

function fixture() {
  const manager = SessionManager.inMemory(); const tools = new Map(); const handlers = new Map(); const activeTools = new Set();
  const preferences = { path: 'memory:cuckoo', read: () => ({ enabled: false, policy: { kind: 'window', value: 15 } }), write() { assert.fail('recall must not write preferences'); } };
  const pi = { registerTool: tool => { tools.set(tool.name, tool); if (tool.defaultActive !== false) activeTools.add(tool.name); }, getActiveTools: () => [...activeTools], setActiveTools(names) { activeTools.clear(); for (const name of names) activeTools.add(name); },
    on: (name, fn) => handlers.set(name, fn), registerCommand() {}, registerShortcut() {}, sendMessage() { assert.fail('recall must not request inference'); }, appendEntry() { assert.fail('recall must not append entries'); } };
  const ctx = { cwd: '/fixture', isProjectTrusted: () => false, sessionManager: manager, ui: { notify() {}, setWidget() {} } };
  registerCuckoo(pi, preferences, { path: 'memory:questions', read: () => [], write() { assert.fail('standing questions write not expected'); } }, inertNetworkServices());
  handlers.get('session_start')({}, ctx);
  const call = async params => {
    const result = await tools.get('cuckoo_recall').execute('recall-call', params, undefined, undefined, ctx);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details);
    assert.ok(Buffer.byteLength(result.content[0].text) <= 50000, 'bounded model response');
    assert.equal(result.details.sessionId, manager.getSessionId());
    return result.details;
  };
  const edit = value => manager.appendCustomEntry(EDIT_TYPE, editRecord(value));
  const checkpoint = (requestId, reply) => {
    const value = capturedCheckpoint(requestId, JSON.stringify(reply), [], knownIds(currentSet(manager.getBranch())), nextNumbers(manager.getEntries()));
    assert.equal(value.error, null, String(value.error));
    return manager.appendCustomEntry(REPORT_TYPE, { ...value, messageEntryId: 'm', content: [] });
  };
  return { manager, tools, call, edit, checkpoint };
}
async function readCurrent(f, limit = 211) {
  let text = ''; let offset = 0; let first = null;
  do {
    const page = await f.call({ action: 'current', offset, limit });
    first ??= page;
    assert.equal(page.offset, offset); assert.equal(page.format, 'json'); assert.equal(page.scope, 'branch');
    text += page.text; offset = page.nextOffset;
    if (offset === null) assert.equal(text.length, page.totalChars);
  } while (offset !== null);
  return { summary: first, document: JSON.parse(text) };
}
const objective = (id, title, eta = 'Unknown') => ({ id, objective: title, progress: `${title}: stated`, issues: [`${title}: a risk`], eta });

// Specified Behavioral-Active / Blackbox-Group: public tool over a real in-memory session tree.
test('current returns the record of this branch: active entries in full, closed ones with how they were closed', async () => {
  const f = fixture();
  const empty = await readCurrent(f);
  assert.deepEqual(empty.document, { objectives: [], rules: [], closed: [], olderClosed: 0 });
  assert.deepEqual([empty.summary.activeObjectives, empty.summary.activeRules, empty.summary.closed], [0, 0, 0]);
  assert.match(empty.summary.notice, /own account/); assert.match(empty.summary.notice, /authorization/);

  f.checkpoint('r1', { objectives: [objective(null, 'Parser'), objective(null, 'Docs'), objective(null, 'Cache')], rules: [{ id: null, rule: 'Mockups first', source: 'user', scope: 'This UI change' }, { id: null, rule: 'British spelling', source: 'assistant', scope: 'Notes' }] });
  f.edit({ action: 'add_objective', id: 'AO4', objective: 'Release', progress: null, issues: null, eta: null });
  f.edit({ action: 'complete', id: 'AO2', progress: 'Docs published', issues: ['No index yet'] });
  f.edit({ action: 'retire', id: 'AO3', reason: 'Cancelled by the user' });
  const second = f.checkpoint('r2', { objectives: [objective('AO1', 'Parser'), objective('AO4', 'Release')], rules: [{ id: 'AR1', rule: 'Mockups first', source: 'user', scope: 'This UI change' }] });
  const edited = f.edit({ action: 'update', id: 'AO4', fields: { progress: 'Tagged' } });
  const { summary, document } = await readCurrent(f);
  assert.deepEqual([summary.activeObjectives, summary.activeRules, summary.closed], [2, 1, 3]);
  const stamp = id => f.manager.getEntry(id).timestamp;
  assert.deepEqual(document.objectives, [
    { id: 'AO1', objective: 'Parser', progress: 'Parser: stated', issues: ['Parser: a risk'], eta: 'Unknown', stated: { via: 'checkpoint', checkpoint: 2, entryId: second, timestamp: stamp(second) } },
    { id: 'AO4', objective: 'Release', progress: 'Tagged', issues: ['Release: a risk'], eta: 'Unknown', stated: { via: 'tool', timestamp: stamp(edited) } },
  ]);
  assert.deepEqual(document.rules, [{ id: 'AR1', rule: 'Mockups first', source: 'user', scope: 'This UI change', stated: { via: 'checkpoint', checkpoint: 2, entryId: second, timestamp: stamp(second) } }]);
  assert.deepEqual(document.closed.map(item => [item.id, item.kind, item.status, item.reason, item.stated.via]), [
    ['AR2', 'rule', 'retired', null, 'checkpoint'], ['AO3', 'objective', 'retired', 'Cancelled by the user', 'tool'], ['AO2', 'objective', 'complete', null, 'tool']], 'newest first');
  assert.deepEqual([document.closed[2].objective, document.closed[2].progress, document.closed[2].issues, document.closed[2].eta], ['Docs', 'Docs published', ['No index yet'], 'Complete']);
  assert.deepEqual([document.closed[0].rule, document.closed[0].source, document.closed[0].scope], ['British spelling', 'assistant', 'Notes']);
  assert.equal(document.closed[0].stated.entryId, second, 'the checkpoint that left the rule out');
  assert.equal(document.olderClosed, 0);
  // The docs were completed by the tool and nothing was said about them since; the cache was retired by the tool before the checkpoint.
  assert.deepEqual(document.closed.map(item => [item.id, item.closed.via, item.closed.timestamp === item.stated.timestamp]), [['AR2', 'checkpoint', true], ['AO3', 'tool', true], ['AO2', 'tool', true]]);
  assert.equal(document.closed[0].closed.checkpoint, 2); assert.equal(document.closed[0].closed.entryId, second);
  // The round that stated an entry is readable by the entry ID the record names.
  const round = await f.call({ action: 'read', entryId: second });
  assert.equal(round.round.entryId, second);
});

test('current follows the branch, bounds its closed entries and rejects arguments of the other actions', async () => {
  const f = fixture();
  const anchor = f.manager.appendCustomEntry('anchor', {});
  for (let index = 1; index <= MAX_CLOSED_SHOWN + 3; index++) {
    f.edit({ action: 'add_rule', id: `AR${index}`, rule: `Rule ${index}`, source: 'assistant', scope: 'x' });
    f.edit({ action: 'retire', id: `AR${index}`, reason: `Reason ${index}` });
  }
  const { summary, document } = await readCurrent(f, 8000);
  assert.equal(summary.closed, MAX_CLOSED_SHOWN + 3); assert.equal(document.closed.length, MAX_CLOSED_SHOWN); assert.equal(document.olderClosed, 3);
  assert.equal(document.closed[0].id, `AR${MAX_CLOSED_SHOWN + 3}`, 'the most recently closed entry comes first');
  f.manager.branch(anchor);
  assert.deepEqual((await readCurrent(f)).document, { objectives: [], rules: [], closed: [], olderClosed: 0 }, 'another branch has its own record');
  await assert.rejects(f.call({ action: 'current', scope: 'session' }), /current.*branch/i);
  await assert.rejects(f.call({ action: 'current', entryId: 'x' }), /does not accept entryId/);
  await assert.rejects(f.call({ action: 'current', before: 'x' }), /does not accept .*before/);
  await assert.rejects(f.call({ action: 'current', offset: 99999 }), /offset must be an integer from 0 to/);
  await assert.rejects(f.call({ action: 'current', limit: 0 }), /limit must be an integer from 1 to 8000/);
  assert.match(f.tools.get('cuckoo_recall').description, /current/);
});
