import assert from "node:assert/strict";
import test from "node:test";
import { CG_HELP, completeCommand, parseCommand } from "./commands.ts";

test("subcommand completions show syntax, filter prefixes and insert executable names", () => {
  const items = completeCommand("")!;
  assert.equal(items.length, 9);
  for (const item of items) {
    assert.match(CG_HELP, new RegExp(`/cg ${item.value.trim()}(?: | —)`));
    assert.ok(item.description.length > 0);
    assert.doesNotThrow(() => parseCommand(item.value + (item.value === "init " ? "--workspace ./project" :
      ["use ", "erase "].includes(item.value) ? "./project" : "")));
  }
  assert.deepEqual(completeCommand("sy"), [items.find((item) => item.value === "sync ")]);
  assert.deepEqual(completeCommand("  sy"), completeCommand("sy"));
  assert.equal(completeCommand("unknown"), null);
  assert.equal(completeCommand("use ./project"), null);
  assert.equal(completeCommand("help "), null);
});

test("flag completions preserve the subcommand and never suggest invalid options", () => {
  for (const name of ["status", "sync", "cancel"]) {
    for (const prefix of ["", "--", "--a", "--all"]) {
      const items = completeCommand(`${name} ${prefix}`)!;
      assert.equal(items.length, 1);
      assert.equal(items[0]!.value, `${name} --all`);
      assert.doesNotThrow(() => parseCommand(items[0]!.value));
    }
  }
  assert.equal(completeCommand("init ")![0]!.value, "init --workspace ");
  assert.equal(completeCommand("init --w")![0]!.label, "--workspace PATH");
  for (const prefix of ["reindex --", "use --", "erase --", "discover --", "sync ./path", "sync -- ./path",
    "sync --unknown", "init --workspace ", "init --workspace ./path"]) {
    assert.equal(completeCommand(prefix), null, prefix);
  }
});

test("all path-taking commands preserve bare and dot-relative paths for cwd resolution", () => {
  for (const path of ["example-app", "./example-app", "../example-app", ".", "/absolute/example-app"]) {
    for (const name of ["status", "sync", "reindex", "cancel"] as const) {
      assert.deepEqual(parseCommand(`${name} ${path}`), { name, target: path, all: false });
    }
    for (const name of ["discover", "use", "erase"] as const) {
      assert.deepEqual(parseCommand(`${name} ${path}`), { name, target: path });
    }
    assert.deepEqual(parseCommand(`init --workspace ${path}`), { name: "init", target: path });
  }
});

test("command grammar keeps target paths separate from flags and requires explicit workspace consent", () => {
  assert.deepEqual(parseCommand(""), { name: "help" });
  assert.deepEqual(parseCommand("status"), { name: "status", target: null, all: false });
  assert.deepEqual(parseCommand("sync --all"), { name: "sync", target: null, all: true });
  assert.deepEqual(parseCommand('use "a path/b"'), { name: "use", target: "a path/b" });
  assert.deepEqual(parseCommand("sync a path/b"), { name: "sync", target: "a path/b", all: false });
  assert.deepEqual(parseCommand("sync -- --all"), { name: "sync", target: "--all", all: false });
  assert.deepEqual(parseCommand("init --workspace '/a path'"), { name: "init", target: "/a path" });
  for (const input of ["init", "init /workspace", "erase", "use", "reindex --all", "sync --force", "unknown", 'use "unterminated']) {
    assert.throws(() => parseCommand(input), Error, input);
  }
});
