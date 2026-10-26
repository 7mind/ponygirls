import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { discoverRoots, scanRoots, readSnapshot } from '../src/discovery.ts';

function home() { return mkdtempSync(join(tmpdir(), 'chronicle-fixture-')); }
function file(path: string, content: string) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, content); }
function config(homeDir: string, extra: Record<string, unknown>) {
  return loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(homeDir, 'token'), stateDir: join(homeDir, 'state'), homeDir, ...extra });
}

test('BG dynamic native/Linux/Darwin yolo discovery includes all profiles and only transcript paths', () => {
  const root = home();
  try {
    const c = config(root, {});
    const native = join(root, '.pi/agent');
    file(join(native, 'sessions/project/main.jsonl'), '{}\n');
    file(join(native, 'subagents/root/sessions/child/session.jsonl'), '{}\n');
    file(join(native, 'subagents/root/events.jsonl'), '{}\n');
    file(join(native, 'subagents/root/sessions/child/events/journal.jsonl'), '{}\n');
    const first = scanRoots(discoverRoots(c, 'linux'), c);
    assert.equal(first.files.length, 2);
    const linuxProfile = join(root, '.config/yolo/second');
    file(join(linuxProfile, 'claude/home/projects/p/parent.jsonl'), '{}\n');
    file(join(linuxProfile, 'claude/home/projects/p/parent/subagents/workflows/run/agent-child.jsonl'), '{}\n');
    file(join(linuxProfile, 'claude/home/projects/p/memory/notes.jsonl'), '{}\n');
    file(join(linuxProfile, 'codex/home/archived_sessions/2026/archive.jsonl'), '{}\n');
    file(join(linuxProfile, 'codex/home/sessions/2026/live.jsonl'), '{}\n');
    file(join(linuxProfile, 'pi/home/agent/subagents/root/sessions/child/session.jsonl'), '{}\n');
    const next = scanRoots(discoverRoots(c, 'linux'), c);
    assert.equal(next.files.length, 7);
    assert.equal(next.files.filter(f => f.root.id === 'yolo:second').length, 5);
    file(join(root, '.config/yolo/darwin/pi/sessions/p/s.jsonl'), '{}\n');
    file(join(root, '.config/yolo/darwin/claude/projects/p/s.jsonl'), '{}\n');
    file(join(root, '.config/yolo/darwin/codex/archived_sessions/s.jsonl'), '{}\n');
    assert.equal(scanRoots(discoverRoots(c, 'darwin'), c).files.filter(f => f.root.id === 'yolo:darwin').length, 3);
    assert.equal(scanRoots(discoverRoots(config(root, { exclusions: { profiles: ['second'] } }), 'linux'), c).files.length, 2);
  } finally { rmSync(root, { recursive: true }); }
});

// Regression: unrelated harness worktrees exhausted the entry budget before canonical sessions.
test('GoodCommunication Pi subagent discovery ignores unrelated trees before entry limits and diagnostics', () => {
  const root = home();
  try {
    const subagents = join(root, '.pi/agent/subagents');
    for (let i = 0; i < 30; i++) file(join(subagents, 'root/worktrees/node_modules', `package-${i}/index.jsonl`), '{}\n');
    symlinkSync(join(root, 'missing'), join(subagents, 'root/worktrees/node_modules/link'));
    symlinkSync(join(root, 'missing'), join(subagents, 'root/attachments'));
    file(join(subagents, 'root/events.jsonl'), '{}\n');
    file(join(subagents, 'root/sessions/child/session.jsonl'), '{}\n');
    file(join(subagents, 'root/sessions/child/attachments/deep.jsonl'), '{}\n');
    symlinkSync(join(root, 'missing'), join(subagents, 'root/sessions/child/attachments/link'));
    const c = config(root, { discoverYolo: false, maxFiles: 4 });
    const roots = discoverRoots(c, 'linux').filter(r => r.layout === 'pi-subagents');
    const scan = scanRoots(roots, c);
    assert.deepEqual(scan.files.map(f => f.relativePath), ['root/sessions/child/session.jsonl']);
    assert.deepEqual(scan.diagnostics, []);
    assert.equal(scan.visited, 4);
  } finally { rmSync(root, { recursive: true }); }
});

test('GoodCommunication Pi subagent supported paths retain symlink rejection and entry/depth bounds', () => {
  const root = home();
  try {
    const subagents = join(root, '.pi/agent/subagents');
    file(join(subagents, 'root/sessions/child/session.jsonl'), '{}\n');
    symlinkSync(join(root, 'missing'), join(subagents, 'linked-root'));
    symlinkSync(join(root, 'missing'), join(subagents, 'root/sessions/linked-child'));
    symlinkSync(join(root, 'missing'), join(subagents, 'root/sessions/child/linked.jsonl'));
    const c = config(root, { discoverYolo: false });
    const roots = discoverRoots(c, 'linux').filter(r => r.layout === 'pi-subagents');
    assert.equal(scanRoots(roots, c).diagnostics.filter(d => d.code === 'symlink-rejected').length, 3);
    assert.ok(scanRoots(roots, { ...c, maxFiles: 2 }).diagnostics.some(d => d.code === 'scan-entry-limit'));
    assert.ok(scanRoots(roots, { ...c, maxDepth: 1 }).diagnostics.some(d => d.code === 'scan-depth-limit'));
  } finally { rmSync(root, { recursive: true }); }
});

test('BG symlinks including root ancestors are rejected; regular snapshots are bounded and consistent', () => {
  const root = home();
  try {
    const transcripts = join(root, 'sessions'); const outside = join(root, 'outside');
    file(join(transcripts, 'normal.jsonl'), '{"synthetic":true}\n');
    file(join(outside, 'outside.jsonl'), '{}\n');
    symlinkSync(outside, join(transcripts, 'escape'));
    symlinkSync(join(outside, 'outside.jsonl'), join(transcripts, 'escape.jsonl'));
    const c = config(root, { discoverNative: false, discoverYolo: false, roots: [{ id: 'test', format: 'pi', path: transcripts }] });
    const scan = scanRoots(discoverRoots(c, 'linux'), c);
    assert.equal(scan.files.length, 1);
    assert.equal(scan.diagnostics.filter(d => d.code === 'symlink-rejected').length, 2);
    assert.equal(readSnapshot(scan.files[0]!, c.maxFileBytes).bytes.toString(), '{"synthetic":true}\n');
    assert.throws(() => readSnapshot(scan.files[0]!, 1), /snapshot-too-large/);
    symlinkSync(root, join(root, 'alias'));
    const aliased = config(root, { discoverNative: false, discoverYolo: false, roots: [{ id: 'alias', format: 'pi', path: join(root, 'alias/sessions') }] });
    assert.equal(scanRoots(discoverRoots(aliased, 'linux'), aliased).files.length, 0);
    assert.ok(scanRoots(discoverRoots(aliased, 'linux'), aliased).diagnostics.some(d => d.code === 'symlink-rejected'));
  } finally { rmSync(root, { recursive: true }); }
});

test('BA disabled configuration never discovers homes; malformed config fails at boundary', () => {
  const c = loadConfig({ enabled: false });
  assert.deepEqual(discoverRoots(c, 'linux'), []);
  assert.throws(() => loadConfig({ enabled: true }), /invalid-config/);
  assert.throws(() => loadConfig({ enabled: false, unknown: 1 }), /invalid-config/);
  assert.throws(() => loadConfig({ enabled: false, quietMs: -1 }), /invalid-config/);
});
