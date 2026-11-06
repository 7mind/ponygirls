import assert from 'node:assert/strict';
import test from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../src/store.ts';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-process-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const spawn = (mode, owner) => {
    const child = fork(new URL('./fixtures/store-child.mjs', import.meta.url), [mode, directory, owner], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child);
    const ready = once(child, 'message').then(([value]) => value);
    const exited = once(child, 'exit');
    return { child, ready, exited };
  };
  return { directory, spawn };
}

test('per-session SQLite ownership excludes another process and is released by process death', { timeout: 15000 }, async t => {
  const { spawn } = fixture(t);
  const first = spawn('lock', 'root'); assert.deepEqual(await first.ready, { ready: true });
  const contender = spawn('lock', 'root'); assert.match((await contender.ready).error, /locked|owned/i);
  assert.equal((await contender.exited)[0], 1);
  const other = spawn('lock', 'other-root'); assert.deepEqual(await other.ready, { ready: true });
  first.child.kill('SIGKILL'); assert.equal((await first.exited)[1], 'SIGKILL');
  const replacement = spawn('lock', 'root'); assert.deepEqual(await replacement.ready, { ready: true });
  replacement.child.send('release'); other.child.send('release');
  assert.equal((await replacement.exited)[0], 0); assert.equal((await other.exited)[0], 0);
});

test('two OS processes publish into one journal without losing revisions or projection updates', { timeout: 15000 }, async t => {
  const { directory, spawn } = fixture(t);
  const first = spawn('commit', 'first'); const second = spawn('commit', 'second');
  assert.deepEqual(await first.ready, { ready: true }); assert.deepEqual(await second.ready, { ready: true });
  const a = once(first.child, 'message'); const b = once(second.child, 'message');
  first.child.send('commit'); second.child.send('commit');
  assert.deepEqual((await a)[0], { committed: true }); assert.deepEqual((await b)[0], { committed: true });
  assert.equal((await first.exited)[0], 0); assert.equal((await second.exited)[0], 0);
  const store = new JournalStore(join(directory, 'journal.sqlite'), '/synthetic-project');
  try {
    assert.deepEqual(store.recent(10).map(r => r.owner).sort(), ['first', 'second']);
    assert.equal(store.batch('first'), null); assert.equal(store.batch('second'), null);
    const markdown = readFileSync(join(directory, 'journal.md'), 'utf8');
    assert.match(markdown, /first/); assert.match(markdown, /second/);
  } finally { store.close(); }
});

test('captured pending evidence survives an owner process dying before publication', { timeout: 15000 }, async t => {
  const { directory, spawn } = fixture(t);
  const first = spawn('commit', 'pending'); assert.deepEqual(await first.ready, { ready: true });
  first.child.kill('SIGKILL'); await first.exited;
  const store = new JournalStore(join(directory, 'journal.sqlite'), '/synthetic-project');
  try { assert.equal(store.batch('pending').evidence.length, 1); assert.deepEqual(store.recent(10), []); }
  finally { store.close(); }
});
