import assert from 'node:assert/strict';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { acquireSessionLock } from '../../src/store.ts';
import { PreferenceStore } from '../../src/preferences.ts';
import { ChroniclePreferences } from '../../src/chronicle-preferences.ts';
import { acquireProjectTargetLock } from '../../src/project-settings.ts';

const [directory, kind, mode, owner] = process.argv.slice(2);
const HOLDER_DEADLINE_MS = 10000;
const POLL_INTERVAL_MS = 10;
const held = join(directory, 'critical-section');
const released = join(directory, 'release-holder');
const holding = mode === 'hold' || mode === 'hold-update';
const updating = mode === 'hold-update' || mode === 'wait-update';
if (process.send === undefined) throw new Error('IPC required');
let releaseSession = null;
try {
  releaseSession = acquireSessionLock(join(directory, 'sessions'), owner);
  const enter = () => {
    if (holding) {
      writeFileSync(held, owner, { flag: 'wx' });
      process.send({ holding: true });
      const deadline = performance.now() + HOLDER_DEADLINE_MS;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(released)) {
        if (performance.now() > deadline) throw new Error('Fixture holder deadline');
        Atomics.wait(wait, 0, 0, POLL_INTERVAL_MS);
      }
      unlinkSync(held);
    } else {
      assert.equal(existsSync(held), false, 'settings critical sections must not overlap');
      process.send({ entered: true });
    }
  };
  if (!holding) process.send({ attempting: true });
  if (kind === 'global') {
    const preferences = new PreferenceStore(join(directory, 'agent', 'historian.json'));
    if (updating) preferences.update(current => { enter(); return { ...current, ...(holding ? { enabled: true } : { focus: 'waiter-focus' }) }; });
    else preferences.withSnapshot(enter);
  } else if (kind === 'chronicle') {
    const preferences = new ChroniclePreferences(join(directory, 'agent', 'historian-chronicle.json'));
    if (updating) preferences.update(current => { enter(); return { ...current, ...(holding ? { collectorNamespace: 'holder-namespace' } : { endpoint: 'https://collector.example/api/ingest' }) }; });
    else preferences.withSnapshot(enter);
  }
  else if (kind === 'project') {
    const release = acquireProjectTargetLock(join(directory, 'project', '.pi', 'historian.json'));
    try { enter(); } finally { release(); }
  } else throw new Error('Unknown settings fixture kind');
  releaseSession(); releaseSession = null;
  process.send({ finished: true }, () => process.disconnect());
} catch (error) {
  if (releaseSession !== null) releaseSession();
  process.send({ error: error.message }, () => { process.exitCode = 1; process.disconnect(); });
}
