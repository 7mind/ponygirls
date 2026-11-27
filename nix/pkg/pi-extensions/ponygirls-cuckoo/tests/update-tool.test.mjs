import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { registerCuckoo } from '../index.ts';
import { inertNetworkServices } from './fixtures/task-network.mjs';
import { EDIT_TYPE, UPDATE_TOOL, currentSet } from '../src/current.ts';
import { INQUIRY_TYPE, STATE_TYPE } from '../src/state.ts';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = text => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage, api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: 1 });
function fixture(enabled = true) {
  const manager = SessionManager.inMemory(); const tools = new Map(); const handlers = new Map(); const commands = new Map(); const activeTools = new Set(); const notifications = [];
  let defaults = { enabled, policy: { kind: 'relative', value: 15 } }; let tokens = 20000;
  const preferences = { path: 'memory:cuckoo', read: () => ({ ...defaults }), write: value => { defaults = { ...value }; } };
  const pi = { registerTool: tool => { tools.set(tool.name, tool); if (tool.defaultActive !== false) activeTools.add(tool.name); }, getActiveTools: () => [...activeTools],
    setActiveTools(names) { activeTools.clear(); for (const name of names) activeTools.add(name); }, on: (name, fn) => handlers.set(name, fn), registerCommand: (name, command) => commands.set(name, command), registerShortcut() {},
    sendMessage() {}, appendEntry: (type, data) => manager.appendCustomEntry(type, data) };
  const ctx = { cwd: '/fixture', isProjectTrusted: () => false, sessionManager: manager, isIdle: () => true, mode: 'rpc', model: { provider: 'fixture', id: 'fixture' },
    getContextUsage: () => ({ tokens, contextWindow: 200000, percent: tokens / 2000 }), ui: { notify: (...args) => notifications.push(args), setWidget() {} } };
  registerCuckoo(pi, preferences, { path: 'memory:questions', read: () => [], write() { assert.fail('standing questions write not expected'); } }, inertNetworkServices());
  handlers.get('session_start')({}, ctx);
  const call = async params => {
    const result = await tools.get(UPDATE_TOOL).execute('update-call', params, undefined, undefined, ctx);
    assert.deepEqual(JSON.parse(result.content[0].text), result.details, 'the model reads what the details hold');
    return result.details;
  };
  function boundary(message = assistant('ordinary work')) {
    const messageEntryId = manager.appendMessage(message);
    const result = handlers.get('turn_end')({ message, messageEntryId, outcome: 'completed', entries: [], continue: false, context: { pendingMessages: [] } }, ctx);
    if (result?.entries) for (const entry of result.entries) {
      if (entry.type === 'custom') manager.appendCustomEntry(entry.customType, entry.data);
      else if (entry.type === 'custom_message') manager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
    }
    return result;
  }
  const edits = () => manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === EDIT_TYPE);
  return { manager, tools, handlers, ctx, activeTools, notifications, call, boundary, edits, tokens: value => { tokens = value; }, command: value => commands.get('cuckoo').handler(value, ctx) };
}
const brief = set => ({ objectives: set.objectives.map(item => [item.id, item.status]), rules: set.rules.map(item => [item.id, item.status]) });

// Specified Behavioral-Active / Blackbox-Group: the registered tool over a real in-memory session tree.
test('the update tool is declared while automatic mode is on and withdrawn when it is turned off', async () => {
  const on = fixture(true); const tool = on.tools.get(UPDATE_TOOL);
  assert.ok(tool, 'cuckoo_update is registered'); assert.equal(tool.defaultActive, false, 'registration alone does not declare it');
  assert.ok(on.activeTools.has(UPDATE_TOOL)); assert.ok(on.activeTools.has('cuckoo_recall'));
  assert.equal(tool.executionMode, 'sequential');
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  for (const text of [tool.description, ...tool.promptGuidelines]) assert.match(text, /cuckoo_update/);
  await on.command('off');
  assert.equal(on.activeTools.has(UPDATE_TOOL), false); assert.ok(on.activeTools.has('cuckoo_recall'), 'reading stays available');
  await assert.rejects(on.call({ action: 'add_objective', objective: 'While off' }), /automatic mode is off/i);
  assert.equal(on.edits().length, 0);
  await on.command('on'); assert.ok(on.activeTools.has(UPDATE_TOOL));
  const off = fixture(false);
  assert.ok(off.tools.has(UPDATE_TOOL)); assert.equal(off.activeTools.has(UPDATE_TOOL), false);
});

test('additions return the IDs Cuckoo assigned; later calls name entries by them', async () => {
  const f = fixture();
  const first = await f.call({ action: 'add_objective', objective: 'Ship the parser' });
  assert.deepEqual({ id: first.id, kind: first.kind, status: first.status, action: first.action, activeObjectives: first.activeObjectives, activeRules: first.activeRules },
    { id: 'AO1', kind: 'objective', status: 'active', action: 'add_objective', activeObjectives: 1, activeRules: 0 });
  assert.match(first.notice, /not .*approval|authorization/i);
  const second = await f.call({ action: 'add_objective', objective: 'Write the docs', progress: 'Outline exists', issues: ['No reviewer yet'], eta: 'About a day' });
  assert.equal(second.id, 'AO2');
  const rule = await f.call({ action: 'add_rule', rule: 'Show mockups first', source: 'user', scope: 'This UI change' });
  assert.deepEqual([rule.id, rule.kind, rule.activeObjectives, rule.activeRules], ['AR1', 'rule', 2, 1]);
  assert.equal(f.edits().length, 3);
  let set = currentSet(f.manager.getBranch());
  assert.deepEqual([set.objectives[0].objective, set.objectives[0].progress, set.objectives[0].issues, set.objectives[0].eta], ['Ship the parser', null, null, null]);
  assert.deepEqual([set.objectives[1].progress, set.objectives[1].issues, set.objectives[1].eta], ['Outline exists', ['No reviewer yet'], 'About a day']);
  assert.deepEqual([set.rules[0].rule, set.rules[0].source, set.rules[0].scope], ['Show mockups first', 'user', 'This UI change']);

  assert.equal((await f.call({ action: 'update', id: 'AO1', progress: 'Grammar done', eta: 'Two days' })).status, 'active');
  assert.equal((await f.call({ action: 'update', id: 'AR1', scope: 'Every interface change' })).kind, 'rule');
  assert.deepEqual([(await f.call({ action: 'complete', id: 'AO2', progress: 'Docs published', issues: [] })).status, currentSet(f.manager.getBranch()).objectives[1].eta], ['complete', 'Complete']);
  const retired = await f.call({ action: 'retire', id: 'AO1', reason: 'Superseded by a rewrite' });
  assert.deepEqual([retired.status, retired.activeObjectives], ['retired', 0]);
  assert.equal((await f.call({ action: 'retire', id: 'AR1', reason: 'The user dropped it' })).activeRules, 0);
  assert.equal((await f.call({ action: 'reopen', id: 'AO1' })).status, 'active');
  set = currentSet(f.manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'active'], ['AO2', 'complete']], rules: [['AR1', 'retired']] });
  assert.deepEqual([set.objectives[0].progress, set.objectives[0].eta, set.rules[0].scope, set.rules[0].reason], ['Grammar done', 'Two days', 'Every interface change', 'The user dropped it']);
});

test('arguments that do not belong to the action, and edits that do not fit the record, are refused and save nothing', async () => {
  const f = fixture();
  await f.call({ action: 'add_objective', objective: 'Ship the parser' });
  await f.call({ action: 'add_rule', rule: 'Show mockups first', source: 'user', scope: 'This UI change' });
  const saved = f.edits().length;
  const refused = [
    [{ action: 'add_objective' }, /add_objective requires objective/],
    [{ action: 'add_objective', objective: 'With an id', id: 'AO7' }, /Cuckoo assigns the ID|does not accept id/],
    [{ action: 'add_objective', objective: 'With a rule', rule: 'x' }, /does not accept rule/],
    [{ action: 'add_objective', objective: 'Done already', eta: 'Complete' }, /use the complete action/],
    [{ action: 'add_rule', rule: 'No scope', source: 'user' }, /add_rule requires .*scope/],
    [{ action: 'add_rule', rule: 'Bad source', source: 'system', scope: 'x' }, /source must be user or assistant/],
    [{ action: 'add_rule', rule: 'With progress', source: 'user', scope: 'x', progress: 'x' }, /does not accept progress/],
    [{ action: 'update', id: 'AO1' }, /at least one of objective, progress, issues, eta/],
    [{ action: 'update', progress: 'No id' }, /update requires id/],
    [{ action: 'update', id: 'AO1', scope: 'A rule field' }, /AO1 is an objective; update accepts objective, progress, issues, eta/],
    [{ action: 'update', id: 'AR1', progress: 'An objective field' }, /AR1 is a rule; update accepts rule, source, scope/],
    [{ action: 'update', id: 'AO1', progress: 'x', reason: 'x' }, /does not accept reason/],
    [{ action: 'update', id: 'AO9', progress: 'x' }, /AO9 is not in the record/],
    [{ action: 'update', id: 'ao1', progress: 'x' }, /id must be an objective id/],
    [{ action: 'complete', id: 'AO1', progress: 'No issues list' }, /complete requires .*issues/],
    [{ action: 'complete', id: 'AR1', progress: 'x', issues: [] }, /only an objective can be completed/],
    [{ action: 'complete', id: 'AO1', progress: 'x', issues: [], eta: 'Complete' }, /does not accept eta/],
    [{ action: 'retire', id: 'AO1' }, /retire requires .*reason/],
    [{ action: 'reopen', id: 'AO1' }, /AO1 is active/],
    [{ action: 'reopen', id: 'AO1', reason: 'x' }, /does not accept reason/],
    [{ action: 'delete', id: 'AO1' }, /action must be/],
    [{}, /action must be/],
  ];
  for (const [params, expected] of refused) await assert.rejects(f.call(params), expected, JSON.stringify(params));
  assert.equal(f.edits().length, saved, 'a refused call appends nothing');
  assert.deepEqual(brief(currentSet(f.manager.getBranch())), { objectives: [['AO1', 'active']], rules: [['AR1', 'active']] });
});

test('numbers continue after every branch, and the tool edits what a checkpoint numbered', async () => {
  const f = fixture();
  const anchor = f.manager.appendCustomEntry('anchor', {});
  await f.call({ action: 'add_objective', objective: 'On the first branch' });
  // A checkpoint on this branch: one known entry restated, one new objective and one new rule numbered by Cuckoo.
  f.boundary(); f.tokens(23000);
  const issued = f.boundary(); assert.equal(issued.entries.at(-1).customType, INQUIRY_TYPE);
  assert.match(issued.entries.at(-1).content, /The record now, as JSON: \{"objectives":\[\{"id":"AO1","objective":"On the first branch"\}\],"completed":\[\],"rules":\[\]\}$/);
  await assert.rejects(f.call({ action: 'add_objective', objective: 'During the checkpoint' }), /JSON only|checkpoint/i);
  f.boundary(assistant(JSON.stringify({ objectives: [{ id: 'AO1', objective: 'On the first branch', progress: 'Stated', issues: [], eta: 'Unknown' }, { id: null, objective: 'New at the checkpoint', progress: 'Stated', issues: [], eta: 'Unknown' }],
    rules: [{ id: null, rule: 'A rule from the checkpoint', source: 'assistant', scope: 'Here' }] })));
  assert.deepEqual(brief(currentSet(f.manager.getBranch())), { objectives: [['AO1', 'active'], ['AO2', 'active']], rules: [['AR1', 'active']] });
  assert.equal((await f.call({ action: 'complete', id: 'AO2', progress: 'Delivered', issues: ['One caveat'] })).status, 'complete');
  assert.equal((await f.call({ action: 'update', id: 'AR1', scope: 'Everywhere' })).id, 'AR1');
  assert.equal((await f.call({ action: 'add_objective', objective: 'Third here' })).id, 'AO3');
  f.manager.branch(anchor);
  f.handlers.get('session_tree')({}, f.ctx);
  assert.deepEqual(brief(currentSet(f.manager.getBranch())), { objectives: [], rules: [] });
  await assert.rejects(f.call({ action: 'retire', id: 'AO1', reason: 'From the other branch' }), /AO1 is not in the record of this branch/);
  assert.equal((await f.call({ action: 'add_objective', objective: 'On the second branch' })).id, 'AO4');
  assert.equal((await f.call({ action: 'add_rule', rule: 'A rule here', source: 'user', scope: 'Here' })).id, 'AR2');
});

test('a pending checkpoint blocks the tool by its own check, not only through the shared tool gate', async () => {
  const f = fixture();
  f.manager.appendCustomEntry(STATE_TYPE, { version: 1, baseline: 20000, observed: 20000, model: 'fixture:fixture:200000', pending: { requestId: 'pending', resume: false, questions: [] }, resuming: false });
  await assert.rejects(f.call({ action: 'add_objective', objective: 'During the checkpoint' }), /JSON only/);
  assert.equal(f.edits().length, 0);
});

// BG regression guard: scripted model loops bypass provider schema conversion.
test('Anthropic payload carries the update tool with its action enum and flat arguments', async () => {
  const f = fixture(); const tool = f.tools.get(UPDATE_TOOL);
  const model = { id: 'claude-sonnet-4-20250514', name: 'Fixture', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://fixture.invalid', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let payload;
  await streamAnthropic(model, { messages: [{ role: 'system', content: 'Test tool declaration', toolsAdded: [tool], timestamp: 1 }, { role: 'user', content: 'Add an objective', timestamp: 2 }] },
    { apiKey: 'fixture-only', maxRetries: 0, fetch() { throw new Error('Network must not be used'); }, onPayload(value) { payload = value; throw new Error('Intentional stop after payload capture'); } }).result();
  const declared = payload.tools.find(item => item.name === UPDATE_TOOL);
  assert.ok(declared, 'the tool is declared');
  assert.deepEqual(declared.input_schema.properties.action.enum, ['add_objective', 'add_rule', 'update', 'complete', 'retire', 'reopen']);
  assert.deepEqual(declared.input_schema.required, ['action']);
  for (const name of ['id', 'objective', 'progress', 'issues', 'eta', 'rule', 'source', 'scope', 'reason']) assert.ok(name in declared.input_schema.properties, name);
});
