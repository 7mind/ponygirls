import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ChroniclePreferences, normalizeChronicleEndpoint } from '../src/chronicle-preferences.ts';
import { acquireSessionLock } from '../src/store.ts';

const pin = 'a'.repeat(64);
const empty = { enabled: false, endpoint: '', tokenFile: '', collectorNamespace: '', tokenHash: null };
const destination = { endpoint: 'https://chronicle.example/api/ingest', tokenFile: '/run/user/1000/chronicle-token', collectorNamespace: 'historian-installation-fixture' };
const approved = { enabled: true, ...destination, tokenHash: pin };

// Specified contracts: endpoint validation is blackbox/atomic; persistence and locks use an owned real filesystem.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-chronicle-preferences-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const agentDir = join(directory, 'agent');
  const preferences = new ChroniclePreferences(join(agentDir, 'historian-chronicle.json'));
  const managedPath = join(agentDir, 'historian-chronicle-defaults.json');
  const put = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { directory, agentDir, preferences, managedPath, put };
}

test('Chronicle endpoints normalize origins and full ingest URLs without a network lookup', () => {
  for (const [input, expected] of [
    ['https://chronicle.example', 'https://chronicle.example/api/ingest'],
    ['https://CHRONICLE.example:443/', 'https://chronicle.example/api/ingest'],
    ['https://chronicle.example:8443/api/ingest', 'https://chronicle.example:8443/api/ingest'],
    ['http://localhost:8080', 'http://localhost:8080/api/ingest'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080/api/ingest'],
    ['http://127.20.3.4/api/ingest', 'http://127.20.3.4/api/ingest'],
    ['http://[::1]:8080', 'http://[::1]:8080/api/ingest'],
  ]) assert.equal(normalizeChronicleEndpoint(input), expected, input);
});

test('Chronicle endpoints reject insecure remote routes, URL credentials and ambiguous destinations', () => {
  for (const input of [
    '', 'not a URL', '/api/ingest', 'https:chronicle.example', 'ftp://localhost',
    'http://chronicle.example', 'http://192.168.1.2', 'http://0.0.0.0', 'http://[::]',
    'http://localhost.example', 'http://127.0.0.1.example',
    'https://user:password@chronicle.example', 'https://@chronicle.example',
    'https://chronicle.example?token=secret', 'https://chronicle.example?',
    'https://chronicle.example/#fragment', 'https://chronicle.example#',
    'https://chronicle.example/other', 'https://chronicle.example/api/ingest/',
    'https://chronicle.example/other/../api/ingest',
    ' https://chronicle.example', 'https://chronicle.example\n',
    'https://chronicle.example\\api\\ingest', 'https://chronicle.example/\0',
    null, 7, {},
  ]) assert.throws(() => normalizeChronicleEndpoint(input), /Chronicle endpoint/, String(input));
});

test('absent Chronicle preferences read OFF without creating directories, files or an installation ID', t => {
  const f = fixture(t);
  assert.equal(f.preferences.path, join(f.agentDir, 'historian-chronicle.json'));
  assert.deepEqual(f.preferences.read(), empty);
  assert.deepEqual(f.preferences.read(), empty);
  assert.equal(existsSync(f.agentDir), false);
});

test('managed Chronicle fallback is read-only, complete and never grants upload approval', t => {
  const f = fixture(t);
  const target = join(f.directory, 'managed.json');
  const bytes = `${JSON.stringify({ version: 1, ...destination, endpoint: 'https://chronicle.example' }, null, 2)}\n`;
  f.put(target, bytes);
  mkdirSync(f.agentDir);
  symlinkSync(target, f.managedPath);
  assert.deepEqual(f.preferences.read(), { enabled: false, ...destination, tokenHash: null });
  assert.equal(lstatSync(f.managedPath).isSymbolicLink(), true);
  assert.equal(readFileSync(target, 'utf8'), bytes);
  assert.equal(existsSync(f.preferences.path), false);
  assert.equal(existsSync(join(f.agentDir, 'historian')), false);
});

test('a writable global destination overrides the entire managed destination without field merging', t => {
  const f = fixture(t);
  f.put(f.managedPath, { version: 1, ...destination });
  f.put(f.preferences.path, { version: 1, ...empty });
  assert.deepEqual(f.preferences.read(), empty);
  f.put(f.managedPath, '{malformed managed data');
  assert.deepEqual(f.preferences.read(), empty, 'shadowed managed data must not affect local settings');
  f.preferences.update(() => ({ ...approved, collectorNamespace: 'explicit-global' }));
  assert.equal(f.preferences.read().collectorNamespace, 'explicit-global');
});

test('project files cannot supply Chronicle routes, credentials, namespace or upload approval', t => {
  const f = fixture(t);
  const project = join(f.directory, 'project');
  f.put(join(project, '.pi', 'historian-chronicle.json'), { version: 1, ...approved });
  f.put(join(project, '.pi', 'historian-chronicle-defaults.json'), { version: 1, ...destination });
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { ChroniclePreferences } from ${JSON.stringify(new URL('../src/chronicle-preferences.ts', import.meta.url).href)};
    console.log(JSON.stringify(new ChroniclePreferences(${JSON.stringify(f.preferences.path)}).read()));
  `], { cwd: project, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), empty);
  assert.equal(existsSync(f.agentDir), false);
});

test('malformed writable documents fail closed instead of inheriting managed destinations', t => {
  const f = fixture(t);
  f.put(f.managedPath, { version: 1, ...destination });
  for (const raw of [
    '{', 'null', '[]', '7',
    { version: 0, ...approved }, { version: 2, ...approved }, { version: '1', ...approved },
    { version: 1, ...approved, extra: true },
    ...Object.keys(approved).map(key => {
      const value = { version: 1, ...approved };
      delete value[key];
      return value;
    }),
    { version: 1, ...approved, enabled: 'true' },
    { version: 1, ...approved, endpoint: 5 },
    { version: 1, ...approved, tokenFile: null },
    { version: 1, ...approved, collectorNamespace: false },
    { version: 1, ...approved, tokenHash: 12 },
    { version: 1, ...approved, tokenHash: null },
  ]) {
    f.put(f.preferences.path, raw);
    const bytes = readFileSync(f.preferences.path, 'utf8');
    assert.throws(() => f.preferences.read(), /Invalid Historian Chronicle preferences/, bytes);
    assert.equal(readFileSync(f.preferences.path, 'utf8'), bytes);
  }
});

test('managed Chronicle documents reject incomplete shapes, enablement, pins and unsupported versions', t => {
  const f = fixture(t);
  for (const raw of [
    '{', 'null', '[]',
    { version: 2, ...destination }, { version: 1, ...destination, extra: true },
    { version: 1, ...destination, enabled: false },
    { version: 1, ...destination, tokenHash: null },
    { version: 1, ...destination, endpoint: '' },
    { version: 1, ...destination, tokenFile: '' },
    { version: 1, ...destination, collectorNamespace: '' },
    ...Object.keys(destination).map(key => {
      const value = { version: 1, ...destination };
      delete value[key];
      return value;
    }),
  ]) {
    f.put(f.managedPath, raw);
    assert.throws(() => f.preferences.read(), /Invalid Historian Chronicle managed defaults/);
    assert.equal(existsSync(f.preferences.path), false);
  }
});

test('OFF accepts incomplete destinations but ON requires all destination fields and a lowercase bearer hash pin', t => {
  const f = fixture(t);
  f.preferences.update(() => empty);
  assert.deepEqual(f.preferences.read(), empty);
  for (const key of ['endpoint', 'tokenFile', 'collectorNamespace']) {
    const partial = { ...empty, [key]: destination[key] };
    f.preferences.update(() => partial);
    assert.deepEqual(f.preferences.read(), partial);
    assert.throws(() => f.preferences.update(current => ({ ...current, enabled: true })), /Chronicle/);
    assert.deepEqual(f.preferences.read(), partial);
  }
  for (const tokenHash of [null, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'z'.repeat(64)]) {
    assert.throws(() => f.preferences.update(() => ({ ...approved, tokenHash })), /Chronicle/);
  }
  f.preferences.update(() => approved);
  assert.deepEqual(f.preferences.read(), approved);
  f.preferences.update(current => ({ ...current, enabled: false }));
  assert.deepEqual(f.preferences.read(), { ...approved, enabled: false }, 'OFF retains the existing approval pin');
  f.preferences.update(current => ({ ...current, enabled: false, tokenHash: null }));
  assert.equal(f.preferences.read().tokenHash, null, 'reconfiguration can explicitly clear the pin');
});

test('destination strings reject relative/store token paths and invalid namespaces even while OFF', t => {
  const f = fixture(t);
  const invalid = [
    { endpoint: 'http://remote.example' },
    { tokenFile: 'relative/token' }, { tokenFile: '/nix/store/token' }, { tokenFile: '/nix/store' },
    { tokenFile: '/run/../nix/store/token' }, { tokenFile: '/nix//store/token' },
    { tokenFile: '/tmp/token\0' },
    { collectorNamespace: ' ' }, { collectorNamespace: 'a'.repeat(257) },
    { collectorNamespace: 'namespace\0suffix' },
    { tokenHash: 'not-a-hash' },
  ];
  for (const patch of invalid) {
    assert.throws(() => f.preferences.update(() => ({ ...empty, ...patch })), /Chronicle/, JSON.stringify(patch));
    assert.equal(existsSync(f.preferences.path), false);
  }
  f.preferences.update(() => ({ ...approved, collectorNamespace: 'a'.repeat(256), tokenFile: '/nix/store-not-a-secret/token' }));
  assert.equal(f.preferences.read().collectorNamespace.length, 256);
});

test('collector namespaces must contain Unicode scalar values rather than lone UTF-16 surrogates', t => {
  const f = fixture(t);
  for (const collectorNamespace of ['namespace-\ud800', 'namespace-\udc00', '\udc00\ud800']) {
    assert.throws(() => f.preferences.update(() => ({ ...approved, collectorNamespace })), /Chronicle collector namespace/);
    assert.equal(existsSync(f.preferences.path), false);
  }
  f.preferences.update(() => ({ ...approved, collectorNamespace: 'namespace-\ud83d\ude00' }));
  assert.equal(f.preferences.read().collectorNamespace, 'namespace-\ud83d\ude00');
});

test('the namespace bound counts UTF-16 code units rather than UTF-8 bytes', t => {
  const f = fixture(t);
  for (const collectorNamespace of ['é'.repeat(129), 'é'.repeat(256), '😀'.repeat(128)]) {
    f.preferences.update(() => ({ ...approved, collectorNamespace }));
    assert.equal(f.preferences.read().collectorNamespace, collectorNamespace);
  }
  const before = readFileSync(f.preferences.path, 'utf8');
  assert.throws(() => f.preferences.update(() => ({ ...approved, collectorNamespace: '😀'.repeat(129) })), /Chronicle collector namespace/);
  assert.equal(readFileSync(f.preferences.path, 'utf8'), before);
});

test('the preferences layer never opens bearer files, even for approved ON configuration', t => {
  const f = fixture(t);
  const tokenDirectory = join(f.directory, 'not-a-readable-token-file');
  mkdirSync(tokenDirectory);
  const value = { ...approved, tokenFile: tokenDirectory };
  f.preferences.update(() => value);
  assert.deepEqual(f.preferences.read(), value);
  rmSync(tokenDirectory, { recursive: true });
  assert.deepEqual(f.preferences.read(), value, 'missing credentials must not invalidate local canonical work');
});

test('updates write an exact private versioned document and atomically replace rather than follow a symlink', t => {
  const f = fixture(t);
  const target = join(f.directory, 'old-config.json');
  f.put(target, { version: 1, ...empty });
  mkdirSync(f.agentDir);
  symlinkSync(target, f.preferences.path);
  const before = readFileSync(target, 'utf8');
  f.preferences.update(() => ({ ...approved, endpoint: 'https://CHRONICLE.example:443' }));
  assert.equal(lstatSync(f.preferences.path).isSymbolicLink(), false);
  assert.equal(readFileSync(target, 'utf8'), before);
  assert.equal(statSync(f.preferences.path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(f.preferences.path, 'utf8')), { version: 1, ...approved });
  assert.equal(readdirSync(f.agentDir).some(name => name.endsWith('.tmp')), false);
});

test('updates re-read current global state and do not modify independent capture preferences', t => {
  const f = fixture(t);
  const capturePath = join(f.agentDir, 'historian.json');
  const captureBytes = '{"version":2,"enabled":true,"model":{"provider":"fixture"}}\n';
  f.put(capturePath, captureBytes);
  const release = acquireSessionLock(join(f.agentDir, 'historian'), 'global-preferences');
  try { f.preferences.update(() => ({ ...approved, enabled: false })); }
  finally { release(); }
  const other = new ChroniclePreferences(f.preferences.path);
  other.update(current => ({ ...current, collectorNamespace: 'second-writer' }));
  f.preferences.update(current => {
    assert.equal(current.collectorNamespace, 'second-writer');
    return { ...current, enabled: true };
  });
  assert.equal(other.read().enabled, true);
  assert.equal(readFileSync(capturePath, 'utf8'), captureBytes);
});

test('invalid replacements and callback errors preserve the previous document and release the lock', t => {
  const f = fixture(t);
  f.preferences.update(() => approved);
  const before = readFileSync(f.preferences.path, 'utf8');
  for (const change of [
    () => ({ ...approved, extra: 'unknown' }),
    () => ({ ...approved, version: 1 }),
    () => ({ enabled: false }),
    () => undefined,
    () => { throw new Error('callback failed'); },
  ]) {
    assert.throws(() => f.preferences.update(change));
    assert.equal(readFileSync(f.preferences.path, 'utf8'), before);
  }
  assert.throws(() => f.preferences.withSnapshot(() => { throw new Error('snapshot failed'); }), /snapshot failed/);
  f.preferences.update(current => ({ ...current, enabled: false }));
  assert.equal(f.preferences.read().enabled, false);
});

test('snapshot and mutation callbacks must finish synchronously and reject promises or thenables', async t => {
  const f = fixture(t);
  f.preferences.update(() => approved);
  const before = readFileSync(f.preferences.path, 'utf8');
  for (const result of [Promise.resolve(approved), Promise.reject(new Error('rejected promise')), { then(_resolve, reject) { reject(new Error('rejected thenable')); } }]) {
    assert.throws(() => f.preferences.update(() => result), /synchronous callbacks/);
    assert.equal(readFileSync(f.preferences.path, 'utf8'), before);
  }
  assert.throws(() => f.preferences.withSnapshot(async () => approved), /synchronous callbacks/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.preferences.withSnapshot(() => 'released'), 'released');
});

test('a snapshot excludes concurrent settings changes in this process and returns the callback result', t => {
  const f = fixture(t);
  f.preferences.update(() => approved);
  const other = new ChroniclePreferences(f.preferences.path);
  assert.equal(f.preferences.withSnapshot(current => {
    assert.deepEqual(current, approved);
    assert.throws(() => other.update(value => ({ ...value, enabled: false })), /already owned/);
    assert.throws(() => other.withSnapshot(() => undefined), /already owned/);
    assert.deepEqual(other.read(), approved);
    return 'canonical commit completed';
  }), 'canonical commit completed');
  other.update(current => ({ ...current, enabled: false }));
  assert.equal(f.preferences.read().enabled, false);
});

test('a snapshot holds the same short cross-process lock as ON/OFF updates', { timeout: 15000 }, t => {
  const f = fixture(t);
  f.preferences.update(() => approved);
  f.preferences.withSnapshot(() => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { ChroniclePreferences } from ${JSON.stringify(new URL('../src/chronicle-preferences.ts', import.meta.url).href)};
      try {
        new ChroniclePreferences(${JSON.stringify(f.preferences.path)}).update(current => ({ ...current, enabled: false }));
        process.exit(24);
      } catch (error) {
        if (!/already owned/.test(String(error))) throw error;
        process.exit(23);
      }
    `], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 23, child.stderr);
    assert.deepEqual(f.preferences.read(), approved);
  });
  f.preferences.update(current => ({ ...current, enabled: false }));
  assert.equal(f.preferences.read().enabled, false);
});
