import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../index.ts';
import { checkpoints } from '../src/report.ts';
import { STATE_TYPE, INQUIRY_TYPE, RESUME_TYPE, stateOnBranch } from '../src/state.ts';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text, stopReason = 'stop') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason, usage, api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: 1 });
function fixture() {
  const manager = SessionManager.inMemory(); const handlers = new Map(); const commands = new Map(); const shortcuts = new Map(); const notifications = []; const widgets = [];
  let defaults = { enabled: false, policy: { kind: 'relative', value: 15 } }; let tokens = 20000;
  const preferences = { path: 'memory:cuckoo', read: () => ({ ...defaults }), write: value => { defaults = { ...value }; } };
  const pi = { on: (name, fn) => handlers.set(name, fn), registerCommand: (name, command) => commands.set(name, command), registerShortcut: (key, value) => shortcuts.set(key, value), appendEntry: (type, data) => manager.appendCustomEntry(type, data) };
  const ctx = { sessionManager: manager, mode: 'rpc', model: { provider: 'fixture', id: 'fixture' }, getContextUsage: () => tokens === null ? { tokens: null, contextWindow: 200000, percent: null } : { tokens, contextWindow: 200000, percent: tokens / 2000 }, ui: { notify: (...args) => notifications.push(args), setWidget: (...args) => widgets.push(args) } };
  registerCuckoo(pi, preferences); handlers.get('session_start')({}, ctx);
  function boundary(message = assistant('ordinary work'), overrides = {}) {
    const messageEntryId = manager.appendMessage(message);
    const event = { message, messageEntryId, outcome: 'completed', entries: [], continue: false, context: { pendingMessages: [] }, ...overrides };
    const result = handlers.get('turn_end')(event, ctx);
    if (result?.entries) for (const entry of result.entries) {
      if (entry.type === 'custom') manager.appendCustomEntry(entry.customType, entry.data);
      else if (entry.type === 'custom_message') manager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
    }
    return result;
  }
  return { manager, ctx, handlers, shortcuts, notifications, widgets, preferences, boundary, completions: prefix => commands.get('cuckoo').getArgumentCompletions(prefix), tokens: value => { tokens = value; }, command: value => commands.get('cuckoo').handler(value, ctx) };
}

// Specified Behavioral-Active / Blackbox-Group through public extension events and real session projection.
test('default-off is inert; 20k to exactly 23k triggers JSON checkpoint at 15% and no extra inquiry', async () => {
  const f = fixture(); assert.equal(f.boundary(), undefined);
  await f.command('on'); f.boundary();
  f.tokens(22999); assert.equal(f.boundary().continue, undefined);
  f.tokens(23000); const issue = f.boundary();
  assert.equal(issue.continue, true); assert.equal(issue.entries.at(-1).customType, INQUIRY_TYPE);
  assert.equal(stateOnBranch(f.manager.getBranch()).baseline, 23000);
  const reply = f.boundary(assistant('{"objectives":[{"objective":"Ship Cuckoo","progress":"Testing"}]}'));
  assert.equal(reply.continue, undefined); assert.equal(checkpoints(f.manager.getBranch())[0].report.objectives.length, 1);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  assert.ok(!reply.entries.some(entry => entry.customType === INQUIRY_TYPE));
});

test('unfinished tool turn resumes once; checkpoint tools blocked and malformed response preserved without retries', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000); f.boundary(assistant('tool completed', 'toolUse'));
  assert.equal(f.handlers.get('tool_call')({}, f.ctx).block, true);
  const reply = f.boundary(assistant('not JSON'));
  assert.equal(reply.continue, true); assert.equal(reply.entries.at(-1).customType, RESUME_TYPE);
  const saved = checkpoints(f.manager.getBranch())[0]; assert.equal(saved.raw, 'not JSON'); assert.equal(saved.report, null);
  assert.equal(f.handlers.get('tool_call')({}, f.ctx), undefined);
  f.tokens(90000); const resume = f.boundary();
  assert.equal(resume.continue, undefined); assert.ok(!resume.entries.some(entry => entry.customType === INQUIRY_TYPE));
});

test('JSON accompanying tool calls is invalid and retains original response identity/content', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000); f.boundary();
  const message = assistant('{"objectives":[]}', 'toolUse'); message.content.push({ type: 'toolCall', id: 'forbidden', name: 'bash', arguments: { command: 'exit 0' } });
  f.boundary(message);
  const saved = f.manager.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'cuckoo.report');
  assert.ok(saved.data.messageEntryId); assert.equal(saved.data.content.length, 2);
  assert.equal(checkpoints(f.manager.getBranch())[0].report, null);
});

test('length-truncated source tool turn resumes, and forbidden checkpoint tool turns get a bounded normal-task follow-up', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000);
  const source = assistant('truncated', 'length'); source.content.push({ type: 'toolCall', id: 'source', name: 'bash', arguments: {} });
  f.boundary(source);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending.resume, true);
  const valid = f.boundary(assistant('{"objectives":[]}')); assert.equal(valid.continue, true);
  f.boundary(); f.tokens(30000); f.boundary();
  const invalid = assistant('{"objectives":[]}', 'toolUse'); invalid.content.push({ type: 'toolCall', id: 'blocked', name: 'bash', arguments: {} });
  const captured = f.boundary(invalid);
  assert.equal(captured.entries.at(-1).customType, RESUME_TYPE);
  assert.equal(captured.continue, true);
});

test('unknown usage and foreign context edits defer; decreases and model changes rebaseline', async () => {
  const f = fixture(); await f.command('on'); f.boundary();
  f.tokens(null); assert.equal(f.boundary(), undefined);
  f.tokens(25000); assert.equal(f.boundary(undefined, { entries: [{ type: 'compaction' }] }), undefined);
  f.tokens(21000); f.boundary(); f.tokens(20500); f.boundary();
  assert.equal(stateOnBranch(f.manager.getBranch()).baseline, 20500);
  f.ctx.model.id = 'new-model'; f.tokens(50000); f.boundary();
  assert.equal(stateOnBranch(f.manager.getBranch()).baseline, 50000);
  assert.equal(f.manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === INQUIRY_TYPE).length, 0);
});

test('abort and reload cancel pending inquiry, never capture the next user answer', async () => {
  for (const action of ['abort', 'reload', 'user', 'tree']) {
    const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000); f.boundary();
    if (action === 'abort') f.handlers.get('agent_settled')({ aborted: true }, f.ctx);
    if (action === 'reload') f.handlers.get('session_start')({}, f.ctx);
    if (action === 'user') f.handlers.get('before_agent_start')({ messageType: 'user' }, f.ctx);
    if (action === 'tree') f.handlers.get('session_tree')({}, f.ctx);
    assert.equal(stateOnBranch(f.manager.getBranch()).pending, null, action);
    f.tokens(23000); f.boundary(assistant('ordinary answer'));
    assert.equal(checkpoints(f.manager.getBranch()).length, 1, action);
    assert.notEqual(checkpoints(f.manager.getBranch())[0].raw, 'ordinary answer', action);
  }
});

test('aborted report retains partial output without continuation; aborted normal turn never issues', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000);
  assert.equal(f.boundary(undefined, { outcome: 'aborted' }), undefined);
  f.boundary(assistant('unfinished', 'toolUse'));
  const result = f.boundary(assistant('{"objectives":['), { outcome: 'aborted' });
  assert.equal(result.continue, undefined); assert.equal(checkpoints(f.manager.getBranch())[0].raw, '{"objectives":[');
});

test('prior drafts/continuation survive and queued user messages defer inquiries', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000);
  assert.equal(f.boundary(undefined, { context: { pendingMessages: [{}] } }), undefined);
  const prior = { type: 'custom', customType: 'foreign', data: { preserved: true } };
  const result = f.boundary(undefined, { entries: [prior], continue: true });
  assert.deepEqual(result.entries[0], prior); assert.equal(result.continue, true);
  const capture = f.boundary(assistant('{"objectives":[]}'));
  assert.equal(capture.continue, true, 'earlier continuation intent is resumed after checkpoint');
});

test('delivered steering cancels checkpoint before tools and neutralizes the stale inquiry in provider context', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000); f.boundary();
  const inquiry = f.manager.buildSessionProjection().messages.findLast(message => message.role === 'custom' && message.customType === INQUIRY_TYPE);
  f.handlers.get('message_start')?.({ message: { role: 'user', content: 'New instruction', timestamp: 2 } }, f.ctx);
  assert.equal(f.handlers.get('tool_call')({}, f.ctx), undefined, 'new user turn must not be tool-blocked as a checkpoint');
  const context = f.handlers.get('context')?.({ messages: [inquiry] }, f.ctx);
  assert.ok(context, 'cancelled inquiry must be neutralized before provider dispatch');
  assert.doesNotMatch(context.messages[0].content, /JSON only/);
  assert.match(context.messages[0].content, /cancelled/i);
});

test('configuration notifications do not render model-supplied terminal control bytes', async () => {
  const f = fixture(); await f.command('on'); f.boundary(); f.tokens(23000); f.boundary();
  f.boundary(assistant('\x1b]52;c;p\x07'));
  await f.command('off');
  for (const [message] of f.notifications) assert.doesNotMatch(message, /[\x1b\x07]/);
});

test('history shows persisted session answers across branches without changing active state or requesting inference', async () => {
  const f = fixture();
  await f.command('history');
  assert.match(f.notifications.at(-1)[0], /No Cuckoo answers in this session yet/);
  const root = f.manager.appendMessage(assistant('Work before branching'));
  f.manager.appendCustomEntry('cuckoo.report', { version: 1, requestId: 'old-branch', raw: '{"objectives":[{"objective":"Earlier objective","progress":"Earlier answer"}]}', error: null });
  f.manager.branch(root);
  f.manager.appendCustomEntry('cuckoo.report', { version: 1, requestId: 'active-branch', raw: 'partial answer', error: 'Interrupted' });
  const before = f.manager.getEntries();
  await f.command('history');
  const text = f.notifications.at(-1)[0];
  assert.match(text, /Earlier answer/); assert.match(text, /partial answer/); assert.match(text, /Interrupted/);
  assert.match(text, /other branch/); assert.match(text, /current branch/);
  assert.ok(text.indexOf('active-branch') < text.indexOf('old-branch'), 'newest answer first');
  assert.deepEqual(f.manager.getEntries(), before);
  assert.ok(f.completions('hist').some(value => value.value === 'history'));
  await f.command('reports'); assert.doesNotMatch(f.notifications.at(-1)[0], /Earlier answer/);
});

test('commands independently layer thresholds and enablement, reject invalid syntax, and shortcut views reports', async () => {
  const f = fixture(); await f.command('default on'); await f.command('off'); await f.command('threshold 5');
  assert.deepEqual(f.preferences.read(), { enabled: true, policy: { kind: 'relative', value: 15 } });
  await f.command('default threshold 20'); await f.command('threshold inherit');
  await f.command('status'); assert.match(f.notifications.at(-1)[0], /OFF \(session\).*\nGrowth policy: 20% relative token growth \(global\)/);
  for (const command of ['on extra', 'threshold 0', 'threshold NaN', 'default threshold inherit']) { await f.command(command); assert.equal(f.notifications.at(-1)[1], 'error'); }
  await f.shortcuts.get('ctrl+alt+c').handler(f.ctx); assert.match(f.notifications.at(-1)[0], /No Cuckoo reports/);
});

test('policy commands configure units atomically, inherit independently, expose completions and show exact next token threshold', async () => {
  const f = fixture(); await f.command('on'); f.boundary();
  for (const [command, threshold, description] of [['policy relative 15', 23000, /15% relative token growth/], ['policy window 15', 50000, /15% of context-window capacity/], ['policy tokens 10000', 30000, /10000 additional tokens/]]) {
    await f.command(command); await f.command('status');
    const status = f.notifications.at(-1)[0]; assert.match(status, description); assert.match(status, new RegExp(`next inquiry: ${threshold} tokens`));
    assert.deepEqual(f.preferences.read(), { enabled: false, policy: { kind: 'relative', value: 15 } }, 'session policy does not write global defaults');
  }
  await f.command('default policy window 20'); await f.command('status');
  assert.match(f.notifications.at(-1)[0], /10000 additional tokens \(session\)/);
  await f.command('policy inherit'); await f.command('status');
  assert.match(f.notifications.at(-1)[0], /20% of context-window capacity.*\(global\).*next inquiry: 60000 tokens/);
  assert.match(f.notifications.at(-1)[0], /ON \(session\)/);
  assert.ok(f.completions('policy ').some(value => value.value === 'policy tokens 10000'));
  assert.ok(f.completions('default policy w').some(value => value.value === 'default policy window 15'));
  const entries = f.manager.getEntries().length; const defaults = structuredClone(f.preferences.read());
  for (const command of ['policy', 'policy unknown 15', 'policy tokens 0', 'policy tokens 1.5', 'policy window 101', 'policy relative NaN', 'default policy inherit', 'policy tokens 10 extra', 'policy window 0x10', 'policy window -1']) {
    await f.command(command); assert.equal(f.notifications.at(-1)[1], 'error', command);
    assert.equal(f.manager.getEntries().length, entries, command); assert.deepEqual(f.preferences.read(), defaults, command);
  }
});

for (const [kind, value, threshold] of [['window', 15, 50000], ['tokens', 10000, 30000]]) {
  test(`${kind} command drives actual scheduling rather than just status text`, async () => {
    const f = fixture(); await f.command('on'); await f.command(`policy ${kind} ${value}`); f.boundary();
    f.tokens(threshold - 1); assert.equal(f.boundary().continue, undefined);
    f.tokens(threshold); assert.equal(f.boundary().continue, true);
  });
}
