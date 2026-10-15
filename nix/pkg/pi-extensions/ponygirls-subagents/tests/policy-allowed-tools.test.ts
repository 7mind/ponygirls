import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeExternalTool,
  compileAllowedPattern,
  defaultSupervisorPolicy,
  intersectGrants,
  isReservedToolName,
  matchesAllowedTool,
  resolveAllowedConcrete,
  rootGrants,
  validateAllowedTools,
} from "../src/policy.ts";

test("default runtime policy allows no external tools", () => {
  assert.deepEqual(defaultSupervisorPolicy().allowedTools, []);
  assert.deepEqual(resolveAllowedConcrete(["mcp__codegraph__codegraph_explore"], []), []);
});

test("malformed allowlists fail visibly, never silently discarded", () => {
  assert.throws(() => validateAllowedTools("mcp__*" as unknown as string[]), /INVALID/);
  assert.throws(() => validateAllowedTools([123] as unknown as string[]), /INVALID/);
  assert.throws(() => validateAllowedTools([""]), /INVALID/);
  assert.deepEqual(validateAllowedTools(["mcp__codegraph__codegraph_explore", "mcp__*"]), ["mcp__codegraph__codegraph_explore", "mcp__*"]);
});

test("full-name '*' glob with escaped punctuation, no implicit rewriting or +/- grammar", () => {
  assert.ok(matchesAllowedTool("mcp__codegraph__codegraph_explore", ["mcp__codegraph__codegraph_explore"]));
  assert.ok(!matchesAllowedTool("mcp__codegraph__codegraph_explore2", ["mcp__codegraph__codegraph_explore"]));
  assert.ok(matchesAllowedTool("mcp__codegraph__codegraph_explore", ["mcp__*"]));
  assert.ok(matchesAllowedTool("mcp__codegraph__codegraph_explore", ["*explore"]));
  assert.ok(matchesAllowedTool("mcp__codegraph__codegraph_explore", ["*"]));
  // Regex punctuation escaped: dot matches literal dot only
  assert.ok(matchesAllowedTool("mcp__a__foo.bar", ["mcp__a__foo.bar"]));
  assert.ok(!matchesAllowedTool("mcp__a__fooxbar", ["mcp__a__foo.bar"]));
  // Plus/minus are literal, not grammar
  assert.ok(matchesAllowedTool("+mcp__x", ["+mcp__x"]));
  assert.ok(!matchesAllowedTool("mcp__x", ["+mcp__x"]));
  assert.ok(matchesAllowedTool("-mcp__x", ["-mcp__x"]));
  // compile escapes: (a+b) literal
  assert.ok(compileAllowedPattern("a+b").test("a+b"));
  assert.ok(!compileAllowedPattern("a+b").test("aab"));
});

test("reserved built-in/control names never resolve, even via wildcard", () => {
  for (const name of ["read", "bash", "powershell", "send_message", "spawn_agent", "submit_gate_decision", "manage_gate"]) {
    assert.ok(isReservedToolName(name), name);
  }
  const available = ["read", "powershell", "mcp__codegraph__codegraph_explore", "send_message", "spawn_agent", "mcp__evil__tool"];
  assert.deepEqual(resolveAllowedConcrete(available, ["*"]), ["mcp__codegraph__codegraph_explore", "mcp__evil__tool"]);
  assert.deepEqual(resolveAllowedConcrete(available, ["read", "mcp__codegraph__*"]), ["mcp__codegraph__codegraph_explore"]);
});

test("reader and writer both receive explicitly approved external (not magically read-only)", () => {
  const p = defaultSupervisorPolicy();
  p.allowedTools = ["mcp__codegraph__codegraph_explore"];
  const concrete = ["mcp__codegraph__codegraph_explore"];
  const reader = intersectGrants(p, rootGrants(p, concrete), { profile: "reader", isolation: "worktree", repoId: null, shell: false, network: false, model: null, depth: 1 }, concrete);
  const writer = intersectGrants(p, rootGrants(p, concrete), { profile: "writer", isolation: "worktree", repoId: null, shell: true, network: false, model: null, depth: 1 }, concrete);
  assert.ok(reader.ok && writer.ok);
  if (!reader.ok || !writer.ok) return;
  assert.deepEqual(reader.grants.externalTools, ["mcp__codegraph__codegraph_explore"]);
  assert.deepEqual(writer.grants.externalTools, ["mcp__codegraph__codegraph_explore"]);
  assert.ok(authorizeExternalTool(reader.grants, "mcp__codegraph__codegraph_explore").ok);
});

test("sandbox never gains parent external; nested edges cannot widen", () => {
  const p = defaultSupervisorPolicy();
  p.maxDepth = 2;
  p.nesting = true;
  const concrete = ["mcp__a__one", "mcp__a__two"];
  const top = intersectGrants(p, rootGrants(p, concrete), { profile: "writer", isolation: "worktree", repoId: null, shell: true, network: false, model: null, depth: 1 }, concrete);
  assert.ok(top.ok);
  if (!top.ok) return;
  assert.deepEqual(top.grants.externalTools, concrete);
  // Sandbox child: empty even with same root concrete
  const sand = intersectGrants(p, top.grants, { profile: "reader", isolation: "sandbox", repoId: null, shell: false, network: false, model: null, depth: 2 }, concrete);
  assert.ok(sand.ok);
  if (!sand.ok) return;
  assert.deepEqual(sand.grants.externalTools, []);
  // Nested host child cannot widen beyond owner (owner trimmed to one)
  const trimmed = { ...top.grants, externalTools: ["mcp__a__one"] };
  const grand = intersectGrants(p, trimmed, { profile: "reader", isolation: "worktree", repoId: null, shell: false, network: false, model: null, depth: 2 }, concrete);
  assert.ok(grand.ok);
  if (!grand.ok) return;
  assert.deepEqual(grand.grants.externalTools, ["mcp__a__one"]);
  // Runtime shrink: root concrete drops a tool, child loses it
  const shrunk = intersectGrants(p, trimmed, { profile: "reader", isolation: "worktree", repoId: null, shell: false, network: false, model: null, depth: 2 }, ["mcp__a__two"]);
  assert.ok(shrunk.ok);
  if (!shrunk.ok) return;
  assert.deepEqual(shrunk.grants.externalTools, []);
});

test("authorizeExternal denies reserved and ungranted, allows granted", () => {
  const grants = { tools: ["read"], externalTools: ["mcp__a__one"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" as const };
  assert.ok(authorizeExternalTool(grants, "mcp__a__one").ok);
  assert.equal(authorizeExternalTool(grants, "mcp__a__two").ok, false);
  assert.equal(authorizeExternalTool(grants, "read").ok, false);
  assert.equal(authorizeExternalTool(grants, "spawn_agent").ok, false);
});

test("powershell (pinned builtin) denied at resolution even via wildcard or explicit name", async () => {
  const mod = await import("../src/policy.ts");
  assert.deepEqual(mod.resolveAllowedConcrete(["powershell", "mcp__a__x"], ["*"]), ["mcp__a__x"]);
  assert.deepEqual(mod.resolveAllowedConcrete(["powershell"], ["powershell"]), []);
  assert.equal(mod.authorizeExternalTool({ tools: [], externalTools: ["mcp__a__x"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, "powershell").ok, false);
});
