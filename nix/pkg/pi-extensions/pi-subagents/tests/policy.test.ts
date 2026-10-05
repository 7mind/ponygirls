import assert from "node:assert/strict";
import test from "node:test";
import { authorizeTool, defaultSupervisorPolicy, intersectGrants, rootGrants } from "../src/policy.ts";

function policy() {
  const p = defaultSupervisorPolicy();
  p.maxDepth = 2;
  p.nesting = true;
  p.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  p.allowedModels = [{ provider: "p", id: "m" }];
  return p;
}

test("reader cannot hold shell; writer requires an approved repository", () => {
  const p = policy();
  const root = rootGrants(p);
  const reader = intersectGrants(p, root, { profile: "reader", repoId: null, shell: false, network: false, model: null, depth: 1 });
  assert.ok(reader.ok);
  const readerShell = intersectGrants(p, root, { profile: "reader", repoId: null, shell: true, network: false, model: null, depth: 1 });
  assert.equal(readerShell.ok, false);
  const writerNoRepo = intersectGrants(p, root, { profile: "writer", repoId: null, shell: true, network: false, model: null, depth: 1 });
  assert.equal(writerNoRepo.ok, false);
});

test("unknown repository identities are rejected before workspace binding", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "writer", repoId: "evil", shell: true, network: false, model: null, depth: 1 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "POLICY_DENIED");
});

test("nested writer cannot widen beyond owner grants (intersection at every edge)", () => {
  const p = policy();
  const root = rootGrants(p);
  const child = intersectGrants(p, root, { profile: "writer", repoId: "r1", shell: true, network: false, model: null, depth: 1 });
  assert.ok(child.ok);
  if (!child.ok) return;
  // Grandchild requesting a repo the child was never granted: denied.
  const p2 = { ...p, repos: [...p.repos, { repoId: "r2", checkoutPath: "/other", readRoots: ["/other"], allowWriters: true }] };
  const grandchild = intersectGrants(p2, child.grants, { profile: "reader", repoId: "r2", shell: false, network: false, model: null, depth: 2 });
  assert.equal(grandchild.ok, false);
  // Reader owner cannot delegate writer authority it lacks.
  const readerOwner = intersectGrants(p, root, { profile: "reader", repoId: "r1", shell: false, network: false, model: null, depth: 1 });
  assert.ok(readerOwner.ok);
  if (!readerOwner.ok) return;
  const escalated = intersectGrants(p, readerOwner.grants, { profile: "writer", repoId: "r1", shell: true, network: false, model: null, depth: 2 });
  assert.equal(escalated.ok, false);
});

test("depth beyond maxDepth is denied", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "reader", repoId: null, shell: false, network: false, model: null, depth: 3 });
  assert.equal(res.ok, false);
});

test("model outside the root allowlist is denied", () => {
  const p = policy();
  const res = intersectGrants(p, rootGrants(p), { profile: "reader", repoId: null, shell: false, network: false, model: { provider: "evil", id: "x" }, depth: 1 });
  assert.equal(res.ok, false);
});

test("tool authorization is post-transform and closed-world", () => {
  const p = policy();
  const root = rootGrants(p);
  const reader = intersectGrants(p, root, { profile: "reader", repoId: null, shell: false, network: false, model: null, depth: 1 });
  assert.ok(reader.ok);
  if (!reader.ok) return;
  assert.ok(authorizeTool(reader.grants, "read").ok);
  assert.equal(authorizeTool(reader.grants, "bash").ok, false);
  assert.equal(authorizeTool(reader.grants, "ctx.executeTool").ok, false);
  assert.equal(authorizeTool(reader.grants, "rm").ok, false);
});
