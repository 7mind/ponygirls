import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { directoryIdentity } from "../../context-rules/rules.ts";
import { loadProjectContextFiles, PROJECT_CONTEXT_FILE_NAMES } from "@earendil-works/pi-coding-agent";

const reader = fileURLToPath(new URL("../../context-rules/instruction-reader.cjs", import.meta.url));
test("nested winners match Pi; outside links and oversized files do not become instructions", t => {
  const root = mkdtempSync(join(tmpdir(), "nested-reader-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = join(root, "project"), agentDir = join(root, "agent");
  mkdirSync(workdir); mkdirSync(agentDir);
  const read = (access: string) => JSON.parse(execFileSync(process.execPath, [reader], { cwd: workdir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: JSON.stringify({ workdir, access: directoryIdentity(access), names: [], known: [], root: null, ruleNames: PROJECT_CONTEXT_FILE_NAMES, limit: 128 * 1024 }) }));
  let dir = workdir;
  for (const [i, winner] of PROJECT_CONTEXT_FILE_NAMES.entries()) {
    dir = join(dir, String(i)); mkdirSync(dir);
    for (const name of PROJECT_CONTEXT_FILE_NAMES.slice(i)) writeFileSync(join(dir, name), `\uFEFF${name}`);
    for (const name of PROJECT_CONTEXT_FILE_NAMES.slice(0, i)) mkdirSync(join(dir, name));
    const sdk = loadProjectContextFiles({ cwd: dir, agentDir }).filter(f => f.path.startsWith(workdir + "/"));
    assert.equal(sdk.at(-1)?.content, winner); assert.deepEqual(read(dir), sdk);
  }
  const empty = join(dir, "empty"); mkdirSync(empty);
  const outside = join(root, "outside"); writeFileSync(outside, "private"); symlinkSync(outside, join(empty, "AGENTS.md"));
  assert.deepEqual(read(empty), read(dir)); assert.deepEqual(read(agentDir), []);
  writeFileSync(join(empty, "AGENTS.override.md"), Buffer.alloc(128 * 1024 + 1));
  assert.throws(() => read(empty), /exceed limit/);
});
