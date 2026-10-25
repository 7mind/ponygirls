import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DaemonLock } from '../src/spool.ts';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('GoodCommunication CLI disabled has no filesystem/discovery side effects; safe once/status failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-cli-'));
  try {
    const config = join(dir, 'config.json'); const state = join(dir, 'state');
    writeFileSync(config, JSON.stringify({ enabled: false, homeDir: join(dir, 'never-exists'), stateDir: state }));
    const disabled = spawnSync(process.execPath, [cli, '--config', config, '--once'], { encoding: 'utf8' });
    assert.equal(disabled.status, 0); assert.deepEqual(JSON.parse(disabled.stdout) as unknown, { enabled: false }); assert.equal(existsSync(state), false);
    const source = join(dir, 'source'); mkdirSync(source); writeFileSync(join(source, 'bad.jsonl'), 'SYNTHETIC_PRIVATE_MALFORMED\n');
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'no-token'), stateDir: state, discoverNative: false, discoverYolo: false, roots: [{ id: 'fixture', format: 'pi', path: source }], quietMs: 0 }));
    const failed = spawnSync(process.execPath, [cli, '--config', config, '--once'], { encoding: 'utf8' });
    assert.equal(failed.status, 1); assert.equal((JSON.parse(failed.stdout) as { quarantined: number }).quarantined, 1);
    assert.doesNotMatch(failed.stderr + failed.stdout, /SYNTHETIC_PRIVATE_MALFORMED/);
    const status = spawnSync(process.execPath, [cli, '--config', config, '--status'], { encoding: 'utf8' });
    assert.equal(status.status, 0); assert.match(status.stdout, /invalid-json/);
    assert.equal(statSync(state).mode & 0o077, 0); assert.equal(statSync(join(state, 'spool.sqlite')).mode & 0o077, 0);
    assert.equal(statSync(join(state, 'daemon-lock.sqlite')).mode & 0o077, 0);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication daemon lock is released by process death, no stale PID-file recovery required', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-crash-'));
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'no-token'), stateDir: join(dir, 'state'), discoverNative: false, discoverYolo: false, pollMs: 60000 }));
  const child = spawn(process.execPath, [cli, '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    assert.ok(child.stdout !== null); await once(child.stdout, 'data');
    assert.throws(() => new DaemonLock(join(dir, 'state')), /collector-already-running/);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const lock = new DaemonLock(join(dir, 'state')); lock.close();
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true }); }
});
