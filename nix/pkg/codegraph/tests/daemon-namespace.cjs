// Runtime regression tests: node daemon-namespace.cjs /absolute/path/to/dist
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const dist = path.resolve(process.argv[2]);
const daemon = require(path.join(dist, 'mcp/daemon.js'));
const registry = require(path.join(dist, 'mcp/daemon-registry.js'));
const kernel = require(path.join(dist, 'kernel-lock.js'));
const identity = kernel.namespaceIdentity();
const paths = require(path.join(dist, 'mcp/daemon-paths.js'));
function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-daemon-ns-')); }
function record(namespace, protocol = 'flock-v1') {
  return { pid: 2147483647, namespace, lockProtocol: protocol, version: '1.6.2', socketPath: '/nonexistent.sock', startedAt: 1 };
}
function put(root, rec) {
  const p = paths.getDaemonPidPath(root); fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(rec)); return p;
}
test('foreign/unknown peers are socket-owned and never probed', () => {
  for (const namespace of [undefined, '', 'foreign']) {
    assert.equal(daemon.peerIsDead({ pid: 1518589, hostPid: 10, namespace }, () => assert.fail('foreign PID probe')), false);
  }
  assert.equal(daemon.peerIsDead({ pid: 10, hostPid: 1518589, namespace: identity }, pid => pid === 10), false);
  assert.equal(daemon.peerIsDead({ pid: 10, hostPid: null, namespace: identity }, () => false), true);
});
test('foreign/legacy explicit stop and forced recovery neither probe, signal, nor delete', async () => {
  for (const rec of [record('foreign'), record(undefined, undefined)]) {
    if (!rec.namespace) delete rec.lockProtocol;
    const root = fixture(); const p = put(root, rec); const raw = fs.readFileSync(p, 'utf8');
    const originalKill = process.kill;
    const liveFd = rec.namespace ? kernel.tryKernelLock(p + '.flock') : null;
    try {
      process.kill = () => assert.fail('foreign/legacy PID probe or signal');
      assert.equal((await registry.stopDaemonAt(root)).outcome, 'unverified');
      assert.equal(daemon.clearStaleDaemonLock(p, rec.pid, { allowLivePid: true }), false);
      assert.equal(fs.readFileSync(p, 'utf8'), raw);
    } finally { process.kill = originalKill; if (liveFd !== null) kernel.releaseKernelLock(liveFd); fs.rmSync(root, { recursive: true, force: true }); }
  }
});
test('same-version foreign record permits kernel-arbitrated relaunch and dead cleanup', async () => {
  const root = fixture(); const p = put(root, record('namespace-that-exited'));
  const originalKill = process.kill;
  try {
    process.kill = () => assert.fail('foreign PID probe or signal');
    assert.equal(await registry.stopOlderDaemon(root, '1.6.2'), null);
    assert.equal((await registry.stopDaemonAt(root)).outcome, 'not-running');
    assert.equal(fs.existsSync(p), false);
  } finally { process.kill = originalKill; fs.rmSync(root, { recursive: true, force: true }); }
});
test('foreign PID numerically equal to this process is not reentrant ownership', async () => {
  const root = fixture(); const rec = { ...record('foreign-namespace'), pid: process.pid };
  const p = put(root, rec);
  fs.writeFileSync(path.join(path.dirname(p), 'writer.pid'), JSON.stringify({ ...rec, mode: 'daemon' }));
  const originalKill = process.kill;
  try {
    process.kill = () => assert.fail('foreign PID probe or signal');
    assert.equal(await registry.clearStaleDaemonArtifacts(root), true);
    assert.equal(fs.existsSync(p), false);
  } finally { process.kill = originalKill; fs.rmSync(root, { recursive: true, force: true }); }
});
test('cleanup does not reenter or release this process actual writer fence', async () => {
  const root = fixture(); const p = put(root, record('foreign-namespace'));
  const writer = require(path.join(dist, 'mcp/writer-lock.js'));
  try {
    assert.equal(writer.tryAcquireWriterLock(root, 'test').kind, 'acquired');
    assert.equal(await registry.clearStaleDaemonArtifacts(root), false);
    assert.ok(fs.existsSync(p));
    const child = spawnSync(process.execPath, ['-e', `const w=require(${JSON.stringify(path.join(dist, 'mcp/writer-lock.js'))});if(w.tryAcquireWriterLock(${JSON.stringify(root)},'test').kind!=='taken')throw Error('cleanup released actual writer')`], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  } finally { writer.releaseWriterLock(root); fs.rmSync(root, { recursive: true, force: true }); }
});
test('exited current-protocol foreign daemon can be relaunched without PID probes', () => {
  const root = fixture(); const p = put(root, record('namespace-that-exited'));
  const originalKill = process.kill;
  try {
    process.kill = () => assert.fail('foreign PID probe or signal');
    assert.equal(daemon.tryAcquireDaemonLock(root).kind, 'acquired');
    const next = JSON.parse(fs.readFileSync(p));
    assert.equal(next.namespace, identity);
    assert.equal(next.pid, process.pid);
  } finally { process.kill = originalKill; fs.rmSync(root, { recursive: true, force: true }); }
});
test('live daemon ownership cannot be stolen through namespace-invisible PID', () => {
  const root = fixture();
  try {
    const held = daemon.tryAcquireDaemonLock(root); assert.equal(held.kind, 'acquired');
    const rec = JSON.parse(fs.readFileSync(held.pidPath));
    fs.writeFileSync(held.pidPath, JSON.stringify({ ...rec, pid: 2147483647 }));
    const child = spawnSync(process.execPath, ['-e', `const d=require(${JSON.stringify(path.join(dist, 'mcp/daemon.js'))});if(d.tryAcquireDaemonLock(${JSON.stringify(root)}).kind!=='taken')throw Error('stole daemon');if(d.clearStaleDaemonLock(${JSON.stringify(held.pidPath)},2147483647,{allowLivePid:true}))throw Error('cleared live daemon')`], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(fs.existsSync(held.pidPath));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
