import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, visibleWidth } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { CuckooPreferences } from '../src/preferences.ts';
import { CuckooFeatures } from '../src/feature-runtime.ts';
import { NativeMemoryPort, nativeMemoryRuntime } from '../src/memory-runtime.ts';
import { appendMemory, makeSnapshot, makeTask, readMemory } from '../src/memory-core.ts';
import { CuckooTransfer, TRANSFER_TOOL, TRANSFER_APPROVAL_MS } from '../src/transfer-runtime.ts';
import { NativeTransferFiles } from '../src/transfer-operator.ts';
import { previewOperatorText as previewTransfer, confirmOperatorAction as confirmTransfer, operatorDisplay as transferDisplay } from '../src/operator-ui.ts';
import { MAX_TRANSFER_MANIFEST_BYTES } from '../src/experiments/session-transfer.ts';

const TEXT = 'Controlled public artifact 🐦\n"quoted"\u0000\ud800';
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { matches: (data, action) => matchesKey(data, action === 'tui.select.cancel' ? Key.escape : Key.enter) };

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'cuckoo-transfer-runtime-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function dummyFiles() {
  const contents = new Map(); const actual = new NativeTransferFiles();
  return {
    projectId: cwd => actual.projectId(cwd),
    read(path, signal) {
      assert.ok(isAbsolute(path)); signal.throwIfAborted();
      if (!contents.has(path)) throw new Error('missing file');
      return contents.get(path);
    },
    writeExclusive(path, text, current) {
      assert.ok(isAbsolute(path)); current();
      if (contents.has(path)) throw new Error('file exists');
      if (Buffer.byteLength(text) > MAX_TRANSFER_MANIFEST_BYTES) throw new Error('too large');
      contents.set(path, text); current();
    },
  };
}

function fixture(cwd, files, sessionId) {
  const manager = SessionManager.inMemory(cwd, { id: sessionId });
  const tools = new Map(); const active = new Set();
  const pi = {
    registerTool(tool) { tools.set(tool.name, tool); if (tool.defaultActive !== false) active.add(tool.name); },
    getActiveTools: () => [...active],
    setActiveTools(names) { active.clear(); for (const name of names) active.add(name); },
    appendEntry(type, data) { manager.appendCustomEntry(type, structuredClone(data)); },
  };
  let defaults = { enabled: true, features: { transfer: true } };
  const store = { path: 'memory:global', read: () => structuredClone(defaults), write: value => { defaults = structuredClone(value); } };
  const preferences = new CuckooPreferences(pi, store, () => { throw new Error('untrusted project must not be read'); });
  const features = new CuckooFeatures(pi, preferences, 'owned-transfer-runtime-instance');
  let now = 1800000000000; let id = 0; const inputs = []; const confirmations = []; const choices = []; const previews = []; const notices = []; let previewAccepted = true;
  const ctx = { cwd, sessionManager: manager, isProjectTrusted: () => false, mode: 'tui', hasUI: true, signal: undefined,
    ui: {
      async input(title, placeholder, options) {
        options.signal.throwIfAborted(); assert.ok(inputs.length > 0, title);
        const next = inputs.shift(); return typeof next === 'function' ? await next({ title, placeholder, signal: options.signal }) : next;
      },
      async confirm(title, message, options) {
        options.signal.throwIfAborted(); assert.ok(confirmations.length > 0, title);
        const next = confirmations.shift(); return typeof next === 'function' ? await next({ title, message, signal: options.signal }) : next;
      },
      async select(title, options, settings) {
        settings.signal.throwIfAborted(); assert.ok(choices.length > 0, title);
        const choice = choices.shift(); return choice === undefined ? undefined : options[choice];
      },
      custom(factory, options) {
        return new Promise(resolve => {
          const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
          const rendered = renderLayoutFrame(component, 80, 20, () => {}).lines;
          for (const line of rendered) assert.ok(visibleWidth(line) <= 80);
          assert.ok(rendered.length <= 20); assert.equal(options.retainEditorBorders, true);
          if (options.blocked.kind === 'permission') {
            assert.ok(confirmations.length > 0, options.blocked.message);
            const next = confirmations.shift();
            const accepted = typeof next === 'function' ? next({ title: options.blocked.message }) : next;
            assert.equal(typeof accepted, 'boolean');
            if (accepted) component.handleInput('\x1b[C');
            component.handleInput('\r');
          } else {
            previews.push(rendered);
            component.handleInput(previewAccepted ? '\r' : '\x1b');
          }
        });
      },
      notify: (...args) => notices.push(args),
    },
  };
  const transfer = new CuckooTransfer(features, { files, clock: { nowMs: () => now, newId: () => `operator-${sessionId.slice(0, 20)}-${++id}` } });
  features.start(ctx); features.refresh(ctx);
  const native = new NativeMemoryPort(pi, manager);
  const memoryRuntime = nativeMemoryRuntime();
  function seed() {
    manager.appendMessage({ role: 'user', content: 'Synthetic source task', timestamp: 1 });
    const task = appendMemory(native, makeTask(native.view(), 'Source task', memoryRuntime));
    const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: TEXT }], timestamp: 2 });
    const artifact = appendMemory(native, makeSnapshot(native.view(), task.record.id, 'artifact', 'Source artifact', { entryId, part: 0, start: 0, end: TEXT.length }, [], memoryRuntime));
    return { taskId: task.record.id, artifactId: artifact.record.id };
  }
  return { manager, ctx, features, preferences, native, transfer, tools, inputs, confirmations, choices, previews, notices, seed,
    call: async args => (await tools.get(TRANSFER_TOOL).execute('read-packet', args, undefined, undefined, ctx)).details,
    command: args => transfer.command(args, ctx),
    advance: delta => { now += delta; },
    setPreviewAccepted: value => { previewAccepted = value; },
    enabled: value => { preferences.apply(ctx, 'session', [{ field: 'enabled', value }], new AbortController().signal); features.refresh(ctx); },
  };
}

async function exported(source, path) {
  const selected = source.seed();
  source.inputs.push(selected.taskId, selected.artifactId, path); source.confirmations.push(true);
  await source.command('export');
  assert.equal(source.previews.length, 1);
  return selected;
}
async function approved(destination, path) {
  destination.inputs.push(path); destination.confirmations.push(true);
  await destination.command('import');
  const result = await destination.call({ action: 'metadata' });
  assert.equal(result.packets.length, 1);
  return result.packets[0].packetId;
}

// Specified BG contract shared by an in-memory file adapter and real owned files.
for (const storage of ['dummy', 'native']) {
  test(`${storage}: explicit export/preview/approval permits scoped historical reads only`, async t => {
    const cwd = directory(t); const files = storage === 'native' ? new NativeTransferFiles() : dummyFiles();
    const source = fixture(cwd, files, `source-${storage}`), destination = fixture(cwd, files, `destination-${storage}`);
    const path = join(cwd, 'packet.json'); const selected = await exported(source, path);
    const packetId = await approved(destination, path);
    assert.match(destination.notices.at(-1)[0], /Approved historical packet/);
    assert.equal(readMemory(destination.native.view(), 'branch').length, 0);
    destination.manager.appendMessage({ role: 'user', content: 'Ordinary later source message', timestamp: 5 });
    const result = await destination.call({ action: 'list', packetId });
    assert.equal(result.records.length, 2); assert.match(result.notice, /not current|not.*current/);
    assert.ok(result.records.every(record => record.state === 'historical-external' && record.authority === 'none'));
    const inspected = await destination.call({ action: 'inspect', packetId, recordId: selected.artifactId });
    assert.equal(inspected.body.textOmitted, true);
    const text = await destination.call({ action: 'text', packetId, recordId: selected.artifactId });
    assert.equal(text.text, TEXT);
    const before = source.notices.length;
    source.inputs.push(selected.taskId, selected.artifactId, path); source.confirmations.push(true);
    await assert.rejects(source.command('export'), /may exist or be incomplete/);
    assert.equal(source.notices.length, before);
    await destination.command('clear');
    await assert.rejects(destination.call({ action: 'list', packetId }), /No retained/);
    assert.equal((await destination.call({ action: 'metadata' })).packets.length, 0);
    if (storage === 'native') {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(readFileSync(path, 'utf8'), files.read(path, new AbortController().signal));
    }
  });

  test(`${storage}: cancellation or refusal creates neither approval nor import`, async t => {
    const cwd = directory(t); const files = storage === 'native' ? new NativeTransferFiles() : dummyFiles();
    const source = fixture(cwd, files, `cancel-source-${storage}`), destination = fixture(cwd, files, `cancel-destination-${storage}`);
    const path = join(cwd, 'packet.json'); await exported(source, path);
    destination.inputs.push(path); destination.setPreviewAccepted(false);
    await destination.command('import'); assert.equal(destination.confirmations.length, 0);
    assert.equal((await destination.call({ action: 'metadata' })).packets.length, 0);
    destination.setPreviewAccepted(true); destination.inputs.push(path); destination.confirmations.push(false);
    await destination.command('import'); assert.equal((await destination.call({ action: 'metadata' })).packets.length, 0);
    assert.equal(readMemory(destination.native.view(), 'branch').length, 0);
  });
}

test('disable/re-enable, navigation and expiry remove authority without resurrection', async t => {
  const cwd = directory(t); const files = new NativeTransferFiles();
  const source = fixture(cwd, files, 'revocation-source'), destination = fixture(cwd, files, 'revocation-destination');
  const path = join(cwd, 'packet.json'); await exported(source, path);
  for (const invalidate of [() => { destination.enabled(false); destination.enabled(true); }, () => destination.features.navigate(destination.ctx), () => destination.advance(TRANSFER_APPROVAL_MS)]) {
    const packetId = await approved(destination, path); invalidate();
    assert.equal((await destination.call({ action: 'metadata' })).packets.length, 0);
    await assert.rejects(destination.call({ action: 'list', packetId }), /No retained/);
  }
});

test('scope changes while approval is open reject rather than authorizing a replacement scope', async t => {
  const cwd = directory(t); const files = new NativeTransferFiles();
  const source = fixture(cwd, files, 'race-source'), destination = fixture(cwd, files, 'race-destination');
  const path = join(cwd, 'packet.json'); await exported(source, path);
  destination.inputs.push(path); destination.confirmations.push(() => { destination.features.navigate(destination.ctx); return true; });
  await assert.rejects(destination.command('import'), /scope changed|cancelled/);
  assert.equal((await destination.call({ action: 'metadata' })).packets.length, 0);
  assert.equal(readMemory(destination.native.view(), 'branch').length, 0);
});

test('long supported session IDs do not overflow the destination branch identity', async t => {
  const cwd = directory(t); const files = new NativeTransferFiles();
  const source = fixture(cwd, files, 'long-source'), destination = fixture(cwd, files, 'd'.repeat(128));
  const path = join(cwd, 'packet.json'); await exported(source, path);
  await approved(destination, path);
});

test('export confirmation after a scope change cannot create the selected file', async t => {
  const cwd = directory(t); const f = fixture(cwd, new NativeTransferFiles(), 'export-race');
  const selected = f.seed(); const path = join(cwd, 'not-created.json');
  f.inputs.push(selected.taskId, selected.artifactId, path);
  f.confirmations.push(() => { f.features.navigate(f.ctx); return true; });
  await assert.rejects(f.command('export'), /scope changed|cancelled/);
  assert.equal(existsSync(path), false);
});

test('model arguments cannot supply paths, packets, approvals or destination identity', async t => {
  const cwd = directory(t); const f = fixture(cwd, new NativeTransferFiles(), 'boundary-session');
  for (const args of [
    { action: 'approve' }, { action: 'metadata', path: '/not-read' },
    { action: 'metadata', manifestJson: '{}' }, { action: 'metadata', approved: true },
    { action: 'metadata', destination: {} }, { action: 'list', packetId: 'missing', recordId: 'irrelevant' },
  ]) await assert.rejects(f.call(args));
  f.ctx.mode = 'rpc'; await assert.rejects(f.command('import'), /interactive TUI/);
  assert.equal(f.inputs.length, 0); assert.equal(f.previews.length, 0);
});

test('native file boundary rejects symlinks, malformed UTF-8, oversize and relative paths', t => {
  const cwd = directory(t); const files = new NativeTransferFiles(); const signal = new AbortController().signal;
  const path = join(cwd, 'input'); writeFileSync(path, 'value');
  const link = join(cwd, 'alias'); symlinkSync(path, link);
  assert.throws(() => files.read(link, signal));
  assert.throws(() => files.read('relative', signal), /absolute/);
  writeFileSync(path, Buffer.from([0xff])); assert.throws(() => files.read(path, signal));
  writeFileSync(path, 'x'.repeat(MAX_TRANSFER_MANIFEST_BYTES + 1)); assert.throws(() => files.read(path, signal), /byte bound/);
  assert.throws(() => files.read(cwd, signal), /regular/);
  const aborted = new AbortController(); aborted.abort(); assert.throws(() => files.read(path, aborted.signal), /cancelled/);
});

test('all scrolled preview content reconstructs exact escaped text, including long space runs', async () => {
  const text = ('a' + ' '.repeat(100) + 'b').repeat(12);
  let completed;
  const ctx = { mode: 'tui', hasUI: true, ui: { custom(factory) {
    const component = factory({ terminal: { rows: 10 }, requestRender() {} }, theme, keys, value => { completed = value; });
    const collected = new Map(); const total = Math.ceil(transferDisplay(text).length / 40);
    for (let page = 0; page < 400; page++) {
      renderLayoutFrame(component, 40, 10, () => {});
      const rendered = renderLayoutFrame(component, 40, 10, () => {}).lines;
      const begin = component.bodyScroll.scrollTop + 1;
      const body = rendered.slice(2, 2 + component.bodyScroll.viewportHeight);
      for (let i = 0; i < body.length; i++) collected.set(begin + i, body[i]);
      if (begin + body.length - 1 === total) break;
      component.handleInput('\x04');
    }
    assert.equal(collected.size, total);
    assert.equal([...collected].sort((a, b) => a[0] - b[0]).map(item => item[1]).join(''), transferDisplay(text));
    component.handleInput('\x1b'); return Promise.resolve(completed);
  } } };
  assert.equal(await previewTransfer(ctx, 'Exact whitespace preview', text, new AbortController().signal), false);
});

test('approval is bounded with fixed title/controls and defaults to Cancel', async () => {
  const details = 'Exact destination and digest ' + 'x'.repeat(5000); const frames = [];
  let chooseApproval = false;
  const ctx = { mode: 'tui', hasUI: true, ui: { custom(factory, options) {
    return new Promise(resolve => {
      assert.equal(options.blocked.kind, 'permission');
      const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
      renderLayoutFrame(component, 80, 14, () => {});
      const frame = renderLayoutFrame(component, 80, 14, () => {}).lines; frames.push(frame);
      assert.equal(frame.length, 14); assert.match(frame[0], /Approve exact packet/);
      assert.ok(frame.some(line => line.includes('[Cancel]')));
      assert.ok(frame.some(line => line.includes('confirm choice')));
      component.handleInput('\x1b[F');
      assert.ok(renderLayoutFrame(component, 80, 14, () => {}).lines[0].includes('Approve exact packet'));
      if (chooseApproval) component.handleInput('\x1b[C');
      component.handleInput('\r');
    });
  } } };
  assert.equal(await confirmTransfer(ctx, 'Approve exact packet', details, new AbortController().signal), false);
  chooseApproval = true;
  assert.equal(await confirmTransfer(ctx, 'Approve exact packet', details, new AbortController().signal), true);
  assert.equal(frames.length, 2);
});

test('preview accepts the configured confirm key instead of assuming a carriage return', async () => {
  let accepted;
  const customKeys = { matches: (data, action) => action === 'tui.select.confirm' && data === 'fixture-confirm' };
  const ctx = { mode: 'tui', hasUI: true, ui: { custom(factory) {
    const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, customKeys, value => { accepted = value; });
    component.render(80); component.handleInput('fixture-confirm');
    assert.equal(accepted, true);
    return Promise.resolve(accepted);
  } } };
  assert.equal(await previewTransfer(ctx, 'Preview', TEXT, new AbortController().signal), true);
});

test('preview preserves every UTF-16 code unit as reversible printable ASCII and grants nothing', async () => {
  assert.equal(JSON.parse(transferDisplay(TEXT)), TEXT); assert.match(transferDisplay(TEXT), /^[\x21-\x7e]+$/);
  let component;
  const ctx = { mode: 'tui', hasUI: true, ui: { custom(factory) {
    return new Promise(resolve => {
      component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
      const lines = component.render(40);
      assert.ok(lines.every(line => visibleWidth(line) <= 40));
      component.handleInput('\x1b');
    });
  } } };
  assert.equal(await previewTransfer(ctx, 'Immutable preview', TEXT, new AbortController().signal), false);
});
