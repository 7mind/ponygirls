import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { prepareThroughEventBus } from "../ponygirls-subagents/src/delegated-call.ts";

const sdk = process.env.PI_AST_GREP_SDK_ROOT;
assert.ok(sdk, "PI_AST_GREP_SDK_ROOT must point to the pinned Pi installation");
assert.ok(process.env.PONYGIRLS_AST_GREP_BIN, "PONYGIRLS_AST_GREP_BIN must point to the pinned ast-grep");
const { createEventBus } = await import(pathToFileURL(join(sdk, "dist/core/event-bus.js")));
const { loadExtensions } = await import(pathToFileURL(join(sdk, "dist/core/extensions/loader.js")));
const { runToolCall } = await import(pathToFileURL(join(sdk, "node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js")));
const entry = process.env.PI_AST_GREP_EXTENSION ?? join(import.meta.dirname, "index.ts");
const toolName = "ast_grep_search";
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-ast-grep-loader-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "checkout");
  await mkdir(main);
  git(main, "init", "-q");
  git(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
  const events = createEventBus();
  const loaded = await loadExtensions([entry], main, events);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const { tools } = loaded.extensions[0];
  assert.deepEqual([...tools.keys()], [toolName]);
  const definition = tools.get(toolName).definition;
  assert.equal(definition.annotations.readOnlyHint, true);
  const call = (args, workdir) => {
    const tool = { ...definition, async execute(id, params, signal, onUpdate) {
      const prepared = workdir === undefined ? params : await prepareThroughEventBus(events, { tool: toolName, args: params, workdir });
      assert.ok(prepared);
      return definition.execute(id, prepared, signal, onUpdate, { cwd: main });
    } };
    const invocation = { type: "toolCall", id: "fixture", name: toolName, arguments: args };
    return runToolCall(invocation, {
      tools: [tool], assistantMessage: { role: "assistant", content: [invocation], timestamp: 0 },
      context: { tools: [tool], messages: [] },
    });
  };
  return { root, main, call };
}

const query = { lang: "ts", pattern: "probe($$$ARGS)" };
const textOf = (outcome) => outcome.result.content.map(({ text }) => text).join("\n");

test("real loader: the delegated tool searches dirty files in its own linked checkout, not the parent", async (t) => {
  const { main, call } = await fixture(t);
  const worktrees = join(main, ".worktrees");
  await mkdir(worktrees);
  const child = join(worktrees, "child");
  git(main, "worktree", "add", "--quiet", "--detach", child);
  await writeFile(join(main, "source.ts"), 'probe("governing");\n');
  await writeFile(join(child, "source.ts"), 'probe("delegated");\n');
  await symlink(join(main, "source.ts"), join(child, "other.ts"));

  const direct = await call(query);
  assert.equal(direct.isError, false);
  assert.match(textOf(direct), /source\.ts:1:1: probe\("governing"\)/);
  assert.doesNotMatch(textOf(direct), /probe\("delegated"\)/);
  for (const params of [query, { ...query, path: "source.ts" }]) {
    const delegated = await call(params, child);
    assert.equal(delegated.isError, false);
    assert.match(textOf(delegated), /source\.ts:1:1: probe\("delegated"\)/);
    assert.doesNotMatch(textOf(delegated), /governing|other\.ts/);
  }
  for (const path of ["../..", join(main, "source.ts"), "other.ts"]) {
    const rejected = await call({ ...query, path }, child);
    assert.equal(rejected.isError, true);
    assert.match(textOf(rejected), /stay inside/);
  }
  assert.equal((await call({ ...query, path: ".worktrees/child" })).isError, true);
  assert.equal((await call({ ...query, scope: child })).isError, true, "a model cannot specify the delegated scope");
});

// Regression: linked worktrees need not be inside the conventional .worktrees directory.
test("real loader: an arbitrarily nested linked checkout is excluded from its parent's scan", async (t) => {
  const { main, call } = await fixture(t);
  await mkdir(join(main, "scratch"));
  const child = join(main, "scratch", "other [tree]");
  git(main, "worktree", "add", "--quiet", "--detach", child);
  await writeFile(join(main, "scratch", "mine.ts"), 'probe("parent");\n');
  await writeFile(join(child, "source.ts"), 'probe("other tree");\n');
  for (const args of [query, { ...query, path: "scratch" }]) {
    const result = await call(args);
    assert.equal(result.isError, false);
    assert.match(textOf(result), /mine\.ts:1:1: probe\("parent"\)/);
    assert.doesNotMatch(textOf(result), /source\.ts|other tree/);
    assert.match(textOf(result), /1 file\(s\) scanned/);
  }
  const subdir = await call(query, join(main, "scratch"));
  assert.equal(subdir.isError, false);
  assert.match(textOf(subdir), /^mine\.ts:1:1:/m);
  assert.doesNotMatch(textOf(subdir), /source\.ts|other tree/);
  const rejected = await call({ ...query, path: "scratch/other [tree]/source.ts" });
  assert.equal(rejected.isError, true);
  assert.match(textOf(rejected), /stay inside|separate.*worktree/);
  const delegated = await call(query, child);
  assert.equal(delegated.isError, false);
  assert.match(textOf(delegated), /source\.ts:1:1: probe\("other tree"\)/);
});

test("D1: a malformed Python pattern reports the parser warning, not an inconsistent scan", async (t) => {
  const { main, call } = await fixture(t);
  await writeFile(join(main, "source.py"), "foo(1)\n");
  const result = await call({ lang: "python", pattern: "foo(" });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /Cannot parse.*pattern.*Pattern contains an ERROR node/is);
});

test("D2a: the caller can search a linked worktree whose registered path became a symlink", async (t) => {
  const { root, main, call } = await fixture(t);
  const registered = join(root, "registered");
  const actual = join(root, "actual");
  await mkdir(registered);
  const child = join(registered, "child");
  git(main, "worktree", "add", "--quiet", "--detach", child);
  await rename(registered, actual);
  await symlink(actual, registered);
  await writeFile(join(child, "source.ts"), 'probe("linked");\n');
  const result = await call(query, child);
  assert.equal(result.isError, false, textOf(result));
  assert.match(textOf(result), /^source\.ts:1:1: probe\("linked"\)/m);
});

for (const explicit of [false, true]) {
  test(`D2b: a nested linked worktree with a symlinked registration stays out of ${explicit ? "explicit searches" : "recursive scans"}`, async (t) => {
    const { root, main, call } = await fixture(t);
    const child = join(main, "nested");
    git(main, "worktree", "add", "--quiet", "--detach", child);
    await rename(main, join(root, "moved"));
    await symlink(join(root, "moved"), main);
    await writeFile(join(main, "source.ts"), 'probe("parent");\n');
    await writeFile(join(child, "other.ts"), 'probe("nested");\n');
    const result = await call(explicit ? { ...query, path: "nested/other.ts" } : query);
    assert.equal(result.isError, explicit, textOf(result));
    if (explicit) assert.match(textOf(result), /separate linked worktree/);
    else {
      assert.match(textOf(result), /^source\.ts:1:1: probe\("parent"\)/m);
      assert.doesNotMatch(textOf(result), /other\.ts|probe\("nested"\)/);
    }
  });
}

for (const layout of ["separate Git directory", "submodule with an absorbed Git directory"]) {
  test(`D3: search works from a checkout with a ${layout}`, async (t) => {
    const { root, main, call } = await fixture(t);
    const caller = join(main, "target");
    if (layout === "separate Git directory") {
      git(main, "init", "--quiet", "--separate-git-dir", join(root, "metadata.git"), caller);
    } else {
      const source = join(root, "source");
      git(root, "init", "--quiet", source);
      git(source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture");
      git(main, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", source, "target");
    }
    await writeFile(join(caller, "source.ts"), 'probe("target");\n');
    const result = await call(query, caller);
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), /^source\.ts:1:1: probe\("target"\)/m);
  });
}

test("real loader: uses bundled config, default ignores and plain read-only path arguments", async (t) => {
  const { main, call } = await fixture(t);
  const source = 'probe("preserve  spaces");\n';
  await writeFile(join(main, "-space name.ts"), source);
  await writeFile(join(main, "hidden.ts"), 'probe("ignored");\n');
  await writeFile(join(main, ".gitignore"), "hidden.ts\n");
  await writeFile(join(main, "sgconfig.yml"), "invalid: [\n");
  const result = await call(query);
  assert.equal(result.isError, false);
  assert.match(textOf(result), /1 file\(s\) scanned/);
  assert.doesNotMatch(textOf(result), /hidden\.ts/);
  const file = await call({ ...query, path: "-space name.ts" });
  assert.equal(file.isError, false);
  assert.match(textOf(file), /^-space name\.ts:1:1: probe\("preserve  spaces"\)/m);
  assert.equal(await readFile(join(main, "-space name.ts"), "utf8"), source);
  assert.equal((await call({ ...query, selector: "not_a_real_kind" })).isError, true);
});
