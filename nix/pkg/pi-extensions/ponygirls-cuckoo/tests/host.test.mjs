import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { checkpoints, historyText } from '../src/report.ts';
import { INQUIRY_TYPE, STATE_TYPE, stateOnBranch } from '../src/state.ts';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-host-')); const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    additionalExtensionPaths: [process.env.PI_CUCKOO_EXTENSION === undefined ? resolve(import.meta.dirname, '../index.ts') : process.env.PI_CUCKOO_EXTENSION], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
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
    thinkingLevel: 'off', settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: ['bash'] });
  const errors = []; const notifications = [];
  await session.bindExtensions({ mode: 'rpc', onError: error => errors.push(error), uiContext: { notify: (...args) => notifications.push(args), setWidget() {} } });
  t.after(async () => { await session.abort(); session.dispose(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(dir, { recursive: true, force: true }); });
  return { dir, session, manager, contexts, replies, errors, notifications, onRequest: fn => { onRequest = fn; } };
}
const report = '{"objectives":[{"objective":"Ship Cuckoo","progress":"Validating the runtime","obstacles":"None known","issues":"None known","bottlenecks":"Serial validation","eta":"Unknown: validation pending"}]}';

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
  assert.match(JSON.stringify(f.contexts.at(-1)), /Restate me your objectives/);
  assert.equal(stateOnBranch(f.manager.getBranch()).pending, null);
  await f.session.reload(); await f.session.prompt('/cuckoo status');
  assert.match(f.notifications.at(-1)[0], /Cuckoo: OFF/);
  assert.match(f.notifications.at(-1)[0], /Validating the runtime/);
  assert.deepEqual(f.errors, []);
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
