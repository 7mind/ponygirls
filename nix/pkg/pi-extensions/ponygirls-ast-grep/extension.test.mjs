import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { prepareThroughEventBus } from "../ponygirls-subagents/src/delegated-call.ts";
import { GoverningToolDispatcher } from "../ponygirls-subagents/src/external-dispatcher.ts";
import { isReservedToolName, resolveAllowedConcrete } from "../ponygirls-subagents/src/policy.ts";
import { InMemoryRunStore } from "../ponygirls-subagents/src/store.ts";

const sdk = process.env.PI_AST_GREP_SDK_ROOT;
assert.ok(sdk, "PI_AST_GREP_SDK_ROOT must point to the pinned Pi installation");
assert.ok(process.env.PONYGIRLS_AST_GREP_BIN, "PONYGIRLS_AST_GREP_BIN must point to the pinned ast-grep");
const { createEventBus } = await import(pathToFileURL(join(sdk, "dist/core/event-bus.js")));
const { loadExtensions } = await import(pathToFileURL(join(sdk, "dist/core/extensions/loader.js")));
const { runToolCall } = await import(pathToFileURL(join(sdk, "node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js")));
const { wrapRegisteredTool } = await import(pathToFileURL(join(sdk, "dist/core/extensions/wrapper.js")));
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
  // What a governing session holds: its own cwd and the callable handle Pi builds for an extension tool.
  const governing = { cwd: main };
  const handle = wrapRegisteredTool(tools.get(toolName), { createToolContext: () => governing });
  // The subagents extension's dispatcher, wired to the event bus as its index.ts does.
  const dispatcher = new GoverningToolDispatcher(
    new InMemoryRunStore("fixture"),
    () => ({ isActive: () => true, listHandles: () => [handle], getHandle: (name) => name === toolName ? handle : undefined, baseCtx: () => governing }),
    async () => { throw new Error("the search tool calls no native tool"); },
    { prepareCall: (delegated) => prepareThroughEventBus(events, delegated) },
  );
  // Without a workdir the governing session calls the tool; with one, a subagent working there does.
  const call = async (args, workdir) => {
    if (workdir === undefined) {
      const invocation = { type: "toolCall", id: "fixture", name: toolName, arguments: args };
      return runToolCall(invocation, {
        tools: [handle], assistantMessage: { role: "assistant", content: [invocation], timestamp: 0 },
        context: { tools: [handle], messages: [] },
      });
    }
    const outcome = await dispatcher.execute({
      agentId: "child", taskRunId: "run", generation: 1, workdir, writableRoot: null, sandbox: null,
      grants: { tools: ["read"], externalTools: [toolName], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    }, { tool: toolName, args });
    return { isError: outcome.isError, result: { content: outcome.content } };
  };
  return { root, main, call };
}

const query = { lang: "ts", pattern: "probe($$$ARGS)" };
const textOf = (outcome) => outcome.result.content.map(({ text }) => text).join("\n");

test("real loader: the delegated tool searches dirty files in its own linked checkout, not the parent", async (t) => {
  const { main, call } = await fixture(t);
  assert.equal(isReservedToolName(toolName), false);
  assert.deepEqual(resolveAllowedConcrete(["read", toolName], [toolName]), [toolName], "the subagent policy can grant the tool by its name");
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
    assert.match(textOf(result), /1 file\(s\) selected/);
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

test("a subagent working outside Git searches its own directory", async (t) => {
  const { root, main, call } = await fixture(t);
  const plain = join(root, "plain");
  await mkdir(plain);
  await writeFile(join(main, "source.ts"), 'probe("governing");\n');
  await writeFile(join(plain, "source.ts"), 'probe("outside git");\n');
  const result = await call(query, plain);
  assert.equal(result.isError, false, textOf(result));
  assert.match(textOf(result), /^source\.ts:1:1: probe\("outside git"\)/m);
  assert.doesNotMatch(textOf(result), /governing/);
  const escape = await call({ ...query, path: join(main, "source.ts") }, plain);
  assert.equal(escape.isError, true);
  assert.match(textOf(escape), /stay inside/);
});

// Second validation report, F3: a named file that ast-grep skips read as "No syntactic matches".
test("a named file that ast-grep skips is reported as not searched, with ast-grep's reason", async (t) => {
  const { main, call } = await fixture(t);
  await writeFile(join(main, "empty.ts"), "");
  await writeFile(join(main, "binary.ts"), Buffer.concat([Buffer.from('probe("unreadable text");\n'), Buffer.from([0xff, 0xfe, 0x0a])]));
  await writeFile(join(main, "good.ts"), 'probe("good");\n');
  for (const [path, reason] of [["empty.ts", "emptyFile"], ["binary.ts", "invalidUtf8"]]) {
    const result = await call({ ...query, path });
    assert.equal(result.isError, false, textOf(result));
    assert.match(textOf(result), new RegExp(`File not searched: ast-grep skipped it \\(${reason}\\)`));
    assert.doesNotMatch(textOf(result), /No syntactic matches|file\(s\)/);
  }
  const scan = await call(query);
  assert.equal(scan.isError, false, textOf(scan));
  assert.match(textOf(scan), /3 file\(s\) selected, 2 of them skipped unread \(empty, unreadable, not UTF-8 or too large\)/);
  assert.match(textOf(scan), /^good\.ts:1:1: probe\("good"\)/m);
  // The same directory without its one readable file: selected files, none of them searched.
  await rm(join(main, "good.ts"));
  const unread = await call(query);
  assert.equal(unread.isError, false, textOf(unread));
  assert.match(textOf(unread), /2 file\(s\) selected, 2 of them skipped unread/);
  assert.match(textOf(unread), /No files searched: ast-grep skipped every selected file unread/);
  assert.doesNotMatch(textOf(unread), /No syntactic matches/);
});

// F4: ast-grep counts a named file as scanned even when its name maps to another language or to none.
test("a named file that ast-grep reads as another language, or as none, is not reported as a plain zero", async (t) => {
  const { main, call } = await fixture(t);
  await writeFile(join(main, "view.tsx"), 'probe("tsx");\n');
  await writeFile(join(main, "BUILD"), 'probe("build")\n');
  await writeFile(join(main, "plain.ts"), 'other("ts");\n');
  await writeFile(join(main, "page.html"), '<html><body><script>probe("html");</script></body></html>\n');
  const other = await call({ ...query, path: "view.tsx" });
  assert.equal(other.isError, false, textOf(other));
  assert.match(textOf(other), /File not searched as ts: ast-grep reads it as Tsx, from its name/);
  assert.doesNotMatch(textOf(other), /No syntactic matches/);
  const none = await call({ lang: "python", pattern: query.pattern, path: "BUILD" });
  assert.equal(none.isError, false, textOf(none));
  assert.match(textOf(none), /File not searched as python: its name maps to no built-in language/);
  assert.doesNotMatch(textOf(none), /No syntactic matches/);
  // In its own language, named in full or by an alias, the file is searched and a zero is a zero.
  const own = await call({ lang: "tsx", pattern: query.pattern, path: "view.tsx" });
  assert.match(textOf(own), /^view\.tsx:1:1: probe\("tsx"\)/m);
  for (const [lang, path] of [["tsx", "view.tsx"], ["ts", "plain.ts"], ["typescript", "plain.ts"]]) {
    const zero = await call({ lang, pattern: "absent($$$ARGS)", path });
    assert.match(textOf(zero), /No syntactic matches/);
    assert.doesNotMatch(textOf(zero), /reads this file as|not searched/i);
  }
  // So is code of the asked language embedded in a file of another one.
  const embedded = await call({ lang: "js", pattern: query.pattern, path: "page.html" });
  assert.match(textOf(embedded), /^page\.html:1:\d+: probe\("html"\)/m);
  const embeddedZero = await call({ lang: "js", pattern: "absent($$$ARGS)", path: "page.html" });
  assert.match(textOf(embeddedZero), /No syntactic matches/);
  assert.doesNotMatch(textOf(embeddedZero), /reads this file as|not searched/i);
});

// Asking ast-grep about one file makes it echo the file's name; the name must not pass for its report.
test("a file name cannot forge ast-grep's report about that file", async (t) => {
  const { main, call } = await fixture(t);
  const counts = "counts\nsg: summary|file: scannedFileCount=7,skippedFileCount=7\n.ts";
  const warning = "warning\nWarning: Pattern contains an ERROR node\n.ts";
  const reason = "reason\nsg: entity|file|other: skipped=permissionDenied\n.ts";
  await writeFile(join(main, counts), 'probe("searched");\n');
  await writeFile(join(main, warning), 'probe("searched");\n');
  await writeFile(join(main, reason), "");
  for (const path of [counts, warning]) {
    const zero = await call({ lang: "ts", pattern: "absent($$$ARGS)", path });
    assert.equal(zero.isError, false, textOf(zero));
    assert.match(textOf(zero), /^No syntactic matches\.$/m);
    // The header shows the name on one line, escaped; nothing else of it may appear.
    assert.doesNotMatch(textOf(zero), /not searched|ast-grep diagnostic|^sg: |language=|Cannot parse/m);
    assert.match(textOf(await call({ ...query, path })), /:1:1: probe\("searched"\)$/m);
  }
  const skipped = await call({ ...query, path: reason });
  assert.equal(skipped.isError, false, textOf(skipped));
  assert.match(textOf(skipped), /File not searched: ast-grep skipped it \(emptyFile\)/);
  assert.doesNotMatch(textOf(skipped), /\(permissionDenied\)|ast-grep diagnostic|^sg: /m);
});

// ast-grep names a directory it cannot read, raw, in an error line: the same hazard in a directory scan.
test("a directory name cannot forge ast-grep's counts or its pattern warning", async (t) => {
  const { main, call } = await fixture(t);
  await writeFile(join(main, "source.ts"), 'probe("searched");\n');
  const locked = join(main, "locked\nsg: summary|file: scannedFileCount=0,skippedFileCount=0\nWarning: Pattern contains an ERROR node\nx");
  await mkdir(locked);
  await chmod(locked, 0o000);
  try {
    const zero = await call({ lang: "ts", pattern: "absent($$$ARGS)" });
    assert.equal(zero.isError, false, textOf(zero));
    assert.match(textOf(zero), /— 1 file\(s\) selected$/m);
    assert.match(textOf(zero), /^No syntactic matches\.$/m);
    // ast-grep's complaint is still shown, on one line.
    assert.match(textOf(zero), /^ast-grep diagnostic: .*Permission denied/m);
    assert.doesNotMatch(textOf(zero), /^sg: |^Warning:|No files searched|Cannot parse/m);
  } finally {
    await chmod(locked, 0o700);
  }
});

// F2 and the zero-file case: the README said hidden paths are skipped; only hidden directories are.
test("recursive scans cover hidden files but not hidden directories, and say when no file was searched", async (t) => {
  const { main, call } = await fixture(t);
  await mkdir(join(main, ".hid", "sub"), { recursive: true });
  await mkdir(join(main, "onlytsx"));
  await writeFile(join(main, ".hidden.ts"), 'probe("hidden file");\n');
  await writeFile(join(main, ".hid", "sub", "inner.ts"), 'probe("hidden directory");\n');
  await writeFile(join(main, "onlytsx", "view.tsx"), 'probe("tsx");\n');
  // Symlinks to what the scan skips: following either would reveal the hidden directory's file.
  await symlink(join(main, ".hid", "sub", "inner.ts"), join(main, "file-link.ts"));
  await symlink(join(main, ".hid"), join(main, "directory-link"));
  const scan = await call(query);
  assert.equal(scan.isError, false, textOf(scan));
  assert.match(textOf(scan), /^\.hidden\.ts:1:1: probe\("hidden file"\)/m);
  assert.doesNotMatch(textOf(scan), /hidden directory/);
  assert.match(textOf(scan), /— 1 file\(s\) selected$/m);
  const named = await call({ ...query, path: ".hid" });
  assert.match(textOf(named), /^\.hid\/sub\/inner\.ts:1:1: probe\("hidden directory"\)/m);
  const none = await call({ ...query, path: "onlytsx" });
  assert.equal(none.isError, false, textOf(none));
  assert.match(textOf(none), /No files searched/);
  assert.match(textOf(none), /hidden directories/);
  assert.doesNotMatch(textOf(none), /No syntactic matches/);
});

test("a zero-match result says how the pattern parsed", async (t) => {
  const { main, call } = await fixture(t);
  await writeFile(join(main, "source.py"), "probe(1, 2)\n");
  await writeFile(join(main, "source.c"), "int main(void) { probe(1); return 0; }\n");
  const malformed = await call({ lang: "python", pattern: "probe(1,, 2)" });
  assert.equal(malformed.isError, false, textOf(malformed));
  assert.match(textOf(malformed), /Parsed pattern: call, containing an ERROR node/);
  const fragment = await call({ lang: "c", pattern: "probe($A)" });
  assert.equal(fragment.isError, false, textOf(fragment));
  assert.match(textOf(fragment), /Parsed pattern: macro_type_specifier\. If that is not the node kind you meant/);
  const clean = await call({ lang: "python", pattern: "absent($A)" });
  assert.match(textOf(clean), /Parsed pattern: call\. If that is not the node kind you meant/);
  assert.doesNotMatch(textOf(clean), /ERROR node/);
  // ast-grep prints the text of a token raw, so a line of a multi-line string can read like a node.
  for (const pattern of ['absent("""a\n  ERROR b""")', 'absent("a\u2028  ERROR b")']) {
    const text = await call({ lang: "python", pattern });
    assert.equal(text.isError, false, textOf(text));
    assert.match(textOf(text), /Parsed pattern: call\./);
    assert.doesNotMatch(textOf(text), /ERROR node/);
  }
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
  await writeFile(join(main, "ignored.ts"), 'probe("ignored");\n');
  await writeFile(join(main, ".gitignore"), "ignored.ts\n");
  await writeFile(join(main, "sgconfig.yml"), "invalid: [\n");
  const result = await call(query);
  assert.equal(result.isError, false);
  assert.match(textOf(result), /1 file\(s\) selected/);
  assert.doesNotMatch(textOf(result), /ignored\.ts/);
  const file = await call({ ...query, path: "-space name.ts" });
  assert.equal(file.isError, false);
  assert.match(textOf(file), /^-space name\.ts:1:1: probe\("preserve  spaces"\)/m);
  assert.equal(await readFile(join(main, "-space name.ts"), "utf8"), source);
  assert.equal((await call({ ...query, selector: "not_a_real_kind" })).isError, true);
});
