import assert from "node:assert/strict";
import test from "node:test";
import { CodegraphWorkspace, reportText, scopeState } from "./workspace.ts";
import type { Catalog, Project } from "./projects.ts";
import type { Boundary, State } from "./runtime.ts";

/** codegraph 1.6.2's refusal while another process holds the index lock (pinned by runtime.test.ts). */
const LOCKED_ELSEWHERE = "codegraph sync exited 1: ✗ Failed to sync: Sync could not acquire the file lock; retry when the index is available. " +
  "CodeGraph database is locked by another process (kernel flock)";

function fixture() {
  const projects: Project[] = [
    { root: "/workspace/a", kind: "checkout", commonDir: "/workspace/a/.git" },
    { root: "/workspace/b", kind: "checkout", commonDir: "/workspace/b/.git" },
  ];
  const initialized = new Set<string>();
  const failures = new Set<string>();
  const lockedElsewhere = new Set<string>();
  const calls: string[] = [];
  const holds = new Map<string, Promise<void>>();
  let probes = 0;
  const catalog: Catalog = {
    async resolve(path) { probes++; return projects.find((p) => path === p.root || path.startsWith(`${p.root}/`)) ?? null; },
    async discover() { probes++; return [...projects]; },
    async initWorkspace(path) { const project: Project = { root: path, kind: "workspace", commonDir: null }; projects.push(project); return project; },
    async size() { return { databaseBytes: 4, totalBytes: 10, partial: false, detail: null }; },
  };
  const boundary: Boundary = {
    async root(path, signal) { return (await catalog.resolve(path, signal))?.root ?? null; },
    async localIndex(root) { return initialized.has(root); },
    async run(root, args, signal) {
      calls.push(`${root}:${args[0]}`);
      if (failures.has(root)) throw new Error(`failure at ${root}`);
      if (lockedElsewhere.has(root) && args[0] === "sync") throw new Error(LOCKED_ELSEWHERE);
      const hold = holds.get(root);
      if (hold !== undefined) await Promise.race([hold, new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      })]);
      signal.throwIfAborted();
      initialized.add(root);
      return JSON.stringify({ initialized: true, projectPath: root, indexPath: `${root}/.codegraph`, fileCount: 1, nodeCount: 1,
        pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: "complete", reindexRecommended: false,
          pendingRefs: 0, filesNeedingReindex: 0, filesWithParseErrors: 0 } });
    },
  };
  const workspace = new CodegraphWorkspace(catalog, boundary, "/workspace", () => {}, () => "fixture-time");
  return { workspace, catalog, boundary, initialized, failures, lockedElsewhere, calls, holds, probes: () => probes };
}

test("parent discovery is non-mutating; ambiguous queries fail, explicit projects prepare independently", async () => {
  const f = fixture();
  await f.workspace.start(true);
  assert.equal(f.initialized.size, 0);
  await assert.rejects(f.workspace.query(undefined), /Ambiguous.*projectPath/);
  f.failures.add("/workspace/a");
  await assert.rejects(f.workspace.query("a"), /failure at \/workspace\/a/);
  assert.equal(await f.workspace.query("b/subdir"), "/workspace/b");
  assert.equal(f.initialized.has("/workspace/b"), true);
  await f.workspace.use("b");
  assert.equal(await f.workspace.query(undefined), "/workspace/b");
  const report = await f.workspace.report(null);
  assert.match(report, /total 20 bytes/);
  assert.match(report, /fixture-time/);
  assert.match(f.workspace.context(), /commonDir/);
  assert.match(f.workspace.context(), /projectPath/);
  await f.workspace.shutdown();
});

// Specified Behavioral-Active / Blackbox-Group: all command targets use Pi's cwd, not process.cwd().
for (const path of ["b", "./b", "a/../b", "/workspace/b"]) {
  test(`every path-taking workspace operation accepts ${path}`, async (t) => {
    const f = fixture();
    t.after(() => f.workspace.shutdown());
    await f.workspace.start(true);
    await f.workspace.use(path);
    assert.match(f.workspace.context(), /"defaultProject":"\/workspace\/b"/);
    for (const action of ["sync", "status", "reindex"] as const) {
      await f.workspace.perform(action, path, false);
      assert.equal(f.workspace.state.phase, "ready", f.workspace.state.detail);
    }
    assert.equal(await f.workspace.query(path), "/workspace/b");
    assert.match(await f.workspace.report(path), /"\/workspace\/b"/);
    assert.doesNotMatch(await f.workspace.report(path), /"\/workspace\/a"/);
    await f.workspace.cancel(path, false);
    await assert.rejects(f.workspace.erase(path), /\/workspace\/b\/\.codegraph\/codegraph\.db/);
    assert.ok(f.calls.length > 0);
    assert.ok(f.calls.every((call) => call.startsWith("/workspace/b:")));

    let discovered: string | null = null;
    const discover = f.catalog.discover;
    f.catalog.discover = async (target, signal) => {
      discovered = target;
      return discover(target, signal);
    };
    await f.workspace.discover(path);
    assert.equal(discovered, "/workspace/b");

  });
}

for (const path of ["new", "./new", "a/../new", "/workspace/new"]) {
  test(`workspace initialization resolves ${path} relative to Pi's cwd`, async (t) => {
    const f = fixture();
    t.after(() => f.workspace.shutdown());
    await f.workspace.start(true);
    await f.workspace.initWorkspace(path);
    assert.equal(await f.workspace.query(undefined), "/workspace/new");
    assert.equal(f.workspace.state.phase, "ready", f.workspace.state.detail);
    assert.ok(f.calls.every((call) => call.startsWith("/workspace/new:")));
  });
}

test("dot and parent-relative targets stay anchored to Pi's cwd after selection", async (t) => {
  const f = fixture();
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace/a", () => {}, () => "checked");
  t.after(() => workspace.shutdown());
  await workspace.start(false);
  await workspace.use("../b");
  assert.equal(await workspace.query(undefined), "/workspace/b");
  assert.equal(await workspace.query("."), "/workspace/a");
  assert.equal(await workspace.query("../b"), "/workspace/b");
});

test("disabled startup makes no probes; explicit commands activate discovery", async () => {
  const f = fixture();
  await f.workspace.start(false);
  assert.equal(f.probes(), 0);
  assert.equal(f.workspace.routingEnabled, false);
  await f.workspace.perform("status", null, true);
  assert.equal(f.workspace.routingEnabled, true);
  assert.equal(f.initialized.size, 0);
  await f.workspace.shutdown();
});

test("a failed project does not gate another project's in-flight preparation", async () => {
  const f = fixture();
  await f.workspace.start(true);
  f.holds.set("/workspace/a", new Promise(() => {}));
  const a = f.workspace.query("a");
  const cancelled = assert.rejects(a, /cancelled/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await f.workspace.query("b"), "/workspace/b");
  await f.workspace.cancel("a", false);
  await cancelled;
  await f.workspace.shutdown();
});

test("batch cancellation prevents later projects starting; shutdown prevents late registration", async () => {
  const f = fixture();
  await f.workspace.start(true);
  f.holds.set("/workspace/a", new Promise(() => {}));
  const batch = f.workspace.perform("sync", null, true);
  await new Promise((resolve) => setImmediate(resolve));
  await f.workspace.cancel(null, true);
  await batch;
  assert.equal(f.calls.some((call) => call.startsWith("/workspace/b:")), false);
  await f.workspace.shutdown();
  await assert.rejects(f.workspace.query("b"), /closed/);
});

test("pending target resolution respects targeted cancellation", async () => {
  const f = fixture();
  await f.workspace.start(true);
  const resolveProject = f.catalog.resolve;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let holdOnce = true;
  f.catalog.resolve = async (path, signal) => {
    if (path === "/workspace/a" && holdOnce) { holdOnce = false; await held; }
    return resolveProject(path, signal);
  };
  const query = f.workspace.query("a");
  const cancelled = assert.rejects(query, /cancelled/i);
  await new Promise((resolve) => setImmediate(resolve));
  await f.workspace.cancel("a", false);
  release();
  await cancelled;
  assert.equal(f.calls.length, 0);
  await f.workspace.shutdown();
});

test("checkout startup preparation does not gate explicit queries to another checkout", async () => {
  const f = fixture();
  f.holds.set("/workspace/a", new Promise(() => {}));
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace/a", () => {}, () => "checked");
  await workspace.start(true);
  assert.equal(await workspace.query("/workspace/b"), "/workspace/b");
  await workspace.cancel(null, true);
  await workspace.shutdown();
});

test("cancel during discovery prevents later automatic indexing", async () => {
  const f = fixture();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  f.catalog.discover = async () => { await hold; return [{ root: "/workspace/a", kind: "checkout", commonDir: "/workspace/a/.git" }]; };
  const startup = f.workspace.start(true);
  await f.workspace.cancel(null, true);
  release();
  await startup;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 0, "cancelled startup must not start a future initializer");
  await f.workspace.shutdown();
});

test("failed manual activation is recoverable and shutdown does not rethrow it", async () => {
  const f = fixture();
  await f.workspace.start(false);
  const discover = f.catalog.discover;
  f.catalog.discover = async () => { throw new Error("discovery failed once"); };
  await assert.rejects(f.workspace.perform("status", null, true), /discovery failed once/);
  f.catalog.discover = discover;
  await f.workspace.discover(null);
  assert.equal(await f.workspace.query("b"), "/workspace/b");
  await f.workspace.shutdown();
});

test("busy projects are reported but do not abort a batch for other roots", async () => {
  const f = fixture();
  await f.workspace.start(true);
  f.holds.set("/workspace/a", new Promise(() => {}));
  const query = f.workspace.query("a");
  const cancelled = assert.rejects(query, /cancelled/i);
  await new Promise((resolve) => setImmediate(resolve));
  await f.workspace.perform("sync", null, true);
  assert.equal(f.initialized.has("/workspace/b"), true);
  assert.match(await f.workspace.report(null), /busy.*workspace\/a|workspace\/a.*busy/);
  await f.workspace.cancel(null, true);
  await cancelled;
  await f.workspace.shutdown();
});

test("rediscovery removes stale roots and replaces changed project identities", async () => {
  const f = fixture();
  await f.workspace.start(true);
  await f.workspace.query("a");
  const replacement: Project = { root: "/workspace/a", kind: "workspace", commonDir: null };
  f.catalog.discover = async () => [replacement];
  f.catalog.resolve = async (path) => path.startsWith(replacement.root) ? replacement : null;
  await f.workspace.discover(null);
  assert.equal(await f.workspace.query(undefined), replacement.root);
  assert.doesNotMatch(f.workspace.context(), /workspace\/b/);
  await f.workspace.shutdown();
});

test("cancelling rediscovery while an old entry drains cannot retain a closed busy session", async () => {
  const f = fixture();
  await f.workspace.start(true);
  const run = f.boundary.run;
  let release!: () => void;
  let shutdownBegan!: () => void;
  const drained = new Promise<void>((resolve) => { release = resolve; });
  const shuttingDown = new Promise<void>((resolve) => { shutdownBegan = resolve; });
  f.boundary.run = async (root, args, signal) => {
    if (root === "/workspace/a") {
      signal.addEventListener("abort", shutdownBegan, { once: true });
      await drained;
      signal.throwIfAborted();
    }
    return run(root, args, signal);
  };
  const query = f.workspace.query("a");
  const queryCancelled = assert.rejects(query, /cancelled|changed/i);
  await new Promise((resolve) => setImmediate(resolve));
  f.catalog.discover = async () => [];
  const discovery = f.workspace.discover(null);
  const discoveryCancelled = assert.rejects(discovery, /cancelled/i);
  await shuttingDown;
  const cancel = f.workspace.cancel(null, true);
  release();
  await cancel;
  await discoveryCancelled;
  await queryCancelled;
  f.boundary.run = run;
  await f.workspace.perform("sync", "a", false);
  assert.equal(await f.workspace.query("a"), "/workspace/a");
  await f.workspace.shutdown();
});

test("ready project identity is validated again before forwarding a query", async () => {
  const f = fixture();
  await f.workspace.start(true);
  await f.workspace.query("a");
  f.failures.add("/workspace/a");
  f.catalog.resolve = async () => ({ root: "/workspace/a", kind: "workspace", commonDir: null });
  await assert.rejects(f.workspace.query("a"), /failure at/);
  await f.workspace.shutdown();
});

test("workspace opt-in is explicit; erase refuses online deletion without changing data", async () => {
  const f = fixture();
  await f.workspace.start(true);
  await assert.rejects(f.workspace.query("/unregistered"), /init --workspace/);
  await f.workspace.initWorkspace("/global");
  assert.equal(await f.workspace.query(undefined), "/global");
  assert.equal(f.initialized.has("/global"), true);
  await assert.rejects(f.workspace.erase("/global"), /Online erasure is unsupported/);
  assert.equal(f.initialized.has("/global"), true);
  await f.workspace.shutdown();
});

// Characterization: the text report is what `d details` and non-TUI clients show; its wording is fixed.
test("the text report keeps its wording for ready, idle, failed, partial and unmeasurable scopes", async () => {
  const f = fixture();
  let clock = 0;
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace", () => {}, () => `t${++clock}`);
  await workspace.start(true);
  assert.equal(await workspace.report(null), [
    "Codegraph inventory — last checks, not live watcher health; logical bytes (WAL/SHM included):",
    '  "/workspace/a" [checkout] idle',
    '  commonDir: "/workspace/a/.git"; last check: never',
    "  database 4 bytes; total 10 bytes",
    '  "/workspace/b" [checkout] idle',
    '  commonDir: "/workspace/b/.git"; last check: never',
    "  database 4 bytes; total 10 bytes",
    "Aggregate total 20 bytes; 2 scopes",
  ].join("\n"));
  await workspace.use("b");
  await workspace.query(undefined);
  f.failures.add("/workspace/a");
  await workspace.perform("sync", "a", false);
  f.catalog.size = async (root) => {
    if (root === "/workspace/a") throw new Error("unreadable index directory");
    return { databaseBytes: 4, totalBytes: 10, partial: true, detail: "skipped codegraph.db-wal" };
  };
  assert.equal(await workspace.report(null), [
    "Codegraph inventory — last checks, not live watcher health; logical bytes (WAL/SHM included):",
    '  "/workspace/a" [checkout] error',
    '  commonDir: "/workspace/a/.git"; last check: t7 error: Error: failure at /workspace/a',
    "  size unavailable: Error: unreadable index directory",
    '* "/workspace/b" [checkout] ready',
    '  commonDir: "/workspace/b/.git"; last check: t4 ready: /workspace/b: 1 files, 1 symbols',
    "  database 4 bytes; total 10 bytes (partial: skipped codegraph.db-wal)",
    "Aggregate total 10 bytes (partial); 2 scopes",
  ].join("\n"));
  assert.equal(await workspace.report("b"), [
    "Codegraph inventory — last checks, not live watcher health; logical bytes (WAL/SHM included):",
    '* "/workspace/b" [checkout] ready',
    '  commonDir: "/workspace/b/.git"; last check: t4 ready: /workspace/b: 1 files, 1 symbols',
    "  database 4 bytes; total 10 bytes (partial: skipped codegraph.db-wal)",
    "Aggregate total 10 bytes (partial); 1 scopes",
  ].join("\n"));
  await workspace.cancel("a", false);
  f.catalog.discover = async () => [];
  f.catalog.resolve = async () => null;
  await workspace.discover(null);
  assert.equal(await workspace.report(null), [
    "Codegraph inventory — last checks, not live watcher health; logical bytes (WAL/SHM included):",
    "Aggregate total 0 bytes; 0 scopes",
    "No projects. /cg discover PATH or /cg init --workspace PATH",
  ].join("\n"));
  await workspace.shutdown();
});

async function until(done: () => boolean): Promise<void> {
  for (let n = 0; n < 1000 && !done(); n++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done(), "condition was not reached");
}

// Regression: starting beside a process that is syncing the same index reported a failure.
test("an index locked by another process is busy elsewhere, not failed, and the next query retries", async () => {
  const f = fixture();
  f.initialized.add("/workspace/a");
  f.lockedElsewhere.add("/workspace/a");
  const states: State[] = [];
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace/a", (state) => states.push(state), () => "2026-11-17T20:58:47.541Z");
  await workspace.start(true);
  const syncs = () => f.calls.filter((call) => call === "/workspace/a:sync").length;
  await until(() => syncs() === 1 && workspace.state.phase !== "working");
  assert.deepEqual(workspace.state, { phase: "idle", detail: "not started" });
  assert.deepEqual(states.filter((state) => state.phase === "error"), [], "contention must never be published as an error");

  const status = await workspace.snapshot(null);
  const scope = status.scopes.find((item) => item.root === "/workspace/a")!;
  assert.equal(scopeState(scope), "busy elsewhere");
  assert.deepEqual(scope.busyElsewhere, { at: "2026-11-17T20:58:47.541Z", detail: `Error: ${LOCKED_ELSEWHERE}` });
  assert.equal(scope.lastCheck, null, "a refused attempt checked nothing");
  assert.equal(scope.lastFailure, null);
  const report = await workspace.report(null);
  assert.match(report, /^\* "\/workspace\/a" \[checkout\] busy elsewhere$/m);
  assert.match(report, /^  commonDir: "\/workspace\/a\/\.git"; last check: never$/m);
  assert.match(report, /^  busy elsewhere: 2026-11-17T20:58:47\.541Z: Error: codegraph sync exited 1: .*locked by another process \(kernel flock\)$/m);
  assert.doesNotMatch(report, /last failure|\] error|\] idle\n  commonDir: "\/workspace\/a\//);

  await assert.rejects(workspace.query(undefined), /Codegraph index busy at \/workspace\/a: another process holds the index lock; retry shortly/);
  assert.equal(syncs(), 2, "the on-demand preparation of an idle checkout is the retry");
  f.lockedElsewhere.clear();
  assert.equal(await workspace.query(undefined), "/workspace/a");
  assert.equal(syncs(), 3);
  const ready = (await workspace.snapshot(null)).scopes.find((item) => item.root === "/workspace/a")!;
  assert.equal(scopeState(ready), "ready");
  assert.equal(ready.busyElsewhere, null);
  assert.doesNotMatch(await workspace.report(null), /busy elsewhere/);
  await workspace.shutdown();
});

test("a refused sync leaves a verified index ready and a failed one failed; reports and batches name the refusal", async () => {
  const f = fixture();
  let clock = 0;
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace", () => {}, () => `t${++clock}`);
  await workspace.start(true);
  await workspace.query("a");
  const before = (await workspace.snapshot("a")).scopes[0]!;
  assert.equal(scopeState(before), "ready");
  f.lockedElsewhere.add("/workspace/a");
  await workspace.perform("sync", "a", false);
  const after = (await workspace.snapshot("a")).scopes[0]!;
  assert.equal(scopeState(after), "ready", "what was verified before the refused attempt still holds");
  assert.match(after.busyElsewhere!.detail, /locked by another process/);
  assert.deepEqual(after.lastCheck, before.lastCheck, "the refused attempt must not restamp the last check");
  assert.match(await workspace.report("a"), /\[checkout\] ready\n  commonDir: .*\n  busy elsewhere: t\d+: Error: codegraph sync exited 1: /);
  assert.equal(await workspace.query("a"), "/workspace/a", "queries keep using the verified index");
  await workspace.perform("sync", null, true);
  assert.match(await workspace.report(null), /^Last batch:\n\/workspace\/a: busy elsewhere\n\/workspace\/b: ready$/m);

  f.lockedElsewhere.clear();
  f.failures.add("/workspace/a");
  await workspace.perform("sync", "a", false);
  const failed = (await workspace.snapshot("a")).scopes[0]!;
  assert.equal(scopeState(failed), "error", "a genuine failure after a refusal is an error");
  assert.equal(failed.busyElsewhere, null);
  assert.match(failed.lastFailure!.detail, /failure at \/workspace\/a/);
  f.failures.clear();
  f.lockedElsewhere.add("/workspace/a");
  await workspace.perform("sync", "a", false);
  const still = (await workspace.snapshot("a")).scopes[0]!;
  assert.equal(scopeState(still), "error", "a refusal must not hide the failure that stands");
  assert.deepEqual(still.lastFailure, failed.lastFailure);
  assert.match(still.busyElsewhere!.detail, /locked by another process/);
  await assert.rejects(workspace.query("a"), /Codegraph index unavailable at \/workspace\/a; run \/cg sync PATH or \/cg reindex PATH\. Error: failure at/,
    "a failed checkout stays blocked until an explicit sync, as before");
  await workspace.shutdown();
});

test("the status snapshot carries what the pane shows and renders to the same text report", async () => {
  const f = fixture();
  const workspace = new CodegraphWorkspace(f.catalog, f.boundary, "/workspace", () => {}, () => "2026-11-17T20:58:47.541Z");
  await workspace.start(true);
  await workspace.use("b");
  await workspace.query(undefined);
  f.failures.add("/workspace/a");
  await workspace.perform("sync", "a", false);
  f.catalog.size = async (root) => {
    if (root === "/workspace/a") throw new Error("unreadable index directory");
    return { databaseBytes: 4, totalBytes: 10, partial: true, detail: "skipped codegraph.db-wal" };
  };
  const status = await workspace.snapshot(null);
  assert.equal(reportText(status), await workspace.report(null));
  assert.deepEqual(status.scopes.map((scope) => [scope.root, scope.isDefault, scopeState(scope), scope.counts]), [
    ["/workspace/a", false, "error", null],
    ["/workspace/b", true, "ready", { files: 1, symbols: 1 }],
  ]);
  const [a, b] = status.scopes;
  assert.deepEqual(a!.size, { ok: false, error: "Error: unreadable index directory" });
  assert.deepEqual(b!.size, { ok: true, value: { databaseBytes: 4, totalBytes: 10, partial: true, detail: "skipped codegraph.db-wal" } });
  assert.equal(a!.lastCheck!.state.phase, "error");
  assert.match(a!.lastFailure!.detail, /failure at \/workspace\/a/);
  assert.equal(b!.commonDir, "/workspace/b/.git");
  assert.equal(status.discoveryError, null);
  assert.deepEqual((await workspace.snapshot("b")).scopes.map((scope) => scope.root), ["/workspace/b"]);
  await workspace.shutdown();
});
