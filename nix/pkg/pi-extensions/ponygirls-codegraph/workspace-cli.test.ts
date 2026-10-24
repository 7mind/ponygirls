import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localCatalog } from "./projects.ts";
import { localBoundary } from "./runtime.ts";
import { CodegraphWorkspace } from "./workspace.ts";

test("CLI: concurrent explicit workspace creation, overlapping child scopes and data-directory exclusions", {
  skip: !process.env.PONYGIRLS_CODEGRAPH_BIN ? "set PONYGIRLS_CODEGRAPH_BIN for actual workspace CLI checks" : false,
}, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-codegraph-global-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CODEGRAPH_NO_WATCH: "1", CODEGRAPH_TELEMETRY: "0" };
  const children = [join(root, "a"), join(root, "b")];
  for (const [index, child] of children.entries()) {
    await mkdir(child);
    execFileSync("git", ["-C", child, "init", "--quiet"]);
    await writeFile(join(child, "example.ts"), `export function child${index}() { return ${index}; }\n`);
  }
  await writeFile(join(children[0]!, ".git", "ignored.ts"), "export const shouldNeverIndexGit = true;\n");
  await mkdir(join(children[1]!, ".codegraph"));
  await writeFile(join(children[1]!, ".codegraph", "ignored.ts"), "export const shouldNeverIndexDatabase = true;\n");
  const catalog = localCatalog(env);
  const boundary = localBoundary(process.env.PONYGIRLS_CODEGRAPH_BIN!, process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", env);
  const make = () => new CodegraphWorkspace(catalog, boundary, root, () => {}, () => "checked");
  const first = make();
  const second = make();
  t.after(async () => { await first.shutdown(); await second.shutdown(); });
  await first.start(true);
  await second.start(true);
  await assert.rejects(readFile(join(root, ".pi", "codegraph-workspace.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, ".codegraph", "codegraph.db")), { code: "ENOENT" });
  await Promise.all([first.initWorkspace(root), second.initWorkspace(root)]);
  assert.equal(await first.query(undefined), root);
  assert.equal(await second.query(root), root);
  const database = new DatabaseSync(join(root, ".codegraph", "codegraph.db"), { readOnly: true });
  try {
    const files = database.prepare("SELECT path FROM files ORDER BY path").all().map((row) => row.path);
    assert.ok(files.includes("a/example.ts"), JSON.stringify(files));
    assert.ok(files.includes("b/example.ts"), JSON.stringify(files));
    assert.equal(files.some((path) => String(path).split("/").some((part) => part === ".git" || part === ".codegraph")), false);
  } finally { database.close(); }
  assert.equal(await first.query(children[0]), children[0], "explicit child project must use its own index, not the global ancestor");
  assert.equal(await first.query(undefined), root, "explicit cross-project queries must not change the selected default");
  const size = await catalog.size(root);
  assert.ok(size.databaseBytes > 0);
  assert.ok(size.totalBytes >= size.databaseBytes);
  assert.equal(size.partial, false);
  const report = await first.report(null);
  assert.match(report, /workspace/);
  assert.match(report, /checkout/);
  await assert.rejects(first.erase(root), /Online erasure is unsupported/);
  assert.ok((await readFile(join(root, ".codegraph", "codegraph.db"))).length > 0);
});

test("CLI: linked worktrees share repository identity, never dirty-source indexes", {
  skip: !process.env.PONYGIRLS_CODEGRAPH_BIN ? "set PONYGIRLS_CODEGRAPH_BIN for actual worktree CLI checks" : false,
}, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-codegraph-worktrees-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const linked = join(root, "linked");
  await mkdir(main);
  const git = (...args: string[]) => execFileSync("git", ["-C", main, ...args], { stdio: "pipe" });
  git("init", "--quiet");
  await writeFile(join(main, "example.ts"), "export function checkoutValue() { return 'main-only-value'; }\n");
  git("add", "example.ts");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
  git("worktree", "add", "--quiet", "--detach", linked);
  await writeFile(join(linked, "example.ts"), "export function checkoutValue() { return 'linked-only-value'; }\n");
  const binary = process.env.PONYGIRLS_CODEGRAPH_BIN!;
  const env = { ...process.env, CODEGRAPH_NO_WATCH: "1", CODEGRAPH_TELEMETRY: "0" };
  const catalog = localCatalog(env);
  const workspace = new CodegraphWorkspace(catalog, localBoundary(binary, process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", env), root, () => {}, () => "checked");
  t.after(() => workspace.shutdown());
  await workspace.start(true);
  const projects = await catalog.discover(root, new AbortController().signal);
  assert.equal(projects.length, 2);
  assert.equal(projects[0]!.commonDir, projects[1]!.commonDir);
  for (const [path, own, other] of [[main, "main-only-value", "linked-only-value"], [linked, "linked-only-value", "main-only-value"]]) {
    assert.equal(await workspace.query(path), path);
    const source = execFileSync(binary, ["explore", "--path", path!, "--max-files", "2", "checkoutValue"], { env, encoding: "utf8" });
    assert.match(source, new RegExp(own!));
    assert.doesNotMatch(source, new RegExp(other!));
  }
});
