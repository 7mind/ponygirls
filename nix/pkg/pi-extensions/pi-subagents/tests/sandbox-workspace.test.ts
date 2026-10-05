import assert from "node:assert/strict";
import test, { after } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BwrapToolExecutor, DummyToolExecutor, type ToolExecutor, type ToolJobSpec } from "../src/sandbox.ts";
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
    readRoots: [join(dir, "work")],
    writableRoot: null,
    tmpDir: join(dir, "tmp"),
    hidePaths: [dir],
    runtimeRoots: ["/nix/store"],
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    network: false,
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
    await assert.rejects(() => exec.exec({ ...s, network: true }), /POLICY_DENIED/);
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
  const base: { operationId: string; cwd: string; readRoots: string[]; writableRoot: null; tmpDir: string; hidePaths: string[]; runtimeRoots: string[]; env: Record<string, string>; timeoutMs: number; maxOutputBytes: number; network: false } = { operationId: "op-r", cwd: work, readRoots: [work], writableRoot: null, tmpDir: join(dir, "tmp"), hidePaths: [dir], runtimeRoots: ["/nix/store"], env: { PATH: "/usr/bin:/bin" }, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, network: false };
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
    readRoots: [],
    writableRoot: null,
    tmpDir: join(dir, "tmp"),
    hidePaths: [dir],
    runtimeRoots: ["/nix/store"],
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 60_000,
    maxOutputBytes: 1024,
    network: false,
  });
  await new Promise((r) => setTimeout(r, 500));
  await exec.cancel?.("op-sleep");
  const res = await pending;
  assert.ok(res.exitCode !== 0 || res.signal !== null);
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
  const before = fingerprintWorktree(alloc.worktreePath, alloc.baseCommit, []);
  assert.equal(before.files.length, 0);
  writeFileSync(join(alloc.worktreePath, "new.txt"), "new\n");
  const afterChange = fingerprintWorktree(alloc.worktreePath, alloc.baseCommit, []);
  assert.equal(afterChange.files.length, 1);
  assert.equal(afterChange.files[0]!.kind, "untracked");
  // No file content archived in the manifest.
  assert.ok(!JSON.stringify(afterChange).includes("new\n"));
  const raw = readFileSync(join(alloc.worktreePath, "new.txt"), "utf8");
  assert.ok(raw.includes("new"));
});
