/**
 * ponygirls-subagents — tool execution backends.
 *
 * Agents with isolation "none" or "worktree" run tool jobs directly on the
 * host (HostToolExecutor). Sandboxed agents use the Linux bubblewrap
 * backend: path validation improves error reporting, but the filesystem
 * boundary comes from the restricted mount view — never from
 * check-then-open path checks alone.
 *
 * The view is an allowlist built on an empty root: system runtime roots,
 * identity files, resolved runtime closures, approved read roots, the
 * writer's worktree, and private scratch. Nothing else from the host exists
 * inside it (no home, /run, /var, /sys, nix daemon socket, or supervisor
 * storage).
 *
 * Unsupported launchers are rejected (SANDBOX_UNAVAILABLE); restricted
 * execution is never silently replaced with host execution.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { err } from "./errors.ts";

/** The restricted filesystem view of one sandboxed tool job. */
export interface SandboxView {
  /** Approved read-only roots. */
  readRoots: string[];
  /** Writable worktree (writers) or null. */
  writableRoot: string | null;
  /** Private scratch dir, always writable. */
  tmpDir: string;
  /**
   * Paths that must be ABSENT from the view (supervisor storage, other
   * workspaces, credentials), covered with fresh tmpfs after the
   * read-only base and before the explicit binds below re-expose only
   * the approved paths (which may live under a hidden parent).
   */
  hidePaths: string[];
  /** Extra read-only runtime paths (resolved closures, no /nix/store scan). */
  runtimeRoots: string[];
  /** Tool-job network is denied by default; no destination allowlist exists. */
  network: boolean;
}

export interface ToolJobSpec {
  operationId: string;
  /** Executable resolved by the supervisor (absolute path). */
  argv: string[];
  cwd: string;
  /** Sandboxed jobs: allowlisted, never copied from process.env. Host jobs: the host environment. */
  env: Record<string, string>;
  /** Bytes written to the job's stdin (structured tool arguments), or null. */
  stdin: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Restricted view of a sandboxed job; null runs the job directly on the host. */
  view: SandboxView | null;
}

export interface ToolJobResult {
  operationId: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface ToolExecutor {
  readonly backend: string;
  probe(): { ok: true } | { ok: false; error: ReturnType<typeof err> };
  exec(spec: ToolJobSpec): Promise<ToolJobResult>;
  /** Best-effort cancellation of a running job; resolves when reaped. */
  cancel?(operationId: string): Promise<void>;
}

/** Read-only host roots that make up the runtime of every tool job (when present). */
const SYSTEM_RUNTIME_ROOTS = ["/nix/store", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64"];
/** Identity files plus the FHS alternatives links many /usr/bin tools resolve through. */
const IDENTITY_FILES = ["/etc/passwd", "/etc/group", "/etc/alternatives"];
const PROBE_TIMEOUT_MS = 15_000;
const CANCEL_GRACE_MS = 5000;

/** Resolve an executable through PATH to its real absolute path (no shell). */
export function resolveExe(exe: string, pathEnv?: string): string {
  const candidates = exe.includes("/") ? [exe] : (pathEnv ?? process.env["PATH"] ?? "/usr/bin:/bin").split(":").filter((d) => d.startsWith("/")).map((d) => `${d}/${exe}`);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // try next
    }
  }
  throw err("SANDBOX_UNAVAILABLE", `cannot resolve executable ${exe} to an absolute path`);
}

/**
 * Host PATH directories exposed read-only inside tool jobs so generated
 * commands find the runtime closure. Directories under the user's home
 * (personal scripts may embed secrets) and setuid wrapper directories are
 * never exposed.
 */
export function sandboxRuntimePath(hostPath: string, home: string): string[] {
  const out: string[] = [];
  for (const dir of hostPath.split(":")) {
    if (!dir.startsWith("/") || out.includes(dir)) continue;
    if (dir === home || dir.startsWith(`${home}/`) || dir.startsWith("/run/wrappers")) continue;
    if (!existsSync(dir)) continue;
    out.push(dir);
  }
  return out;
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

export function resolveRuntimeRoots(explicit: string[]): string[] {
  // Resolve Nix runtime closures through known package paths only.
  // Never scan /nix/store (flat, millions of entries).
  const roots = new Set<string>();
  for (const p of explicit) {
    if (p.startsWith("/nix/store/")) {
      const m = p.match(/^(\/nix\/store\/[^/]+)/);
      if (m) roots.add(m[1]!);
    } else {
      roots.add(dirname(p));
    }
  }
  return [...roots];
}

/** Signal a job: its whole process group for host jobs, the bwrap launcher otherwise. */
function signalJob(child: ChildProcess, signal: NodeJS.Signals, processGroup: boolean): void {
  try {
    if (processGroup && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // already gone
  }
}

/** Terminate a running job (SIGTERM, then SIGKILL after a grace period); resolves when reaped. */
async function cancelJob(running: Map<string, ChildProcess>, operationId: string, processGroup: boolean): Promise<void> {
  const child = running.get(operationId);
  if (!child) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalJob(child, "SIGKILL", processGroup);
      resolve();
    }, CANCEL_GRACE_MS);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    signalJob(child, "SIGTERM", processGroup);
  });
}

/**
 * Run one job process with capped output and a timeout. A host job runs as
 * its own process group, and the group is killed when its leader exits, so
 * no descendant outlives the job (a bwrap PID namespace gives sandboxed
 * jobs the same property).
 */
function runJob(
  file: string,
  args: string[],
  spawnOpts: { cwd: string | undefined; env: Record<string, string> | undefined },
  spec: ToolJobSpec,
  processGroup: boolean,
  running: Map<string, ChildProcess>,
): Promise<ToolJobResult> {
  return new Promise<ToolJobResult>((resolve) => {
    const child = spawn(file, args, {
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
      detached: processGroup,
      stdio: [spec.stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    running.set(spec.operationId, child);
    if (spec.stdin !== null) {
      // A job that exits without reading its input must not fail the broker.
      child.stdin?.on("error", () => {});
      child.stdin?.end(spec.stdin);
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    const cap = spec.maxOutputBytes;
    const onData = (buf: Buffer, whichBuf: "out" | "err"): void => {
      const cur = whichBuf === "out" ? stdout : stderr;
      if (cur.length + buf.length > cap) {
        truncated = true;
        buf = buf.subarray(0, Math.max(0, cap - cur.length));
      }
      if (whichBuf === "out") stdout = Buffer.concat([stdout, buf]);
      else stderr = Buffer.concat([stderr, buf]);
    };
    child.stdout?.on("data", (d: Buffer) => onData(d, "out"));
    child.stderr?.on("data", (d: Buffer) => onData(d, "err"));
    const timer = setTimeout(() => {
      timedOut = true;
      signalJob(child, "SIGKILL", processGroup);
    }, spec.timeoutMs);
    if (processGroup) child.on("exit", () => signalJob(child, "SIGKILL", true));
    const finish = (exitCode: number | null, signal: string | null, extraErr: string): void => {
      clearTimeout(timer);
      running.delete(spec.operationId);
      resolve({
        operationId: spec.operationId,
        exitCode,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: `${stderr.toString("utf8")}${extraErr}`,
        truncated,
        timedOut,
      });
    };
    child.on("error", (e) => finish(null, null, `\nspawn error: ${(e as Error).message}`));
    child.on("close", (code, signal) => finish(code, signal, ""));
  });
}

export class BwrapToolExecutor implements ToolExecutor {
  readonly backend = "bubblewrap";
  private bwrapPath: string;
  private running = new Map<string, ChildProcess>();
  /** Successful probes are cached; failures are re-probed on the next job. */
  private probed = false;

  constructor(bwrapPath = "bwrap") {
    this.bwrapPath = bwrapPath;
  }

  async cancel(operationId: string): Promise<void> {
    await cancelJob(this.running, operationId, false);
  }

  probe(): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    if (this.probed) return { ok: true };
    const v = spawnSync(this.bwrapPath, ["--version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    if (v.error ?? v.status !== 0) {
      return { ok: false, error: err("SANDBOX_UNAVAILABLE", `bubblewrap not runnable: ${(v.error as Error | undefined)?.message ?? v.stderr}`) };
    }
    // Namespace support check with the same mount-view shape as real jobs.
    let shell: string;
    try {
      shell = resolveExe("sh");
    } catch {
      return { ok: false, error: err("SANDBOX_UNAVAILABLE", "no shell for probe") };
    }
    const p = spawnSync(this.bwrapPath, [...this.baseArgs(), ...this.runtimeArgs([shell]), shell, "-c", "true"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    if (p.error ?? p.status !== 0) {
      return {
        ok: false,
        error: err("SANDBOX_UNAVAILABLE", `bubblewrap namespaces unavailable: ${(p.error as Error | undefined)?.message ?? p.stderr}`),
      };
    }
    this.probed = true;
    return { ok: true };
  }

  private baseArgs(): string[] {
    return [
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-net",
      "--unshare-cgroup-try",
      "--die-with-parent",
      "--new-session",
      "--clearenv",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
    ];
  }

  /** System runtime, identity files, and the closures of the given executables. */
  private runtimeArgs(executables: string[], extraRoots: string[] = []): string[] {
    const out: string[] = [];
    const roots = new Set([...SYSTEM_RUNTIME_ROOTS, ...extraRoots, ...resolveRuntimeRoots(executables)]);
    for (const root of roots) {
      if (existsSync(root)) out.push("--ro-bind", root, root);
    }
    for (const file of IDENTITY_FILES) {
      if (existsSync(file)) out.push("--ro-bind", file, file);
    }
    return out;
  }

  async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
    const view = spec.view;
    if (view === null) throw err("INVALID", "a sandboxed job needs a view");
    if (view.network) {
      throw err("POLICY_DENIED", "tool-job network requires an explicit grant; no destination policy exists in v1");
    }
    const probe = this.probe();
    if (!probe.ok) throw probe.error;
    if (!spec.argv[0]?.startsWith("/")) {
      throw err("INVALID", "sandbox argv must use an absolute executable path");
    }
    const args: string[] = [...this.baseArgs(), ...this.runtimeArgs(spec.argv.slice(0, 1), view.runtimeRoots)];
    for (const [k, v] of Object.entries(spec.env)) {
      args.push("--setenv", k, v);
    }
    // Hides only matter where a bound root would otherwise expose them;
    // they are applied after the read roots, and approved paths beneath a
    // hide are bound again afterwards.
    // Matched by real path and placed at the path the view shows, so a
    // symlinked read root cannot re-expose a hidden directory.
    const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);
    const exposed = [...SYSTEM_RUNTIME_ROOTS, ...view.runtimeRoots, ...view.readRoots].filter((p) => existsSync(p));
    const hides = new Set<string>();
    for (const hide of view.hidePaths.filter((h) => existsSync(h)).map(real)) {
      for (const root of exposed) {
        const realRoot = real(root);
        if (isUnder(hide, realRoot)) hides.add(root + hide.slice(realRoot.length));
      }
    }
    const hidden = (p: string): boolean => [...hides].some((h) => isUnder(p, h));
    for (const root of view.readRoots) {
      if (existsSync(root) && !hidden(root)) args.push("--ro-bind", root, root);
    }
    for (const hide of hides) {
      if (statSync(hide).isDirectory()) args.push("--tmpfs", hide);
      else args.push("--ro-bind", "/dev/null", hide);
    }
    for (const root of view.readRoots) {
      if (existsSync(root) && hidden(root)) args.push("--ro-bind", root, root);
    }
    if (view.writableRoot) args.push("--bind", view.writableRoot, view.writableRoot);
    args.push("--bind", view.tmpDir, view.tmpDir);
    args.push("--chdir", spec.cwd, "--");
    // --die-with-parent and the PID namespace end the whole job with the launcher.
    return runJob(this.bwrapPath, [...args, ...spec.argv], { cwd: undefined, env: undefined }, spec, false, this.running);
  }
}

/**
 * Direct host execution for agents with isolation "none" or "worktree":
 * the job runs as the user, with the host environment, in the agent's
 * working directory. It enforces no filesystem or network boundary.
 */
export class HostToolExecutor implements ToolExecutor {
  readonly backend = "host";
  private running = new Map<string, ChildProcess>();

  probe(): { ok: true } {
    return { ok: true };
  }

  async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
    if (spec.view !== null) throw err("INVALID", "the host executor cannot enforce a sandbox view");
    const exe = spec.argv[0];
    if (exe === undefined || !exe.startsWith("/")) throw err("INVALID", "host argv must use an absolute executable path");
    return runJob(exe, spec.argv.slice(1), { cwd: spec.cwd, env: spec.env }, spec, true, this.running);
  }

  async cancel(operationId: string): Promise<void> {
    await cancelJob(this.running, operationId, true);
  }
}

/**
 * Hand-written dummy executor for contract tests. Enforces the same
 * preconditions (network denial, output caps, timeout shape) without
 * namespaces, accepts sandboxed and host specs alike, and records specs
 * for assertions.
 */
export class DummyToolExecutor implements ToolExecutor {
  readonly backend = "dummy";
  specs: ToolJobSpec[] = [];
  failProbe = false;
  cancelled: string[] = [];
  handler: ((spec: ToolJobSpec) => Omit<ToolJobResult, "operationId"> | Promise<Omit<ToolJobResult, "operationId">>) | null = null;

  async cancel(operationId: string): Promise<void> {
    this.cancelled.push(operationId);
  }

  probe(): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    if (this.failProbe) return { ok: false, error: err("SANDBOX_UNAVAILABLE", "dummy probe failure") };
    return { ok: true };
  }

  async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
    if (spec.view !== null && spec.view.network) throw err("POLICY_DENIED", "tool-job network denied");
    const probe = this.probe();
    if (!probe.ok) throw probe.error;
    this.specs.push(spec);
    if (this.handler) return { operationId: spec.operationId, ...(await this.handler(spec)) };
    return {
      operationId: spec.operationId,
      exitCode: 0,
      signal: null,
      stdout: `dummy:${spec.argv.join(" ")}`,
      stderr: "",
      truncated: false,
      timedOut: false,
    };
  }
}
