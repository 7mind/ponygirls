import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, SessionManager } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../index.ts';
import { inertNetworkServices } from './fixtures/task-network.mjs';
import { checkpoints, historyText } from '../src/report.ts';
import { COMMENT_RESPONSE, COMMENT_RESPONSE_TYPE, COMMENT_TYPE, COMMENTS_TYPE, savedComments, undeliveredComments } from '../src/comments.ts';
import { INQUIRY, INQUIRY_TYPE, RESUME_TYPE, STATE_TYPE, stateOnBranch } from '../src/state.ts';

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text, stopReason = 'stop') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason, usage, api: 'openai-completions', provider: 'fixture', model: 'fixture', timestamp: 1 });
const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
const tick = () => new Promise(setImmediate);
// Replies name new entries with a null id; the first checkpoint of a session numbers them AO1 and AR1.
const objective = { id: null, objective: 'Ship Cuckoo', progress: 'Testing', issues: ['Serial validation'], eta: 'Unknown: tests pending' };
const rules = [{ id: null, rule: 'Show mockups first', source: 'user', scope: 'This UI change' }];
const plainReport = JSON.stringify({ objectives: [objective], rules });
const TAB = '\t', ENTER = '\r', ESCAPE = '\x1b', DOWN = '\x1b[B';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'cuckoo-feedback-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const manager = SessionManager.inMemory(); const handlers = new Map(); const commands = new Map(); const notifications = []; const views = []; const sent = []; const woken = [];
  let tokens = 20000; let idle = true; let trusted = false; let questions = []; let questionFault = null; const inputs = []; const selections = [];
  const preferences = { path: 'memory:cuckoo', read: () => ({ enabled: false, policy: { kind: 'relative', value: 15 } }), write() { assert.fail('preference write not expected'); } };
  const questionStore = { path: 'memory:questions', read: () => { if (questionFault !== null) throw questionFault; return questions; }, write: value => { questions = [...value]; } };
  const pi = {
    registerTool() {}, getActiveTools: () => [], setActiveTools() {}, registerShortcut() {},
    on: (name, fn) => handlers.set(name, fn), registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (type, data) => manager.appendCustomEntry(type, structuredClone(data)),
    // Like Pi: an idle session appends a message sent without triggerTurn at once; a triggered one starts a run.
    sendMessage(message, options) {
      sent.push({ message, options });
      if (message.customType === COMMENTS_TYPE) {
        assert.equal(idle, true, 'comments are never queued into a running agent');
        assert.deepEqual(options, { triggerTurn: false });
      }
      if (options.triggerTurn === false) manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    },
    // Like Pi's retained ingress on an idle session: the message is committed at once and the turn starts afterwards.
    enqueueMessage(message, options) {
      assert.equal(idle, true, 'a wake is requested only from an idle session');
      woken.push({ message, options });
      manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    },
  };
  const ctx = { cwd, isProjectTrusted: () => trusted, sessionManager: manager, isIdle: () => idle, mode: 'tui', hasUI: true, model: { provider: 'fixture', id: 'fixture' },
    getContextUsage: () => ({ tokens, contextWindow: 200000, percent: tokens / 2000 }),
    ui: { notify: (...args) => notifications.push(args), setWidget() {},
      input: async () => inputs.shift(), select: async (_title, options) => { const pick = selections.shift(); return pick === undefined ? undefined : options.find(option => option.includes(pick)); },
      custom: factory => new Promise(resolve => {
        const view = { closed: false }; views.push(view);
        view.component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, { matches: (key, action) => key === ESCAPE && action === 'tui.select.cancel' }, () => { view.closed = true; resolve(); });
      }) } };
  registerCuckoo(pi, preferences, questionStore, inertNetworkServices()); handlers.get('session_start')({}, ctx);
  const command = value => commands.get('cuckoo').handler(value, ctx);
  function boundary(message, overrides) {
    const messageEntryId = manager.appendMessage(message);
    const event = { message, messageEntryId, outcome: 'completed', entries: [], continue: false, context: { pendingMessages: [] }, toolResults: [], ...overrides };
    const result = handlers.get('turn_end')(event, ctx);
    if (result !== undefined && result.entries !== undefined) for (const entry of result.entries) {
      if (entry.type === 'custom') manager.appendCustomEntry(entry.customType, entry.data);
      else if (entry.type === 'custom_message') manager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
    }
    return result;
  }
  /** Open the report panel, comment on the nodes of the newest checkpoint reached by the given tab counts, and close it with `closeKey`. */
  async function comment(items, closeKey) {
    const showing = command(''); await tick();
    const panel = views.at(-1).component;
    panel.render(100);
    // The pane opens on the current set, which takes no comments; the newest checkpoint is the row below it.
    panel.handleInput(DOWN);
    for (const item of items) {
      for (let i = 0; i < item.tabs; i++) panel.handleInput(TAB);
      panel.handleInput('c'); for (const character of item.text) panel.handleInput(character); panel.handleInput(ENTER);
    }
    panel.handleInput(closeKey); await showing;
    assert.equal(views.at(-1).closed, true);
  }
  /** One saved checkpoint on the branch, taken with a manual inquiry while idle. */
  async function checkpointed(raw) {
    await command('inquire now');
    const requestId = sent.at(-1).message.details.requestId;
    manager.appendCustomMessageEntry(INQUIRY_TYPE, sent.at(-1).message.content, false, sent.at(-1).message.details);
    boundary(assistant(raw));
    return requestId;
  }
  const deliveries = () => manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  return { cwd, manager, ctx, handlers, sent, woken, notifications, views, command, boundary, comment, checkpointed, deliveries,
    completions: prefix => commands.get('cuckoo').getArgumentCompletions(prefix),
    tokens: value => { tokens = value; }, idle: value => { idle = value; }, trust: value => { trusted = value; },
    questions: () => questions, breakQuestions: error => { questionFault = error; }, inputs, selections };
}

// Specified Behavioral-Active / Blackbox-Group: public extension events and commands over the real in-memory session tree.
test('questions commands add, list and remove durable questions without touching cadence state', async t => {
  const f = fixture(t);
  await f.command('questions');
  assert.match(f.notifications.at(-1)[0], /No Cuckoo standing questions/);
  await f.command('questions add   What did you verify   since the last checkpoint? ');
  assert.equal(f.questions().length, 1); assert.equal(f.questions()[0].question, 'What did you verify since the last checkpoint?');
  const id = f.questions()[0].id;
  assert.match(f.notifications.at(-1)[0], new RegExp(`added global standing question ${id}: What did you verify`));
  await f.command('default questions add Which assumption is least tested?');
  assert.equal(f.questions().length, 2);
  await f.command('questions list');
  assert.match(f.notifications.at(-1)[0], new RegExp(`${id} \\(global\\): What did you verify since the last checkpoint\\?`));
  const status = f.command('status'); await tick();
  assert.equal(f.views.length, 1, 'status opens the report panel in a terminal');
  assert.match(f.views[0].component.render(120).join('\n'), /Standing questions: 2 asked at every checkpoint \(\/cuckoo questions\)/);
  f.views[0].component.handleInput(ESCAPE); await status;
  await f.command(`questions remove ${id}`);
  assert.deepEqual(f.questions().map(item => item.question), ['Which assumption is least tested?']);
  assert.match(f.notifications.at(-1)[0], /removed global standing question/);
  for (const invalid of ['questions bogus', 'questions list extra', 'questions remove two words', `questions remove ${id}`, 'questions add Which assumption is least tested?', 'project questions add Needs trust?']) {
    const before = f.questions().length;
    await f.command(invalid);
    assert.equal(f.notifications.at(-1)[1], 'error', invalid);
    assert.match(f.notifications.at(-1)[0], /^Cuckoo questions: /, invalid);
    assert.doesNotMatch(f.notifications.at(-1)[0], /automatic inquiries stopped/, 'a rejected command is not a configuration fault');
    assert.equal(f.questions().length, before, invalid);
  }
  assert.equal(stateOnBranch(f.manager.getBranch()), null);
  assert.deepEqual(f.completions('questions ').map(item => item.label), ['list', 'add', 'remove']);
  assert.ok(f.completions('que').some(item => item.label === 'questions'));
  assert.deepEqual(f.completions('project questions ').map(item => item.label), ['list', 'add', 'remove']);
  assert.equal(f.completions('questions add '), null, 'question text is user input, not a preset');
});

test('interactive add and remove prompt for the missing argument; cancelling changes nothing', async t => {
  const f = fixture(t);
  f.inputs.push(undefined); await f.command('questions add'); assert.equal(f.questions().length, 0);
  f.inputs.push('   '); await f.command('questions add'); assert.equal(f.questions().length, 0);
  f.inputs.push('Typed into the dialog?'); await f.command('questions add');
  f.inputs.push('Second one?'); await f.command('questions add');
  assert.deepEqual(f.questions().map(item => item.question), ['Typed into the dialog?', 'Second one?']);
  f.selections.push(undefined); await f.command('questions remove'); assert.equal(f.questions().length, 2);
  f.selections.push('Typed into the dialog?'); await f.command('questions remove');
  assert.deepEqual(f.questions().map(item => item.question), ['Second one?']);
  f.ctx.mode = 'rpc';
  await f.command('questions add'); assert.equal(f.notifications.at(-1)[1], 'error'); assert.match(f.notifications.at(-1)[0], /Usage: \/cuckoo \[default\|project\] questions/);
  await f.command('questions remove'); assert.equal(f.notifications.at(-1)[1], 'error');
  assert.equal(f.questions().length, 1);
});

test('project questions live in the trusted project directory and are asked after global ones', async t => {
  const f = fixture(t); const path = join(f.cwd, CONFIG_DIR_NAME, 'cuckoo-questions.json');
  await f.command('questions add Global question?');
  await f.command('project questions add Project question?');
  assert.equal(f.notifications.at(-1)[1], 'error'); assert.match(f.notifications.at(-1)[0], /trusted project/); assert.equal(existsSync(path), false);
  f.trust(true);
  await f.command('project questions add Project question?');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(stored.version, 1); assert.deepEqual(stored.questions.map(item => item.question), ['Project question?']);
  f.boundary(assistant('work')); await f.command('inquire now');
  const pending = stateOnBranch(f.manager.getBranch()).pending.questions;
  assert.deepEqual(pending.map(item => [item.scope, item.question]), [['global', 'Global question?'], ['project', 'Project question?']]);
  f.trust(false);
  await f.command('questions');
  assert.doesNotMatch(f.notifications.at(-1)[0], /Project question\?/); assert.match(f.notifications.at(-1)[0], /ignored: untrusted project/);
  await f.command(`questions remove ${stored.questions[0].id}`);
  assert.equal(f.notifications.at(-1)[1], 'error');
  f.trust(true);
  await f.command(`project questions remove ${f.questions()[0].id}`);
  assert.equal(f.notifications.at(-1)[1], 'error', 'a scoped removal does not reach the global store'); assert.equal(f.questions().length, 1);
  await f.command(`project questions remove ${stored.questions[0].id}`);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).questions, []);
});

test('an automatic inquiry asks the standing questions, and the reply is validated against what was asked', async t => {
  const f = fixture(t);
  await f.command('questions add What did you verify?');
  const [question] = f.questions();
  await f.command('on'); f.boundary(assistant('baseline')); f.tokens(23000);
  const issued = f.boundary(assistant('ordinary work'));
  assert.equal(issued.continue, true);
  const inquiry = issued.entries.at(-1);
  assert.equal(inquiry.customType, INQUIRY_TYPE); assert.notEqual(inquiry.content, INQUIRY);
  assert.ok(inquiry.content.includes(JSON.stringify([{ id: question.id, question: 'What did you verify?' }])));
  assert.deepEqual(stateOnBranch(f.manager.getBranch()).pending.questions, [{ ...question, scope: 'global' }]);
  // Removing the question after it was asked does not change what this reply must contain.
  await f.command(`questions remove ${question.id}`);
  const raw = JSON.stringify({ objectives: [objective], rules, answers: [{ id: question.id, answer: 'The decoder tests passed.' }] });
  f.boundary(assistant(raw));
  const saved = checkpoints(f.manager.getBranch())[0];
  assert.equal(saved.version, 6); assert.equal(saved.error, null);
  assert.deepEqual(saved.report.answers, [{ id: question.id, question: 'What did you verify?', scope: 'global', answer: 'The decoder tests passed.' }]);
  assert.match(historyText(f.manager.getEntries(), f.manager.getBranch()), /Q1\. What did you verify\? \(global, .*\)\n   Answer: The decoder tests passed\./);
  // With no questions left, the next inquiry is the base inquiry again, now stating what the first reply recorded.
  f.tokens(30000); const next = f.boundary(assistant('more work'));
  const recorded = '{"objectives":[{"id":"AO1","objective":"Ship Cuckoo"}],"completed":[],"rules":[{"id":"AR1","rule":"Show mockups first","source":"user","scope":"This UI change"}]}';
  assert.equal(next.entries.at(-1).content, INQUIRY.replace('{"objectives":[],"completed":[],"rules":[]}', recorded));
  f.boundary(assistant(plainReport));
  assert.equal(checkpoints(f.manager.getBranch())[1].version, 6); assert.equal(checkpoints(f.manager.getBranch())[1].report.answers, null);
});

test('a reply that ignores the standing questions is kept as invalid, and a superseded inquiry records what it asked', async t => {
  const f = fixture(t);
  await f.command('questions add What did you verify?');
  f.boundary(assistant('baseline'));
  await f.command('inquire now');
  assert.equal(f.sent.at(-1).message.customType, INQUIRY_TYPE); assert.match(f.sent.at(-1).message.content, /What did you verify\?/);
  assert.deepEqual(f.sent.at(-1).options, { triggerTurn: true });
  f.boundary(assistant(plainReport));
  const ignored = checkpoints(f.manager.getBranch())[0];
  assert.equal(ignored.report, null); assert.equal(ignored.raw, plainReport); assert.equal(ignored.version, 6); assert.match(ignored.error, /answers/);
  assert.ok(f.notifications.some(args => args[1] === 'warning' && /raw response preserved/.test(args[0])));
  await f.command('inquire now');
  f.handlers.get('before_agent_start')({ messageType: 'user', systemPromptOptions: { sections: {} } }, f.ctx);
  const superseded = checkpoints(f.manager.getBranch())[1];
  assert.equal(superseded.version, 6); assert.match(superseded.error, /superseded/); assert.equal(superseded.questions[0].question, 'What did you verify?');
});

test('an unreadable question store is a visible configuration fault and no inquiry is issued from it', async t => {
  const f = fixture(t); await f.command('on'); f.boundary(assistant('baseline')); f.tokens(23000);
  f.breakQuestions(new Error('Invalid Cuckoo standing questions in memory:questions'));
  const result = f.boundary(assistant('work'));
  assert.equal(result, undefined);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  assert.ok(f.notifications.some(args => args[1] === 'error' && /Invalid Cuckoo standing questions.*automatic inquiries stopped/.test(args[0])));
  await f.command('inquire now');
  assert.equal(f.notifications.at(-1)[1], 'error'); assert.equal(f.sent.length, 0);
  f.breakQuestions(null);
  assert.equal(f.boundary(assistant('work')).continue, true, 'scheduling recovers once the store is readable');
});

test('comments made while idle are saved as history entries and appended for the model at once, exactly once', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); const requestId = await f.checkpointed(plainReport);
  await f.comment([{ tabs: 1, text: 'I never asked for mockups.' }, { tabs: 1, text: 'Run the full suite.' }], ESCAPE);
  const saved = savedComments(f.manager.getBranch());
  assert.deepEqual(saved.map(item => [item.requestId, item.target.kind, item.subject, item.text]), [
    [requestId, 'rule', 'Rule AR1 (user): Show mockups first (scope: This UI change)', 'I never asked for mockups.'],
    [requestId, 'objective', 'Objective AO1: Ship Cuckoo', 'Run the full suite.']]);
  for (const item of saved) { assert.match(item.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); assert.ok(item.commentId.length > 0); }
  assert.equal(new Set(saved.map(item => item.commentId)).size, 2);
  assert.equal(f.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === COMMENT_TYPE).length, 2);
  const [delivery] = f.deliveries();
  assert.equal(f.deliveries().length, 1);
  assert.match(delivery.content, /On Rule AR1 \(user\): Show mockups first.*\n   User comment: I never asked for mockups\./);
  assert.match(delivery.content, /On Objective AO1: Ship Cuckoo\n   User comment: Run the full suite\./);
  assert.ok(delivery.content.includes(`Checkpoint ${requestId}`));
  assert.deepEqual(delivery.details.commentIds, saved.map(item => item.commentId));
  assert.equal(delivery.display, true);
  assert.match(f.notifications.at(-1)[0], /2 comments saved to checkpoint history; the model is responding to them/);
  assert.deepEqual(undeliveredComments(f.manager.getBranch()), []);
  // Closing the panel while nothing runs asks the model to respond: one hidden request after the delivery, through retained ingress.
  assert.deepEqual(f.woken, [{ message: { customType: COMMENT_RESPONSE_TYPE, content: COMMENT_RESPONSE, display: false }, options: { triggerTurn: true, deliverAs: 'steer' } }]);
  const order = f.manager.getBranch().filter(entry => entry.type === 'custom_message').map(entry => entry.customType);
  assert.deepEqual(order.slice(-2), [COMMENTS_TYPE, COMMENT_RESPONSE_TYPE], 'the request to respond follows the comments it refers to');
  assert.match(COMMENT_RESPONSE, /expects a response now/); assert.match(COMMENT_RESPONSE, /not a Cuckoo inquiry/); assert.doesNotMatch(COMMENT_RESPONSE, /JSON only/);
  // No later boundary, run start or settlement repeats the delivery.
  assert.equal(f.handlers.get('before_agent_start')({ messageType: 'user', systemPromptOptions: { sections: {} } }, f.ctx), undefined);
  assert.equal(f.boundary(assistant('later work')), undefined);
  f.handlers.get('agent_settled')({ aborted: false }, f.ctx);
  assert.equal(f.deliveries().length, 1);
  const reports = f.command('reports'); await tick();
  // The comment is shown with the checkpoint it was made on: the row below the current set.
  assert.doesNotMatch(f.views.at(-1).component.render(120).join('\n'), /Run the full suite\./);
  f.views.at(-1).component.handleInput(DOWN);
  assert.match(f.views.at(-1).component.render(120).join('\n'), /Comment:\s+\[.*Z\] Run the full suite\./);
  f.views.at(-1).component.handleInput(ESCAPE); await reports;
  assert.match(historyText(f.manager.getEntries(), f.manager.getBranch()), /ETA: Unknown: tests pending\n   Comment \(.*Z\): Run the full suite\./);
});

test('comments made while the agent runs wait for a completed turn boundary and work with automatic inquiries off', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.idle(false);
  await f.comment([{ tabs: 2, text: 'Busy comment' }], ESCAPE);
  assert.equal(f.deliveries().length, 0); assert.equal(savedComments(f.manager.getBranch()).length, 1);
  assert.match(f.notifications.at(-1)[0], /1 comment saved to checkpoint history; the model receives them at its next completed turn/);
  assert.equal(f.sent.filter(item => item.message.customType === COMMENTS_TYPE).length, 0);
  assert.deepEqual(f.woken, [], 'a running model is not asked for a separate response');
  // An aborted turn is not a safe point; the comment stays pending.
  assert.equal(f.boundary(assistant('interrupted', 'aborted'), { outcome: 'aborted' }), undefined);
  assert.equal(undeliveredComments(f.manager.getBranch()).length, 1);
  const prior = { type: 'custom', customType: 'foreign', data: { preserved: true } };
  const result = f.boundary(assistant('tool turn', 'toolUse'), { entries: [prior] });
  assert.deepEqual(result.entries[0], prior, 'drafts of earlier handlers are preserved in place');
  assert.equal(result.entries.length, 2); assert.equal(result.entries[1].type, 'custom_message'); assert.equal(result.entries[1].customType, COMMENTS_TYPE);
  assert.match(result.entries[1].content, /User comment: Busy comment/);
  assert.equal(result.continue, undefined, 'a comment does not by itself keep the agent running');
  assert.equal(f.deliveries().length, 1);
  assert.equal(f.boundary(assistant('next turn')), undefined, 'delivered once');
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
});

test('comments precede an inquiry issued at the same boundary and the reply captured at a later one', async t => {
  const f = fixture(t); await f.command('on');
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.idle(false);
  await f.comment([{ tabs: 1, text: 'Before the inquiry' }], ESCAPE);
  f.tokens(40000);
  const issued = f.boundary(assistant('work'));
  assert.deepEqual(issued.entries.map(entry => entry.customType), [COMMENTS_TYPE, STATE_TYPE, INQUIRY_TYPE]);
  assert.equal(issued.continue, true);
  await f.comment([{ tabs: 1, text: 'While the report is written' }], ESCAPE);
  const tooling = assistant('{"objectives":[],"rules":[]}', 'toolUse'); tooling.content.push({ type: 'toolCall', id: 'blocked', name: 'bash', arguments: {} });
  const captured = f.boundary(tooling);
  assert.deepEqual(captured.entries.map(entry => entry.customType), [COMMENTS_TYPE, 'cuckoo.report', STATE_TYPE, RESUME_TYPE]);
  assert.match(captured.entries[0].content, /While the report is written/); assert.doesNotMatch(captured.entries[0].content, /Before the inquiry/);
  assert.equal(f.deliveries().length, 2);
});

test('settlement and the next run start pick up comments that no boundary delivered', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.idle(false);
  await f.comment([{ tabs: 1, text: 'After the last turn' }], ESCAPE);
  const start = f.handlers.get('before_agent_start')({ messageType: 'user', systemPromptOptions: { sections: {} } }, f.ctx);
  assert.equal(start.message.customType, COMMENTS_TYPE); assert.match(start.message.content, /After the last turn/); assert.equal(start.message.display, true);
  assert.equal(f.deliveries().length, 0, 'the fixture did not commit the returned message');
  f.handlers.get('agent_settled')({ aborted: true }, f.ctx);
  assert.equal(f.deliveries().length, 0, 'a session that is still busy takes nothing at settlement');
  f.idle(true);
  f.handlers.get('agent_settled')({ aborted: true }, f.ctx);
  assert.equal(f.deliveries().length, 1); assert.match(f.deliveries()[0].content, /After the last turn/);
  assert.deepEqual(f.woken, [], 'a delivery caught up after an abort does not restart the model');
  assert.equal(f.handlers.get('before_agent_start')({ messageType: 'user', systemPromptOptions: { sections: {} } }, f.ctx), undefined);
});

test('closing with i delivers the comments before the inquiry it requests', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  const before = f.sent.length;
  await f.comment([{ tabs: 2, text: 'Address this in the next report' }], 'i');
  assert.deepEqual(f.sent.slice(before).map(item => [item.message.customType, item.options.triggerTurn]), [[COMMENTS_TYPE, false], [INQUIRY_TYPE, true]]);
  assert.deepEqual(f.woken, [], 'the inquiry is the request; a second one would contradict its JSON-only instruction');
  assert.match(f.notifications.findLast(args => /saved to checkpoint history/.test(args[0]))[0], /added to the conversation for the model/);
  const branch = f.manager.getBranch();
  assert.ok(branch.findIndex(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE) < branch.findLastIndex(entry => entry.type === 'custom' && entry.customType === STATE_TYPE));
  assert.notEqual(stateOnBranch(branch).pending, null);
});

test('a manual inquiry first delivers comments left over from a busy session, so the inquiry stays the last request message', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.idle(false);
  await f.comment([{ tabs: 1, text: 'Left over' }], ESCAPE);
  f.idle(true);
  const before = f.sent.length;
  await f.command('inquire now');
  assert.deepEqual(f.sent.slice(before).map(item => [item.message.customType, item.options.triggerTurn]), [[COMMENTS_TYPE, false], [INQUIRY_TYPE, true]]);
  assert.equal(f.handlers.get('before_agent_start')({ messageType: 'custom', systemPromptOptions: { sections: {} } }, f.ctx), undefined, 'nothing is appended after the inquiry');
});

test('a comment on another branch is delivered only on the branch that contains it', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  const fork = f.manager.getLeafId();
  f.idle(false);
  await f.comment([{ tabs: 1, text: 'Only here' }], ESCAPE);
  f.manager.branch(fork); f.handlers.get('session_tree')({}, f.ctx);
  assert.equal(f.boundary(assistant('other branch work')), undefined);
  assert.equal(f.deliveries().length, 0);
  assert.equal(savedComments(f.manager.getEntries()).length, 1, 'session history still holds the comment');
  assert.match(historyText(f.manager.getEntries(), f.manager.getBranch()), /Comment \(.*\): Only here/);
});

test('an unreadable question store does not hide saved reports: status and the panel still open and show the fault', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.breakQuestions(new Error('Invalid Cuckoo standing questions in memory:questions'));
  f.ctx.mode = 'rpc';
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = f.notifications.length;
    await f.command('status');
    const output = f.notifications.slice(before).map(args => args[0]).join('\n');
    assert.match(output, /Error: Standing questions are unavailable: Error: Invalid Cuckoo standing questions in memory:questions/, `attempt ${attempt}`);
    assert.match(output, /1\. Ship Cuckoo\n   Progress: Testing/, `saved report is still shown on attempt ${attempt}`);
  }
  f.ctx.mode = 'tui';
  const shown = f.command(''); await tick();
  const screen = f.views.at(-1).component.render(120).join('\n');
  assert.match(screen, /Error: Standing questions are unavailable/); assert.match(screen, /Ship Cuckoo/);
  assert.ok(screen.indexOf('Standing questions are unavailable') < screen.indexOf('Ship Cuckoo'), 'the fault is shown above the report');
  f.views.at(-1).component.handleInput(ESCAPE); await shown;
  // The fault is also raised when state is refreshed, not only when an inquiry is due.
  f.handlers.get('turn_start')({}, f.ctx);
  assert.ok(f.notifications.some(args => args[1] === 'error' && /Invalid Cuckoo standing questions.*automatic inquiries stopped/.test(args[0])));
  f.breakQuestions(null);
  f.ctx.mode = 'rpc'; await f.command('status');
  assert.doesNotMatch(f.notifications.at(-1)[0], /unavailable/); assert.match(f.notifications.at(-1)[0], /Standing questions: 0 asked/);
});

test('the same question id in both stores is reported with the id and both files', async t => {
  const f = fixture(t); f.trust(true);
  await f.command('questions add Shared question?');
  const [question] = f.questions();
  const path = join(f.cwd, CONFIG_DIR_NAME, 'cuckoo-questions.json');
  mkdirSync(join(f.cwd, CONFIG_DIR_NAME), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, questions: [question] }));
  await f.command('questions');
  assert.equal(f.notifications.at(-1)[1], 'error');
  assert.ok(f.notifications.at(-1)[0].includes(`Standing question id ${question.id} is used in both memory:questions and ${path}`), f.notifications.at(-1)[0]);
});

// Regression (review): an edit that could not be read made the panel refuse to open and the badge drop every report.
test('an edit that cannot be read does not hide saved reports: status and the panel still open and say the current set is unavailable', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  f.manager.appendCustomEntry('cuckoo.edit', { version: 2, edit: {} });
  f.ctx.mode = 'rpc';
  const before = f.notifications.length;
  await f.command('status');
  const output = f.notifications.slice(before).map(args => args[0]).join('\n');
  assert.match(output, /Error: The current set is unavailable: Error: Invalid saved Cuckoo edit at entry/);
  assert.match(output, /AO1\. Ship Cuckoo\n   Progress: Testing/, 'the saved report is still shown');
  assert.doesNotMatch(output, /^Current set/m, 'no current set is made up');
  f.ctx.mode = 'tui';
  const shown = f.command(''); await tick();
  const screen = f.views.at(-1).component.render(120).join('\n');
  assert.match(screen, /Error: The current set is unavailable/); assert.match(screen, /AO1\. Ship Cuckoo/); assert.doesNotMatch(screen, /\bnow │/);
  assert.ok(screen.indexOf('The current set is unavailable') < screen.indexOf('AO1. Ship Cuckoo'), 'the fault is shown above the report');
  f.views.at(-1).component.handleInput(ESCAPE); await shown;
  f.handlers.get('turn_start')({}, f.ctx);
  assert.ok(f.notifications.some(args => args[1] === 'error' && /Invalid saved Cuckoo edit.*automatic inquiries stopped/.test(args[0])));
});

test('a comment on a checkpoint of another branch, made from history, is delivered with that provenance', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); const fork = f.manager.getLeafId();
  const requestId = await f.checkpointed(plainReport);
  f.manager.branch(fork); f.handlers.get('session_tree')({}, f.ctx);
  const shown = f.command('history'); await tick();
  const panel = f.views.at(-1).component; panel.render(100);
  assert.match(panel.render(100).join('\n'), /other branch/);
  panel.handleInput(TAB); panel.handleInput('c'); for (const character of 'From history') panel.handleInput(character); panel.handleInput(ENTER);
  panel.handleInput(ESCAPE); await shown;
  assert.equal(f.deliveries().length, 1);
  assert.ok(f.deliveries()[0].content.includes(`Checkpoint ${requestId} (saved on another branch of this session; cuckoo_recall reads it only with scope "session")`), f.deliveries()[0].content);
});

test('session shutdown saves comments still open in the panel', async t => {
  const f = fixture(t);
  f.boundary(assistant('baseline')); await f.checkpointed(plainReport);
  const shown = f.command(''); await tick();
  const panel = f.views.at(-1).component; panel.render(100);
  panel.handleInput(DOWN); panel.handleInput(TAB); panel.handleInput('c'); for (const character of 'Typed before quitting') panel.handleInput(character);
  f.handlers.get('session_shutdown')({}, f.ctx); await shown;
  assert.deepEqual(savedComments(f.manager.getBranch()).map(item => item.text), ['Typed before quitting']);
  assert.equal(f.deliveries().length, 1, 'an idle session records the delivery before it closes');
  assert.deepEqual(f.woken, [], 'a closing session is not asked to respond');
});
