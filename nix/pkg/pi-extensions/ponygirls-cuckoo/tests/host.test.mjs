import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { checkpoints, historyText } from '../src/report.ts';
import { COMMENT_RESPONSE_TYPE, COMMENT_TYPE, COMMENTS_TYPE, commentRecord, savedComments, undeliveredComments } from '../src/comments.ts';
import { FileQuestionStore } from '../src/questions.ts';
import { INQUIRY_TYPE, STATE_TYPE, stateOnBranch } from '../src/state.ts';
import { readMemory, textDigest } from '../src/memory-core.ts';
import { EDIT_TYPE, currentSet } from '../src/current.ts';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function configuredFixture(t, enableMemory, loadDirectory, terminal, extensionFactories = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-host-')); const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const entry = process.env.PI_CUCKOO_EXTENSION === undefined ? resolve(import.meta.dirname, '../index.ts') : process.env.PI_CUCKOO_EXTENSION;
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    extensionFactories, additionalExtensionPaths: [loadDirectory ? dirname(entry) : entry], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  const contexts = []; const replies = []; let onRequest = () => {};
  runtime.registerProvider('cuckoo-fixture', { api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      contexts.push(structuredClone(context)); const reply = replies.shift();
      assert.notEqual(reply, undefined, 'unexpected extra model request');
      onRequest(contexts.length);
      const stream = createAssistantMessageEventStream();
      const finish = () => {
        const content = typeof reply.text === 'string' ? [{ type: 'text', text: reply.text }] : reply.content;
        const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
          usage: { ...zero, input: reply.tokens, totalTokens: reply.tokens }, stopReason: options.signal.aborted ? 'aborted' : reply.reason === undefined ? content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop' : reply.reason, timestamp: Date.now() };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
      };
      if (reply.wait) options.signal.addEventListener('abort', finish, { once: true });
      else if (reply.gate !== undefined) reply.gate.then(finish);
      else queueMicrotask(finish);
      return stream;
    } });
  const manager = sdk.SessionManager.create(dir, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModel('cuckoo-fixture', 'scripted'),
    thinkingLevel: 'off', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
  const errors = []; const notifications = []; const views = [];
  // The terminal variant exposes Pi's custom-view boundary, so the report panel itself is driven; no real terminal is attached.
  const custom = factory => new Promise(resolve => {
    const view = { closed: false }; views.push(view);
    view.component = factory({ terminal: { rows: 40 }, requestRender() {} }, { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text },
      { matches: (key, action) => key === '\x1b' && action === 'tui.select.cancel' }, () => { view.closed = true; resolve(); });
  });
  await session.bindExtensions({ mode: terminal ? 'tui' : 'rpc', onError: error => errors.push(error), uiContext: { notify: (...args) => notifications.push(args), setWidget() {}, ...(terminal ? { custom } : {}) } });
  t.after(async () => { await session.abort(); session.dispose(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(dir, { recursive: true, force: true }); });
  if (enableMemory) {
    await session.prompt('/cuckoo on');
    for (const feature of ['evidence', 'corrections', 'verifiers', 'reader']) await session.prompt(`/cuckoo feature ${feature} on`);
  }
  return { dir, session, manager, contexts, replies, errors, notifications, views, onRequest: fn => { onRequest = fn; } };
}
function fixture(t) { return configuredFixture(t, false, false, false); }
function memoryFixture(t) { return configuredFixture(t, true, false, false); }
function terminalFixture(t) { return configuredFixture(t, false, false, true); }
const tick = () => new Promise(setImmediate);
async function until(condition, what) {
  for (let i = 0; i < 2000; i++) { if (condition()) return; await tick(); }
  assert.fail(`timed out waiting for ${what}`);
}
/** Comment on the node of the newest checkpoint reached by `tabs` in the open report panel, then close the panel with `closeKey` (Escape by default). */
async function commentInPanel(f, tabs, text, closeKey = '\x1b') {
  const shown = f.session.prompt('/cuckoo'); await until(() => f.views.length > 0 && !f.views.at(-1).closed, 'the report panel');
  const panel = f.views.at(-1).component; panel.render(100);
  // The pane opens on the current set, which takes no comments; the newest checkpoint is the row below it.
  panel.handleInput('\x1b[B');
  for (let i = 0; i < tabs; i++) panel.handleInput('\t');
  panel.handleInput('c'); for (const character of text) panel.handleInput(character); panel.handleInput('\r');
  panel.handleInput(closeKey); await shown;
}
/** Retained wakes start on a later tick, after waitForIdle may already have resolved: let them start, then wait again. */
async function settled(f) {
  for (let pass = 0; pass < 3; pass++) { await f.session.waitForIdle(); await new Promise(resolve => setTimeout(resolve, 20)); }
  await f.session.waitForIdle();
}
const customTypes = f => f.manager.getBranch().filter(entry => entry.type === 'custom_message').map(entry => entry.customType);

// A reply that names every entry as new; the first checkpoint of a session numbers them AO1, AR1 and AR2.
const report = '{"objectives":[{"id":null,"objective":"Ship Cuckoo","progress":"Validating the runtime","issues":["A decoder defect needs correction","Waiting for access approval","Serial validation"],"eta":"Unknown: validation pending"}],"rules":[{"id":null,"rule":"Show mockups before implementing","source":"user","scope":"This UI change"},{"id":null,"rule":"Preserve cadence","source":"assistant","scope":"This change"}]}';
/** `report` as it is read back once Cuckoo numbered its entries. */
const numberedReport = { objectives: [{ ...JSON.parse(report).objectives[0], id: 'AO1' }], rules: JSON.parse(report).rules.map((item, index) => ({ ...item, id: `AR${index + 1}` })), answers: null };

test('real Pi package-directory loading does not enable audit memory implicitly', { timeout: 20000 }, async t => {
  const f = await configuredFixture(t, false, true, false);
  assert.ok(f.session.getActiveToolNames().includes('cuckoo_recall'));
  assert.equal(f.session.getActiveToolNames().includes('cuckoo_memory'), false);
  f.replies.push({ text: 'Ordinary task finished', tokens: 20000 });
  await f.session.prompt('Work without memory');
  assert.equal(getCurrentTools(f.contexts[0].messages).some(tool => tool.name === 'cuckoo_memory'), false);
  assert.deepEqual(f.errors, []);
});

for (const [kind, value, threshold] of [['window', 15, 50000], ['tokens', 10000, 30000]]) {
  test(`real Pi ${kind} growth policy schedules at the exact token delta and persists through reload`, { timeout: 20000 }, async t => {
    const f = await fixture(t); await f.session.prompt('/cuckoo on'); await f.session.prompt(`/cuckoo policy ${kind} ${value}`);
    f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
    await f.session.reload();
    f.replies.push({ text: 'Below threshold', tokens: threshold - 1 }); await f.session.prompt('Continue');
    assert.equal(f.contexts.length, 2); assert.equal(checkpoints(f.manager.getBranch()).length, 0);
    f.replies.push({ text: 'At threshold', tokens: threshold }, { text: report, tokens: threshold + 100 }); await f.session.prompt('Continue');
    assert.equal(f.contexts.length, 4); assert.equal(checkpoints(f.manager.getBranch()).length, 1);
    assert.match(JSON.stringify(f.contexts.at(-1)), /Restate me your objectives/);
    assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
  });
}

test('real Pi labels the checkpoint by identity even after a custom context message', { timeout: 20000 }, async t => {
  const auxiliary = 'Synthetic project inventory';
  const f = await configuredFixture(t, false, false, true, [pi => {
    pi.on('before_agent_start', () => ({ message: { customType: 'codegraph-projects', content: auxiliary, display: false } }));
  }]);
  const label = '🐦 Updating cuckoo status ...';
  const marker = 'CUCKOO-CHECKPOINT\nAn ordinary reply';
  const transforms = () => f.session.extensionRunner.getMarkdownTransformers();
  const display = (chain, text, messageId, isStreaming = false) => chain.reduce(
    (markdown, transform) => transform(markdown, { messageType: 'assistant', messageId, isStreaming, availableWidth: 100 }), text);
  const live = [];
  const unsubscribe = f.session.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'assistant') live.push(transforms());
  });
  t.after(unsubscribe);
  f.replies.push({ text: report, tokens: 20000 }, { text: report, tokens: 20100 }, { text: marker, tokens: 20200 });
  await f.session.prompt('Ordinary work');
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /follow the inquiry's requested format and use no tools/);
  assert.doesNotMatch(JSON.stringify(f.contexts.at(-1)), /CUCKOO-CHECKPOINT/);
  assert.match(JSON.stringify(f.contexts.at(-1).messages.at(-2)), /Restate me your objectives/);
  assert.match(JSON.stringify(f.contexts.at(-1).messages.at(-1)), /Synthetic project inventory/);
  await f.session.prompt('More ordinary work');
  assert.equal(live.length, 3);
  assert.equal(display(live[0], report, undefined, true), report);
  assert.equal(display(live[1], report.slice(0, 27), undefined, true), label);
  assert.equal(display(live[1], report), label);
  assert.equal(display(live[2], marker, undefined, true), marker);
  const branch = f.manager.getBranch();
  const [ordinary, reply, markedOrdinary] = branch.filter(entry => entry.type === 'message' && entry.message.role === 'assistant');
  const entry = branch.find(item => item.customType === 'cuckoo.report');
  const [saved] = checkpoints(branch);
  assert.equal(entry.data.messageEntryId, reply.id);
  assert.equal(saved.raw, report);
  assert.equal(saved.error, null);
  await f.session.reload({ beforeSessionStart() {
    const replay = transforms();
    assert.equal(f.session.extensionRunner.getEntryRenderer(entry.customType)(entry), undefined);
    assert.equal(display(replay, report, reply.id), label);
    assert.equal(display(replay, report, ordinary.id), report);
    assert.equal(display(replay, marker, markedOrdinary.id), marker);
  } });
  assert.deepEqual(f.errors, []);
});

test('real Pi fresh defaults use 15% of context window, not 15% relative growth', { timeout: 20000 }, async t => {
  const f = await fixture(t); await f.session.prompt('/cuckoo on');
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: 'Relative threshold is not enough', tokens: 23000 }); await f.session.prompt('Continue');
  assert.equal(checkpoints(f.manager.getBranch()).length, 0);
  f.replies.push({ text: 'Window threshold', tokens: 50000 }, { text: report, tokens: 50100 }); await f.session.prompt('Continue');
  assert.equal(checkpoints(f.manager.getBranch()).length, 1); assert.equal(f.contexts.length, 4); assert.deepEqual(f.errors, []);
});

// Specified Behavioral-Active / Effectual-GoodCommunication: real Pi loader, model loop, JSONL, commands and reload; scripted provider is not a semantic-quality test.
test('real Pi relative cadence, JSON persistence, no idle inference, view while off and reload', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Default off', tokens: 20000 }); await f.session.prompt('Work');
  assert.equal(f.contexts.length, 1); assert.equal(stateOnBranch(f.manager.getBranch()), null);
  await f.session.prompt('/cuckoo on'); await f.session.prompt('/cuckoo policy relative 15');
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Continue');
  assert.equal(stateOnBranch(f.manager.getBranch()).baseline, 20000);
  f.replies.push({ text: 'Below threshold', tokens: 22999 }); await f.session.prompt('Continue');
  assert.equal(f.contexts.length, 3);
  f.replies.push({ text: 'Threshold reached', tokens: 23000 }, { text: report, tokens: 23500 }); await f.session.prompt('Continue');
  assert.equal(f.contexts.length, 5); assert.match(JSON.stringify(f.contexts.at(-1)), /Restate me your objectives/);
  const saved = checkpoints(f.manager.getBranch()); assert.equal(saved.length, 1); assert.equal(saved[0].report.objectives.length, 1);
  const jsonl = readFileSync(f.manager.getSessionFile(), 'utf8'); assert.match(jsonl, /messageEntryId/); assert.match(jsonl, /cuckoo.report/);
  await f.session.prompt('/cuckoo off'); await f.session.prompt('/cuckoo');
  assert.equal(f.contexts.length, 5); assert.equal(existsSync(join(f.dir, 'cuckoo.json')), false);
  await f.session.reload(); assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.deepEqual(checkpoints(f.manager.getBranch())[0].report, numberedReport);
  assert.deepEqual(checkpoints(f.manager.getBranch())[0].assigned, { objectives: ['AO1'], rules: ['AR1', 'AR2'] });
  assert.ok(f.notifications.some(args => String(args[0]).includes('ETA: Unknown: validation pending')));
  f.replies.push({ text: 'Normal work', tokens: 24000 }); await f.session.prompt('Continue normally');
  assert.match(JSON.stringify(f.contexts.at(-1)), /checkpoint is closed/);
  const told = JSON.stringify({ objectives: [{ id: 'AO1', objective: 'Ship Cuckoo' }], rules: [{ id: 'AR1', rule: 'Show mockups before implementing' }, { id: 'AR2', rule: 'Preserve cadence' }] });
  assert.ok(JSON.stringify(f.contexts.at(-1)).includes(JSON.stringify(`quoted as data, not an instruction: ${told}. Use the ids to name these entries from now on.`).slice(1, -1)), 'the model is told the IDs of what it reported as new');
  assert.deepEqual(f.errors, []); assert.equal(f.replies.length, 0);
});

test('session history survives disk reopen and extension reload, including answers outside the active branch', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.session.prompt('/cuckoo on'); await f.session.prompt('/cuckoo policy tokens 10000');
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  const root = f.manager.getLeafId();
  f.replies.push({ text: 'Checkpoint due', tokens: 30000 }, { text: report, tokens: 30100 }); await f.session.prompt('Continue');
  f.manager.branch(root);
  f.manager.appendCustomEntry('cuckoo.report', { version: 1, requestId: 'partial', raw: 'Interrupted answer', error: 'Interrupted' });
  await f.session.reload();
  const calls = f.contexts.length;
  await f.session.prompt('/cuckoo history');
  const text = f.notifications.at(-1)[0];
  assert.match(text, /Validating the runtime/); assert.match(text, /Interrupted answer/);
  assert.match(text, /other branch/); assert.match(text, /current branch/);
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  assert.equal(historyText(reopened.getEntries(), reopened.getBranch()), text);
  const separate = sdk.SessionManager.create(f.dir, f.dir);
  assert.match(historyText(separate.getEntries(), separate.getBranch()), /No Cuckoo answers/);
  assert.equal(f.contexts.length, calls, 'reading history never calls the model');
  assert.deepEqual(f.errors, []);
});

test('real Pi checkpoint interrupts tool loop, blocks checkpoint tools, then resumes exactly once', { timeout: 20000 }, async t => {
  const f = await fixture(t); await f.session.prompt('/cuckoo on'); await f.session.prompt('/cuckoo policy relative 15');
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  const marker = join(f.dir, 'must-not-exist');
  f.replies.push({ content: [{ type: 'toolCall', id: 'source', name: 'bash', arguments: { command: 'printf source' } }], tokens: 23000 },
    { content: [{ type: 'toolCall', id: 'forbidden', name: 'bash', arguments: { command: `touch ${marker}` } }], tokens: 24000 },
    { text: 'Original task resumed and finished', tokens: 24500 });
  await f.session.prompt('Continue with tool work');
  assert.equal(f.contexts.length, 4); assert.equal(existsSync(marker), false);
  assert.equal(checkpoints(f.manager.getBranch())[0].report, null); assert.match(checkpoints(f.manager.getBranch())[0].error, /tool use/);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Resume the original task/);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null); assert.equal(stateOnBranch(f.manager.getBranch()).resuming, false);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi abort preserves partial response and does not mistake the next user response for a checkpoint', { timeout: 20000 }, async t => {
  const f = await fixture(t); await f.session.prompt('/cuckoo on'); await f.session.prompt('/cuckoo policy relative 15');
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: 'Threshold reached', tokens: 23000 }, { text: '{"objectives":[', tokens: 23001, wait: true });
  f.onRequest(n => { if (n === 3) setTimeout(() => void f.session.abort(), 5); });
  await f.session.prompt('Continue');
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.equal(checkpoints(f.manager.getBranch())[0].report, null);
  f.replies.push({ text: 'Answer the new user prompt normally', tokens: 24000 }); await f.session.prompt('New user task');
  assert.equal(checkpoints(f.manager.getBranch()).length, 1); assert.match(JSON.stringify(f.contexts.at(-1)), /checkpoint is closed/);
  assert.deepEqual(f.errors, []);
});

test('real Pi manual inquiry runs while off, persists JSON and does not become a new user task', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  assert.equal(f.contexts.length, 2); assert.equal(f.replies.length, 0);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.deepEqual(checkpoints(f.manager.getBranch())[0].report, numberedReport);
  assert.equal(checkpoints(f.manager.getBranch())[0].version, 6);
  assert.equal(checkpoints(f.manager.getBranch())[0].report.objectives[0].issues.length, 3);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Restate me your objectives/);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  await f.session.reload(); await f.session.prompt('/cuckoo status');
  assert.match(f.notifications.at(-1)[0], /Cuckoo: OFF/);
  assert.match(f.notifications.at(-1)[0], /Validating the runtime/);
  assert.match(f.notifications.at(-1)[0], /AR1 user: Show mockups before implementing \(scope: This UI change\)/);
  assert.match(f.notifications.at(-1)[0], /AR2 assistant: Preserve cadence/);
  assert.match(f.notifications.at(-1)[0], /^AO1\. Ship Cuckoo$/m);
  for (const issue of JSON.parse(report).objectives[0].issues) assert.ok(f.notifications.at(-1)[0].includes(`- ${issue}`));
  assert.doesNotMatch(f.notifications.at(-1)[0], /Obstacles:|Bottlenecks:/);
  assert.deepEqual(f.errors, []);
});

test('real Pi recall tool is declared, returns a saved round and stays readable with automatic scheduling off', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  assert.ok(getCurrentTools(f.contexts[0].messages).some(tool => tool.name === 'cuckoo_recall'));
  assert.match(getCurrentSystemPrompt(f.contexts[0].messages), /Automatic inquiries at run start: OFF/);
  assert.match(getCurrentSystemPrompt(f.contexts[0].messages), /self-reflection.*context-token growth.*not a timer/s);
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const saved = f.manager.getEntries().find(entry => entry.type === 'custom' && entry.customType === 'cuckoo.report');
  await f.session.prompt('/cuckoo on');
  f.replies.push({ content: [{ type: 'toolCall', id: 'recall-list', name: 'cuckoo_recall', arguments: { action: 'list' } }], tokens: 20200 }, { text: 'Listed', tokens: 20300 });
  await f.session.prompt('List earlier reflections');
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /Automatic inquiries at run start: ON/);
  const list = f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'recall-list').message;
  assert.equal(list.isError, false); assert.equal(list.details.rounds[0].entryId, saved.id); assert.equal(list.details.total, 1);
  await f.session.prompt('/cuckoo off'); await f.session.reload();
  f.replies.push({ content: [{ type: 'toolCall', id: 'recall-read', name: 'cuckoo_recall', arguments: { action: 'read', entryId: saved.id } }], tokens: 20400 }, { text: 'Read as historical evidence only', tokens: 20500 });
  await f.session.prompt('Read that reflection');
  const read = f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'recall-read').message;
  assert.equal(read.isError, false); assert.equal(read.details.nextOffset, null);
  assert.deepEqual(JSON.parse(read.details.text).report, numberedReport);
  assert.equal(JSON.parse(read.details.text).messageEntryId, saved.data.messageEntryId);
  assert.equal(JSON.parse(read.details.text).response.model, 'scripted');
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /Automatic inquiries at run start: OFF/);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Historical model self-reports/);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1); assert.equal(f.contexts.length, 6); assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

// Specified Behavioral-Active / Effectual-GoodCommunication: the update tool and the numbered record in the real model loop; the scripted provider shows the mechanism, not whether a model keeps the record.
test('real Pi declares the update tool while automatic mode is on; edits and checkpoint replies build one numbered record that survives reload', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Default off', tokens: 20000 }); await f.session.prompt('Work');
  assert.equal(getCurrentTools(f.contexts[0].messages).some(tool => tool.name === 'cuckoo_update'), false, 'not declared while automatic mode is off');
  await f.session.prompt('/cuckoo on'); await f.session.prompt('/cuckoo policy tokens 10000');
  const call = (id, args) => ({ type: 'toolCall', id, name: 'cuckoo_update', arguments: args });
  f.replies.push({ content: [call('add-1', { action: 'add_objective', objective: 'Ship the parser' }), call('add-2', { action: 'add_rule', rule: 'Ask before pushing', source: 'user', scope: 'This repository' })], tokens: 20100 },
    { content: [call('bad', { action: 'retire', id: 'AO9', reason: 'Never existed' }), call('upd', { action: 'update', id: 'AO1', progress: 'Grammar done' })], tokens: 20200 }, { text: 'Recorded', tokens: 20300 });
  await f.session.prompt('Take on the parser');
  assert.ok(getCurrentTools(f.contexts.at(-1).messages).some(tool => tool.name === 'cuckoo_update'), 'declared once automatic mode is on');
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /numbered record of this session's objectives \(AO1, AO2, and so on\)/);
  const results = () => new Map(f.manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').map(entry => [entry.message.toolCallId, entry.message]));
  assert.deepEqual(['add-1', 'add-2', 'upd'].map(id => [results().get(id).isError, results().get(id).details.id, results().get(id).details.status]), [[false, 'AO1', 'active'], [false, 'AR1', 'active'], [false, 'AO1', 'active']]);
  assert.equal(results().get('bad').isError, true); assert.match(JSON.stringify(results().get('bad').content), /AO9 is not in the record of this branch/);
  assert.equal(f.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === EDIT_TYPE).length, 3, 'the refused edit saved nothing');
  // The next checkpoint states the record; its reply continues AO1 by ID, adds an objective and leaves the rule out.
  const reply = JSON.stringify({ objectives: [{ id: 'AO1', objective: 'Ship the parser', progress: 'Grammar and recovery done', issues: [], eta: 'About an hour' }, { id: null, objective: 'Write the docs', progress: 'Not started', issues: [], eta: 'Unknown' }], rules: [] });
  f.replies.push({ text: 'Threshold reached', tokens: 31000 }, { text: reply, tokens: 31100 });
  await f.session.prompt('Continue');
  const inquiry = JSON.stringify(f.contexts.at(-1).messages.at(-1));
  assert.match(inquiry, /Restate me your objectives/);
  assert.ok(inquiry.includes(JSON.stringify(' The record now, as JSON: {"objectives":[{"id":"AO1","objective":"Ship the parser"}],"completed":[],"rules":[{"id":"AR1","rule":"Ask before pushing","source":"user","scope":"This repository"}]}').slice(1, -1)), 'the inquiry ends with the record the edits built');
  const [saved] = checkpoints(f.manager.getBranch());
  assert.equal(saved.error, null); assert.deepEqual(saved.assigned, { objectives: ['AO2'], rules: [] });
  const brief = set => ({ objectives: set.objectives.map(item => [item.id, item.status, item.progress]), rules: set.rules.map(item => [item.id, item.status]) });
  const expected = { objectives: [['AO1', 'active', 'Grammar and recovery done'], ['AO2', 'active', 'Not started']], rules: [['AR1', 'retired']] };
  assert.deepEqual(brief(currentSet(f.manager.getBranch())), expected);
  // During a checkpoint the tool is blocked like any other; afterwards the model reads the record and completes an entry.
  await f.session.prompt('/cuckoo off');
  f.replies.push({ text: 'Baseline again', tokens: 31200 }); await f.session.prompt('More work');
  assert.equal(getCurrentTools(f.contexts.at(-1).messages).some(tool => tool.name === 'cuckoo_update'), false, 'withdrawn when automatic mode is turned off');
  await f.session.prompt('/cuckoo on'); await f.session.reload();
  assert.deepEqual(brief(currentSet(f.manager.getBranch())), expected, 'the record is rebuilt from the session after reload');
  f.replies.push({ content: [{ type: 'toolCall', id: 'read', name: 'cuckoo_recall', arguments: { action: 'current' } }], tokens: 31300 },
    { content: [call('done', { action: 'complete', id: 'AO2', progress: 'Docs published', issues: ['No index yet'] })], tokens: 31400 }, { text: 'Completed', tokens: 31500 });
  await f.session.prompt('Finish the docs');
  const read = results().get('read');
  assert.equal(read.isError, false); assert.deepEqual([read.details.activeObjectives, read.details.activeRules, read.details.closed], [2, 0, 1]);
  assert.deepEqual(JSON.parse(read.details.text).objectives.map(item => item.id), ['AO1', 'AO2']);
  assert.deepEqual([results().get('done').isError, results().get('done').details.status, results().get('done').details.activeObjectives], [false, 'complete', 1]);
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  assert.deepEqual(brief(currentSet(reopened.getBranch())).objectives, [['AO1', 'active', 'Grammar and recovery done'], ['AO2', 'complete', 'Docs published']], 'and from the session file');
  assert.match(readFileSync(f.manager.getSessionFile(), 'utf8'), /"customType":"cuckoo\.edit"/);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi recall preserves branch isolation and reaches pre-compaction rounds after reload', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  const root = f.manager.getLeafId();
  const other = f.manager.appendCustomEntry('cuckoo.report', { version: 4, requestId: 'other', raw: report, error: null });
  f.manager.branch(root);
  const current = f.manager.appendCustomEntry('cuckoo.report', { version: 1, requestId: 'legacy', raw: '{"objectives":[]}', error: null });
  const kept = f.manager.appendMessage({ role: 'user', content: 'Keep this after compaction', timestamp: 1 });
  f.manager.appendCompaction('Summary without reflection bodies', kept, 25000);
  await f.session.reload();
  f.replies.push({ content: [
    { type: 'toolCall', id: 'branch-list', name: 'cuckoo_recall', arguments: { action: 'list' } },
    { type: 'toolCall', id: 'session-list', name: 'cuckoo_recall', arguments: { action: 'list', scope: 'session' } },
    { type: 'toolCall', id: 'other-denied', name: 'cuckoo_recall', arguments: { action: 'read', entryId: other } },
    { type: 'toolCall', id: 'other-explicit', name: 'cuckoo_recall', arguments: { action: 'read', scope: 'session', entryId: other } },
  ], tokens: 21000 }, { text: 'Historical branch scopes distinguished', tokens: 21100 });
  await f.session.prompt('Recall reflections');
  const result = id => f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === id).message;
  assert.deepEqual(result('branch-list').details.rounds.map(round => round.entryId), [current]);
  assert.deepEqual(result('session-list').details.rounds.map(round => round.branch), ['current', 'other']);
  assert.equal(result('other-denied').isError, true);
  assert.equal(result('other-explicit').details.round.branch, 'other'); assert.equal(JSON.parse(result('other-explicit').details.text).raw, report);
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  assert.equal(reopened.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'cuckoo.report').length, 2);
  assert.equal(f.contexts.length, 3); assert.deepEqual(f.errors, []);
});

test('real Pi rejects invalid recall arguments through tool validation', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const inputs = [{ action: 'list', limit: 21 }, { action: 'list', scope: 'global' }, { action: 'read' }, { action: 'read', entryId: 'x', offset: -1 }, { action: 'list', path: '/unrelated/session' }];
  f.replies.push({ content: inputs.map((arguments_, i) => ({ type: 'toolCall', id: `invalid-${i}`, name: 'cuckoo_recall', arguments: arguments_ })), tokens: 20000 }, { text: 'Invalid requests reported', tokens: 20100 });
  await f.session.prompt('Exercise argument boundaries');
  const results = f.manager.getEntries().filter(entry => entry.type === 'message' && entry.message.role === 'toolResult');
  assert.equal(results.length, inputs.length); assert.ok(results.every(entry => entry.message.isError));
  for (const entry of results) assert.doesNotMatch(JSON.stringify(entry.message.content), /not found/);
  assert.equal(checkpoints(f.manager.getBranch()).length, 0); assert.equal(f.contexts.length, 2); assert.deepEqual(f.errors, []);
});

test('real Pi still blocks recall during an inquiry and resumes once without recursive reflection', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ content: [{ type: 'toolCall', id: 'blocked-recall', name: 'cuckoo_recall', arguments: { action: 'list' } }], tokens: 20100 }, { text: 'Original task finished', tokens: 20200 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const result = f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'blocked-recall').message;
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /Tool execution is not permitted during a Cuckoo checkpoint/);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1); assert.equal(checkpoints(f.manager.getBranch())[0].report, null);
  assert.equal(f.contexts.length, 3); assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi memory tool persists exact artifacts and check bindings through reload and disk reopen', { timeout: 20000 }, async t => {
  const f = await memoryFixture(t);
  const result = id => {
    const entry = f.manager.getEntries().find(item => item.type === 'message' && item.message.role === 'toolResult' && item.message.toolCallId === id);
    assert.ok(entry); assert.equal(entry.message.isError, false);
    return entry.message.details;
  };
  const invoke = async (id, args, prompt) => {
    f.replies.push({ content: [{ type: 'toolCall', id, name: 'cuckoo_memory', arguments: args }], tokens: 20000 }, { text: 'Synthetic operation completed', tokens: 20100 });
    await f.session.prompt(prompt);
    return result(id);
  };
  const task = await invoke('memory-task', { action: 'task', label: 'Synthetic task label' }, 'Work on the synthetic task');
  assert.ok(getCurrentTools(f.contexts[0].messages).some(tool => tool.name === 'cuckoo_memory'));
  assert.equal(task.kind, 'write-receipt');
  const text = '{"count":3}';
  f.replies.push({ text, tokens: 20200 }); await f.session.prompt('Write the synthetic artifact');
  const source = f.manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.content.some(part => part.type === 'text' && part.text === text));
  assert.ok(source);
  const artifact = await invoke('memory-snapshot', { action: 'snapshot', taskId: task.record.id, purpose: 'artifact', label: 'Synthetic artifact', selector: { entryId: source.id, part: 0, start: 0, end: text.length }, dependsOn: [] }, 'Capture that public artifact');
  assert.equal(artifact.kind, 'write-receipt'); assert.ok(!Object.hasOwn(artifact, 'text'));
  const checked = await invoke('memory-check', { action: 'check', taskId: task.record.id, artifactId: artifact.record.id, checkerId: 'json-syntax', evidenceIds: [] }, 'Check only its JSON syntax');
  assert.equal(checked.lifecycle, 'finished'); assert.equal(checked.outcome, 'pass');
  await f.session.reload();
  const inspected = await invoke('memory-inspect', { action: 'inspect', id: checked.start.id }, 'Read the historical check binding');
  assert.equal(inspected.recordKind, 'check-start');
  assert.deepEqual(inspected.artifact, { id: artifact.record.id, digest: textDigest(text) });
  assert.match(inspected.checker.scope, /syntax only/i);
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  const records = readMemory({ sessionId: reopened.getSessionId(), entries: reopened.getEntries(), branch: reopened.getBranch() }, 'branch');
  assert.deepEqual(records.map(item => item.record.kind), ['task', 'snapshot', 'check-start', 'check-result']);
  assert.equal(records[1].record.text, text);
  assert.equal(records[3].record.startId, checked.start.id);
  assert.equal(checkpoints(f.manager.getBranch()).length, 0);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi blocks memory writes during a checkpoint and resumes exactly once', { timeout: 20000 }, async t => {
  const f = await memoryFixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ content: [{ type: 'toolCall', id: 'blocked-memory', name: 'cuckoo_memory', arguments: { action: 'task', label: 'Forbidden checkpoint write' } }], tokens: 20100 }, { text: 'Original task finished', tokens: 20200 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const result = f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'blocked-memory').message;
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /Tool execution is not permitted during a Cuckoo checkpoint/);
  assert.equal(f.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === 'cuckoo.memory').length, 0);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.equal(checkpoints(f.manager.getBranch())[0].report, null);
  assert.equal(f.contexts.length, 3); assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi busy manual request captures the checkpoint, not the ongoing response', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  let request;
  f.onRequest(n => { if (n === 1) request = f.session.prompt('/cuckoo inquire now'); });
  f.replies.push({ text: 'Original task response', tokens: 20000 }, { text: report, tokens: 20100 });
  await f.session.prompt('Work'); await request; await f.session.waitForIdle();
  assert.equal(f.contexts.length, 2);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.equal(checkpoints(f.manager.getBranch())[0].raw, report);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi standing questions are stored in a durable file, asked, validated, recalled and dropped again', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.session.prompt('/cuckoo questions add What did you verify since the last checkpoint?');
  const store = new FileQuestionStore(join(f.dir, 'cuckoo-questions.json'));
  const [question] = store.read();
  assert.equal(question.question, 'What did you verify since the last checkpoint?');
  assert.deepEqual(JSON.parse(readFileSync(store.path, 'utf8')), { version: 1, questions: [question] });
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  const answered = JSON.stringify({ ...JSON.parse(report), answers: [{ id: question.id, answer: 'Only the decoder tests ran.' }] });
  f.replies.push({ text: answered, tokens: 20100 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const inquiry = JSON.stringify(f.contexts.at(-1).messages.at(-1));
  assert.match(inquiry, /Restate me your objectives/); assert.match(inquiry, /What did you verify since the last checkpoint\?/);
  assert.ok(inquiry.includes(question.id));
  const saved = checkpoints(f.manager.getBranch())[0];
  assert.equal(saved.version, 6); assert.equal(saved.error, null);
  assert.deepEqual(saved.report.answers, [{ id: question.id, question: question.question, scope: 'global', answer: 'Only the decoder tests ran.' }]);
  // A reloaded extension instance and a reopened session file observe the same question and answer.
  await f.session.reload();
  await f.session.prompt('/cuckoo questions');
  assert.match(f.notifications.at(-1)[0], new RegExp(`${question.id} \\(global\\): What did you verify since the last checkpoint\\?`));
  await f.session.prompt('/cuckoo status');
  assert.match(f.notifications.at(-1)[0], /Standing questions: 1 asked at every checkpoint/);
  assert.match(f.notifications.at(-1)[0], /Q1\. What did you verify since the last checkpoint\? \(global, .*\)\n   Answer: Only the decoder tests ran\./);
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  assert.deepEqual(checkpoints(reopened.getBranch())[0].report.answers, saved.report.answers);
  const entry = f.manager.getEntries().find(item => item.type === 'custom' && item.customType === 'cuckoo.report');
  f.replies.push({ content: [{ type: 'toolCall', id: 'recall-answers', name: 'cuckoo_recall', arguments: { action: 'read', entryId: entry.id } }], tokens: 20200 }, { text: 'Read', tokens: 20300 });
  await f.session.prompt('Recall the answers');
  const read = f.manager.getEntries().find(item => item.type === 'message' && item.message.role === 'toolResult' && item.message.toolCallId === 'recall-answers').message;
  assert.equal(read.isError, false);
  assert.equal(JSON.parse(read.details.text).report.answers[0].answer, 'Only the decoder tests ran.');
  assert.equal(JSON.parse(read.details.text).questions[0].question, question.question);
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /standing questions configured by the user/);
  // Removed questions are no longer asked: the next inquiry is the base one and its report carries no answers.
  await f.session.prompt(`/cuckoo questions remove ${question.id}`);
  assert.deepEqual(store.read(), []);
  f.replies.push({ text: report, tokens: 20400 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  assert.doesNotMatch(JSON.stringify(f.contexts.at(-1).messages.at(-1)), /Standing questions as JSON/);
  assert.equal(checkpoints(f.manager.getBranch())[1].version, 6); assert.equal(checkpoints(f.manager.getBranch())[1].report.answers, null);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi report comments made while idle are kept in the session file and the model responds to them at once, exactly once', { timeout: 20000 }, async t => {
  const f = await terminalFixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const requestId = checkpoints(f.manager.getBranch())[0].requestId;
  const calls = f.contexts.length;
  f.replies.push({ text: 'Understood: I will run the full suite first.', tokens: 20150 });
  // Two rules precede the objective in this report: the third node is the objective.
  await commentInPanel(f, 3, 'Run the full suite before claiming progress.');
  await until(() => f.contexts.length === calls + 1, 'the response to the comments'); await settled(f);
  assert.equal(f.contexts.length, calls + 1, 'closing the panel while idle starts exactly one model request');
  const responding = f.contexts.at(-1).messages;
  assert.match(JSON.stringify(responding.at(-1)), /expects a response now/, 'the request ends with the instruction to respond');
  assert.match(JSON.stringify(responding.at(-2)), /User comment: Run the full suite before claiming progress\./, 'directly after the comments');
  assert.doesNotMatch(JSON.stringify(responding.slice(-2)), /JSON only/);
  assert.deepEqual(customTypes(f).slice(-2), [COMMENTS_TYPE, COMMENT_RESPONSE_TYPE]);
  const reply = f.manager.getBranch().at(-1);
  assert.equal(reply.type, 'message'); assert.equal(reply.message.role, 'assistant');
  assert.match(JSON.stringify(reply.message.content), /I will run the full suite first/, 'the reply is an ordinary response');
  assert.equal(checkpoints(f.manager.getBranch()).length, 1, 'the reply is not captured as a checkpoint');
  const comments = savedComments(f.manager.getBranch());
  assert.deepEqual(comments.map(item => [item.requestId, item.target, item.subject, item.text]), [[requestId, { kind: 'objective', index: 0 }, 'Objective AO1: Ship Cuckoo', 'Run the full suite before claiming progress.']]);
  const deliveries = () => f.manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  assert.equal(deliveries().length, 1); assert.deepEqual(deliveries()[0].details.commentIds, [comments[0].commentId]);
  assert.ok(f.notifications.some(args => /1 comment saved to checkpoint history; the model is responding to them/.test(args[0])));
  f.replies.push({ text: 'Acknowledged', tokens: 20200 }); await f.session.prompt('Continue the task');
  const request = JSON.stringify(f.contexts.at(-1).messages);
  assert.match(request, /On Objective AO1: Ship Cuckoo\\n   User comment: Run the full suite before claiming progress\./);
  assert.ok(request.indexOf('User comment: Run the full suite') < request.indexOf('Continue the task'), 'the comment precedes the next prompt');
  const reopened = sdk.SessionManager.open(f.manager.getSessionFile());
  assert.deepEqual(savedComments(reopened.getEntries()), comments);
  assert.deepEqual(undeliveredComments(reopened.getBranch()), []);
  assert.match(historyText(reopened.getEntries(), reopened.getBranch()), /ETA: Unknown: validation pending\n   Comment \(.*Z\): Run the full suite before claiming progress\./);
  assert.match(readFileSync(f.manager.getSessionFile(), 'utf8'), /"customType":"cuckoo\.comment"/);
  await f.session.reload();
  f.replies.push({ text: 'Still acknowledged', tokens: 20300 }); await f.session.prompt('And more');
  assert.equal(JSON.stringify(f.contexts.at(-1).messages).split('User comment: Run the full suite').length - 1, 1, 'reload does not deliver the comment again');
  assert.equal(deliveries().length, 1);
  assert.equal(customTypes(f).filter(type => type === COMMENT_RESPONSE_TYPE).length, 1, 'and does not ask for a response again');
  assert.equal(f.contexts.length, calls + 3, 'one request each: the response to the comments and the two prompts');
  assert.equal(f.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === COMMENT_TYPE).length, 1);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi report comments made during a run reach the model at the next turn boundary of that run', { timeout: 20000 }, async t => {
  const f = await terminalFixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.replies.push({ content: [{ type: 'toolCall', id: 'held-tool', name: 'bash', arguments: { command: 'printf held' } }], tokens: 20200, gate }, { text: 'Finished after the comment', tokens: 20300 });
  const running = f.session.prompt('Do tool work');
  await until(() => f.contexts.length === 3, 'the held provider request');
  // First node of this report: the user rule.
  await commentInPanel(f, 1, 'I meant mockups for the settings dialog only.');
  const deliveries = () => f.manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  assert.equal(savedComments(f.manager.getBranch()).length, 1, 'the comment is in history before the run continues');
  assert.equal(deliveries().length, 0, 'nothing is inserted into a response that is still streaming');
  assert.ok(f.notifications.some(args => /the model receives them at its next completed turn/.test(args[0])));
  release(); await running;
  assert.equal(f.contexts.length, 4);
  assert.match(JSON.stringify(f.contexts[3].messages), /On Rule AR1 \(user\): Show mockups before implementing \(scope: This UI change\)\\n   User comment: I meant mockups for the settings dialog only\./);
  const branch = f.manager.getBranch();
  const toolResult = branch.findIndex(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'held-tool');
  const delivery = branch.findIndex(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  const final = branch.findLastIndex(entry => entry.type === 'message' && entry.message.role === 'assistant');
  assert.ok(toolResult >= 0 && toolResult < delivery && delivery < final, 'tool call, its result, the comments, then the next response');
  assert.equal(deliveries().length, 1); assert.deepEqual(undeliveredComments(branch), []);
  await settled(f);
  assert.equal(f.contexts.length, 4, 'a model that is already running is not asked for a separate response');
  assert.ok(!customTypes(f).includes(COMMENT_RESPONSE_TYPE));
  assert.equal(checkpoints(branch).length, 1, 'a comment is not captured as a checkpoint');
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi keeps a comment made during an aborted response and delivers it once the run has settled', { timeout: 20000 }, async t => {
  const f = await terminalFixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  f.replies.push({ text: 'Partial respon', tokens: 20200, wait: true });
  const running = f.session.prompt('Long task');
  await until(() => f.contexts.length === 3, 'the held provider request');
  await commentInPanel(f, 3, 'Stop and rerun the suite.');
  const deliveries = () => f.manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  assert.equal(deliveries().length, 0);
  await f.session.abort(); await running;
  assert.equal(deliveries().length, 1, 'an aborted turn is not a delivery point, but the settled session is');
  const branch = f.manager.getBranch();
  const aborted = branch.findLastIndex(entry => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.stopReason === 'aborted');
  assert.ok(aborted >= 0 && aborted < branch.indexOf(deliveries()[0]), 'the delivery follows the aborted response');
  await settled(f);
  assert.equal(f.contexts.length, 3, 'delivery after an abort starts no request');
  assert.ok(!customTypes(f).includes(COMMENT_RESPONSE_TYPE));
  f.replies.push({ text: 'Resumed', tokens: 20300 }); await f.session.prompt('Go on');
  assert.equal(JSON.stringify(f.contexts.at(-1).messages).split('User comment: Stop and rerun the suite.').length - 1, 1);
  assert.equal(deliveries().length, 1); assert.equal(checkpoints(f.manager.getBranch()).length, 1);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi delivers a comment left undelivered by an earlier process with the first request of the next run, once', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const requestId = checkpoints(f.manager.getBranch())[0].requestId;
  // As left behind when Pi exits between a panel close and the end of the running turn: saved, never delivered.
  f.manager.appendCustomEntry(COMMENT_TYPE, commentRecord({ requestId, target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Ship Cuckoo', text: 'Left by the previous process.' }, 'left-over', '2026-11-17T21:00:00.000Z'));
  await f.session.reload();
  assert.equal(undeliveredComments(f.manager.getBranch()).length, 1, 'opening the session writes nothing');
  f.replies.push({ text: 'Seen', tokens: 20200 }); await f.session.prompt('Next task');
  const request = JSON.stringify(f.contexts.at(-1).messages);
  assert.match(request, /On Objective 1: Ship Cuckoo\\n   User comment: Left by the previous process\./);
  const deliveries = () => f.manager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === COMMENTS_TYPE);
  assert.equal(deliveries().length, 1); assert.deepEqual(deliveries()[0].details, { version: 1, commentIds: ['left-over'] });
  assert.deepEqual(undeliveredComments(f.manager.getBranch()), []);
  f.replies.push({ text: 'Seen again', tokens: 20300 }); await f.session.prompt('Another task');
  assert.equal(JSON.stringify(f.contexts.at(-1).messages).split('User comment: Left by the previous process.').length - 1, 1, 'the next run does not deliver it again');
  assert.equal(deliveries().length, 1);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});

test('real Pi closing the panel with i sends the comments and one checkpoint inquiry, not a second request to respond', { timeout: 20000 }, async t => {
  const f = await terminalFixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ text: report, tokens: 20100 }); await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const calls = f.contexts.length;
  f.replies.push({ text: report, tokens: 20200 });
  await commentInPanel(f, 3, 'Reflect this in the next report.', 'i');
  await until(() => f.contexts.length === calls + 1, 'the inquiry'); await settled(f);
  assert.equal(f.contexts.length, calls + 1);
  const request = f.contexts.at(-1).messages;
  assert.match(JSON.stringify(request.at(-1)), /Restate me your objectives/, 'the inquiry is the last message of the request');
  assert.match(JSON.stringify(request), /User comment: Reflect this in the next report\./);
  assert.doesNotMatch(JSON.stringify(request), /expects a response now/);
  assert.ok(!customTypes(f).includes(COMMENT_RESPONSE_TYPE));
  assert.equal(checkpoints(f.manager.getBranch()).length, 2); assert.equal(checkpoints(f.manager.getBranch())[1].error, null);
  assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
});
