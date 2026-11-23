import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import fs, { symlinkSync, readFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import test from "node:test";
import { DISCOVERY_OFF } from "../../context-rules/rules.ts";
import { HostToolExecutor, type ToolJobSpec, type ToolJobResult } from "../src/sandbox.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FileRunStore } from "../src/store.ts";
import { CtlWorker } from "./ctl-worker.ts";
import { testGovernor } from "./fake-worker.ts";

class DelayedLookup extends HostToolExecutor {
  armed = true;
  entered = Promise.withResolvers<string>();
  release = Promise.withResolvers<void>();
  cancelled: string[] = [];
  override async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
    if (!this.armed || !spec.argv.includes("--input-type=commonjs")) return super.exec(spec);
    this.entered.resolve(spec.operationId); await this.release.promise;
    return { operationId: spec.operationId, stdout: "[]", stderr: "", timedOut: false, truncated: false, exitCode: 0, signal: null };
  }
  override async cancel(id: string): Promise<void> { this.cancelled.push(id); this.release.resolve(); await super.cancel(id); }
}
for (const phase of ["startup", "on-access"]) test(`AGENTS.md ${phase} lookup is owned: cancellation reaps it and stops publication`, async t => {
  const root = mkdtempSync(join(tmpdir(), "rules-lifetime-")), repo = join(root, "repo");
  mkdirSync(join(repo, "nested"), { recursive: true }); writeFileSync(join(repo, "nested/data"), "data");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "fixture"); const allocations = git("worktree", "list", "--porcelain");
  const host = new DelayedLookup(), workers: CtlWorker[] = [];
  const sup = new Supervisor({ rootId: "lifetime", rootDir: join(root, "store"), policy: defaultSupervisorPolicy(), governor: () => ({ ...testGovernor(), cwd: repo }), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: phase === "startup", nested: phase === "on-access" }, mainFiles: [] }), executors: { host, sandbox: host }, workerFactory: o => { const worker = new CtlWorker(o.agentId); workers.push(worker); return worker; } });
  t.after(async () => { host.release.resolve(); await sup.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const spawn = sup.spawn("governor", { profile: "writer", taskName: "busy", message: "Work." }, "busy");
  if (phase === "startup") {
    const verdict = spawn.then(() => "published", e => String(e));
    const id = await host.entered.promise, stopping = sup.shutdown();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(host.cancelled.includes(id), "shutdown must reach the executor before waiting for spawn");
    await stopping; assert.notEqual(await verdict, "published"); assert.equal(workers.length, 0);
    assert.equal(git("worktree", "list", "--porcelain"), allocations); assert.deepEqual(readdirSync(join(root, "store/tmp")), []);
  } else {
    const child = await spawn, call = workers[0].call("read", { path: "nested/data" }), id = await host.entered.promise;
    assert.throws(() => sup.toolBroker.assertQuiescent(child.agentId), /cannot park/);
    await sup.interrupt("governor", child.agentId, "stop"); assert.ok(host.cancelled.includes(id)); await call;
    sup.toolBroker.assertQuiescent(child.agentId);
  }
});


for (const stop of ["interrupt", "close", "worker exit"] as const) test(`${stop} reaps only the pending grandchild lookup without blocking other agent controls`, async t => {
  const root = mkdtempSync(join(tmpdir(), "pending-grandchild-")), repo = join(root, "repo");
  mkdirSync(repo); writeFileSync(join(repo, "AGENTS.md"), "nested parent fixture");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base");
  const host = new DelayedLookup(), workers: CtlWorker[] = []; host.armed = false;
  const sup = new Supervisor({ rootId: "grandchild", rootDir: join(root, "store"), policy: { ...defaultSupervisorPolicy(), maxDepth: 2, nesting: true }, governor: () => ({ ...testGovernor(), cwd: repo }), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: true }, mainFiles: [] }), executors: { host, sandbox: host }, workerFactory: o => { const worker = new CtlWorker(o.agentId); workers.push(worker); return worker; } });
  t.after(async () => { host.release.resolve(); await sup.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const parent = await sup.spawn("governor", { profile: "writer", taskName: "parent", message: "Delegate." }, "parent");
  const peer = await sup.spawn("governor", { profile: "reader", taskName: "peer", message: "Work." }, "peer");
  const allocations = git("worktree", "list", "--porcelain"), before = sup.capacity();
  host.armed = true;
  const grandchild = workers[0].call("spawn_agent", { profile: "writer", task_name: "grandchild", message: "Work." });
  const jobId = await host.entered.promise;
  assert.equal(sup.capacity().reserved, before.reserved + 1);
  let peerStopped = false;
  const unrelated = sup.interrupt("governor", peer.agentId, "stop-peer").then(() => { peerStopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(peerStopped, "an unrelated control is not queued behind the read");
  await unrelated; assert.ok(!host.cancelled.includes(jobId));
  if (stop === "worker exit") {
    workers[0].crash(); await new Promise(resolve => setImmediate(resolve));
  } else await sup[stop]("governor", parent.agentId, "stop-owner");
  assert.ok(host.cancelled.includes(jobId)); assert.equal(sup.capacity().reserved, before.reserved);
  assert.equal(git("worktree", "list", "--porcelain"), allocations);
  assert.equal((await grandchild).isError, true); assert.equal(workers.length, 2);
  assert.equal(sup.runStore.readSince(0, 10_000).records.filter(r => r.kind === "agent.spawned").length, 2);
});

for (const mode of ["owned", "prepared", "allocated", "allocated-dirty"]) test(`root crash during ${mode} startup lookup reclaims only unpublished owned allocations`, async t => {
  const root = mkdtempSync(join(tmpdir(), "lost-spawn-")), repo = join(root, "repo"), state = join(root, "state"), prepared = join(root, "prepared");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(repo, "sub"), { recursive: true }); writeFileSync(join(repo, "file"), "base"); writeFileSync(join(repo, "sub/file"), "base"); writeFileSync(join(repo, ".gitignore"), "local-only\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base"); git("worktree", "add", "--detach", "-q", prepared, "HEAD");
  writeFileSync(join(prepared, "caller-owned"), "keep");
  const child = fork(new URL("./fixtures/pending-workspace-crash.mjs", import.meta.url), [root, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let diagnostics = ""; child.stderr!.on("data", data => { diagnostics += String(data); });
  const exited = new Promise<string | null>((resolve, reject) => { child.once("exit", (_code, signal) => resolve(signal)); child.once("error", reject); });
  try {
    const pending = await Promise.race([new Promise<{ cwd: string }>(resolve => child.once("message", resolve)), exited.then((): never => { throw new Error(`fixture failed before lookup: ${diagnostics}`); })]);
    assert.ok(existsSync(join(pending.cwd, ".git")));
    if (!mode.startsWith("allocated")) assert.equal(readdirSync(join(state, "tmp")).length, 2);
    else assert.match(git("worktree", "list", "--porcelain"), /^locked ponygirls-subagents pending /m);
    assert.ok(child.kill("SIGKILL")); assert.equal(await exited, "SIGKILL");
    const store = new FileRunStore(state, "state"), published = store.readSince(0, Infinity).records.filter(r => r.kind === "agent.spawned");
    assert.equal(published.length, 1); const allocation = published[0].body.allocation as { workdir: string; tmpDir: string };
    if (mode === "allocated-dirty") {
      const local = join(pending.cwd, "local-only"); writeFileSync(local, "keep");
      assert.throws(() => new Supervisor({ rootId: "state", rootDir: state, store, policy: defaultSupervisorPolicy(), governor: testGovernor }), /dirty worktree/);
      assert.equal(readFileSync(local, "utf8"), "keep");
      assert.match(git("worktree", "list", "--porcelain"), /^locked ponygirls-subagents pending /m);
      return;
    }
    let ownerCwd = repo, writerDiscovery = false;
    const otherDir = join(root, "other");
    const options = { rootId: "other", rootDir: otherDir, discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: writerDiscovery }, mainFiles: [] }), policy: { ...defaultSupervisorPolicy(), repos: [{ repoId: "registered", checkoutPath: pending.cwd, readRoots: [join(pending.cwd, "sub")], allowWriters: false }] }, governor: () => ({ ...testGovernor(), cwd: ownerCwd }), workerFactory: (opts: { agentId: string }) => new CtlWorker(opts.agentId) };
    const second = new Supervisor({ ...options, store: new FileRunStore(otherDir, "other") });
    t.after(() => second.shutdown());
    const assign = (path: string, name: string) => second.spawn("governor", { profile: "reader", taskName: name, message: "Read.", workspacePath: path }, name);
    await assign(prepared, "independent");
    await assign(allocation.workdir, "published-reader");
    if (mode === "owned") {
      await assert.rejects(assign(pending.cwd, "staged-reader"), /staged workspace/);
      ownerCwd = pending.cwd;
      await assert.rejects(second.spawn("governor", { profile: "reader", taskName: "inherited", message: "Read." }, "inherited"), /staged workspace/);
      ownerCwd = join(pending.cwd, "sub");
      const registered = git("worktree", "list", "--porcelain"), temp = readdirSync(join(otherDir, "tmp"));
      writerDiscovery = true;
      await assert.rejects(second.spawn("governor", { profile: "writer", taskName: "derived-writer", message: "Work." }, "derived"), /staged workspace/);
      assert.equal(git("worktree", "list", "--porcelain"), registered);
      assert.deepEqual(readdirSync(join(otherDir, "tmp")), temp);
      assert.ok(!second.runStore.readSince(0, 1000).records.some(r => r.kind === "workspace.staged"));
      writerDiscovery = false;
      for (const profile of ["reader", "writer"] as const) await assert.rejects(second.spawn("governor", { profile, isolation: "none", taskName: `host-${profile}`, message: "Read." }, `host-${profile}`), /staged workspace/);
      await assert.rejects(second.spawn("governor", { profile: "reader", isolation: "sandbox", repoId: "registered", taskName: "sandbox", message: "Read." }, "sandbox"), /staged workspace/);
      ownerCwd = join(allocation.workdir, "sub");
      await second.spawn("governor", { profile: "reader", taskName: "published-subdir", message: "Read." }, "published-subdir");
      ownerCwd = join(root, "non-git"); mkdirSync(ownerCwd); writeFileSync(join(ownerCwd, "file"), "base");
      await second.spawn("governor", { profile: "reader", taskName: "ordinary", message: "Read." }, "ordinary");
    }
    const sup = new Supervisor({ rootId: "state", rootDir: state, store, policy: defaultSupervisorPolicy(), governor: testGovernor });
    try {
      assert.deepEqual(readdirSync(join(state, "tmp")), [basename(allocation.tmpDir)]);
      assert.deepEqual(git("worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree ")).sort(), [repo, allocation.workdir, prepared].map(path => `worktree ${path}`).sort());
      assert.equal(existsSync(pending.cwd), mode === "prepared"); assert.equal(readFileSync(join(prepared, "caller-owned"), "utf8"), "keep");
      assert.deepEqual(sup.list("governor").map(a => a.path), ["/root/published"]);
      const surviving = second.list("governor");
      await second.shutdown();
      const reopened = new Supervisor({ ...options, store: new FileRunStore(otherDir, "other") });
      try {
        assert.deepEqual(reopened.list("governor").map(a => a.path), surviving.map(a => a.path));
        for (const reader of reopened.list("governor")) assert.equal(readFileSync(join(reader.workdir, "file"), "utf8"), "base");
      } finally { await reopened.shutdown(); }
    } finally { await sup.shutdown(); }
  } finally { clearTimeout(deadline); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; }
});

test("a pooled checkout awaiting discovery cannot be handed out as a prepared workspace", async t => {
  const root = mkdtempSync(join(tmpdir(), "staged-prepared-")), repo = join(root, "repo"), pool = join(root, "pool"), prepared = join(root, "prepared");
  mkdirSync(repo); writeFileSync(join(repo, "file"), "base");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base"); git("worktree", "add", "--detach", "-q", prepared, "HEAD");
  const before = git("worktree", "list", "--porcelain"), host = new DelayedLookup(), abort = new AbortController();
  const sup = new Supervisor({ rootId: "pool-test", rootDir: join(root, "state"), policy: { ...defaultSupervisorPolicy(), worktreeRoot: pool }, governor: () => ({ ...testGovernor(), cwd: repo }), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: true }, mainFiles: [] }), executors: { host, sandbox: host }, workerFactory: opts => new CtlWorker(opts.agentId) });
  t.after(async () => { abort.abort(); host.release.resolve(); await sup.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const owner = sup.spawn("governor", { taskName: "stage", message: "Work.", profile: "writer" }, "stage", abort.signal).then(() => null, e => e);
  await host.entered.promise; host.armed = false;
  const dir = join(pool, "pool-test", "worktrees"), staged = join(dir, readdirSync(dir)[0]);
  const alias = join(root, "alias"); symlinkSync(staged, alias);
  const reader = (workspacePath: string, name: string) => sup.spawn("governor", { taskName: name, message: "Read.", profile: "reader", workspacePath }, name);
  await reader(prepared, "unrelated");
  await assert.rejects(reader(alias, "overlap"), /staged workspace/);
  abort.abort(); assert.ok(await owner);
  assert.equal(git("worktree", "list", "--porcelain"), before);
  assert.equal(sup.list("governor").find(item => item.path === "/root/unrelated")?.workdir, prepared);
});

for (const worktree of [false, true]) test(`an ambiguous visible spawn retains its checkout and tmp on reopen (discovery: ${worktree})`, async t => {
  const root = mkdtempSync(join(tmpdir(), "uncertain-allocated-")), state = join(root, "state"), repo = join(root, "repo");
  t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(repo); writeFileSync(join(repo, "file"), "base");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base");
  const options = { rootDir: state, rootId: "uncertain", policy: defaultSupervisorPolicy(), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree }, mainFiles: [] }), governor: () => ({ ...testGovernor(), cwd: repo }) };
  const sup = new Supervisor({ ...options, store: new FileRunStore(state, "uncertain") });
  const sync = fs.fsyncSync;
  t.mock.method(fs, "fsyncSync", (fd: number) => { if (fs.fstatSync(fd).isDirectory() && readFileSync(join(state, "journal.log")).includes("agent.spawned")) throw Object.assign(new Error("manifest directory sync fault"), { code: "EIO" }); sync(fd); });
  syncBuiltinESMExports();
  try { await assert.rejects(sup.spawn("governor", { taskName: "uncertain", message: "Work.", profile: "writer" }, "uncertain"), /STORE_FAILED.*directory sync fault/); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); await sup.shutdown(); }
  const store = new FileRunStore(state, "uncertain"), restored = new Supervisor({ ...options, store });
  try {
    const accepted = store.readSince(0, 100).records.find(r => r.kind === "agent.spawned"); assert.ok(accepted);
    const allocation = accepted.body.allocation as { workdir: string; tmpDir: string };
    assert.equal(restored.list("governor")[0]?.workdir, allocation.workdir);
    assert.doesNotMatch(git("worktree", "list", "--porcelain"), /^locked /m);
    assert.ok(git("worktree", "list", "--porcelain").includes(`worktree ${allocation.workdir}\n`));
    assert.equal(readFileSync(join(allocation.workdir, "file"), "utf8"), "base"); assert.ok(fs.statSync(allocation.tmpDir).isDirectory());
  } finally { await restored.shutdown(); }
});

test("queued and rejected initialization never report selected files as installed", async t => {
  const root = mkdtempSync(join(tmpdir(), "init-inventory-"));
  class Reject extends CtlWorker {
    override async request(op: string, payload: unknown) { return op === "initialize" ? { ok: false, message: "reject" } : super.request(op, payload); }
  }
  const file = { path: join(root, "AGENTS.md"), content: "selected" };
  let reject = true;
  const sup = new Supervisor({ rootId: "coverage", rootDir: root, policy: defaultSupervisorPolicy(), schedulerLimits: { maxRunnable: 1, maxResidentWorkers: 4, maxOpenAgents: 4 }, governor: () => ({ ...testGovernor(), cwd: root, instructions: { skills: [], contextFiles: [file] } }), workerFactory: opts => reject ? new Reject(opts.agentId) : new CtlWorker(opts.agentId) });
  t.after(async () => { await sup.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const spawn = (name: string) => sup.spawn("governor", { taskName: name, profile: "reader", message: "Read.", contextFiles: "all" }, name);
  await assert.rejects(spawn("rejected"), /worker initialize rejected/);
  reject = false; await spawn("active"); const queued = await spawn("queued");
  assert.equal(queued.status, "queued");
  assert.deepEqual(sup.instructionInventory().map(r => [r.label, r.paths, r.complete]), [["rejected", [], false], ["active", [], false], ["queued", [], false]]);
});

test("replacing a prepared checkout during discovery cannot publish a worker into the replacement", async t => {
  const root = mkdtempSync(join(tmpdir(), "replaced-checkout-")), repo = join(root, "repo");
  mkdirSync(repo); writeFileSync(join(repo, "file"), "base");
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=t@t", ...args], { cwd: repo });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "base");
  const host = new DelayedLookup();
  const sup = new Supervisor({ rootId: "replaced", rootDir: join(root, "store"), policy: defaultSupervisorPolicy(), governor: () => ({ ...testGovernor(), cwd: root }), discovery: () => ({ grants: { ...DISCOVERY_OFF, worktree: true }, mainFiles: [] }), executors: { host, sandbox: host }, workerFactory: o => new CtlWorker(o.agentId) });
  t.after(async () => { await sup.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const spawn = sup.spawn("governor", { profile: "reader", taskName: "staged", message: "Read.", workspacePath: repo }, "stage");
  await host.entered.promise; fs.renameSync(repo, join(root, "original")); mkdirSync(repo); writeFileSync(join(repo, "mine"), "caller-owned");
  host.release.resolve(); await assert.rejects(spawn, /workspace.*changed/i);
  assert.deepEqual(sup.list("governor"), []); assert.equal(readFileSync(join(repo, "mine"), "utf8"), "caller-owned");
});
