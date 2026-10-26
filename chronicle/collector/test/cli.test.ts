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

function invoke(home: string, configHome: string | undefined, argv: string[], cwd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  if (configHome === undefined) delete env.XDG_CONFIG_HOME;
  else env.XDG_CONFIG_HOME = configHome;
  return spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', env, cwd });
}

for (const [name, configHome] of [['unset', undefined], ['empty', ''], ['relative', 'relative-config']] as const) {
  test(`GoodCommunication CLI uses the home default when XDG_CONFIG_HOME is ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronicle-default-home-'));
    try {
      const home = join(dir, 'home'), directory = join(home, '.config', 'chronicle'), state = join(dir, 'state');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'collector.json'), JSON.stringify({ enabled: false, stateDir: state }));
      const result = invoke(home, configHome, ['--status'], dir);
      assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout) as unknown, { enabled: false });
      assert.equal(existsSync(state), false);
    } finally { rmSync(dir, { recursive: true }); }
  });
}

test('GoodCommunication CLI uses XDG config for status without credentials, scanning or upload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-default-xdg-'));
  try {
    const home = join(dir, 'home'), configHome = join(dir, 'custom-config'), directory = join(configHome, 'chronicle'), state = join(dir, 'state');
    mkdirSync(join(home, '.config', 'chronicle'), { recursive: true }); mkdirSync(directory, { recursive: true });
    writeFileSync(join(home, '.config', 'chronicle', 'collector.json'), 'SYNTHETIC_UNSELECTED_CONFIG');
    writeFileSync(join(directory, 'collector.json'), JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), redactions: { secretFiles: [join(dir, 'missing-secret')] }, stateDir: state, discoverNative: false, discoverYolo: false }));
    const result = invoke(home, configHome, ['--status'], dir);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout) as { namespace: string; queue: unknown[]; lastRun: unknown };
    assert.match(status.namespace, /^[0-9a-f-]{36}$/); assert.deepEqual(status.queue, []); assert.equal(status.lastRun, null);
    assert.equal(existsSync(join(state, 'daemon-lock.sqlite')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_UNSELECTED_CONFIG|privacy-secret-unavailable/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication CLI explicit config overrides the default without merging it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-config-override-'));
  try {
    const home = join(dir, 'home'), configHome = join(dir, 'config'), directory = join(configHome, 'chronicle'), explicit = join(dir, 'explicit.json');
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'collector.json'), 'SYNTHETIC_IGNORED_DEFAULT');
    writeFileSync(explicit, JSON.stringify({ enabled: false }));
    const result = invoke(home, configHome, ['--config', explicit, '--status'], dir);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout) as unknown, { enabled: false });
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_IGNORED_DEFAULT/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication CLI missing or malformed selected config fails without secondary or cwd fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-config-failure-'));
  try {
    const home = join(dir, 'home'), configHome = join(dir, 'config'), directory = join(configHome, 'chronicle'), state = join(dir, 'state');
    mkdirSync(join(home, '.config', 'chronicle'), { recursive: true }); mkdirSync(directory, { recursive: true });
    const disabled = JSON.stringify({ enabled: false, stateDir: state });
    writeFileSync(join(home, '.config', 'chronicle', 'collector.json'), disabled); writeFileSync(join(dir, 'collector.json'), disabled);
    for (const malformed of [false, true]) {
      if (malformed) writeFileSync(join(directory, 'collector.json'), 'SYNTHETIC_INVALID_CONFIG');
      const result = invoke(home, configHome, ['--status'], dir);
      assert.equal(result.status, 1); assert.match(result.stderr, /"code":"config-read-failed"/); assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /SYNTHETIC_INVALID_CONFIG/); assert.equal(existsSync(state), false);
    }
    writeFileSync(join(directory, 'collector.json'), disabled);
    const explicitMissing = invoke(home, configHome, ['--config', join(dir, 'missing.json'), '--status'], dir);
    assert.equal(explicitMissing.status, 1); assert.match(explicitMissing.stderr, /"code":"config-read-failed"/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication CLI never uses default config to recover malformed explicit arguments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-config-arguments-'));
  try {
    const home = join(dir, 'home'), configHome = join(dir, 'config'), directory = join(configHome, 'chronicle');
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'collector.json'), JSON.stringify({ enabled: false }));
    for (const argv of [['--config'], ['--config', 'relative.json', '--status'], ['--config', join(directory, 'collector.json'), '--config', join(directory, 'collector.json')], ['--unexpected']]) {
      const result = invoke(home, configHome, argv, dir);
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication CLI disabled has no filesystem/discovery side effects; safe once/status failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-cli-'));
  try {
    const config = join(dir, 'config.json'); const state = join(dir, 'state');
    writeFileSync(config, JSON.stringify({ enabled: false, homeDir: join(dir, 'never-exists'), stateDir: state }));
    const disabled = spawnSync(process.execPath, [cli, '--config', config, '--once'], { encoding: 'utf8' });
    assert.equal(disabled.status, 0); assert.deepEqual(JSON.parse(disabled.stdout) as unknown, { enabled: false }); assert.equal(existsSync(state), false);
    const source = join(dir, 'source'); mkdirSync(source); writeFileSync(join(source, 'bad.jsonl'), 'SYNTHETIC_PRIVATE_MALFORMED\n');
    writeFileSync(join(dir, 'no-token'), 'synthetic-cli-token', { mode: 0o600 });
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'no-token'), stateDir: state, discoverNative: false, discoverYolo: false, roots: [{ id: 'fixture', format: 'pi', path: source }], quietMs: 0 }));
    const failed = spawnSync(process.execPath, [cli, '--config', config, '--once'], { encoding: 'utf8' });
    assert.equal(failed.status, 1); assert.equal((JSON.parse(failed.stdout) as { quarantined: number }).quarantined, 1);
    assert.doesNotMatch(failed.stderr + failed.stdout, /SYNTHETIC_PRIVATE_MALFORMED/);
    rmSync(join(dir, 'no-token')); // Status must not require runtime credential reads.
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
