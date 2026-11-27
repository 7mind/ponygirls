// Runtime regressions for combining upstream daemon proof with Linux ownership.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const dist = path.resolve(process.argv[2]);
const { Daemon, parseClientHelloLine, peerIsDead, tryAcquireDaemonLock } = require(path.join(dist, 'mcp/daemon.js'));
const { getDaemonPidPath, getDaemonSocketPath } = require(path.join(dist, 'mcp/daemon-paths.js'));
const { listDaemons } = require(path.join(dist, 'mcp/daemon-registry.js'));
const { makeFallbackEngine } = require(path.join(dist, 'mcp/index.js'));
const { daemonKey, readDaemonKey, daemonKeyPath } = require(path.join(dist, 'mcp/daemon-proof.js'));
const { exploreViaDaemon } = require(path.join(dist, 'mcp/hook-client.js'));
const { connectWithHello } = require(path.join(dist, 'mcp/proxy.js'));
const { namespaceIdentity, tryKernelLock, releaseKernelLock } = require(path.join(dist, 'kernel-lock.js'));
const { CodeGraphPackageVersion } = require(path.join(dist, 'mcp/version.js'));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-proof-'));
  const saved = { ...process.env };
  process.env.HOME = path.join(root, 'client-home');
  process.env.CODEGRAPH_SOCKET_DIR = path.join(root, 'shared');
  process.env.CODEGRAPH_TELEMETRY = '0';
  delete process.env.CODEGRAPH_NO_DAEMON;
  fs.mkdirSync(process.env.HOME);
  return {
    root,
    cleanup() {
      for (const k of ['HOME', 'CODEGRAPH_SOCKET_DIR', 'CODEGRAPH_TELEMETRY', 'CODEGRAPH_NO_DAEMON']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function nextLine(stream) {
  const lines = readline.createInterface({ input: stream });
  return Promise.race([
    once(lines, 'line').then(([line]) => line),
    once(lines, 'close').then(() => assert.fail('closed without a line')),
  ]).finally(() => lines.close());
}

// Namespace metadata governs liveness; authentication does not confer local PID identity.
test('client hello carries both the namespace and the bounded challenge', () => {
  const hello = { codegraph_client: 1, pid: 42, hostPid: 10, namespace: 'foreign', challenge: 'nonce' };
  const peer = parseClientHelloLine(JSON.stringify(hello));
  assert.deepEqual(peer, { pid: 42, hostPid: 10, namespace: 'foreign', challenge: 'nonce' });
  assert.equal(peerIsDead(peer, () => assert.fail('foreign PID was probed')), false);
  const local = parseClientHelloLine(JSON.stringify({ ...hello, namespace: namespaceIdentity(), challenge: 'x'.repeat(257) }));
  assert.equal(local.challenge, undefined);
  assert.equal(peerIsDead(local, pid => { assert.equal(pid, 42); return false; }), true);
});

test('proof key lookup does not create paths and refuses unsafe shared directories', () => {
  const { root, cleanup } = fixture();
  try {
    const dir = process.env.CODEGRAPH_SOCKET_DIR;
    assert.equal(readDaemonKey(), null);
    assert.equal(fs.existsSync(dir), false);
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.writeFileSync(daemonKeyPath(), Buffer.alloc(32), { mode: 0o600 });
    assert.equal(readDaemonKey(), null);
    assert.equal(daemonKey(), null);
    const backing = path.join(root, 'backing');
    fs.renameSync(dir, backing);
    fs.chmodSync(backing, 0o700);
    fs.symlinkSync(backing, dir);
    assert.equal(readDaemonKey(), null);
    assert.equal(daemonKey(), null);
  } finally { cleanup(); }
});

test('owned daemon and proxy attach with different homes through the private shared key', { timeout: 15000 }, async () => {
  const { root, cleanup } = fixture();
  let child;
  let socket;
  try {
    const daemonHome = path.join(root, 'daemon-home');
    fs.mkdirSync(daemonHome);
    child = spawn(process.execPath, ['--liftoff-only', '-e', `
      const assert = require('node:assert/strict');
      const { Daemon, tryAcquireDaemonLock } = require(${JSON.stringify(path.join(dist, 'mcp/daemon.js'))});
      const root = process.argv[1];
      assert.equal(tryAcquireDaemonLock(root).kind, 'acquired');
      new Daemon(root).start().then(({ socketPath }) => console.log(socketPath)).catch(e => { console.error(e); process.exitCode = 1; });
    `, root], { env: { ...process.env, HOME: daemonHome, CODEGRAPH_QUERY_POOL_SIZE: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const socketPath = await nextLine(child.stdout);
    assert.equal(fs.statSync(daemonKeyPath()).mode & 0o777, 0o600);
    socket = await connectWithHello(socketPath);
    assert.ok(socket instanceof net.Socket);
    assert.equal(fs.existsSync(path.join(daemonHome, '.codegraph', 'daemon.key')), false);
    assert.equal(fs.existsSync(path.join(process.env.HOME, '.codegraph', 'daemon.key')), false);
    const response = nextLine(socket);
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proof-fixture', version: '1' },
    } }) + '\n');
    const message = JSON.parse(await response);
    assert.equal(message.id, 5);
    assert.equal(message.result.serverInfo.version, CodeGraphPackageVersion);
  } finally {
    if (socket instanceof net.Socket) socket.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    cleanup();
  }
});

test('proxy and hook send no session bytes to an unproven daemon', { timeout: 10000 }, async () => {
  const { root, cleanup } = fixture();
  const received = [];
  const dir = path.join(root, '.codegraph');
  fs.mkdirSync(dir, { mode: 0o700 });
  const socketPath = path.join(dir, 'daemon.sock');
  const server = net.createServer(socket => {
    const lines = readline.createInterface({ input: socket });
    const messages = [];
    received.push(messages);
    socket.write(JSON.stringify({ protocol: 1, codegraph: CodeGraphPackageVersion, namespace: 'foreign', pid: 42 }) + '\n');
    lines.on('line', line => {
      messages.push(JSON.parse(line));
      if (messages.length === 1) socket.write('{"codegraph_proof":"bad"}\n');
    });
  });
  try {
    assert.ok(daemonKey());
    server.listen(socketPath);
    await once(server, 'listening');
    assert.equal(await connectWithHello(socketPath), 'unproven');
    assert.deepEqual(await exploreViaDaemon(root, 'owned prompt', 2000), { status: 'unavailable' });
    await new Promise(resolve => server.close(resolve));
    assert.equal(received.length, 2);
    for (const messages of received) {
      assert.equal(messages.length, 1);
      assert.equal(messages[0].codegraph_client, 1);
      assert.equal(messages[0].namespace, namespaceIdentity());
      assert.equal(typeof messages[0].challenge, 'string');
    }
  } finally { server.close(); cleanup(); }
});

test('an unproven answer does not permit a foreign-owner MCP fallback', { timeout: 15000 }, async () => {
  const { root, cleanup } = fixture();
  const bin = path.join(dist, 'bin/codegraph.js');
  let proxy;
  let fence = null;
  let stderr = '';
  let input;
  const received = [];
  const server = net.createServer(socket => {
    const lines = readline.createInterface({ input: socket });
    socket.write(JSON.stringify({ protocol: 1, codegraph: CodeGraphPackageVersion, namespace: 'foreign', pid: 42 }) + '\n');
    lines.on('line', line => {
      received.push(JSON.parse(line));
      socket.write('{"codegraph_proof":"bad"}\n');
    });
  });
  try {
    const env = { ...process.env, CODEGRAPH_NO_UPDATE_CHECK: '1', CODEGRAPH_DAEMON_RETRY_MS: '0' };
    delete env.CODEGRAPH_DAEMON_INTERNAL;
    const project = path.join(root, 'proj');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'fixture.ts'), 'export function ownedFixture() { return 42; }\n');
    const initialized = spawnSync(process.execPath, ['--liftoff-only', bin, 'init', project, '--yes'], { cwd: project, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    const socketPath = path.join(project, '.codegraph', 'daemon.sock');
    const pidPath = path.join(project, '.codegraph', 'daemon.pid');
    const record = JSON.stringify({ pid: 2147483647, namespace: 'foreign', version: CodeGraphPackageVersion, socketPath, startedAt: 1, lockProtocol: 'flock-v1' });
    fence = tryKernelLock(pidPath + '.flock');
    assert.notEqual(fence, null);
    fs.writeFileSync(pidPath, record);
    const writerPath = path.join(project, '.codegraph', 'writer.pid');
    assert.equal(fs.existsSync(writerPath), false);
    server.listen(socketPath);
    await once(server, 'listening');
    proxy = spawn(process.execPath, ['--liftoff-only', bin, 'serve', '--mcp', '--path', project], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    proxy.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    input = readline.createInterface({ input: proxy.stdout });
    const replies = input[Symbol.asyncIterator]();
    const call = async (id, method, params) => {
      proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const item = await replies.next();
      assert.equal(item.done, false, stderr);
      const reply = JSON.parse(item.value);
      assert.equal(reply.id, id, stderr);
      return reply;
    };
    const init = await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proof-fixture', version: '1' } });
    assert.ok(init.result);
    proxy.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const result = await call(2, 'tools/call', { name: 'codegraph_explore', arguments: { query: 'ownedFixture' } });
    assert.match(result.error?.message ?? '', /foreign or unknown PID namespace; refusing in-process fallback/);
    assert.equal(fs.readFileSync(pidPath, 'utf8'), record);
    assert.equal(fs.existsSync(writerPath), false);
    assert.deepEqual(received.map(msg => msg.codegraph_client), [1]);
  } finally {
    input?.close();
    if (proxy && proxy.exitCode === null && proxy.signalCode === null) {
      const exited = once(proxy, 'exit');
      proxy.kill('SIGTERM');
      await exited;
    }
    server.close();
    if (fence !== null) releaseKernelLock(fence);
    cleanup();
  }
});

test('writable fallback admission requires the daemon fence even before a record exists', async () => {
  const { root, cleanup } = fixture();
  const daemonRecord = getDaemonPidPath(root);
  const daemonFence = daemonRecord + '.flock';
  const writerRecord = path.join(path.dirname(daemonRecord), 'writer.pid');
  let engine;
  let fd = tryKernelLock(daemonFence);
  try {
    assert.notEqual(fd, null);
    assert.equal(fs.existsSync(daemonRecord), false);
    assert.throws(() => { engine = makeFallbackEngine(root); }, /refusing writable in-process fallback/);
    assert.equal(fs.existsSync(writerRecord), false);
    releaseKernelLock(fd);
    fd = null;
    engine = makeFallbackEngine(root);
    assert.equal(engine.isReadOnly(), false);
    assert.equal(fs.existsSync(writerRecord), true);
    fd = tryKernelLock(daemonFence);
    assert.notEqual(fd, null, 'fallback retained the daemon admission fence');
  } finally {
    if (fd !== null) releaseKernelLock(fd);
    await engine?.stop();
    cleanup();
  }
});

test('daemon startup refuses an invalid shared proof directory before advertising its in-project socket', async () => {
  const { root, cleanup } = fixture();
  const pidPath = getDaemonPidPath(root);
  const socketPath = getDaemonSocketPath(root);
  try {
    assert.equal(socketPath, path.join(root, '.codegraph', 'daemon.sock'));
    fs.mkdirSync(process.env.CODEGRAPH_SOCKET_DIR, { mode: 0o755 });
    fs.chmodSync(process.env.CODEGRAPH_SOCKET_DIR, 0o755);
    assert.equal(tryAcquireDaemonLock(root).kind, 'acquired');
    await assert.rejects(new Daemon(root).start(), /Cannot prepare the daemon proof key/);
    assert.equal(fs.existsSync(socketPath), false);
    assert.equal(fs.existsSync(pidPath), false);
    assert.equal(fs.existsSync(path.join(path.dirname(pidPath), 'writer.pid')), false);
    assert.equal(listDaemons({ prune: false }).some(entry => entry.root === root), false);
    for (const file of [pidPath, path.join(path.dirname(pidPath), 'writer.pid')]) {
      const fd = tryKernelLock(file + '.flock');
      assert.notEqual(fd, null);
      releaseKernelLock(fd);
    }
  } finally { cleanup(); }
});
