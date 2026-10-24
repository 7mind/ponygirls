import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodegraphSession, execute, localBoundary } from "./runtime.ts";
import type { Boundary, State } from "./runtime.ts";

interface Health {
  initialized: boolean; projectPath: string; indexPath: string; fileCount: number; nodeCount: number;
  pendingChanges: { added: number; modified: number; removed: number };
  index: { state: string; reindexRecommended: boolean; pendingRefs: number;
    filesNeedingReindex: number; filesWithParseErrors: number };
}
function healthy(root: string): Health {
  return { initialized: true, projectPath: root, indexPath: join(root, ".codegraph"), fileCount: 1, nodeCount: 1,
    pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: "complete",
      reindexRecommended: false, pendingRefs: 0, filesNeedingReindex: 0, filesWithParseErrors: 0 } };
}
class MemoryBoundary implements Boundary {
  checkout: string | null = "/checkout";
  health = healthy("/checkout");
  initialized = false;
  fail = false;
  hold: Promise<void> = Promise.resolve();
  async root() { return this.checkout; }
  async localIndex() { return this.initialized; }
  async run(_root: string, args: string[], signal: AbortSignal) {
    await Promise.race([this.hold, new Promise<void>((_done, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    })]);
    signal.throwIfAborted();
    if (this.fail) throw new Error("intentional CLI failure");
    if (args[0] !== "status") {
      this.initialized = true;
      this.health = healthy("/checkout");
    }
    return JSON.stringify(this.health);
  }
}
interface Fixture {
  root: string;
  boundary: Boundary;
  modify(): Promise<void>;
  cleanup(): Promise<void>;
}
async function memoryFixture(): Promise<Fixture> {
  const boundary = new MemoryBoundary();
  return { root: "/checkout", boundary, async modify() { boundary.health.pendingChanges.modified = 1; }, async cleanup() {} };
}
async function cliFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pi-codegraph-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, "example.ts"), "export function hello() { return 1; }\n");
  await writeFile(join(root, ".gitignore"), "# leave this unchanged\n");
  return { root, boundary: localBoundary(process.env.PONYGIRLS_CODEGRAPH_BIN!,
    process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", { ...process.env, CODEGRAPH_NO_WATCH: "1" }),
    async modify() { await writeFile(join(root, "example.ts"), "export function hello() { return 2; }\n"); },
    async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

// Specified Behavioral-Active / Blackbox-Atomic (dummy), Blackbox-GoodCommunication (CLI).
for (const [name, fixture] of [["memory", memoryFixture], ["CLI", cliFixture]] as const) {
  test(`${name}: bootstrap, sync edited source, rebuild, and verify health`, {
    skip: name === "CLI" && !process.env.PONYGIRLS_CODEGRAPH_BIN ? "set PONYGIRLS_CODEGRAPH_BIN for pinned local CLI tests" : false,
  }, async (t) => {
    const f = await fixture();
    t.after(f.cleanup);
    const states: State[] = [];
    const session = new CodegraphSession(f.boundary, f.root, (state) => states.push(state));
    t.after(() => session.shutdown());
    const work = session.start("sync");
    assert.equal(session.state.phase, "working");
    await work;
    assert.equal(session.state.phase, "ready", session.state.detail);
    assert.ok(states.some((state) => state.detail.startsWith("init (")));
    await f.modify();
    await session.start("status");
    assert.equal(session.state.phase, "error", "pending edits must not report ready");
    await session.start("sync");
    assert.equal(session.state.phase, "ready", session.state.detail);
    await session.start("reindex");
    assert.equal(session.state.phase, "ready", session.state.detail);
    if (name === "CLI") {
      assert.equal(await readFile(join(f.root, ".gitignore"), "utf8"), "# leave this unchanged\n");
      for (const hook of ["post-commit", "post-merge", "post-checkout"]) {
        await assert.rejects(readFile(join(f.root, ".git", "hooks", hook)), { code: "ENOENT" });
      }
    }
  });
}

test("incomplete, stale and empty indexes are rebuilt; unhealthy results remain errors", async () => {
  for (const change of [
    (h: Health) => { h.index.state = "indexing"; },
    (h: Health) => { h.index.state = "partial"; },
    (h: Health) => { h.index.state = "failed"; },
    (h: Health) => { h.index.reindexRecommended = true; },
    (h: Health) => { h.fileCount = 0; h.nodeCount = 0; },
  ]) {
    const boundary = new MemoryBoundary();
    boundary.initialized = true;
    change(boundary.health);
    const states: State[] = [];
    const session = new CodegraphSession(boundary, "/checkout", (state) => states.push(state));
    await session.start("sync");
    assert.equal(session.state.phase, "ready");
    assert.ok(states.some((state) => state.detail.startsWith("index (")));
  }
  for (const field of ["pendingRefs", "filesNeedingReindex", "filesWithParseErrors"] as const) {
    const boundary = new MemoryBoundary();
    boundary.initialized = true;
    boundary.health.index[field] = 1;
    const session = new CodegraphSession(boundary, "/checkout", () => {});
    await session.start("status");
    assert.equal(session.state.phase, "error");
    await session.start("sync");
    assert.equal(session.state.phase, "ready");
  }
});

test("non-Git skip, ancestor rejection, malformed status and command errors are observable", async () => {
  const boundary = new MemoryBoundary();
  boundary.checkout = null;
  const session = new CodegraphSession(boundary, "/checkout", () => {});
  await session.start("sync");
  assert.equal(session.state.phase, "skipped");
  assert.equal(boundary.initialized, false);
  boundary.checkout = "/checkout";
  boundary.initialized = true;
  boundary.health.projectPath = "/ancestor";
  await session.start("sync");
  assert.equal(session.state.phase, "error");
  assert.match(session.state.detail, /non-local/);
  boundary.health = healthy("/checkout");
  boundary.health.index.state = "unknown-schema";
  await session.start("status");
  assert.equal(session.state.phase, "error");
  assert.match(session.state.detail, /Unsupported/);
  boundary.fail = true;
  await session.start("sync");
  assert.match(session.state.detail, /intentional CLI failure/);
});

test("one owned operation, cancellation, idempotent shutdown and no late publications", async () => {
  const boundary = new MemoryBoundary();
  boundary.hold = new Promise(() => {});
  const states: State[] = [];
  const session = new CodegraphSession(boundary, "/checkout", (state) => states.push(state));
  const first = session.start("sync");
  assert.equal(first, session.start("reindex"));
  await new Promise((done) => setImmediate(done));
  await session.cancel();
  assert.equal(session.state.phase, "cancelled");
  boundary.hold = Promise.resolve();
  await session.start("sync");
  assert.equal(session.state.phase, "ready");
  boundary.hold = new Promise(() => {});
  session.start("sync");
  const count = states.length;
  await session.shutdown();
  await session.shutdown();
  await session.start("sync");
  assert.equal(states.length, count);
});

test("production boundary resolves worktree roots, skips non-Git and refuses index symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-codegraph-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const boundary = localBoundary("codegraph", "flock", process.env);
  const signal = new AbortController().signal;
  assert.equal(await boundary.root(root, signal), null);
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
  const worktree = join(root, "worktree");
  execFileSync("git", ["-C", root, "worktree", "add", "--quiet", "--detach", worktree]);
  await mkdir(join(worktree, "subdir"));
  assert.equal(await boundary.root(join(worktree, "subdir"), signal), worktree);
  assert.equal(await boundary.localIndex(worktree), false);
  const { symlink } = await import("node:fs/promises");
  await symlink(root, join(worktree, ".codegraph"));
  await assert.rejects(boundary.localIndex(worktree), /symlink/);
});

test("process adapter bounds diagnostics and kills a resistant process group", async (t) => {
  const signal = new AbortController();
  const result = await execute(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000));process.stderr.write('y'.repeat(100000))"], process.cwd(), signal.signal, process.env);
  assert.equal(result.stdout.length, 32768);
  assert.equal(result.stderr.length, 32768);
  const dir = await mkdtemp(join(tmpdir(), "pi-codegraph-cancel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pidfile = join(dir, "pid");
  const childCode = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidfile)},String(process.pid));setInterval(()=>{},1000)`;
  const parentCode = `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
  const work = execute(process.execPath, ["-e", parentCode], dir, signal.signal, process.env);
  const failed = assert.rejects(work, /cancelled/);
  let pid: number | undefined;
  for (let n = 0; n < 100; n++) {
    try { pid = Number(await readFile(pidfile, "utf8")); break; }
    catch { await new Promise((done) => setTimeout(done, 10)); }
  }
  assert.ok(pid, "descendant must start before cancellation");
  signal.abort();
  await failed;
  // Linux may retain a killed orphan as a zombie until PID 1 reaps it.
  try {
    process.kill(pid, 0);
    assert.match(await readFile(`/proc/${pid}/stat`, "utf8"), /^\d+ \(.*\) Z /);
  } catch (error) {
    assert.ok(["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code!));
  }
});

test("explicit reindex does not depend on a readable pre-rebuild status", async () => {
  const memory = new MemoryBoundary();
  memory.initialized = true;
  let damaged = true;
  const boundary: Boundary = {
    root: memory.root.bind(memory), localIndex: memory.localIndex.bind(memory),
    async run(root, args, signal) {
      if (args[0] === "status" && damaged) throw new Error("interrupted status failed");
      if (args[0] === "index") damaged = false;
      return memory.run(root, args, signal);
    },
  };
  const session = new CodegraphSession(boundary, "/checkout", () => {});
  await session.start("reindex");
  assert.equal(session.state.phase, "ready", session.state.detail);
});

test("production boundary refuses custom index locations before mutation", async () => {
  const boundary = localBoundary("codegraph", "flock", { ...process.env, CODEGRAPH_DIR: "../elsewhere" });
  await assert.rejects(boundary.root(process.cwd(), new AbortController().signal), /Custom CODEGRAPH_DIR/);
});

test("CLI: concurrent fresh sessions serialize and explicit rebuild recovers schemaless DB", {
  skip: !process.env.PONYGIRLS_CODEGRAPH_BIN ? "set PONYGIRLS_CODEGRAPH_BIN for pinned local CLI tests" : false,
}, async (t) => {
  const f = await cliFixture();
  t.after(f.cleanup);
  const first = new CodegraphSession(f.boundary, f.root, () => {});
  const second = new CodegraphSession(f.boundary, f.root, () => {});
  await Promise.all([first.start("sync"), second.start("sync")]);
  assert.equal(first.state.phase, "ready", first.state.detail);
  assert.equal(second.state.phase, "ready", second.state.detail);
  const database = join(f.root, ".codegraph", "codegraph.db");
  await rm(database);
  const { DatabaseSync } = await import("node:sqlite");
  new DatabaseSync(database).close();
  await first.start("reindex");
  assert.equal(first.state.phase, "ready", first.state.detail);
  await rm(database);
  await writeFile(database, "not a SQLite database");
  await first.start("reindex");
  assert.equal(first.state.phase, "error");
  assert.equal(await readFile(database, "utf8"), "not a SQLite database", "foreign data must not be replaced");
});
