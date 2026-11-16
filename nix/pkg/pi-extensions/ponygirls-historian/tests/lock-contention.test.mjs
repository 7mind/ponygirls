import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { acquireSessionLock, acquireSettingsLock, SETTINGS_LOCK_TIMEOUT_MS } from '../src/store.ts';
import { digest } from '../src/evidence.ts';
import { PreferenceStore } from '../src/preferences.ts';
import { ChroniclePreferences } from '../src/chronicle-preferences.ts';

const RELEASE_DELAY_MS = 200;

function fixture(t, kind) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-settings-contention-'));
  mkdirSync(join(directory, 'project', '.pi'), { recursive: true });
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const spawn = mode => {
    const child = fork(new URL('./fixtures/settings-lock-child.mjs', import.meta.url), [directory, kind, mode, `${mode}-session`], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child);
    const exited = once(child, 'exit');
    const first = Promise.race([once(child, 'message').then(([value]) => value),
      exited.then(([code, signal]) => { throw new Error(`Settings fixture exited before readiness: ${code}/${signal}`); })]);
    return { child, first, exited };
  };
  return { directory, spawn };
}

async function contend(t, kind, holderMode, waiterMode) {
  const f = fixture(t, kind);
  const holder = f.spawn(holderMode); assert.deepEqual(await holder.first, { holding: true });
  const waiter = f.spawn(waiterMode); assert.deepEqual(await waiter.first, { attempting: true });
  const entered = once(waiter.child, 'message');
  const release = setTimeout(() => writeFileSync(join(f.directory, 'release-holder'), ''), RELEASE_DELAY_MS);
  t.after(() => clearTimeout(release));
  assert.deepEqual((await entered)[0], { entered: true });
  assert.equal((await holder.exited)[0], 0); assert.equal((await waiter.exited)[0], 0);
  return f.directory;
}

for (const kind of ['global', 'project', 'chronicle']) {
  test(`different session processes wait for a short shared ${kind} settings transaction`, { timeout: 15000 }, async t => {
    await contend(t, kind, 'hold', 'wait');
  });
}

for (const kind of ['global', 'chronicle']) {
  test(`contending ${kind} updates read fresh settings and retain both writers' changes`, { timeout: 15000 }, async t => {
    const directory = await contend(t, kind, 'hold-update', 'wait-update');
    if (kind === 'global') {
      const current = new PreferenceStore(join(directory, 'agent', 'historian.json')).read();
      assert.equal(current.enabled, true); assert.equal(current.enabledGeneration, 1); assert.equal(current.focus, 'waiter-focus');
    } else {
      const current = new ChroniclePreferences(join(directory, 'agent', 'historian-chronicle.json')).read();
      assert.equal(current.collectorNamespace, 'holder-namespace'); assert.equal(current.endpoint, 'https://collector.example/api/ingest');
    }
  });
}

test('unreleased settings lock times out with its scope without weakening session exclusion', { timeout: 10000 }, t => {
  const { directory } = fixture(t, 'global');
  const release = acquireSessionLock(directory, 'global-preferences');
  const started = performance.now();
  try {
    assert.throws(() => acquireSettingsLock(directory, 'global-preferences', 'global'),
      error => error.message === `Historian global settings lock timed out after ${SETTINGS_LOCK_TIMEOUT_MS}ms`);
    assert.ok(performance.now() - started >= SETTINGS_LOCK_TIMEOUT_MS, 'bounded wait must actually be attempted');
    const leaseStarted = performance.now();
    assert.throws(() => acquireSessionLock(directory, 'global-preferences'), /already owned/);
    assert.ok(performance.now() - leaseStarted < SETTINGS_LOCK_TIMEOUT_MS, 'session lease must remain fail-fast');
  } finally { release(); }
  acquireSettingsLock(directory, 'global-preferences', 'global')();
});

test('a corrupt lock database is not misreported as another live session owner', t => {
  const { directory } = fixture(t, 'global');
  writeFileSync(join(directory, `session-${digest('corrupt')}.lock.sqlite`), 'not a SQLite database', { mode: 0o600 });
  for (const acquire of [() => acquireSessionLock(directory, 'corrupt'), () => acquireSettingsLock(directory, 'corrupt', 'global')]) {
    assert.throws(acquire, error => {
      assert.doesNotMatch(error.message, /already owned|timed out/);
      const cause = error.cause instanceof Error ? error.cause.message : '';
      assert.match(`${error.message} ${cause}`, /not a database/);
      return true;
    });
  }
});
