// Behavioral-Active-Effectual-GoodCommunication: owned temporary files only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { preparePreviewState } from "../tests-browser/preview-state.mjs";
import { passwordMatches } from "../tests-browser/credentials.mjs";

async function owned(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-preview-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("preview state keeps its password hash, API seed and existing database across launches", async (t) => {
  const directory = path.join(await owned(t), "preview");
  const state = await preparePreviewState(directory, 47328);
  const before = await Promise.all([state.tokenFile, state.passwordFile, state.passwordHashFile].map(file => readFile(file, "utf8")));
  assert.ok(before[0] !== before[1], "API seed and password are independent");
  assert.ok(await passwordMatches(before[1].trimEnd(), before[2].trimEnd()));
  await mkdir(state.pgData);
  const sentinel = path.join(state.pgData, "retained-demo-data");
  await writeFile(sentinel, "keep");
  await preparePreviewState(directory, 47328);
  const after = await Promise.all([state.tokenFile, state.passwordFile, state.passwordHashFile].map(file => readFile(file, "utf8")));
  assert.ok(before.every((value, index) => value === after[index]), "relaunch must not replace credentials or invalidate sessions");
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  for (const file of [state.tokenFile, state.passwordFile, state.passwordHashFile, path.join(directory, "state.json")]) assert.equal((await lstat(file)).mode & 0o077, 0);
  for (const dir of [directory, state.pgData]) assert.equal((await lstat(dir)).mode & 0o077, 0);
});

test("preview upgrade preserves an existing API seed without reusing it as the password", async (t) => {
  const directory = await owned(t);
  const legacy = randomBytes(32).toString("base64url") + "\n";
  await writeFile(path.join(directory, "token.txt"), legacy, { mode: 0o644 });
  const state = await preparePreviewState(directory, 47328);
  assert.ok(await readFile(state.tokenFile, "utf8") === legacy, "legacy API seed is preserved");
  assert.ok(await readFile(state.passwordFile, "utf8") !== legacy, "browser login gets independent credentials");
  assert.equal((await lstat(state.tokenFile)).mode & 0o077, 0);
});

test("preview refuses a mismatched password hash without replacing retained credentials", async (t) => {
  const directory = await owned(t);
  const state = await preparePreviewState(directory, 47328);
  await writeFile(state.passwordHashFile, "invalid\n");
  const password = await readFile(state.passwordFile, "utf8");
  await assert.rejects(preparePreviewState(directory, 47328), /Saved preview password and hash differ/);
  assert.ok(await readFile(state.passwordFile, "utf8") === password);
  assert.equal(await readFile(state.passwordHashFile, "utf8"), "invalid\n");
});

test("preview refuses linked credential files without modifying their targets", async (t) => {
  const root = await owned(t);
  const target = path.join(root, "unrelated");
  await writeFile(target, "unrelated-data\n", { mode: 0o640 });
  for (const [name, makeLink] of [["symbolic", symlink], ["hard", link]]) {
    const directory = path.join(root, name);
    await mkdir(directory);
    await makeLink(target, path.join(directory, "token.txt"));
    await assert.rejects(preparePreviewState(directory, 47328));
    assert.equal(await readFile(target, "utf8"), "unrelated-data\n");
    assert.equal((await lstat(target)).mode & 0o777, 0o640);
  }
});

test("preview refuses an unrecognized existing database rather than adopting or deleting it", async (t) => {
  const directory = await owned(t);
  await mkdir(path.join(directory, "pg"));
  const sentinel = path.join(directory, "pg", "unrelated");
  await writeFile(sentinel, "preserve");
  await assert.rejects(preparePreviewState(directory, 47328), /Unrecognized existing preview database/);
  assert.equal(await readFile(sentinel, "utf8"), "preserve");
});

test("preview state identity cannot be reused for a different port", async (t) => {
  const directory = await owned(t);
  await preparePreviewState(directory, 47328);
  await assert.rejects(preparePreviewState(directory, 47329), /another version or port/);
  assert.equal(await readFile(path.join(directory, "state.json"), "utf8"), '{"version":1,"port":47328}\n');
});
