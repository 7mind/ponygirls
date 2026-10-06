import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BwrapToolExecutor, DummyToolExecutor, HostToolExecutor, type ToolExecutor, type ToolJobSpec } from "../src/sandbox.ts";
import { readProcessIdentity } from "../src/process-identity.ts";
import { DummyWorkspaceManager, GitWorkspaceManager, fingerprintWorktree, type WorkspaceManager } from "../src/workspace.ts";

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
  assert.equal(files.find((f) => f.path === "base.txt")?.mode, "special");
});
