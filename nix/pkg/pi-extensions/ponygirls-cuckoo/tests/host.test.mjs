import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { checkpoints, historyText } from '../src/report.ts';
import { INQUIRY_TYPE, STATE_TYPE, stateOnBranch } from '../src/state.ts';
import { readMemory, textDigest } from '../src/memory-core.ts';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function configuredFixture(t, enableMemory, loadDirectory) {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-host-')); const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const entry = process.env.PI_CUCKOO_EXTENSION === undefined ? resolve(import.meta.dirname, '../index.ts') : process.env.PI_CUCKOO_EXTENSION;
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    additionalExtensionPaths: [loadDirectory ? dirname(entry) : entry, ...(enableMemory ? [join(dirname(entry), 'audit-memory.ts')] : [])], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
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
      if (reply.wait) options.signal.addEventListener('abort', finish, { once: true }); else queueMicrotask(finish);
      return stream;
    } });
  const manager = sdk.SessionManager.create(dir, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModel('cuckoo-fixture', 'scripted'),
    thinkingLevel: 'off', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
  const errors = []; const notifications = [];
  await session.bindExtensions({ mode: 'rpc', onError: error => errors.push(error), uiContext: { notify: (...args) => notifications.push(args), setWidget() {} } });
  t.after(async () => { await session.abort(); session.dispose(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(dir, { recursive: true, force: true }); });
  return { dir, session, manager, contexts, replies, errors, notifications, onRequest: fn => { onRequest = fn; } };
}
function fixture(t) { return configuredFixture(t, false, false); }
function memoryFixture(t) { return configuredFixture(t, true, false); }

const report = '{"objectives":[{"objective":"Ship Cuckoo","progress":"Validating the runtime","issues":["A decoder defect needs correction","Waiting for access approval","Serial validation"],"eta":"Unknown: validation pending"}],"rules":[{"rule":"Show mockups before implementing","source":"user","scope":"This UI change"},{"rule":"Preserve cadence","source":"assistant","scope":"This change"}]}';

test('real Pi package-directory loading does not enable audit memory implicitly', { timeout: 20000 }, async t => {
  const f = await configuredFixture(t, false, true);
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
  assert.deepEqual(checkpoints(f.manager.getBranch())[0].report, JSON.parse(report));
  assert.ok(f.notifications.some(args => String(args[0]).includes('ETA: Unknown: validation pending')));
  f.replies.push({ text: 'Normal work', tokens: 24000 }); await f.session.prompt('Continue normally');
  assert.match(JSON.stringify(f.contexts.at(-1)), /checkpoint is closed/);
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
  assert.deepEqual(checkpoints(f.manager.getBranch())[0].report, JSON.parse(report));
  assert.equal(checkpoints(f.manager.getBranch())[0].version, 4);
  assert.equal(checkpoints(f.manager.getBranch())[0].report.objectives[0].issues.length, 3);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Restate me your objectives/);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  await f.session.reload(); await f.session.prompt('/cuckoo status');
  assert.match(f.notifications.at(-1)[0], /Cuckoo: OFF/);
  assert.match(f.notifications.at(-1)[0], /Validating the runtime/);
  assert.match(f.notifications.at(-1)[0], /user: Show mockups before implementing \(scope: This UI change\)/);
  assert.match(f.notifications.at(-1)[0], /assistant: Preserve cadence/);
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
  assert.deepEqual(JSON.parse(read.details.text).report, JSON.parse(report));
  assert.equal(JSON.parse(read.details.text).messageEntryId, saved.data.messageEntryId);
  assert.equal(JSON.parse(read.details.text).response.model, 'scripted');
  assert.match(getCurrentSystemPrompt(f.contexts.at(-1).messages), /Automatic inquiries at run start: OFF/);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Historical model self-reports/);
  assert.equal(checkpoints(f.manager.getBranch()).length, 1); assert.equal(f.contexts.length, 6); assert.equal(f.replies.length, 0); assert.deepEqual(f.errors, []);
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

test('real Pi still blocks recall during a JSON-only inquiry and resumes once without recursive reflection', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.replies.push({ text: 'Baseline', tokens: 20000 }); await f.session.prompt('Work');
  f.replies.push({ content: [{ type: 'toolCall', id: 'blocked-recall', name: 'cuckoo_recall', arguments: { action: 'list' } }], tokens: 20100 }, { text: 'Original task finished', tokens: 20200 });
  await f.session.prompt('/cuckoo inquire now'); await f.session.waitForIdle();
  const result = f.manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'blocked-recall').message;
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /JSON only/);
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
  assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /JSON only/);
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
