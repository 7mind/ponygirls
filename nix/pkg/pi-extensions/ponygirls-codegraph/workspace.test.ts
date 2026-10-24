import assert from "node:assert/strict";
import test from "node:test";
import { CodegraphWorkspace } from "./workspace.ts";
import type { Catalog, Project } from "./projects.ts";
import type { Boundary } from "./runtime.ts";

function fixture() {
  const projects: Project[] = [
    { root: "/workspace/a", kind: "checkout", commonDir: "/workspace/a/.git" },
    { root: "/workspace/b", kind: "checkout", commonDir: "/workspace/b/.git" },
  ];
  const initialized = new Set<string>();
  const failures = new Set<string>();
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
  return { workspace, catalog, boundary, initialized, failures, calls, holds, probes: () => probes };
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
