import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey } from '@earendil-works/pi-tui';
import { CuckooFeatures } from '../../src/feature-runtime.ts';
import { CuckooPreferences } from '../../src/preferences.ts';
import { CuckooTaskConsents } from '../../src/task-consent.ts';
import { NativeMemoryPort, nativeMemoryRuntime } from '../../src/memory-runtime.ts';
import { NativeTransferFiles } from '../../src/transfer-operator.ts';
import { appendMemory, makeTask, makeSnapshot, makeCorrection } from '../../src/memory-core.ts';

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { matches: (data, name) => matchesKey(data, name === 'tui.select.cancel' ? Key.escape : Key.enter) };
const usage = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export function taskNetworkFixture(t, services, registry, scopedModels) {
  const cwd = mkdtempSync(join(tmpdir(), 'cuckoo-task-network-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const manager = SessionManager.create(cwd, cwd); const tools = new Map(); const active = new Set(); const notices = []; const dialogs = [];
  let appendObserver = () => {}; let confirmation = true; let confirmHook = () => {}; const selections = [];
  const pi = { registerTool(tool) { tools.set(tool.name, tool); if (tool.defaultActive !== false) active.add(tool.name); },
    getActiveTools: () => [...active], setActiveTools(names) { active.clear(); for (const name of names) active.add(name); },
    appendEntry(type, data) { manager.appendCustomEntry(type, structuredClone(data)); appendObserver(type, data); } };
  const configuration = new CuckooPreferences(pi, { path: 'memory:network', read: () => ({ enabled: true, features: { evidence: true, reader: true, vectors: true, critic: true } }), write() { assert.fail('global write not expected'); } }, () => { throw new Error('untrusted project read'); });
  const features = new CuckooFeatures(pi, configuration, services.ids.nextId());
  const ctx = { cwd, sessionManager: manager, isProjectTrusted: () => false, mode: 'tui', hasUI: true, signal: undefined, modelRegistry: registry, scopedModels,
    ui: { notify: (...args) => notices.push(args),
      async select(_title, choices, options) { options.signal.throwIfAborted(); return choices[selections.length === 0 ? 0 : selections.shift()]; },
      custom(factory, options) { return new Promise(resolve => {
        const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
        component.render(100); dialogs.push({ kind: options.blocked.kind, body: JSON.parse(component.bodyScroll.render(100).join('')) });
        if (options.blocked.kind === 'permission') { confirmHook(); if (confirmation) component.handleInput('\x1b[C'); }
        component.handleInput('\r');
      }); },
    },
  };
  features.start(ctx); features.refresh(ctx);
  const native = new NativeMemoryPort(pi, manager), memory = nativeMemoryRuntime(), files = new NativeTransferFiles();
  const consents = new CuckooTaskConsents(pi, features, () => services.clock.civilNowMs(), () => services.ids.nextId(), value => files.projectId(value), () => services.clock.monotonicNowMs());
  function task(label) {
    manager.appendMessage({ role: 'user', content: `Synthetic work: ${label}`, timestamp: 1 });
    return appendMemory(native, makeTask(native.view(), label, memory)).record;
  }
  function snapshot(taskId, text, purpose) {
    const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'fixture-primary', model: 'fixture-primary', usage, stopReason: 'stop', timestamp: 2 });
    return appendMemory(native, makeSnapshot(native.view(), taskId, purpose, 'Synthetic public snapshot', { entryId, part: 0, start: 0, end: text.length }, [], memory)).record;
  }
  return { cwd, manager, pi, tools, active, configuration, features, consents, ctx, native, task, snapshot, notices, dialogs, selections,
    correct: (taskId, targetIds, evidenceIds) => appendMemory(native, makeCorrection(native.view(), { taskId, targetIds, replacementIds: [], evidenceIds, reason: 'Synthetic withdrawal' }, memory)),
    setEnabled: value => { configuration.apply(ctx, 'session', [{ field: 'enabled', value }], new AbortController().signal); features.refresh(ctx); },
    setFeature: (id, value) => { configuration.apply(ctx, 'session', [{ field: 'feature', id, value }], new AbortController().signal); features.refresh(ctx); },
    onAppend: fn => { appendObserver = fn; }, onConfirm: fn => { confirmHook = fn; }, confirm: value => { confirmation = value; },
    call: async (name, params, signal) => (await tools.get(name).execute('synthetic-call', params, signal, undefined, ctx)).details,
  };
}

export function nativeTestClock() {
  return { civilNowMs: () => Date.now(), monotonicNowMs: () => performance.now(), schedule(delay, callback) { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); } };
}

export function inertNetworkServices() {
  return { encoderProfiles: { path: 'memory:no-encoders', read: () => [] }, embeddingTransportPolicy: 'https',
    credential() { assert.fail('Unexpected credential resolution'); }, async fetch() { assert.fail('Unexpected network request'); },
    clock: nativeTestClock(), ids: { nextId: () => randomUUID() } };
}

export function boundary(continuing) {
  return { type: 'turn_end', turnIndex: 0, outcome: 'completed', continue: continuing, entries: [],
    message: { role: 'assistant', content: [{ type: 'text', text: 'Synthetic ordinary turn' }], api: 'openai-completions', provider: 'fixture-primary', model: 'fixture-primary', usage, stopReason: 'stop', timestamp: Date.now() },
    toolResults: [], context: { pendingMessages: [], canContinue: continuing } };
}
