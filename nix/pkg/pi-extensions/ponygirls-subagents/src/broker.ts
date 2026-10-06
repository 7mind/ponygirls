/**
 * ponygirls-subagents — supervisor-owned tool broker.
 *
 * The worker registers proxy tools only. Every invocation is validated
 * after any argument transformation, against caller authority derived from
 * the authenticated channel. The broker covers nested tool invocation as
 * well as direct model calls (nested calls arrive as tool.execute with a
 * parentOperationId and are authorized identically).
 *
 * Before a brokered side effect, the intent (op id, args, generation) is
 * durably recorded; confirmed outcomes are recorded separately. A crash
 * between effect and confirmation stays `uncertain` — never replayed.
 */

import { randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import { resolveExe } from "./sandbox.ts";
import { authorizeTool } from "./policy.ts";
import { TOOL_SCRIPTS, bashTimeoutMs, validateToolArgs } from "./tools.ts";
import type { SandboxView, ToolExecutor, ToolJobResult, ToolJobSpec } from "./sandbox.ts";
import type { RunStore } from "./store.ts";
import type { AgentId, GrantSet, OperationId } from "./types.ts";

export interface BrokerCaller {
  agentId: AgentId;
  taskRunId: string | null;
  generation: number | null;
  grants: GrantSet;
  /** Directory tool jobs start in; relative paths resolve here. */
  workdir: string;
  /** Tree write/edit may modify, or null (readers). */
  writableRoot: string | null;
  /** View inputs of a sandboxed caller; null runs its jobs on the host. */
  sandbox: CallerSandbox | null;
}

export interface CallerSandbox {
  readRoots: string[];
  tmpDir: string;
  /** Supervisor storage/sibling paths absent from the tool view. */
  hidePaths: string[];
}

/** Backends by execution mode: bubblewrap for sandboxed callers, direct host execution otherwise. */
export interface ToolExecutors {
  sandbox: ToolExecutor;
  host: ToolExecutor;
}

export interface ToolRequest {
  operationId?: string;
  tool: string;
  args: Record<string, unknown>;
  parentOperationId?: string;
}

export interface OwnedJob {
  operationId: OperationId;
  agentId: AgentId;
  tool: string;
  startedAt: string;
  done: boolean;
}

const TOOL_TIMEOUT_MS = 120_000;
const TOOL_MAX_OUTPUT = 256 * 1024;

export class ToolBroker {
  private executors: ToolExecutors;
  private store: RunStore;
  private jobs = new Map<OperationId, OwnedJob>();
  private runtimeRoots: string[];
  private sandboxEnv: Record<string, string>;
  private hostEnv: Record<string, string>;

  /**
   * `sandboxEnv` is the allowlisted environment of sandboxed jobs (plus
   * their private HOME/TMPDIR); `hostEnv` is the full environment of host jobs.
   */
  constructor(executors: ToolExecutors, store: RunStore, runtimeRoots: string[], sandboxEnv: Record<string, string>, hostEnv: Record<string, string>) {
    this.executors = executors;
    this.store = store;
    this.runtimeRoots = runtimeRoots;
    this.sandboxEnv = sandboxEnv;
    this.hostEnv = hostEnv;
  }

  /** Active (unfinished) owned jobs for an agent. */
  activeJobs(agentId: AgentId): OwnedJob[] {
    return [...this.jobs.values()].filter((j) => j.agentId === agentId && !j.done);
  }

  /** Cancel owned tool jobs (best effort) and mark them done-uncertain. */
  async cancelJobs(agentId: AgentId): Promise<string[]> {
    const active = this.activeJobs(agentId);
    for (const job of active) {
      try {
        await this.executors.sandbox.cancel?.(job.operationId);
        await this.executors.host.cancel?.(job.operationId);
      } catch {
        // best effort; outcome stays uncertain
      }
      job.done = true;
      this.store.append("tool.outcome", { operationId: job.operationId, status: "cancelled" });
    }
    return active.map((j) => j.operationId);
  }

  /**
   * Controller-executed check against a paused candidate. Unlike model tool
   * calls this needs no shell grant: authority comes from the gate
   * controller. A sandboxed candidate is checked through a read-only view
   * (writableRoot null); a host-isolated one runs on the host, where nothing
   * stops a check from modifying sources.
   */
  async runControllerCheck(opts: {
    agentId: AgentId;
    taskRunId: string | null;
    generation: number;
    sandbox: CallerSandbox | null;
    command: string;
    cwd: string;
    timeoutMs: number;
  }): Promise<ToolJobResult> {
    if (!opts.command) throw err("INVALID", "check command required");
    if (opts.command.length > 32 * 1024) throw err("PAYLOAD_TOO_LARGE", "check command exceeds 32KiB");
    const operationId = randomUUID();
    const job: OwnedJob = { operationId, agentId: opts.agentId, tool: "gate-check", startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.store.append("tool.intent", {
      operationId,
      agentId: opts.agentId,
      taskRunId: opts.taskRunId,
      generation: opts.generation,
      tool: "gate-check",
    });
    try {
      const spec = this.jobSpec(opts.sandbox, null, operationId, ["bash", "-c", opts.command], opts.cwd, null, opts.timeoutMs);
      const result = await this.executorFor(spec).exec(spec);
      job.done = true;
      this.store.append("tool.outcome", { operationId, status: result.exitCode === 0 ? "ok" : "error", exitCode: result.exitCode });
      return result;
    } catch (e) {
      job.done = true;
      this.store.append("tool.outcome", { operationId, status: "uncertain", error: (e as Error).message });
      throw e;
    }
  }

  /** Quiescence gate for parking: no unfinished owned jobs. */
  assertQuiescent(agentId: AgentId): void {
    const active = this.activeJobs(agentId);
    if (active.length > 0) {
      throw err("CONFLICT", `cannot park: ${active.length} owned tool job(s) still active`, { ops: active.map((j) => j.operationId) });
    }
  }

  async execute(caller: BrokerCaller, request: ToolRequest): Promise<ToolJobResult> {
    const auth = authorizeTool(caller.grants, request.tool);
    if (!auth.ok) throw auth.error;
    // Validate after normalization: what is checked is exactly what runs.
    const args = validateToolArgs(request.tool, normalizeArgs(request.args));
    const operationId = request.operationId ?? randomUUID();

    if (this.jobs.has(operationId)) {
      throw err("DUPLICATE_REQUEST", `tool operation ${operationId} already recorded`);
    }
    // Generation fencing: a stale generation cannot start new side effects.
    if (caller.generation === null || caller.generation === undefined) {
      throw err("STALE_GENERATION", "caller has no admitted generation");
    }

    const job: OwnedJob = { operationId, agentId: caller.agentId, tool: request.tool, startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.store.append("tool.intent", {
      operationId,
      agentId: caller.agentId,
      taskRunId: caller.taskRunId,
      generation: caller.generation,
      tool: request.tool,
      parentOperationId: request.parentOperationId ?? null,
    });

    try {
      const result = await this.runTool(caller, operationId, request.tool, args);
      // A cancelled job's outcome was recorded at cancellation; its partial
      // effects stay uncertain whatever the killed process reported.
      if (job.done) return { ...result, exitCode: result.exitCode ?? -1, stderr: `${result.stderr}\n[cancelled]` };
      job.done = true;
      this.store.append("tool.outcome", {
        operationId,
        status: result.exitCode === 0 && !result.timedOut ? "ok" : "error",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
        preview: result.stdout.slice(0, 2000),
      });
      return result;
    } catch (e) {
      if (!job.done) {
        job.done = true;
        this.store.append("tool.outcome", { operationId, status: "uncertain", error: (e as Error).message });
      }
      throw e;
    }
  }

  private async runTool(caller: BrokerCaller, operationId: string, tool: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    let spec: ToolJobSpec;
    switch (tool) {
      case "read":
      case "grep":
      case "find":
      case "ls":
        spec = this.jobSpec(caller.sandbox, caller.writableRoot, operationId, ["node", "-e", TOOL_SCRIPTS[tool]!], caller.workdir, JSON.stringify(args), TOOL_TIMEOUT_MS);
        break;
      case "write":
      case "edit":
        if (!caller.writableRoot) throw err("POLICY_DENIED", `${tool} requires a writer workspace`);
        spec = this.jobSpec(caller.sandbox, caller.writableRoot, operationId, ["node", "-e", TOOL_SCRIPTS[tool]!], caller.workdir, JSON.stringify(args), TOOL_TIMEOUT_MS);
        break;
      case "bash":
        if (!caller.grants.shell) throw err("POLICY_DENIED", "shell authority not granted");
        spec = this.jobSpec(caller.sandbox, caller.writableRoot, operationId, ["bash", "-c", args["command"] as string], caller.workdir, null, bashTimeoutMs(args));
        break;
      default:
        throw err("POLICY_DENIED", `no implementation for tool ${tool}`);
    }
    return this.executorFor(spec).exec(spec);
  }

  private executorFor(spec: ToolJobSpec): ToolExecutor {
    return spec.view === null ? this.executors.host : this.executors.sandbox;
  }

  private jobSpec(sandbox: CallerSandbox | null, writableRoot: string | null, operationId: string, argv: string[], cwd: string, stdin: string | null, timeoutMs: number): ToolJobSpec {
    if (sandbox === null) {
      return {
        operationId,
        argv: [resolveExe(argv[0] ?? "", this.hostEnv["PATH"] ?? ""), ...argv.slice(1)],
        cwd,
        env: this.hostEnv,
        stdin,
        timeoutMs,
        maxOutputBytes: TOOL_MAX_OUTPUT,
        view: null,
      };
    }
    // Supervisor PATH first (explicit), then the host process PATH so Nix
    // profile closures resolve; the sandbox environment stays allowlisted.
    const pathEnv = [this.sandboxEnv["PATH"], this.hostEnv["PATH"]].filter((p): p is string => !!p).join(":");
    const view: SandboxView = {
      readRoots: sandbox.readRoots,
      writableRoot,
      tmpDir: sandbox.tmpDir,
      hidePaths: sandbox.hidePaths,
      runtimeRoots: this.runtimeRoots,
      network: false,
    };
    return {
      operationId,
      argv: [resolveExe(argv[0] ?? "", pathEnv), ...argv.slice(1)],
      cwd,
      env: { ...this.sandboxEnv, HOME: sandbox.tmpDir, TMPDIR: sandbox.tmpDir },
      stdin,
      timeoutMs,
      maxOutputBytes: TOOL_MAX_OUTPUT,
      view,
    };
  }
}

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>;
}
