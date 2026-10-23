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
  /** Hard storage namespaces (never re-bound); see SandboxView. */
  storageRoots?: string[];
  /** Exact read-only workspace exceptions (candidate/own); see SandboxView. */
  readOnlyRoots?: string[];
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
  /**
   * Invocation-specific cancellation for this operation only (never
   * agent-wide): aborting it cancels just this backend job with an
   * observable cancelled outcome. Absent when the caller has no signal.
   */
  signal?: AbortSignal;
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
  private sharedIds: Set<OperationId>;
  /**
   * Fault receipts the journal refused, keyed by operation (latest wins).
   * A dead journal must never silently swallow a valid cancelled state:
   * retained faults flush through the project journal path on the next
   * store interaction instead of rejecting blindly. Map (not list) bounds
   * retention to distinct operations; the fault itself stays inspectable
   * here until delivered.
   */
  private pendingReceipts = new Map<OperationId, Record<string, unknown>>();
  /**
   * Set when ownership leaves this broker (supervisor shutdown/transfer).
   * Detached late paths (abort settlements, receipt flushes) drop their
   * journal writes instead of appending behind a new owner with a stale seq
   * (manifest rewind on reopen). Entry paths fail closed via the store.
   */
  private disposed = false;

  /** Retire journal ownership: late detached writes are fenced from here on. */
  dispose(): void {
    this.disposed = true;
  }
  private runtimeRoots: string[];
  private sandboxEnv: Record<string, string>;
  private hostEnv: Record<string, string>;

  /**
   * `sandboxEnv` is the allowlisted environment of sandboxed jobs (plus
   * their private HOME/TMPDIR); `hostEnv` is the full environment of host jobs.
   */
  constructor(
    executors: ToolExecutors,
    store: RunStore,
    runtimeRoots: string[],
    sandboxEnv: Record<string, string>,
    hostEnv: Record<string, string>,
    /**
     * Cross-route operation-ID reservation shared with the governing
     * dispatcher (supervisor wires one set into both): native and external
     * invocations claiming the SAME explicit ID deny as duplicates instead
     * of double-running. Check-and-reserve stays synchronous with job
     * registration (atomic: no await between). Defaults to a private set,
     * preserving standalone behavior.
     */
    sharedIds?: Set<OperationId>,
  ) {
    this.executors = executors;
    this.store = store;
    this.runtimeRoots = runtimeRoots;
    this.sandboxEnv = sandboxEnv;
    this.hostEnv = hostEnv;
    this.sharedIds = sharedIds ?? new Set<OperationId>();
  }

  /** Active (unfinished) owned jobs for an agent. */
  activeJobs(agentId: AgentId): OwnedJob[] {
    return [...this.jobs.values()].filter((j) => j.agentId === agentId && !j.done);
  }

  /**
   * True while fault receipts await journal delivery. Project-observable
   * health state: queryable while idle, with no new tool call required.
   * New-effect admission gates on this (fail-closed); cancel/recovery
   * paths never do.
   */
  hasPendingReceipts(): boolean {
    return this.pendingReceipts.size > 0;
  }

  /** Retain a fault receipt the journal refused (latest per operation wins). */
  private retainReceipt(operationId: OperationId, body: Record<string, unknown>): void {
    this.pendingReceipts.set(operationId, body);
  }

  /**
   * Best-effort flush of retained fault receipts through the project
   * journal path. Runs ahead of new store interactions so a transient
   * outage delays delivery instead of erasing it. Never throws: a still
   * failing journal keeps the remainder buffered, and the primary flow
   * continues undisturbed.
   */
  private flushReceipts(): void {
    if (this.disposed || this.pendingReceipts.size === 0) return;
    for (const [operationId, body] of [...this.pendingReceipts]) {
      try {
        this.store.append("recovery.event", body);
      } catch {
        return;
      }
      this.pendingReceipts.delete(operationId);
    }
  }

  /** Cancel owned tool jobs (best effort) and mark them done-uncertain. */
  async cancelJobs(agentId: AgentId): Promise<string[]> {
    this.flushReceipts();
    const active = this.activeJobs(agentId);
    for (const job of active) {
      // Own the outcome first, synchronously: a backend settling during the
      // awaits below must take a done-branch (cancel-marked, no journal),
      // never journal an ordinary-confirmed outcome for a cancelled job. A
      // per-op cancellation may have owned it meanwhile — then skip.
      if (job.done) continue;
      job.done = true;
      try {
        await this.executors.sandbox.cancel?.(job.operationId);
        await this.executors.host.cancel?.(job.operationId);
      } catch {
        // best effort; outcome stays uncertain
      }
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
    this.flushReceipts();
    if (this.hasPendingReceipts()) {
      throw err("STORE_FAILED", "journal holds uncommitted fault receipts; explicit recovery required");
    }
    const operationId = randomUUID();
    const job: OwnedJob = { operationId, agentId: opts.agentId, tool: "gate-check", startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.sharedIds.add(operationId);
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
      // Same atomic outcome ownership as execute(): a cancellation that
      // owned this job first (cancelled outcome already journaled) must
      // not be followed by an ordinary-confirmed second record. The late
      // result returns cancel-marked, never clean success.
      if (job.done) return { ...result, exitCode: -1, stderr: `${result.stderr}\n[cancelled]` };
      job.done = true;
      this.store.append("tool.outcome", { operationId, status: result.exitCode === 0 ? "ok" : "error", exitCode: result.exitCode });
      return result;
    } catch (e) {
      // Single outcome ownership (same as execute()): a cancellation that
      // owned this job first already journaled its outcome; a late backend
      // rejection must never append a second record. The rejection still
      // propagates to the caller (never hidden for an uncancelled backend
      // failure). Behind a retired journal owner (disposal) the uncertain
      // receipt is retained instead of journaled out of order: it stays
      // visible via hasPendingReceipts until delivered, never dropped and
      // never a second ordinary-confirmed outcome.
      if (!job.done) {
        job.done = true;
        const error = (e as Error).message;
        if (!this.disposed) {
          this.store.append("tool.outcome", { operationId, status: "uncertain", error });
        } else {
          this.retainReceipt(operationId, { phase: "gate-check-commit-failed", operationId, status: "uncertain", error });
        }
      }
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
    this.flushReceipts();
    // Fail-closed authority: a retained commit fault means the journal may
    // be unable to record this effect — refuse the new admission visibly
    // instead of running healthy-continuation work on uncertain commit.
    if (this.hasPendingReceipts()) {
      throw err("STORE_FAILED", "journal holds uncommitted fault receipts; explicit recovery required");
    }
    const auth = authorizeTool(caller.grants, request.tool);
    if (!auth.ok) throw auth.error;
    // Validate after normalization: what is checked is exactly what runs.
    const args = validateToolArgs(request.tool, normalizeArgs(request.args));
    const operationId = request.operationId ?? randomUUID();

    if (this.jobs.has(operationId) || this.sharedIds.has(operationId)) {
      throw err("DUPLICATE_REQUEST", `tool operation ${operationId} already recorded`);
    }
    // Generation fencing: a stale generation cannot start new side effects.
    if (caller.generation === null || caller.generation === undefined) {
      throw err("STALE_GENERATION", "caller has no admitted generation");
    }

    const job: OwnedJob = { operationId, agentId: caller.agentId, tool: request.tool, startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.sharedIds.add(operationId);
    this.store.append("tool.intent", {
      operationId,
      agentId: caller.agentId,
      taskRunId: caller.taskRunId,
      generation: caller.generation,
      tool: request.tool,
      parentOperationId: request.parentOperationId ?? null,
    });
    // Invocation-specific cancellation (existing per-operation executor
    // mechanism, single job only — never agent-wide): aborting the
    // request signal reaps just this backend job. Ownership linearizes
    // BEFORE awaiting the backend, so a concurrent bulk cancel (which
    // snapshots only unfinished jobs and re-checks below) can never append
    // a second outcome for one operation. The in-flight run below then
    // takes the already-implemented job.done branch, and the caller sees an
    // observable cancel error.
    const cancelThis = async (reason: string): Promise<void> => {
      if (job.done) return;
      job.done = true;
      // A confirmed cancel requires the backend cancel to be issued without
      // error. An ignoring backend (no cancel hook at all) or a throwing
      // one leaves the effect unconfirmed: uncertain, never known-cancelled.
      let confirmed =
        this.executors.sandbox.cancel !== undefined ||
        this.executors.host.cancel !== undefined;
      if (confirmed) {
        try {
          await this.executors.sandbox.cancel?.(operationId);
          await this.executors.host.cancel?.(operationId);
        } catch {
          confirmed = false;
        }
      }
      // Fenced on disposal/transfer: a detached late path must never append
      // behind a new owner (stale seq rewinds the manifest on reopen).
      if (this.disposed) return;
      this.store.append("tool.outcome", {
        operationId,
        status: confirmed ? "cancelled" : "uncertain",
        error: reason,
      });
    };
    const signal = request.signal;
    if (signal?.aborted === true) {
      await cancelThis("invocation aborted before start");
      throw err("NOT_RUNNING", `tool ${request.tool} invocation aborted`);
    }
    const onAbort = (): void => {
      // Never a blind rejection: a commit-ordering append fault inside the
      // detached cancellation is retained (never swallowed) and flushed
      // through the project journal path on the next store interaction,
      // instead of crashing the root or losing the valid cancelled state.
      void cancelThis("invocation aborted").catch((e: unknown) => {
        this.retainReceipt(operationId, {
          phase: "broker-cancel-commit-failed",
          operationId,
          error: String((e as Error)?.message ?? e).slice(0, 500),
        });
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const result = await this.runTool(caller, operationId, request.tool, args);
      // A cancelled job's outcome was recorded at cancellation; its partial
      // effects stay uncertain whatever the killed process reported. The
      // exit code is forced non-success: a cooperative backend reporting 0
      // after cancellation must never read as clean success downstream
      // (every isError derivation keys off nonzero exit).
      if (job.done) return { ...result, exitCode: -1, stderr: `${result.stderr}\n[cancelled]` };
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
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async runTool(caller: BrokerCaller, operationId: string, tool: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    let spec: ToolJobSpec;
    switch (tool) {
      case "read":
      case "grep":
      case "find":
      case "ls":
        spec = this.jobSpec(caller.sandbox, caller.writableRoot, operationId, [process.execPath, "-e", TOOL_SCRIPTS[tool]!], caller.workdir, JSON.stringify(args), TOOL_TIMEOUT_MS);
        break;
      case "write":
      case "edit":
        if (!caller.writableRoot) throw err("POLICY_DENIED", `${tool} requires a writer workspace`);
        spec = this.jobSpec(caller.sandbox, caller.writableRoot, operationId, [process.execPath, "-e", TOOL_SCRIPTS[tool]!], caller.workdir, JSON.stringify(args), TOOL_TIMEOUT_MS);
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
      // Present only when the supervisor supplies storage namespaces, so
      // views without them stay byte-identical to the legacy shape.
      ...(sandbox.storageRoots !== undefined ? { storageRoots: sandbox.storageRoots } : {}),
      // Present only for reviewer/check exceptions; same legacy-shape rule.
      ...(sandbox.readOnlyRoots !== undefined ? { readOnlyRoots: sandbox.readOnlyRoots } : {}),
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
