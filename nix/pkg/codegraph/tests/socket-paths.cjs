// Shared rendezvous path regression: node socket-paths.cjs /absolute/dist
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { console.error('FAIL', name, e); process.exitCode = 1; } }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const paths = require(path.join(path.resolve(process.argv[2]), 'mcp/daemon-paths.js'));
const previous = process.env.CODEGRAPH_SOCKET_DIR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-sockets-'));
const shared = path.join(root, 'private');
process.env.CODEGRAPH_SOCKET_DIR = shared;
try {
  test('long and multibyte project paths rendezvous in explicit shared directory', () => {
    for (const project of ['/' + 'x'.repeat(150), '/' + 'é'.repeat(45)]) {
      const candidates = paths.getDaemonSocketCandidates(project);
      assert.equal(candidates.length, 1);
      assert.equal(path.dirname(candidates[0]), shared);
      assert.ok(Buffer.byteLength(candidates[0], 'utf8') <= 100);
    }
    assert.equal(fs.existsSync(shared), false, 'pure candidate lookup must not create directory');
  });
  test('explicit relative or oversized socket directory is rejected actionably', () => {
    for (const value of ['', 'relative', '/' + 'é'.repeat(50)]) {
      process.env.CODEGRAPH_SOCKET_DIR = value;
      assert.throws(() => paths.getDaemonSocketCandidates('/short'), /CODEGRAPH_SOCKET_DIR/);
    }
    process.env.CODEGRAPH_SOCKET_DIR = shared;
  });
  test('binding preparation creates private directory and refuses public directory', () => {
    const socket = paths.getDaemonSocketCandidates('/' + 'x'.repeat(150))[0];
    paths.prepareDaemonSocketPath(socket);
    assert.equal(fs.statSync(shared).mode & 0o777, 0o700);
    fs.chmodSync(shared, 0o755);
    assert.throws(() => paths.prepareDaemonSocketPath(socket), /private|0700/);
  });
} finally {
  if (previous === undefined) delete process.env.CODEGRAPH_SOCKET_DIR;
  else process.env.CODEGRAPH_SOCKET_DIR = previous;
  fs.rmSync(root, { recursive: true, force: true });
}
