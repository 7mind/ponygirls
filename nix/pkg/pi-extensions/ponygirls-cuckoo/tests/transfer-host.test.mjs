import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { NativeMemoryPort, nativeMemoryRuntime } from '../src/memory-runtime.ts';
import { appendMemory, makeTask, makeSnapshot, readMemory } from '../src/memory-core.ts';
import { Key, matchesKey } from '@earendil-works/pi-tui';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { matches: (value, name) => matchesKey(value, name === 'tui.select.cancel' ? Key.escape : Key.enter) };

// Specified Effectual-GoodCommunication: actual Pi loader, operator commands,
// native JSONL, owned files and model-tool loop. Scripted UI/provider are not
// evidence of human consent or model quality; no remote service is contacted.
test('real Pi exports and approves a packet across native sessions, then revokes model access', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-transfer-host-'));
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
  const sessions = []; const errors = []; const replies = []; const contexts = [];
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  t.after(async () => {
    for (const session of sessions) { await session.abort(); session.dispose(); }
    await runtime.settleCredentialWrites();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  runtime.registerProvider('cuckoo-transfer-fixture', {
    api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'scripted', name: 'Synthetic transfer loop', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      contexts.push(structuredClone(context)); const reply = replies.shift(); assert.ok(reply, 'unexpected provider request');
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const content = typeof reply === 'string' ? [{ type: 'text', text: reply }] : [reply];
        const stopReason = typeof reply === 'string' ? 'stop' : 'toolUse';
        const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: { ...zero, input: 20000, totalTokens: 20000 }, stopReason, timestamp: Date.now() };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: stopReason, message }); stream.end();
      });
      return stream;
    },
  });
  const entry = process.env.PI_CUCKOO_EXTENSION === undefined ? resolve(import.meta.dirname, '../index.ts') : process.env.PI_CUCKOO_EXTENSION;
  async function open() {
    const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
    const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, additionalExtensionPaths: [entry], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    const manager = sdk.SessionManager.create(dir, dir);
    const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModel('cuckoo-transfer-fixture', 'scripted'), thinkingLevel: 'off', settingsManager: settings, resourceLoader: loader, sessionManager: manager });
    sessions.push(session);
    const inputs = []; const confirmations = []; const notices = []; let previews = 0;
    await session.bindExtensions({ mode: 'tui', onError: error => errors.push(error), uiContext: {
      notify: (...args) => notices.push(args), setWidget() {},
      async input(title) { assert.ok(inputs.length > 0, title); return inputs.shift(); },
      async confirm(title) { assert.ok(confirmations.length > 0, title); return confirmations.shift(); },
      custom(factory, options) {
        return new Promise(resolve => {
          const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
          component.render(80);
          if (options.blocked.kind === 'permission') {
            assert.ok(confirmations.length > 0, options.blocked.message);
            if (confirmations.shift()) component.handleInput('\x1b[C');
          } else previews++;
          component.handleInput('\r');
        });
      },
    } });
    await session.prompt('/cuckoo on'); await session.prompt('/cuckoo feature transfer on');
    assert.ok(session.getActiveToolNames().includes('cuckoo_transfer'));
    return { session, manager, inputs, confirmations, notices, previews: () => previews };
  }
  const source = await open();
  const port = new NativeMemoryPort({ appendEntry: (type, data) => source.manager.appendCustomEntry(type, data) }, source.manager);
  const memoryRuntime = nativeMemoryRuntime();
  source.manager.appendMessage({ role: 'user', content: 'Synthetic original work', timestamp: 1 });
  const task = appendMemory(port, makeTask(port.view(), 'Original task', memoryRuntime));
  const text = 'Exact historical synthetic artifact 🐦';
  const native = source.manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'cuckoo-transfer-fixture', model: 'scripted', usage: zero, stopReason: 'stop', timestamp: 2 });
  const artifact = appendMemory(port, makeSnapshot(port.view(), task.record.id, 'artifact', 'Original artifact', { entryId: native, part: 0, start: 0, end: text.length }, [], memoryRuntime));
  const path = join(dir, 'approved-history.json');
  source.inputs.push(task.record.id, artifact.record.id, path); source.confirmations.push(true);
  await source.session.prompt('/cuckoo transfer export');
  assert.equal(source.previews(), 1);
  assert.match(readFileSync(path, 'utf8'), /Exact historical synthetic artifact/);

  const destination = await open();
  destination.inputs.push(path); destination.confirmations.push(true);
  await destination.session.prompt('/cuckoo transfer import');
  assert.equal(destination.previews(), 1);
  const call = async (id, args) => {
    replies.push({ type: 'toolCall', id, name: 'cuckoo_transfer', arguments: args }, 'Synthetic continuation finished');
    await destination.session.prompt('Inspect explicitly approved historical context');
    const record = destination.manager.getEntries().find(item => item.type === 'message' && item.message.role === 'toolResult' && item.message.toolCallId === id);
    assert.ok(record); return record.message;
  };
  const metadata = await call('packet-metadata', { action: 'metadata' });
  assert.equal(metadata.isError, false); assert.equal(metadata.details.packets.length, 1);
  assert.ok(getCurrentTools(contexts[0].messages).some(tool => tool.name === 'cuckoo_transfer'));
  const packetId = metadata.details.packets[0].packetId;
  const loaded = await call('packet-text', { action: 'text', packetId, recordId: artifact.record.id });
  assert.equal(loaded.isError, false); assert.equal(loaded.details.text, text);
  assert.equal(loaded.details.metadata.authority, 'none'); assert.equal(loaded.details.metadata.current, false);
  assert.equal(readMemory({ sessionId: destination.manager.getSessionId(), entries: destination.manager.getEntries(), branch: destination.manager.getBranch() }, 'branch').length, 0);
  const reopened = sdk.SessionManager.open(destination.manager.getSessionFile());
  assert.ok(reopened.getEntries().some(item => item.type === 'message' && item.message.role === 'toolResult' && item.message.toolCallId === 'packet-text'));

  await destination.session.prompt('/cuckoo transfer clear');
  const rejected = await call('packet-revoked', { action: 'list', packetId });
  assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), /No retained/);
  await destination.session.reload();
  const afterReload = await call('packet-after-reload', { action: 'metadata' });
  assert.equal(afterReload.isError, false); assert.deepEqual(afterReload.details.packets, []);
  assert.equal(replies.length, 0); assert.deepEqual(errors, []);
});
