import assert from "node:assert/strict";
import test from "node:test";
import { authorizeTool, authorizeWorkspace, defaultSupervisorPolicy, intersectGrants, pathWithin, rootGrants } from "../src/policy.ts";

function policy() {
  const p = defaultSupervisorPolicy();
  p.maxDepth = 2;
  p.nesting = true;
  p.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  p.allowedModels = [{ provider: "p", id: "m" }];
  return p;
}

test("reader cannot hold shell; a sandboxed writer requires an approved repository", () => {
  const p = policy();
  const root = rootGrants(p);
  const reader = intersectGrants(p, root, { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: null, depth: 1 });
  assert.ok(reader.ok);
  const readerShell = intersectGrants(p, root, { profile: "reader", isolation: "sandbox", repoId: null, shell: true, network: false, model: null, depth: 1 });
  assert.equal(readerShell.ok, false);
  const writerNoRepo = intersectGrants(p, root, { profile: "writer", isolation: "sandbox", repoId: null, shell: true, network: false, model: null, depth: 1 });
  assert.equal(writerNoRepo.ok, false);
});

test("unknown repository identities are rejected before workspace binding", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "writer", isolation: "sandbox", repoId: "evil", shell: true, network: false, model: null, depth: 1 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "POLICY_DENIED");
});

test("nested writer cannot widen beyond owner grants (intersection at every edge)", () => {
  const p = policy();
  const root = rootGrants(p);
  const child = intersectGrants(p, root, { profile: "writer", isolation: "sandbox", repoId: "r1", shell: true, network: false, model: null, depth: 1 });
  assert.ok(child.ok);
  if (!child.ok) return;
  // Grandchild requesting a repo the child was never granted: denied.
  const p2 = { ...p, repos: [...p.repos, { repoId: "r2", checkoutPath: "/other", readRoots: ["/other"], allowWriters: true }] };
  const grandchild = intersectGrants(p2, child.grants, { profile: "reader", isolation: "sandbox", repoId: "r2", shell: false, network: false, model: null, depth: 2 });
  assert.equal(grandchild.ok, false);
  // Reader owner cannot delegate writer authority it lacks.
  const readerOwner = intersectGrants(p, root, { profile: "reader", isolation: "sandbox", repoId: "r1", shell: false, network: false, model: null, depth: 1 });
  assert.ok(readerOwner.ok);
  if (!readerOwner.ok) return;
  const escalated = intersectGrants(p, readerOwner.grants, { profile: "writer", isolation: "sandbox", repoId: "r1", shell: true, network: false, model: null, depth: 2 });
  assert.equal(escalated.ok, false);
});

test("depth beyond maxDepth is denied", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: null, depth: 3 });
  assert.equal(res.ok, false);
});

test("model outside the root allowlist is denied", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: { provider: "evil", id: "x" }, depth: 1 });
  assert.equal(res.ok, false);
});

test("null allowlist permits any explicit model override", () => {
  const p = policy();
  p.allowedModels = null;
  const res = intersectGrants(p, rootGrants(p), { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: { provider: "any", id: "thing" }, depth: 1 });
  assert.ok(res.ok);
});

test("tool authorization is post-transform and closed-world", () => {
  const p = policy();
  const root = rootGrants(p);
  const reader = intersectGrants(p, root, { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: null, depth: 1 });
  assert.ok(reader.ok);
  if (!reader.ok) return;
  assert.ok(authorizeTool(reader.grants, "read").ok);
  assert.equal(authorizeTool(reader.grants, "bash").ok, false);
  assert.equal(authorizeTool(reader.grants, "ctx.executeTool").ok, false);
  assert.equal(authorizeTool(reader.grants, "rm").ok, false);
});

test("a child is never less isolated than its owner", () => {
  const p = policy();
  const req = (isolation: "none" | "worktree" | "sandbox", depth: number) => ({ profile: "reader" as const, isolation, repoId: isolation === "sandbox" ? "r1" : null, shell: false, network: false, model: null, depth });
  for (const iso of ["none", "worktree", "sandbox"] as const) assert.ok(intersectGrants(p, rootGrants(p), req(iso, 1)).ok, iso);
  const worktree = intersectGrants(p, rootGrants(p), req("worktree", 1));
  const sandbox = intersectGrants(p, rootGrants(p), req("sandbox", 1));
  assert.ok(worktree.ok && sandbox.ok);
  if (!worktree.ok || !sandbox.ok) return;
  const denied = (r: ReturnType<typeof intersectGrants>) => !r.ok && r.error.code === "POLICY_DENIED" && /cannot be less isolated/.test(r.error.message);
  assert.ok(denied(intersectGrants(p, worktree.grants, req("none", 2))));
  assert.ok(intersectGrants(p, worktree.grants, req("worktree", 2)).ok);
  assert.ok(intersectGrants(p, worktree.grants, req("sandbox", 2)).ok);
  assert.ok(denied(intersectGrants(p, sandbox.grants, req("none", 2))));
  assert.ok(denied(intersectGrants(p, sandbox.grants, req("worktree", 2))));
});

test("host-isolated writers need no registered repository; repo_id is sandbox-only", () => {
  const p = defaultSupervisorPolicy();
  const writer = intersectGrants(p, rootGrants(p), { profile: "writer", isolation: "none", repoId: null, shell: true, network: false, model: null, depth: 1 });
  assert.ok(writer.ok);
  if (writer.ok) assert.deepEqual({ isolation: writer.grants.isolation, shell: writer.grants.shell, write: writer.grants.tools.includes("write") }, { isolation: "none", shell: true, write: true });
  const withRepo = intersectGrants(policy(), rootGrants(policy()), { profile: "writer", isolation: "worktree", repoId: "r1", shell: true, network: false, model: null, depth: 1 });
  assert.equal(withRepo.ok, false);
  if (!withRepo.ok) assert.equal(withRepo.error.code, "INVALID");
});

test("a host-isolated child keeps its owner's repository grants for sandboxed delegation", () => {
  const p = policy();
  const reader = intersectGrants(p, rootGrants(p), { profile: "reader", isolation: "none", repoId: null, shell: false, network: false, model: null, depth: 1 });
  assert.ok(reader.ok);
  if (!reader.ok) return;
  assert.deepEqual(reader.grants.repos, [{ repoId: "r1", read: true, write: false }]);
  assert.ok(intersectGrants(p, reader.grants, { profile: "reader", isolation: "sandbox", repoId: "r1", shell: false, network: false, model: null, depth: 2 }).ok);
  assert.equal(intersectGrants(p, reader.grants, { profile: "writer", isolation: "sandbox", repoId: "r1", shell: true, network: false, model: null, depth: 2 }).ok, false);
});

test("a prepared workspace is denied by default and allowed only inside a listed root", () => {
  assert.deepEqual(defaultSupervisorPolicy().workspaceRoots, []);
  assert.equal(defaultSupervisorPolicy().workspaceOwnerCheckoutAllowed, false);
  const none = authorizeWorkspace([], "/work/trees/a");
  assert.ok(!none.ok && none.error.code === "POLICY_DENIED");
  assert.equal(authorizeWorkspace(["/work/trees"], "/work/trees/a").ok, true);
  assert.equal(authorizeWorkspace(["/elsewhere", "/work/trees"], "/work/trees/a/b").ok, true);
  assert.equal(authorizeWorkspace(["/work/trees"], "/work/trees").ok, true);
  const sibling = authorizeWorkspace(["/work/trees"], "/work/trees-other/a");
  assert.ok(!sibling.ok && sibling.error.code === "POLICY_DENIED");
  const parent = authorizeWorkspace(["/work/trees"], "/work");
  assert.ok(!parent.ok && parent.error.code === "POLICY_DENIED");
  assert.equal(pathWithin("/a/b", "/"), true);
  assert.equal(pathWithin("/a/bc", "/a/b"), false);
});
