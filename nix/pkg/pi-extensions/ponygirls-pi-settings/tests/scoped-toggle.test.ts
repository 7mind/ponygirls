import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { FileTogglePreferenceStore, validateToggleOverrides, type ToggleOverrides, type ToggleOverrideStore } from '../src/toggle.ts';
import { FileProjectTogglePreferenceStore, SharedScopedToggleConfiguration, parseScopedToggleCommand } from '../src/scoped-toggle.ts';

class MemoryStore implements ToggleOverrideStore {
  readonly path: string;
  value: ToggleOverrides = {};
  constructor(path: string) { this.path = path; }
  readOverrides(): ToggleOverrides { return structuredClone(this.value); }
  writeOverrides(value: ToggleOverrides): void { this.value = validateToggleOverrides(value); }
}

for (const backend of ['memory', 'filesystem']) {
  test(`${backend}: per-scope precedence and reset preserve session isolation`, t => {
    const root = mkdtempSync(join(tmpdir(), 'shared-toggle-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const global = backend === 'memory' ? new MemoryStore(join(root, 'global.json')) : new FileTogglePreferenceStore(join(root, 'global.json'), true);
    const project = backend === 'memory' ? new MemoryStore(join(root, '.pi', 'toggle.json')) : new FileProjectTogglePreferenceStore(join(root, '.pi', 'toggle.json'));
    const manager = SessionManager.inMemory(); const ctx = { cwd: root, isProjectTrusted: () => true, sessionManager: manager };
    const pi = { appendEntry: <T>(type: string, data?: T) => { manager.appendCustomEntry(type, data); } };
    const settings = new SharedScopedToggleConfiguration(pi, { defaultEnabled: true, filename: 'toggle.json', projectDirectory: '.pi', customType: 'fixture.enabled', global, projectStore: path => { assert.equal(path, project.path); return project; } });
    const signal = new AbortController().signal;
    assert.deepEqual(settings.read(ctx).sources, { enabled: 'default' });
    settings.apply(ctx, 'global', false, signal); assert.equal(settings.read(ctx).values.enabled, false);
    settings.apply(ctx, 'project', true, signal); assert.equal(settings.read(ctx).sources.enabled, 'project');
    settings.apply(ctx, 'session', false, signal); assert.equal(settings.read(ctx).sources.enabled, 'session');
    settings.apply(ctx, 'session', null, signal); assert.equal(settings.read(ctx).values.enabled, true);
    settings.apply(ctx, 'project', null, signal); assert.equal(settings.read(ctx).values.enabled, false);
    settings.apply(ctx, 'global', null, signal); assert.equal(settings.read(ctx).sources.enabled, 'default');
    assert.deepEqual(global.readOverrides(), {}); assert.deepEqual(project.readOverrides(), {});
    manager.appendCustomEntry('fixture.enabled', { version: 1, sessionId: 'foreign', enabled: false });
    assert.equal(settings.read(ctx).values.enabled, true);
  });
}

test('untrusted project is never read; unknown trust, read errors, cancellation and target replacement fail closed', () => {
  const manager = SessionManager.inMemory(); let trusted = false; let reads = 0; let writes = 0;
  const global = new MemoryStore('global'); const abort = new AbortController();
  const ctx = { cwd: '/fixture', isProjectTrusted: () => trusted, sessionManager: manager };
  const project: ToggleOverrideStore = { path: '/fixture/.pi/config.json', readOverrides() { reads++; return {}; }, writeOverrides() { writes++; } };
  const settings = new SharedScopedToggleConfiguration({ appendEntry() { assert.fail('unexpected append'); } }, { defaultEnabled: true, filename: 'config.json', projectDirectory: '.pi', customType: 'fixture.enabled', global, projectStore: () => project });
  assert.equal(settings.read(ctx).values.enabled, true); assert.equal(reads, 0);
  assert.throws(() => settings.apply(ctx, 'project', true, abort.signal), /trusted/);
  trusted = true; project.readOverrides = () => { abort.abort(); return {}; };
  assert.throws(() => settings.apply(ctx, 'project', true, abort.signal)); assert.equal(writes, 0);
  const fresh = new AbortController(); project.readOverrides = () => { trusted = false; return {}; };
  assert.throws(() => settings.apply(ctx, 'project', true, fresh.signal), /trusted/); assert.equal(writes, 0);
  ctx.isProjectTrusted = () => { throw new Error('trust unknown'); };
  assert.throws(() => settings.read(ctx), /trust unknown/);
});

test('legacy global schema remains strict and unchanged while new sparse writes can inherit', t => {
  const root = mkdtempSync(join(tmpdir(), 'shared-toggle-file-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'toggle.json'); const store = new FileTogglePreferenceStore(path, true);
  writeFileSync(path, '{"version":1,"enabled":false}\n'); assert.deepEqual(store.read(), { enabled: false });
  assert.equal(readFileSync(path, 'utf8'), '{"version":1,"enabled":false}\n');
  store.writeOverrides({}); assert.deepEqual(store.readOverrides(), {}); assert.deepEqual(store.read(), { enabled: true });
  store.write({ enabled: false }); assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 1, enabled: false });
  writeFileSync(path, '{"version":1}'); assert.throws(() => store.read());
  writeFileSync(path, '{"version":3,"enabled":false}'); assert.throws(() => store.readOverrides());
});

test('explicit scope parser leaves unscoped legacy policy to each extension', () => {
  assert.deepEqual(parseScopedToggleCommand('project off'), { scope: 'project', enabled: false });
  assert.deepEqual(parseScopedToggleCommand('SESSION INHERIT'), { scope: 'session', enabled: null });
  for (const text of ['on', 'off', 'inherit', 'global', 'default on', 'session on extra', 'project yes']) assert.equal(parseScopedToggleCommand(text), null);
});
