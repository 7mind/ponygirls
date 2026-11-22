import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DaemonLock, SqliteSpool, type Pending } from '../src/spool.ts';
import { hash, type CollectorReport } from '../src/domain.ts';
import { Collector } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { UploadError, type Ingester } from '../src/ingest.ts';
import { FileSecretReader } from '../src/runtime-privacy.ts';
import { noGit, acceptingProgress, lateClock } from './helpers.ts';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function invoke(home: string, configHome: string | undefined, argv: string[], cwd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  if (configHome === undefined) delete env.XDG_CONFIG_HOME;
  else env.XDG_CONFIG_HOME = configHome;
  return spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', env, cwd });
}

const HELP = `chronicle-collector — uploads local Claude, Codex and Pi session histories to Chronicle

Usage: chronicle-collector [--config PATH] [COMMAND] [--json]

Commands:
  (none)              run as a daemon, scanning every poll interval
  --once              scan and upload once, then exit (1 on failure or leftovers)
  --status            show the last scan, the queue and diagnostics
  --pause             stop collecting; queued uploads are kept
  --resume            continue collecting
  --exclude PATH      stop collecting from a directory
  --unexclude PATH    collect from it again
  --exclusions        list excluded directories
  --retry REQUEST_ID  retry a stopped upload on the next scan
  --drop REQUEST_ID   discard a queued upload; its source is not collected again
  --clear-policy-tombstones [--apply]
                      list the sources that a privacy or destination change
                      stopped collecting; with --apply, collect them again

--once, --retry and --drop need the daemon stopped.

Options:
  --config PATH       absolute path of the configuration
                      (default: $XDG_CONFIG_HOME/chronicle/collector.json)
  --json              machine-readable output instead of text (not for --once
                      or the daemon, which always print JSON)
  -h, --help          show this help
`;
const usageError = (message: string): string => `chronicle-collector: ${message}\nTry 'chronicle-collector --help'.\n`;
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const enabledConfig = (dir: string, state: string) => ({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), stateDir: state, discoverNative: false, discoverYolo: false });

test('GoodCommunication CLI help goes to stdout with exit 0 before configuration, state or other arguments are examined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-help-'));
  try {
    for (const argv of [['--help'], ['-h'], ['--status', '--help'], ['-h', '--once', '--json'], ['--config', 'relative.json', '-h'], ['--unexpected', '--help'], ['--retry', '--help']]) {
      const result = invoke(join(dir, 'home'), undefined, argv, dir);
      assert.equal(result.stdout, HELP, argv.join(' ')); assert.equal(result.stderr, ''); assert.equal(result.status, 0);
    }
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication README quotes the help exactly as the CLI prints it', () => {
  // Compiled tests live in dist/collector/test; the README stays beside package.json.
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('```text\n' + HELP + '```\n'));
});

test('GoodCommunication CLI usage errors exit 2 with a sentence naming the argument, never JSON, before configuration or state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-usage-'));
  try {
    const state = join(dir, 'state'), config = join(dir, 'config.json'), selected = ['--config', config];
    writeFileSync(config, JSON.stringify(enabledConfig(dir, state)));
    const cases: [string[], string][] = [
      [[...selected, '--unexpected'], "unknown argument '--unexpected'"],
      [[...selected, 'stray'], "unknown argument 'stray'"],
      [[...selected, '--status', '\u001b[2Jforged'], "unknown argument '\\u001b[2Jforged'"],
      [['--status', '--config'], '--config needs a path'],
      [['--config', 'relative.json', '--status'], "--config needs an absolute path, got 'relative.json'"],
      [[...selected, ...selected], '--config given twice'],
      [[...selected, '--status', '--json', '--json'], '--json given twice'],
      [[...selected, '--status', '--once'], '--status and --once cannot be combined; give one command'],
      [[...selected, '--pause', '--pause'], '--pause given twice'],
      [[...selected, '--retry'], '--retry needs a request id'],
      [[...selected, '--drop'], '--drop needs a request id'],
      [[...selected, '--retry', 'nonsense'], "--retry needs a request id as --status prints it, got 'nonsense'"],
      [[...selected, '--drop', REQUEST_ID.slice(1)], `--drop needs a request id as --status prints it, got '${REQUEST_ID.slice(1)}'`],
      [[...selected, '--exclude'], '--exclude needs a path'],
      [[...selected, '--unexclude', ''], '--unexclude needs a path'],
      [[...selected, '--json'], '--json needs a command; the daemon always prints JSON'],
      [[...selected, '--once', '--json'], '--json cannot be combined with --once, which always prints JSON'],
      [[...selected, '--status', '--apply'], '--apply needs --clear-policy-tombstones'],
    ];
    for (const [argv, message] of cases) {
      const result = invoke(join(dir, 'home'), undefined, argv, dir);
      assert.equal(result.stderr, usageError(message), argv.join(' ')); assert.equal(result.status, 2); assert.equal(result.stdout, '');
      assert.equal(existsSync(state), false);
    }
    const relativeHome = invoke('relative-home', undefined, ['--status'], dir);
    assert.equal(relativeHome.stderr, usageError("the default configuration path 'relative-home/.config/chronicle/collector.json' is not absolute; give --config PATH"));
    assert.equal(relativeHome.status, 2); assert.equal(relativeHome.stdout, '');
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication control commands answer with a sentence by default and the control state with --json', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chronicle-control-text-')));
  try {
    const state = join(dir, 'state'), config = join(dir, 'config.json'), project = join(dir, 'project'), other = join(dir, 'other'), nested = join(other, 'nested');
    mkdirSync(project); writeFileSync(config, JSON.stringify(enabledConfig(dir, state)));
    const answer = (...argv: string[]): string => {
      const result = invoke(dir, undefined, ['--config', config, ...argv], project);
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return result.stdout;
    };
    assert.equal(answer('--exclusions'), 'No excluded directories.\n');
    assert.equal(answer('--pause'), 'Collection paused. Queued uploads are kept; --resume continues.\n');
    assert.deepEqual(JSON.parse(answer('--pause', '--json')) as unknown, { paused: true, exclusions: [] });
    // A run while paused says so in its counters line and in one journal line with the same sentence.
    const held = invoke(dir, undefined, ['--config', config, '--once'], project);
    assert.deepEqual([held.status, (JSON.parse(held.stdout) as { paused: unknown }).paused, held.stderr], [0, 'collection-paused', 'chronicle-collector: collection-paused: Collection paused. Queued uploads are kept; --resume continues.\n']);
    assert.equal(answer('--resume'), 'Collection resumed.\n');
    assert.deepEqual(JSON.parse(answer('--json', '--resume')) as unknown, { paused: false, exclusions: [] });
    assert.equal(answer('--exclude', '.'), `Excluded ${project}.\n`);
    assert.equal(answer('--exclude', `${other}/gone/..`), `Excluded ${other}.\n`);
    assert.equal(answer('--exclusions'), `${other}\n${project}\n`);
    assert.deepEqual(JSON.parse(answer('--exclusions', '--json')) as unknown, { paused: false, exclusions: [other, project] });
    assert.equal(answer('--unexclude', nested), `Still excluded: ${nested} is under ${other}.\n`);
    mkdirSync(other); symlinkSync(other, join(dir, 'link'));
    assert.equal(answer('--unexclude', join(dir, 'link', 'nested')), `Still excluded: ${join(dir, 'link', 'nested')} is under ${other}.\n`);
    assert.equal(answer('--exclusions'), `${other}\n${project}\n`);
    assert.equal(answer('--unexclude', '.'), `No longer excluded: ${project}.\n`);
    assert.deepEqual(JSON.parse(answer('--unexclude', other, '--json')) as unknown, { paused: false, exclusions: [] });
    assert.deepEqual(JSON.parse(answer('--exclude', project, '--json')) as unknown, { paused: false, exclusions: [project] });
    assert.equal(answer('--unexclude', project), `No longer excluded: ${project}.\n`);
    const forged = join(dir, 'line\nExcluded /forged.');
    assert.equal(answer('--exclude', forged), `Excluded ${join(dir, 'line\\u000aExcluded /forged.')}.\n`);
    assert.equal(answer('--exclusions'), `${join(dir, 'line\\u000aExcluded /forged.')}\n`);
    assert.equal(answer('--unexclude', forged), `No longer excluded: ${join(dir, 'line\\u000aExcluded /forged.')}.\n`);
    assert.equal(answer('--exclusions'), 'No excluded directories.\n');
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication retry and drop answer with the human status by default and the JSON snapshot with --json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-queue-text-'));
  try {
    const state = join(dir, 'state'), config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify(enabledConfig(dir, state)));
    const stopped = (sourceKey: string): Pending => ({ requestId: randomUUID(), sourceKey, sourceDigest: hash(sourceKey), payload: 'synthetic', payloadDigest: hash('synthetic'), expectedRevision: 0, policyDigest: 'policy', attempts: 8, nextAt: 0, status: 'stopped', error: 'synthetic-stop' });
    const entries = ['first', 'second', 'third', 'fourth'].map(stopped);
    const spool = new SqliteSpool(state);
    try { for (const entry of entries) spool.enqueue(entry, { kind: 'explicit' }, null); } finally { spool.close(); }
    const answer = (...argv: string[]): string => {
      const result = invoke(dir, undefined, ['--config', config, ...argv], dir);
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return result.stdout;
    };
    const [first, second, third, fourth] = entries.map(entry => entry.requestId) as [string, string, string, string];
    const retried = answer('--retry', first);
    assert.match(retried, /^Chronicle collector: enabled/); assert.ok(retried.includes(`  ${first}: pending · attempts: 0 · next attempt: due · source: first\n`));
    assert.ok(retried.includes(`  ${second}: stopped · attempts: 8 · source: second\n`));
    const retriedJson = JSON.parse(answer('--retry', second, '--json')) as { queue: { requestId: string; status: string; attempts: number }[] };
    assert.deepEqual(retriedJson.queue.filter(entry => entry.status === 'pending' && entry.attempts === 0).map(entry => entry.requestId).sort(), [first, second].sort());
    const dropped = answer('--drop', third);
    assert.match(dropped, /^Chronicle collector: enabled/); assert.ok(dropped.includes(`Dropped: 1\n  ${third}: operator-drop · source: third\n`)); assert.ok(!dropped.includes(`  ${third}: stopped`));
    const droppedJson = JSON.parse(answer('--json', '--drop', fourth)) as { queue: { requestId: string }[]; dropped: { requestId: string; reason: string }[] };
    assert.deepEqual(droppedJson.queue.map(entry => entry.requestId).sort(), [first, second].sort());
    assert.deepEqual(droppedJson.dropped.map(entry => [entry.requestId, entry.reason]).sort(), [[third, 'operator-drop'], [fourth, 'operator-drop']].sort());
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication --clear-policy-tombstones lists, then once clears, only tombstones of a policy change while the daemon runs; the next scan collects the source', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chronicle-tombstones-')));
  let lock: DaemonLock | null = null;
  try {
    const state = join(dir, 'state'), config = join(dir, 'config.json'), sessions = join(dir, 'sessions'), transcript = join(sessions, 's.jsonl'), token = join(dir, 'token');
    mkdirSync(sessions); writeFileSync(token, 'synthetic-tombstone-token\n', { mode: 0o600 });
    const settings = { ...enabledConfig(dir, state), tokenFile: token, quietMs: 0, uploadProtocol: 'whole', roots: [{ id: 'fixture', format: 'pi', path: sessions }] };
    writeFileSync(config, JSON.stringify(settings));
    let accept = true;
    const ingester: Ingester = { async send(payload) {
      if (!accept) throw new UploadError('network-failed', true, false);
      const request = JSON.parse(payload) as { requestId: string; expectedRevision: number };
      return new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
    } };
    const raw = readFileSync(new URL('fixtures/pi.jsonl', import.meta.url), 'utf8');
    const answer = (...argv: string[]): string => {
      const result = invoke(dir, undefined, ['--config', config, '--clear-policy-tombstones', ...argv], dir);
      assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return result.stdout;
    };
    // The dry run opens the state read-only: absent state stays absent, existing state keeps its bytes and modes.
    assert.equal(answer(), 'No collector state yet: nothing to clear.\n'); assert.equal(existsSync(state), false);
    const spool = new SqliteSpool(state);
    const collect = (now: number) => new Collector(loadConfig(settings), spool, ingester, () => 0, lateClock, noGit, acceptingProgress, new FileSecretReader()).runOnce(now);
    try {
      // What an earlier release leaves: revision 1 acknowledged, then a policy change dropped the queued revision 2 and tombstoned its source.
      writeFileSync(transcript, raw); assert.equal((await collect(1)).uploaded, 1);
      writeFileSync(transcript, raw.replace('left branch', 'next branch')); accept = false; await collect(2);
      const [changed] = spool.queue(); assert.ok(changed !== undefined); spool.drop(changed.requestId, 'privacy-or-destination-changed');
      const dropped: Pending = { requestId: randomUUID(), sourceKey: 'dropped', sourceDigest: hash('dropped'), payload: 'synthetic', payloadDigest: hash('synthetic'), expectedRevision: 0, policyDigest: 'policy', attempts: 0, nextAt: 0, status: 'pending', error: null };
      spool.enqueue(dropped, { kind: 'explicit' }, null); spool.drop(dropped.requestId, 'operator-drop');
      spool.exclude(join(dir, 'excluded'));
      const database = new DatabaseSync(join(state, 'spool.sqlite'));
      try { database.prepare("INSERT INTO kv VALUES ('head', 'unattributed', ?)").run(JSON.stringify({ revision: 2, digest: 'unattributed', tombstone: true })); } finally { database.close(); }
      chmodSync(state, 0o750); chmodSync(join(state, 'spool.sqlite'), 0o640);
      const files = () => [statSync(state).mode, readdirSync(state).sort().map(name => [name, statSync(join(state, name)).mode, readFileSync(join(state, name))])];
      const before = files();
      const others = 'Other tombstones, not cleared: 2\n  dropped for another reason (operator-drop): 1\n  no recorded drop, reason unknown: 1\n    unattributed\n';
      assert.deepEqual(JSON.parse(answer('--json')) as unknown, { applied: false, policyChanged: [{ sourceKey: changed.sourceKey, revision: 1, acknowledged: true, files: [{ path: transcript, bytes: Buffer.byteLength(raw.replace('left branch', 'next branch')) }] }], unidentifiedFiles: 0, otherReasons: [{ sourceKey: 'dropped', reasons: ['operator-drop'] }], unattributed: ['unattributed'] });
      const listed = answer();
      assert.ok(listed.startsWith(`Not collected since a privacy or destination change: 1 source\n  ${changed.sourceKey} · last acknowledged revision 1\n    ${transcript} · `), listed);
      assert.ok(listed.endsWith(`${others}Dry run, nothing changed. --apply collects these sources again at the next scan.\n`), listed);
      assert.deepEqual(files(), before);
      lock = new DaemonLock(state);
      assert.equal(answer('--apply'), `Cleared: 1 source, collected again at the next scan\n  ${changed.sourceKey} · last acknowledged revision 1\n${others}`);
      assert.equal(answer('--apply'), `Cleared: none, no tombstone of a privacy or destination change is left\n${others}`);
      lock.close(); lock = null;
      assert.deepEqual([spool.head('dropped').tombstone, spool.head('unattributed').tombstone, spool.controls().exclusions], [true, true, [join(dir, 'excluded')]]);
      accept = true; const next = await collect(3);
      assert.equal(next.uploaded, 1);
      const { revision, digest, tombstone } = spool.head(changed.sourceKey); assert.deepEqual({ revision, digest, tombstone }, { revision: 2, digest: changed.sourceDigest, tombstone: false });
    } finally { spool.close(); }
  } finally { lock?.close(); rmSync(dir, { recursive: true }); }
});

test('GoodCommunication disabled configuration answers in text by default wherever a text form exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-disabled-text-'));
  try {
    const config = join(dir, 'config.json'), state = join(dir, 'state');
    writeFileSync(config, JSON.stringify({ enabled: false, stateDir: state }));
    for (const command of [['--exclusions'], ['--retry', REQUEST_ID], ['--drop', REQUEST_ID], ['--clear-policy-tombstones']]) {
      const human = invoke(dir, undefined, ['--config', config, ...command], dir);
      assert.equal(human.status, 0, human.stderr); assert.equal(human.stdout, 'Chronicle collector: disabled\n');
      const json = invoke(dir, undefined, ['--config', config, ...command, '--json'], dir);
      assert.equal(json.status, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout) as unknown, { enabled: false });
    }
    for (const command of [[], ['--once']]) {
      const result = invoke(dir, undefined, ['--config', config, ...command], dir);
      assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout) as unknown, { enabled: false });
    }
    assert.equal(existsSync(state), false);
  } finally { rmSync(dir, { recursive: true }); }
});

for (const [name, configHome] of [['unset', undefined], ['empty', ''], ['relative', 'relative-config']] as const) {
  test(`GoodCommunication CLI uses the home default when XDG_CONFIG_HOME is ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronicle-default-home-'));
    try {
      const home = join(dir, 'home'), directory = join(home, '.config', 'chronicle'), state = join(dir, 'state');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'collector.json'), JSON.stringify({ enabled: false, stateDir: state }));
      const result = invoke(home, configHome, ['--status', '--json'], dir);
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
    const result = invoke(home, configHome, ['--status', '--json'], dir);
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
    const result = invoke(home, configHome, ['--config', explicit, '--status', '--json'], dir);
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
      assert.equal(result.status, 2); assert.equal(result.stdout, '');
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

test('GoodCommunication status defaults to saved human-readable counters without credential reads or collection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-human-status-'));
  const state = join(dir, 'state'), config = join(dir, 'config.json');
  try {
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), stateDir: state,
      redactions: { secretFiles: [join(dir, 'missing-secret')] }, discoverNative: false, discoverYolo: false }));
    const report: CollectorReport = {
      at: Date.parse('2026-01-02T03:04:05Z'),
      counters: { enabled: true, discovered: 527, scanned: 527, scannedBytes: 1792738972, waiting: 6, excluded: 0, unchanged: 520,
        enqueued: 1, uploaded: 1, uploadFailures: 0, quarantined: 0, pending: 0, stopped: 0, conflicts: 0 },
      roots: [{ rootId: 'native', pathId: 'a'.repeat(64), format: 'pi', discovered: 527, scanned: 527, bytes: 1792738972, waiting: 6, excluded: 0, quarantined: 0 }],
    };
    const spool = new SqliteSpool(state);
    try {
      spool.saveReport(report);
      spool.diagnostic({ rootId: 'native', pathId: 'b'.repeat(64), code: 'root-missing' });
      const sequence = spool.nextReportSequence(); spool.reportAccepted(sequence, Date.parse('2026-01-02T03:07:05Z'));
    } finally { spool.close(); }
    const result = invoke(dir, undefined, ['--config', config, '--status'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Chronicle collector: enabled/m);
    assert.match(result.stdout, /2026-01-02T03:04:05\.000Z/);
    assert.match(result.stdout, /Scanned: 527/);
    assert.match(result.stdout, /Unchanged: 520/);
    assert.match(result.stdout, /Waiting: 6/);
    assert.match(result.stdout, /1\.67 GiB/);
    assert.match(result.stdout, /Queue: empty/);
    assert.match(result.stdout, /Uploaded: 1/);
    assert.match(result.stdout, /root missing/);
    assert.match(result.stdout, /Reporting: sequence 1, acknowledged 1/);
    assert.doesNotMatch(result.stdout, /^\s*\{/);
    assert.doesNotMatch(result.stdout + result.stderr, /missing-token|missing-secret|privacy-secret-unavailable/);
    assert.equal(existsSync(join(state, 'daemon-lock.sqlite')), false);
    const reopened = new SqliteSpool(state);
    try { assert.deepEqual(reopened.report(), report); assert.deepEqual(reopened.queue(), []); }
    finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication disabled status is human by default and JSON only when explicitly requested', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-disabled-status-'));
  try {
    const config = join(dir, 'config.json'), state = join(dir, 'state');
    writeFileSync(config, JSON.stringify({ enabled: false, stateDir: state }));
    const human = invoke(dir, undefined, ['--config', config, '--status'], dir);
    assert.equal(human.status, 0, human.stderr); assert.equal(human.stdout, 'Chronicle collector: disabled\n');
    const json = invoke(dir, undefined, ['--json', '--status', '--config', config], dir);
    assert.equal(json.status, 0, json.stderr); assert.deepEqual(JSON.parse(json.stdout) as unknown, { enabled: false });
    assert.equal(existsSync(state), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication fresh human status reports unknown scan and acknowledgement without inventing a run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-fresh-status-'));
  try {
    const config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), stateDir: join(dir, 'state'), discoverNative: false, discoverYolo: false }));
    const result = invoke(dir, undefined, ['--config', config, '--status'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No saved scan recorded/);
    assert.match(result.stdout, /Reporting: sequence 0, acknowledged never/);
    assert.doesNotMatch(result.stdout, /Scanned: 0|running|healthy/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('GoodCommunication JSON selection is refused for the daemon and --once, and duplicate flags fail before state creation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-status-flags-'));
  try {
    const config = join(dir, 'config.json'), state = join(dir, 'state');
    writeFileSync(config, JSON.stringify({ enabled: false, stateDir: state }));
    for (const argv of [['--json'], ['--once', '--json'], ['--status', '--json', '--json']]) {
      const result = invoke(dir, undefined, ['--config', config, ...argv], dir);
      assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.equal(existsSync(state), false);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('Behavioral GoodCommunication CLI controls and status bypass held daemon lock, retries/drops do not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-control-cli-'));
  let lock: DaemonLock | null = null;
  try {
    const state = join(dir, 'state'), config = join(dir, 'collector.json');
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), redactions: { secretFiles: [join(dir, 'missing-secret')] }, stateDir: state, discoverNative: false, discoverYolo: false }));
    lock = new DaemonLock(state);
    const call = (...args: string[]) => invoke(dir, undefined, ['--config', config, ...args], dir);
    for (const args of [['--pause', '--json'], ['--exclude', '.', '--json'], ['--exclusions', '--json'], ['--status', '--json']]) {
      const result = call(...args); assert.equal(result.status, 0, result.stderr);
      const value = JSON.parse(result.stdout) as { paused?: boolean; controls?: { paused: boolean; exclusions: string[] } };
      assert.equal(value.controls?.paused ?? value.paused, true);
    }
    const store = new SqliteSpool(state);
    try { assert.deepEqual(store.controls(), { paused: true, exclusions: [dir] }); } finally { store.close(); }
    for (const op of ['--retry', '--drop']) { const result = call(op, '00000000-0000-4000-8000-000000000001'); assert.equal(result.status, 1); assert.match(result.stderr, /collector-already-running/); }
    assert.equal(call('--unexclude', '.').status, 0); assert.equal(call('--resume').status, 0);
    writeFileSync(config, JSON.stringify({ enabled: false, stateDir: state }));
    for (const args of [['--pause'], ['--resume'], ['--exclude', '.'], ['--unexclude', '.']]) { const result = call(...args); assert.equal(result.status, 1); assert.match(result.stderr, /collector-disabled/); assert.equal(result.stdout, ''); }
    assert.equal(call('--once').status, 0); assert.equal(call('--status').status, 0);
  } finally { lock?.close(); rmSync(dir, { recursive: true }); }
});

test('Behavioral GoodCommunication simultaneous CLI mutations do not lose exclusions or pause updates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-control-concurrency-'));
  try {
    const state = join(dir, 'state'), config = join(dir, 'collector.json');
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'missing-token'), stateDir: state, discoverNative: false, discoverYolo: false }));
    const paths = Array.from({ length: 12 }, (_, i) => join(dir, `project-${i}`));
    const mutate = async (args: string[]) => {
      const child = spawn(process.execPath, [cli, '--config', config, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      let error = ''; child.stderr.on('data', (data: Buffer) => { error += data.toString(); });
      const [code] = await once(child, 'exit'); assert.equal(code, 0, error);
    };
    await Promise.all([...paths.map(path => mutate(['--exclude', path])), mutate(['--pause'])]);
    let store = new SqliteSpool(state);
    try { assert.equal(store.controls().paused, true); assert.deepEqual(store.controls().exclusions, [...paths].sort()); } finally { store.close(); }
    await Promise.all([...paths.filter((_, i) => i % 2 === 0).map(path => mutate(['--unexclude', path])), mutate(['--resume'])]);
    store = new SqliteSpool(state);
    try { assert.equal(store.controls().paused, false); assert.deepEqual(store.controls().exclusions, paths.filter((_, i) => i % 2 === 1).sort()); } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true }); }
});
