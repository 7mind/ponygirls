// Run against OLD and patched dist: node ownership.cjs /absolute/path/to/dist
// A namespace-invisible PID is represented by a definitely nonexistent PID in
// the shared record. The holder remains alive: kernel ownership must win.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const dist = path.resolve(process.argv[2]);
const writer = require(path.join(dist, 'mcp/writer-lock.js'));
const { FileLock } = require(path.join(dist, 'utils.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-ownership-'));
let failures = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e.message); } }
function child(body) {
  const r = spawnSync(process.execPath, ['-e', body], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}
try {
  test('live writer cannot be stolen through namespace-invisible numeric PID', () => {
    const held = writer.tryAcquireWriterLock(root, 'test');
    assert.equal(held.kind, 'acquired');
    const record = JSON.parse(fs.readFileSync(held.pidPath));
    fs.writeFileSync(held.pidPath, JSON.stringify({ ...record, pid: 2147483647 }));
    child(`const w=require(${JSON.stringify(path.join(dist, 'mcp/writer-lock.js'))}); const r=w.tryAcquireWriterLock(${JSON.stringify(root)},'contender'); if(r.kind!=='taken') throw Error('stole live writer: '+r.kind);`);
    writer.releaseWriterLock(root);
  });
  test('legacy dead writer record requires explicit offline migration', () => {
    const p = writer.getWriterPidPath(root, 'rebuild.pid');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ pid: 2147483647, mode: 'legacy', startedAt: 0 }));
    assert.equal(writer.tryAcquireWriterLock(root, 'test', 'rebuild.pid').kind, 'taken');
  });
  test('live FileLock cannot be stolen through namespace-invisible numeric PID', () => {
    const p = path.join(root, 'database.lock');
    const lock = new FileLock(p); lock.acquire();
    // Simulate legacy contender's visible PID evidence, retaining live holder fd.
    fs.writeFileSync(p, '2147483647');
    child(`const {FileLock}=require(${JSON.stringify(path.join(dist, 'utils.js'))}); try{new FileLock(${JSON.stringify(p)}).acquire()}catch(e){process.exit(0)} throw Error('stole live FileLock')`);
    lock.release();
  });
  test('legacy FileLock requires explicit offline migration', () => {
    const p = path.join(root, 'legacy.lock'); fs.writeFileSync(p, '2147483647');
    assert.throws(() => new FileLock(p).acquire(), /legacy|migration/i);
  });
  test('writer crash releases kernel ownership and permits stale v1 recovery', () => {
    const r = path.join(root, 'crash'); fs.mkdirSync(r);
    child(`const w=require(${JSON.stringify(path.join(dist, 'mcp/writer-lock.js'))}); if(w.tryAcquireWriterLock(${JSON.stringify(r)},'crash').kind!=='acquired') throw Error('not acquired'); process.exit(0)`);
    assert.equal(writer.tryAcquireWriterLock(r, 'recovery').kind, 'acquired');
    const p = writer.getWriterPidPath(r) + '.flock';
    const inode = fs.statSync(p).ino;
    writer.releaseWriterLock(r);
    assert.equal(fs.statSync(p).ino, inode, 'release must retain stable inode');
  });
  test('FileLock crash releases ownership and permits stale v1 recovery', () => {
    const p = path.join(root, 'crash.lock');
    child(`const {FileLock}=require(${JSON.stringify(path.join(dist, 'utils.js'))}); new FileLock(${JSON.stringify(p)}).acquire(); process.exit(0)`);
    const lock = new FileLock(p); lock.acquire();
    const inode = fs.statSync(p + '.flock').ino;
    lock.release();
    assert.equal(fs.statSync(p + '.flock').ino, inode);
  });
  test('record deletion cannot bypass a live writer kernel lock', () => {
    const r = path.join(root, 'deleted'); fs.mkdirSync(r);
    const held = writer.tryAcquireWriterLock(r, 'test');
    assert.equal(held.kind, 'acquired'); fs.unlinkSync(held.pidPath);
    child(`const w=require(${JSON.stringify(path.join(dist, 'mcp/writer-lock.js'))}); if(w.tryAcquireWriterLock(${JSON.stringify(r)},'contender').kind!=='taken') throw Error('stole writer after record deletion')`);
    writer.releaseWriterLock(r);
  });
  test('rebuild guard observes kernel ownership, not PID liveness', () => {
    const r = path.join(root, 'rebuild'); fs.mkdirSync(r);
    const held = writer.tryAcquireWriterLock(r, 'test', 'rebuild.pid');
    assert.equal(held.kind, 'acquired');
    const record = JSON.parse(fs.readFileSync(held.pidPath));
    fs.writeFileSync(held.pidPath, JSON.stringify({ ...record, pid: 2147483647 }));
    child(`const w=require(${JSON.stringify(path.join(dist, 'mcp/writer-lock.js'))}); try{w.assertNoRebuild(${JSON.stringify(r)})}catch(e){if(e.name==='RebuildInProgressError')process.exit(0);throw e}throw Error('missed active rebuild')`);
    writer.releaseWriterLock(r, 'rebuild.pid');
  });
  test('online reset/uninit refuses to delete another live writer database', () => {
    const r = path.join(root, 'online-reset'); fs.mkdirSync(r);
    const held = writer.tryAcquireWriterLock(r, 'test');
    const db = path.join(path.dirname(held.pidPath), 'codegraph.db'); fs.writeFileSync(db, 'live database');
    child(`const d=require(${JSON.stringify(path.join(dist, 'directory.js'))});try{d.removeDirectory(${JSON.stringify(r)})}catch(e){if(/lock|ownership|offline/i.test(e.message))process.exit(0);throw e}throw Error('deleted live database')`);
    assert.equal(fs.readFileSync(db, 'utf8'), 'live database');
    writer.releaseWriterLock(r);
  });
  test('reset preserves kernel sidecar inode and ownership records', () => {
    const r = path.join(root, 'reset'); fs.mkdirSync(r);
    const held = writer.tryAcquireWriterLock(r, 'test');
    const p = held.pidPath + '.flock'; const inode = fs.statSync(p).ino;
    require(path.join(dist, 'directory.js')).removeDirectory(r);
    assert.equal(fs.statSync(p).ino, inode); assert.ok(fs.existsSync(held.pidPath));
    writer.releaseWriterLock(r);
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
process.exitCode = failures ? 1 : 0;
