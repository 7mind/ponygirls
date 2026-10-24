import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "./commands.ts";

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
