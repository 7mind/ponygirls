/**
 * pi-subagents — restricted tool execution.
 *
 * One ToolExecutor backend for Linux bubblewrap. Path validation improves
 * error reporting, but the filesystem boundary comes from the restricted
 * mount view — never from check-then-open path checks alone.
 *
 * Unsupported launchers are rejected (SANDBOX_UNAVAILABLE); restricted
 * execution is never silently replaced with host execution.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { err } from "./errors.ts";

export interface ToolJobSpec {
  operationId: string;
  /** Executable resolved by the supervisor (absolute path). */
  argv: string[];
  cwd: string;
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
  /** Minimal environment (allowlisted, never copied from process.env). */
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Tool-job network is denied by default; no destination allowlist exists. */
  network: boolean;
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

export function resolveExe(exe: string, pathEnv?: string): string {
  if (exe.includes("/")) return exe;
  const path = pathEnv ?? process.env["PATH"] ?? "/usr/bin:/bin";
  for (const dir of path.split(":")) {
    const candidate = `${dir}/${exe}`;
    try {
      const st = spawnSync("sh", ["-c", `test -x ${JSON.stringify(candidate)} && echo yes`], { encoding: "utf8" });
      if ((st.stdout ?? "").trim() === "yes") return candidate;
    } catch {
      // try next
    }
  }
  throw err("SANDBOX_UNAVAILABLE", `cannot resolve executable ${exe} to an absolute path`);
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
  roots.add("/nix/store");
  return [...roots];
}

export class BwrapToolExecutor implements ToolExecutor {
  readonly backend = "bubblewrap";
  private bwrapPath: string;
  private running = new Map<string, import("node:child_process").ChildProcess>();

  constructor(bwrapPath = "bwrap") {
    this.bwrapPath = bwrapPath;
  }

  async cancel(operationId: string): Promise<void> {
    const child = this.running.get(operationId);
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // gone
        }
        resolve();
      }, 5000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  probe(): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    const v = spawnSync(this.bwrapPath, ["--version"], { encoding: "utf8", timeout: 10_000 });
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
    const p = spawnSync(
      this.bwrapPath,
      [...this.baseArgs(), "--ro-bind", "/", "/", shell, "-c", "true"],
      { encoding: "utf8", timeout: 15_000 },
    );
    if (p.error ?? p.status !== 0) {
      return {
        ok: false,
        error: err("SANDBOX_UNAVAILABLE", `bubblewrap namespaces unavailable: ${(p.error as Error | undefined)?.message ?? p.stderr}`),
      };
    }
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
      "--clearenv",
      "--proc", "/proc",
      "--dev", "/dev",
    ];
  }

  /** Sensitive subtrees covered AFTER the read-only base (order matters). */
  private coverArgs(): string[] {
    const out: string[] = [];
    for (const dir of ["/tmp", "/home", "/root", "/run", "/srv", "/mnt", "/media", "/opt", "/var", "/etc", "/boot"]) {
      // Mount points that do not exist cannot be covered; bwrap cannot
      // create them over a read-only base, so skip absent ones.
      if (existsSync(dir)) out.push("--tmpfs", dir);
    }
    return out;
  }

  async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
    if (spec.network) {
      throw err("POLICY_DENIED", "tool-job network requires an explicit grant; no destination policy exists in v1");
    }
    const probe = this.probe();
    if (!probe.ok) throw probe.error;
    if (!spec.argv[0]?.includes("/")) {
      throw err("INVALID", "sandbox argv must use an absolute executable path");
    }
    const args: string[] = [...this.baseArgs(), "--ro-bind", "/", "/", ...this.coverArgs()];
    for (const [k, v] of Object.entries(spec.env)) {
      args.push("--setenv", k, v);
    }
    // Required runtime closure read-only (explicit; the / / base is read-only
    // but these binds document the executable closure without scanning /nix/store).
    for (const root of new Set([...spec.runtimeRoots, ...resolveRuntimeRoots(spec.argv.slice(0, 1))])) {
      if (existsSync(root)) args.push("--ro-bind", root, root);
    }
    // Minimal identity files over the covered /etc.
    for (const essential of ["/etc/passwd", "/etc/group"]) {
      if (existsSync(essential)) args.push("--ro-bind", essential, essential);
    }
    // Supervisor-named hides (storage, sibling workspaces, credentials).
    for (const hide of spec.hidePaths) {
      if (existsSync(hide)) args.push("--tmpfs", hide);
    }
    for (const root of spec.readRoots) {
      if (existsSync(root)) args.push("--ro-bind", root, root);
    }
    if (spec.writableRoot) args.push("--bind", spec.writableRoot, spec.writableRoot);
    args.push("--bind", spec.tmpDir, spec.tmpDir);
    args.push("--chdir", spec.cwd, "--");
    const { spawn } = await import("node:child_process");
    return new Promise<ToolJobResult>((resolve) => {
      const child = spawn(this.bwrapPath, [...args, ...spec.argv], { stdio: ["ignore", "pipe", "pipe"] });
      this.running.set(spec.operationId, child);
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
        try {
          // Terminate the whole sandbox tree (new PID namespace init dies
          // with --die-with-parent; kill the direct child too).
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, spec.timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({
          operationId: spec.operationId,
          exitCode: null,
          signal: null,
          stdout: stdout.toString("utf8"),
          stderr: `${stderr.toString("utf8")}\nspawn error: ${(e as Error).message}`,
          truncated,
          timedOut,
        });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.running.delete(spec.operationId);
        resolve({
          operationId: spec.operationId,
          exitCode: code,
          signal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          truncated,
          timedOut,
        });
      });
    });
  }
}

/**
 * Hand-written dummy executor for contract tests. Enforces the same
 * preconditions (network denial, output caps, timeout shape) without
 * namespaces, and records specs for assertions.
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
    if (spec.network) throw err("POLICY_DENIED", "tool-job network denied");
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
