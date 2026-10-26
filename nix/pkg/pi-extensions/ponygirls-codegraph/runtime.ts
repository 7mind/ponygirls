import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_LIMIT = 32_768;
const KILL_GRACE_MS = 700;
export type Action = "status" | "sync" | "reindex";
export interface State {
  phase: "idle" | "working" | "ready" | "error" | "skipped" | "cancelled";
  detail: string;
}
export interface Boundary {
  root(cwd: string, signal: AbortSignal): Promise<string | null>;
  localIndex(root: string): Promise<boolean>;
  run(root: string, args: string[], signal: AbortSignal): Promise<string>;
}
interface Status {
  initialized: boolean;
  projectPath: string;
  indexPath: string;
  fileCount: number;
  nodeCount: number;
  pendingChanges: { added: number; modified: number; removed: number };
  index: { state: string | null; reindexRecommended: boolean; pendingRefs: number;
    filesNeedingReindex: number; filesWithParseErrors: number };
}

function statusFrom(text: string, root: string): Status {
  const value = JSON.parse(text) as Status;
  if (value.projectPath !== root || value.indexPath !== join(root, ".codegraph")) {
    throw new Error("Refusing a non-local Codegraph index (ancestor or custom index path)");
  }
  if (value.initialized !== true) throw new Error("Local Codegraph index is not initialized; retry /cg sync");
  const index = value.index;
  const changes = value.pendingChanges;
  if (!index || !changes || typeof index.reindexRecommended !== "boolean" ||
      !["complete", "partial", "indexing", "failed", null].includes(index.state) ||
      ![value.fileCount, value.nodeCount, index.pendingRefs, index.filesNeedingReindex,
        index.filesWithParseErrors, changes.added, changes.modified, changes.removed]
        .every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error("Unsupported Codegraph status JSON; expected the 1.6.2 health fields");
  }
  return value;
}
function needsIndex(s: Status): boolean {
  return s.index.state !== "complete" || s.index.reindexRecommended || s.fileCount === 0 || s.nodeCount === 0;
}
function ready(s: Status): boolean {
  return !needsIndex(s) && s.index.pendingRefs === 0 && s.index.filesNeedingReindex === 0 &&
    Object.values(s.pendingChanges).every((n) => n === 0);
}
function readyDetail(root: string, status: Status): string {
  const warnings = status.index.filesWithParseErrors;
  return `${root}: ${status.fileCount} files, ${status.nodeCount} symbols` +
    (warnings === 0 ? "" : `; ${warnings} files with parse warnings`);
}

export class CodegraphSession {
  state: State = { phase: "idle", detail: "not started" };
  private active: { controller: AbortController; done: Promise<void> } | undefined;
  private closed = false;
  private boundary: Boundary;
  private cwd: string;
  private changed: (state: State) => void;

  constructor(boundary: Boundary, cwd: string, changed: (state: State) => void) {
    this.boundary = boundary;
    this.cwd = cwd;
    this.changed = changed;
  }
  private publish(phase: State["phase"], detail: string): void {
    if (this.closed) return;
    this.state = { phase, detail: detail.slice(-OUTPUT_LIMIT) };
    this.changed(this.state);
  }
  start(action: Action): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.active) return this.active.done;
    const controller = new AbortController();
    this.publish("working", "checking checkout");
    const done = this.prepare(action, controller.signal).catch((error: unknown) => {
      this.publish(controller.signal.aborted ? "cancelled" : "error", String(error));
    }).finally(() => { this.active = undefined; });
    this.active = { controller, done };
    return done;
  }
  skip(detail: string): void {
    if (this.active) throw new Error("Cannot skip active Codegraph work");
    this.publish("skipped", detail);
  }
  wait(): Promise<void> {
    return this.active === undefined ? Promise.resolve() : this.active.done;
  }
  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.done;
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await this.cancel();
  }
  private async prepare(action: Action, signal: AbortSignal): Promise<void> {
    const root = await this.boundary.root(this.cwd, signal);
    signal.throwIfAborted();
    if (root === null) { this.publish("skipped", "not a Git checkout"); return; }
    const run = async (args: string[]) => {
      signal.throwIfAborted();
      this.publish("working", `${args[0]} (wait/run): ${root}`);
      const output = await this.boundary.run(root, args, signal);
      signal.throwIfAborted();
      return output;
    };
    const local = await this.boundary.localIndex(root);
    signal.throwIfAborted();
    if (action === "reindex") {
      await run(["init", root, "--yes"]);
      await run(["index", root, "--quiet"]);
      const status = statusFrom(await run(["status", root, "--json"]), root);
      if (!ready(status)) throw new Error(`Index not ready at ${root}: ${JSON.stringify(status)}`);
      this.publish("ready", readyDetail(root, status));
      return;
    }
    if (!local) {
      if (action === "status") { this.publish("skipped", `no local index: ${root}`); return; }
      await run(["init", root, "--yes"]);
    }
    let status = statusFrom(await run(["status", root, "--json"]), root);
    if (action !== "status" && (local || !ready(status))) {
      if (needsIndex(status)) {
        await run(["index", root, "--quiet"]);
      } else {
        await run(["sync", root]);
      }
      status = statusFrom(await run(["status", root, "--json"]), root);
    }
    if (!ready(status)) {
      throw new Error(`Index not ready at ${root}: ${JSON.stringify(status)}`);
    }
    this.publish("ready", readyDetail(root, status));
  }
}

function clean(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export async function execute(binary: string, args: string[], cwd: string, signal: AbortSignal,
  env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let termination: Promise<void> = Promise.resolve();
    const kill = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    const abort = () => {
      kill("SIGTERM");
      termination = new Promise((done) => setTimeout(() => { kill("SIGKILL"); done(); }, KILL_GRACE_MS));
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data: Buffer) => { stdout = (stdout + data.toString()).slice(-OUTPUT_LIMIT); });
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-OUTPUT_LIMIT); });
    child.on("error", reject);
    child.on("close", async (code) => {
      signal.removeEventListener("abort", abort);
      await termination;
      if (signal.aborted) reject(new Error("Codegraph operation cancelled"));
      else resolveResult({ code, stdout: clean(stdout), stderr: clean(stderr) });
    });
    if (signal.aborted) abort();
  });
}

export function localBoundary(binary: string, flock: string, env: NodeJS.ProcessEnv): Boundary {
  const localEnv = { ...env, CODEGRAPH_DIR: ".codegraph", CODEGRAPH_TELEMETRY: "0" };
  return {
    async root(cwd, signal) {
      if (env.CODEGRAPH_DIR !== undefined && env.CODEGRAPH_DIR !== "" && env.CODEGRAPH_DIR !== ".codegraph") {
        throw new Error("Custom CODEGRAPH_DIR is unsupported; the extension and MCP must both use checkout-local .codegraph");
      }
      const result = await execute("git", ["-C", cwd, "rev-parse", "--show-toplevel"], cwd, signal, localEnv);
      if (result.code !== 0) {
        if (result.stderr.includes("not a git repository") || result.stderr.includes("must be run in a work tree")) return null;
        throw new Error(`Git checkout detection failed: ${result.stderr}`);
      }
      return realpath(result.stdout.trim());
    },
    async localIndex(root) {
      try {
        const entry = await lstat(join(root, ".codegraph"));
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Refusing non-directory or symlink .codegraph");
        const database = await lstat(join(root, ".codegraph", "codegraph.db"));
        if (!database.isFile() || database.isSymbolicLink()) throw new Error("Refusing non-file or symlink Codegraph database");
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async run(root, args, signal) {
      const git = await execute("git", ["rev-parse", "--absolute-git-dir"], root, signal, localEnv);
      let lock: string;
      if (git.code === 0) lock = join(git.stdout.trim(), "ponygirls-codegraph.lock");
      else {
        if (!git.stderr.includes("not a git repository")) throw new Error(`Git directory detection failed: ${git.stderr}`);
        const metadata = await lstat(join(root, ".pi"));
        const marker = await lstat(join(root, ".pi", "codegraph-workspace.json"));
        if (!metadata.isDirectory() || metadata.isSymbolicLink() || !marker.isFile() || marker.isSymbolicLink() ||
            JSON.parse(await readFile(join(root, ".pi", "codegraph-workspace.json"), "utf8")).version !== 1) {
          throw new Error("Non-Git indexing requires a local /cg init --workspace opt-in");
        }
        lock = join(root, ".pi", "codegraph-workspace.lock");
      }
      // init's --yes would install fallback Git hooks when watching is disabled.
      // init never starts a watcher; override only its policy check, not the MCP environment.
      const commandEnv = args[0] === "init"
        ? { ...localEnv, CODEGRAPH_NO_WATCH: "0", CODEGRAPH_FORCE_WATCH: "1" } : localEnv;
      const result = await execute(flock, ["-x", lock, binary, ...args], root, signal, commandEnv);
      if (result.code !== 0) throw new Error(`codegraph ${args[0]} exited ${result.code}: ${result.stderr}\n${result.stdout}`);
      return result.stdout;
    },
  };
}
