import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BwrapToolExecutor, DummyToolExecutor, HostToolExecutor, type ToolExecutor, type ToolJobSpec } from "../src/sandbox.ts";
import { readProcessIdentity } from "../src/process-identity.ts";
import { DummyWorkspaceManager, GitWorkspaceManager, fingerprintWorktree, type WorkspaceManager } from "../src/workspace.ts";
import { validateGateDecision } from "../src/gate.ts";

function absBin(name: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  const out = (r.stdout ?? "").trim().split("\n")[0]?.trim();
  return out || null;
}

function spec(overrides: Partial<ToolJobSpec> = {}): ToolJobSpec {
  const dir = mkdtempSync(join(tmpdir(), "subagents-tool-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "work"), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(dir, "work", "hello.txt"), "hello sandbox\n");
  const bash = absBin("bash") ?? "/bin/bash";
  return {
    operationId: "op-1",
    argv: [bash, "-c", "cat hello.txt"],
    cwd: join(dir, "work"),
    env: { PATH: "/usr/bin:/bin" },
    stdin: null,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    view: { readRoots: [join(dir, "work")], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [dir], runtimeRoots: ["/nix/store"], network: false },
  };
}

// Dual-test contract: real backend and dummy share ToolExecutor behavior.
for (const [name, make] of [["bwrap", () => new BwrapToolExecutor()], ["dummy", () => new DummyToolExecutor()]] as Array<[string, () => ToolExecutor]>) {
  test(`[${name}] probe gates execution; network jobs are denied`, async () => {
    const exec = make();
    const probe = exec.probe();
    if (name === "bwrap" && !probe.ok) {
      console.log("NOT-EXECUTED: bwrap probe failed in this environment; sandbox checks skipped, not passed");
      return;
    }
    assert.ok(probe.ok);
    const s = spec();
    await assert.rejects(() => exec.exec({ ...s, view: { ...s.view!, network: true } }), /POLICY_DENIED/);
  });
}

test("[bwrap] allowed reads succeed; traversal escape and secret access fail", async () => {
  const exec = new BwrapToolExecutor();
  const probe = exec.probe();
  if (!probe.ok) {
    console.log("NOT-EXECUTED: bwrap unavailable; sandbox checks skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-bwrap-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, "work");
  const secret = join(dir, "secret");
  mkdirSync(work, { recursive: true });
  mkdirSync(secret, { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(work, "ok.txt"), "visible\n");
  writeFileSync(join(secret, "key"), "TOPSECRET\n");
  const bash = absBin("bash") ?? "/bin/bash";
  const cat = absBin("cat") ?? "/bin/cat";
  const ls = absBin("ls") ?? "/bin/ls";
  const wc = absBin("wc") ?? "/bin/wc";
  const base: Omit<ToolJobSpec, "argv"> = { operationId: "op-r", cwd: work, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024,
    view: { readRoots: [work], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [dir], runtimeRoots: ["/nix/store"], network: false } };
  const readOk = await exec.exec({ ...base, operationId: "op-ok", argv: [bash, "-c", `${cat} ok.txt`] });
  assert.equal(readOk.exitCode, 0);
  assert.ok(readOk.stdout.includes("visible"));
  // Absolute-path escape to the secret: the mount view denies it (path
  // checks alone are not the boundary; the sandbox is).
  const escapeAbs = await exec.exec({ ...base, operationId: "op-abs", argv: [bash, "-c", `${cat} ${secret}/key`] });
  assert.notEqual(escapeAbs.exitCode, 0);
  // Symlink escape from inside the view.
  spawnSync("ln", ["-s", join(secret, "key"), join(work, "link")]);
  const escapeLink = await exec.exec({ ...base, operationId: "op-link", argv: [bash, "-c", `${cat} link`] });
  assert.notEqual(escapeLink.exitCode, 0);
  // Unrelated workspace content hidden even though --ro-bind / / is the base.
  // Missing dirs count as hidden (nothing to expose).
  const homeHidden = await exec.exec({ ...base, operationId: "op-home", argv: [bash, "-c", `${ls} /home 2>/dev/null | ${wc} -l`] });
  assert.equal(homeHidden.stdout.trim(), "0");
  // Host network is unreachable from the tool job: no routes in the netns.
  const net = await exec.exec({ ...base, operationId: "op-net", argv: [bash, "-c", `${cat} /proc/net/route`] });
  assert.ok(!net.stdout.includes("00000000"));
});

test("[bwrap] cancellation terminates the job; grandchildren do not survive", async () => {
  const exec = new BwrapToolExecutor();
  if (!exec.probe().ok) {
    console.log("NOT-EXECUTED: bwrap unavailable; cancellation check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-cancel-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "tmp"), { recursive: true });
  const bash = absBin("bash") ?? "/bin/bash";
  const pending = exec.exec({
    operationId: "op-sleep",
    argv: [bash, "-c", "sleep 60"],
    cwd: dir,
    env: { PATH: "/usr/bin:/bin" },
    stdin: null,
    timeoutMs: 60_000,
    maxOutputBytes: 1024,
    view: { readRoots: [], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [dir], runtimeRoots: ["/nix/store"], network: false },
  });
  await new Promise((r) => setTimeout(r, 500));
  await exec.cancel?.("op-sleep");
  const res = await pending;
  assert.ok(res.exitCode !== 0 || res.signal !== null);
});

function hostSpec(cwd: string, script: string, timeoutMs: number): ToolJobSpec {
  return {
    operationId: `op-${Math.random().toString(36).slice(2)}`,
    argv: [absBin("bash") ?? "/bin/bash", "-c", script],
    cwd,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", MARK: "host-env" },
    stdin: null,
    timeoutMs,
    maxOutputBytes: 64 * 1024,
    view: null,
  };
}

const alive = (pid: number): boolean => readProcessIdentity(pid) !== null;

test("[host] jobs run in their cwd with the given environment; views are refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-host-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const exec = new HostToolExecutor();
  const res = await exec.exec(hostSpec(dir, "pwd; echo $MARK", 10_000));
  assert.deepEqual(res.stdout.trim().split("\n"), [dir, "host-env"]);
  await assert.rejects(() => exec.exec({ ...hostSpec(dir, "true", 10_000), view: spec().view }), /INVALID: the host executor cannot enforce a sandbox view/);
  await assert.rejects(() => new BwrapToolExecutor().exec(hostSpec(dir, "true", 10_000)), /INVALID: a sandboxed job needs a view/);
});

test("[host] a background descendant does not outlive its job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-host-bg-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const started = Date.now();
  const res = await new HostToolExecutor().exec(hostSpec(dir, "sleep 30 >/dev/null 2>&1 & echo $!", 20_000));
  const pid = Number(res.stdout.trim());
  assert.ok(Date.now() - started < 10_000, "the job waited for its background child");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(alive(pid), false, `background sleep ${pid} survived its job`);
});

test("[host] timeout and cancellation kill the whole process group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-host-kill-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const exec = new HostToolExecutor();
  const timed = await exec.exec(hostSpec(dir, `sleep 30 & echo $! > ${dir}/t.pid; wait`, 500));
  assert.equal(timed.timedOut, true);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(alive(Number(readFileSync(join(dir, "t.pid"), "utf8"))), false, "grandchild survived the timeout");
  const job = hostSpec(dir, `sleep 30 & echo $! > ${dir}/c.pid; wait`, 30_000);
  const pending = exec.exec(job);
  while (!existsSync(join(dir, "c.pid")) || readFileSync(join(dir, "c.pid"), "utf8").trim() === "") await new Promise((r) => setTimeout(r, 20));
  await exec.cancel(job.operationId);
  const res = await pending;
  assert.ok(res.exitCode !== 0 || res.signal !== null);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(alive(Number(readFileSync(join(dir, "c.pid"), "utf8"))), false, "grandchild survived cancellation");
});

function initRepo(dir: string): string {
  spawnSync("git", ["init", "-q", dir]);
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "t"]);
  writeFileSync(join(dir, "base.txt"), "base\n");
  spawnSync("git", ["-C", dir, "add", "."]);
  spawnSync("git", ["-C", dir, "commit", "-qm", "base"]);
  return spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

for (const [name, make] of [["git", () => new GitWorkspaceManager()], ["dummy", () => new DummyWorkspaceManager()]] as Array<[string, () => WorkspaceManager]>) {
  test(`[${name}] writer allocation isolates work; release keeps dirty worktrees`, () => {
    const mgr = make();
    const dir = mkdtempSync(join(tmpdir(), "subagents-ws-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const checkout = join(dir, "checkout");
    mkdirSync(checkout, { recursive: true });
    let base = "c0";
    if (name === "git") base = initRepo(checkout);
    const a = mgr.allocateWriter("r1", checkout, base, join(dir, "wts"));
    const b = mgr.allocateWriter("r1", checkout, base, join(dir, "wts"));
    assert.notEqual(a.worktreePath, b.worktreePath);
    // Release without prune: retained (explicit user action required).
    mgr.releaseAllocation(a);
    assert.ok(existsSync(a.worktreePath));
    // Prune refuses dirty worktrees.
    if (name === "git") {
      writeFileSync(join(a.worktreePath, "dirty.txt"), "x\n");
      assert.throws(() => mgr.releaseAllocation(a, { prune: true }), /CONFLICT/);
    }
  });
}

test("[git] fingerprint is metadata-only and detects external mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fp-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const mgr = new GitWorkspaceManager();
  const alloc = mgr.allocateWriter("r1", checkout, base, join(dir, "wts"));
  const before = fingerprintWorktree(alloc, alloc.baseCommit, []);
  assert.equal(before.files.length, 0);
  writeFileSync(join(alloc.worktreePath, "new.txt"), "new\n");
  const afterChange = fingerprintWorktree(alloc, alloc.baseCommit, []);
  assert.equal(afterChange.files.length, 1);
  assert.equal(afterChange.files[0]!.kind, "untracked");
  // No file content archived in the manifest.
  assert.ok(!JSON.stringify(afterChange).includes("new\n"));
  const raw = readFileSync(join(alloc.worktreePath, "new.txt"), "utf8");
  assert.ok(raw.includes("new"));
});

test("[git] fingerprinting never hands worktree file names to a host shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpinj-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  const marker = join(process.cwd(), "FPINJ_MARKER");
  rmSync(marker, { force: true });
  writeFileSync(join(alloc.worktreePath, "$(touch${IFS}FPINJ_MARKER)"), "x\n");
  try {
    const fp = fingerprintWorktree(alloc, alloc.baseCommit, []);
    assert.equal(fp.files.length, 1);
    assert.equal(existsSync(marker), false, "a worktree file name was executed by a host shell");
  } finally {
    rmSync(marker, { force: true });
  }
});

test("[git] host git ignores a .git file rewritten inside the worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gitredir-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  // What a sandboxed writer can do: plant a repository with a hostile
  // config inside its worktree and point the worktree's .git file at it.
  const evil = join(alloc.worktreePath, "evil");
  spawnSync("git", ["init", "-q", evil]);
  const marker = join(dir, "GITREDIR_MARKER");
  spawnSync("git", ["-C", evil, "config", "core.fsmonitor", `touch ${marker}; false`]);
  writeFileSync(join(alloc.worktreePath, ".git"), `gitdir: ${join(evil, ".git")}\n`);
  try {
    fingerprintWorktree(alloc, alloc.baseCommit, []);
  } catch {
    // Refusing the hostile worktree is acceptable; executing its config is not.
  }
  assert.equal(existsSync(marker), false, "host git executed configuration planted by the writer");
});

test("[git] worktree creation runs no repository hooks", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-hooks-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const marker = join(dir, "HOOK_MARKER");
  writeFileSync(join(checkout, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  assert.equal(existsSync(marker), false, "post-checkout hook ran during worktree creation");
});

test("[bwrap] a hidden path inside a read root stays hidden", async () => {
  const exec = new BwrapToolExecutor();
  if (!exec.probe().ok) {
    console.log("NOT-EXECUTED: bwrap unavailable; hide-order check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-hide-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "root", "hidden"), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(dir, "root", "hidden", "secret"), "SECRET-MARKER\n");
  writeFileSync(join(dir, "root", "visible"), "ok\n");
  const cat = absBin("cat") ?? "/bin/cat";
  const res = await exec.exec({
    operationId: "op-hide",
    argv: [cat, join(dir, "root", "visible"), join(dir, "root", "hidden", "secret")],
    cwd: join(dir, "root"),
    env: { PATH: "/usr/bin:/bin" },
    stdin: null,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    view: { readRoots: [join(dir, "root")], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [join(dir, "root", "hidden")], runtimeRoots: ["/nix/store"], network: false },
  });
  assert.ok(res.stdout.includes("ok"), `visible file unreadable: ${res.stderr}`);
  assert.ok(!res.stdout.includes("SECRET-MARKER"), "hidden path re-exposed by its read root");
});

test("[bwrap] the view is an allowlist: unlisted host trees (nix daemon socket, /sys) are absent", async () => {
  const exec = new BwrapToolExecutor();
  if (!exec.probe().ok) {
    console.log("NOT-EXECUTED: bwrap unavailable; allowlist check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-allow-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "tmp"), { recursive: true });
  const bash = absBin("bash") ?? "/bin/bash";
  const res = await exec.exec({
    operationId: "op-allow",
    argv: [bash, "-c", "for p in /nix/var/nix /sys/kernel; do if [ -e $p ]; then echo PRESENT:$p; fi; done; echo done"],
    cwd: join(dir, "tmp"),
    env: { PATH: "/usr/bin:/bin" },
    stdin: null,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    view: { readRoots: [], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [], runtimeRoots: ["/nix/store"], network: false },
  });
  assert.ok(res.stdout.includes("done"), `probe script failed: ${res.stderr}`);
  assert.ok(!res.stdout.includes("PRESENT:"), `unlisted host paths visible: ${res.stdout}`);
});

test("[git] fingerprinting skips special files instead of blocking on them", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fifo-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  rmSync(join(alloc.worktreePath, "base.txt"));
  spawnSync("mkfifo", [join(alloc.worktreePath, "base.txt")]);
  // A child process so a blocking read cannot hang the test runner itself.
  const script = `import { fingerprintWorktree } from ${JSON.stringify(new URL("../src/workspace.ts", import.meta.url).href)};
const fp = fingerprintWorktree(${JSON.stringify({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir })}, null, []);
console.log(JSON.stringify(fp.files));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(r.error, undefined, "fingerprinting blocked on a FIFO");
  const files = JSON.parse(r.stdout) as Array<{ path: string; mode: string }>;
  assert.ok(files.find((f) => f.path === "base.txt")?.mode?.startsWith("special:"), "FIFO must be special with bound mode");
});

// regression: issue6 — candidate covers allocation base..HEAD committed delta plus dirty/untracked.
// BA @regression(issue=6): real Git, no invented manifest-only validator.
test("[git] fingerprint includes committed adds/edits/deletes with exact content", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpcommit-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const mgr = new GitWorkspaceManager();
  const alloc = mgr.allocateWriter("r1", checkout, base, join(dir, "wts"));
  const git = (args: string[]): string => {
    const r = spawnSync("git", args, { cwd: alloc.worktreePath, encoding: "utf8" });
    assert.equal(r.status, 0, args.join(" "));
    return (r.stdout ?? "").trim();
  };
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.name", "t"]);
  // Committed add.
  writeFileSync(join(alloc.worktreePath, "new.txt"), "v1\n");
  git(["add", "new.txt"]);
  git(["commit", "-qm", "add"]);
  let fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.ok(fp.files.some((f) => f.path === "new.txt" && f.kind === "committed-add"), `committed add missing: ${JSON.stringify(fp.files)}`);
  {
    const added = fp.files.find((f) => f.path === "new.txt")!;
    assert.equal(added.hash, createHash("sha256").update(readFileSync(join(alloc.worktreePath, "new.txt"))).digest("hex"), "add hash must match independent sha256");
  }
  // Committed edit preserves exact content (no full-HEAD equality vagueness).
  writeFileSync(join(alloc.worktreePath, "base.txt"), "edited\n");
  git(["add", "base.txt"]);
  git(["commit", "-qm", "edit"]);
  fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  const edited = fp.files.find((f) => f.path === "base.txt")!;
  assert.equal(edited.kind, "committed-edit");
  assert.ok(!JSON.stringify(fp).includes("edited\n"), "content must not be archived in the manifest");
  {
    assert.equal(edited.hash, createHash("sha256").update(readFileSync(join(alloc.worktreePath, "base.txt"))).digest("hex"), "edit hash must match independent sha256");
  }
  // Committed delete.
  rmSync(join(alloc.worktreePath, "base.txt"));
  git(["add", "-A"]);
  git(["commit", "-qm", "del"]);
  fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.ok(fp.files.some((f) => f.path === "base.txt" && f.kind === "committed-delete"), `committed delete missing: ${JSON.stringify(fp.files)}`);
  // Diff/status expose committed deltas.
  const diff = mgr.diff(alloc, 65536);
  assert.ok(diff.changedFiles.includes("new.txt"), `diff missing committed: ${JSON.stringify(diff.changedFiles)}`);
  assert.ok(diff.diff.includes("new.txt") || diff.diff.length > 0, "diff text should expose committed content");
});

// regression: committed citation resolves through the real decision validator.
// BA @regression(issue=6)
test("[git] committed file citation resolves via real gate validator; unknown still rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpcite-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.name", "t"]);
  writeFileSync(join(alloc.worktreePath, "cite.txt"), "cite\n");
  spawnSync("git", ["-C", alloc.worktreePath, "add", "cite.txt"]);
  spawnSync("git", ["-C", alloc.worktreePath, "commit", "-qm", "cite"]);
  const fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  const manifest = new Set(fp.files.map((f) => f.path));
  const ok = validateGateDecision(
    { schemaVersion: 1, candidateId: "candidate-1", decision: "revise", blockers: [{ id: "b1", target: "cite.txt", problem: "p", requiredChange: "r", evidenceRefs: ["candidate-1:cite.txt"] }], advisories: [] },
    "candidate-1", manifest, new Set(),
  );
  assert.equal(ok.ok, true, `committed citation should resolve: ${JSON.stringify(ok)}`);
  const bad = validateGateDecision(
    { schemaVersion: 1, candidateId: "candidate-1", decision: "revise", blockers: [{ id: "b1", target: "nope.txt", problem: "p", requiredChange: "r", evidenceRefs: ["candidate-1:nope.txt"] }], advisories: [] },
    "candidate-1", manifest, new Set(),
  );
  assert.equal(bad.ok, false, "unknown path must still be rejected");
});

// regression: post-capture commit is a mismatch, not silent equality.
// BA @regression(issue=6)
test("[git] post-capture commit changes the fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpmismatch-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  const before = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", alloc.worktreePath, "config", "user.name", "t"]);
  writeFileSync(join(alloc.worktreePath, "post.txt"), "x\n");
  spawnSync("git", ["-C", alloc.worktreePath, "add", "post.txt"]);
  spawnSync("git", ["-C", alloc.worktreePath, "commit", "-qm", "post"]);
  const afterChange = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.notDeepEqual(afterChange.files, before.files, "post-capture commit must be detected");
});

// regression: promised content/mode drift is detected (and preserved).
// BA @regression(issue=6)
test("[git] promised output content and mode drift change the fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpprom-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  writeFileSync(join(alloc.worktreePath, "prom.txt"), "v1\n");
  const f1 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["prom.txt"]);
  writeFileSync(join(alloc.worktreePath, "prom.txt"), "v2\n");
  const f2 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["prom.txt"]);
  assert.notDeepEqual(f2.files, f1.files, "promised content drift must be detected");
  spawnSync("chmod", ["+x", join(alloc.worktreePath, "prom.txt")]);
  const f3 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["prom.txt"]);
  assert.notEqual(f3.files.find((f) => f.path === "prom.txt")?.mode, f2.files.find((f) => f.path === "prom.txt")?.mode, "promised mode drift must be detected");
});

// Fail-closed, never silently partial: exceeding maxFiles throws.
// BA @regression(issue=6)
test("[git] exceeding maxFiles fails closed instead of silently partial", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fpmax-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  for (let i = 0; i < 6; i++) writeFileSync(join(alloc.worktreePath, `u${i}.txt`), "x\n");
  assert.throws(() => fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, [], 5), /PAYLOAD_TOO_LARGE/);
});

// C2: dangling committed symlinks missing-a vs missing-b must differ (no-follow existence + link binding).
// BA @regression(c2-dangling)
test("[git] dangling committed symlink targets are distinguished", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c2dang-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const mgr = new GitWorkspaceManager();
  const { symlinkSync } = await import("node:fs");
  const mkLink = (sub: string, target: string): { fp: ReturnType<typeof fingerprintWorktree> } => {
    const alloc = mgr.allocateWriter("r1", checkout, base, join(dir, sub));
    symlinkSync(target, join(alloc.worktreePath, "link.txt"));
    spawnSync("git", ["-C", alloc.worktreePath, "add", "link.txt"]);
    spawnSync("git", ["-C", alloc.worktreePath, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "link"]);
    return { fp: fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []) };
  };
  const a = mkLink("wtsA", "missing-a").fp;
  const b = mkLink("wtsB", "missing-b").fp;
  assert.ok(a.files.some((f) => f.path === "link.txt" && f.kind !== "committed-delete"), `dangling link-a must not be deletion: ${JSON.stringify(a.files)}`);
  assert.notDeepEqual(b.files, a.files, "missing-a vs missing-b must differ");
  // Independent oracle: link targets bound in hash.
  assert.equal(a.files.find((f) => f.path === "link.txt")?.hash, `link:${createHash("sha256").update(Buffer.from("missing-a")).digest("hex")}`);
  assert.equal(b.files.find((f) => f.path === "link.txt")?.hash, `link:${createHash("sha256").update(Buffer.from("missing-b")).digest("hex")}`);
});

// C2: exact maxFiles with deduped promised path must not throw spurious cap.
// BA @regression(c2-cap-dedup)
test("[git] exact maxFiles with already-covered promised path succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c2cap-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  writeFileSync(join(alloc.worktreePath, "only.txt"), "x\n");
  const fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["only.txt"], 1);
  assert.equal(fp.files.length, 1);
  assert.equal(fp.files[0]?.path, "only.txt");
});

// C2: full permission mode bound — 0644 vs 0600 on a git-ignored promised file must differ.
// BA @regression(c2-permmode)
test("[git] promised ignored-file permission tightening changes the fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c2perm-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  writeFileSync(join(alloc.worktreePath, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(alloc.worktreePath, "ignored.txt"), "same-content\n");
  spawnSync("chmod", ["0644", join(alloc.worktreePath, "ignored.txt")]);
  const f1 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["ignored.txt"]);
  spawnSync("chmod", ["0600", join(alloc.worktreePath, "ignored.txt")]);
  const f2 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["ignored.txt"]);
  assert.notDeepEqual(f2.files, f1.files, "0644 vs 0600 must differ (full mode bound)");
});

// C2: special-file permission bits bound (FIFO chmod drift detected).
// BA @regression(c2-specialmode)
test("[git] FIFO permission drift changes the fingerprint", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c2fifo-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  rmSync(join(alloc.worktreePath, "base.txt"));
  spawnSync("mkfifo", [join(alloc.worktreePath, "base.txt")]);
  spawnSync("chmod", ["0644", join(alloc.worktreePath, "base.txt")]);
  const f1 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  spawnSync("chmod", ["0600", join(alloc.worktreePath, "base.txt")]);
  const f2 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.notDeepEqual(f2.files, f1.files, "FIFO 0644 vs 0600 must differ");
});

// C3: inventory reconciliation — physical untracked/promised file wins over delete descriptors; exactly one path.
// BA @regression(c3-path)
test("[git] staged delete plus untracked replacement reports the physical file, not deletion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c3path-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  spawnSync("git", ["-C", alloc.worktreePath, "rm", "-q", "base.txt"]);
  writeFileSync(join(alloc.worktreePath, "base.txt"), "replacement\n");
  spawnSync("chmod", ["0600", join(alloc.worktreePath, "base.txt")]);
  const fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["base.txt"]);
  const matches = fp.files.filter((f) => f.path === "base.txt");
  assert.equal(matches.length, 1, `exactly one path, got ${JSON.stringify(matches)}`);
  const e = matches[0]!;
  assert.notEqual(e.hash, "deleted", "physical file must win over delete descriptor");
  assert.notEqual(e.hash, "missing", "physical file must win over missing marker");
  // Independent oracles: content hash + full mode.
  assert.equal(e.hash, createHash("sha256").update(readFileSync(join(alloc.worktreePath, "base.txt"))).digest("hex"));
  assert.equal(e.mode, "file:0600");
});

// C3: genuine absence stays deletion (no phantom resurrection).
// BA @regression(c3-path)
test("[git] staged delete with no replacement stays deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c3absent-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  spawnSync("git", ["-C", alloc.worktreePath, "rm", "-q", "base.txt"]);
  const fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  const matches = fp.files.filter((f) => f.path === "base.txt");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.hash, "deleted");
  assert.equal(matches[0]?.mode, "gone");
});

// C3: IGNORED promised replacement of a committed-deleted path is described (not deletion/missing).
// BA @regression(c3-path)
test("[git] ignored promised replacement of committed-deleted path wins over deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c3ignore-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const mgr = new GitWorkspaceManager();
  const alloc = mgr.allocateWriter("r1", checkout, base, join(dir, "wts"));
  spawnSync("git", ["-C", alloc.worktreePath, "rm", "-q", "base.txt"]);
  spawnSync("git", ["-C", alloc.worktreePath, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "del"]);
  writeFileSync(join(alloc.worktreePath, ".gitignore"), "base.txt\n");
  writeFileSync(join(alloc.worktreePath, "base.txt"), "ignored-replacement\n");
  const fp = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, ["base.txt"]);
  const matches = fp.files.filter((f) => f.path === "base.txt");
  assert.equal(matches.length, 1, `exactly one path, got ${JSON.stringify(matches)}`);
  assert.notEqual(matches[0]?.hash, "deleted");
  assert.notEqual(matches[0]?.hash, "missing");
  assert.equal(matches[0]?.hash, createHash("sha256").update(readFileSync(join(alloc.worktreePath, "base.txt"))).digest("hex"));
});

// C4: distinct non-UTF8 symlink targets must not alias via U+FFFD replacement.
// BA @regression(c4-symlink-bytes): independent oracle reads raw buffer hex, never the decoded string.
test("[git] non-UTF8 symlink targets are distinguished by raw bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c4sym-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  const { symlinkSync: _sl, unlinkSync: _ul, readlinkSync: _rl } = await import("node:fs");
  const rawHex = (): string => (_rl(join(alloc.worktreePath, "link.txt"), { encoding: "buffer" }) as Buffer).toString("hex");
  _sl(Buffer.from([0x80]), join(alloc.worktreePath, "link.txt"));
  assert.equal(rawHex(), "80");
  const f80 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  _ul(join(alloc.worktreePath, "link.txt"));
  _sl(Buffer.from([0x81]), join(alloc.worktreePath, "link.txt"));
  assert.equal(rawHex(), "81");
  const f81 = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.notDeepEqual(f81.files, f80.files, "0x80 vs 0x81 targets must differ");
  // Independent oracle: opaque SHA256 over the raw target bytes (never the decoded string).
  assert.equal(f80.files.find((f) => f.path === "link.txt")?.hash, `link:${createHash("sha256").update(Buffer.from([0x80])).digest("hex")}`);
  assert.equal(f81.files.find((f) => f.path === "link.txt")?.hash, `link:${createHash("sha256").update(Buffer.from([0x81])).digest("hex")}`);
});

// C5: raw bytes and UTF8 literal text share one opaque identity domain (no cross-domain alias).
// BA @regression(c5-symlink-domains): mirrors parent 1515 diagnostic; independent sha256 oracles.
test("[git] raw symlink bytes never alias a UTF8 target named by their hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-c5dom-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout, { recursive: true });
  const base = initRepo(checkout);
  const alloc = new GitWorkspaceManager().allocateWriter("r1", checkout, base, join(dir, "wts"));
  const { symlinkSync: _sl, unlinkSync: _ul } = await import("node:fs");
  const raw = Buffer.from([0x80]);
  const literal = createHash("sha256").update(raw).digest("hex");
  // Both referents exist so existence cannot explain any difference.
  writeFileSync(join(alloc.worktreePath, "raw-referent"), "raw");
  writeFileSync(join(alloc.worktreePath, literal), "text");
  _sl(raw, join(alloc.worktreePath, "p"));
  const fRaw = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  _ul(join(alloc.worktreePath, "p"));
  _sl(literal, join(alloc.worktreePath, "p"));
  const fText = fingerprintWorktree({ worktreePath: alloc.worktreePath, gitDir: alloc.gitDir }, alloc.baseCommit, []);
  assert.notDeepEqual(fText.files, fRaw.files, "raw hash bytes and literal target text must not alias");
  assert.equal(fRaw.files.find((f) => f.path === "p")?.hash, `link:${createHash("sha256").update(raw).digest("hex")}`);
  assert.equal(fText.files.find((f) => f.path === "p")?.hash, `link:${createHash("sha256").update(Buffer.from(literal)).digest("hex")}`);
});
