import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_FOCUS,
  PreferenceStore,
} from '../src/preferences.ts';
import {
  PROJECT_CONSENT_TYPE,
  changedProject,
  projectConsent,
  readProject,
} from '../src/project-config.ts';
import {
  ProjectSettings,
} from '../src/project-settings.ts';

const a = { provider: 'fixture-a', id: 'a', thinking: 'off' };
const b = { provider: 'fixture-b', id: 'b', thinking: 'high' };
const clock = { token: randomUUID };
const setEnabled = value => ({
  key: 'enabled',
  op: 'set',
  value,
});

function writeDocument(snapshot) {
  assert.notEqual(snapshot.document, null);
  mkdirSync(dirname(snapshot.target), { recursive: true });
  writeFileSync(
    snapshot.target,
    JSON.stringify(snapshot.document),
  );
}

function fixture(t) {
  const directory = mkdtempSync(
    join(tmpdir(), 'historian-live-project-authority-'),
  );
  t.after(() => rmSync(directory, {
    recursive: true,
    force: true,
  }));

  const entries = [];
  let trusted = true;
  let auditHook = () => {};
  const pi = {
    appendEntry(customType, data) {
      entries.push({
        type: 'custom',
        id: `entry-${entries.length}`,
        parentId: null,
        timestamp: '2026-11-13T00:00:00Z',
        customType,
        data,
      });
      if (customType === PROJECT_CONSENT_TYPE) auditHook();
    },
  };

  function runtime(name) {
    let current = true;
    const preferences = new PreferenceStore(
      join(directory, name, 'historian.json'),
    );
    preferences.write({
      enabled: false,
      model: a,
      approvedModel: a,
      focus: DEFAULT_FOCUS,
    });
    const ctx = {
      cwd: directory,
      isProjectTrusted: () => trusted,
      sessionManager: {
        getSessionId: () => 'same-root',
        getEntries: () => entries,
      },
    };
    const owner = new ProjectSettings(
      pi,
      preferences,
      directory,
      candidate => current && candidate === ctx,
      clock,
    );
    return { preferences, ctx, owner, setCurrent: value => { current = value; } };
  }

  return {
    directory,
    entries,
    pi,
    runtime,
    setTrusted: value => { trusted = value; },
    setAuditHook: value => { auditHook = value; },
  };
}

test('project file and matching native receipt cannot mint live authority', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');
  const requested = changedProject(
    readProject(r.ctx, f.directory),
    [setEnabled(true)],
    clock,
  );
  writeDocument(requested);

  f.pi.appendEntry(
    PROJECT_CONSENT_TYPE,
    projectConsent('same-root', requested, a, clock),
  );

  let config = r.owner.read(r.ctx, null);
  assert.equal(config.enabled, true);
  assert.equal(config.enabledSource, 'project');
  assert.equal(config.disclosureApproved, false);

  const declined = await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => false,
  );
  assert.equal(declined.status, 'cancelled');
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    false,
  );

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => true,
  );
  config = r.owner.read(r.ctx, null);
  assert.equal(config.disclosureApproved, true);
});

test('OFF followed by replay of old document/token cannot reuse old receipt', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');
  const signal = new AbortController().signal;

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    signal,
    async () => true,
  );
  const on = readProject(r.ctx, f.directory);
  const oldBytes = readFileSync(on.target, 'utf8');
  const oldReceipt = f.entries.at(-1).data;
  assert.equal(
    oldReceipt.enabledGeneration,
    on.document.enabledGeneration,
  );

  await r.owner.apply(
    r.ctx,
    [setEnabled(false)],
    signal,
    async () => assert.fail('OFF must not request approval'),
  );
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    false,
  );

  writeFileSync(on.target, oldBytes);
  const replayed = r.owner.read(r.ctx, null);
  assert.equal(replayed.enabled, true);
  assert.equal(
    replayed.projectSnapshot.document.enabledGeneration,
    oldReceipt.enabledGeneration,
  );
  assert.equal(replayed.disclosureApproved, false);
});

test('a stale owner cannot read or retain live project authority', async t => {
  const f = fixture(t); const r = f.runtime('agent-a');
  await r.owner.apply(r.ctx, [setEnabled(true)], new AbortController().signal, async () => true);
  r.setCurrent(false);
  assert.throws(() => r.owner.read(r.ctx, null), /stale/);
  r.setCurrent(true); assert.equal(r.owner.read(r.ctx, null).disclosureApproved, false);
});

test('new runtime with same SID and receipt starts unapproved', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => true,
  );
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    true,
  );
  const receiptCount = f.entries.length;
  r.owner.dispose();

  const replacement = new ProjectSettings(
    f.pi,
    r.preferences,
    f.directory,
    candidate => candidate === r.ctx,
    clock,
  );
  const config = replacement.read(r.ctx, null);
  assert.equal(config.enabled, true);
  assert.equal(config.disclosureApproved, false);
  assert.equal(f.entries.length, receiptCount);
});

test('observed read fault permanently revokes that live grant', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => true,
  );
  const project = readProject(r.ctx, f.directory);
  const bytes = readFileSync(project.target, 'utf8');

  writeFileSync(project.target, '{');
  assert.throws(
    () => r.owner.read(r.ctx, null),
    /Cannot read valid/,
  );

  writeFileSync(project.target, bytes);
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    false,
  );
});

test('observed trust/source round-trip cannot resurrect the grant', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => true,
  );

  f.setTrusted(false);
  assert.equal(
    r.owner.read(r.ctx, null).enabledSource,
    'global',
  );

  f.setTrusted(true);
  const restored = r.owner.read(r.ctx, null);
  assert.equal(restored.enabledSource, 'project');
  assert.equal(restored.disclosureApproved, false);
});

test('focus/configuration change revokes project grant without issuing approval', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');
  const signal = new AbortController().signal;

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    signal,
    async () => true,
  );
  const receiptCount = f.entries.length;
  const project = readProject(r.ctx, f.directory);
  const oldBytes = readFileSync(project.target, 'utf8');

  await r.owner.apply(
    r.ctx,
    [{ key: 'focus', op: 'set', value: 'Changed focus' }],
    signal,
    async () => assert.fail('focus must not mint approval'),
  );
  assert.equal(f.entries.length, receiptCount);
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    false,
  );

  writeFileSync(project.target, oldBytes);
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    false,
  );
});

for (const interval of ['fault', 'trust']) test(`observed ${interval} during audit cannot reuse pre-interval confirmation`, async t => {
  const f = fixture(t); const r = f.runtime('agent-a');
  f.setAuditHook(() => {
    if (interval === 'trust') {
      f.setTrusted(false); r.owner.read(r.ctx, null); f.setTrusted(true);
    } else {
      const target = readProject(r.ctx, f.directory).target; const bytes = readFileSync(target, 'utf8');
      writeFileSync(target, '{'); assert.throws(() => r.owner.read(r.ctx, null)); writeFileSync(target, bytes);
    }
  });
  await assert.rejects(r.owner.apply(r.ctx, [setEnabled(true)], new AbortController().signal, async () => true), /changed.*approval/);
  assert.equal(r.owner.read(r.ctx, null).disclosureApproved, false);
});

for (const stage of ['before-write', 'after-write']) test(`token callback cancellation ${stage} prevents subsequent effects`, async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const abort = new AbortController(); let armed = false;
  const owner = new ProjectSettings(f.pi, r.preferences, f.directory, candidate => candidate === r.ctx, {
    token() {
      if (armed && (stage === 'before-write' || readProject(r.ctx, f.directory).document?.enabled === true)) { armed = false; abort.abort(); }
      return randomUUID();
    },
  });
  await assert.rejects(owner.apply(r.ctx, [setEnabled(true)], abort.signal, async () => { armed = true; return true; }), /cancelled/);
  if (stage === 'before-write') assert.equal(readProject(r.ctx, f.directory).document, null);
  assert.equal(f.entries.length, 0);
  const config = owner.read(r.ctx, null);
  if (stage === 'before-write') { assert.equal(config.enabled, false); assert.equal(config.enabledSource, 'global'); }
  else { assert.equal(config.enabledSource, 'project'); assert.equal(config.disclosureApproved, false); }
});

for (const change of ['trust', 'cwd']) test(`token callback ${change} drift cannot mutate the prepared project target`, async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const target = readProject(r.ctx, f.directory).target;
  const other = join(f.directory, 'other'); mkdirSync(other); let armed = false;
  const owner = new ProjectSettings(f.pi, r.preferences, f.directory, candidate => candidate === r.ctx, {
    token() {
      if (armed) { armed = false; if (change === 'trust') f.setTrusted(false); else r.ctx.cwd = other; }
      return randomUUID();
    },
  });
  await assert.rejects(owner.apply(r.ctx, [setEnabled(true)], new AbortController().signal, async () => { armed = true; return true; }), /changed|trust/);
  assert.throws(() => readFileSync(target), { code: 'ENOENT' }); assert.equal(f.entries.length, 0);
});

test('audit callback cancellation cannot mint a live grant', async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const abort = new AbortController();
  f.setAuditHook(() => abort.abort());
  await assert.rejects(r.owner.apply(r.ctx, [setEnabled(true)], abort.signal, async () => true), /cancelled/);
  assert.equal(r.owner.read(r.ctx, null).disclosureApproved, false);
});

test('grant is absent during native audit callbacks', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');
  let observed = null;

  f.setAuditHook(() => {
    observed = r.owner.read(r.ctx, null).disclosureApproved;
  });

  await r.owner.apply(
    r.ctx,
    [setEnabled(true)],
    new AbortController().signal,
    async () => true,
  );

  assert.equal(observed, false);
  assert.equal(
    r.owner.read(r.ctx, null).disclosureApproved,
    true,
  );
});

test('confirmation revalidates displayed model without holding locks over await', async t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');

  await assert.rejects(
    r.owner.apply(
      r.ctx,
      [setEnabled(true)],
      new AbortController().signal,
      async prompt => {
        assert.match(prompt, /fixture-a\/a/);
        r.preferences.update(() => ({ model: b }));
        return true;
      },
    ),
    /changed during confirmation/,
  );

  assert.equal(f.entries.length, 0);
  assert.equal(
    readProject(r.ctx, f.directory).document,
    null,
  );
});

test('different agentDirs contend on the same project-target lock', async t => {
  const f = fixture(t);
  const first = f.runtime('agent-a');
  const second = f.runtime('agent-b');
  const signal = new AbortController().signal;

  assert.notEqual(
    first.preferences.path,
    second.preferences.path,
  );

  await first.owner.apply(
    first.ctx,
    [setEnabled(true)],
    signal,
    async () => true,
  );

  let attempted;
  first.owner.withSnapshot(first.ctx, () => {
    attempted = second.owner.apply(
      second.ctx,
      [setEnabled(false)],
      signal,
      async () => assert.fail('OFF must not prompt'),
    );
  });

  await assert.rejects(attempted, /owned|locked/i);
  assert.equal(
    readProject(first.ctx, f.directory).document.enabled,
    true,
  );

  await second.owner.apply(
    second.ctx,
    [setEnabled(false)],
    signal,
    async () => assert.fail('OFF must not prompt'),
  );

  assert.equal(
    first.owner.read(first.ctx, null).enabled,
    false,
  );
  assert.equal(
    first.owner.read(first.ctx, null).disclosureApproved,
    false,
  );
});

test('mixed session ON confirms the staged model and preserves native readers', async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const snapshot = r.owner.settingsSnapshot(r.ctx); let confirmed = false;
  await r.owner.applyScoped(r.ctx, 'session', [{ key: 'model', op: 'set', value: b }, { key: 'focus', op: 'set', value: 'Staged focus' }, setEnabled(true)],
    new AbortController().signal, snapshot.targets.session, async prompt => { confirmed = true; assert.match(prompt, /fixture-b\/b/); assert.equal(f.entries.length, 0); return true; });
  assert.equal(confirmed, true); const config = r.owner.read(r.ctx, null);
  assert.deepEqual(config.model, b); assert.equal(config.focus, 'Staged focus'); assert.equal(config.enabled, true);
  assert.equal(config.enabledSource, 'session'); assert.equal(config.disclosureApproved, true);
  assert.deepEqual(f.entries.find(entry => entry.customType === 'historian.consent').data.model, b);
});

test('mixed global inheritance approves the managed candidate without materializing it', async t => {
  const f = fixture(t); const r = f.runtime('agent-a');
  writeFileSync(join(dirname(r.preferences.path), 'historian-defaults.json'), JSON.stringify({ version: 1, journalRoot: null, model: b }));
  const snapshot = r.owner.settingsSnapshot(r.ctx);
  await r.owner.applyScoped(r.ctx, 'global', [{ key: 'model', op: 'inherit' }, { key: 'focus', op: 'inherit' }, setEnabled(true)],
    new AbortController().signal, snapshot.targets.global, async prompt => { assert.match(prompt, /fixture-b\/b/); return true; });
  assert.deepEqual(r.preferences.readOverrides(), { enabled: true }); const defaults = r.preferences.read();
  assert.deepEqual(defaults.model, b); assert.deepEqual(defaults.approvedModel, b); assert.equal(defaults.focus, DEFAULT_FOCUS);
});

test('declined mixed global apply leaves original bytes unchanged', async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const original = readFileSync(r.preferences.path, 'utf8'); const snapshot = r.owner.settingsSnapshot(r.ctx);
  await assert.rejects(r.owner.applyScoped(r.ctx, 'global', [{ key: 'model', op: 'set', value: b }, { key: 'focus', op: 'set', value: 'Not committed' }, setEnabled(true)],
    new AbortController().signal, snapshot.targets.global, async () => false), /approval cancelled/);
  assert.equal(readFileSync(r.preferences.path, 'utf8'), original);
});

for (const cancelledAfter of ['historian.model', 'historian.consent']) test(`session cancellation after ${cancelledAfter} prevents later native writes`, async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const abort = new AbortController(); const append = f.pi.appendEntry;
  t.mock.method(f.pi, 'appendEntry', (type, data) => { append(type, data); if (type === cancelledAfter) abort.abort(); });
  const snapshot = r.owner.settingsSnapshot(r.ctx);
  await assert.rejects(r.owner.applyScoped(r.ctx, 'session', [{ key: 'model', op: 'set', value: b }, setEnabled(true)],
    abort.signal, snapshot.targets.session, async () => true), /abort|cancel/i);
  assert.equal(f.entries.some(entry => entry.customType === 'historian.model'), true);
  assert.equal(f.entries.some(entry => entry.customType === 'historian.consent'), cancelledAfter === 'historian.consent');
  assert.equal(f.entries.some(entry => entry.customType === 'historian.enabled'), false);
});

test('set-null model is rejected rather than silently interpreted as inheritance', async t => {
  const f = fixture(t); const r = f.runtime('agent-a'); const original = readFileSync(r.preferences.path, 'utf8'); const snapshot = r.owner.settingsSnapshot(r.ctx);
  await assert.rejects(r.owner.applyScoped(r.ctx, 'global', [{ key: 'model', op: 'set', value: null }], new AbortController().signal,
    snapshot.targets.global, async () => assert.fail('invalid input must not confirm')), /use inherit/);
  assert.equal(readFileSync(r.preferences.path, 'utf8'), original);
});

test('unknown trust is an error, not untrusted fallback', t => {
  const f = fixture(t);
  const r = f.runtime('agent-a');
  f.setTrusted(undefined);
  assert.throws(
    () => r.owner.read(r.ctx, null),
    /trust is unknown/,
  );
});
