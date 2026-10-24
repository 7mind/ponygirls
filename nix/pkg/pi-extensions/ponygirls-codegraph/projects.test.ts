import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { localCatalog } from "./projects.ts";
import type { Catalog, IndexSize, Project } from "./projects.ts";

function signal(): AbortSignal { return new AbortController().signal; }
function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
async function temporary(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-codegraph-projects-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function checkout(root: string): Promise<Project> {
  await mkdir(root, { recursive: true });
  git(root, ["init", "--quiet"]);
  return { root, kind: "checkout", commonDir: await realpath(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) };
}
async function marker(root: string, text: string): Promise<void> {
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(root, ".pi", "codegraph-workspace.json"), text);
}
function environment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env.CODEGRAPH_DIR;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  return env;
}

interface Fixture {
  root: string;
  project: Project;
  catalog: Catalog;
}
async function localFixture(t: TestContext): Promise<Fixture> {
  const root = await temporary(t);
  const project = await checkout(join(root, "checkout"));
  const home = join(root, "home");
  await mkdir(home);
  return { root, project, catalog: localCatalog(environment(home)) };
}
class MemoryCatalog implements Catalog {
  private project: Project;
  private workspace: Project | null = null;
  constructor(project: Project) { this.project = project; }
  async resolve(path: string, abort: AbortSignal): Promise<Project | null> {
    abort.throwIfAborted();
    if (path === this.project.root || path.startsWith(`${this.project.root}/`)) return this.project;
    return this.workspace !== null && (path === this.workspace.root || path.startsWith(`${this.workspace.root}/`))
      ? this.workspace : null;
  }
  async discover(path: string, abort: AbortSignal): Promise<Project[]> {
    abort.throwIfAborted();
    const containing = await this.resolve(path, abort);
    if (containing !== null && containing.kind === "checkout") return [containing];
    const projects = containing === null ? [] : [containing];
    if (dirname(this.project.root) === path) projects.push(this.project);
    return projects;
  }
  async initWorkspace(path: string, abort: AbortSignal): Promise<Project> {
    abort.throwIfAborted();
    if (await this.resolve(path, abort) !== null) throw new Error("workspace must be outside Git");
    this.workspace = { root: path, kind: "workspace", commonDir: null };
    return this.workspace;
  }
  async size(): Promise<IndexSize> {
    return { databaseBytes: 0, totalBytes: 0, partial: false, detail: null };
  }
}
async function memoryFixture(_t: TestContext): Promise<Fixture> {
  const root = "/catalog";
  const project: Project = { root: join(root, "checkout"), kind: "checkout", commonDir: "/catalog/checkout/.git" };
  return { root, project, catalog: new MemoryCatalog(project) };
}

// Specified Behavioral-Active / Blackbox-Atomic (memory), Blackbox-GoodCommunication (local FS/Git).
for (const [name, fixture] of [["memory", memoryFixture], ["local", localFixture]] as const) {
  test(`${name}: containing checkout, bounded discovery, explicit workspace and absent-index sizes`, async (t) => {
    const f = await fixture(t);
    assert.deepEqual(await f.catalog.resolve(f.project.root, signal()), f.project);
    assert.deepEqual(await f.catalog.discover(f.project.root, signal()), [f.project]);
    assert.equal(await f.catalog.resolve(f.root, signal()), null);
    assert.deepEqual(await f.catalog.discover(f.root, signal()), [f.project]);
    assert.deepEqual(await f.catalog.size(f.project.root), { databaseBytes: 0, totalBytes: 0, partial: false, detail: null });
    const workspace = await f.catalog.initWorkspace(f.root, signal());
    assert.deepEqual(workspace, { root: f.root, kind: "workspace", commonDir: null });
    assert.deepEqual(await f.catalog.discover(f.root, signal()), [workspace, f.project]);
    assert.deepEqual(await f.catalog.resolve(f.project.root, signal()), f.project, "checkout wins over workspace scope");
    await assert.rejects(f.catalog.initWorkspace(f.project.root, signal()), /Git|checkout/);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(f.catalog.resolve(f.root, abort.signal), { name: "AbortError" });
    await assert.rejects(f.catalog.discover(f.root, abort.signal), { name: "AbortError" });
    await assert.rejects(f.catalog.initWorkspace(f.root, abort.signal), { name: "AbortError" });
  });
}

test("canonical paths, nested checkouts and linked worktrees keep per-tree roots and common-directory identity", async (t) => {
  const root = await temporary(t);
  const main = await checkout(join(root, "main"));
  await writeFile(join(main.root, "example.ts"), "export const main = 1;\n");
  git(main.root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "initial"]);
  const worktree = join(root, "linked");
  git(main.root, ["worktree", "add", "--quiet", "--detach", worktree]);
  const nested = await checkout(join(main.root, "nested"));
  await mkdir(join(nested.root, "src"));
  await writeFile(join(nested.root, "src", "file.ts"), "");
  const alias = join(root, "alias");
  await symlink(nested.root, alias);
  const catalog = localCatalog(environment(root));
  assert.deepEqual(await catalog.resolve(join(alias, "src", "..", "src", "file.ts"), signal()), nested);
  assert.deepEqual(await catalog.discover(main.root, signal()), [main], "inside Git discovery must not scan nested checkouts");
  assert.deepEqual(await catalog.resolve(worktree, signal()), { root: worktree, kind: "checkout", commonDir: main.commonDir });
  assert.deepEqual(await catalog.discover(root, signal()), [
    { root: worktree, kind: "checkout", commonDir: main.commonDir }, main,
  ], "immediate child roots are sorted and symlink aliases are excluded");
});

test("unmarked parent discovery is read-only, shallow, and does not use an ancestor index", async (t) => {
  const root = await temporary(t);
  const first = await checkout(join(root, "a"));
  const second = await checkout(join(root, "b"));
  const deeper = await checkout(join(root, "group", "deep"));
  await symlink(deeper.root, join(root, "alias"));
  await mkdir(join(root, ".codegraph"));
  await writeFile(join(root, ".codegraph", "codegraph.db"), "unregistered index");
  const before = await readdir(root);
  const catalog = localCatalog(environment(root));
  assert.equal(await catalog.resolve(root, signal()), null);
  assert.equal(await catalog.resolve(join(root, "group"), signal()), null);
  assert.deepEqual(await catalog.discover(root, signal()), [first, second]);
  assert.deepEqual(await catalog.resolve(deeper.root, signal()), deeper, "explicit deeper paths are supported");
  assert.deepEqual(await readdir(root), before);
  await assert.rejects(lstat(join(first.root, ".codegraph")), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, ".pi")), { code: "ENOENT" });
});

test("nearest valid workspace marker wins, and malformed metadata is not an unmarked fallback", async (t) => {
  const root = await temporary(t);
  const inner = join(root, "inner");
  await mkdir(join(inner, "nested"), { recursive: true });
  await marker(root, '{"version":1}\n');
  await marker(inner, '{"version":1}\n');
  const catalog = localCatalog(environment(root));
  assert.deepEqual(await catalog.resolve(join(inner, "nested"), signal()), { root: inner, kind: "workspace", commonDir: null });
  for (const text of ['{"version":2}', 'null', '[]', '{"version":"1"}', '{']) {
    await marker(inner, text);
    await assert.rejects(catalog.resolve(inner, signal()), /workspace|marker/i);
  }
});

test("workspace init atomically opts in without creating an index and preserves existing marker bytes", async (t) => {
  const root = await temporary(t);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const catalog = localCatalog(environment(root));
  const project: Project = { root: workspace, kind: "workspace", commonDir: null };
  assert.deepEqual(await Promise.all([catalog.initWorkspace(workspace, signal()), catalog.initWorkspace(workspace, signal())]), [project, project]);
  const markerPath = join(workspace, ".pi", "codegraph-workspace.json");
  assert.deepEqual(JSON.parse(await readFile(markerPath, "utf8")), { version: 1 });
  const text = '{ "version": 1, "note": "preserve" }\n';
  await writeFile(markerPath, text);
  assert.deepEqual(await catalog.initWorkspace(workspace, signal()), project);
  assert.equal(await readFile(markerPath, "utf8"), text);
  assert.deepEqual(await readdir(join(workspace, ".pi")), ["codegraph-workspace.json"]);
  await assert.rejects(lstat(join(workspace, ".codegraph")), { code: "ENOENT" });
});

test("workspace init refuses root/home and validates metadata without overwriting or following symlinks", async (t) => {
  const root = await temporary(t);
  const catalog = localCatalog(environment(root));
  await assert.rejects(catalog.initWorkspace(parse(root).root, signal()), /root/i);
  await assert.rejects(catalog.initWorkspace(root, signal()), /home/i);
  await assert.rejects(localCatalog(process.env).initWorkspace(homedir(), signal()), /home|Git|checkout/i);
  const workspace = join(root, "workspace");
  const target = join(root, "target");
  await mkdir(workspace);
  await mkdir(target);
  await writeFile(join(target, "codegraph-workspace.json"), '{"version":1}');
  await symlink(target, join(workspace, ".pi"));
  await assert.rejects(catalog.initWorkspace(workspace, signal()), /symlink|metadata/i);
  await assert.rejects(catalog.resolve(workspace, signal()), /symlink|metadata/i);
  await rm(join(workspace, ".pi"));
  await mkdir(join(workspace, ".pi"));
  const markerPath = join(workspace, ".pi", "codegraph-workspace.json");
  await symlink(join(target, "codegraph-workspace.json"), markerPath);
  await assert.rejects(catalog.initWorkspace(workspace, signal()), /symlink|marker/i);
  await rm(markerPath);
  await writeFile(markerPath, '{"version":99}');
  await assert.rejects(catalog.initWorkspace(workspace, signal()), /workspace|marker/i);
  assert.equal(await readFile(markerPath, "utf8"), '{"version":99}');
});

test("logical size includes all regular files, WAL/SHM and nested files without following symlinks", async (t) => {
  const root = await temporary(t);
  const index = join(root, ".codegraph");
  await mkdir(join(index, "cache"), { recursive: true });
  for (const [name, bytes] of [["codegraph.db", 11], ["codegraph.db-wal", 7], ["codegraph.db-shm", 5], ["cache/data", 3]] as const) {
    await writeFile(join(index, name), Buffer.alloc(bytes));
  }
  const catalog = localCatalog(environment(root));
  assert.deepEqual(await catalog.size(root), { databaseBytes: 11, totalBytes: 26, partial: false, detail: null });
  await writeFile(join(root, "outside"), Buffer.alloc(100));
  await symlink(join(root, "outside"), join(index, "outside-link"));
  await symlink(root, join(index, "directory-link"));
  const partial = await catalog.size(root);
  assert.equal(partial.databaseBytes, 11);
  assert.equal(partial.totalBytes, 26);
  assert.equal(partial.partial, true);
  assert.match(partial.detail!, /symlink/i);
  const before = await readdir(index);
  await catalog.size(root);
  assert.deepEqual(await readdir(index), before);
});

test("unsafe index roots and database links return explicit partial-size evidence", async (t) => {
  const root = await temporary(t);
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "codegraph.db"), "12345");
  const catalog = localCatalog(environment(root));
  await symlink(target, join(root, ".codegraph"));
  const linked = await catalog.size(root);
  assert.equal(linked.totalBytes, 0);
  assert.equal(linked.partial, true);
  assert.match(linked.detail!, /symlink/i);
  await rm(join(root, ".codegraph"));
  await mkdir(join(root, ".codegraph"));
  await symlink(join(target, "codegraph.db"), join(root, ".codegraph", "codegraph.db"));
  const database = await catalog.size(root);
  assert.equal(database.databaseBytes, 0);
  assert.equal(database.totalBytes, 0);
  assert.equal(database.partial, true);
  assert.match(database.detail!, /symlink/i);
  const missingRoot = await catalog.size(join(root, "missing"));
  assert.equal(missingRoot.partial, true);
  assert.match(missingRoot.detail!, /ENOENT|no such/i);
});

test("custom CODEGRAPH_DIR is rejected consistently before any catalog side effects", async (t) => {
  const root = await temporary(t);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const catalog = localCatalog({ ...environment(root), CODEGRAPH_DIR: "elsewhere" });
  await assert.rejects(catalog.resolve(workspace, signal()), /Custom CODEGRAPH_DIR is unsupported/);
  await assert.rejects(catalog.discover(workspace, signal()), /Custom CODEGRAPH_DIR is unsupported/);
  await assert.rejects(catalog.initWorkspace(workspace, signal()), /Custom CODEGRAPH_DIR is unsupported/);
  await assert.rejects(catalog.size(workspace), /Custom CODEGRAPH_DIR is unsupported/);
  assert.deepEqual(await readdir(workspace), []);
});
