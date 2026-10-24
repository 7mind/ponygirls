import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execute } from "./runtime.ts";

const METADATA = ".pi";
const WORKSPACE_MARKER = "codegraph-workspace.json";
const INDEX = ".codegraph";
const DATABASE = "codegraph.db";

export interface Project {
  root: string;
  kind: "checkout" | "workspace";
  commonDir: string | null;
}
export interface IndexSize {
  databaseBytes: number;
  totalBytes: number;
  partial: boolean;
  detail: string | null;
}
export interface Catalog {
  resolve(path: string, signal: AbortSignal): Promise<Project | null>;
  discover(path: string, signal: AbortSignal): Promise<Project[]>;
  initWorkspace(path: string, signal: AbortSignal): Promise<Project>;
  size(root: string): Promise<IndexSize>;
}

async function entry(path: string): Promise<Stats | null> {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function directory(path: string, allowFile: boolean): Promise<string> {
  const canonical = await realpath(path);
  const stat = await lstat(canonical);
  if (stat.isDirectory()) return canonical;
  if (allowFile && stat.isFile()) return dirname(canonical);
  throw new Error(`Expected a project directory: ${path}`);
}
async function workspaceMarker(root: string): Promise<boolean> {
  const metadata = join(root, METADATA);
  const parent = await entry(metadata);
  if (parent === null) return false;
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error(`Refusing non-directory or symlink workspace metadata: ${metadata}`);
  const path = join(metadata, WORKSPACE_MARKER);
  const marker = await entry(path);
  if (marker === null) return false;
  if (marker.isSymbolicLink() || !marker.isFile()) throw new Error(`Refusing non-file or symlink workspace marker: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Refusing non-file workspace marker: ${path}`);
    try { value = JSON.parse(await handle.readFile("utf8")); }
    catch (error) { throw new Error(`Invalid workspace marker ${path}: ${String(error)}`); }
  } finally { await handle.close(); }
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("version" in value) || value.version !== 1) {
    throw new Error(`Unsupported workspace marker ${path}; expected {"version":1}`);
  }
  return true;
}

export function localCatalog(env: NodeJS.ProcessEnv): Catalog {
  const checkEnvironment = () => {
    if (env.CODEGRAPH_DIR !== undefined && env.CODEGRAPH_DIR !== "" && env.CODEGRAPH_DIR !== INDEX) {
      throw new Error("Custom CODEGRAPH_DIR is unsupported; the extension and MCP must both use checkout-local .codegraph");
    }
  };
  const checkout = async (cwd: string, signal: AbortSignal): Promise<Project | null> => {
    const result = await execute("git", ["rev-parse", "--show-toplevel"], cwd, signal, env);
    if (result.code !== 0) {
      if (result.stderr.includes("not a git repository") || result.stderr.includes("must be run in a work tree")) return null;
      throw new Error(`Git checkout detection failed: ${result.stderr}`);
    }
    const common = await execute("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, signal, env);
    if (common.code !== 0) throw new Error(`Git common-directory detection failed: ${common.stderr}`);
    return { root: await realpath(result.stdout.trim()), kind: "checkout", commonDir: await realpath(common.stdout.trim()) };
  };
  const workspace = async (cwd: string, signal: AbortSignal): Promise<Project | null> => {
    for (let root = cwd; ; root = dirname(root)) {
      signal.throwIfAborted();
      if (await workspaceMarker(root)) return { root, kind: "workspace", commonDir: null };
      if (dirname(root) === root) return null;
    }
  };
  return {
    async resolve(path, signal) {
      checkEnvironment();
      signal.throwIfAborted();
      const cwd = await directory(path, true);
      return await checkout(cwd, signal) ?? await workspace(cwd, signal);
    },
    async discover(path, signal) {
      checkEnvironment();
      signal.throwIfAborted();
      const cwd = await directory(path, true);
      const containing = await checkout(cwd, signal);
      if (containing !== null) return [containing];
      const marked = await workspace(cwd, signal);
      const projects = new Map<string, Project>();
      if (marked !== null) projects.set(marked.root, marked);
      const children = await readdir(cwd, { withFileTypes: true });
      children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const child of children) {
        signal.throwIfAborted();
        if (!child.isDirectory() || child.isSymbolicLink()) continue;
        const root = join(cwd, child.name);
        const git = await entry(join(root, ".git"));
        if (git === null || git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) continue;
        const project = await checkout(root, signal);
        if (project !== null) projects.set(project.root, project);
      }
      signal.throwIfAborted();
      return [...projects.values()];
    },
    async initWorkspace(path, signal) {
      checkEnvironment();
      signal.throwIfAborted();
      const root = await directory(path, false);
      if (dirname(root) === root) throw new Error("Refusing a filesystem-root Codegraph workspace");
      const home = env.HOME === undefined || env.HOME === "" ? homedir() : env.HOME;
      if (root === await realpath(home)) throw new Error("Refusing a home-directory Codegraph workspace");
      if (await checkout(root, signal) !== null) throw new Error("Workspace initialization requires a non-Git directory, not a checkout");
      const index = await entry(join(root, INDEX));
      if (index !== null && (index.isSymbolicLink() || !index.isDirectory())) throw new Error("Refusing non-directory or symlink .codegraph");
      const database = index === null ? null : await entry(join(root, INDEX, DATABASE));
      if (database !== null && (database.isSymbolicLink() || !database.isFile())) throw new Error("Refusing non-file or symlink Codegraph database");
      if (!await workspaceMarker(root)) {
        signal.throwIfAborted();
        const metadata = join(root, METADATA);
        try { await mkdir(metadata); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        if (!await workspaceMarker(root)) {
          const temporary = join(metadata, `.${WORKSPACE_MARKER}.${randomUUID()}.tmp`);
          await writeFile(temporary, '{"version":1}\n', { flag: "wx", mode: 0o600 });
          try {
            signal.throwIfAborted();
            // A hard link publishes a complete marker without overwriting a concurrent opt-in.
            try { await link(temporary, join(metadata, WORKSPACE_MARKER)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
            await workspaceMarker(root);
          } finally { await unlink(temporary); }
        }
      }
      signal.throwIfAborted();
      return { root, kind: "workspace", commonDir: null };
    },
    async size(root) {
      checkEnvironment();
      const result: IndexSize = { databaseBytes: 0, totalBytes: 0, partial: false, detail: null };
      const problems: string[] = [];
      let index: string;
      try { index = join(await directory(root, false), INDEX); }
      catch (error) { return { ...result, partial: true, detail: String(error) }; }
      const visit = async (path: string): Promise<void> => {
        try {
          const stat = await lstat(path);
          if (stat.isSymbolicLink()) { problems.push(`Skipped symlink: ${path}`); return; }
          if (stat.isDirectory()) {
            for (const child of await readdir(path)) await visit(join(path, child));
          } else if (stat.isFile()) {
            if (path === index) { problems.push(`Not an index directory: ${path}`); return; }
            result.totalBytes += stat.size;
            if (path === join(index, DATABASE)) result.databaseBytes = stat.size;
          } else { problems.push(`Skipped non-regular index entry: ${path}`); }
        } catch (error) { problems.push(`${path}: ${String(error)}`); }
      };
      try {
        if (await entry(index) !== null) await visit(index);
      } catch (error) { problems.push(`${index}: ${String(error)}`); }
      result.partial = problems.length > 0;
      result.detail = result.partial ? problems.join("; ") : null;
      return result;
    },
  };
}
