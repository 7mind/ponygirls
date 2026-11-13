import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopedSettingsController, scopedBooleanField, applyScopedSettingsChanges, resolveScopedSetting, type ScopedSettingFields, type ScopedSettingsSnapshot, type ScopedSettingsScope, type ScopedSettingChange, type ScopedSettingEditResult } from '../src/scoped-settings.ts';

type Values = { enabled: boolean; model: string | null; pair: { low: number; high: number } };
function fixture() {
  let snapshot: ScopedSettingsSnapshot<Values> = {
    defaults: { enabled: false, model: null, pair: { low: 0.5, high: 0.7 } }, managed: { model: 'managed' }, global: {}, project: {}, session: {},
    projectTrusted: true, targets: { global: '/global', project: '/project', session: 'session-one' },
  };
  let writes = 0; let failWrite = false;
  let edit: (signal: AbortSignal) => Promise<ScopedSettingEditResult<string | null>> = async () => ({ kind: 'cancel' });
  const fields: ScopedSettingFields<Values> = {
    enabled: scopedBooleanField('Enabled', 'Operational preference, not approval.'),
    model: { kind: 'value', label: 'Model', description: 'Nullable value distinct from inheritance.',
      decode(value) { if (value !== null && typeof value !== 'string') throw new Error('Invalid model'); return value; },
      equals: (a, b) => a === b, format: value => value === null ? 'unconfigured' : value,
    edit: request => edit(request.signal) },
    pair: { kind: 'value', label: 'Pair', description: 'Atomic pair.',
      decode(value) {
        if (typeof value !== 'object' || value === null || !('low' in value) || !('high' in value) || typeof value.low !== 'number' || typeof value.high !== 'number' || value.low >= value.high) throw new Error('Invalid pair');
        return { low: value.low, high: value.high };
      }, equals: (a, b) => a.low === b.low && a.high === b.high, format: value => `${value.low}/${value.high}`,
    edit: async () => ({ kind: 'cancel' }) },
  };
  const order = ['enabled', 'model', 'pair'] as const;
  const apply = (scope: ScopedSettingsScope, changes: readonly ScopedSettingChange<Values>[], signal: AbortSignal): void => {
    signal.throwIfAborted(); if (failWrite) throw new Error('write failed'); writes++;
    snapshot = { ...snapshot, [scope]: applyScopedSettingsChanges(fields, order, snapshot[scope], changes) };
  };
  const controller = new ScopedSettingsController<Values>({ fields, order, inactive: (_key, values) => values.enabled ? '' : 'master off', adapter: { read: () => snapshot, apply, applied() {} } });
  return { controller, fields, order, read: () => snapshot, set: (value: ScopedSettingsSnapshot<Values>) => { snapshot = value; }, writes: () => writes,
    failWrite: () => { failWrite = true; }, editor: (value: typeof edit) => { edit = value; } };
}
async function apply(f: ReturnType<typeof fixture>) { const action = f.controller.beginApply(); assert.ok(action); await action.run(new AbortController().signal); }

test('per-field origins include managed and through-scope ignores stronger overrides', () => {
  const f = fixture(); f.set({ ...f.read(), global: { enabled: true }, project: { model: 'project' }, session: { enabled: false } });
  assert.deepEqual(resolveScopedSetting(f.read(), 'enabled', 'effective'), { value: false, origin: 'session' });
  assert.deepEqual(resolveScopedSetting(f.read(), 'enabled', 'global'), { value: true, origin: 'global' });
  assert.deepEqual(resolveScopedSetting(f.read(), 'model', 'global'), { value: 'managed', origin: 'managed' });
  assert.deepEqual(resolveScopedSetting({ ...f.read(), projectTrusted: false }, 'model', 'effective'), { value: 'managed', origin: 'managed' });
});

test('staged scopes remain independent; apply saves one scope and preserves unrelated fresh data', async () => {
  const f = fixture(); const c = f.controller;
  c.selectScope('global'); c.toggleSelected(); c.selectScope('project'); c.toggleSelected();
  assert.equal(f.writes(), 0); assert.equal(c.state().scopes.filter(scope => scope.dirty).length, 2);
  f.set({ ...f.read(), project: { model: 'external' } }); await apply(f);
  assert.deepEqual(f.read().project, { model: 'external', enabled: true }); assert.deepEqual(f.read().global, {});
  c.selectScope('global'); await apply(f); assert.equal(f.read().global.enabled, true);
});

test('null is an explicit model value, not an inherit sentinel', async () => {
  const f = fixture(); f.controller.select(1); f.editor(async () => ({ kind: 'set', value: null }));
  const edit = f.controller.beginEdit(); assert.ok(edit); await edit.run(new AbortController().signal); await apply(f);
  assert.equal(Object.hasOwn(f.read().session, 'model'), true); assert.equal(f.read().session.model, null);
  f.controller.inheritSelected(); await apply(f);
  assert.equal(Object.hasOwn(f.read().session, 'model'), false);
  assert.equal(resolveScopedSetting(f.read(), 'model', 'effective').origin, 'managed');
});

test('aborted or stale-target actions cannot apply; failure preserves pending review', async () => {
  const f = fixture(); f.controller.toggleSelected(); const action = f.controller.beginApply(); assert.ok(action);
  const abort = new AbortController(); abort.abort(); await action.run(abort.signal); assert.equal(f.writes(), 0);
  assert.equal(f.controller.state().scopes[0].dirty, true);
  f.set({ ...f.read(), targets: { ...f.read().targets, session: 'another-session' } });
  assert.equal(f.controller.reload(), true); assert.equal(f.controller.beginApply(), null);
  assert.match(f.controller.state().notice, /another target|old target/); assert.equal(f.writes(), 0);
  const failed = fixture(); failed.controller.toggleSelected(); failed.failWrite(); await apply(failed);
  assert.equal(failed.writes(), 0); assert.equal(failed.controller.state().scopes[0].dirty, true);
  assert.match(failed.controller.state().notice, /Storage may already have changed/);
});

test('an asynchronous editor cannot stage after disposal or target drift', async () => {
  const f = fixture(); let finish: (value: ScopedSettingEditResult<string | null>) => void = () => {};
  f.editor(() => new Promise(resolve => { finish = resolve; })); f.controller.select(1);
  const action = f.controller.beginEdit(); assert.ok(action); const running = action.run(new AbortController().signal);
  f.set({ ...f.read(), targets: { ...f.read().targets, session: 'changed-target' } }); finish({ kind: 'set', value: 'stale edit' }); await running;
  assert.equal(f.controller.state().scopes[0].dirty, false); assert.match(f.controller.state().notice, /target changed/);
  const second = f.controller.beginEdit(); assert.ok(second); const pending = second.run(new AbortController().signal);
  f.controller.dispose(); finish({ kind: 'set', value: 'late' }); await pending;
  assert.equal(f.writes(), 0); assert.equal(f.controller.active, false);
});
